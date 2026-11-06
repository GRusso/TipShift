# TipShift UX specification

## Product promise

TipShift lets a customer leave a tip for the employees of one active shift without requiring a TipShift account. The business defines who shares in that shift before it begins. The recipient's receiving wallet is controlled and proven by the recipient, never selected by a branch administrator.

The UI is English by default. Every operational screen must provide an EN/ES switch and day/night control, preserving the current screen state whenever practical.

## Terms

| English | Spanish | Meaning |
| --- | --- | --- |
| Tip allocation | Destinatarios de la propina | The anonymous set of recipient places and their percentages for one shift. |
| Public tip QR | QR público de propinas | Customer-facing entry point for a currently active shift. |
| Private claim QR | QR privado de asociación | One-time private link for exactly one recipient place to prove a receiving wallet. |
| Shift | Turno | A bounded collection and distribution period. |

Do not use “roster” in product-facing UI.

## Roles and authority

| Role | Can do | Must not do |
| --- | --- | --- |
| Branch administrator | Create anonymous recipient places, set percentages, issue claim links, start a prepared shift, display the public QR. | Enter, view, choose, or alter a recipient wallet. |
| Tip recipient / employee | Open their private claim link and prove a receiving wallet for their own place. | Claim another recipient's link or alter locked shifts. |
| Customer | Scan the public QR, choose a tip, inspect the exact output and maximum input, then approve from their own wallet. | Need a TipShift account or see recipients, wallets, allocation, or pool identifiers. |

## Non-negotiable UX and privacy rules

1. A customer QR is public; a recipient QR is private, opaque, short-lived, single-use, and scoped to one recipient place.
2. A recipient QR must not contain a wallet address, employee name, public payment session, pool ID, or allocation details beyond the recipient's own share/context.
3. A public customer QR must not reveal employee names, wallet addresses, percentage splits, or on-chain pool identifiers.
4. Before a shift starts, all recipients must be verified and percentages must total exactly 100%.
5. Starting a shift locks the recipient places and percentages for that shift. Changing either produces a future shift, never a silent edit of the live one.
6. A customer cannot pay when the shift is not started, closed, or the QR/session is expired.
7. Client and employee never provide seed phrases, private keys, personal names, emails, or passwords to TipShift.
8. The product must distinguish a signed intent or submitted transaction from a confirmed payment. Never promise success before the implemented settlement mechanism verifies it.

## Screen map

| Screen | File | User / purpose | Primary next action |
| --- | --- | --- | --- |
| Public landing | `landing.html` | Explain TipShift and its non-custodial posture. | Start a demo or view onboarding. |
| Organization and branch setup | `onboarding.html` | Business setup reference. | Open shift operations. |
| Tip allocation | `roster.html` | Define anonymous recipient places and percentages. | Create recipient claim links. |
| Recipient-link administration | `admin-recipient-links.html` | Issue/inspect a private claim QR per place. | Start-preflight view. |
| Recipient claim | `employee-claim.html` | Recipient proves their own destination. | View recipient tips. |
| Shift start preflight | `shift-launch.html` | Admin checks requirements and locks a shift. | Display the public QR. |
| Public customer QR | `public-tip-qr.html` | Customer entry and safe unavailability states. | Open checkout when active. |
| Checkout | `tip.html` | Customer chooses an amount and reviews a payment request. | Connect/approve with a real adapter in a later implementation. |
| Shift operations | `index.html` | Illustrative live-shift, review, and traceability view. | Observe the state; demo-only objections. |
| Recipient tips | `recipient.html` | Recipient-side history/status view. | View future status or destination-change flow. |

## Implementation handoff

The mockup names user journeys; it is not an API contract. An implementation must introduce server-authoritative state and verify authorization on every transition.

### Recipient claim flow

1. Admin creates a recipient place and percentage.
2. Service issues an opaque, one-time claim token scoped to the organization, branch, upcoming shift, and recipient place.
3. Recipient opens the private link. The UI shows only the branch, shift context, and their assigned share.
4. Recipient connects their wallet and signs a one-time, domain-bound message.
5. Server verifies token validity, message, wallet ownership, expiry, and unused status; it records only the verification required for this place.
6. Admin sees a verification state, not a destination they can operate.

### Customer tip flow

1. Customer scans a public shift QR.
2. Server resolves a short-lived, opaque payment session only if the shift is live.
3. Customer selects an amount and is shown exact intended USDC output plus a maximum input/cost.
4. A real wallet adapter asks the customer to approve. The implementation should label this state as pending until the intended intake is verified.
5. The customer receives a safe receipt or a clear failure/pending message. No error response leaks allocation or wallet data.

### Shift lifecycle

```text
draft → recipients verified + allocation = 100% → live/locked → collection closed → review/distribution
```

The mockup visually covers draft, live, not-started, closed, and expired entry states. Server-side guards—not button visibility—must enforce these rules.

## Visual system

- Brand: dark forest green, soft paper background, lime primary action, restrained mono labels.
- Primary action: lime fill; reserve it for a single safe next step.
- Information hierarchy: status → human explanation → irreversible consequence → action.
- Use direct copy. Examples: “QR needs a refresh”, “This shift has ended”, “Nothing has been charged”.
- Never show a genuine address or a scannable QR until an authenticated, verified production flow exists.

## Out of scope for this design handoff

- Production wallet adapters and wallet-specific UI.
- Actual QR creation, persistence, authentication, signatures, settlement, payouts, refunds, or dispute adjudication.
- NEAR Business integration.
- Advertising inside operational screens.
- A donation address; any public support mechanism requires a separately verified wallet, network, and asset.
