/* Trading Journal - varianta noua.
   Pagina principala: ceas + sesiunea de piata activa, P&L azi / luna, si
   numarul de tradeuri impartit pe TP / SL / BE.
   Datele stau in localStorage, nu pleaca nicaieri. */

'use strict';

const TRADES_KEY = 'tj2.trades.v1';
const SETTINGS_KEY = 'tj2.settings.v1';
const ACCOUNTS_KEY = 'tj2.accounts.v1';

/* Marimile de cont pe care le dau firmele de prop. */
const ACCOUNT_SIZES = [10000, 25000, 50000, 100000, 200000];

const CURRENCY_SIGN = { USD: '$', EUR: '€', RON: 'lei', GBP: '£' };

/* Orele sunt in ora locala a fiecarei burse, deci DST se rezolva singur. */
const SESSIONS = [
  { name: 'Sydney', key: 'sydney', tz: 'Australia/Sydney', open: 8 * 60, close: 17 * 60 },
  { name: 'Tokyo', key: 'tokyo', tz: 'Asia/Tokyo', open: 9 * 60, close: 18 * 60 },
  { name: 'London', key: 'london', tz: 'Europe/London', open: 8 * 60, close: 17 * 60 },
  { name: 'New York', key: 'newyork', tz: 'America/New_York', open: 8 * 60, close: 17 * 60 }
];

/* Fereastra timeline-ului: 6h in urma, 18h inainte. Markerul "now" sta la 25%. */
const WIN_BACK = 6 * 3600000;
const WIN_FWD = 18 * 3600000;
const NOW_PCT = (WIN_BACK / (WIN_BACK + WIN_FWD)) * 100;

const REASONS = ['HOFD', 'LOFD', 'Liq Locala', 'Liq Majora', 'Liq Minora'];

/* Perechile tranzactionate - apar mereu in sugestiile de la Pair. */
const DEFAULT_PAIRS = ['DE30/EUR', 'GBP/USD', 'EUR/USD', 'UK100', 'NQ', 'US30'];

let trades = [];
let accounts = [];
let settings = { theme: 'dark', currency: 'USD', scope: 'month', pairScope: 'all', reasonScope: 'all' };
let editingId = null;
let editingAcctId = null;
/* contul deschis in fila Accounts; null = lista de conturi */
let openAcctId = null;

/* starea formularului deschis */
let form = { side: 'Long', outcome: null, reasons: [], image: '', accountId: null, size: null };

/* filtrele din tabel */
let filter = { q: '', outcome: '' };

/* ---------------------------------------------------------------- storage */

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function nowTime() {
  return new Date().toTimeString().slice(0, 5);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function load() {
  try { trades = JSON.parse(localStorage.getItem(TRADES_KEY)) || []; } catch (e) { trades = []; }
  try { accounts = JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || []; } catch (e) { accounts = []; }
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch (e) { /* default */ }

  // tradeurile din forma veche (symbol + time) trec pe campurile noi
  trades.forEach(t => {
    if (!t.pair && t.symbol) { t.pair = t.symbol; delete t.symbol; }
    if (!t.entryTime && t.time) { t.entryTime = t.time; delete t.time; }
    if (!Array.isArray(t.reasons)) t.reasons = [];
    // inainte banii se treceau la orice trade; acum exista doar pe conturi
    if (t.accountId === undefined) t.accountId = null;
    if (!t.accountId) t.pnl = null;
  });

  // un cont sters lasa tradeurile orfane - le trec inapoi in jurnalul personal
  trades.forEach(t => {
    if (t.accountId && !accounts.some(a => a.id === t.accountId)) {
      t.accountId = null;
      t.pnl = null;
    }
  });
}

const accountById = id => accounts.find(a => a.id === id) || null;
const accountName = id => { const a = accountById(id); return a ? a.name : null; };

/* Marimea contului, scurt: 10k, 100k... */
function sizeLabel(size) {
  return size >= 1000 ? Math.round(size / 1000) + 'k' : String(size);
}

/* Banii exista doar pe conturile de prop firm. */
const isFunded = t => !!t.accountId;

/* Salvarea poate esua daca localStorage e plin (o poza prea mare). */
function saveTrades() {
  try {
    localStorage.setItem(TRADES_KEY, JSON.stringify(trades));
    return true;
  } catch (e) {
    return false;
  }
}

const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
const saveAccounts = () => localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));

/* ---------------------------------------------------------------- backup

   Jurnalul traieste doar in browserul asta, deci fisierul exportat e singurul
   backup care exista si singurul mod de a muta datele pe alt calculator sau pe
   telefon. Parola nu intra in fisier - contul se face din nou pe dispozitivul
   nou, apoi se importa. */

const BACKUP_FORMAT = 'jurnal-trading.backup.v1';

const countLabel = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function buildBackup() {
  return {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    settings: Object.assign({}, settings),
    accounts: accounts,
    trades: trades
  };
}

function backupFileName(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `jurnal-trading-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/* Descarca fisierul. In browserele reale merge cu blob; daca mediul nu stie de
   createObjectURL (jsdom), cadem pe un data URI. */
function exportBackup() {
  const json = JSON.stringify(buildBackup(), null, 2);
  let url = '';
  let revoke = false;
  try {
    url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    revoke = true;
  } catch (e) {
    url = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 2000);
  return json;
}

/* Unele medii blocheaza descarcarile (pagina gazduita, iframe cu sandbox).
   Atunci JSON-ul se arata pe ecran si se copiaza de mana. */
function showBackupText() {
  const box = document.getElementById('backupText');
  const area = document.getElementById('backupJson');
  if (!box || !area) return '';
  const json = JSON.stringify(buildBackup(), null, 2);
  area.value = json;
  box.hidden = false;
  document.getElementById('copyMsg').textContent = '';
  area.focus();
  area.select();
  return json;
}

function hideBackupText() {
  const box = document.getElementById('backupText');
  if (box) box.hidden = true;
}

/* Incearca clipboardul; daca browserul nu il da, textul ramane selectat. */
function copyBackupText() {
  const area = document.getElementById('backupJson');
  const msg = document.getElementById('copyMsg');
  if (!area) return Promise.resolve(false);
  area.focus();
  area.select();
  const done = ok => {
    if (msg) msg.textContent = ok ? 'Copied.' : 'Press Cmd+C to copy the selected text.';
    return ok;
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(area.value).then(() => done(true), () => done(false));
    }
  } catch (e) { /* cadem pe selectie */ }
  return Promise.resolve(done(false));
}

/* Spune de ce fisierul nu e bun, sau '' daca e in regula. */
function backupProblem(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'That file is not a journal backup.';
  }
  if (!Array.isArray(data.trades) || !Array.isArray(data.accounts)) {
    return 'That file is not a journal backup - no trades or accounts in it.';
  }
  if (data.trades.some(t => !t || typeof t !== 'object' || typeof t.date !== 'string')) {
    return 'That backup has trades in a shape this journal cannot read.';
  }
  if (data.accounts.some(a => !a || typeof a !== 'object' || typeof a.id !== 'string')) {
    return 'That backup has accounts in a shape this journal cannot read.';
  }
  return '';
}

/* Inlocuieste tot ce e in jurnal cu ce e in fisier. Intoarce '' daca a mers. */
function applyBackup(data) {
  const problem = backupProblem(data);
  if (problem) return problem;

  const prevTrades = trades;
  const prevAccounts = accounts;

  trades = data.trades;
  accounts = data.accounts;

  if (data.settings && typeof data.settings === 'object') {
    if (data.settings.theme === 'dark' || data.settings.theme === 'light') {
      settings.theme = data.settings.theme;
    }
    if (CURRENCY_SIGN[data.settings.currency]) settings.currency = data.settings.currency;
  }

  if (!saveTrades()) {
    trades = prevTrades;
    accounts = prevAccounts;
    return 'That backup is too big for this browser to store (most likely the screenshots).';
  }
  saveAccounts();
  saveSettings();

  load();            // aceleasi curatari ca la pornire: campuri vechi, conturi sterse
  openAcctId = null;
  applyTheme();
  document.getElementById('currency').value = settings.currency;
  render();
  return '';
}

function backupNote(msg, isError) {
  const info = document.getElementById('backupInfo');
  const err = document.getElementById('backupErr');
  if (!info || !err) return;
  err.hidden = !isError;
  err.textContent = isError ? msg : '';
  if (!isError && msg) info.textContent = msg;
}

/* Randul de sub butoane: cat ai de exportat. */
function updateBackupInfo() {
  const info = document.getElementById('backupInfo');
  if (!info) return;
  info.textContent = trades.length === 0 && accounts.length === 0
    ? 'Nothing to export yet.'
    : `${countLabel(trades.length, 'trade')} and ${countLabel(accounts.length, 'account')} in this browser.`;
}

/* Citeste fisierul ales si il aplica, dupa o confirmare daca ai deja date. */
function importBackupFile(file) {
  const err = document.getElementById('backupErr');
  if (err) { err.hidden = true; err.textContent = ''; }
  if (!file) return Promise.resolve('No file chosen.');

  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onerror = () => {
      backupNote('Could not read that file.', true);
      resolve('Could not read that file.');
    };
    reader.onload = () => {
      let data = null;
      try {
        data = JSON.parse(String(reader.result));
      } catch (e) {
        backupNote('That file is not valid JSON.', true);
        return resolve('That file is not valid JSON.');
      }

      const problem = backupProblem(data);
      if (problem) {
        backupNote(problem, true);
        return resolve(problem);
      }

      if ((trades.length || accounts.length) && !confirm(
        `This replaces everything in this browser (${countLabel(trades.length, 'trade')}, ` +
        `${countLabel(accounts.length, 'account')}) with the ${countLabel(data.trades.length, 'trade')} ` +
        `and ${countLabel(data.accounts.length, 'account')} in the file. Continue?`)) {
        return resolve('cancelled');
      }

      const applyProblem = applyBackup(data);
      if (applyProblem) {
        backupNote(applyProblem, true);
        return resolve(applyProblem);
      }
      hideBackupText();
      backupNote(`Imported ${countLabel(trades.length, 'trade')} and ${countLabel(accounts.length, 'account')}.`, false);
      resolve('');
    };
    reader.readAsText(file);
  });
}

/* ---------------------------------------------------------------- cont

   Atentie: aplicatia e locala, fara server. Contul e o incuietoare pe acest
   browser, nu securitate reala - datele din localStorage sunt vizibile oricui
   deschide devtools. Parola o pastram totusi hash-uita cum trebuie. */

const AUTH_KEY = 'tj2.auth.v1';
const SESSION_KEY = 'tj2.session.v1';

const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));

function getAccount() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; }
}

function isSignedIn() {
  const acc = getAccount();
  if (!acc) return false;
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    return !!s && s.email === acc.email;
  } catch (e) { return false; }
}

/* PBKDF2 unde exista Web Crypto; altfel un hash simplu, marcat ca atare. */
async function derive(password, saltB64) {
  const salt = saltB64
    ? Uint8Array.from(atob(saltB64), c => c.charCodeAt(0))
    : crypto.getRandomValues(new Uint8Array(16));

  if (crypto.subtle) {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
    return { salt: b64(salt), hash: b64(bits), algo: 'pbkdf2-sha256-150k' };
  }

  let h = 5381;
  const material = password + b64(salt);
  for (let i = 0; i < material.length; i++) h = ((h << 5) + h + material.charCodeAt(i)) | 0;
  return { salt: b64(salt), hash: String(h >>> 0), algo: 'weak' };
}

const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function authMode() {
  return getAccount() ? 'signin' : 'signup';
}

function renderAuth() {
  const mode = authMode();
  const acc = getAccount();
  document.getElementById('authTitle').textContent =
    mode === 'signup' ? 'Create your account' : 'Welcome back';
  document.getElementById('authSub').textContent = mode === 'signup'
    ? 'Your journal is locked to this device.'
    : 'Sign in to open your journal.';
  document.getElementById('authBtn').textContent =
    mode === 'signup' ? 'Create account' : 'Sign in';
  document.getElementById('authConfirmWrap').hidden = mode !== 'signup';
  document.getElementById('authPw').setAttribute('autocomplete',
    mode === 'signup' ? 'new-password' : 'current-password');
  document.getElementById('authErr').textContent = '';
  document.getElementById('authPw').value = '';
  document.getElementById('authPw2').value = '';
  if (mode === 'signin' && acc) document.getElementById('authEmail').value = acc.email;

  document.getElementById('authFoot').innerHTML = mode === 'signin'
    ? 'Forgot your password? <button type="button" id="authReset">Reset the account</button>'
    : '';
  const reset = document.getElementById('authReset');
  if (reset) reset.onclick = () => {
    if (!confirm('Reset the account?\n\nYour trades stay exactly where they are — only the email and password are removed, so you can set them again.\n\nThis is possible because everything lives in this browser.')) return;
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(SESSION_KEY);
    document.getElementById('authEmail').value = '';
    renderAuth();
  };
}

async function submitAuth(ev) {
  ev.preventDefault();
  const err = document.getElementById('authErr');
  const btn = document.getElementById('authBtn');
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  const pw = document.getElementById('authPw').value;
  const mode = authMode();

  if (!validEmail(email)) { err.textContent = 'That email does not look right.'; return; }
  if (pw.length < 8) { err.textContent = 'Password needs at least 8 characters.'; return; }
  if (mode === 'signup' && pw !== document.getElementById('authPw2').value) {
    err.textContent = 'The two passwords do not match.'; return;
  }

  err.textContent = '';
  btn.disabled = true;
  btn.textContent = mode === 'signup' ? 'Creating…' : 'Checking…';

  try {
    if (mode === 'signup') {
      const d = await derive(pw);
      localStorage.setItem(AUTH_KEY, JSON.stringify(
        Object.assign({ email, createdAt: new Date().toISOString() }, d)));
    } else {
      const acc = getAccount();
      if (email !== acc.email) { throw new Error('No account with that email on this device.'); }
      const d = await derive(pw, acc.salt);
      if (d.hash !== acc.hash) { throw new Error('Wrong password.'); }
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email, at: new Date().toISOString() }));
    startApp();
  } catch (e) {
    err.textContent = e.message || 'Could not sign you in.';
  } finally {
    btn.disabled = false;
    renderAuthButtonLabel();
  }
}

function renderAuthButtonLabel() {
  document.getElementById('authBtn').textContent =
    authMode() === 'signup' ? 'Create account' : 'Sign in';
}

function bindAuth() {
  document.getElementById('authForm').onsubmit = submitAuth;
  document.getElementById('authShow').onchange = e => {
    const type = e.target.checked ? 'text' : 'password';
    document.getElementById('authPw').type = type;
    document.getElementById('authPw2').type = type;
  };
  document.getElementById('signOutBtn').onclick = () => {
    localStorage.removeItem(SESSION_KEY);
    location.reload();
  };
}

/* ---------------------------------------------------------------- formatare */

function money(v, opts) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const sign = CURRENCY_SIGN[settings.currency] || '';
  const abs = Math.abs(v);
  const digits = abs >= 10000 ? 0 : 2;
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const prefix = opts && opts.signed && v > 0 ? '+' : v < 0 ? '−' : '';
  return prefix + (settings.currency === 'RON' ? body + ' ' + sign : sign + body);
}

function num(v, digits) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits || 0,
    maximumFractionDigits: digits === undefined ? 5 : digits // preturile FX au 5 zecimale
  });
}

function pnlClass(v) {
  return v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat';
}

/* Orice procent din aplicatie se arata ca inel: plin cat e procentul, gol restul.
   Verde peste 50%, galben intre 35 si 50, rosu sub. Cifra ramane langa inel,
   ca sa nu depinda intelesul doar de culoare. */
function pctRing(pct, opts) {
  const o = opts || {};
  const size = o.size || 18;
  const stroke = o.stroke || 3;
  const c = size / 2;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  if (pct === null || pct === undefined || !isFinite(pct)) {
    return `<span class="pct empty"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
      `<circle class="pct-track" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${stroke}"/></svg>` +
      '<span class="pct-num">—</span></span>';
  }

  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * circumference;
  const level = pct >= 50 ? 'hi' : pct >= 35 ? 'mid' : 'lo';
  return `<span class="pct ${level}" title="${num(pct, 1)}%">` +
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
    `<circle class="pct-track" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${stroke}"/>` +
    `<circle class="pct-arc" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${stroke}" ` +
    `stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}" ` +
    `transform="rotate(-90 ${c} ${c})"/></svg>` +
    `<span class="pct-num">${num(pct, 0)}%</span></span>`;
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDuration(mins) {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/* ------------------------------------------------------- ceas si sesiuni */

/* Decalajul unui fus fata de UTC, in minute, la un moment dat. */
function tzOffsetMinutes(tz, date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/* Ora de perete dintr-un fus -> moment absolut. A doua trecere prinde zilele cu DST. */
function wallToInstant(tz, y, m, d, minutes) {
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0) + minutes * 60000;
  let inst = wall - tzOffsetMinutes(tz, new Date(wall)) * 60000;
  return wall - tzOffsetMinutes(tz, new Date(inst)) * 60000;
}

function zonedDateParts(tz, date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { y: +p.year, m: +p.month, d: +p.day, wd: p.weekday };
}

/* Toate deschiderile de sesiune care ating intervalul [from, to]. */
function occurrences(from, to) {
  const out = [];
  const days = Math.ceil((to - from) / 86400000) + 2;
  SESSIONS.forEach(s => {
    for (let k = -1; k <= days; k++) {
      const z = zonedDateParts(s.tz, new Date(from + k * 86400000));
      if (z.wd === 'Sat' || z.wd === 'Sun') continue;
      const open = wallToInstant(s.tz, z.y, z.m, z.d, s.open);
      const close = wallToInstant(s.tz, z.y, z.m, z.d, s.close);
      if (close <= from || open >= to) continue;
      if (out.some(o => o.session === s && o.open === open)) continue;
      out.push({ session: s, open, close });
    }
  });
  return out;
}

function activeSessions(now) {
  return occurrences(now - 86400000, now + 86400000)
    .filter(o => o.open <= now && now < o.close)
    .map(o => o.session);
}

function nextEvent(now) {
  const events = [];
  occurrences(now, now + 6 * 86400000).forEach(o => {
    if (o.open > now) events.push({ name: o.session.name, event: 'opens', at: o.open });
    if (o.close > now) events.push({ name: o.session.name, event: 'closes', at: o.close });
  });
  return events.sort((a, b) => a.at - b.at)[0] || null;
}

const hhmm = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function renderClock() {
  const d = new Date();
  document.getElementById('clockTime').textContent = d.toLocaleTimeString('en-GB', { hour12: false });
  document.getElementById('clockDate').textContent = d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  document.getElementById('clockZone').textContent =
    'local time · ' + (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
}

function renderTimeline() {
  const now = Date.now();
  const from = now - WIN_BACK;
  const to = now + WIN_FWD;
  const span = to - from;
  const pct = t => ((t - from) / span) * 100;
  const blocks = occurrences(from, to);
  const open = activeSessions(now);

  const body = document.getElementById('tlBody');
  const lanes = SESSIONS.map(s => {
    const isOpen = open.includes(s);
    const mine = blocks.filter(b => b.session === s).map(b => {
      const left = Math.max(0, pct(b.open));
      const right = Math.min(100, pct(b.close));
      const width = Math.max(0, right - left);
      const fill = now <= b.open ? 0 : now >= b.close ? 100
        : ((now - b.open) / (b.close - b.open)) * 100;
      const label = width > 13 ? `${hhmm(b.open)}–${hhmm(b.close)}` : '';
      return `<div class="blk" style="left:${left}%;width:${width}%" ` +
        `title="${s.name}: ${hhmm(b.open)} – ${hhmm(b.close)} local">` +
        `<div class="blk-fill" style="width:${fill}%"></div>` +
        (label ? `<div class="blk-label">${label}</div>` : '') + '</div>';
    }).join('');
    return `<div class="lane-name${isOpen ? ' on' : ''}" style="--c:var(--s-${s.key})">` +
      `<i></i>${s.name}</div>` +
      `<div class="rail" style="--c:var(--s-${s.key})">${mine}</div>`;
  }).join('');

  body.querySelectorAll('.lane-name, .rail').forEach(n => n.remove());
  body.insertAdjacentHTML('afterbegin', lanes);
  document.getElementById('tlNow').style.left = NOW_PCT + '%';
  document.getElementById('tlPast').style.width = NOW_PCT + '%';

  // axa: cate o eticheta la 3 ore
  const step = 3 * 3600000;
  const firstTick = Math.ceil(from / step) * step;
  let ticks = '';
  for (let t = firstTick; t < to; t += step) {
    ticks += `<span style="left:${pct(t)}%">${hhmm(t)}</span>`;
  }
  document.getElementById('tlAxis').innerHTML = ticks;

  const overlap = open.some(s => s.name === 'London') && open.some(s => s.name === 'New York');
  document.getElementById('openNow').innerHTML = open.length
    ? '<span class="live-dot"></span>Open now: ' + open.map(s => s.name).join(' + ') +
      (overlap ? ' <span style="color:var(--warn)">· high-volume overlap</span>' : '')
    : '<span class="live-dot" style="background:var(--text-3);box-shadow:none;animation:none"></span>' +
      '<span class="muted">All markets closed</span>';

  const next = nextEvent(now);
  document.getElementById('nextEvent').textContent = next
    ? `${next.name} ${next.event} in ${fmtDuration((next.at - now) / 60000)}`
    : '';
}

/* Sesiunea sugerata pentru un trade nou: cea deschisa acum. */
function currentSessionName() {
  const open = activeSessions(Date.now());
  if (!open.length) return '';
  const priority = ['London', 'New York', 'Tokyo', 'Sydney'];
  return open.slice().sort((a, b) => priority.indexOf(a.name) - priority.indexOf(b.name))[0].name;
}

/* ---------------------------------------------------------------- statistici */

function inScope(t, scope) {
  if (scope === 'today') return t.date === today();
  if (scope === 'month') return t.date.slice(0, 7) === today().slice(0, 7);
  return true;
}

/* `pnl` si `funded` privesc doar tradeurile de pe conturi de prop firm;
   restul numaratorilor merg pe tot ce e in lista. */
function tally(list) {
  const c = { TP: 0, SL: 0, BE: 0, pnl: 0, count: list.length, funded: 0 };
  list.forEach(t => {
    c[t.outcome] = (c[t.outcome] || 0) + 1;
    if (isFunded(t)) { c.pnl += t.pnl || 0; c.funded++; }
  });
  return c;
}

/* Suma unui trade: gol daca nu e de pe un cont. */
function moneyCell(t) {
  return isFunded(t)
    ? `<td class="${pnlClass(t.pnl)}"><b>${money(t.pnl, { signed: true })}</b></td>`
    : '<td class="muted">—</td>';
}

function breakdown(c) {
  return `${c.TP} TP · ${c.SL} SL · ${c.BE} BE`;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/* Ultimele n zile calendaristice, inclusiv cele fara tradeuri. */
function dailyBuckets(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(today(), -i);
    out.push(Object.assign({ day }, tally(trades.filter(t => t.date === day))));
  }
  return out;
}

/* ---------------------------------------------------------------- svg utils */

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs, text) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text !== undefined) n.textContent = text;
  return n;
}

/* Bara cu capatul rotunjit, ancorata in linia de zero. */
function barPath(x, y, w, h, r, up) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  if (h <= 0.5) return `M${x} ${y}h${w}`;
  return up
    ? `M${x} ${y + h}V${y + rr}a${rr} ${rr} 0 0 1 ${rr} -${rr}h${w - 2 * rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}V${y + h}Z`
    : `M${x} ${y}V${y + h - rr}a${rr} ${rr} 0 0 0 ${rr} ${rr}h${w - 2 * rr}a${rr} ${rr} 0 0 0 ${rr} -${rr}V${y}Z`;
}

function niceTicks(min, max, count) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / (count || 4);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) {
    out.push(Math.abs(v) < step / 1000 ? 0 : v);
  }
  return out;
}

function showTip(tip, evt, html) {
  tip.innerHTML = html;
  tip.classList.add('on');
  const box = (tip.offsetParent || document.body).getBoundingClientRect();
  let x = evt.clientX - box.left + 14;
  if (x + tip.offsetWidth > box.width - 6) x = evt.clientX - box.left - tip.offsetWidth - 14;
  tip.style.left = Math.max(6, x) + 'px';
  tip.style.top = Math.max(6, evt.clientY - box.top - 12) + 'px';
}

/* ---------------------------------------------------------------- render */

const SCOPE_LABEL = { today: 'today', month: 'this month', all: 'all time' };

function render() {
  const tToday = tally(trades.filter(t => inScope(t, 'today')));
  const tMonth = tally(trades.filter(t => inScope(t, 'month')));

  /* Cifra din card e in bani, deci numara doar tradeurile de pe conturi.
     Randul de sub ea vorbeste despre toate tradeurile. */
  const kpi = (cardId, valId, subId, t, emptyMsg, sub) => {
    const has = t.funded > 0;
    document.getElementById(cardId).className =
      'card kpi ' + (!has ? '' : t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : 'neutral');
    const v = document.getElementById(valId);
    v.textContent = has ? money(t.pnl, { signed: true }) : '—';
    v.className = 'v ' + (has ? pnlClass(t.pnl) : 'flat');
    document.getElementById(subId).textContent = t.count ? sub(t) : emptyMsg;
  };

  const fundedNote = t => t.funded
    ? `${t.funded} on a prop-firm account`
    : 'none on a prop-firm account';

  kpi('cardToday', 'pnlToday', 'pnlTodaySub', tToday, 'No trades today',
    t => `${t.count} trade${t.count === 1 ? '' : 's'} · ${breakdown(t)} · ${fundedNote(t)}`);
  kpi('cardMonth', 'pnlMonth', 'pnlMonthSub', tMonth, 'No trades this month',
    t => `${t.count} trade${t.count === 1 ? '' : 's'} · ` +
      (t.funded ? `avg ${money(t.pnl / t.funded, { signed: true })} / prop trade` : fundedNote(t)));

  // cardurile 3 si 4 urmaresc comutatorul de perioada
  const scoped = tally(trades.filter(t => inScope(t, settings.scope)));
  const label = SCOPE_LABEL[settings.scope];
  document.getElementById('wrScope').textContent = label;
  document.getElementById('tcScope').textContent = label;
  document.querySelectorAll('#scopeSeg button').forEach(b =>
    b.classList.toggle('on', b.dataset.scope === settings.scope));

  const wr = winRate(scoped);
  const C = 2 * Math.PI * 32;
  const arc = document.getElementById('ringArc');
  arc.setAttribute('stroke-dasharray', `${((wr || 0) / 100) * C} ${C}`);
  arc.style.stroke = wr === null ? 'var(--surface-3)'
    : wr >= 50 ? 'var(--good)' : wr >= 35 ? 'var(--warn)' : 'var(--bad)';
  document.getElementById('wrValue').textContent = wr === null ? '—' : num(wr, 0) + '%';
  document.getElementById('wrWins').textContent = scoped.TP;
  document.getElementById('wrLosses').textContent = scoped.SL;
  document.getElementById('wrNote').textContent = scoped.BE
    ? `${scoped.BE} BE included` : 'BE included';

  document.getElementById('tradeCount').textContent = scoped.count;
  document.getElementById('cntTP').textContent = scoped.TP;
  document.getElementById('cntSL').textContent = scoped.SL;
  document.getElementById('cntBE').textContent = scoped.BE;
  const pct = n => (scoped.count ? (n / scoped.count) * 100 : 0) + '%';
  document.getElementById('propTP').style.width = pct(scoped.TP);
  document.getElementById('propSL').style.width = pct(scoped.SL);
  document.getElementById('propBE').style.width = pct(scoped.BE);

  renderDaily();
  renderBreakdowns();
  renderCalendar();
  renderTable();
  renderAccounts();

  // perechile mele primele, apoi orice altceva am mai tranzactionat
  const used = [...new Set(trades.map(t => t.pair).filter(Boolean))]
    .filter(p => !DEFAULT_PAIRS.includes(p)).sort();
  document.getElementById('pairList').innerHTML =
    DEFAULT_PAIRS.concat(used).map(s => `<option value="${escapeHtml(s)}">`).join('');
}

/* ------------------------------------------------------------ calendar */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let calMonth = today().slice(0, 7);
let calSelected = null;

function shiftMonth(mk, delta) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/* Sume scurte, ca sa incapa in casuta zilei. */
function moneyShort(v) {
  const sign = CURRENCY_SIGN[settings.currency] || '';
  const abs = Math.abs(v);
  const body = abs >= 1000
    ? (abs / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k'
    : abs.toFixed(abs % 1 === 0 ? 0 : 2);
  const prefix = v > 0 ? '+' : v < 0 ? '−' : '';
  return prefix + (settings.currency === 'RON' ? body + ' ' + sign : sign + body);
}

function renderCalendar() {
  const [y, m] = calMonth.split('-').map(Number);
  document.getElementById('calLabel').textContent = MONTH_NAMES[m - 1] + ' ' + y;

  const monthTrades = trades.filter(t => t.date.slice(0, 7) === calMonth);
  const t = tally(monthTrades);

  // sumarul lunii
  const card = document.getElementById('calPnlCard');
  card.className = 'card kpi ' + (!t.funded ? '' : t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : 'neutral');
  const pnlEl = document.getElementById('calPnl');
  pnlEl.textContent = t.funded ? money(t.pnl, { signed: true }) : '—';
  pnlEl.className = 'v ' + (t.funded ? pnlClass(t.pnl) : 'flat');
  const wr = winRate(t);
  document.getElementById('calPnlSub').innerHTML = t.count
    ? `${breakdown(t)}${wr === null ? '' : ' · ' + pctRing(wr) + ' win'}`
    : 'No trades this month';
  document.getElementById('calTrades').textContent = t.count;
  document.getElementById('calTradesSub').textContent = t.funded
    ? `avg ${money(t.pnl / t.funded, { signed: true })} / prop trade`
    : (t.count ? 'none on a prop-firm account' : '—');

  // zilele cu tradeuri; culoarea vine din bani, deci doar de pe conturi
  const byDay = {};
  monthTrades.forEach(x => {
    byDay[x.date] = byDay[x.date] || { pnl: 0, count: 0, funded: 0 };
    byDay[x.date].count++;
    if (isFunded(x)) { byDay[x.date].pnl += x.pnl || 0; byDay[x.date].funded++; }
  });
  const days = Object.values(byDay).filter(d => d.funded);
  const green = days.filter(d => d.pnl > 0).length;
  const red = days.filter(d => d.pnl < 0).length;
  document.getElementById('calDays').textContent = Object.keys(byDay).length;
  document.getElementById('calDaysSub').innerHTML = days.length
    ? `<span class="pos">${green} green</span> · <span class="neg">${red} red</span>` +
      (days.length - green - red ? ` · ${days.length - green - red} flat` : '')
    : (Object.keys(byDay).length ? 'none on a prop-firm account' : '—');

  // grila
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // luni prima
  let html = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < lead; i++) html += '<div class="cal-day blank"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const info = byDay[iso];
    const dow = new Date(y, m - 1, d).getDay();
    const cls = ['cal-day'];
    if (info) {
      cls.push('has');
      if (info.funded) cls.push(info.pnl > 0 ? 'win' : info.pnl < 0 ? 'loss' : 'flat');
    } else if (dow === 0 || dow === 6) {
      cls.push('weekend');
    }
    if (iso === today()) cls.push('today');
    if (iso === calSelected) cls.push('sel');
    html += `<div class="${cls.join(' ')}" data-day="${iso}">` +
      `<span class="dnum">${d}</span>` +
      (info
        ? (info.funded ? `<span class="dpnl">${moneyShort(info.pnl)}</span>` : '') +
          `<span class="dcount">${info.count} trade${info.count === 1 ? '' : 's'}</span>`
        : '') +
      '</div>';
  }
  document.getElementById('calGrid').innerHTML = html;

  renderCalDay();
}

function renderCalDay() {
  const card = document.getElementById('calDayCard');
  if (!calSelected) { card.hidden = true; return; }
  const list = trades.filter(t => t.date === calSelected)
    .sort((a, b) => (a.entryTime || '').localeCompare(b.entryTime || ''));
  if (!list.length) { card.hidden = true; calSelected = null; return; }

  const t = tally(list);
  card.hidden = false;
  document.getElementById('calDayTitle').textContent =
    new Date(calSelected + 'T12:00:00').toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const wr = winRate(t);
  document.getElementById('calDaySub').innerHTML =
    (t.funded ? `<span class="${pnlClass(t.pnl)}">${money(t.pnl, { signed: true })}</span> · ` : '') +
    `${t.count} trade${t.count === 1 ? '' : 's'} · ${breakdown(t)}` +
    (wr === null ? '' : ` · ${pctRing(wr)} win`);

  document.getElementById('calDayRows').innerHTML = list.map(x =>
    `<tr class="trade-row">` +
    `<td class="l">${escapeHtml(x.entryTime || '—')}</td>` +
    `<td class="l"><span class="pair">${escapeHtml(x.pair || '—')}</span></td>` +
    `<td class="l"><span class="badge ${x.side === 'Short' ? 'short' : 'long'}">${x.side}</span></td>` +
    `<td class="l">${escapeHtml(x.session || '—')}</td>` +
    `<td class="l">${(x.reasons || []).map(r => `<span class="tag">${escapeHtml(r)}</span>`).join('') || '—'}</td>` +
    `<td class="l"><span class="badge ${x.outcome.toLowerCase()}">${x.outcome}</span></td>` +
    moneyCell(x) +
    `<td class="${pnlClass(x.r)}">${x.r === null || x.r === undefined ? '—' : num(x.r, 2) + 'R'}</td>` +
    `</tr>`).join('');
}

/* ------------------------------------------------------- defalcari */

/* Win rate = TP / (TP + SL + BE). Break-even intra in numitor. */
function winRate(t) {
  const total = t.TP + t.SL + t.BE;
  return total ? (t.TP / total) * 100 : null;
}

function scopedTrades(scope) {
  return trades.filter(t => inScope(t, scope === 'month' ? 'month' : 'all'));
}

function pairRows(scope) {
  const map = new Map();
  scopedTrades(scope).forEach(t => {
    const k = t.pair || '—';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  });
  return [...map.entries()]
    .map(([key, list]) => Object.assign({ key }, tally(list)))
    .sort((a, b) => b.count - a.count || Math.abs(b.pnl) - Math.abs(a.pnl));
}

/* Un trade cu mai multe motive se numara la fiecare dintre ele. */
function reasonRows(scope) {
  const list = scopedTrades(scope);
  const rows = REASONS.map(r =>
    Object.assign({ key: r }, tally(list.filter(t => (t.reasons || []).includes(r)))));
  const none = list.filter(t => !(t.reasons || []).length);
  if (none.length) rows.push(Object.assign({ key: 'No reason logged', muted: true }, tally(none)));
  return rows;
}

function breakdownHtml(rows, unit) {
  return rows.map(r => {
    const wr = winRate(r);
    const pct = n => (r.count ? (n / r.count) * 100 : 0) + '%';
    return `<tr class="${r.count ? '' : 'off'}">` +
      `<td class="l"><span class="bd-name">${escapeHtml(r.key)}` +
      `<small>${r.count} ${r.count === 1 ? unit : unit + 's'}</small></span></td>` +
      `<td class="l bd-split"><div class="mini-prop">` +
      `<i class="p-tp" style="width:${pct(r.TP)}"></i>` +
      `<i class="p-sl" style="width:${pct(r.SL)}"></i>` +
      `<i class="p-be" style="width:${pct(r.BE)}"></i></div></td>` +
      `<td class="c-tp">${r.TP || '—'}</td>` +
      `<td class="c-sl">${r.SL || '—'}</td>` +
      `<td class="c-be">${r.BE || '—'}</td>` +
      `<td class="wr">${pctRing(wr)}</td>` +
      `<td class="${r.funded ? pnlClass(r.pnl) : 'muted'}">` +
      `${r.funded ? money(r.pnl, { signed: true }) : '—'}</td>` +
      `</tr>`;
  }).join('');
}

/* Numarul de tradeuri de sus, pe luna si de cand am inceput. */
function renderTotals(prefix) {
  const month = tally(trades.filter(t => inScope(t, 'month')));
  const all = tally(trades);
  const line = t => {
    const wr = winRate(t);
    return `${breakdown(t)}${wr === null ? '' : ' · ' + pctRing(wr) + ' win'}`;
  };

  document.getElementById(prefix + 'Month').textContent = month.count;
  document.getElementById(prefix + 'MonthSub').innerHTML =
    month.count ? line(month) : 'No trades this month';
  document.getElementById(prefix + 'All').textContent = all.count;
  document.getElementById(prefix + 'AllSub').innerHTML =
    all.count ? line(all) : 'Nothing logged yet';

  const first = trades.map(t => t.date).sort()[0];
  document.getElementById(prefix + 'Since').textContent = first
    ? 'since ' + new Date(first + 'T12:00:00').toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
}

function renderBreakdowns() {
  renderTotals('tv');
  renderTotals('sv');
  const pairs = pairRows(settings.pairScope);
  document.getElementById('pairRows').innerHTML = breakdownHtml(pairs, 'trade');
  document.getElementById('pairEmpty').hidden = pairs.length > 0;
  document.getElementById('reasonRows').innerHTML =
    breakdownHtml(reasonRows(settings.reasonScope), 'trade');

  document.querySelectorAll('#pairScope button').forEach(b =>
    b.classList.toggle('on', b.dataset.scope === settings.pairScope));
  document.querySelectorAll('#reasonScope button').forEach(b =>
    b.classList.toggle('on', b.dataset.scope === settings.reasonScope));
}

/* ------------------------------------------------------- conturi prop firm */

const acctTrades = id => trades.filter(t => t.accountId === id);

/* Soldul contului: porneste de la marimea aleasa si se muta cu fiecare trade. */
function accountBalance(a) {
  return a.size + acctTrades(a.id).reduce((s, t) => s + (t.pnl || 0), 0);
}

function renderAccounts() {
  const detail = openAcctId ? accountById(openAcctId) : null;
  document.getElementById('acctList').hidden = !!detail;
  document.getElementById('acctDetail').hidden = !detail;
  if (detail) renderAccountDetail(detail); else renderAccountList();
}

function renderAccountList() {
  updateBackupInfo();

  const grid = document.getElementById('acctGrid');
  document.getElementById('acctEmpty').hidden = accounts.length > 0;

  grid.innerHTML = accounts.map(a => {
    const t = tally(acctTrades(a.id));
    const wr = winRate(t);
    const pct = a.size ? (t.pnl / a.size) * 100 : null;
    const bal = accountBalance(a);
    return `<button type="button" class="acct-card" data-acct="${a.id}">` +
      `<span class="acct-top">` +
        `<span class="acct-name">${escapeHtml(a.name)}</span>` +
        `<span class="tag acct">${sizeLabel(a.size)}</span>` +
      `</span>` +
      `<span class="acct-balance${t.pnl > 0 ? ' pos' : t.pnl < 0 ? ' neg' : ''}">${money(bal)}</span>` +
      `<span class="acct-move">` +
        (t.count
          ? `<span class="${pnlClass(t.pnl)}">${money(t.pnl, { signed: true })}</span>` +
            ` from ${money(a.size)}`
          : `starting balance`) +
      `</span>` +
      `<span class="acct-sub">` +
        (t.count
          ? `${t.count} trade${t.count === 1 ? '' : 's'} · ${breakdown(t)}` +
            (wr === null ? '' : ` · ${num(wr, 0)}% win`) +
            (pct === null ? '' : ` · ${num(pct, 2)}% of account`)
          : 'No trades yet') +
      `</span>` +
      `</button>`;
  }).join('');
}

function renderAccountDetail(a) {
  const list = acctTrades(a.id)
    .sort((x, y) => (y.date + (y.entryTime || '')).localeCompare(x.date + (x.entryTime || '')));
  const t = tally(list);
  const wr = winRate(t);
  const pct = a.size ? (t.pnl / a.size) * 100 : null;

  document.getElementById('acctTitle').innerHTML =
    `${escapeHtml(a.name)} <span class="tag acct">${sizeLabel(a.size)}</span>`;

  // soldul: marimea contului plus tot ce a intrat sau a iesit
  const bal = accountBalance(a);
  const balCard = document.getElementById('acctBalanceCard');
  balCard.className = 'card kpi ' + (!t.count ? 'neutral' : t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : 'neutral');
  const balEl = document.getElementById('acctBalance');
  balEl.textContent = money(bal);
  balEl.className = 'v' + (t.pnl > 0 ? ' pos' : t.pnl < 0 ? ' neg' : '');
  document.getElementById('acctBalanceSub').innerHTML = t.count
    ? `Started at ${money(a.size)} · <span class="${pnlClass(t.pnl)}">${money(t.pnl, { signed: true })}</span>`
    : `Starting balance · ${sizeLabel(a.size)} account`;

  const card = document.getElementById('acctPnlCard');
  card.className = 'card kpi ' + (!t.count ? '' : t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : 'neutral');
  const pnlEl = document.getElementById('acctPnl');
  pnlEl.textContent = t.count ? money(t.pnl, { signed: true }) : '—';
  pnlEl.className = 'v sm ' + (t.count ? pnlClass(t.pnl) : 'flat');
  document.getElementById('acctPnlSub').textContent = t.count
    ? `${num(pct, 2)}% of the ${sizeLabel(a.size)} account`
    : 'No trades yet';

  document.getElementById('acctWr').innerHTML = wr === null ? '—' : num(wr, 0) + '%';
  document.getElementById('acctWr').className = 'v sm' + (wr === null ? ' flat' : '');
  document.getElementById('acctWrSub').textContent = t.count
    ? `${t.TP} won · ${t.SL} lost · ${t.BE} break even · BE included`
    : 'BE included';

  document.getElementById('acctTrades').textContent = t.count;
  document.getElementById('acctTradesSub').textContent = t.count
    ? `avg ${money(t.pnl / t.count, { signed: true })} / trade` : '—';

  document.getElementById('acctCaption').textContent = t.count
    ? `${t.count} trade${t.count === 1 ? '' : 's'} on this account, newest first.`
    : 'Nothing logged yet.';
  document.getElementById('acctRowsEmpty').hidden = list.length > 0;
  document.getElementById('acctRows').innerHTML = list.map(x => tradeRowHtml(x)).join('');
}

/* Randul de tabel folosit si in jurnal, si in pagina unui cont. */
function tradeRowHtml(t) {
  const priceCell = (price, time) => {
    const p = price === null || price === undefined || price === '' ? '—' : num(price);
    return p + (time ? ` <span class="muted">${escapeHtml(time)}</span>` : '');
  };
  return `<tr class="trade-row"${noteTitle(t)}>` +
    `<td class="l">${escapeHtml(t.date)}</td>` +
    `<td class="l"><span class="pair">${escapeHtml(t.pair || '—')}</span></td>` +
    `<td class="l"><span class="badge ${t.side === 'Short' ? 'short' : 'long'}">${t.side}</span></td>` +
    `<td class="l">${escapeHtml(t.session || '—')}</td>` +
    `<td>${priceCell(t.entryPrice, t.entryTime)}</td>` +
    `<td>${priceCell(t.exitPrice, t.exitTime)}</td>` +
    `<td>${t.lots === null || t.lots === undefined || t.lots === '' ? '—' : num(t.lots, undefined)}</td>` +
    `<td class="l">${(t.reasons || []).map(r => `<span class="tag">${escapeHtml(r)}</span>`).join('') || '—'}</td>` +
    `<td class="l"><span class="badge ${t.outcome.toLowerCase()}">${t.outcome}</span></td>` +
    moneyCell(t) +
    `<td class="${pnlClass(t.r)}">${t.r === null || t.r === undefined ? '—' : num(t.r, 2) + 'R'}</td>` +
    `<td class="l">${t.image ? `<img class="thumb zoom" src="${escapeHtml(t.image)}" alt="chart">` : '—'}</td>` +
    `<td><button class="btn icon edit-btn" data-id="${t.id}">Edit</button></td>` +
    `</tr>`;
}

/* -------------------------------------------------- formularul de cont */

let acctForm = { size: null };

function openAcctModal(id) {
  editingAcctId = id || null;
  const a = id ? accountById(id) : null;
  document.getElementById('acctModalTitle').textContent =
    a ? 'Edit account' : 'Add prop-firm account';
  document.getElementById('acctDeleteBtn').hidden = !a;
  document.getElementById('acctErr').textContent = '';
  document.getElementById('aName').value = a ? a.name : '';
  setAcctSize(a ? a.size : null);
  document.getElementById('acctModalBack').classList.add('on');
  document.getElementById('aName').focus();
}

function closeAcctModal() {
  document.getElementById('acctModalBack').classList.remove('on');
  editingAcctId = null;
}

function setAcctSize(size) {
  acctForm.size = size;
  document.querySelectorAll('#aSize button').forEach(b =>
    b.classList.toggle('on', Number(b.dataset.size) === size));
}

function submitAcctForm(ev) {
  ev.preventDefault();
  const err = document.getElementById('acctErr');
  const name = document.getElementById('aName').value.trim();
  if (!name) { err.textContent = 'Give the account a name.'; return; }
  if (!acctForm.size) { err.textContent = 'Pick the account size.'; return; }

  if (editingAcctId) {
    accounts = accounts.map(a =>
      a.id === editingAcctId ? Object.assign({}, a, { name, size: acctForm.size }) : a);
  } else {
    accounts = accounts.concat([{ id: uid(), name, size: acctForm.size, created: today() }]);
  }
  saveAccounts();
  closeAcctModal();
  render();
}

/* Stergerea unui cont nu sterge tradeurile: trec in jurnalul personal,
   fara suma, pentru ca banii exista doar pe conturi. */
function deleteAccount() {
  const id = editingAcctId;
  if (!id) return;
  const a = accountById(id);
  const n = acctTrades(id).length;
  const msg = n
    ? `Delete "${a.name}"? Its ${n} trade${n === 1 ? '' : 's'} stay in your journal but lose the money amount.`
    : `Delete "${a.name}"?`;
  if (!confirm(msg)) return;

  trades = trades.map(t =>
    t.accountId === id ? Object.assign({}, t, { accountId: null, pnl: null }) : t);
  accounts = accounts.filter(x => x.id !== id);
  saveTrades();
  saveAccounts();
  closeAcctModal();
  openAcctId = null;
  if (currentAccountId()) location.hash = '#accounts';
  render();
}

/* ------------------------------------------------------------ P&L pe zile */

function renderDaily() {
  const svg = document.getElementById('dailyChart');
  const wrap = document.getElementById('dailyWrap');
  const tip = document.getElementById('dailyTip');
  svg.innerHTML = '';

  // graficul e in bani, deci arata doar zilele cu tradeuri de pe conturi
  const rows = dailyBuckets(14);
  const total = rows.reduce((a, b) => a + b.pnl, 0);
  const traded = rows.filter(r => r.funded).length;
  document.getElementById('dailyTotal').innerHTML = traded
    ? `<span class="${pnlClass(total)}">${money(total, { signed: true })}</span> over ${traded} prop-firm day${traded === 1 ? '' : 's'}`
    : '';
  document.getElementById('dailyCaption').textContent =
    'Last 14 days · prop-firm accounts only';

  const W = wrap.clientWidth || 900;
  const H = 168;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', H);

  const m = { t: 12, r: 8, b: 26, l: 62 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = rows.map(r => r.pnl);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 3);
  const lo = Math.min(...ticks, ...vals, 0), hi = Math.max(...ticks, ...vals, 0);
  const Y = v => m.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const step = iw / rows.length;
  const bw = Math.min(26, step - 8);

  ticks.forEach(v => {
    svg.appendChild(el('line', {
      x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v),
      stroke: v === 0 ? 'var(--hairline-2)' : 'var(--grid)', 'stroke-width': 1
    }));
    svg.appendChild(el('text', {
      x: m.l - 10, y: Y(v) + 4, 'text-anchor': 'end', fill: 'var(--text-3)', 'font-size': 10.5
    }, money(v)));
  });

  rows.forEach((r, i) => {
    const cx = m.l + step * i + step / 2;
    const y0 = Y(0), y1 = Y(r.pnl);
    const up = r.pnl >= 0;
    const h = Math.max(Math.abs(y1 - y0), r.pnl === 0 ? 0 : 2);

    if (r.count) {
      svg.appendChild(el('path', {
        d: barPath(cx - bw / 2, up ? y0 - h : y0, bw, h, 4, up),
        fill: r.pnl > 0 ? 'var(--good)' : r.pnl < 0 ? 'var(--bad)' : 'var(--text-3)'
      }));
    } else {
      svg.appendChild(el('circle', { cx, cy: y0, r: 1.5, fill: 'var(--grid)' }));
    }

    const d = r.day;
    svg.appendChild(el('text', {
      x: cx, y: H - 9, 'text-anchor': 'middle',
      fill: d === today() ? 'var(--text-1)' : 'var(--text-3)', 'font-size': 10
    }, d.slice(8) + '/' + d.slice(5, 7)));

    const hit = el('rect', { x: cx - step / 2, y: m.t, width: step, height: ih, fill: 'transparent' });
    svg.appendChild(hit);
    hit.addEventListener('mousemove', ev => showTip(tip, ev,
      `<div><b>${d}</b></div>` +
      (r.count
        ? `<div>P&amp;L <b class="${pnlClass(r.pnl)}">${money(r.pnl, { signed: true })}</b></div>` +
          `<div class="t-sub">${r.count} trade${r.count === 1 ? '' : 's'} · ${breakdown(r)}</div>`
        : '<div class="t-sub">No trades</div>')));
    hit.addEventListener('mouseleave', () => tip.classList.remove('on'));
  });
}

function renderTable() {
  const q = filter.q.trim().toLowerCase();
  const rows = trades
    .filter(t => !filter.outcome || t.outcome === filter.outcome)
    .filter(t => !q || [t.pair, t.session, t.notes, (t.reasons || []).join(' '), t.side]
      .join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.date + (b.entryTime || '')).localeCompare(a.date + (a.entryTime || '')));

  const empty = document.getElementById('tableEmpty');
  empty.hidden = rows.length > 0;
  if (rows.length === 0 && trades.length > 0) {
    empty.innerHTML = '<b>Nothing matches</b>Try a different search or filter.';
  } else if (rows.length === 0) {
    empty.innerHTML = '<b>No trades yet</b>Add your first one and the numbers above start filling in.';
  }

  document.getElementById('listCaption').textContent = trades.length
    ? `${rows.length} of ${trades.length} trade${trades.length === 1 ? '' : 's'}, newest first.`
    : 'Nothing logged yet.';

  const priceCell = (price, time) => {
    const p = price === null || price === undefined || price === '' ? '—' : num(price);
    return p + (time ? ` <span class="muted">${escapeHtml(time)}</span>` : '');
  };

  /* Notitele nu mai apar ca rand sub trade - raman pe hover si in formular. */
  document.getElementById('tradesBody').innerHTML = rows.map(t =>
    `<tr class="trade-row"${noteTitle(t)}>` +
    `<td class="l">${escapeHtml(t.date)}</td>` +
    `<td class="l"><span class="pair">${escapeHtml(t.pair || '—')}</span></td>` +
    `<td class="l"><span class="badge ${t.side === 'Short' ? 'short' : 'long'}">${t.side}</span></td>` +
    `<td class="l">${escapeHtml(t.session || '—')}</td>` +
    acctCell(t) +
    `<td>${priceCell(t.entryPrice, t.entryTime)}</td>` +
    `<td>${priceCell(t.exitPrice, t.exitTime)}</td>` +
    `<td>${t.lots === null || t.lots === undefined || t.lots === '' ? '—' : num(t.lots, undefined)}</td>` +
    `<td class="l">${(t.reasons || []).map(r => `<span class="tag">${escapeHtml(r)}</span>`).join('') || '—'}</td>` +
    `<td class="l"><span class="badge ${t.outcome.toLowerCase()}">${t.outcome}</span></td>` +
    moneyCell(t) +
    `<td class="${pnlClass(t.r)}">${t.r === null || t.r === undefined ? '—' : num(t.r, 2) + 'R'}</td>` +
    `<td class="l">${t.image ? `<img class="thumb zoom" src="${escapeHtml(t.image)}" alt="chart">` : '—'}</td>` +
    `<td><button class="btn icon edit-btn" data-id="${t.id}">Edit</button></td>` +
    `</tr>`
  ).join('');
}

/* Notita sta pe rand ca tooltip, ca sa nu ocupe un rand intreg in tabel. */
function noteTitle(t) {
  return t.notes ? ` title="${escapeHtml(t.notes)}"` : '';
}

/* Pe ce cont a fost trade-ul: numele firmei, sau "Personal". */
function acctCell(t) {
  const name = accountName(t.accountId);
  return name
    ? `<td class="l"><span class="tag acct">${escapeHtml(name)}</span></td>`
    : '<td class="l muted">Personal</td>';
}

/* ---------------------------------------------------------------- poza */

/* Micsoreaza poza inainte de salvare - localStorage are ~5MB in total. */
function fileToDataUrl(file) {
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onerror = () => resolve('');
    fr.onload = () => {
      const raw = fr.result;
      const done = url => resolve(url);
      const fallback = setTimeout(() => done(raw), 3000);
      try {
        const img = new Image();
        img.onerror = () => { clearTimeout(fallback); done(raw); };
        img.onload = () => {
          clearTimeout(fallback);
          try {
            const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            const out = c.toDataURL('image/jpeg', 0.82);
            done(out && out.length < raw.length ? out : raw);
          } catch (e) { done(raw); }
        };
        img.src = raw;
      } catch (e) { clearTimeout(fallback); done(raw); }
    };
    fr.readAsDataURL(file);
  });
}

function setImage(url) {
  form.image = url || '';
  const wrap = document.getElementById('mImagePreview');
  const thumb = document.getElementById('mImageThumb');
  wrap.hidden = !form.image;
  if (form.image) thumb.src = form.image;
  if (!form.image) document.getElementById('mImageUrl').value = '';
}

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('on');
}

/* ---------------------------------------------------------------- formular */

function setSide(v) {
  form.side = v;
  document.querySelectorAll('#mSide button').forEach(b =>
    b.classList.toggle('on', b.dataset.side === v));
}

function setOutcome(v) {
  form.outcome = v;
  document.querySelectorAll('#mOutcome button').forEach(b =>
    b.classList.toggle('on', b.dataset.outcome === v));
  const pnl = document.getElementById('mPnl');
  if (v === 'BE' && pnl.value.trim() === '') pnl.value = '0';
  updatePnlPreview();
}

/* Spune in clar cati bani ai pus la socoteala, ca sa nu gresesti semnul. */
function updatePnlPreview() {
  const box = document.getElementById('mPnlPreview');
  document.getElementById('mCurSign').textContent = CURRENCY_SIGN[settings.currency] || '';
  const v = numOrNull('mPnl');
  if (v === null) {
    box.className = 'pnl-preview';
    box.textContent = 'Type a plain number for a win, a minus for a loss — e.g. 250 or −120.';
    return;
  }
  box.className = 'pnl-preview';
  box.innerHTML = v > 0 ? `Profit of <b class="pos">${money(v)}</b> on this position.`
    : v < 0 ? `Loss of <b class="neg">${money(Math.abs(v))}</b> on this position.`
    : `Break even — <b>${money(0)}</b>.`;
}

function setReasons(list) {
  form.reasons = list.slice();
  document.querySelectorAll('#mReasons button').forEach(b =>
    b.classList.toggle('on', form.reasons.includes(b.dataset.reason)));
}

function updateDuration() {
  const a = document.getElementById('mEntryTime').value;
  const b = document.getElementById('mExitTime').value;
  const box = document.getElementById('mDuration');
  if (!a || !b) { box.value = ''; return; }
  const toMin = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  let mins = toMin(b) - toMin(a);
  if (mins < 0) mins += 1440; // trecut de miezul noptii
  box.value = fmtDuration(mins);
}

/* `acctId` conteaza doar la un trade nou: spune pe ce cont il pun.
   La editare, contul vine de pe trade. */
function openModal(id, acctId) {
  editingId = id || null;
  const t = id ? trades.find(x => x.id === id) : null;
  form.accountId = t ? (t.accountId || null) : (acctId || null);

  const acct = accountById(form.accountId);
  const note = document.getElementById('modalAcct');
  note.innerHTML = acct
    ? `On <b>${escapeHtml(acct.name)}</b> <span class="tag">${sizeLabel(acct.size)}</span> — the amount is required.`
    : 'Personal journal — no money on this one. Log it under an account if you want the amount.';
  note.className = 'modal-acct' + (acct ? ' funded' : '');
  document.getElementById('fsMoney').hidden = !acct;

  document.getElementById('modalTitle').textContent = t ? 'Edit trade' : 'Add trade';
  document.getElementById('deleteBtn').hidden = !t;
  document.getElementById('formErr').textContent = '';

  const sel = document.getElementById('mSession');
  sel.innerHTML = ['<option value="">—</option>']
    .concat(SESSIONS.map(s => s.name).concat(['Other'])
      .map(n => `<option value="${n}">${n}</option>`)).join('');

  const set = (k, v) => { document.getElementById(k).value = v === null || v === undefined ? '' : v; };
  set('mDate', t ? t.date : today());
  set('mPair', t ? t.pair : '');
  set('mSession', t ? (t.session || '') : currentSessionName());
  set('mEntry', t ? t.entryPrice : '');
  set('mEntryTime', t ? t.entryTime : nowTime());
  set('mLots', t ? t.lots : '');
  set('mExit', t ? t.exitPrice : '');
  set('mExitTime', t ? t.exitTime : '');
  set('mPnl', t ? t.pnl : '');
  set('mR', t ? t.r : '');
  set('mNotes', t ? t.notes : '');
  set('mImageUrl', t && t.image && !/^data:/.test(t.image) ? t.image : '');

  setSide(t ? t.side : 'Long');
  setOutcome(t ? t.outcome : null);
  setReasons(t ? (t.reasons || []) : []);
  setImage(t ? (t.image || '') : '');
  updateDuration();
  updatePnlPreview();

  document.getElementById('modalBack').classList.add('on');
  document.getElementById('mPair').focus();
}

function closeModal() {
  document.getElementById('modalBack').classList.remove('on');
  document.getElementById('lightbox').classList.remove('on');
  editingId = null;
}

function numOrNull(id) {
  const v = document.getElementById(id).value.trim();
  if (v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function submitForm(ev) {
  ev.preventDefault();
  const err = document.getElementById('formErr');
  const date = document.getElementById('mDate').value;
  const pair = document.getElementById('mPair').value.trim().toUpperCase();
  const entryPrice = numOrNull('mEntry');
  const lots = numOrNull('mLots');
  const pnl = numOrNull('mPnl');

  if (!date || !pair) { err.textContent = 'Date and pair are required.'; return; }
  if (entryPrice === null) { err.textContent = 'Entry price is required.'; return; }
  if (lots !== null && lots <= 0) { err.textContent = 'If you fill in lots, use a positive number.'; return; }
  if (!form.outcome) { err.textContent = 'Pick a result: TP, SL or BE.'; return; }

  // banii se cer doar pe conturile de prop firm
  const funded = !!form.accountId;
  if (funded) {
    if (pnl === null) { err.textContent = 'P&L is required (use 0 for break even).'; return; }
    if (form.outcome === 'TP' && pnl < 0) { err.textContent = 'A TP with a negative P&L — pick SL, or fix the amount.'; return; }
    if (form.outcome === 'SL' && pnl > 0) { err.textContent = 'An SL with a positive P&L — pick TP, or enter the loss as a negative number.'; return; }
  }

  const urlField = document.getElementById('mImageUrl').value.trim();
  const t = {
    id: editingId || uid(),
    date,
    pair,
    side: form.side,
    session: document.getElementById('mSession').value,
    entryPrice,
    entryTime: document.getElementById('mEntryTime').value || '',
    lots,
    exitPrice: numOrNull('mExit'),
    exitTime: document.getElementById('mExitTime').value || '',
    reasons: form.reasons.slice(),
    outcome: form.outcome,
    accountId: form.accountId,
    pnl: funded ? pnl : null,
    r: numOrNull('mR'),
    notes: document.getElementById('mNotes').value.trim(),
    image: /^data:/.test(form.image) ? form.image : (urlField || form.image || '')
  };

  const before = trades;
  trades = editingId ? trades.map(x => (x.id === editingId ? t : x)) : trades.concat([t]);
  if (!saveTrades()) {
    trades = before;
    err.textContent = 'Browser storage is full — the image is too big. Use a smaller screenshot or paste a link instead.';
    return;
  }
  closeModal();
  render();
}

/* ---------------------------------------------------------------- events */

/* ---------------------------------------------------------------- rutare */

const ROUTES = ['dashboard', 'trades', 'strategy', 'calendar', 'accounts'];

/* Hash-ul poate fi "#accounts" (lista) sau "#accounts/<id>" (un cont deschis). */
function currentRoute() {
  const h = (location.hash || '').replace(/^#/, '').split('/')[0];
  return ROUTES.includes(h) ? h : 'dashboard';
}

function currentAccountId() {
  const parts = (location.hash || '').replace(/^#/, '').split('/');
  return parts[0] === 'accounts' && parts[1] ? parts[1] : null;
}

function applyRoute() {
  const r = currentRoute();
  ROUTES.forEach(v => { document.getElementById('view-' + v).hidden = v !== r; });
  document.querySelectorAll('.nav-tabs a').forEach(a =>
    a.classList.toggle('on', a.dataset.route === r));
  // graficul are nevoie de latimea reala, pe care o stie doar cand e vizibil
  if (r === 'dashboard') renderDaily();
  if (r === 'calendar') renderCalendar();
  if (r === 'accounts') {
    const id = currentAccountId();
    openAcctId = id && accountById(id) ? id : null;
    renderAccounts();
  }
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings.theme);
  document.getElementById('themeBtn').textContent = settings.theme === 'dark' ? 'Light' : 'Dark';
}

function bind() {
  document.getElementById('addBtn').onclick = () => openModal(null);
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('tradeForm').onsubmit = submitForm;
  document.getElementById('deleteBtn').onclick = () => {
    if (!editingId || !confirm('Delete this trade? This cannot be undone.')) return;
    trades = trades.filter(t => t.id !== editingId);
    saveTrades();
    closeModal();
    render();
  };
  document.getElementById('mOutcome').onclick = e => {
    const b = e.target.closest('button');
    if (b) setOutcome(b.dataset.outcome);
  };
  document.getElementById('mSide').onclick = e => {
    const b = e.target.closest('button');
    if (b) setSide(b.dataset.side);
  };
  document.getElementById('mReasons').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    const r = b.dataset.reason;
    setReasons(form.reasons.includes(r) ? form.reasons.filter(x => x !== r) : form.reasons.concat([r]));
  };
  document.getElementById('mEntryTime').oninput = updateDuration;
  document.getElementById('mExitTime').oninput = updateDuration;
  document.getElementById('mPnl').oninput = updatePnlPreview;

  // comutatoarele de perioada din sectiunile de defalcare
  [['pairScope', 'pairScope'], ['reasonScope', 'reasonScope']].forEach(([id, key]) => {
    document.getElementById(id).onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      settings[key] = b.dataset.scope;
      saveSettings();
      renderBreakdowns();
    };
  });

  // calendar
  document.getElementById('calPrev').onclick = () => { calMonth = shiftMonth(calMonth, -1); calSelected = null; renderCalendar(); };
  document.getElementById('calNext').onclick = () => { calMonth = shiftMonth(calMonth, 1); calSelected = null; renderCalendar(); };
  document.getElementById('calToday').onclick = () => { calMonth = today().slice(0, 7); calSelected = today(); renderCalendar(); };
  document.getElementById('calGrid').onclick = e => {
    const cell = e.target.closest('.cal-day.has');
    if (!cell) return;
    calSelected = calSelected === cell.dataset.day ? null : cell.dataset.day;
    renderCalendar();
  };
  document.getElementById('calDayClose').onclick = () => { calSelected = null; renderCalendar(); };

  // conturi de prop firm
  document.getElementById('addAcctBtn').onclick = () => openAcctModal(null);
  document.getElementById('acctCancelBtn').onclick = closeAcctModal;
  document.getElementById('acctForm').onsubmit = submitAcctForm;
  document.getElementById('acctDeleteBtn').onclick = deleteAccount;
  document.getElementById('aSize').onclick = e => {
    const b = e.target.closest('button');
    if (b) setAcctSize(Number(b.dataset.size));
  };
  document.getElementById('acctGrid').onclick = e => {
    const c = e.target.closest('.acct-card');
    if (c) location.hash = '#accounts/' + c.dataset.acct;
  };
  document.getElementById('acctBack').onclick = () => { location.hash = '#accounts'; };

  document.getElementById('exportBtn').onclick = () => {
    exportBackup();
    backupNote('Backup file downloaded - keep it somewhere safe.', false);
  };
  document.getElementById('copyBtn').onclick = () => {
    const box = document.getElementById('backupText');
    if (box.hidden) showBackupText(); else hideBackupText();
  };
  document.getElementById('copyNowBtn').onclick = copyBackupText;
  document.getElementById('copyCloseBtn').onclick = hideBackupText;
  document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = e => {
    const input = e.target;
    const file = input.files && input.files[0];
    // golim inputul ca sa mearga si al doilea import al aceluiasi fisier
    importBackupFile(file).then(() => { input.value = ''; });
  };
  document.getElementById('acctEdit').onclick = () => openAcctModal(openAcctId);
  // aici trade-ul primeste contul, deci si suma in bani
  document.getElementById('acctAddTrade').onclick = () => openModal(null, openAcctId);
  document.getElementById('acctRows').onclick = e => {
    const b = e.target.closest('.edit-btn');
    if (b) { openModal(b.dataset.id); return; }
    const img = e.target.closest('.zoom');
    if (img) openLightbox(img.getAttribute('src'));
  };

  // cautare + filtru pe rezultat in tabel
  document.getElementById('search').oninput = e => { filter.q = e.target.value; renderTable(); };
  document.getElementById('outcomeFilter').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    filter.outcome = b.dataset.filter;
    document.querySelectorAll('#outcomeFilter button').forEach(x =>
      x.classList.toggle('on', x.dataset.filter === filter.outcome));
    renderTable();
  };

  // poza: fisier, link sau paste din clipboard
  document.getElementById('mImagePick').onclick = () => document.getElementById('mImageFile').click();
  document.getElementById('mImageFile').onchange = async e => {
    const f = e.target.files[0];
    if (f) setImage(await fileToDataUrl(f));
    e.target.value = '';
  };
  document.getElementById('mImageUrl').oninput = e => {
    const v = e.target.value.trim();
    if (v) setImage(v); else if (!/^data:/.test(form.image)) setImage('');
  };
  document.getElementById('mImageClear').onclick = () => setImage('');
  document.getElementById('mImageThumb').onclick = () => openLightbox(form.image);
  document.getElementById('tradeForm').addEventListener('paste', async e => {
    const item = [...(e.clipboardData ? e.clipboardData.items : [])]
      .find(i => i.type && i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    setImage(await fileToDataUrl(item.getAsFile()));
  });
  document.getElementById('lightbox').onclick = () =>
    document.getElementById('lightbox').classList.remove('on');

  document.getElementById('tradesBody').onclick = e => {
    const img = e.target.closest('.zoom');
    if (img) { openLightbox(img.getAttribute('src')); return; }
    const b = e.target.closest('.edit-btn');
    if (b) openModal(b.dataset.id);
  };
  document.getElementById('scopeSeg').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.scope = b.dataset.scope;
    saveSettings();
    render();
  };
  document.getElementById('themeBtn').onclick = () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveSettings();
  };
  document.getElementById('currency').onchange = e => {
    settings.currency = e.target.value;
    saveSettings();
    updatePnlPreview();
    render();
  };
  window.addEventListener('resize', () => {
    clearTimeout(window.__rz);
    window.__rz = setTimeout(() => { if (currentRoute() === 'dashboard') renderDaily(); }, 150);
  });
  window.addEventListener('hashchange', applyRoute);
  document.getElementById('modalBack').addEventListener('mousedown', e => {
    if (e.target.id === 'modalBack') closeModal();
  });
  document.getElementById('acctModalBack').addEventListener('mousedown', e => {
    if (e.target.id === 'acctModalBack') closeAcctModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeAcctModal(); }
    const typing = /input|select|textarea/i.test(document.activeElement.tagName);
    if (e.key === 'n' && !typing && !document.querySelector('.modal-back.on')) {
      e.preventDefault();
      openModal(null);
    }
  });
}

/* ---------------------------------------------------------------- pornire */

let ticks = 0;

function startApp() {
  document.getElementById('authScreen').hidden = true;
  document.querySelector('.nav').hidden = false;
  document.querySelector('.wrap').hidden = false;

  const acc = getAccount();
  document.getElementById('userChip').hidden = false;
  document.getElementById('userEmail').textContent = acc ? acc.email : '';

  applyRoute();
  renderClock();
  renderTimeline();
  render();

  if (!window.__ticker) {
    window.__ticker = setInterval(() => {
      renderClock();
      if (++ticks % 5 === 0) renderTimeline();
    }, 1000);
  }
}

function showAuth() {
  document.getElementById('authScreen').hidden = false;
  document.querySelector('.nav').hidden = true;
  document.querySelector('.wrap').hidden = true;
  renderAuth();
  document.getElementById(getAccount() ? 'authPw' : 'authEmail').focus();
}

load();
applyTheme();
document.getElementById('currency').value = settings.currency;
bind();
bindAuth();

if (isSignedIn()) startApp(); else showAuth();
