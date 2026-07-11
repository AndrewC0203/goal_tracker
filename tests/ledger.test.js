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
