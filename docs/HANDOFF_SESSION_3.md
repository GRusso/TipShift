# TipShift — handoff for the next session (written 2026-11-12, early morning)

Presentation: **2026-11-14**. Only one full working day remains (the 13th). Testnet only.
No secrets in this file. Read this first, then `docs/PRODUCT_ARCHITECTURE.md`.

> `docs/HANDOFF_SESSION_2.md` is superseded by this file.

## 1. NEW REQUIREMENTS stated by the product owner (not built yet)

1. **The shift closes automatically, on a server clock — never by the manager.**
   If the branch loses power or the manager's device dies, the shift must still end
   on time. Needs a server-side scheduler (pg_cron in Supabase, or a scheduled Edge
   Function) that moves turns through their states using the database/server time.
2. **Distribution is among everyone who logged in with the QR, computed when the
   shift ends.** There are **no "cupos" / slots**. Scanning the QR and signing with
   the wallet *is* the verification of participation in that shift.
   - Today's model is the opposite: slots are pre-declared, every slot must be
     verified before collection can start, and the roster is fixed at that moment.
     This must be removed/reworked (no pre-declared slots, no "all must verify").
3. Late employees can still check in while the shift is open (the claim window
   already runs until the shift end — done this session).

## 2. THE BIG DESIGN RISK to decide first thing tomorrow

`contracts/tipshift-vault/src/lib.rs`:
- `create_pool(pool_id, admin_id, roster, storage_credit)` is **owner-only** and takes
  the **full roster at creation**; the roster can only change later through
  `submit_corrected_distribution` (the dispute/correction flow).
- `allocate_payouts(roster, balance)` splits the exact balance at `prepare_distribution`.
- Customer tips are paid into the pool during the shift (`open_payment_session` →
  `ft_transfer_call`), so the pool must exist **before** the roster is known.

Therefore "roster = who checked in, decided at shift end" is **not supported by the
deployed contract**. Options (pick one in the first 30 minutes):

| Option | What | Cost / risk |
|---|---|---|
| A. New contract version | Add `set_roster(pool_id, roster)` allowed in `Collecting`/before `Distributable`. Deploy to a **new** testnet account; keep the current contract (it holds the proof). | Rust change + redeploy + repeat the E2E proof. Cleanest, ~half a day. |
| B. Reuse the correction flow | Create the pool at shift start with a placeholder roster, then at close call `submit_corrected_distribution` with the real one. | No contract change, but it drags in the dispute/review state machine and a vote. Likely awkward. |
| C. Off-chain accumulation | Server keeps the tips of the shift; the pool is created at shift end with the final roster and funded then. | Customers would pay somewhere else first; weakens the "funds are in the contract" story. |
| D. Demo shortcut | Keep slots for the demo but auto-close on a server clock and skip unverified slots by re-creating the pool. | Fastest but does not meet requirement 2. |

My recommendation: **A** if the morning allows it, otherwise present **D** honestly as
"roster freeze at close is on the roadmap" — decide with the product owner.

## 3. Open questions for the product owner

- Check-in model: **one shared QR per shift/branch** (since there are no slots) or one
  QR per employee? With a shared QR, how does the employee's **group** get decided
  (employee picks it, or the manager pre-assigns)?
- Percentages **inside** a group: equal split among those present? (There are no
  per-slot percentages any more.) Group shares stay as branch-level templates.
- If nobody checks in to a group, where does that group's share go (redistribute to the
  other groups, or hold)?
- Earlier decision still valid? "One registration per branch" for identity (so
  "my shifts" and disputes work) + a per-shift check-in. Confirm they are compatible.

## 4. State of the system (what exists and works)

- Repo: `/home/grusso/Claude/TipShift`, branch `codex/tipshift-functional-mvp`,
  all work pushed. 33 tests pass, build OK.
- Supabase project `bkmwjrbqvgmijzpuuxic` (name "clarialabs", shared with ClariaLabs).
  Migrations applied this session (all in `supabase/migrations`, all registered):
  `…020000 organizations`, `…030000 manager invitations`, `…031000 fix set_organization`,
  `…013000 branches service grants`, `…040000 branch schedule`, `…050000 claims until
  shift end`. Local and remote histories are aligned.
- Edge Function `tipshift-claims` (verify_jwt=false; admin routes validate the JWT via
  the service client). Actions: claims (open/start/complete), `admin_scopes`,
  `admin_set_organization`, `admin_register_branch`, `admin_invite_manager`,
  `admin_revoke_manager`, `admin_manager_invitations`, `admin_branch_schedule`,
  `admin_set_branch_schedule`, `admin_create_turn`, `admin_turn_status`, `admin_start_turn`.
- Data: organization **Good Morning Coffee**; branches **Centro** and **Norte**; Norte's
  manager invited (manager-email, status active, isolation verified in a real
  browser: sees only Norte). The owner is `organization_admin`.
- UI (`apps/web/src/admin.tsx`): Organization console (org name, branches, manager
  invite/revoke) and Branch console (weekly Monday–Sunday schedule; shift creation from
  a schedule block; groups/slots; private QR codes persisted in the browser until the
  shift ends). Day/night theme. Dev server: `pnpm dev` → `http://127.0.0.1:5173/?admin=1`.
- NEAR testnet: `goodmorningcoffee.testnet` (company), `centro.…` and `norte.goodmorningcoffee.testnet`
  (branch accounts, 3 NEAR each). Keys only in `~/.near-credentials/testnet/`.
  Vault contract with the verifiable proof: see `docs/TESTNET_PROOF.md` (do not modify).
- Payout signer in the demo = the **branch wallet** (it pays the gas, so employees get
  100% of the tips).

## 5. Pending work, in priority order for the 13th

1. Decide the contract question (section 2) and the open questions (section 3).
2. Server-side automatic lifecycle: state transitions on server time
   (claiming → collecting at start, collecting → closed at end), no manager action.
3. Remove slots / "all must verify"; roster = checked-in wallets; check-in QR flow.
4. Employee view: "my shift" + the **dispute** button for their own shift.
5. Persistent **groups** per branch (managers should not redo them every shift).
6. Real E2E with Meteor on testnet: check-in → tips → close → payout. Needs test-USDC
   and a customer wallet; the branch wallet signs payouts (add the manager key with
   `near add-key`).
7. Deploy to `clarialabs.com/tipshift` (private). Then: add that origin to
   `TIPSHIFT_ALLOWED_ORIGINS` and its URL to the Supabase Auth redirect allow-list.
8. Backup video, 3–5 min demo script, freeze the code the night of the 13th.

## 6. Known issues and decisions to remember

- **Login by e-mail link is fragile**: one-time links get consumed (double click / mail
  scanners) and every new request cancels the previous one. During development a fresh
  link was generated server-side and opened in Brave. Planned: 6-digit e-mail code (needs
  the shared project's e-mail template) and **NEAR wallet login for managers (roadmap,
  must be stated in the presentation)**.
- A browser lost its local session once while the server session was still valid; the
  login screen now shows "Last session event on this browser" to diagnose it. Check
  Brave's "clear site data on exit" setting.
- A user has **one** authorization → a manager manages **one** branch (enough for 2 branches).
- Sign-ups are closed on the Supabase instance; managers are created by invitation.
- QR codes live only in the issuing browser (the server stores only SHA-256 hashes).
- The employee check-in window now runs until the shift end; the old rule (close at
  start) is gone.

## 7. Changes made to SHARED production configuration (review before going public)

- Edge secret `TIPSHIFT_ALLOWED_ORIGINS` = `https://clarialabs.com`, `http://127.0.0.1:5173`,
  `http://127.0.0.1:5174` → **remove the loopback origins before the public launch**.
- Supabase Auth redirect allow-list: added `http://127.0.0.1:5173/**` → remove before public.
- Database grants/migrations listed above live in the ClariaLabs project.

## 8. Security housekeeping

- **Revoke the Supabase personal access token** that was pasted in the chat
  (https://supabase.com/dashboard/account/tokens). It is not stored in any file.
  A new session needs a new token (or `supabase login` in a real terminal).
- Never put the service-role key, wallet keys, or generated sign-in links in the repo or chat.
- Public (client) QR ≠ private employee check-in link. Admins never see employee wallets.
