# Handoff, session 7 (2026-11-14). No secrets in this file. Supersedes HANDOFF_SESSION_6.

**Deadline:** 2026-11-14 20:59 Argentina (23:59 UTC). Judging 16-18 Nov.

## Live state
- App https://tipshift.pages.dev (Cloudflare Pages `tipshift`). Backend Supabase `thqhcdxyydrznftuigly`, Edge Function `tipshift-claims` deployed. Migrations through `20261114050000_tipshift_manager_wallets.sql`. Apply SQL with the Management API if `supabase db push` times out (IPv6); the migrations were applied that way and are not recorded in the CLI history table.
- Vault `tsx-vault-1112.testnet` (owner `tsx-owner-1112`), 33 contract tests. Added this session: self-service `create_pool` (non-owner callers must be the admin), `reopen_pool`, `set_pool_admin`, and a creator map (separate storage prefix `o`) so the pool creator keeps admin rights after a hand-over; `PoolSummary.creator_id`.
- Production data was cleaned: only the user's three real accounts remain (`owner-account`, `manager-account`, `smoothtest.testnet@wallet...`) with their 2 companies / 4 locations. Test pools on the vault (`e2e-*`, `tsp-*`, `selfsvc-test-1`, `co-*`) remain on-chain but are not linked to anything.

## Architecture changes this session
- **One pool per location** (`branches.pool_id`). Only the company owner (role `organization_admin`) links, revokes or recreates it. The location wallet card (NEAR for fees, storage reserve) is shown to owner and location admin only, with the connected account and role in an identity bar.
- **Managers join by QR** (no email): owner creates a 3-letter pseudonym + one-time capability; the manager signs NEP-413; server creates a wallet user (`app_metadata.wallet`, synthetic email `<account>@wallet.tipshift.pages.dev`) and a `branch_admin` authorization, returns a magic-link token hash so the browser signs in. Actions: `admin_create_manager_invite`, `manager_join_start/complete`, `admin_branch_manager`, `manager_request_funds`, `admin_clear_funding`. The old email invitation actions still exist but are not in the UI.
- **Funding**: manager requests NEAR (amount stored on the invitation); owner sends it with a wallet transfer and clears the request.
- **Close freeze**: `tipshift_admin_close_turn` saves `closing_balance` and `closed_at` before payout (receipt uses it, deleted with the report at 30 days), refuses to close with an accepted/correcting dispute, rejects leftover votes, links `distribution_tx` afterwards. Disputes are refused once closed.
- **Wallet sign-in** (`wallet_login_start/complete`): Meteor or any NEP-413 wallet. `buffer@6` lacks `base64url`; use `nonceBuffer()` in `apps/web/src/near.ts`, never `Buffer.from(x, 'base64url')` in browser code.
- Password reset form, ES/EN error translations (`useErrorText`), contrast fixes (7:1 audit clean).

## Verified (scripts live only in the session scratchpad)
Full organic run against production + testnet with real signatures: manager QR join, pool created by the owner wallet and handed to the manager, funding request and transfer, 4 employee registrations and check-ins, customer payment, close, payout 4/4 with exact splits, receipt with closing balance and tx link, dispute refused after close, second shift on the same pool closed by the owner wallet. Mock-browser render of console (owner and manager, ES/EN) and the manager join screen (ES/EN, day/night).

## Not verified
Real Meteor popups for join / create pool / recharge / close; password-recovery email delivery (Supabase rejects example.com); wallets other than Meteor.

## Known limits
Revoking a pool or manager does not move on-chain funds. A wallet that logged in alone owns an empty company, so managers must first enter via the owner's QR. `set_pool_admin` has a UI only as "hand the pool to the manager". No automatic close; dispute votes have no deadline.

## Before the demo
Create the location pool once from the app with `smoothtest.testnet` (needs about 0.4 NEAR) and make sure test USDC and USDC storage exist on the wallets used. Submission items (video, X post, form, public repo) are in `~/Claude/TipShift - Soporte/SUBMISSION_DRAFTS.md` (outside the repo).

## Operating notes
Tokens in `~/.config/tipshift/`. Deploy web: `pnpm check`, copy `dist` outside the repo, `npx wrangler pages deploy . --project-name tipshift --branch main --commit-dirty=true`. Functions: `npx supabase functions deploy tipshift-claims --remote=thqhcdxyydrznftuigly --yes`. Contract: `cargo near build non-reproducible-wasm` then `near deploy tsx-vault-1112.testnet target/near/tipshift_vault.wasm --force`.
