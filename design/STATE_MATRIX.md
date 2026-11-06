# TipShift state matrix

This document describes the user-visible behavior required by the mockup. Backend code must treat it as a product contract to implement and test, not as a source of authority.

| Area | Visible state | Entry condition | Allowed action | Customer-safe / privacy requirement |
| --- | --- | --- | --- | --- |
| Recipient place | Needs link | Place exists, no unexpired claim token shared. | Admin creates a private claim link. | Do not show recipient identity or wallet. |
| Recipient place | Awaiting claim | A private token exists and is valid. | Intended recipient opens their private link. | Token is opaque, one-time, expiring, and never reused for customer payment. |
| Recipient place | Verified | Valid recipient proof is recorded for that place. | Admin may include it in preflight. | Admin sees verification, not wallet control. |
| Shift preflight | Blocked | Any recipient unverified or allocation is not exactly 100%. | Resolve only the unmet preparation condition. | Do not offer a public customer QR. |
| Shift preflight | Ready | All recipients verified, allocation exactly 100%, collection window set. | Start and lock the shift. | Explain that recipient places and percentages lock. |
| Shift | Live / locked | Ready shift was started successfully. | Display or resolve a public tip QR. | No recipient, wallet, allocation, or pool data is public. |
| Public QR | Active | QR/session is valid and its shift is live. | Enter customer checkout. | Require no TipShift account. |
| Public QR | Not started | QR resolves to a prepared but not live shift. | No payment action. | Say no wallet opens and no charge happened. |
| Public QR | Shift closed | QR resolves to a closed shift. | No payment action. | Do not roll a tip to a later shift. |
| Public QR | Expired | Token/session expired or cannot be safely reused. | Ask for the current display QR. | No payment action, no reconnection requirement, no internal identifiers. |
| Checkout | Amount selection | Active payment session. | Pick a predefined or positive custom amount. | Show customer that a TipShift account is not needed. |
| Checkout | Review | Valid positive amount. | Inspect exact output and maximum input; request wallet approval. | Never show recipients or allocation. |
| Checkout | Pending | Wallet intent/transaction submitted but final intake unverified. | Wait, inspect a safe reference, retry only if idempotency allows. | Do not call this a completed tip. |
| Checkout | Confirmed | Implemented settlement/intake verifier confirms exact expected amount. | Show receipt. | Receipt must not expose recipient wallets or allocation. |
| Checkout | Failed / rejected | User rejects, route fails, session expires, or verifier fails. | Return to safe retry path where valid. | Say whether nothing was charged only when the implementation can prove it. |

## Minimum implementation checks

1. Recipient percentage arithmetic uses an exact representation and rejects totals other than 100%.
2. Claim tokens are opaque, scoped, single-use, time-limited, and invalidated after a successful claim.
3. The same claim token cannot attach a second wallet or recipient place.
4. Shift start rejects any unverified recipient and prevents draft mutation afterward.
5. Public payment-session resolution rejects non-live, expired, mismatched, or reused sessions.
6. Customer error responses have no employee names, wallet addresses, allocation, pool IDs, or stack traces.
7. Wallet signature, payment intent, submitted transaction, and confirmed intake are separately modeled and rendered.
8. A retry cannot create a duplicate credited tip.

## Copy guardrails

- Use “demo” in the static mockup and never represent its interactions as a real payment.
- Use “pending” after a wallet action until a real verifier confirms funds.
- Prefer specific, recoverable guidance: “Ask the team for the current display QR.”
- Avoid phrases that imply custody, employee identity verification, or a NEAR Business connection.
