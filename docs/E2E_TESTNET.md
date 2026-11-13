# End-to-end run on NEAR testnet (2026-11-12)

Test-only run with fresh accounts and the same vault contract code (`contracts/tipshift-vault`),
deployed to `tsx-vault-1112.testnet`. Token: `usdc.fakes.testnet`. No real funds.

| Role | Account |
|---|---|
| Contract owner | `tsx-owner-1112.testnet` |
| Location administrator | `tsx-admin-1112.testnet` |
| Customer | `tsx-cust-1112.testnet` |
| Employees | `tsx-emp1-1112`, `tsx-emp2-1112`, `tsx-emp3-1112`, `tsx-emp4-1112` (`.testnet`) |

## Run 1: full shift, 10 USDC split 40 / 35 / 25
Pool `e2e-1`: create, start collection, open exact payment session, customer `ft_transfer_call`
(10 USDC), then the same action sequence the console button sends: one transaction with
`close_collection` + `prepare_distribution`, then one `dispatch_payout` per employee.
Result: pool `distributed`, balance 0; employees received 4.0, 3.5 and 2.5 USDC.
[close + prepare in one transaction (pool `e2e-2`)](https://explorer.testnet.near.org/transactions/6m9Gy9xJpwqMNW4yJ3Tk7qNChAhuuLA3BWKiKuEZB9mD)
[close + prepare (pool `e2e-1`)](https://explorer.testnet.near.org/transactions/AxqepGhATDgshB3FbtYG7bjchduhRbaq9mw7oewrM59Q)

## Run 2: partial payout and recovery
Pool `e2e-2`, two employees, 4 USDC. `tsx-emp4` had not registered with the USDC token, so its
transfer failed while the other employee was paid: the pool stayed `paying` with 1 of 2 payouts
delivered and 2 USDC still held. After registering the wallet, retrying every payout index paid the
missing one and rejected the already-delivered one, ending in `distributed`.
The employee registration page now offers a one-time "Register wallet for USDC" step to prevent this.

## Not covered by this run
Browser wallet popups (Meteor and others), the Supabase check-in and report services with real
signatures, and the live QR flows. Those need a signed-in manager session.
