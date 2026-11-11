# TipShift — handoff, session 2 (2026-11-11)

Hackathon presentation: **2026-11-14**. Testnet only. No secrets in this file.

## Decisions taken
- Product stays in this repo; `clarialabs.com/tipshift` is the private test
  environment and goes public only before the presentation, with explicit approval.
- Architecture A: deploy TipShift (Vite) separately; ClariaLabs `/tipshift` fronts it
  behind the existing email-gated access. Do not port the frontend to Next.
- Schedule bridge, demo version (option 1): the admin UI only offers
  `start_collection` when the server confirms the turn is active and inside its
  window; the server records the turn's `pool_id`. Not enforced on-chain (the
  contract admin call is signed by the admin wallet in the browser; no server
  key is allowed). Option 2 (window in the contract, new contract) only if time
  allows on the 13th; never modify the contract holding the testnet proof.
- Model: company (organization) -> branches. Company creates the branch
  subaccount; the branch manager gets a full-access key (company keeps its own
  and can revoke). Manager access in the app is a `branch_admin` row tied to email.

## Done this session
- Supabase access verified (project `clarialabs`, ref `bkmwjrbqvgmijzpuuxic`).
  Remote migrations: all 12 present. Local schedule migration renamed to
  `20261111205225_tipshift_turn_schedule.sql` to match remote (nothing re-applied).
- `.env.local` created locally (public URL + anon key). Git-ignored.
- Edge secret `TIPSHIFT_ALLOWED_ORIGINS` now =
  `https://clarialabs.com,http://127.0.0.1:5173,http://127.0.0.1:5174`
  (local dev origins were rejected with `origin_forbidden` before).
- Testnet accounts created: `goodmorningcoffee.testnet` (company) and
  `centro.goodmorningcoffee.testnet` (branch, 3 NEAR). Keys live only in
  `~/.near-credentials/testnet/` on the user's machine.
- Admin authorization row exists: organization_admin, venue
  `d867f096-c65b-4ddd-ac42-055a67cb3ac4`. Branches table: 0 rows.

## OPEN ISSUE (start here)
`http://127.0.0.1:5173/?admin=1` still shows "No active branch is registered" and
"Your private branch access could not be loaded" after the CORS fix and a hard
refresh. Magic-link login works. Next steps:
1. Browser devtools -> Network -> the `tipshift-claims` call: status + body.
2. Confirm the page is served from this repo with `.env.local` loaded (two Vite
   servers ran: 5173 older, 5174 newer; both cwd = this repo). Restart `pnpm dev`
   so Vite reads `.env.local`, then sign in again.
3. If the function returns an error, check the `tipshift_admin_scopes` RPC and the
   JWT audience/claims in `authenticatedAdmin` (`supabase/functions/tipshift-claims/index.ts`).
4. Once scopes load, register branch "Goodmorning Coffee – Centro" from the UI.

## Next steps
1. Fix the open issue; register the branch; create a scheduled turn + private QR links.
2. Create a manager testnet wallet (Meteor) and `near add-key
   centro.goodmorningcoffee.testnet <manager public key>`; fund a customer wallet with test-USDC.
3. Real E2E with Meteor: claim (NEP-413) -> activation inside the window -> checkout -> payout.
4. Schedule bridge (option 1) in Edge Function + admin UI; store the turn's pool_id.
5. Deploy to `clarialabs.com/tipshift` (private); add that URL to Supabase Auth redirect URLs.
6. Backup video, 3–5 min demo script, freeze code the night of the 13th.

## Housekeeping
- Revoke the Supabase personal access token used in this session (it was pasted in chat).
- The ClariaLabs main checkout (`/home/grusso/Claude/clarialabs`) must not be touched.
