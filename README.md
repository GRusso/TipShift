# TipShift

Tips, shared fairly. Customers tip with a QR code. Everyone who checked in to the shift gets paid in USDC, straight to their own NEAR wallet. TipShift never holds the tips.

Built for the NEAR Hackathon. **Testnet only**: no real money moves.

**Live demo:** https://tipshift.pages.dev

## How it works

1. **Set up.** A business registers its company and locations and invites a manager per location.
2. **Join.** Each employee opens a one-time link or QR, enters their initials and connects a NEAR wallet. The manager sees initials only, never wallets.
3. **Check in.** At the start of a shift the employee scans their group's QR and signs a message (NEP-413). Signing moves no funds.
4. **Tip.** Customers open a public link or QR, connect a wallet and pay any amount they like in USDC. Each link works for one payment and goes into the shift's pool on the vault contract. The console has a Dashboard with active shifts, groups, people present and the live tip pool.
5. **Dispute.** Anyone who was present can object to the split. The people present vote (more than half must agree). If it is accepted, the manager proposes a corrected split and the team votes on it. The whole history is part of the shift report and its CSV.
6. **Get paid.** The shift closes, the manager's wallet sets the on-chain roster to the people who actually checked in (wallets are decrypted server-side, never typed by hand), the split is frozen on-chain and each person is paid. Groups have a percentage of the tips; people inside a group split equally; a group with nobody present gets nothing.

Privacy by design: no names, emails, phones or seed phrases are collected from employees or customers. Reports are removed after 30 days; the final distribution stays on-chain.

## Run it

Requirements: Node 22.6+ (the tests use `--experimental-strip-types`) and pnpm 9.

```bash
pnpm install --frozen-lockfile
pnpm check        # typecheck, 40 tests, production build
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

1. Open https://tipshift.pages.dev with a NEAR testnet wallet (Meteor, MyNearWallet, HERE or Nightly).
2. **Manager console:** `#/console`. Create an account with email and password, name the company, add a location.
3. **Join link:** Console, Team tab. Open the link, enter initials, connect the wallet, then "Set up USDC" (NEP-145 storage deposit, needed to receive a NEP-141 token).
4. **Shift:** Console, Shifts tab. Create a shift with groups and scan each group's QR to check in.
5. **Customer QR:** Console, Customer QR tab. Scan it or open the link, pay with a wallet that holds test USDC (`usdc.fakes.testnet`).
6. **Dispute:** `#/me`, "Dispute this split" on a shift you checked in to. Another present employee votes in `#/me`; once accepted, the manager proposes a corrected split in Console, Reports, and the team votes on it.
7. **Close and pay:** Console, Customer QR tab, "Close shift and pay". This demo uses the fixed demonstration pool (one-shot).
8. **My shifts:** `#/me`. Sign with your wallet to see what you earned and download a CSV (it includes the dispute history).

## Architecture

| Part | Where |
|---|---|
| Web app (React + Vite, EN/ES, light/dark) | `apps/web/src` |
| Vault contract (Rust, NEAR, NEP-141 receiver) | `contracts/tipshift-vault` |
| Split logic (deterministic, tested) | `src/core` |
| Backend (Supabase Edge Function, Postgres) | `supabase/` |

Payments are `ft_transfer_call` into per-shift pools. The contract rejects a different amount or a reused payment reference. Employee wallets are stored encrypted server-side and never returned to managers. Wallet ownership is proven with a NEP-413 signature, and the server checks that the signing key belongs to the claimed account.

## What is verified

- **Contract, on testnet:** a full shift of 10 USDC split 4.0 / 3.5 / 2.5, plus recovery from a partial payout (one wallet not registered for USDC, then retry pays only the missing one). Transactions and accounts are in [docs/E2E_TESTNET.md](docs/E2E_TESTNET.md) and [docs/TESTNET_PROOF.md](docs/TESTNET_PROOF.md).
- **Backend, against production:** 24 checks covering registration, check-in (including full group and wrong group), initials-only views, reports, hiding, replay protection and deletion.
- **Unit tests:** `pnpm test:core` (40 tests: vault, roles, split, claims, manifest).

## Known limits

- Testnet and test USDC only.
- The console's close-and-pay button uses a fixed demonstration pool with a fixed team. Per-shift pools created by a server key are not built yet.
- Shifts are not closed automatically yet.
- Dispute votes and corrections live in the shift report only, not on-chain. The console's demo payout still pays the fixed demonstration pool, so an approved correction changes the report and CSV but not that demo transaction.
- Browser wallet popups are tested by hand on the hosted demo, not by automated tests.

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
