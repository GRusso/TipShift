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

## Important boundaries

- The web demo runs the local deterministic core; it does not connect a real wallet, generate a scannable QR, request a signature, or move funds.
- Never request a seed phrase, private key, email, employee name, or customer account for these flows.
- Do not present a NEAR Business integration or a production address unless each is actually implemented and verified.
- The public customer QR and each employee's private claim QR are different security contexts; they must never be interchangeable.

## Repository scope

TipShift source stays isolated from Ruta40. This repository contains no credentials, seed phrases, or private keys. Testnet is deliberately separate from any future production deployment.
