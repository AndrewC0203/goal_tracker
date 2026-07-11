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
