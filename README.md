# TipShift

Tips, shared fairly. Customers tip with a QR code. Everyone who checked in to the shift gets paid in USDC, straight to their own NEAR wallet. TipShift never holds the tips.

Built for the NEAR Hackathon. **Testnet only**: no real money moves.

**Live demo:** https://tipshift.pages.dev

## How it works

1. **Set up.** The company owner (whoever names the business) registers the company and its locations. Each location has its own tip pool, created only by the owner and revocable and recreatable by the owner.
2. **Managers join by QR.** The owner picks a 3-letter pseudonym and shows a one-time QR; the manager scans it and signs with their NEAR wallet. That wallet becomes the location's administrator and pays the small network fees. No email or password. A manager can ask the owner for more NEAR from the console and the owner sends it from there. A solo owner running one location needs no second wallet.
3. **Employees join.** Each employee opens a one-time link or QR, enters initials and connects a NEAR wallet. Managers see initials only, never wallets.
4. **Check in.** At the start of a shift the employee scans their group's QR and signs a message (NEP-413). Signing moves no funds.
5. **Tip.** Customers open a public link or QR and pay any amount in USDC into the location's pool. Each link works for one payment.
6. **Dispute.** Until the payout, anyone present can object to the split; the people present vote (more than half must agree); if accepted, the manager proposes a corrected split and the team votes. After the payout the shift is closed and nothing can be disputed.
7. **Close and get paid.** Closing saves the pool balance on the shift (it feeds the receipt), takes the roster from the real check-ins (wallets decrypted server-side, never typed), freezes the split on-chain and pays each person. Groups have a percentage of the tips; people inside a group split equally. The same pool is reused for the next shift. The pool's creator (the owner) keeps control even after handing it to a manager, so funds are never trapped.

Privacy by design: no names, emails, phones or seed phrases are collected from employees or customers. Reports are removed after 30 days; the final distribution stays on-chain.

## Run it

Requirements: Node 22.6+ (the tests use `--experimental-strip-types`) and pnpm 9.

```bash
pnpm install --frozen-lockfile
pnpm check        # typecheck, 46 tests, production build
pnpm dev          # http://127.0.0.1:5173
```

The app talks to a Supabase backend (Edge Function `tipshift-claims`, schema in `supabase/migrations`). To run the full flows locally you need your own Supabase project: apply the migrations, deploy the function and put the **public** values in `.env.local` (see `.env.example`):

```bash
VITE_TIPSHIFT_SUPABASE_URL=
VITE_TIPSHIFT_SUPABASE_ANON_KEY=
```

Without them the app builds and the landing page loads, but the console shows "Configuration required". The simplest way to try every flow is the hosted demo above.

Optional testnet overrides (all public values): `VITE_TIPSHIFT_VAULT_ID`, `VITE_TIPSHIFT_TOKEN_ID`, `VITE_TIPSHIFT_POOL_ID`, `VITE_TIPSHIFT_ADMIN_ID`, `VITE_TIPSHIFT_TESTNET_RPC`.

Server secrets (never in the repo): `TIPSHIFT_ALLOWED_ORIGINS`, `TIPSHIFT_PUBLIC_APP_URL`, `TIPSHIFT_NEP413_RECIPIENT`, `TIPSHIFT_WALLET_COMMITMENT_KEY`, `TIPSHIFT_WALLET_ENCRYPTION_KEY` (32-byte base64 each).

## Try the demo

1. Open https://tipshift.pages.dev. Sign in with **Continue with Meteor** (first click connects, second signs) or **Continue with email**.
2. **Company:** name the company and add a location. **Tips tab:** "Create pool with my wallet" (needs about 0.4 NEAR on that wallet for the pool deposit and fees).
3. **Optional manager:** Company tab, Managers: choose the location, type 3 letters, create the QR. The manager scans it and signs; the pool can then be handed over to their wallet.
4. **Employees:** Team tab, show the join link or QR. Each employee enters initials, connects a wallet and sets up USDC storage (needed to receive a NEP-141 token).
5. **Shift:** Shifts tab, create groups and show each group's QR for check-in.
6. **Customer QR:** Tips tab. Pay with a wallet that holds test USDC (`usdc.fakes.testnet`).
7. **Dispute:** `#/me`, "Dispute this split". Another present employee votes; once accepted the manager proposes a correction and the team votes.
8. **Close and pay:** Tips tab, "Close shift and pay". Then `#/me` shows each employee's receipt and CSV.

## Architecture

| Part | Where |
|---|---|
| Web app (React + Vite, EN/ES, light/dark) | `apps/web/src` |
| Vault contract (Rust, NEAR, NEP-141 receiver) | `contracts/tipshift-vault` |
| Split logic (deterministic, tested) | `src/core` |
| Backend (Supabase Edge Function, Postgres) | `supabase/` |

Payments are `ft_transfer_call` into per-shift pools. The contract rejects a different amount or a reused payment reference. Employee wallets are stored encrypted server-side and never returned to managers. Wallet ownership is proven with a NEP-413 signature, and the server checks that the signing key belongs to the claimed account.

## What is verified

- **Whole flow against production and testnet, with real signatures and transactions** (scripts are not in the repo): company, location, manager QR join, pool created by the owner wallet and handed to the manager, funding request and NEAR transfer, employee registration, check-in, customer payment, close, payout (exact splits, 4/4 delivered), receipt with closing balance and linked transaction, disputes refused after close, second shift on the same pool closed by the owner.
- **Contract:** 33 tests (`cargo test` in `contracts/tipshift-vault`), upgraded in place on testnet.
- **Web:** `pnpm check` (typecheck, 46 tests, build). Contrast audit over every screen in ES/EN and day/night: 0 findings.
- Not automated: real browser wallet popups (Meteor) and password-recovery email delivery; these were checked by hand or not at all.

## Known limits

- Testnet and test USDC only.
- Employees must register USDC storage on their wallet before they can be paid; a payout to an unregistered wallet fails and can be retried for the missing ones only.
- Revoking a pool or a manager unlinks it in the app; it does not move on-chain funds. The pool creator (owner) can still close and pay it.
- A wallet that signed in to the console on its own becomes the owner of its own empty company, so a manager must enter for the first time through the owner's QR.
- Shifts are not closed automatically yet. Dispute votes have no deadline.
- Wallets other than Meteor are offered by the selector but only Meteor was tested end to end.

## Roadmap and business model

**Automatic close.** A shift closes on the server clock and pays out without the manager. The manager only reviews. Today's manual close does not scale to a busy floor.

**Accounts and permissions.** The owner holds the business account (for example `morningcoffee.near`) with one sub-account per location (`north.morningcoffee.near`). The owner delegates payment authority to a location administrator through NEAR access keys, and revokes it with one transaction when a manager changes or leaves.

**Gas, paid by the business.** In the US an employer may not take part of employees' tips, so the business pays the network fee of each payout. Each location keeps a refundable gas deposit (minimum 1 USD in NEAR; more is better) that funds the payouts. It is the business's money, separate from tips, and can be withdrawn if the location closes. When the balance is low, the owner and the administrator see a message on screen to top it up.

**Pricing.** Free for one location. Premium at 1 USDC per month per location: multiple locations, automatic close, cash-out rails and more. Employees always receive 100% of their tips.

**Why owners would adopt it.** Many customers and tourists carry no cash, so cash tips are lost. The evidence is mixed, and we cite it with its limits:

- A 2023 survey of 1,000 hotel guests by Canary Technologies (a vendor of digital tipping tools) found about 60% carry less cash than five years ago, and over 70% of guests who did not tip said they would have if digital tipping were available. [Source](https://hoteltechreport.com/news/canary-digital-tipping-study)
- Industry and survey data report that digital prompts raise tips, for example a Forbes Advisor survey in which nearly 65% of respondents said they tip at least 11% more digitally. [Source](https://www.restaurantdive.com/news/digital-payments-have-increased-restaurant-tips-but-may-be-making-diners-uncomfortable/700441/)
- Peer-reviewed evidence is thinner: a 2026 University of Arkansas thesis (320 participants) found no significant effect of visibility or group settings on tipping. [Source](https://scholarworks.uark.edu/etd/6423)
- Tip size is a noisy signal of service quality: bill size and social norms explain much of it, and studies disagree on the link. [Source](https://news.cornell.edu/node/294601)

We do not claim a specific revenue uplift. We claim a simpler way for people without cash to tip, and a transparent split for the team.

## Repository safety

This repository contains no credentials, seed phrases or private keys. Testnet is deliberately separate from any future production deployment. Design documents: [UX specification](design/UX_SPEC.md) and [state matrix](design/STATE_MATRIX.md).
