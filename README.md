# 💸 Stakes

Two-person daily goal tracker with a rollover dollar pot. One shared "space",
one goal each, one configurable daily stake (default $10).

**Live app:** https://stakes-tracker-5843-ed4bb.web.app

## The rules

- You both miss your goals → the pot grows by the stake.
- You both hit your goals → the pot carries over unchanged.
- One hits, one misses → the one who missed owes the whole pot + that day's
  stake, and the pot resets to zero.
- Unmarked days count as missed once the grace period ends — you can mark
  or fix *yesterday* until midnight tonight; older days are locked.
- Debts accumulate into a balance. Settling is two-step: the debtor taps
  "I paid", the other confirms. The app only keeps score — no real money.

## Install on iPhone (both phones)

1. Open the live URL in **Safari**.
2. First phone: **Create a new space** — enter both names, goals, and the
   stake. Then Settings → **Copy code** and text it to your partner.
3. Second phone: **Join with a code** → paste → pick who you are.
4. On each phone: tap **Share** → **Add to Home Screen** → **Add**.
   It launches fullscreen like a native app.

## Development

- `node --test tests/ledger.test.js` — ledger unit tests (Node 18+).
- `python3 -m http.server 8080 --directory public` — local dev server.
- `firebase deploy` — deploy hosting + Firestore rules.

No build step, no dependencies. `public/ledger.js` is pure and holds all the
money math; `store.js` is the Firestore layer; `app.js` is the UI.
