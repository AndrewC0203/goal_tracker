import { computeLedger, todayInTz, addDays, isEditable } from './ledger.js';
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
