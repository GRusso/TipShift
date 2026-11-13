# Handoff, session 4 (2026-11-12 night). No secrets in this file.

**Real deadline** (nearhackathon.com): development ends **2026-11-14 23:59 UTC**; judging 16-18 Nov.
Submission = PUBLIC repo + README that Claude Code/Codex can run + X post with demo video
(mention "built at NEAR HACKATHON", tag @NEARProtocol and #NEARHackathon) + the form
(repo link, post link, wallet, description 20-2000 chars). Testnet only.

Branch `codex/tipshift-functional-mvp`, pushed (HEAD 15f0ad2). Supersedes HANDOFF_SESSION_3 where they differ.

## Done this session
- New UI: landing, company/locations console, employee registration, check-in, employee view `#/me`,
  customer payment page, reports (CSV, delete, 30-day retention), EN/ES, day/night, 7:1 contrast.
- Multi-wallet chooser (Meteor, MyNearWallet, HERE, Nightly) via wallet-selector modal; "Use another wallet" on `#/me`.
- Console > Customer QR > "Demo cierre de turno": close_collection + prepare_distribution in one
  transaction, then dispatch_payout per employee; retry only the missing ones after a partial failure.
  Uses the fixed demonstration pool (`web-live-20261110`, 3 fixed employees); one-shot.
- Employee registration offers "Register wallet for USDC" (NEP-145 storage_deposit): a NEP-141 token
  only delivers to registered accounts; an unregistered payee makes that payout fail (retryable).
- Migrations 070000 (group check-in) and 080000 (reports) and the `tipshift-claims` function are deployed to production.
- **Production bug fixed:** Edge secrets TIPSHIFT_WALLET_COMMITMENT_KEY / TIPSHIFT_WALLET_ENCRYPTION_KEY
  were not valid 32-byte base64, so every employee registration/check-in/report failed. Replaced with
  fresh keys (copy kept outside git by the owner machine). Do NOT rotate again once real employees exist.

## Verified
- On-chain e2e on testnet with fresh accounts and the same contract (see `docs/E2E_TESTNET.md`):
  full split 10 USDC -> 4.0/3.5/2.5, and partial-payout recovery.
- Backend e2e against production with a throw-away manager and org (deleted afterwards): 24/24 checks
  (registration, check-in incl. full / other_group, initials-only views, reports, hide, replay, delete).

## NOT verified (do tomorrow with a real browser wallet)
1. Wallet popups for every flow: registration, check-in, `#/me`, customer payment, manager session payment.
2. **callbackUrl risk:** the browser passes `callbackUrl` to `signMessage`; the server verifies the NEP-413
   payload without it. If a wallet includes it in the signed payload, verification fails. Fix idea: send the
   callbackUrl to the server or stop passing it.
3. The console button's two wallet confirmations with Meteor (`signAndSendTransactions` batch).
4. Console tabs visually while signed in; CSV download in the browser.

## Still to build / do
- Public deployment (clarialabs.com/tipshift or other host): Vite `base`, TIPSHIFT_ALLOWED_ORIGINS and the
  Supabase redirect allow-list; remove loopback origins; the server-built check-in link uses its configured public URL.
- README that works for an automated reviewer (install, env, run, tests, demo steps), public repo, secrets scan.
- Demo video, X post, submission form. Mention roadmap: disputes, per-shift pools with a server key,
  automatic shift close, NEAR-wallet login for managers, persistent groups.
- Not built: automatic close on server clock, per-shift pool creation (owner-only create_pool), distribution_tx
  link stored in the database, disputes (button disabled).

## Test tooling (local only, recreate if lost)
- Testnet accounts `tsx-*-1112.testnet` (owner, vault, admin, cust, emp1-4); keys in ~/.near-credentials/testnet.
  Customer holds test USDC (`usdc.fakes.testnet` mint works once the account is registered).
- Production e2e used a throw-away manager inserted by SQL via the Supabase Management API and signed
  NEP-413 messages from the test accounts; always delete the rows afterwards.
