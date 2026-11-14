# Submission drafts (NEAR Hackathon). Review, edit, then publish yourself.

Track: `realworld`. Project name: TipShift. Live demo: https://tipshift.pages.dev. Testnet only.

## X post (short, English)
Tips at restaurants and cafés are split in the dark. Not anymore.

TipShift: customers tip with a QR, everyone who checked in to the shift gets paid in USDC straight to their own NEAR wallet. We never hold the money. Anyone present can object to the split and the team votes. Every shift has a report. Managers join with a QR and their own wallet: no email, no password.

Built at NEAR HACKATHON for @NEARProtocol #NEARHackathon
Demo + video: https://tipshift.pages.dev

## X post (versión en español)
Las propinas se reparten a oscuras. Con TipShift, el cliente paga con un QR y todos los que hicieron check-in cobran en USDC directo a su wallet NEAR. Nosotros nunca retenemos el dinero. Si el reparto no convence, el equipo vota. Cada turno deja un reporte. Los gerentes se suman con un QR y su propia wallet: sin email ni contraseña.

Hecho en NEAR HACKATHON, @NEARProtocol #NEARHackathon
https://tipshift.pages.dev

## Form: description (about 1,100 characters, limit 2,000)
TipShift splits restaurant and café tips fairly, on NEAR. Each location has its own tip pool, created by the company owner; a manager joins by scanning a one-time QR and signing with their own wallet (no email or password), and that wallet pays the small network fees. Employees register once with their own wallet (no names, emails or seed phrases are collected, only initials). At the start of a shift each person scans their group's QR and signs a message (NEP-413) to check in; signing moves no funds. Customers open a public link or QR, connect a wallet and tip any amount in USDC; the money goes into the location's pool on a vault smart contract. When the shift closes, the manager's wallet sets the roster to the people who actually checked in, the split is frozen on-chain (group share first, then equal parts per person) and each person is paid directly to their wallet. TipShift never holds the tips. Until the payout, anyone present can object to the split; the people present vote and, if accepted, the manager proposes a correction that the team votes on. The whole history is part of the shift report and a downloadable CSV. The console has a dashboard with active shifts, groups, people present and the live tip pool. Stack: Rust smart contract (NEP-141 USDC), React + Vite, Supabase (Postgres + Edge Function) with wallets sealed server-side, Cloudflare Pages. Testnet only; no real money moves.

## Form fields to fill in yourself
- Repo link (public), post link, project name: TipShift
- Team lead, email, team size, NEAR wallet (for prizes)
- Tracks: realworld

## Demo video, about 2 minutes (shot list)
1. (0:00) One sentence: "Tips are split in the dark. TipShift fixes it."
2. (0:10) Owner console: company, location, "Create pool with my wallet", then a manager QR with a 3-letter pseudonym (the manager signs with their wallet and joins). Create a shift with groups.
3. (0:30) Employee phone: join link, initials, connect wallet, then check-in QR and sign.
4. (0:50) Dashboard: people present and the tip pool going up.
5. (1:00) Customer: open the link, connect wallet, type an amount, pay. Pool balance moves.
6. (1:20) Dispute: an employee objects, the team votes, the manager proposes a correction.
7. (1:40) Close and pay: two confirmations, explorer link showing payouts to each wallet. Show the location wallet card (NEAR for fees).
8. (1:55) Download the report CSV. Closing line: "Fair tips, no custody."
Tip: record the screen on the PC (Meteor works there) and use the phone only as the customer and the employee.
