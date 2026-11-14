# Handoff, session 6 (2026-11-13 to 14). No secrets in this file. Supersedes HANDOFF_SESSION_5.

**Deadline:** development ends **2026-11-14 23:59 UTC = 20:59 Argentina (UTC-3), today, not "tomorrow"**. Judging 16-18 Nov.

## Live state
- App https://tipshift.pages.dev (Cloudflare Pages `tipshift`). Backend Supabase `thqhcdxyydrznftuigly`, 26 migrations (last `20261114010000_tipshift_turn_roster.sql`), Edge Function `tipshift-claims` redeployed with `admin_turn_roster`.
- Loopback origin REMOVED from `TIPSHIFT_ALLOWED_ORIGINS` and Auth `uri_allow_list` (only pages.dev now), so local dev no longer reaches the backend.
- Web build uses `apps/web/.env.local` overrides: vault `tsx-vault-1112.testnet`, pool `live-1115`, admin `smoothtest.testnet` (user's own Meteor test account). Backup of the old env: `apps/web/.env.local.bak-before-pool` (git-ignored).
- Old pool `web-live-20261110` on the old vault is abandoned (admin key `v2.tipshift-owner-20261105-r8k4.testnet` is lost; nobody can close it). Do not use it.
- Vault contract `tsx-vault-1112.testnet` (owner `tsx-owner-1112`, key in ~/.near-credentials) now has: open-amount sessions (`expected_amount` 0 = any positive tip, single use) and `set_roster(pool_id, roster)` (pool admin, before prepare). 23 contract tests pass. Test pools: `pc-demo-1` (distributed), `live-1115` (collecting, admin smoothtest).
- Branch `codex/tipshift-functional-mvp` pushed; last commit `a7b5647`.

## What changed this session
Console: opens on Dashboard (active shifts, groups, people present, live tip pool, refresh 10 s) or Company for a brand-new owner; schedule autosaves (no save button); "Create QR" connects the wallet itself, starts collection if the pool is draft, has Copy link/Open under the QR; amount optional (empty = customer chooses). Customer page: input for the amount when link has `amount=open`. `#/me` shows live pool total. Fixed `Buffer is not defined` (shim). **Payout roster now comes from real check-ins**: console close calls `admin_turn_roster` (server decrypts wallets, AAD scope `branch:<branchRef>`), splits like the report (group share, then equal parts) and sends `set_roster` + close + prepare in one tx. If nobody signed in: "no hay a quién pagar".
Verified by me: `pnpm check` (45 tests), contract tests, deno check, CLI payment+payout on pool pc-demo-1 (user paid 1-2 USDC from Meteor on the PC), 401 on the new action without a session.

## NOT verified (needs the user's wallets), do these first
1. Full console on live site: company, location, schedule, shift with groups.
2. Employee join link, wallet registration, check-in with signature, `#/me`, USDC storage registration (needed to receive payouts).
3. Customer pays any amount (worked: 1 USDC), then close from the console with Meteor: payout must reach the wallets of the people who checked in (new code path, never run).
4. A full dispute (object, vote, correction proposal, vote, CSV).
Caveat: the console finds shifts in this browser's localStorage; create and close in the same browser.

## Pending / TODO
- Test accounts: `smoothtest.testnet` has ~1-3 test USDC (`usdc.fakes.testnet`, storage registered); `tsx-cust-1112` ~1 USDC left; owner `tsx-owner-1112` ~2 NEAR. Fund more if needed.
- Drafts ready in `docs/SUBMISSION_DRAFTS.md`: X post EN/ES, form description, video shot list. Human fills repo link, post link, team, wallet, email.
- Video (~2 min), X post, form: human, today before 20:59 ART.
- Make the repo public (secrets scan was clean; the passwords file was deleted from the repo root, a copy lives in `~/Claude/TipShift - Soporte`).
- Keep the demo up indefinitely (user decision: product demo for Claria).
- ClariaLabs `/tipshift` page (repo `~/Claude/clarialabs`, branch `feat/tipshift-pitch`, commit `7ce826d`, pushed, NOT published): infographic + mockups + button to the app; app URL is one constant `APP_URL`. `main` has no /tipshift and `dev` is 17 commits ahead of origin with unrelated private web work; production = `main`. User decided: only mockups + infographic + link; publishing is their call.
- Known limits: dispute votes have no deadline; an approved correction changes report/CSV; the Dashboard pool total is the single configured pool, not per shift; a free-text note about Meteor mobile not detecting the wallet (user uses the PC).

## Operating notes (still valid from session 5)
Tokens in `~/.config/tipshift/`. Deploy web: `pnpm check`, copy `dist` to a folder outside the repo (use the session scratchpad), `npx wrangler pages deploy . --project-name tipshift --branch main` from it. Supabase: `npx supabase ... --remote --yes`. Prod writes were blocked by the permission classifier until the user explicitly said go ahead; ask once, then do it.
