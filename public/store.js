import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache,
  doc, collection, getDocs, setDoc, addDoc, updateDoc, onSnapshot,
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

export async function listSpaces() {
  const snap = await getDocs(collection(db, 'spaces'));
  const spaces = [];
  snap.forEach(d => spaces.push({ id: d.id, ...d.data() }));
  return spaces;
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
