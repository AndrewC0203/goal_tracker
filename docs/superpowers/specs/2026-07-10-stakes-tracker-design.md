# Stakes — Couple's Daily Goal Tracker (Design)

**Date:** 2026-07-10
**Status:** Approved

## Purpose

A two-person daily goal tracker with a rollover dollar "punishment" pot. Andrew
tracks a protein goal; his girlfriend tracks limiting sugary drinks. The app
keeps score in dollars but never touches real money. Installable to the iPhone
home screen as a PWA — no App Store, no cost.

## Core Mechanic (the ledger)

All state derives from an append-only history of **day records** and **events**.
Nothing is stored that can drift (pot and balance are always recomputed from
history at read time).

- **Day record:** `{ date, personA: done|missed|null, personB: done|missed|null }`
  keyed by local calendar date.
- **Stake:** configurable dollar amount (default $10), stored in settings.
  Changing it affects future days only; past days use the stake in effect when
  they were finalized (each finalized day snapshots the stake).
- **Rules per finalized day:**
  - Both fail → pot += stake.
  - Both succeed → pot carries unchanged.
  - Split (one done, one missed) → loser owes winner `pot + stake`; a payout
    event is recorded and the pot resets to 0. (If pot was 0, loser owes just
    that day's stake.)
- **Grace period:** a day can be marked or changed until midnight of the
  following day (i.e., yesterday is editable today; two days ago is locked).
- **Lazy finalization:** any past-grace day with a `null` mark counts as
  `missed` in the computation. No cron/server job — the ledger is derived
  whenever the app reads history.

## Settle-Up (two-step confirmation)

- Payouts accumulate into one net **balance** (e.g., "Sarah owes Andrew $85").
- The debtor taps **"I paid"** → creates a *pending* settle event.
- The creditor sees **"Confirm you received $85?"** and approves → balance
  zeroes (a confirmed settle event is appended).
- Either side can cancel a pending settle.
- Full payout/settle history is kept and shown.

## Screens (single-page app, 3 tabs)

1. **Today** — your goal text, a big "Done ✓" button, partner's status today,
   current pot, and — if still inside the grace window — yesterday's row
   ("Forgot yesterday? Mark it").
2. **History** — list of past days with ✓/✗ per person, payout and settle
   events inline, current streaks.
3. **Settings** — names, each person's goal text, stake amount, balance and
   the settle-up flow.

**First run:** enter (or create) a shared space code, then pick who you are.
Both choices persist in `localStorage`.

## Architecture

- **Frontend:** plain HTML/CSS/JS single-page app. No framework. Firebase JS
  SDK bundled with a single esbuild command (or ES module imports).
- **Backend:** Firestore (Firebase free Spark tier).
  - `spaces/{spaceId}` — settings doc (names, goals, stake, timezone).
  - `spaces/{spaceId}/days/{date}` — day records.
  - `spaces/{spaceId}/events/{id}` — payout and settle events.
- **Sync:** Firestore real-time listeners; both phones update live.
- **Offline:** Firestore local persistence caches data; app opens instantly
  and syncs when back online. Service worker caches the app shell.
- **Security:** no accounts. The `spaceId` is a long unguessable random ID;
  Firestore rules allow access only via full document paths (no collection
  listing). Appropriate for $10 stakes between two people.
- **Identity:** each phone stores "I am person A/B" in `localStorage`.

## PWA / iPhone Install

- `manifest.json` — standalone display, theme color, icons.
- `apple-mobile-web-app-capable` + apple-touch-icon meta tags.
- Minimal service worker for offline app shell.
- Hosted on Firebase Hosting (free, HTTPS). Install via Safari → Share →
  **Add to Home Screen**; launches fullscreen with an icon.

## Timezones & Edge Cases

- Days keyed by the local calendar date; the space stores a single timezone
  setting so both phones agree on day boundaries.
- Marking is idempotent and last-write-wins within the grace window; after
  grace, the UI disallows edits and the ledger ignores late writes.
- Changing the stake mid-pot: pot already accumulated is unchanged; future
  both-fail days add the new stake.

## Testing

- The ledger math (pot accumulation, payouts, grace, lazy finalization,
  stake snapshots, settle events) lives in one **pure module** with unit tests.
- Canonical test case: stake $10, both fail days 1–5, day 6 Andrew done /
  partner missed → partner owes $60 and pot resets.
- UI verified by hand on both iPhones after deploy.

## Out of Scope

- Real payments, notifications/reminders, more than two people, multiple
  goals per person, App Store distribution.
