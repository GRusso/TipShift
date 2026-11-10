# TipShift

TipShift is a bilingual, privacy-preserving system for transparent team tips.
This branch contains the React/Vite demo, the deterministic distribution core,
and a NEAR smart contract tested end-to-end on testnet with a NEP-141 test
token. It is not a production payment product.

## Start here

- [UX specification](design/UX_SPEC.md): roles, language, privacy rules, screen map, and implementation boundaries.
- [State matrix](design/STATE_MATRIX.md): the visible states and the conditions that allow or block each action.
- [Mockup](demo/web-mockup/): a buildless, navigable HTML/CSS/JS reference.
- [Testnet proof](docs/TESTNET_PROOF.md): independently verifiable testnet settlement evidence.

## Local preview

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

The legacy mockup can still be previewed with:

```bash
python3 -m http.server 4173 --directory demo/web-mockup
```

## Testnet checkout

The fifth panel, **Testnet checkout**, is intentionally separate from the
local demo. It reads one configured testnet pool and, only after an explicit
Meteor Wallet confirmation, calls the NEP-141 test token. It uses test-USDC;
it never targets mainnet or real customer funds.

The default configuration points to the isolated presentation pool. To point
the same frontend to a separately provisioned testnet pool, use public Vite
configuration (no secrets) before `pnpm dev` or `pnpm build`:

```bash
VITE_TIPSHIFT_VAULT_ID=your-vault.testnet
VITE_TIPSHIFT_TOKEN_ID=your-token.testnet
VITE_TIPSHIFT_POOL_ID=your-isolated-pool
VITE_TIPSHIFT_ADMIN_ID=branch-admin.testnet
```

The business administrator opens an exact payment session; the customer uses
the resulting opaque reference. The contract rejects a different amount or a
reused reference. A wallet transaction still requires browser-level testing
with Meteor Wallet; compilation and RPC reads alone do not prove it.

## Important boundaries

- Panels 1–4 run the local deterministic core. The separate fifth panel is a
  testnet-only NEP-141 checkout; it does not create a production payment flow,
  recipient claim, signed dispute, or scannable QR.
- Never request a seed phrase, private key, email, employee name, or customer account for these flows.
- Do not present a NEAR Business integration or a production address unless each is actually implemented and verified.
- The public customer QR and each employee's private claim QR are different security contexts; they must never be interchangeable.

## Repository scope

TipShift source stays isolated from Ruta40. This repository contains no credentials, seed phrases, or private keys. Testnet is deliberately separate from any future production deployment.
