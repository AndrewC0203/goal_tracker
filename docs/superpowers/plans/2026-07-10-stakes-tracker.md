# Stakes Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A two-person daily goal tracker PWA with a rollover dollar pot, synced between two iPhones via Firestore, installable via Add to Home Screen.

**Architecture:** Static single-page app (plain HTML/CSS/JS ES modules, no build step) on Firebase Hosting. All shared state lives in Firestore under an unguessable `spaces/{spaceId}` path with real-time listeners. All money math is derived at read time by a pure `ledger.js` module from day records + events — nothing stored can drift.

**Tech Stack:** Vanilla JS (ES modules), Firebase JS SDK 10.12.2 via gstatic CDN imports, Firestore + Firebase Hosting (free Spark tier), `node --test` for unit tests.

## Global Constraints

- No frameworks, no bundler, no `package.json` dependencies. Plain ES modules only.
- Firebase SDK loaded from `https://www.gstatic.com/firebasejs/10.12.2/` CDN URLs.
- `public/ledger.js` must stay pure: no imports, no DOM, no Firebase, no `Date.now()` (callers pass `today`).
- Dates are strings `YYYY-MM-DD`. Person keys are `'a'` and `'b'`. Statuses are `'done' | 'missed' | 'pending'`.
- Balance sign convention everywhere: **positive = person B owes person A**.
- Tests run with `node --test tests/` (Node 18+, no test framework).
- Free tier only. No paid services, no App Store.
- Commit after every task with the commit message given in the task. End every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

```
public/
  index.html      — markup for onboarding + 3 tabs + tab bar
  style.css       — mobile-first dark theme
  ledger.js       — pure ledger math (dates, pot, payouts, settles, streaks)
  store.js        — Firestore init, reads/writes, real-time subscription
  app.js          — UI wiring: onboarding, rendering, event handlers
  config.js       — Firebase web config (filled in Task 4)
  manifest.json   — PWA manifest
  sw.js           — service worker (network-first shell cache)
  icons/          — icon.svg + generated PNGs (512/192/180)
tests/
  ledger.test.js  — unit tests for ledger.js
firebase.json     — hosting + rules config
firestore.rules   — security rules
.firebaserc       — project alias (created in Task 4)
README.md         — setup + install instructions (Task 8)
```

---

### Task 1: Ledger core — dates, pot, payouts, balance

**Files:**
- Create: `public/ledger.js`
- Create: `tests/ledger.test.js`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `addDays(dateStr: string, n: number): string`
  - `todayInTz(tz: string, now?: Date): string`
  - `isEditable(dateStr: string, today: string): boolean` — true if `dateStr` is `today` or yesterday
  - `computeLedger({ days, events, defaultStake, startDate, today })` returning `{ rows, pot, balance, pendingSettle, streaks }`
    - `days`: `{ 'YYYY-MM-DD': { a?: 'done'|'missed', b?: 'done'|'missed' } }`
    - `events`: array (ignored in this task except being accepted; Task 2 adds behavior)
    - `rows`: chronological `[{ date, a, b, stake, pot, payout }]` where `a`/`b` are `'done'|'missed'|'pending'`, `pot` is the pot AFTER that day, `payout` is `{ debtor: 'a'|'b', amount: number } | null`
    - In this task `pendingSettle` is always `null` and `streaks` is `{ a: 0, b: 0 }` (Task 2 implements both).

**Ledger rules (from the spec):**
- Iterate every date from `startDate` through `today` inclusive.
- A date is **locked** when `date < addDays(today, -1)`. Locked + unmarked → `'missed'`. Unlocked + unmarked → `'pending'`.
- If either person is `'pending'`: the day has no effect on pot/balance yet.
- Both `'missed'` → `pot += stake`. Both `'done'` → pot unchanged. Split → loser owes `pot + stake`, recorded as that row's `payout`, added to `balance` (signed: debtor `'b'` → `+amount`, debtor `'a'` → `-amount`), pot resets to 0.

- [ ] **Step 1: Write the failing tests**

Create `tests/ledger.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todayInTz, isEditable, computeLedger } from '../public/ledger.js';

const base = { events: [], defaultStake: 10, startDate: '2026-07-01' };

test('addDays crosses month boundaries', () => {
  assert.equal(addDays('2026-06-30', 1), '2026-07-01');
  assert.equal(addDays('2026-07-01', -1), '2026-06-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('todayInTz formats YYYY-MM-DD in the given timezone', () => {
  const now = new Date('2026-07-10T03:00:00Z'); // still July 9 in LA
  assert.equal(todayInTz('America/Los_Angeles', now), '2026-07-09');
  assert.equal(todayInTz('UTC', now), '2026-07-10');
});

test('isEditable allows only today and yesterday', () => {
  assert.equal(isEditable('2026-07-10', '2026-07-10'), true);
  assert.equal(isEditable('2026-07-09', '2026-07-10'), true);
  assert.equal(isEditable('2026-07-08', '2026-07-10'), false);
  assert.equal(isEditable('2026-07-11', '2026-07-10'), false);
});

test('canonical: 5 both-fail days then a split pays $60', () => {
  const days = {};
  for (let i = 1; i <= 5; i++) days[`2026-07-0${i}`] = { a: 'missed', b: 'missed' };
  days['2026-07-06'] = { a: 'done', b: 'missed' };
  const led = computeLedger({ ...base, days, today: '2026-07-08' });
  const payoutRow = led.rows.find(r => r.payout);
  assert.equal(payoutRow.date, '2026-07-06');
  assert.deepEqual(payoutRow.payout, { debtor: 'b', amount: 60 });
  assert.equal(led.pot, 0);
  assert.equal(led.balance, 60);
});

test('both succeeding carries the pot unchanged', () => {
  const days = {
    '2026-07-01': { a: 'missed', b: 'missed' },
    '2026-07-02': { a: 'done', b: 'done' },
  };
  const led = computeLedger({ ...base, days, today: '2026-07-02' });
  assert.equal(led.pot, 10);
  assert.equal(led.balance, 0);
});

test('locked unmarked days count as missed', () => {
  // today 07-04: 07-01 and 07-02 are locked and unmarked => both-missed twice
  const led = computeLedger({ ...base, days: {}, today: '2026-07-04' });
  assert.equal(led.pot, 20);
});

test('today and yesterday unmarked stay pending with no pot effect', () => {
  const led = computeLedger({ ...base, days: {}, today: '2026-07-02' });
  assert.equal(led.pot, 0);
  assert.deepEqual(led.rows.map(r => r.a), ['pending', 'pending']);
});

test('half-marked unlocked day is pending and has no effect', () => {
  const days = { '2026-07-01': { a: 'done' } };
  const led = computeLedger({ ...base, days, today: '2026-07-01' });
  assert.equal(led.rows[0].a, 'done');
  assert.equal(led.rows[0].b, 'pending');
  assert.equal(led.rows[0].payout, null);
  assert.equal(led.balance, 0);
});

test('split with empty pot owes just the stake', () => {
  const days = { '2026-07-01': { a: 'missed', b: 'done' } };
  const led = computeLedger({ ...base, days, today: '2026-07-01' });
  assert.deepEqual(led.rows[0].payout, { debtor: 'a', amount: 10 });
  assert.equal(led.balance, -10);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/`
Expected: FAIL — cannot find module `../public/ledger.js`.

- [ ] **Step 3: Implement `public/ledger.js`**

```js
// Pure ledger math. No imports, no DOM, no Firebase, no Date.now().
// Dates are 'YYYY-MM-DD' strings. Persons are 'a' and 'b'.
// Balance sign convention: positive = b owes a.

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function todayInTz(tz, now = new Date()) {
  // en-CA locale formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function isEditable(dateStr, today) {
  return dateStr === today || dateStr === addDays(today, -1);
}

function stakeFor(date, stakeChanges, defaultStake) {
  let stake = defaultStake;
  for (const ev of stakeChanges) {
    if (ev.effectiveDate <= date) stake = ev.amount;
  }
  return stake;
}

export function computeLedger({ days, events, defaultStake, startDate, today }) {
  const stakeChanges = events
    .filter(e => e.type === 'stakeChange')
    .sort((x, y) => (x.effectiveDate < y.effectiveDate ? -1 : 1));
  const lockedBefore = addDays(today, -1);
  let pot = 0;
  let balance = 0;
  const rows = [];
  for (let date = startDate; date <= today; date = addDays(date, 1)) {
    const locked = date < lockedBefore;
    const rec = days[date] || {};
    const a = rec.a || (locked ? 'missed' : 'pending');
    const b = rec.b || (locked ? 'missed' : 'pending');
    const stake = stakeFor(date, stakeChanges, defaultStake);
    let payout = null;
    if (a !== 'pending' && b !== 'pending') {
      if (a === 'missed' && b === 'missed') {
        pot += stake;
      } else if (a !== b) {
        const debtor = a === 'missed' ? 'a' : 'b';
        const amount = pot + stake;
        balance += debtor === 'b' ? amount : -amount;
        payout = { debtor, amount };
        pot = 0;
      }
    }
    rows.push({ date, a, b, stake, pot, payout });
  }
  return { rows, pot, balance, pendingSettle: null, streaks: { a: 0, b: 0 } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add public/ledger.js tests/ledger.test.js
git commit -m "feat: pure ledger core — pot, payouts, balance, grace"
```

---

### Task 2: Ledger extras — stake changes, settles, streaks

**Files:**
- Modify: `public/ledger.js`
- Modify: `tests/ledger.test.js`

**Interfaces:**
- Consumes: Task 1's `computeLedger`.
- Produces (added behavior, same signature):
  - `events` items now honored:
    - `{ type: 'stakeChange', amount: number, effectiveDate: 'YYYY-MM-DD' }` — the stake for any date is the latest change with `effectiveDate <= date`, else `defaultStake`.
    - `{ id?, type: 'settle', status: 'pending'|'confirmed'|'cancelled', amount: number, debtor: 'a'|'b' }` — confirmed settles adjust balance (debtor `'b'` → `-amount`, debtor `'a'` → `+amount`); pending/cancelled do not.
  - `pendingSettle`: the first event with `type === 'settle' && status === 'pending'`, else `null`.
  - `streaks`: `{ a, b }` — consecutive `'done'` days counted backward from the latest row, skipping `'pending'` rows, stopping at the first `'missed'`.

Note: `stakeFor` and the `stakeChanges` sort already exist from Task 1 — this task adds settle handling and streaks, plus tests proving stake changes work end to end.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ledger.test.js`:

```js
test('stake change applies from its effective date', () => {
  const days = {
    '2026-07-01': { a: 'missed', b: 'missed' }, // stake 10
    '2026-07-02': { a: 'missed', b: 'missed' }, // stake 25
  };
  const events = [{ type: 'stakeChange', amount: 25, effectiveDate: '2026-07-02' }];
  const led = computeLedger({ ...base, days, events, today: '2026-07-02' });
  assert.equal(led.pot, 35);
  assert.equal(led.rows[0].stake, 10);
  assert.equal(led.rows[1].stake, 25);
});

test('confirmed settle zeroes the balance; pending and cancelled do not', () => {
  const days = { '2026-07-01': { a: 'done', b: 'missed' } };
  const settle = { type: 'settle', status: 'pending', amount: 10, debtor: 'b' };
  let led = computeLedger({ ...base, days, events: [settle], today: '2026-07-01' });
  assert.equal(led.balance, 10);
  assert.equal(led.pendingSettle.amount, 10);
  led = computeLedger({ ...base, days, events: [{ ...settle, status: 'confirmed' }], today: '2026-07-01' });
  assert.equal(led.balance, 0);
  assert.equal(led.pendingSettle, null);
  led = computeLedger({ ...base, days, events: [{ ...settle, status: 'cancelled' }], today: '2026-07-01' });
  assert.equal(led.balance, 10);
  assert.equal(led.pendingSettle, null);
});

test('streaks count consecutive done days, skipping pending', () => {
  const days = {
    '2026-07-01': { a: 'done', b: 'missed' },
    '2026-07-02': { a: 'done', b: 'done' },
    '2026-07-03': { a: 'done' }, // yesterday: b unmarked => pending, skipped
  };
  const led = computeLedger({ ...base, days, today: '2026-07-04' });
  assert.equal(led.streaks.a, 3);
  assert.equal(led.streaks.b, 1);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test tests/`
Expected: the settle test fails (balance not adjusted, `pendingSettle` null-handling wrong) and the streaks test fails (`streaks.a` is 0). The stake-change test may already pass — that's fine; it locks in Task 1 behavior.

- [ ] **Step 3: Implement in `public/ledger.js`**

Replace the final `return` line of `computeLedger` and add `computeStreaks`:

```js
  for (const ev of events) {
    if (ev.type === 'settle' && ev.status === 'confirmed') {
      balance += ev.debtor === 'b' ? -ev.amount : ev.amount;
    }
  }
  const pendingSettle =
    events.find(e => e.type === 'settle' && e.status === 'pending') || null;
  return { rows, pot, balance, pendingSettle, streaks: computeStreaks(rows) };
}

function computeStreaks(rows) {
  const streak = who => {
    let n = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const s = rows[i][who];
      if (s === 'pending') continue;
      if (s === 'done') n++;
      else break;
    }
    return n;
  };
  return { a: streak('a'), b: streak('b') };
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `node --test tests/`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add public/ledger.js tests/ledger.test.js
git commit -m "feat: ledger stake changes, settle events, streaks"
```

---

### Task 3: Static shell — HTML, CSS, manifest, icons, service worker

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/manifest.json`
- Create: `public/sw.js`
- Create: `public/icons/icon.svg` (plus generated `icon-512.png`, `icon-192.png`, `icon-180.png`)

**Interfaces:**
- Consumes: nothing.
- Produces: DOM element IDs that `app.js` (Tasks 5–7) relies on: `#onboarding`, `#ob-choice`, `#ob-create-btn`, `#ob-join-btn`, `#ob-create-form`, `#ob-join-form`, `#ob-join-error`, `#ob-who`, `#ob-who-a`, `#ob-who-b`, `#app`, `#tab-today`, `#tab-history`, `#tab-settings`, `#tabbar` (buttons carry `data-tab="today|history|settings"`). CSS classes: `hidden`, `card`, `big`, `secondary`, `chip` (+ `done`/`missed`/`pending`), `mark`, `done-btn`, `missed-btn`, `active`, `pot`, `owes`, `hrow`, `payout`, `muted`, `error`, `code`.

- [ ] **Step 1: Create `public/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Stakes</title>
  <meta name="theme-color" content="#101014">
  <link rel="manifest" href="manifest.json">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Stakes">
  <link rel="apple-touch-icon" href="icons/icon-180.png">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="onboarding" class="screen hidden">
    <h1>💸 Stakes</h1>
    <div id="ob-choice">
      <button id="ob-create-btn" class="big">Create a new space</button>
      <button id="ob-join-btn" class="big secondary">Join with a code</button>
    </div>
    <form id="ob-create-form" class="hidden">
      <label>Your name <input name="nameA" required></label>
      <label>Your goal <input name="goalA" placeholder="Hit protein goal" required></label>
      <label>Partner's name <input name="nameB" required></label>
      <label>Partner's goal <input name="goalB" placeholder="No sugary drinks" required></label>
      <label>Daily stake ($) <input name="stake" type="number" min="1" value="10" required></label>
      <button type="submit" class="big">Create</button>
    </form>
    <form id="ob-join-form" class="hidden">
      <label>Space code <input name="code" autocapitalize="off" autocorrect="off" required></label>
      <button type="submit" class="big">Join</button>
      <p id="ob-join-error" class="error hidden">Space not found — check the code.</p>
    </form>
    <div id="ob-who" class="hidden">
      <h2>Who are you?</h2>
      <button id="ob-who-a" class="big"></button>
      <button id="ob-who-b" class="big"></button>
    </div>
  </div>

  <main id="app" class="hidden">
    <section id="tab-today" class="tab"></section>
    <section id="tab-history" class="tab hidden"></section>
    <section id="tab-settings" class="tab hidden"></section>
  </main>
  <nav id="tabbar" class="hidden">
    <button data-tab="today" class="active">Today</button>
    <button data-tab="history">History</button>
    <button data-tab="settings">Settings</button>
  </nav>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/style.css`**

```css
:root {
  --bg: #101014; --card: #1b1b22; --line: #26262e;
  --text: #f0f0f5; --muted: #8a8a99;
  --green: #34c759; --red: #ff453a; --accent: #0a84ff;
}
* { box-sizing: border-box; margin: 0; }
body {
  background: var(--bg); color: var(--text);
  font-family: -apple-system, system-ui, sans-serif;
  min-height: 100dvh;
  padding-bottom: calc(64px + env(safe-area-inset-bottom));
  -webkit-tap-highlight-color: transparent;
}
.hidden { display: none !important; }
.screen, .tab { padding: 24px 16px; max-width: 480px; margin: 0 auto; }
h1 { font-size: 1.6rem; margin-bottom: 16px; }
h2 { font-size: 1.1rem; margin-bottom: 8px; }
h3 { font-size: 0.95rem; color: var(--muted); margin-bottom: 8px; }
p { margin: 8px 0; }
button {
  font: inherit; border: 0; border-radius: 12px; cursor: pointer;
  background: var(--accent); color: #fff; padding: 10px 16px;
}
button.big { display: block; width: 100%; padding: 16px; font-size: 1.1rem; margin: 12px 0; }
button.secondary { background: var(--card); color: var(--text); }
label { display: block; margin: 12px 0; color: var(--muted); font-size: 0.95rem; }
input {
  display: block; width: 100%; margin-top: 4px; padding: 12px;
  font: inherit; color: var(--text); background: var(--card);
  border: 1px solid var(--line); border-radius: 10px;
}
.card { background: var(--card); border-radius: 16px; padding: 16px; margin: 12px 0; }
.pot { text-align: center; font-size: 1.05rem; color: var(--muted); margin: 8px 0 16px; }
.pot strong { color: var(--text); font-size: 1.5rem; }
.owes { color: var(--accent); margin-top: 4px; }
.mark { display: flex; gap: 12px; margin-top: 12px; }
.mark button { flex: 1; padding: 16px; background: #2a2a33; color: var(--muted); font-size: 1.05rem; }
.done-btn.active { background: var(--green); color: #fff; }
.missed-btn.active { background: var(--red); color: #fff; }
.chip {
  display: inline-block; padding: 4px 10px; border-radius: 999px;
  font-size: 0.9rem; background: #2a2a33; color: var(--muted);
}
.chip.done { background: rgba(52, 199, 89, 0.15); color: var(--green); }
.chip.missed { background: rgba(255, 69, 58, 0.15); color: var(--red); }
.hrow {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 0.95rem;
}
.payout { color: var(--accent); font-size: 0.9rem; padding: 6px 0; }
.muted { color: var(--muted); }
.error { color: var(--red); }
.code { font-family: ui-monospace, monospace; word-break: break-all; user-select: all; }
#tabbar {
  position: fixed; bottom: 0; left: 0; right: 0; display: flex;
  background: var(--card); border-top: 1px solid var(--line);
  padding-bottom: env(safe-area-inset-bottom);
}
#tabbar button { flex: 1; background: none; color: var(--muted); padding: 14px 0; border-radius: 0; }
#tabbar button.active { color: var(--accent); }
```

- [ ] **Step 3: Create `public/manifest.json`**

```json
{
  "name": "Stakes",
  "short_name": "Stakes",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#101014",
  "theme_color": "#101014",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 4: Create `public/sw.js`**

Network-first for same-origin GETs, falling back to cache offline (so deploys show up immediately but the app still opens offline):

```js
const CACHE = 'stakes-v1';
const ASSETS = ['./', './index.html', './style.css', './app.js', './store.js',
  './ledger.js', './config.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
```

Note: `app.js`, `store.js`, `config.js` don't exist yet — `cache.addAll` would reject, but the fetch handler still works and install retries on next load. They arrive in Tasks 4–5; nothing to do here.

- [ ] **Step 5: Create the icon**

Create `public/icons/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#101014"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#34c759" stroke-width="26"/>
  <text x="256" y="334" font-size="220" font-weight="700" fill="#34c759"
        text-anchor="middle" font-family="Helvetica, Arial">$</text>
</svg>
```

Generate PNGs (macOS built-ins, no installs):

```bash
qlmanage -t -s 512 -o public/icons public/icons/icon.svg
mv public/icons/icon.svg.png public/icons/icon-512.png
sips -Z 192 public/icons/icon-512.png --out public/icons/icon-192.png
sips -Z 180 public/icons/icon-512.png --out public/icons/icon-180.png
```

If `qlmanage` produces no file, fallback: open `icon.svg` in a browser, screenshot, crop to square — any 512×512 PNG works.

- [ ] **Step 6: Verify the shell renders**

```bash
python3 -m http.server 8080 --directory public &
curl -s http://localhost:8080/ | head -5
```

Expected: HTML doctype + head. Then open `http://localhost:8080` in a browser: dark page renders (onboarding and app are both hidden until `app.js` exists — no console 404s for css/manifest/icons). Kill the server after.

- [ ] **Step 7: Commit**

```bash
git add public
git commit -m "feat: static PWA shell — markup, styles, manifest, icons, service worker"
```

---

### Task 4: Firebase project, config, rules, first deploy

⚠️ **NEEDS HUMAN:** `firebase login` opens a browser for the user's Google account. Pause and ask the user to complete login if not already authenticated.

**Files:**
- Create: `public/config.js`
- Create: `firebase.json`
- Create: `firestore.rules`
- Create: `.firebaserc`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `config.js` exporting `firebaseConfig` (consumed by `store.js` in Task 5); a live Firestore database + Hosting site.

- [ ] **Step 1: Create config files**

`firestore.rules` — anyone with the unguessable spaceId can use that space; the `spaces` collection itself is not listable (no `list` rule on it):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /spaces/{spaceId} {
      allow get, create, update: if true;
      match /days/{day} {
        allow read, write: if true;
      }
      match /events/{event} {
        allow read, write: if true;
      }
    }
  }
}
```

`firebase.json`:

```json
{
  "hosting": {
    "public": "public",
    "ignore": ["firebase.json", "**/.*"]
  },
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

`.gitignore`:

```
.DS_Store
.firebase/
firebase-debug.log
```

- [ ] **Step 2: Install CLI and log in (HUMAN)**

```bash
firebase --version || npm install -g firebase-tools
firebase login   # opens browser — user completes Google login
```

- [ ] **Step 3: Create project, web app, and Firestore database**

```bash
firebase projects:create stakes-tracker-$RANDOM
# note the printed project id, use it below as PROJECT_ID
firebase apps:create web stakes --project PROJECT_ID
firebase apps:sdkconfig web --project PROJECT_ID
firebase firestore:databases:create "(default)" --location=nam5 --project PROJECT_ID
```

Write `.firebaserc`:

```json
{ "projects": { "default": "PROJECT_ID" } }
```

If `firestore:databases:create` errors, fallback: have the user visit `https://console.firebase.google.com/project/PROJECT_ID/firestore` → Create database → production mode → any US location.

- [ ] **Step 4: Create `public/config.js`** from the `apps:sdkconfig` output:

```js
// Values from: firebase apps:sdkconfig web
export const firebaseConfig = {
  apiKey: "<from sdkconfig>",
  authDomain: "<from sdkconfig>",
  projectId: "<from sdkconfig>",
  storageBucket: "<from sdkconfig>",
  messagingSenderId: "<from sdkconfig>",
  appId: "<from sdkconfig>",
};
```

(These values are public client identifiers, safe to commit — access control is the Firestore rules.)

- [ ] **Step 5: Deploy and verify**

```bash
firebase deploy
curl -s https://PROJECT_ID.web.app/ | head -5
```

Expected: deploy succeeds printing a Hosting URL; curl returns the shell HTML.

- [ ] **Step 6: Commit**

```bash
git add firebase.json firestore.rules .firebaserc .gitignore public/config.js
git commit -m "feat: Firebase project config, security rules, first deploy"
```

---

### Task 5: store.js + onboarding flow

**Files:**
- Create: `public/store.js`
- Create: `public/app.js`

**Interfaces:**
- Consumes: `firebaseConfig` from `config.js`; `todayInTz`, `addDays`, `computeLedger` from `ledger.js`; DOM IDs from Task 3.
- Produces (`store.js`, used by Tasks 6–7):
  - `createSpace(settings): Promise<spaceId>` — settings: `{ nameA, goalA, nameB, goalB, stake, timezone, startDate }`
  - `getSpace(spaceId): Promise<settings|null>`
  - `subscribe(spaceId, onChange)` — `onChange({ settings, days, events })` fires on every remote/local change; `events` items include their Firestore `id`, sorted by `createdAt`
  - `markDay(spaceId, date, who, status): Promise` — merge-writes `{ [who]: status }` into `days/{date}`
  - `addEvent(spaceId, event): Promise` — adds `createdAt` ISO timestamp
  - `updateEvent(spaceId, id, patch): Promise`
  - `updateSettings(spaceId, patch): Promise` — merge into the space doc
- Produces (`app.js` structure, extended by Tasks 6–7): module-level `state = { spaceId, who, settings, days, events }`; helpers `$`, `esc`, `WHO_OTHER`, `ledger()`; stub functions `renderToday()`, `renderHistory()`, `renderSettings()` that Tasks 6–7 replace.

- [ ] **Step 1: Create `public/store.js`**

```js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache,
  doc, collection, getDoc, setDoc, addDoc, updateDoc, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

function randomId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // no lookalikes
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), b => chars[b % chars.length]).join('');
}

export async function createSpace(settings) {
  const spaceId = randomId();
  await setDoc(doc(db, 'spaces', spaceId), settings);
  return spaceId;
}

export async function getSpace(spaceId) {
  const snap = await getDoc(doc(db, 'spaces', spaceId));
  return snap.exists() ? snap.data() : null;
}

export function subscribe(spaceId, onChange) {
  const state = { settings: null, days: {}, events: [] };
  const emit = () => { if (state.settings) onChange({ ...state }); };
  onSnapshot(doc(db, 'spaces', spaceId), s => {
    state.settings = s.data() || null;
    emit();
  });
  onSnapshot(collection(db, 'spaces', spaceId, 'days'), s => {
    state.days = {};
    s.forEach(d => { state.days[d.id] = d.data(); });
    emit();
  });
  onSnapshot(collection(db, 'spaces', spaceId, 'events'), s => {
    state.events = [];
    s.forEach(d => state.events.push({ id: d.id, ...d.data() }));
    state.events.sort((x, y) => ((x.createdAt || '') < (y.createdAt || '') ? -1 : 1));
    emit();
  });
}

export function markDay(spaceId, date, who, status) {
  return setDoc(doc(db, 'spaces', spaceId, 'days', date), { [who]: status }, { merge: true });
}

export function addEvent(spaceId, event) {
  return addDoc(collection(db, 'spaces', spaceId, 'events'),
    { ...event, createdAt: new Date().toISOString() });
}

export function updateEvent(spaceId, id, patch) {
  return updateDoc(doc(db, 'spaces', spaceId, 'events', id), patch);
}

export function updateSettings(spaceId, patch) {
  return setDoc(doc(db, 'spaces', spaceId), patch, { merge: true });
}
```

- [ ] **Step 2: Create `public/app.js`** (onboarding + skeleton; render stubs filled in Tasks 6–7)

```js
import { computeLedger, todayInTz, addDays } from './ledger.js';
import * as store from './store.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WHO_OTHER = w => (w === 'a' ? 'b' : 'a');

const state = {
  spaceId: localStorage.getItem('stakes.spaceId'),
  who: localStorage.getItem('stakes.who'),
  settings: null,
  days: {},
  events: [],
};

// ---------- onboarding ----------

function showOnboarding() {
  $('#onboarding').classList.remove('hidden');
  $('#ob-create-btn').onclick = () => {
    $('#ob-choice').classList.add('hidden');
    $('#ob-create-form').classList.remove('hidden');
  };
  $('#ob-join-btn').onclick = () => {
    $('#ob-choice').classList.add('hidden');
    $('#ob-join-form').classList.remove('hidden');
  };
  $('#ob-create-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const settings = {
      nameA: f.get('nameA'), goalA: f.get('goalA'),
      nameB: f.get('nameB'), goalB: f.get('goalB'),
      stake: Number(f.get('stake')), timezone,
      startDate: todayInTz(timezone),
    };
    state.spaceId = await store.createSpace(settings);
    localStorage.setItem('stakes.spaceId', state.spaceId);
    pickWho(settings);
  };
  $('#ob-join-form').onsubmit = async e => {
    e.preventDefault();
    const code = new FormData(e.target).get('code').trim();
    const settings = await store.getSpace(code);
    if (!settings) {
      $('#ob-join-error').classList.remove('hidden');
      return;
    }
    state.spaceId = code;
    localStorage.setItem('stakes.spaceId', code);
    pickWho(settings);
  };
}

function pickWho(settings) {
  $('#ob-choice').classList.add('hidden');
  $('#ob-create-form').classList.add('hidden');
  $('#ob-join-form').classList.add('hidden');
  $('#ob-who').classList.remove('hidden');
  $('#ob-who-a').textContent = `I'm ${settings.nameA}`;
  $('#ob-who-b').textContent = `I'm ${settings.nameB}`;
  const choose = who => {
    state.who = who;
    localStorage.setItem('stakes.who', who);
    start();
  };
  $('#ob-who-a').onclick = () => choose('a');
  $('#ob-who-b').onclick = () => choose('b');
}

// ---------- app ----------

function start() {
  $('#onboarding').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#tabbar').classList.remove('hidden');
  store.subscribe(state.spaceId, snap => {
    Object.assign(state, snap);
    render();
  });
}

function ledger() {
  const today = todayInTz(state.settings.timezone);
  return {
    today,
    ...computeLedger({
      days: state.days,
      events: state.events,
      defaultStake: state.settings.stake,
      startDate: state.settings.startDate,
      today,
    }),
  };
}

function fmtDate(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd)
    .toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function statusChip(s) {
  if (s === 'done') return '<span class="chip done">✓ done</span>';
  if (s === 'missed') return '<span class="chip missed">✗ missed</span>';
  return '<span class="chip pending">— pending</span>';
}

function balanceLine(balance) {
  if (!balance) return '';
  const s = state.settings;
  const debtor = balance > 0 ? s.nameB : s.nameA;
  const creditor = balance > 0 ? s.nameA : s.nameB;
  return `<div class="owes">${esc(debtor)} owes ${esc(creditor)} $${Math.abs(balance)}</div>`;
}

function render() {
  if (!state.settings) return;
  renderToday();
  renderHistory();
  renderSettings();
}

function renderToday() {}    // Task 6
function renderHistory() {}  // Task 7
function renderSettings() {} // Task 7

// ---------- tabs & init ----------

document.querySelectorAll('#tabbar button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#tabbar button')
      .forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
    $('#tab-' + btn.dataset.tab).classList.remove('hidden');
  };
});

if (state.spaceId && state.who) start();
else showOnboarding();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
```

- [ ] **Step 3: Verify tests still pass** (guards ledger.js purity — app.js imports it in a browser context, tests import it in Node)

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 4: Verify onboarding against real Firestore**

```bash
python3 -m http.server 8080 --directory public &
```

Open `http://localhost:8080` in a browser:
1. "Create a new space" → fill names/goals/stake → Create → "Who are you?" appears with both names → pick one → empty app with tab bar appears (tabs blank — render stubs).
2. In a private/incognito window: "Join with a code" with a garbage code → error message shows; with the real code (read it from localStorage `stakes.spaceId` in the first window's devtools, or from the Firestore console) → who-picker appears.
3. Reload the first window → goes straight to the app (localStorage persisted).

Kill the server after.

- [ ] **Step 5: Commit**

```bash
git add public/store.js public/app.js
git commit -m "feat: Firestore store and onboarding flow"
```

---

### Task 6: Today tab

**Files:**
- Modify: `public/app.js` (replace the `renderToday` stub)

**Interfaces:**
- Consumes: `state`, `$`, `esc`, `WHO_OTHER`, `ledger()`, `fmtDate`, `statusChip`, `balanceLine`, `store.markDay`, `addDays`, and `isEditable` (add it to the `ledger.js` import list).
- Produces: the Today tab UI. No new exports.

- [ ] **Step 1: Replace the `renderToday` stub in `public/app.js`**

Also extend the first import line to include `isEditable`:

```js
import { computeLedger, todayInTz, addDays, isEditable } from './ledger.js';
```

```js
function renderToday() {
  const { today, pot, balance } = ledger();
  const s = state.settings;
  const me = state.who;
  const them = WHO_OTHER(me);
  const myGoal = me === 'a' ? s.goalA : s.goalB;
  const theirName = them === 'a' ? s.nameA : s.nameB;
  const todayRec = state.days[today] || {};
  const yesterday = addDays(today, -1);
  const yRec = state.days[yesterday] || {};
  const showYesterday = yesterday >= s.startDate && isEditable(yesterday, today);

  $('#tab-today').innerHTML = `
    <h1>${fmtDate(today)}</h1>
    <div class="pot">Pot <strong>$${pot}</strong>${balanceLine(balance)}</div>
    <div class="card">
      <h2>${esc(myGoal)}</h2>
      <div class="mark">
        <button id="mark-done" class="done-btn ${todayRec[me] === 'done' ? 'active' : ''}">Done ✓</button>
        <button id="mark-missed" class="missed-btn ${todayRec[me] === 'missed' ? 'active' : ''}">Missed ✗</button>
      </div>
    </div>
    <div class="card">
      <h2>${esc(theirName)}</h2>
      ${statusChip(todayRec[them])}
    </div>
    ${showYesterday ? `
    <div class="card">
      <h3>Yesterday — ${fmtDate(yesterday)}</h3>
      <p>You: ${statusChip(yRec[me])} · ${esc(theirName)}: ${statusChip(yRec[them])}</p>
      <div class="mark">
        <button id="y-done" class="done-btn ${yRec[me] === 'done' ? 'active' : ''}">Done ✓</button>
        <button id="y-missed" class="missed-btn ${yRec[me] === 'missed' ? 'active' : ''}">Missed ✗</button>
      </div>
    </div>` : ''}
  `;

  $('#mark-done').onclick = () => store.markDay(state.spaceId, today, me, 'done');
  $('#mark-missed').onclick = () => store.markDay(state.spaceId, today, me, 'missed');
  if (showYesterday) {
    $('#y-done').onclick = () => store.markDay(state.spaceId, yesterday, me, 'done');
    $('#y-missed').onclick = () => store.markDay(state.spaceId, yesterday, me, 'missed');
  }
}
```

- [ ] **Step 2: Verify in the browser**

`python3 -m http.server 8080 --directory public &`, open `http://localhost:8080`:
1. Today tab shows date, pot $0, your goal with Done/Missed buttons, partner card, yesterday card (unless the space was created today — then no yesterday card, correct).
2. Tap "Done ✓" → button turns green instantly (real-time snapshot round-trip).
3. Open the second browser window (the partner from Task 5 step 4.2) → partner's chip updates live without reload.

Kill the server after.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: Today tab — mark done/missed, pot, partner status, yesterday grace"
```

---

### Task 7: History and Settings tabs + settle-up flow

**Files:**
- Modify: `public/app.js` (replace `renderHistory` and `renderSettings` stubs)

**Interfaces:**
- Consumes: everything Task 6 consumes, plus `store.addEvent`, `store.updateEvent`, `store.updateSettings`, and `ledger().pendingSettle`, `ledger().streaks`, `ledger().rows`.
- Produces: History and Settings UI. No new exports.

- [ ] **Step 1: Replace the `renderHistory` stub**

```js
function renderHistory() {
  const { rows, streaks } = ledger();
  const s = state.settings;
  const name = w => (w === 'a' ? s.nameA : s.nameB);
  const dayItems = rows.slice().reverse().map(r => `
    <div class="hrow">
      <span>${r.date}</span>
      <span>${esc(s.nameA)} ${statusChip(r.a)} ${esc(s.nameB)} ${statusChip(r.b)}</span>
    </div>
    ${r.payout ? `<div class="payout">💸 ${esc(name(r.payout.debtor))} owed ${esc(name(WHO_OTHER(r.payout.debtor)))} $${r.payout.amount}</div>` : ''}
  `).join('');
  const settleItems = state.events
    .filter(e => e.type === 'settle' && e.status === 'confirmed')
    .map(e => `<div class="payout">✅ ${esc(name(e.debtor))} paid ${esc(name(WHO_OTHER(e.debtor)))} $${e.amount} (${(e.createdAt || '').slice(0, 10)})</div>`)
    .join('');
  $('#tab-history').innerHTML = `
    <h1>History</h1>
    <div class="card">🔥 ${esc(s.nameA)}: ${streaks.a}-day streak · ${esc(s.nameB)}: ${streaks.b}-day streak</div>
    ${settleItems}
    ${dayItems || '<p class="muted">No days yet.</p>'}
  `;
}
```

- [ ] **Step 2: Replace the `renderSettings` stub**

```js
function renderSettings() {
  const { today, balance, pendingSettle } = ledger();
  const s = state.settings;
  const me = state.who;
  const name = w => (w === 'a' ? s.nameA : s.nameB);
  const debtorWho = balance > 0 ? 'b' : 'a';
  // settings.stake is frozen at creation (it's computeLedger's defaultStake).
  // The form shows the stake in force as of tomorrow, so a just-saved change
  // (effective tomorrow) is reflected immediately and can't be double-added.
  const tomorrow = addDays(today, 1);
  let currentStake = s.stake;
  state.events
    .filter(e => e.type === 'stakeChange')
    .sort((x, y) => (x.effectiveDate < y.effectiveDate ? -1 : 1))
    .forEach(ev => { if (ev.effectiveDate <= tomorrow) currentStake = ev.amount; });

  let settleHtml;
  if (pendingSettle) {
    settleHtml = `
      <p>${esc(name(pendingSettle.debtor))} says they paid $${pendingSettle.amount}.</p>
      ${me !== pendingSettle.debtor
        ? '<button id="settle-confirm">Confirm received</button>'
        : '<p class="muted">Waiting for confirmation…</p>'}
      <button id="settle-cancel" class="secondary">Cancel</button>`;
  } else if (balance !== 0) {
    settleHtml = me === debtorWho
      ? `<button id="settle-paid">I paid $${Math.abs(balance)}</button>`
      : '<p class="muted">Waiting for them to pay up…</p>';
  } else {
    settleHtml = '<p class="muted">All square 🎉</p>';
  }

  $('#tab-settings').innerHTML = `
    <h1>Settings</h1>
    <div class="card">
      <h2>Balance</h2>
      ${balanceLine(balance) || '<p class="muted">$0 — nobody owes anybody.</p>'}
      ${settleHtml}
    </div>
    <form id="settings-form" class="card">
      <h2>Goals &amp; stake</h2>
      <label>${esc(s.nameA)}'s goal <input name="goalA" value="${esc(s.goalA)}"></label>
      <label>${esc(s.nameB)}'s goal <input name="goalB" value="${esc(s.goalB)}"></label>
      <label>Daily stake ($) <input name="stake" type="number" min="1" value="${currentStake}"></label>
      <p class="muted">Stake changes apply starting tomorrow.</p>
      <button type="submit">Save</button>
    </form>
    <div class="card">
      <h2>Invite your partner</h2>
      <p class="code">${state.spaceId}</p>
      <button id="copy-code" class="secondary">Copy code</button>
    </div>
  `;

  const el = id => document.getElementById(id);
  el('settle-paid')?.addEventListener('click', () =>
    store.addEvent(state.spaceId, {
      type: 'settle', status: 'pending',
      amount: Math.abs(balance), debtor: debtorWho,
    }));
  el('settle-confirm')?.addEventListener('click', () =>
    store.updateEvent(state.spaceId, pendingSettle.id, { status: 'confirmed' }));
  el('settle-cancel')?.addEventListener('click', () =>
    store.updateEvent(state.spaceId, pendingSettle.id, { status: 'cancelled' }));
  el('copy-code').onclick = () => navigator.clipboard.writeText(state.spaceId);

  el('settings-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const stake = Number(f.get('stake'));
    if (stake !== currentStake) {
      await store.addEvent(state.spaceId, {
        type: 'stakeChange', amount: stake, effectiveDate: addDays(today, 1),
      });
    }
    await store.updateSettings(state.spaceId, {
      goalA: f.get('goalA'), goalB: f.get('goalB'),
    });
  };
}
```

Note on stake changes: `settings.stake` is written once at creation and never updated — it is `computeLedger`'s `defaultStake` (the stake from day one). Every change is only a dated `stakeChange` event (effective tomorrow), so history recomputes identically and past days never change. The Settings form displays `currentStake` (the stake in force as of tomorrow), not `settings.stake`.

- [ ] **Step 3: Verify tests still pass**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 4: Verify in the browser (two windows, one per person)**

`python3 -m http.server 8080 --directory public &`, then:
1. History: mark today done in one window, missed in the other → History shows the row with chips; if the pot was 0 the payout line appears ("💸 X owed Y $10") and Today's pot resets to $0 with the balance line appearing.
2. Settings: debtor's window shows "I paid $10" → tap → creditor's window shows "Confirm received" live → confirm → both show "All square 🎉" and History shows the ✅ settle line.
3. Change the stake to 25 → History/Today unchanged today; the form now shows 25.
4. Copy code button puts the space id on the clipboard.

Kill the server after.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: History and Settings tabs with two-step settle-up"
```

---

### Task 8: Final deploy, README, iPhone install

**Files:**
- Create: `README.md`
- Modify: `public/sw.js` (bump cache version)

**Interfaces:**
- Consumes: everything.
- Produces: the live app + user-facing docs.

- [ ] **Step 1: Bump the service-worker cache** in `public/sw.js`: change `const CACHE = 'stakes-v1'` to `'stakes-v2'` (ensures both phones fetch the finished files, not the Task 4 shell).

- [ ] **Step 2: Run the full test suite**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 3: Deploy**

```bash
firebase deploy
```

Expected: Hosting URL printed. Open it in a desktop browser and click through onboarding → Today → History → Settings to confirm the deployed version works.

- [ ] **Step 4: Write `README.md`**

```markdown
# 💸 Stakes

Two-person daily goal tracker with a rollover dollar pot. One shared "space",
one goal each, one configurable daily stake (default $10).

**Live app:** https://PROJECT_ID.web.app

## The rules

- Miss your goal on a day you both miss → the pot grows by the stake.
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

- `node --test tests/` — ledger unit tests (Node 18+).
- `python3 -m http.server 8080 --directory public` — local dev server.
- `firebase deploy` — deploy hosting + Firestore rules.

No build step, no dependencies. `public/ledger.js` is pure and holds all the
money math; `store.js` is the Firestore layer; `app.js` is the UI.
```

Replace `PROJECT_ID` with the real project id from Task 4.

- [ ] **Step 5: Deploy again (README isn't served, but the sw bump is)**

```bash
firebase deploy --only hosting
```

- [ ] **Step 6: Commit**

```bash
git add README.md public/sw.js
git commit -m "docs: README with rules and iPhone install; bump sw cache"
```

- [ ] **Step 7: Hand off to the user**

Tell the user: the live URL, that they should do the two-phone setup from the README (create space on one phone, join on the other, Add to Home Screen on both), and to report anything that looks off.
