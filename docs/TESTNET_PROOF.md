# Testnet proof

This is a test-only settlement using `usdc.fakes.testnet` (6 decimals). It is
not a production payment, a NEAR Business integration, or a claim about
mainnet readiness.

## Contract

- Contract: `vault.tipshift-owner-20261105-r8k4.testnet`
- Final code deployment: [J3CEt2Ng1MHXMBUfvxhpjpjrts5MrV4PL6aAejquPvVg](https://explorer.testnet.near.org/transactions/J3CEt2Ng1MHXMBUfvxhpjpjrts5MrV4PL6aAejquPvVg)
- Accepted token: `usdc.fakes.testnet`

## End-to-end run

Pool `e2e-20261108-a` was created with three anonymous recipient references
and shares 40%, 35%, and 25%.

1. [Create pool](https://explorer.testnet.near.org/transactions/EMziSm5iqm9hQszC3rvPGruw1wd7uwaqUz7b8AzkZmAH)
2. [Start collection](https://explorer.testnet.near.org/transactions/CAG38DZmx2AFmxzB9wJRdQiLo7q2QHwPypgPLzkataQF)
3. [Open exact payment session](https://explorer.testnet.near.org/transactions/FgcuaKfEzag7CVEm1NUcRsZFseGHGKPWweUSewW3ZtQi)
4. [Customer NEP-141 `ft_transfer_call`](https://explorer.testnet.near.org/transactions/53s8svMUJkSrDbuDHaiEDnrD7tEBXejyv8TNnF9Rssxk) for `5,000,000` atomic units (= 5 USDC.e).
5. [Close collection](https://explorer.testnet.near.org/transactions/64rJ5r86pFeQRYCpbkuAaQgKpv1vvaQZ6YGC4q32dmYH) and [prepare distribution](https://explorer.testnet.near.org/transactions/6Mq52ktSy4APV4Jhf5U6DjhNNgjmF7K8nZtnvF6sZ3iL).
6. Administrator-dispatched payouts with contract callbacks:
   - [2,000,000](https://explorer.testnet.near.org/transactions/AFhLBFgyRKP7fKJKpTsSfNPmAqDCPdp5dcQrvPa1PX7R)
   - [1,750,000](https://explorer.testnet.near.org/transactions/D6TJGLTxyjHsjvrAuHuaGLqF3DWqSDtveFzQNNfEzL3w)
   - [1,250,000](https://explorer.testnet.near.org/transactions/59CJuUo9VCWe7z5eUwPpAYxuv5HKwEDX4xStFUNZhMff)

The final on-chain pool summary was `distributed`, with `balance: 0`,
`total_funded: 5,000,000`, and `delivered_payout_count: 3`.

## Guarantees demonstrated

- The customer pays the intake transaction gas.
- The location administrator pays payout transaction gas.
- A NEP-141 callback, not the request alone, marks a payout delivered.
- The three payments exactly exhaust the isolated pool.
