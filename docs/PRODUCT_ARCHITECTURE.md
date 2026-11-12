# TipShift — product architecture (decided 2026-11-11)

Hackathon presentation: **2026-11-14**. Testnet only. This supersedes the single
`?admin=1` screen, which mixes three roles.

## Hierarchy

```
Organization            created once by the owner / master admin
  └─ Branch             created by the master admin (optional address)
       ├─ Branch manager        invited by email by the master admin; revocable
       ├─ Weekly schedule       Monday–Sunday blocks (day, start, end, label)
       ├─ Groups + percentages  persistent templates of the branch
       ├─ Employee enrollment QR  one registration per employee per branch
       ├─ Public customer tip QR  one per branch (separate from enrollment)
       └─ Turns                 concrete dated instances of the schedule
            └─ Tips · distribution · disputes
```

## Roles

| Role | Signs in with | Can | Cannot |
|---|---|---|---|
| Master admin (owner) | Email (magic link) | Create the organization, create branches, invite and revoke managers, read per-branch summaries | See employee wallets |
| Branch manager | Email (invited) | **Own branch only**: weekly schedule, groups, enrollment QR, customer QR, turn and dispute status, dispatch payouts with the branch wallet | See other branches; see employee wallets |
| Employee | NEAR wallet (NEP-413 signature), no email | **Own branch and own data only**: own turns, own share, dispute button for own turn | See co-workers or other branches |

## Decisions

1. **Employee identity = one registration per branch.** The server stores an HMAC
   commitment of the wallet per branch (not per turn), enabling "my turns" and
   disputes. Admins never see wallets. Trade-off accepted: one employee is linkable
   to their own branch (not across branches); never to a name, email or phone.
2. **Manager access = revocable email invitation.** States: invited → active →
   revoked. Revocation takes effect immediately. **Planned (post-hackathon): manager
   sign-in with a NEAR wallet (NEP-413)** alongside email. It is deferred because it
   needs a second auth system for a role that handles money; it will be built, not
   dropped. Say so in the presentation.
3. **Demo scope = realistic cut.** No automatic generation of future weeks, no
   payroll, no historical reporting.
4. **Schedule bridge (demo):** the admin UI only offers `start_collection` when the
   server confirms the turn is active and within its window. Not enforced on-chain.
   The contract holding the testnet proof is never modified.
5. **NEAR model:** company account → branch subaccount; the manager holds a
   revocable full-access key on the branch subaccount.
6. **Demo payout signer = the branch wallet** (`centro.goodmorningcoffee.testnet`).
   The branch account pays the payout gas, so employees receive **100% of the tips**:
   the contract distributes the exact pool balance (proven on testnet: three payouts
   exhaust the pool to zero) and no fee or gas is deducted from it.

## What is reused vs. changed

- Reused: contract, turn/dispute engine, NEP-413 claim, encrypted manifests,
  email authorization, private-schema isolation, org name + branch address.
- Changed: the single admin screen is split into three entries
  (master / branch / employee); schedule and groups become persistent branch
  templates; enrollment moves from per-turn to per-branch.

## Build order

1. Role split: master console (org, branches, invite/revoke manager) and a
   branch-scoped console. Server enforces scope; the UI is not the boundary.
2. Weekly schedule + persistent groups per branch.
3. Per-branch employee enrollment QR (NEP-413) and the employee "my turn" view
   with the dispute button.
4. Schedule bridge + real Meteor E2E on testnet (checkout → payout).
5. Deploy to clarialabs.com/tipshift (private), then public only with approval.
