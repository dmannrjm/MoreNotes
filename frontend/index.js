// More Notes frontend (classic packaging). `React` and `API` are provided by the build wrapper.
const PLUGIN = 'MoreNotes';
const VERSION = '1.4.2';
const SHOW_DIAGNOSTICS = true; // @build:diagnostics
const h = React.createElement;

// ---------------------------------------------------------------------------
// Backend access + note store
// ---------------------------------------------------------------------------
function parseResult(r) {
  if (typeof r === 'string') {
    try { return JSON.parse(r); } catch (e) { return { ok: false, error: 'bad_json' }; }
  }
  return r && typeof r === 'object' ? r : { ok: false, error: 'empty_reply' };
}

// Everything sent to the Lua backend is ONE plain string (a JSON document in a field named "json"): native conversion of
// boolean/number arguments crashed it, and a single value arrives intact however the host hands arguments over.
function packArgs(args) {
  const keys = Object.keys(args || {});
  if (!keys.length) return {};
  if (keys.length === 1 && keys[0] === 'json' && typeof args.json === 'string') return args;
  return { json: JSON.stringify(args) };
}

async function backend(fn, args) {
  try {
    return parseResult(await Millennium.callServerMethod(PLUGIN, fn, packArgs(args)));
  } catch (e) {
    return { ok: false, error: 'backend_unreachable', detail: String((e && e.message) || e) };
  }
}

const MAX_NOTE = 4000; // characters; the backend enforces the same limit
const cpLen = s => Array.from(String(s || '')).length; // code points, so an emoji counts once like the backend counts it
const clampNote = s => { const a = Array.from(String(s || '')); return a.length > MAX_NOTE ? a.slice(0, MAX_NOTE).join('') : String(s || ''); };

const DEFAULT_SETTINGS = { pill: true, side: 'right', vertical: 50, shape: 'pill', size: 'medium', color: '#1a9fff', inline: false, backup: true, backupdir: '', iconcolor: 'auto', libtab: true };
const ENUM_VALUES = { side: ['left', 'right'], shape: ['pill', 'circle', 'square', 'tab'], size: ['small', 'medium', 'large'], iconcolor: ['auto', 'light', 'dark'] };

function mergeSettings(base, incoming) {
  const out = { ...base };
  if (!incoming || typeof incoming !== 'object') return out;
  if (typeof incoming.pill === 'boolean') out.pill = incoming.pill;
  if (typeof incoming.inline === 'boolean') out.inline = incoming.inline;
  if (typeof incoming.backup === 'boolean') out.backup = incoming.backup;
  if (typeof incoming.libtab === 'boolean') out.libtab = incoming.libtab;
  if (typeof incoming.backupdir === 'string') out.backupdir = incoming.backupdir.slice(0, 240);
  for (const k of Object.keys(ENUM_VALUES)) if (ENUM_VALUES[k].includes(incoming[k])) out[k] = incoming[k];
  const v = Number(incoming.vertical);
  if (Number.isFinite(v)) out.vertical = Math.max(0, Math.min(100, Math.round(v)));
  if (typeof incoming.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(incoming.color)) out.color = incoming.color.toLowerCase();
  return out;
}

const store = {
  notes: {},
  settings: { ...DEFAULT_SETTINGS },
  settingsError: '',
  settingsTimer: 0,
  backupInfo: null,
  backupMsg: '',
  status: 'idle', // idle | loading | ready | error
  error: null,
  listeners: new Set(),
  emit() { this.listeners.forEach(fn => { try { fn(); } catch (e) { /* listener failed */ } }); },
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  async load() {
    this.status = 'loading'; this.error = null; this.emit();
    const r = await backend('get_all');
    if (r.ok && r.notes && typeof r.notes === 'object') {
      this.notes = Array.isArray(r.notes) ? {} : r.notes; this.settings = mergeSettings(DEFAULT_SETTINGS, r.settings); this.status = 'ready';
    } else {
      this.status = 'error'; this.error = { code: r.error || 'unknown', detail: r.detail || '' };
    }
    this.emit();
  },
  get(key) { return this.notes[key]; },
  async refreshBackup() {
    const r = await backend('backup_info');
    if (r.ok) { this.backupInfo = r; this.emit(); }
  },
  async setBackupDir(dir) {
    const want = String(dir || '').trim();
    const r = await backend('set_settings', { json: JSON.stringify({ backupdir: want }) });
    if (!r.ok) this.backupMsg = `Could not save the folder: ${r.error || 'failed'}`;
    else {
      this.settings = mergeSettings(this.settings, r.settings);
      const wanted = want.replace(/\\/g, '/').replace(/\/+$/, '');
      this.backupMsg = this.settings.backupdir === wanted ? '' : 'That folder was not accepted. Use a full path, such as C:\\Users\\you\\Documents\\MoreNotes, with only letters, numbers, spaces and - _ . ( ) : / \\ ~ , characters.';
    }
    await this.refreshBackup();
    this.emit();
  },
  async backupNow() {
    const r = await backend('backup_now');
    this.backupInfo = r.error === 'backend_unreachable' ? this.backupInfo : r;
    this.backupMsg = r.ok ? 'Copy saved.' : `Copy failed: ${r.error || 'unknown error'}`;
    this.emit();
  },
  async restoreBackup(which) {
    const r = await backend('restore_backup', { which });
    if (r.ok) { await this.load(); this.backupMsg = `Restored ${r.count} notes.`; }
    else this.backupMsg = r.error === 'no_previous' ? 'No snapshot from an earlier day was found.' : r.error === 'no_backup' ? 'No backup copy was found.' : `Restore failed: ${r.error || 'unknown error'}`;
    await this.refreshBackup();
    this.emit();
  },
  // Applies a change locally right away and writes it after a short pause (the slider fires continuously).
  saveSettings(patch) {
    this.settings = mergeSettings(this.settings, patch);
    this.settingsError = '';
    this.emit();
    clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(async () => {
      const r = await backend('set_settings', { json: JSON.stringify(this.settings) });
      if (r.ok) this.settings = mergeSettings(this.settings, r.settings);
      else this.settingsError = `${r.error || 'failed'}${r.detail ? ': ' + r.detail : ''}`;
      this.emit();
    }, 350);
  },
  async save(key, text, label) {
    const r = await backend('set_note', { key, text, label: label || '' });
    if (r.ok) {
      const clean = String(text || '').trim();
      if (!clean) delete this.notes[key];
      else this.notes[key] = { text: clampNote(clean), label: label || (this.notes[key] && this.notes[key].label) || '', updated: Math.floor(Date.now() / 1000) };
      this.emit();
    }
    return r;
  },
  remove(key) { return this.save(key, '', ''); },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const comp = (name, fallbackTag) => API[name] || (props => h(fallbackTag || 'div', null, props && props.children));
const Field = comp('Field');
const ButtonItem = comp('ButtonItem');
const Toggle = comp('Toggle');
const Dropdown = comp('Dropdown');
const TextField = comp('TextField');
const Focusable = comp('Focusable');
const DialogButton = comp('DialogButton', 'button');
const DialogButtonPrimary = API.DialogButtonPrimary || DialogButton;
const ModalRoot = comp('ModalRoot');
const SliderField = comp('SliderField');

function action(props) {
  const { key, onClick, disabled } = props;
  let last = 0;
  const fire = event => {
    if (disabled) return;
    const now = Date.now();
    if (now - last < 400) return; // the row and the wrapper can both report one click
    last = now;
    if (onClick) onClick(event);
  };
  const row = h(ButtonItem, { ...props, key: undefined, onClick: fire });
  return h('div', { key, onClick: fire, style: { cursor: disabled ? 'default' : 'pointer' } }, row);
}

function useStore() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => store.subscribe(() => setTick(t => t + 1)), []);
}

const KINDS = [
  { data: 0, kind: 'user', label: 'Person (SteamID64 or friend code)' },
  { data: 1, kind: 'app', label: 'Game (App ID)' },
  { data: 2, kind: 'page', label: 'Page (web address)' },
];
const NOTE_HOSTS = ['store.steampowered.com', 'steamcommunity.com'];
const EXCLUDED_PATHS = /^\/(login|join|checkout|cart|account|steamguard|twofactor)(\/|$)/i;

// Same normalisation as the web-page script, so a note written there and here is the same note.
function pagePathId(host, pathname) {
  let p = String(pathname || '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (!p) p = '/';
  return (String(host).toLowerCase() + p).replace(/[^A-Za-z0-9_.\-\/~]/g, '_').slice(0, 100);
}
const STEAM_ID_BASE = 76561197960265728n;

function normaliseId(kind, raw) {
  const id = String(raw || '').trim();
  if (kind === 'page') {
    let u;
    try { u = new URL(/^https?:/i.test(id) ? id : 'https://' + id); } catch (e) { return null; }
    if (!NOTE_HOSTS.includes(u.hostname.toLowerCase()) || EXCLUDED_PATHS.test(u.pathname)) return null;
    return pagePathId(u.hostname, u.pathname);
  }
  if (!/^\d+$/.test(id)) return null;
  if (kind === 'app') return id.length <= 10 ? String(Number(id)) : null;
  if (id.length === 17 && id.startsWith('7656')) return id;
  if (id.length <= 10) { try { return String(BigInt(id) + STEAM_ID_BASE); } catch (e) { return null; } }
  return null;
}

function describeKey(key) {
  const i = key.indexOf(':');
  const kind = i > 0 ? key.slice(0, i) : '';
  const id = i > 0 ? key.slice(i + 1) : key;
  return { kind, id, kindLabel: kind === 'user' ? 'Person' : kind === 'app' ? 'Game' : kind === 'page' ? 'Page' : 'Note' };
}

// Shows "current / maximum" beneath a writing area; amber from 90%, red at the limit.
function NoteCounter(props) {
  const n = cpLen(props.text);
  const color = n >= MAX_NOTE ? 'var(--gpColor-Red, #e24c4c)' : n >= MAX_NOTE * 0.9 ? '#e8b24a' : undefined;
  return h('div', { style: { fontSize: 12, textAlign: 'right', opacity: color ? 1 : 0.7, color } }, `${n} / ${MAX_NOTE}`);
}

// ---------------------------------------------------------------------------
// Note editor (native Steam modal)
// ---------------------------------------------------------------------------
function NoteEditor(props) {
  const existing = store.get(props.noteKey);
  const [text, setText] = React.useState((existing && existing.text) || '');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const close = () => { if (props.closeModal) props.closeModal(); };

  const commit = async value => {
    setBusy(true); setErr('');
    const r = await store.save(props.noteKey, value, props.label);
    setBusy(false);
    if (r.ok) close(); else setErr(`${r.error || 'failed'}${r.detail ? ': ' + r.detail : ''}`);
  };

  const btn = (key, label, onClick, Cmp, disabled) =>
    h('div', { key, style: { flex: '1 1 120px' } },
      h(Cmp || DialogButton, { onClick, disabled: !!disabled || busy, style: { width: '100%' } }, label));

  return h(ModalRoot, { closeModal: close, onCancel: close, bAllowFullSize: true },
    h('div', { style: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '420px' } },
      h('div', { style: { fontSize: '18px', fontWeight: 600 } }, props.label || describeKey(props.noteKey).id),
      h(TextField, { value: text, placeholder: 'Write a note…', focusOnMount: true, bShowClearAction: true, onChange: e => setText(clampNote(e.target.value)) }),
      h(NoteCounter, { text }),
      err ? h('div', { style: { color: 'var(--gpColor-Red, #e24c4c)' } }, err) : null,
      h(Focusable, { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
        btn('save', 'Save', () => commit(text), DialogButtonPrimary),
        existing ? btn('delete', 'Delete', () => commit(''), DialogButton) : null,
        btn('cancel', 'Cancel', close, DialogButton))));
}

function openEditor(noteKey, label) {
  const element = h(NoteEditor, { noteKey, label: label || '' });
  const options = { strTitle: 'Note', popupWidth: 560, popupHeight: 300, bNeverPopOut: false };
  try {
    const win = window.g_PopupManager && window.g_PopupManager.GetExistingPopup && window.g_PopupManager.GetExistingPopup('SP Desktop_uid0');
    if (win) return API.showModal(element, win, options);
  } catch (e) { console.warn(`[${PLUGIN}] showModal with library window failed`, e); }
  return API.showModal(element, undefined, options);
}


// ---------------------------------------------------------------------------
// Shared hook into React's JSX runtime (used by the Notes tab and the optional diagnostics)
// ---------------------------------------------------------------------------
const jsxHooks = {
  handlers: new Map(),
  patches: new Map(),
  runtime: null,
  watchdog: 0,
  add(id, fn) { this.handlers.set(id, fn); this.ensure(); },
  remove(id) { this.handlers.delete(id); if (!this.handlers.size) this.teardown(); },
  dispatch(args) {
    for (const fn of this.handlers.values()) {
      try { fn(args); } catch (e) { console.error(`[${PLUGIN}] jsx hook failed`, e); }
    }
  },
  ensure() {
    if (this.watchdog) return true;
    this.runtime = API.findModuleByExport((value, name) => (name === 'jsx' || name === 'jsxs') && typeof value === 'function');
    if (!this.runtime) { console.warn(`[${PLUGIN}] jsx runtime not found`); return false; }
    const patch = name => {
      const entry = this.patches.get(name) || {};
      entry.last = this.runtime[name];
      entry.patch = API.beforePatch(this.runtime, name, args => this.dispatch(args));
      this.patches.set(name, entry);
    };
    patch('jsx'); patch('jsxs');
    // another plugin or a Steam update can swap the function back; patch again when that happens
    this.watchdog = setInterval(() => {
      for (const name of ['jsx', 'jsxs']) {
        const entry = this.patches.get(name);
        if (entry && entry.patch !== undefined && this.runtime[name] !== entry.last) continue;
        patch(name);
      }
    }, 1000);
    return true;
  },
  teardown() {
    clearInterval(this.watchdog); this.watchdog = 0;
    for (const e of this.patches.values()) { try { e.patch && e.patch.unpatch && e.patch.unpatch(); } catch (err) { /* ignore */ } }
    this.patches.clear();
  },
};

// ---------------------------------------------------------------------------
// Notes tab on a game's library page (native Steam tab row, next to Achievements)
// ---------------------------------------------------------------------------
const TAB_ID = 'morenotes';

function appNameOf(id) {
  try {
    const o = window.appStore && window.appStore.GetAppOverviewByAppID && window.appStore.GetAppOverviewByAppID(Number(id));
    return (o && o.display_name) || '';
  } catch (e) { return ''; }
}

function NotesTab(props) {
  useStore();
  const key = 'app:' + props.appId;
  const note = store.get(key);
  const saved = (note && note.text) || '';
  const name = appNameOf(props.appId);
  const [text, setText] = React.useState(saved);
  const [dirty, setDirty] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  React.useEffect(() => { if (!dirty) setText(saved); }, [saved]);
  const commit = async value => {
    setMsg('');
    const r = await store.save(key, value, name);
    if (r.ok) { setDirty(false); setMsg(value.trim() ? 'Saved.' : 'Note deleted.'); if (!value.trim()) setText(''); }
    else setMsg(`${r.error || 'failed'}${r.detail ? ': ' + r.detail : ''}`);
  };
  return h('div', { style: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' } },
    h(Field, { label: name ? `Notes - ${name}` : 'Notes', description: 'A private note for this game. It also shows on the game\'s store page and community hub.' }),
    h(TextField, { value: text, placeholder: 'Write a note…', bShowClearAction: true, onChange: e => { setText(clampNote(e.target.value)); setDirty(true); } }),
    h(NoteCounter, { text }),
    h(Focusable, { style: { display: 'flex', gap: '8px' } },
      h(DialogButtonPrimary, { onClick: () => commit(text), style: { minWidth: '100px' } }, 'Save'),
      saved ? h(DialogButton, { onClick: () => commit(''), style: { minWidth: '100px' } }, 'Delete') : null),
    msg ? h(Field, { label: msg }) : null,
    saved ? h(Field, { label: 'Saved note', description: saved }) : null);
}

const libtab = {
  started: false,
  add(args) {
    const props = args[1];
    if (!props || !Array.isArray(props.tabs) || typeof props.onShowTab !== 'function' || props.autoFocusContents === undefined) return;
    if (!store.settings.libtab) return;
    if (props.tabs.some(t => t && t.id === TAB_ID)) return; // never add twice
    const first = props.tabs[0];
    const appId = first && first.content && first.content.props ? first.content.props.appid : undefined;
    if (appId == null) return;
    props.tabs.push({ content: h(NotesTab, { key: `${TAB_ID}-${appId}`, appId: String(appId) }), id: TAB_ID, title: 'Notes' });
  },
  start() { if (this.started) return; this.started = true; jsxHooks.add('libtab', args => this.add(args)); },
  stop() { this.started = false; jsxHooks.remove('libtab'); },
};

// ---------------------------------------------------------------------------
// Optional diagnostics: records which Steam elements carry ids, so friends-list
// and chat notes can be wired to the right components. Records prop NAMES and
// id-like values only; never message text. Off by default.
// ---------------------------------------------------------------------------
const diag = {
  on: false,
  seen: new Map(),
  typeName(type) {
    if (typeof type === 'string') return type;
    if (typeof type === 'function') return type.displayName || type.name || 'anonymous';
    if (type && typeof type === 'object') {
      const inner = type.type || type.render;
      return 'wrapped:' + ((inner && (inner.displayName || inner.name)) || type.displayName || 'object');
    }
    return 'unknown';
  },
  record(args) {
    const type = args[0]; const props = args[1];
    if (!props || typeof props !== 'object' || typeof type === 'string') return;
    const keys = Object.keys(props);
    const idKeys = keys.filter(k => /steamid|accountid|appid|persona|friend|chat|clan/i.test(k));
    const name = this.typeName(type);
    if (!idKeys.length && !/friend|chat|persona|wishlist/i.test(name)) return;
    const sig = name + '|' + keys.slice(0, 40).join(',');
    if (this.seen.has(sig) || this.seen.size >= 250) return;
    const sample = {};
    for (const k of idKeys.slice(0, 8)) {
      const v = props[k];
      if (typeof v === 'string' && v.length <= 24 && /^\d+$/.test(v)) sample[k] = v;
      else if (typeof v === 'number') sample[k] = v;
      else sample[k] = Array.isArray(v) ? 'array' : typeof v;
    }
    this.seen.set(sig, { type: name, propKeys: keys.slice(0, 40), idSample: sample });
  },
  start() {
    if (!SHOW_DIAGNOSTICS || this.on) return;
    this.on = true;
    jsxHooks.add('diag', args => this.record(args));
  },
  stop() {
    if (!this.on) return;
    this.on = false;
    jsxHooks.remove('diag');
  },
  report() {
    return { plugin: PLUGIN, version: VERSION, collected: Array.from(this.seen.values()) };
  },
};

// ---------------------------------------------------------------------------
// Manager panel (Millennium settings sidebar)
// ---------------------------------------------------------------------------
const PAGE_SIZE = 100;

const SIDE_OPTIONS = [{ data: 0, value: 'left', label: 'Left edge' }, { data: 1, value: 'right', label: 'Right edge' }];
const SHAPE_OPTIONS = [
  { data: 0, value: 'pill', label: 'Pill' }, { data: 1, value: 'circle', label: 'Circle' },
  { data: 2, value: 'square', label: 'Rounded square' }, { data: 3, value: 'tab', label: 'Edge tab' },
];
const SIZE_OPTIONS = [{ data: 0, value: 'small', label: 'Small' }, { data: 1, value: 'medium', label: 'Medium' }, { data: 2, value: 'large', label: 'Large' }];
const ICON_OPTIONS = [{ data: 0, value: 'auto', label: 'Automatic (best contrast)' }, { data: 1, value: 'light', label: 'Light' }, { data: 2, value: 'dark', label: 'Dark' }];
const SWATCHES = ['#1a9fff', '#2d7dd2', '#2fbf71', '#5ba32b', '#f2b134', '#e8863a', '#d9534f', '#e0589b', '#8f5bd1', '#5b6fd1', '#00b5ad', '#8b929a', '#c6d4df', '#ffffff', '#2a475e', '#101820'];
const OFFSET_LIMIT = 42; // the tab stays within 8%-92% of the page height

// ---- colour helpers
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let hh = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh *= 60;
  }
  return { h: Math.round(hh) % 360, s: Math.round(sat * 100), l: Math.round(l * 100) };
}
function hslToHex(hue, sat, lig) {
  const s1 = sat / 100, l1 = lig / 100;
  const k = n => (n + hue / 30) % 12;
  const a = s1 * Math.min(l1, 1 - l1);
  const f = n => l1 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}
function contrastHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#101820' : '#ffffff';
}
function iconFg(st) { return st.iconcolor === 'light' ? '#ffffff' : st.iconcolor === 'dark' ? '#101820' : contrastHex(st.color); }

const NOTE_ICON_PATHS = [h('path', { key: 1, d: 'M5 3h10l4 4v14H5z' }), h('path', { key: 2, d: 'M15 3v4h4' }), h('path', { key: 3, d: 'M8 12h8M8 16h6' })];
const noteIcon = (size, color) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color || 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, NOTE_ICON_PATHS);

// A copy of the collapsed tab, drawn from the current settings (same shapes and sizes as on the pages).
function TabIcon(props) {
  const st = props.st, k = props.scale || 1;
  const dims = { small: [26, 84, 40, 22], medium: [32, 104, 48, 26], large: [38, 124, 56, 30] }[st.size] || [32, 104, 48, 26];
  const base = { background: st.color, color: iconFg(st), display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.45)', boxSizing: 'border-box' };
  let style;
  if (st.shape === 'pill') style = { ...base, width: dims[0] * k, height: dims[1] * k, borderRadius: 999 };
  else if (st.shape === 'circle') style = { ...base, width: dims[2] * k, height: dims[2] * k, borderRadius: '50%' };
  else if (st.shape === 'square') style = { ...base, width: dims[2] * k, height: dims[2] * k, borderRadius: 10 * k };
  else style = { ...base, width: dims[3] * k, height: dims[1] * k, borderRadius: st.side === 'right' ? `${12 * k}px 0 0 ${12 * k}px` : `0 ${12 * k}px ${12 * k}px 0` };
  return h('div', { style }, noteIcon(Math.round(18 * k)));
}

// Shows the tab on the chosen page edge at the chosen offset, so its final location is visible while adjusting.
function PlacementPreview(props) {
  const st = props.st;
  const top = Math.max(8, Math.min(92, st.vertical));
  const edge = st.side === 'left' ? 'left' : 'right';
  return h('div', { style: { position: 'relative', width: '100%', height: 170, boxSizing: 'border-box', border: '1px solid var(--gpColor-Border, rgba(255,255,255,.28))', borderRadius: 6, background: 'rgba(255,255,255,.04)', overflow: 'hidden' } },
    h('div', { style: { position: 'absolute', left: 0, right: 0, top: '50%', borderTop: '1px dashed rgba(255,255,255,.22)' } }),
    h('div', { style: { position: 'absolute', top: 4, [edge === 'left' ? 'right' : 'left']: 8, fontSize: 11, opacity: 0.55 } }, 'page edge'),
    h('div', { style: { position: 'absolute', top: `${top}%`, [edge]: st.shape === 'tab' ? 0 : 6, transform: 'translateY(-50%)' } }, h(TabIcon, { st, scale: 0.7 })));
}

function ColourPanel() {
  useStore();
  const st = store.settings;
  const [hsl, setHsl] = React.useState(null);
  const [hexText, setHexText] = React.useState(null);
  const cur = hsl && hslToHex(hsl.h, hsl.s, hsl.l) === st.color ? hsl : hexToHsl(st.color);
  const setColour = hex => { setHsl(null); setHexText(null); store.saveSettings({ color: hex }); };
  const setHslPart = (part, v) => {
    const next = { ...cur, [part]: v };
    setHsl(next); setHexText(null);
    store.saveSettings({ color: hslToHex(next.h, next.s, next.l) });
  };
  const shownHex = hexText === null ? st.color : hexText;
  const hexValid = /^#?[0-9a-fA-F]{6}$/.test(shownHex);
  const swatch = hex => {
    const pick = () => setColour(hex);
    return h(Focusable, {
      key: hex, onActivate: pick, onClick: pick, title: hex,
      style: { width: 28, height: 28, borderRadius: 6, background: hex, cursor: 'pointer', boxSizing: 'border-box', border: hex === st.color ? '2px solid #fff' : '1px solid rgba(255,255,255,.28)' },
    });
  };
  const dd = (opts, value, onPick) => h(Dropdown, {
    rgOptions: opts.map(o => ({ data: o.data, label: o.label })),
    selectedOption: Math.max(0, opts.findIndex(o => o.value === value)),
    strDefaultLabel: opts[Math.max(0, opts.findIndex(o => o.value === value))].label,
    onChange: o => onPick(opts.find(x => x.data === o.data)),
  });
  return h('div', { style: { display: 'flex', flexDirection: 'column' } },
    h(Field, { label: 'Colours', description: 'Colour of the tab and of the note box outline, on store, community and profile pages.' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } }, h(TabIcon, { st, scale: 0.6 }), h('span', { style: { opacity: 0.75, fontSize: 12 } }, st.color))),
    h(Field, { label: 'Swatches' }, h(Focusable, { style: { display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 300, justifyContent: 'flex-end' } }, SWATCHES.map(swatch))),
    h(SliderField, { label: 'Hue', value: cur.h, min: 0, max: 360, step: 1, showValue: true, onChange: v => setHslPart('h', v) }),
    h(SliderField, { label: 'Saturation', value: cur.s, min: 0, max: 100, step: 1, showValue: true, valueSuffix: '%', onChange: v => setHslPart('s', v) }),
    h(SliderField, { label: 'Lightness', value: cur.l, min: 5, max: 95, step: 1, showValue: true, valueSuffix: '%', onChange: v => setHslPart('l', v) }),
    h(TextField, {
      value: shownHex, placeholder: '#1a9fff',
      onChange: e => {
        const raw = e.target.value.trim();
        setHexText(raw);
        const hex = raw.startsWith('#') ? raw : '#' + raw;
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) { setHsl(null); store.saveSettings({ color: hex.toLowerCase() }); }
      },
    }),
    hexValid ? null : h(Field, { label: 'Enter six hex digits, like #1a9fff.' }),
    h(Field, { label: 'Icon colour', description: 'The note icon on the tab.' }, dd(ICON_OPTIONS, st.iconcolor, o => store.saveSettings({ iconcolor: o.value }))));
}

function backupStatus(bk) {
  if (!bk) return 'Checking…';
  if (!bk.enabled) return "Off. Notes are only stored in Steam's config folder.";
  if (bk.error) return `Could not write a copy: ${bk.error}. Folder: ${bk.dir}`;
  if (bk.saved_at > 0) return `Last copy ${new Date(bk.saved_at * 1000).toLocaleString()}, ${bk.count} notes, in ${bk.dir}`;
  return 'No copy yet.';
}

function NotesManager() {
  useStore();
  const [query, setQuery] = React.useState('');
  const [limit, setLimit] = React.useState(PAGE_SIZE);
  const [kindIdx, setKindIdx] = React.useState(0);
  const [newId, setNewId] = React.useState('');
  const [newText, setNewText] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [confirmKey, setConfirmKey] = React.useState('');
  const [info, setInfo] = React.useState(null);
  const [diagOn, setDiagOn] = React.useState(diag.on);
  const [folderText, setFolderText] = React.useState(null);
  const [confirmRestore, setConfirmRestore] = React.useState('');

  React.useEffect(() => {
    if (store.status === 'idle') store.load();
    backend('get_info').then(r => { if (r.ok) setInfo(r); });
    store.refreshBackup();
  }, []);

  const q = query.trim().toLowerCase();
  const rows = Object.keys(store.notes)
    .map(key => ({ key, note: store.notes[key] || {} }))
    .filter(r => !q || r.key.toLowerCase().includes(q) || String(r.note.text || '').toLowerCase().includes(q) || String(r.note.label || '').toLowerCase().includes(q))
    .sort((a, b) => (b.note.updated || 0) - (a.note.updated || 0));

  const addNote = async () => {
    const kind = KINDS[kindIdx].kind;
    const id = normaliseId(kind, newId);
    if (!id) { setMsg(kind === 'app' ? 'App ID must be digits only.' : kind === 'page' ? 'Enter a store.steampowered.com or steamcommunity.com address (not login, checkout or account pages).' : 'Enter a 17-digit SteamID64 or the number from a friend code.'); return; }
    if (!newText.trim()) { setMsg('Write a note first.'); return; }
    const r = await store.save(`${kind}:${id}`, newText, '');
    if (r.ok) { setMsg('Saved.'); setNewId(''); setNewText(''); } else setMsg(`${r.error}${r.detail ? ': ' + r.detail : ''}`);
  };

  const copyReport = async () => {
    const json = JSON.stringify(diag.report(), null, 2);
    try { await navigator.clipboard.writeText(json); setMsg(`Copied ${diag.seen.size} entries.`); }
    catch (e) { console.log(`[${PLUGIN}] diagnostics report`, json); setMsg('Clipboard blocked; report written to the console.'); }
  };

  const children = [];

  children.push(h(Field, { key: 'about', label: 'More Notes', description: 'Private notes on people and games. They show up on store, community, profile and wishlist pages, and are managed here.' }));

  if (store.status === 'loading' || store.status === 'idle') {
    children.push(h(Field, { key: 'loading', label: 'Loading notes…' }));
  } else if (store.status === 'error') {
    children.push(h(Field, { key: 'error', label: 'Could not load notes', description: `${store.error.code}${store.error.detail ? ': ' + store.error.detail : ''}` }));
    children.push(action({ key: 'retry', label: 'Try again', onClick: () => store.load() }));
  }

  // Note tab appearance
  const st = store.settings;
  const pick = (opts, value) => Math.max(0, opts.findIndex(o => o.value === value));
  const dropdown = (opts, value, onPick) => h(Dropdown, {
    rgOptions: opts.map(o => ({ data: o.data, label: o.label })),
    selectedOption: pick(opts, value),
    strDefaultLabel: opts[pick(opts, value)].label,
    onChange: o => onPick(opts.find(x => x.data === o.data)),
  });

  children.push(h(Field, { key: 'pill-head', label: 'Note tab', description: 'A small tab docked to the side of store, community and profile pages. Click it to expand a box for writing the note. Open pages pick up changes when you switch back to them.' }));
  children.push(h(Field, { key: 'pill-on', label: 'Show the tab' }, h(Toggle, { value: st.pill, onChange: v => store.saveSettings({ pill: v }) })));
  children.push(h(Field, { key: 'pill-side', label: 'Side' }, dropdown(SIDE_OPTIONS, st.side, o => store.saveSettings({ side: o.value }))));
  children.push(h(SliderField, { key: 'pill-offset', label: 'Up/down offset (all tabs)', value: st.vertical - 50, min: -OFFSET_LIMIT, max: OFFSET_LIMIT, step: 1, showValue: true, valueSuffix: '%', onChange: v => store.saveSettings({ vertical: 50 + v }) }));
  children.push(h(Field, { key: 'pill-place', label: 'Final location', description: 'A copy of the tab icon on the side it will sit, at the offset above. Negative moves every tab up, positive down; the dashed line is the middle of the page.' }));
  children.push(h('div', { key: 'pill-place-box', style: { padding: '4px 0 14px' } }, h(PlacementPreview, { st })));
  children.push(h(Field, { key: 'pill-shape', label: 'Shape' }, dropdown(SHAPE_OPTIONS, st.shape, o => store.saveSettings({ shape: o.value }))));
  children.push(h(Field, { key: 'pill-size', label: 'Size' }, dropdown(SIZE_OPTIONS, st.size, o => store.saveSettings({ size: o.value }))));
  children.push(h(ColourPanel, { key: 'pill-colours' }));
  children.push(h(Field, { key: 'libtab', label: 'Notes tab on game pages', description: "Adds a Notes tab to the tab row of a game's library page, next to Achievements. Takes effect the next time a game page opens." },
    h(Toggle, { value: st.libtab, onChange: v => store.saveSettings({ libtab: v }) })));
  children.push(h(Field, { key: 'pill-inline', label: 'Also show a note line under titles', description: 'The older inline note under the game or persona name. List pages (friends, wishlist) always show per-row notes.' },
    h(Toggle, { value: st.inline, onChange: v => store.saveSettings({ inline: v }) })));
  if (store.settingsError) children.push(h(Field, { key: 'pill-err', label: 'Could not save appearance', description: store.settingsError }));

  // Automatic backup outside the plugin
  const bk = store.backupInfo;
  const shownFolder = folderText === null ? st.backupdir : folderText;
  const restoreRow = (key, which, idle, armed) => action({
    key, label: confirmRestore === which ? armed : idle,
    onClick: () => { if (confirmRestore !== which) { setConfirmRestore(which); return; } setConfirmRestore(''); store.restoreBackup(which); },
  });
  children.push(h(Field, { key: 'bk-head', label: 'Automatic backup', description: "Your notes and settings are kept in Steam's config folder, outside the plugin, so updating or reinstalling the plugin never touches them. This also keeps a second copy, updated on every change, with one snapshot per weekday, in the More-Notes folder the plugin creates inside Steam's millennium folder (or a folder you choose below). If the main file goes missing or is damaged, it is restored from the copy automatically." }));
  children.push(h(Field, { key: 'bk-on', label: 'Keep a second copy' }, h(Toggle, { value: st.backup, onChange: v => { store.saveSettings({ backup: v }); setTimeout(() => store.refreshBackup(), 700); } })));
  children.push(h(TextField, { key: 'bk-dir', value: shownFolder, placeholder: (bk && bk.default_dir) || 'Default folder', onChange: e => setFolderText(e.target.value) }));
  children.push(action({ key: 'bk-use', label: 'Use this folder', onClick: () => store.setBackupDir(shownFolder) }));
  if (st.backupdir) children.push(action({ key: 'bk-default', label: 'Use the default folder', onClick: () => { setFolderText(''); store.setBackupDir(''); } }));
  children.push(h(Field, { key: 'bk-status', label: 'Backup status', description: backupStatus(bk) }));
  if (bk && bk.restored_from) children.push(h(Field, { key: 'bk-restored', label: 'Restored at start-up', description: `Notes were recovered from ${bk.restored_from} because the main file was missing or damaged.` }));
  if (store.backupMsg) children.push(h(Field, { key: 'bk-msg', label: store.backupMsg }));
  children.push(action({ key: 'bk-now', label: 'Back up now', onClick: () => store.backupNow() }));
  children.push(restoreRow('bk-restore', 'latest', 'Restore notes and settings from the backup copy', 'Click again to replace your notes with the backup copy'));
  children.push(restoreRow('bk-prev', 'previous', 'Undo: restore the latest snapshot from an earlier day', 'Click again to restore the earlier snapshot'));

  // Add a note by id
  children.push(h(Field, { key: 'add-kind', label: 'Add a note', description: 'Pick what the note is about, then enter its id.' },
    h(Dropdown, { rgOptions: KINDS.map(k => ({ data: k.data, label: k.label })), selectedOption: kindIdx, strDefaultLabel: KINDS[kindIdx].label, onChange: o => setKindIdx(o.data) })));
  children.push(h(TextField, { key: 'add-id', value: newId, placeholder: kindIdx === 1 ? 'App ID, e.g. 620' : kindIdx === 2 ? 'Address, e.g. store.steampowered.com/' : 'SteamID64 or friend code number', onChange: e => setNewId(e.target.value) }));
  children.push(h(TextField, { key: 'add-text', value: newText, placeholder: 'Note', onChange: e => setNewText(clampNote(e.target.value)) }));
  children.push(h(NoteCounter, { key: 'add-count', text: newText }));
  children.push(action({ key: 'add-go', label: 'Save note', onClick: addNote }));
  if (msg) children.push(h(Field, { key: 'msg', label: msg }));

  // Search + list
  children.push(h(TextField, { key: 'search', value: query, placeholder: `Search ${Object.keys(store.notes).length} notes…`, bShowClearAction: true, onChange: e => { setQuery(e.target.value); setLimit(PAGE_SIZE); } }));
  if (store.status === 'ready' && rows.length === 0) {
    children.push(h(Field, { key: 'empty', label: q ? 'No notes match.' : 'No notes yet.' }));
  }
  rows.slice(0, limit).forEach(({ key, note }) => {
    const d = describeKey(key);
    const title = `${d.kindLabel}: ${note.label || d.id}`;
    children.push(h(Field, { key: 'n-' + key, label: title, description: note.text || '', bottomSeparator: 'none' },
      h(Focusable, { style: { display: 'flex', gap: '8px' } },
        h(DialogButton, { onClick: () => openEditor(key, note.label || ''), style: { minWidth: '80px' } }, 'Edit'),
        h(DialogButton, {
          onClick: async () => {
            if (confirmKey !== key) { setConfirmKey(key); return; }
            setConfirmKey('');
            const r = await store.remove(key);
            if (!r.ok) setMsg(`${r.error}${r.detail ? ': ' + r.detail : ''}`);
          },
          style: { minWidth: '80px' },
        }, confirmKey === key ? 'Confirm?' : 'Delete'))));
  });
  if (rows.length > limit) {
    children.push(action({ key: 'more', label: `Show ${Math.min(PAGE_SIZE, rows.length - limit)} more`, onClick: () => setLimit(limit + PAGE_SIZE) }));
  }

  // Storage + diagnostics
  children.push(h(Field, { key: 'storage', label: 'Notes file', description: info ? `${info.path} (${info.count} notes)` : 'Checking…' }));
  children.push(action({ key: 'reload', label: 'Reload notes', onClick: () => store.load() }));
  if (SHOW_DIAGNOSTICS) {
    children.push(h(Field, { key: 'diag', label: 'Collect friends/chat diagnostics', description: 'Developer option. Records Steam element names and id fields (never message text) so friends-list and chat notes can be added. Turn on, open your friends list and a chat, then copy the report.' },
      h(Toggle, { value: diagOn, onChange: v => { if (v) diag.start(); else diag.stop(); setDiagOn(diag.on); } })));
    if (diagOn) children.push(action({ key: 'diag-copy', label: 'Copy diagnostics report', onClick: copyReport }));
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column' } }, children);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
const icon = h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  h('path', { d: 'M5 3h10l4 4v14H5z' }), h('path', { d: 'M15 3v4h4' }), h('path', { d: 'M8 12h8M8 16h6' }));

async function main() {
  try { window.__moreNotes && window.__moreNotes.dispose && window.__moreNotes.dispose(); } catch (e) { /* previous instance */ }
  window.__moreNotes = {
    version: VERSION,
    store,
    diag,
    libtab,
    openEditor,
    dispose() { diag.stop(); libtab.stop(); jsxHooks.teardown(); },
  };
  store.load(); // not awaited: a slow backend must not delay the plugin
  // wait for Steam's services before patching its UI (never blocks the settings page)
  Promise.resolve()
    .then(() => (window.App && typeof window.App.WaitForServicesInitialized === 'function' ? window.App.WaitForServicesInitialized() : null))
    .catch(() => null)
    .then(() => libtab.start());
  return { title: 'More Notes', icon, content: h(NotesManager) };
}
