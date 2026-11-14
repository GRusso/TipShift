//! TipShift's on-chain state machine for an isolated USDC tip pool.
//!
//! The contract receives only the configured NEP-141 token through an opaque,
//! one-use payment reference. A customer never supplies a turn identifier. The
//! administrator maps the reference to a pool before checkout, while the
//! contract enforces the pool's lifecycle independently from the web app.
//!
//! This cut implements roster locking, the dispute/review state machine, and
//! asynchronous NEP-141 payouts. Payouts are marked delivered only from a
//! private callback after the token contract reports success.

use near_contract_standards::fungible_token::core::ext_ft_core;
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    assert_one_yocto, env, near, AccountId, Gas, NearSchema, PanicOnDefault, Promise,
    PromiseOrValue,
};

const SHARE_DENOMINATOR: u16 = 10_000;
const CORRECTION_WINDOW_MS: u64 = 60 * 60 * 1_000;
const ACCEPTANCE_THRESHOLD_BPS: u16 = 7_500;
const OPPOSITION_THRESHOLD_BPS: u16 = 7_500;
/// Keeps all roster scans and payout preparation comfortably within a single
/// NEAR receipt. Larger venues should split the operational shift, not create
/// an unbounded on-chain vector.
const MAX_ROSTER_SIZE: usize = 100;
const MIN_PAYMENT_REF_LEN: usize = 8;
const MAX_PAYMENT_REF_LEN: usize = 128;
const FT_TRANSFER_GAS: Gas = Gas::from_tgas(25);
const PAYOUT_CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, Deserialize, NearSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct Member {
    /// Random, application-generated reference; never a civil name or email.
    pub worker_ref: String,
    /// Employee-selected permanent, public NEAR wallet for the MVP.
    pub near_wallet: AccountId,
    pub share_bps: u16,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    NearSchema,
)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum PoolState {
    Draft,
    Collecting,
    Distributable,
    DisputeVoting,
    Disputed,
    CorrectionReview,
    Paying,
    Distributed,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
struct Vote {
    voter_id: AccountId,
    supports: bool,
}

/// A privacy-preserving aggregate of off-chain employee signatures. Individual
/// objections and votes never enter the contract: the report itself remains in
/// the private reporting layer and this record anchors only its SHA-256 hash
/// and aggregate counts.
#[derive(BorshDeserialize, BorshSerialize, Clone, Serialize, NearSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct Tally {
    pub support_count: u16,
    pub opposition_count: u16,
    pub report_hash: String,
}

/// A payout is immutable once prepared. `in_flight` prevents a second
/// transfer from being scheduled before the token-contract callback arrives.
#[derive(BorshDeserialize, BorshSerialize, Clone)]
struct Payout {
    receiver_id: AccountId,
    amount: u128,
    delivered: bool,
    in_flight: bool,
    attempts: u16,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
struct Pool {
    admin_id: AccountId,
    state: PoolState,
    roster: Vec<Member>,
    /// The start-of-shift voter set stays fixed even after a correction changes
    /// payout recipients. This prevents an admin from adding voters solely to
    /// manufacture a correction result.
    voter_ids: Vec<AccountId>,
    distribution_version: u32,
    /// Unpaid NEP-141 amount still held by this contract for this pool.
    balance: u128,
    /// Immutable accounting total used in employee and business history.
    total_funded: u128,
    /// Legacy field retained so the deployed Borsh state remains decodable.
    /// New funding references live in the separately-prefixed used-reference
    /// map and are charged to their own pool's storage credit.
    funded_payment_refs: Vec<String>,
    objection_owner_id: Option<AccountId>,
    dispute_votes: Vec<Vote>,
    correction_votes: Vec<Vote>,
    deadline_at_ms: Option<u64>,
    payouts: Vec<Payout>,
}

#[derive(Serialize, NearSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct PoolSummary {
    pub admin_id: AccountId,
    pub state: PoolState,
    pub distribution_version: u32,
    /// Amount still awaiting a successful NEP-141 transfer.
    pub balance: U128,
    pub total_funded: U128,
    pub roster_count: u32,
    pub voter_count: u32,
    pub payout_count: u32,
    pub delivered_payout_count: u32,
    pub deadline_at_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct FundingMessage {
    payment_ref: String,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
struct PaymentSession {
    pool_id: String,
    expected_amount: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TipShiftVault {
    owner_id: AccountId,
    accepted_token_id: AccountId,
    pools: LookupMap<String, Pool>,
    payment_sessions: LookupMap<String, PaymentSession>,
}

#[near]
impl TipShiftVault {
    #[init]
    pub fn new(owner_id: AccountId, accepted_token_id: AccountId) -> Self {
        Self {
            owner_id,
            accepted_token_id,
            pools: LookupMap::new(b"p"),
            payment_sessions: LookupMap::new(b"s"),
        }
    }

    /// The owner provisions a pool from the private recipient-binding service.
    /// The location administrator is deliberately not allowed to insert or
    /// replace a recipient wallet in this contract. Before this call, every
    /// pseudonymous slot must have consumed its own private QR and supplied a
    /// wallet signature; this method receives that fully verified roster.
    /// Creates the pool and pre-funds its isolated storage credit. The caller
    /// attaches `storage_credit` plus the exact NEAR needed to persist this
    /// pool. No customer USDC or unrelated pool subsidizes later state growth.
    #[payable]
    pub fn create_pool(
        &mut self,
        pool_id: String,
        admin_id: AccountId,
        roster: Vec<Member>,
        storage_credit: U128,
    ) {
        self.assert_owner();
        Self::assert_pool_id(&pool_id);
        assert!(self.pools.get(&pool_id).is_none(), "pool_id already exists");
        Self::validate_roster(&roster);
        assert!(
            storage_credit.0 > 0,
            "initial storage credit must be positive"
        );
        let storage_before = env::storage_usage();
        self.pools.insert(
            &pool_id,
            &Pool {
                admin_id,
                state: PoolState::Draft,
                roster,
                voter_ids: vec![],
                distribution_version: 1,
                balance: 0,
                total_funded: 0,
                funded_payment_refs: vec![],
                objection_owner_id: None,
                dispute_votes: vec![],
                correction_votes: vec![],
                deadline_at_ms: None,
                payouts: vec![],
            },
        );
        // The record is created before measuring so the business funds both
        // the pool and the storage-credit ledger itself.
        let mut credits = Self::storage_credits();
        credits.insert(&pool_id, &0);
        let storage_after = env::storage_usage();
        let storage_delta = storage_after.saturating_sub(storage_before);
        let storage_cost = Self::storage_cost(storage_delta);
        let required = storage_cost
            .checked_add(storage_credit.0)
            .expect("storage requirement overflow");
        let attached = env::attached_deposit().as_yoctonear();
        assert!(
            attached >= required,
            "attached deposit does not cover pool storage credit"
        );
        // The exact byte cost is paid once. Any deposit above that cost stays
        // owned by this pool as its reserve; it must never become untracked
        // contract balance or subsidize another shift.
        let credited = attached
            .checked_sub(storage_cost)
            .expect("attached deposit is below storage cost");
        credits.insert(&pool_id, &credited);
    }

    /// Adds NEAR that only this pool may consume as its state grows. This also
    /// permits pools created by an older contract version to opt in safely.
    #[payable]
    pub fn deposit_storage_credit(&mut self, pool_id: String) {
        let pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(deposit > 0, "attached deposit must be positive");

        let storage_before = env::storage_usage();
        let current = Self::storage_credit_for(&pool_id);
        let mut credits = Self::storage_credits();
        credits.insert(
            &pool_id,
            &current
                .checked_add(deposit)
                .expect("storage credit overflow"),
        );
        let storage_cost = Self::storage_cost(env::storage_usage().saturating_sub(storage_before));
        assert!(
            deposit >= storage_cost,
            "attached deposit does not cover storage credit record"
        );
        if storage_cost > 0 {
            credits.insert(&pool_id, &(current + deposit - storage_cost));
        }
    }

    /// Unused storage credit becomes withdrawable only after every payout has
    /// been confirmed. Until then it remains reserved for retries and state
    /// transitions in this exact turn.
    #[payable]
    pub fn withdraw_unused_storage_credit(&mut self, pool_id: String, amount: U128) -> Promise {
        assert_one_yocto();
        let pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert_eq!(
            pool.state,
            PoolState::Distributed,
            "storage credit unlocks after distribution"
        );
        assert!(amount.0 > 0, "withdraw amount must be positive");
        let current = Self::storage_credit_for(&pool_id);
        assert!(current >= amount.0, "insufficient pool storage credit");
        let mut credits = Self::storage_credits();
        credits.insert(&pool_id, &(current - amount.0));
        Promise::new(pool.admin_id).transfer(near_sdk::NearToken::from_yoctonear(amount.0))
    }

    pub fn start_collection(&mut self, pool_id: String) {
        let mut pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert_eq!(pool.state, PoolState::Draft, "only a draft pool can start");
        pool.voter_ids = pool
            .roster
            .iter()
            .map(|member| member.near_wallet.clone())
            .collect();
        pool.state = PoolState::Collecting;
        self.save_pool(&pool_id, &pool);
    }

    pub fn close_collection(&mut self, pool_id: String) {
        let mut pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert_eq!(pool.state, PoolState::Collecting, "collection is not open");
        pool.state = PoolState::Distributable;
        self.save_pool(&pool_id, &pool);
    }

    /// Binds one opaque checkout reference to an open pool. The buyer only sees
    /// this reference in the NEP-141 message, not a turn or worker list.
    pub fn open_payment_session(
        &mut self,
        pool_id: String,
        payment_ref: String,
        expected_amount: U128,
    ) {
        let pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert_eq!(pool.state, PoolState::Collecting, "collection is not open");
        Self::assert_payment_ref(&payment_ref);
        // 0 means "open amount": the customer chooses any positive tip. The session is still
        // single-use and only the administrator can open it.
        assert!(
            self.payment_sessions.get(&payment_ref).is_none(),
            "payment_ref already exists"
        );
        assert!(
            Self::used_payment_refs().get(&payment_ref).is_none(),
            "payment_ref already used"
        );
        assert!(
            !pool
                .funded_payment_refs
                .iter()
                .any(|reference| reference == &payment_ref),
            "payment_ref already used"
        );
        let storage_before = env::storage_usage();
        self.payment_sessions.insert(
            &payment_ref,
            &PaymentSession {
                pool_id: pool_id.clone(),
                expected_amount: expected_amount.0,
            },
        );
        self.apply_storage_delta(&pool_id, storage_before);
    }

    /// Anchors the aggregate of employee-signed objections and dispute votes.
    ///
    /// Employees sign in the private TipShift application, so this method is
    /// called only by the location administrator after its tally verifier has
    /// checked those signatures. No employee wallet submits an on-chain vote or
    /// pays gas. The contract records counts and the report hash, never the
    /// individual votes or optional objection note.
    pub fn publish_dispute_tally(
        &mut self,
        pool_id: String,
        support_count: u16,
        opposition_count: u16,
        report_hash: String,
    ) {
        let mut pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert!(
            matches!(
                pool.state,
                PoolState::Collecting | PoolState::Distributable | PoolState::DisputeVoting
            ),
            "dispute tally is not allowed in this state"
        );
        Self::validate_tally(&pool, support_count, opposition_count, &report_hash);
        assert!(
            support_count > 0,
            "an objection requires one supporting signature"
        );

        if !matches!(pool.state, PoolState::DisputeVoting) {
            pool.state = PoolState::DisputeVoting;
            pool.objection_owner_id = None;
            pool.deadline_at_ms = Some(Self::deadline());
        }
        self.save_dispute_tally(
            &pool_id,
            &Tally {
                support_count,
                opposition_count,
                report_hash,
            },
        );
        self.evaluate_dispute(&pool_id, &mut pool);
        self.save_pool(&pool_id, &pool);
    }

    /// Anchors the signed withdrawal of the original objection. The verifier
    /// checks ownership off-chain; the contract does not expose that employee's
    /// wallet or require an individual transaction.
    pub fn publish_objection_withdrawal(&mut self, pool_id: String, report_hash: String) {
        let mut pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert!(
            matches!(pool.state, PoolState::DisputeVoting | PoolState::Disputed),
            "there is no withdrawable objection"
        );
        Self::assert_report_hash(&report_hash);
        pool.state = PoolState::Distributable;
        pool.objection_owner_id = None;
        pool.deadline_at_ms = None;
        // Keep the withdrawal report hash anchored as the latest public
        // aggregate record for this pool. The private report retains the full
        // signed history; the chain still stores no individual voter.
        self.save_dispute_tally(
            &pool_id,
            &Tally {
                support_count: 0,
                opposition_count: 0,
                report_hash,
            },
        );
        self.save_pool(&pool_id, &pool);
    }

    pub fn finalize_dispute_vote(&mut self, pool_id: String) {
        let mut pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert_eq!(
            pool.state,
            PoolState::DisputeVoting,
            "there is no dispute vote to finalize"
        );
        Self::assert_deadline_reached(&pool);
        if Self::dispute_tally_for(&pool_id).support_count as usize * 2 > pool.voter_ids.len() {
            Self::mark_disputed(&mut pool);
        } else {
            pool.state = PoolState::Distributable;
            pool.deadline_at_ms = None;
        }
        self.save_pool(&pool_id, &pool);
    }

    pub fn submit_corrected_distribution(&mut self, pool_id: String, roster: Vec<Member>) {
        let mut pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert_eq!(
            pool.state,
            PoolState::Disputed,
            "a correction requires a disputed pool"
        );
        Self::validate_roster(&roster);
        pool.roster = roster;
        pool.distribution_version = pool
            .distribution_version
            .checked_add(1)
            .expect("version overflow");
        self.clear_correction_tally(&pool_id);
        pool.state = PoolState::CorrectionReview;
        pool.deadline_at_ms = Some(Self::deadline());
        self.save_pool(&pool_id, &pool);
    }

    /// Anchors the aggregate of employee-signed correction review responses.
    /// `opposition_count` is the count of "Me opongo" signatures. Individual
    /// employees never make a chain transaction for this review.
    pub fn publish_correction_tally(
        &mut self,
        pool_id: String,
        acceptance_count: u16,
        opposition_count: u16,
        report_hash: String,
    ) {
        let mut pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert_eq!(
            pool.state,
            PoolState::CorrectionReview,
            "there is no correction under review"
        );
        Self::validate_tally(&pool, acceptance_count, opposition_count, &report_hash);
        self.save_correction_tally(
            &pool_id,
            &Tally {
                support_count: acceptance_count,
                opposition_count,
                report_hash,
            },
        );

        if Self::meets_threshold(
            usize::from(acceptance_count),
            pool.voter_ids.len(),
            ACCEPTANCE_THRESHOLD_BPS,
        ) {
            pool.state = PoolState::Distributable;
            pool.deadline_at_ms = None;
        } else if Self::meets_threshold(
            usize::from(opposition_count),
            pool.voter_ids.len(),
            OPPOSITION_THRESHOLD_BPS,
        ) {
            Self::mark_disputed(&mut pool);
        }
        self.save_pool(&pool_id, &pool);
    }

    pub fn finalize_correction_review(&mut self, pool_id: String) {
        let mut pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert_eq!(
            pool.state,
            PoolState::CorrectionReview,
            "there is no correction under review"
        );
        Self::assert_deadline_reached(&pool);
        let tally = Self::correction_tally_for(&pool_id);
        if Self::meets_threshold(
            usize::from(tally.opposition_count),
            pool.voter_ids.len(),
            OPPOSITION_THRESHOLD_BPS,
        ) {
            Self::mark_disputed(&mut pool);
        } else {
            pool.state = PoolState::Distributable;
            pool.deadline_at_ms = None;
        }
        self.save_pool(&pool_id, &pool);
    }

    /// Freezes the approved roster into deterministic, exact NEP-141 payout
    /// amounts. It schedules no transfer: the business then dispatches each
    /// payout, paying that transfer's gas and mandatory one yocto deposit.
    pub fn prepare_distribution(&mut self, pool_id: String) {
        let mut pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert_eq!(
            pool.state,
            PoolState::Distributable,
            "pool is not ready to distribute"
        );
        assert!(pool.balance > 0, "pool has no funds to distribute");
        assert!(pool.payouts.is_empty(), "distribution is already prepared");

        pool.payouts = Self::allocate_payouts(&pool.roster, pool.balance);
        pool.state = PoolState::Paying;
        self.save_pool(&pool_id, &pool);
    }

    /// Schedules one employee transfer. A frontend may submit one of these
    /// calls for every pending payout, but each is independently confirmed by
    /// `on_payout_result`; a failed transfer stays retryable and cannot be
    /// mistaken for a paid employee.
    #[payable]
    pub fn dispatch_payout(&mut self, pool_id: String, payout_index: u32) -> Promise {
        assert_one_yocto();
        let mut pool = self.pool_or_panic(&pool_id);
        self.assert_admin(&pool);
        assert_eq!(
            pool.state,
            PoolState::Paying,
            "distribution is not being paid"
        );
        let index = usize::try_from(payout_index).expect("payout index overflow");
        let payout = pool.payouts.get_mut(index).expect("unknown payout index");
        assert!(!payout.delivered, "payout is already delivered");
        assert!(!payout.in_flight, "payout confirmation is pending");
        assert!(payout.amount > 0, "zero-amount payouts are already settled");
        payout.in_flight = true;
        payout.attempts = payout
            .attempts
            .checked_add(1)
            .expect("payout attempts overflow");
        let receiver_id = payout.receiver_id.clone();
        let amount = U128(payout.amount);
        self.save_pool(&pool_id, &pool);

        ext_ft_core::ext(self.accepted_token_id.clone())
            .with_attached_deposit(near_sdk::NearToken::from_yoctonear(1))
            .with_static_gas(FT_TRANSFER_GAS)
            .ft_transfer(receiver_id, amount, None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(PAYOUT_CALLBACK_GAS)
                    .on_payout_result(pool_id, payout_index),
            )
    }

    /// Only the contract itself may confirm an asynchronous FT transfer. A
    /// caller cannot forge success to make a payout appear delivered.
    #[private]
    pub fn on_payout_result(&mut self, pool_id: String, payout_index: u32) {
        let mut pool = self.pool_or_panic(&pool_id);
        assert_eq!(
            pool.state,
            PoolState::Paying,
            "distribution is not being paid"
        );
        let index = usize::try_from(payout_index).expect("payout index overflow");
        let payout = pool.payouts.get_mut(index).expect("unknown payout index");
        assert!(payout.in_flight, "payout is not awaiting confirmation");
        payout.in_flight = false;

        if env::promise_result_checked(0, 0).is_ok() {
            payout.delivered = true;
            pool.balance = pool
                .balance
                .checked_sub(payout.amount)
                .expect("payout exceeds outstanding balance");
        }

        if pool.payouts.iter().all(|payout| payout.delivered) {
            assert_eq!(
                pool.balance, 0,
                "outstanding balance does not match delivered payouts"
            );
            pool.state = PoolState::Distributed;
        }
        self.save_pool(&pool_id, &pool);
    }

    pub fn get_pool(&self, pool_id: String) -> Option<PoolSummary> {
        self.pools.get(&pool_id).map(Self::summary)
    }

    /// Public aggregate only. The signed employee report remains private and
    /// is retrievable by its authorized parties from the reporting layer.
    pub fn get_dispute_tally(&self, pool_id: String) -> Tally {
        Self::assert_pool_id(&pool_id);
        Self::dispute_tally_for(&pool_id)
    }

    /// Public aggregate only. `support_count` means acceptances for a
    /// corrected distribution; `opposition_count` means "Me opongo".
    pub fn get_correction_tally(&self, pool_id: String) -> Tally {
        Self::assert_pool_id(&pool_id);
        Self::correction_tally_for(&pool_id)
    }

    /// Exposes the pool's remaining NEAR reserve to its operator. This is not
    /// a tip balance and is never paid to employees.
    pub fn get_storage_credit(&self, pool_id: String) -> U128 {
        Self::assert_pool_id(&pool_id);
        U128(Self::storage_credit_for(&pool_id))
    }

    pub fn accepted_token_id(&self) -> AccountId {
        self.accepted_token_id.clone()
    }

    fn summary(pool: Pool) -> PoolSummary {
        PoolSummary {
            admin_id: pool.admin_id,
            state: pool.state,
            distribution_version: pool.distribution_version,
            balance: U128(pool.balance),
            total_funded: U128(pool.total_funded),
            roster_count: u32::try_from(pool.roster.len()).expect("roster count overflow"),
            voter_count: u32::try_from(pool.voter_ids.len()).expect("voter count overflow"),
            payout_count: u32::try_from(pool.payouts.len()).expect("payout count overflow"),
            delivered_payout_count: u32::try_from(
                pool.payouts
                    .iter()
                    .filter(|payout| payout.delivered)
                    .count(),
            )
            .expect("delivered payout count overflow"),
            deadline_at_ms: pool.deadline_at_ms,
        }
    }

    fn pool_or_panic(&self, pool_id: &str) -> Pool {
        Self::assert_pool_id(pool_id);
        self.pools
            .get(&pool_id.to_string())
            .expect("unknown pool_id")
    }

    fn assert_owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "owner only");
    }

    fn assert_admin(&self, pool: &Pool) {
        assert_eq!(
            env::predecessor_account_id(),
            pool.admin_id,
            "pool admin only"
        );
    }

    fn assert_pool_id(pool_id: &str) {
        assert!(!pool_id.trim().is_empty(), "pool_id is required");
        assert!(pool_id.len() <= 128, "pool_id exceeds 128 characters");
    }

    fn assert_payment_ref(payment_ref: &str) {
        assert!(
            payment_ref.len() >= MIN_PAYMENT_REF_LEN,
            "payment_ref is too short"
        );
        assert!(
            payment_ref.len() <= MAX_PAYMENT_REF_LEN,
            "payment_ref exceeds 128 characters"
        );
        assert_eq!(
            payment_ref.trim(),
            payment_ref,
            "payment_ref must not have surrounding whitespace"
        );
    }

    fn validate_roster(roster: &[Member]) {
        assert!(
            !roster.is_empty(),
            "roster must contain at least one worker"
        );
        assert!(
            roster.len() <= MAX_ROSTER_SIZE,
            "roster exceeds maximum size"
        );
        let mut share_total: u32 = 0;
        for (index, member) in roster.iter().enumerate() {
            assert!(
                !member.worker_ref.trim().is_empty(),
                "worker_ref is required"
            );
            assert!(
                member.worker_ref.len() <= 128,
                "worker_ref exceeds 128 characters"
            );
            assert!(member.share_bps > 0, "each share must be positive");
            share_total = share_total
                .checked_add(u32::from(member.share_bps))
                .expect("share total overflow");
            for prior in &roster[..index] {
                assert!(
                    prior.worker_ref != member.worker_ref,
                    "worker_ref must be unique"
                );
                assert!(
                    prior.near_wallet != member.near_wallet,
                    "wallet must be unique"
                );
            }
        }
        assert_eq!(
            share_total,
            u32::from(SHARE_DENOMINATOR),
            "shares must total 10000 bps"
        );
    }

    fn assert_report_hash(report_hash: &str) {
        assert_eq!(
            report_hash.len(),
            64,
            "report_hash must be a SHA-256 hex digest"
        );
        assert!(
            report_hash.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "report_hash must be hexadecimal"
        );
    }

    fn validate_tally(pool: &Pool, support: u16, opposition: u16, report_hash: &str) {
        let total = usize::from(support)
            .checked_add(usize::from(opposition))
            .expect("tally overflow");
        assert!(total <= pool.voter_ids.len(), "tally exceeds locked roster");
        Self::assert_report_hash(report_hash);
    }

    fn meets_threshold(count: usize, eligible: usize, threshold_bps: u16) -> bool {
        count * usize::from(SHARE_DENOMINATOR) >= eligible * usize::from(threshold_bps)
    }

    fn deadline() -> u64 {
        env::block_timestamp_ms()
            .checked_add(CORRECTION_WINDOW_MS)
            .expect("deadline overflow")
    }

    fn assert_deadline_reached(pool: &Pool) {
        let deadline = pool.deadline_at_ms.expect("deadline missing");
        assert!(
            env::block_timestamp_ms() >= deadline,
            "review window is still open"
        );
    }

    fn mark_disputed(pool: &mut Pool) {
        pool.state = PoolState::Disputed;
        pool.deadline_at_ms = None;
    }

    fn evaluate_dispute(&self, pool_id: &str, pool: &mut Pool) {
        if usize::from(Self::dispute_tally_for(pool_id).support_count) * 2 > pool.voter_ids.len() {
            Self::mark_disputed(pool);
        }
    }

    /// These maps intentionally use independent stable prefixes rather than
    /// new fields in `TipShiftVault`. That preserves Borsh compatibility with
    /// the already-deployed testnet state while isolating accounting by pool.
    fn storage_credits() -> LookupMap<String, u128> {
        LookupMap::new(b"c")
    }

    fn used_payment_refs() -> LookupMap<String, bool> {
        LookupMap::new(b"u")
    }

    /// Independent prefixes preserve the Borsh layout of `Pool` and the
    /// already-deployed testnet state. The old per-wallet vote vectors remain
    /// decodable but are no longer written by this version of the contract.
    fn dispute_tallies() -> LookupMap<String, Tally> {
        LookupMap::new(b"d")
    }

    fn correction_tallies() -> LookupMap<String, Tally> {
        LookupMap::new(b"r")
    }

    fn dispute_tally_for(pool_id: &str) -> Tally {
        Self::dispute_tallies()
            .get(&pool_id.to_string())
            .unwrap_or(Tally {
                support_count: 0,
                opposition_count: 0,
                report_hash: "0".repeat(64),
            })
    }

    fn correction_tally_for(pool_id: &str) -> Tally {
        Self::correction_tallies()
            .get(&pool_id.to_string())
            .unwrap_or(Tally {
                support_count: 0,
                opposition_count: 0,
                report_hash: "0".repeat(64),
            })
    }

    fn save_dispute_tally(&mut self, pool_id: &str, tally: &Tally) {
        let storage_before = env::storage_usage();
        let mut tallies = Self::dispute_tallies();
        tallies.insert(&pool_id.to_string(), tally);
        self.apply_storage_delta(pool_id, storage_before);
    }

    fn save_correction_tally(&mut self, pool_id: &str, tally: &Tally) {
        let storage_before = env::storage_usage();
        let mut tallies = Self::correction_tallies();
        tallies.insert(&pool_id.to_string(), tally);
        self.apply_storage_delta(pool_id, storage_before);
    }

    fn clear_correction_tally(&mut self, pool_id: &str) {
        let storage_before = env::storage_usage();
        let mut tallies = Self::correction_tallies();
        tallies.remove(&pool_id.to_string());
        self.apply_storage_delta(pool_id, storage_before);
    }

    fn storage_credit_for(pool_id: &str) -> u128 {
        Self::storage_credits()
            .get(&pool_id.to_string())
            .unwrap_or(0)
    }

    fn storage_cost(bytes: u64) -> u128 {
        u128::from(bytes)
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .expect("storage cost overflow")
    }

    /// Persists a pool and debits or returns its exact byte-cost delta to that
    /// pool's own reserve. The assertion rolls the entire receipt back if a
    /// pool tries to grow beyond its prepaid credit.
    fn save_pool(&mut self, pool_id: &str, pool: &Pool) {
        let storage_before = env::storage_usage();
        self.pools.insert(&pool_id.to_string(), pool);
        self.apply_storage_delta(pool_id, storage_before);
    }

    fn apply_storage_delta(&mut self, pool_id: &str, storage_before: u64) {
        let storage_after = env::storage_usage();
        let mut credits = Self::storage_credits();
        let current = credits.get(&pool_id.to_string()).unwrap_or(0);
        if storage_after > storage_before {
            let cost = Self::storage_cost(storage_after - storage_before);
            assert!(current >= cost, "insufficient pool storage credit");
            credits.insert(&pool_id.to_string(), &(current - cost));
        } else if storage_before > storage_after {
            let released = Self::storage_cost(storage_before - storage_after);
            credits.insert(
                &pool_id.to_string(),
                &current
                    .checked_add(released)
                    .expect("storage credit overflow"),
            );
        }
    }

    /// Uses a largest-remainder allocation so the amounts sum exactly to the
    /// pool balance without silently losing token units to rounding. Ties are
    /// resolved by the stable roster order, which is visible to the workers
    /// before collection closes.
    fn allocate_payouts(roster: &[Member], balance: u128) -> Vec<Payout> {
        let base_unit = balance / u128::from(SHARE_DENOMINATOR);
        let residual = balance % u128::from(SHARE_DENOMINATOR);
        let mut payouts: Vec<Payout> = roster
            .iter()
            .map(|member| Payout {
                receiver_id: member.near_wallet.clone(),
                amount: base_unit
                    .checked_mul(u128::from(member.share_bps))
                    .expect("payout amount overflow")
                    + residual * u128::from(member.share_bps) / u128::from(SHARE_DENOMINATOR),
                delivered: false,
                in_flight: false,
                attempts: 0,
            })
            .collect();
        let allocated: u128 = payouts.iter().map(|payout| payout.amount).sum();
        let remaining = balance
            .checked_sub(allocated)
            .expect("payout allocation exceeds balance");
        let mut ranks: Vec<(usize, u128)> = roster
            .iter()
            .enumerate()
            .map(|(index, member)| {
                (
                    index,
                    residual * u128::from(member.share_bps) % u128::from(SHARE_DENOMINATOR),
                )
            })
            .collect();
        ranks.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        for (index, _) in ranks
            .into_iter()
            .take(usize::try_from(remaining).expect("rounding remainder overflow"))
        {
            payouts[index].amount = payouts[index]
                .amount
                .checked_add(1)
                .expect("payout amount overflow");
        }
        for payout in &mut payouts {
            if payout.amount == 0 {
                payout.delivered = true;
            }
        }
        payouts
    }
}

#[near]
impl FungibleTokenReceiver for TipShiftVault {
    /// NEP-141 intake. The configured token contract is the only caller that
    /// may credit a pool, and it may do so only once per pre-opened reference.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        // The NEP-141 ABI requires this field to be named `sender_id`.
        // Keep it available for a future payer audit event without retaining it
        // in TipShift's on-chain state.
        let _ = sender_id;
        assert_eq!(
            env::predecessor_account_id(),
            self.accepted_token_id,
            "unsupported token"
        );
        assert!(amount.0 > 0, "amount must be positive");
        let funding: FundingMessage =
            near_sdk::serde_json::from_str(&msg).expect("invalid funding message");
        Self::assert_payment_ref(&funding.payment_ref);

        let session = self
            .payment_sessions
            .get(&funding.payment_ref)
            .expect("unknown or already used payment_ref");
        assert!(
            session.expected_amount == 0 || amount.0 == session.expected_amount,
            "tip amount does not match the approved checkout"
        );
        let mut pool = self.pool_or_panic(&session.pool_id);
        assert_eq!(pool.state, PoolState::Collecting, "collection is not open");
        assert!(
            Self::used_payment_refs()
                .get(&funding.payment_ref)
                .is_none(),
            "payment_ref already funded"
        );
        assert!(
            !pool
                .funded_payment_refs
                .iter()
                .any(|reference| reference == &funding.payment_ref),
            "payment_ref already funded"
        );

        pool.balance = pool
            .balance
            .checked_add(amount.0)
            .expect("balance overflow");
        pool.total_funded = pool
            .total_funded
            .checked_add(amount.0)
            .expect("funding total overflow");
        // Keep the legacy vector untouched. The used-reference map below is
        // globally unique and charged to this pool instead of growing the
        // pool's serialized state forever.
        let storage_before = env::storage_usage();
        self.pools.insert(&session.pool_id, &pool);
        self.payment_sessions.remove(&funding.payment_ref);
        let mut used_refs = Self::used_payment_refs();
        used_refs.insert(&funding.payment_ref, &true);
        self.apply_storage_delta(&session.pool_id, storage_before);
        PromiseOrValue::Value(U128(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{test_vm_config, testing_env, NearToken, PromiseResult, RuntimeFeesConfig};

    fn account(value: &str) -> AccountId {
        value.parse().unwrap()
    }

    fn members() -> Vec<Member> {
        vec![
            Member {
                worker_ref: "worker-a".to_string(),
                near_wallet: account("worker-a.testnet"),
                share_bps: 5_000,
            },
            Member {
                worker_ref: "worker-b".to_string(),
                near_wallet: account("worker-b.testnet"),
                share_bps: 3_000,
            },
            Member {
                worker_ref: "worker-c".to_string(),
                near_wallet: account("worker-c.testnet"),
                share_bps: 2_000,
            },
        ]
    }

    fn report_hash(seed: char) -> String {
        std::iter::repeat_n(seed, 64).collect()
    }

    fn context(predecessor: &str, timestamp_ms: u64) {
        context_with_deposit(predecessor, timestamp_ms, 0);
    }

    fn context_with_deposit(predecessor: &str, timestamp_ms: u64, attached_deposit: u128) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("tipshift.testnet"))
            .predecessor_account_id(account(predecessor))
            .signer_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(attached_deposit))
            .block_timestamp(timestamp_ms * 1_000_000);
        testing_env!(builder.build());
    }

    fn context_with_one_yocto(predecessor: &str, timestamp_ms: u64) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("tipshift.testnet"))
            .predecessor_account_id(account(predecessor))
            .signer_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(1))
            .block_timestamp(timestamp_ms * 1_000_000);
        testing_env!(builder.build());
    }

    fn callback_context(result: PromiseResult) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("tipshift.testnet"))
            .predecessor_account_id(account("tipshift.testnet"))
            .signer_account_id(account("tipshift.testnet"))
            .attached_deposit(NearToken::from_yoctonear(0))
            .block_timestamp(1_000 * 1_000_000);
        testing_env!(
            builder.build(),
            test_vm_config(),
            RuntimeFeesConfig::test(),
            std::collections::HashMap::default(),
            vec![result],
        );
    }

    fn new_contract() -> TipShiftVault {
        context("owner.testnet", 1_000);
        TipShiftVault::new(account("owner.testnet"), account("usdc.testnet"))
    }

    fn create_started_pool(contract: &mut TipShiftVault) {
        create_started_pool_named(contract, "turn-1", "admin.testnet");
    }

    fn create_started_pool_named(contract: &mut TipShiftVault, pool_id: &str, admin_id: &str) {
        context_with_deposit(
            "owner.testnet",
            1_000,
            NearToken::from_near(1).as_yoctonear(),
        );
        contract.create_pool(
            pool_id.to_string(),
            account(admin_id),
            members(),
            U128(NearToken::from_near(1).as_yoctonear() / 100),
        );
        context(admin_id, 1_000);
        contract.start_collection(pool_id.to_string());
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn a_non_owner_cannot_provision_a_location_pool() {
        let mut contract = new_contract();
        context("untrusted.testnet", 1_000);
        contract.create_pool(
            "turn-1".to_string(),
            account("admin.testnet"),
            members(),
            U128(1),
        );
    }

    #[test]
    #[should_panic(expected = "pool admin only")]
    fn an_untrusted_caller_cannot_publish_an_employee_tally() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("unassigned.testnet", 1_000);
        contract.publish_dispute_tally("turn-1".to_string(), 1, 0, report_hash('a'));
    }

    #[test]
    #[should_panic(expected = "pool admin only")]
    fn a_location_admin_cannot_close_another_location_pool() {
        let mut contract = new_contract();
        create_started_pool_named(&mut contract, "location-a-turn", "admin-a.testnet");
        create_started_pool_named(&mut contract, "location-b-turn", "admin-b.testnet");
        context("admin-b.testnet", 1_000);
        contract.close_collection("location-a-turn".to_string());
    }

    #[test]
    #[should_panic(expected = "payment_ref already exists")]
    fn one_payment_reference_cannot_be_opened_for_two_location_pools() {
        let mut contract = new_contract();
        create_started_pool_named(&mut contract, "location-a-turn", "admin-a.testnet");
        create_started_pool_named(&mut contract, "location-b-turn", "admin-b.testnet");
        context("admin-a.testnet", 1_000);
        contract.open_payment_session(
            "location-a-turn".to_string(),
            "checkout-1".to_string(),
            U128(1),
        );
        context("admin-b.testnet", 1_000);
        contract.open_payment_session(
            "location-b-turn".to_string(),
            "checkout-1".to_string(),
            U128(1),
        );
    }

    #[test]
    fn one_permanent_wallet_can_participate_in_multiple_isolated_turns() {
        let mut contract = new_contract();
        // `members()` deliberately returns the same three wallets for both
        // pools. Wallet uniqueness is a per-turn invariant, not a global one.
        create_started_pool_named(&mut contract, "morning-turn", "admin.testnet");
        create_started_pool_named(&mut contract, "evening-turn", "admin.testnet");

        let morning = contract.get_pool("morning-turn".to_string()).unwrap();
        let evening = contract.get_pool("evening-turn".to_string()).unwrap();
        assert_eq!(morning.state, PoolState::Collecting);
        assert_eq!(evening.state, PoolState::Collecting);
        assert_eq!(morning.voter_count, 3);
        assert_eq!(evening.voter_count, 3);
    }

    #[test]
    #[should_panic(expected = "attached deposit does not cover pool storage credit")]
    fn pool_creation_cannot_spend_the_vaults_unfunded_storage() {
        let mut contract = new_contract();
        context("owner.testnet", 1_000);
        contract.create_pool(
            "turn-1".to_string(),
            account("admin.testnet"),
            members(),
            U128(1),
        );
    }

    #[test]
    fn pool_creation_keeps_any_storage_overpayment_with_its_own_pool() {
        let mut contract = new_contract();
        let requested_credit = NearToken::from_near(1).as_yoctonear() / 100;
        context_with_deposit(
            "owner.testnet",
            1_000,
            NearToken::from_near(1).as_yoctonear(),
        );
        contract.create_pool(
            "turn-with-buffer".to_string(),
            account("admin.testnet"),
            members(),
            U128(requested_credit),
        );

        assert!(
            contract
                .get_storage_credit("turn-with-buffer".to_string())
                .0
                > requested_credit,
            "the attached buffer must remain attributed to this pool"
        );
    }

    #[test]
    #[should_panic(expected = "roster exceeds maximum size")]
    fn roster_size_is_bounded_before_it_can_create_an_unbounded_payout_or_vote_list() {
        let mut oversized = Vec::new();
        for index in 0..=MAX_ROSTER_SIZE {
            oversized.push(Member {
                worker_ref: format!("worker-{index}"),
                near_wallet: account(&format!("worker-{index}.testnet")),
                share_bps: if index == MAX_ROSTER_SIZE { 100 } else { 99 },
            });
        }
        let mut contract = new_contract();
        context_with_deposit(
            "owner.testnet",
            1_000,
            NearToken::from_near(1).as_yoctonear(),
        );
        contract.create_pool(
            "turn-1".to_string(),
            account("admin.testnet"),
            oversized,
            U128(NearToken::from_near(1).as_yoctonear() / 100),
        );
    }

    #[test]
    fn locks_the_roster_and_accepts_only_one_bound_payment_reference() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.open_payment_session(
            "turn-1".to_string(),
            "checkout-1".to_string(),
            U128(5_000_000),
        );

        context("usdc.testnet", 1_000);
        let accepted = contract.ft_on_transfer(
            account("customer.testnet"),
            U128(5_000_000),
            r#"{"payment_ref":"checkout-1"}"#.to_string(),
        );
        match accepted {
            PromiseOrValue::Value(value) => assert_eq!(value, U128(0)),
            PromiseOrValue::Promise(_) => panic!("a token intake must not return a promise"),
        }
        assert_eq!(
            contract.get_pool("turn-1".to_string()).unwrap().balance,
            U128(5_000_000)
        );

        // The ABI intentionally has no admin roster-mutation method. A
        // location admin can start/operate this already verified pool but
        // cannot insert a recipient wallet after the QR binding workflow.
    }

    #[test]
    #[should_panic(expected = "payment_ref already used")]
    fn a_funded_reference_cannot_be_reopened_even_after_its_session_is_removed() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.open_payment_session("turn-1".to_string(), "checkout-1".to_string(), U128(1));
        context("usdc.testnet", 1_000);
        let _ = contract.ft_on_transfer(
            account("customer.testnet"),
            U128(1),
            r#"{"payment_ref":"checkout-1"}"#.to_string(),
        );
        context("admin.testnet", 1_000);
        contract.open_payment_session("turn-1".to_string(), "checkout-1".to_string(), U128(1));
    }

    #[test]
    fn storage_credit_is_isolated_to_the_pool_that_opens_a_checkout_session() {
        let mut contract = new_contract();
        create_started_pool_named(&mut contract, "location-a-turn", "admin-a.testnet");
        create_started_pool_named(&mut contract, "location-b-turn", "admin-b.testnet");
        let credit_b_before = contract.get_storage_credit("location-b-turn".to_string()).0;
        let credit_a_before = contract.get_storage_credit("location-a-turn".to_string()).0;

        context("admin-a.testnet", 1_000);
        contract.open_payment_session(
            "location-a-turn".to_string(),
            "checkout-a".to_string(),
            U128(1),
        );

        assert!(contract.get_storage_credit("location-a-turn".to_string()).0 < credit_a_before);
        assert_eq!(
            contract.get_storage_credit("location-b-turn".to_string()).0,
            credit_b_before
        );
    }

    #[test]
    fn a_signed_aggregate_majority_opens_a_dispute_and_can_be_withdrawn() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.close_collection("turn-1".to_string());

        // Employees sign the two responses off-chain. Only the location admin
        // publishes their aggregate and a hash of the private signed report.
        context("admin.testnet", 1_000);
        contract.publish_dispute_tally("turn-1".to_string(), 2, 0, report_hash('b'));
        assert_eq!(
            contract
                .get_dispute_tally("turn-1".to_string())
                .support_count,
            2
        );
        assert_eq!(
            contract.get_pool("turn-1".to_string()).unwrap().state,
            PoolState::Disputed
        );

        context("admin.testnet", 1_000);
        contract.publish_objection_withdrawal("turn-1".to_string(), report_hash('c'));
        assert_eq!(
            contract.get_pool("turn-1".to_string()).unwrap().state,
            PoolState::Distributable
        );
    }

    #[test]
    #[should_panic(expected = "tally exceeds locked roster")]
    fn an_aggregate_cannot_claim_more_signatures_than_the_locked_roster() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.publish_dispute_tally("turn-1".to_string(), 4, 0, report_hash('1'));
    }

    #[test]
    #[should_panic(expected = "report_hash must be a SHA-256 hex digest")]
    fn an_aggregate_requires_a_fixed_length_report_hash() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.publish_dispute_tally("turn-1".to_string(), 1, 0, "not-a-hash".to_string());
    }

    #[test]
    fn three_of_three_acceptances_unlock_a_corrected_distribution_early() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.publish_dispute_tally("turn-1".to_string(), 2, 0, report_hash('d'));

        context("admin.testnet", 1_000);
        contract.submit_corrected_distribution("turn-1".to_string(), members());
        context("admin.testnet", 1_000);
        contract.publish_correction_tally("turn-1".to_string(), 3, 0, report_hash('e'));
        assert_eq!(
            contract.get_pool("turn-1".to_string()).unwrap().state,
            PoolState::Distributable
        );
    }

    #[test]
    fn correction_auto_unlocks_after_the_window_when_opposition_is_below_75_percent() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.publish_dispute_tally("turn-1".to_string(), 2, 0, report_hash('f'));
        context("admin.testnet", 1_000);
        contract.submit_corrected_distribution("turn-1".to_string(), members());
        context("worker-a.testnet", 1_000);
        // This call is intentionally still from the admin account: it only
        // publishes the one signed opposition in aggregate.
        context("admin.testnet", 1_000);
        contract.publish_correction_tally("turn-1".to_string(), 0, 1, report_hash('0'));

        context("admin.testnet", 1_000 + CORRECTION_WINDOW_MS);
        contract.finalize_correction_review("turn-1".to_string());
        assert_eq!(
            contract.get_pool("turn-1".to_string()).unwrap().state,
            PoolState::Distributable
        );
    }

    #[test]
    #[should_panic(expected = "unsupported token")]
    fn rejects_an_unapproved_token_contract() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.open_payment_session("turn-1".to_string(), "checkout-1".to_string(), U128(1));
        context("attacker.testnet", 1_000);
        let _ = contract.ft_on_transfer(
            account("customer.testnet"),
            U128(1),
            r#"{"payment_ref":"checkout-1"}"#.to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "tip amount does not match the approved checkout")]
    fn rejects_a_short_tip_even_when_the_token_and_reference_are_valid() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.open_payment_session(
            "turn-1".to_string(),
            "checkout-1".to_string(),
            U128(5_000_000),
        );
        context("usdc.testnet", 1_000);
        let _ = contract.ft_on_transfer(
            account("customer.testnet"),
            U128(4_999_999),
            r#"{"payment_ref":"checkout-1"}"#.to_string(),
        );
    }

    #[test]
    fn open_amount_session_accepts_any_positive_tip_once() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.open_payment_session("turn-1".to_string(), "checkout-1".to_string(), U128(0));
        context("usdc.testnet", 1_000);
        let _ = contract.ft_on_transfer(
            account("customer.testnet"),
            U128(1_234_567),
            r#"{"payment_ref":"checkout-1"}"#.to_string(),
        );
        assert_eq!(
            contract.get_pool("turn-1".to_string()).unwrap().balance.0,
            1_234_567
        );
    }

    #[test]
    #[should_panic(expected = "unknown or already used payment_ref")]
    fn open_amount_session_cannot_be_reused() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.open_payment_session("turn-1".to_string(), "checkout-1".to_string(), U128(0));
        context("usdc.testnet", 1_000);
        for _ in 0..2 {
            let _ = contract.ft_on_transfer(
                account("customer.testnet"),
                U128(1),
                r#"{"payment_ref":"checkout-1"}"#.to_string(),
            );
        }
    }

    #[test]
    fn payout_is_exact_and_only_callback_success_marks_it_delivered() {
        let mut contract = new_contract();
        create_started_pool(&mut contract);
        context("admin.testnet", 1_000);
        contract.open_payment_session("turn-1".to_string(), "checkout-1".to_string(), U128(11));
        context("usdc.testnet", 1_000);
        let _ = contract.ft_on_transfer(
            account("customer.testnet"),
            U128(11),
            r#"{"payment_ref":"checkout-1"}"#.to_string(),
        );
        context("admin.testnet", 1_000);
        contract.close_collection("turn-1".to_string());
        contract.prepare_distribution("turn-1".to_string());

        let prepared = contract.pool_or_panic("turn-1");
        assert_eq!(
            prepared
                .payouts
                .iter()
                .map(|payout| payout.amount)
                .sum::<u128>(),
            11
        );
        assert_eq!(prepared.payouts[0].amount, 6);
        assert_eq!(prepared.payouts[1].amount, 3);
        assert_eq!(prepared.payouts[2].amount, 2);

        context_with_one_yocto("admin.testnet", 1_000);
        let _ = contract.dispatch_payout("turn-1".to_string(), 0);
        assert!(contract.pool_or_panic("turn-1").payouts[0].in_flight);

        callback_context(PromiseResult::Failed);
        contract.on_payout_result("turn-1".to_string(), 0);
        let failed = contract.pool_or_panic("turn-1");
        assert!(!failed.payouts[0].delivered);
        assert!(!failed.payouts[0].in_flight);
        assert_eq!(failed.balance, 11);

        context_with_one_yocto("admin.testnet", 1_000);
        let _ = contract.dispatch_payout("turn-1".to_string(), 0);
        callback_context(PromiseResult::Successful(vec![]));
        contract.on_payout_result("turn-1".to_string(), 0);
        let paid = contract.pool_or_panic("turn-1");
        assert!(paid.payouts[0].delivered);
        assert_eq!(paid.payouts[0].attempts, 2);
        assert_eq!(paid.balance, 5);
        assert_eq!(paid.total_funded, 11);
    }
}
