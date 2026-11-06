# TipShift

TipShift is a bilingual UX/UI prototype for transparent, non-custodial team tips.
It is a design handoff for implementation, not a deployed payment product.

## Start here

- [UX specification](design/UX_SPEC.md): roles, language, privacy rules, screen map, and implementation boundaries.
- [State matrix](design/STATE_MATRIX.md): the visible states and the conditions that allow or block each action.
- [Mockup](demo/web-mockup/): a buildless, navigable HTML/CSS/JS reference.

## Local preview

```bash
python3 -m http.server 4173 --directory demo/web-mockup
```

Open `http://127.0.0.1:4173/landing.html`.

## Important boundaries

- Demo controls do not persist data, create a QR, connect a wallet, request a signature, or move funds.
- Never request a seed phrase, private key, email, employee name, or customer account for these flows.
- Do not present a NEAR Business integration, a production address, or a successful settlement unless each is actually implemented and verified.
- The public customer QR and each employee's private claim QR are different security contexts; they must never be interchangeable.

## Repository scope

This repository deliberately contains the product design and mockup only. Contract code, testnet credentials, payment adapters, and any unrelated Ruta40 material do not belong here.
