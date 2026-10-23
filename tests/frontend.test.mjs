// Logic tests against stubs only (mini React, fake backend, stub Millennium API).
// They do NOT prove behaviour inside real Steam.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = readFileSync(join(root, '.millennium', 'Dist', 'index.js'), 'utf8');

// ---- mini React with hooks ----------------------------------------------------------------
const hookState = new Map();
let currentPath = '';
let hookIndex = 0;
let rootRender = null;
const effects = [];

const React = {
  createElement(type, props, ...children) {
    const flat = children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false);
    return { type, props: { ...(props || {}), children: flat.length === 1 ? flat[0] : flat.length ? flat : (props && props.children) }, _children: flat.length ? flat : null };
  },
  useState(init) {
    const key = currentPath + '#' + hookIndex++;
    if (!hookState.has(key)) hookState.set(key, { value: typeof init === 'function' ? init() : init });
    const slot = hookState.get(key);
    return [slot.value, v => { slot.value = typeof v === 'function' ? v(slot.value) : v; if (rootRender) rootRender(); }];
  },
  useEffect(fn) { const key = currentPath + '#e' + hookIndex++; if (!hookState.has(key)) { hookState.set(key, { ran: true }); effects.push(fn); } },
};

function expand(node, path) {
  if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map((n, i) => expand(n, path + '.' + i));
  if (typeof node.type === 'function') {
    const savedPath = currentPath, savedIdx = hookIndex;
    currentPath = path; hookIndex = 0;
    const out = node.type(node.props);
    currentPath = savedPath; hookIndex = savedIdx;
    return { host: node.type.name || 'Component', props: node.props, kids: expand(out, path + '/c') };
  }
  const kids = [];
  const children = node.props.children;
  const list = Array.isArray(children) ? children : children === undefined ? [] : [children];
  list.forEach((c, i) => kids.push(expand(c, path + '.' + (c && c.props && c.props.key !== undefined ? c.props.key : i))));
  return { host: node.type, props: node.props, kids };
}

function walk(tree, fn) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return;
  if (Array.isArray(tree)) { tree.forEach(t => walk(t, fn)); return; }
  fn(tree);
  walk(tree.kids, fn);
}
function findAll(tree, pred) { const out = []; walk(tree, n => { if (pred(n)) out.push(n); }); return out; }
function textOf(tree) {
  let s = '';
  walk(tree, n => { if (n.props) { for (const k of ['label', 'description', 'placeholder']) if (typeof n.props[k] === 'string') s += n.props[k] + '|'; } });
  const collect = t => { if (typeof t === 'string') s += t + '|'; else if (Array.isArray(t)) t.forEach(collect); else if (t && t.kids) collect(t.kids); };
  collect(tree);
  return s;
}

// ---- stub components -------------------------------------------------------------------------
const stub = name => { const f = props => React.createElement('div', { ...props, _stub: name }, props.children); Object.defineProperty(f, 'name', { value: name }); return f; };

// ---- fake backend (mirrors the Lua semantics we rely on) -------------------------------------
const backendNotes = {};
let backendSettings = { pill: true, facing: 'right', vertical: 50, shape: 'pill', size: 'medium', color: '#1a9fff', inline: false, backup: true, backupdir: '', iconcolor: 'auto', libtab: false, libdock: true };
let backupInfoReply = { ok: true, enabled: true, dir: 'C:/Users/me/Documents/MoreNotes', saved_at: 1760700000, count: 3, error: '', restored_from: '', default_dir: 'C:/Users/me/Documents/MoreNotes', default_file: 'C:/Users/me/Documents/MoreNotes/MoreNotes_notes.json', snap_dir: 'C:/Users/me/Documents/MoreNotes' };
let restoreReply = { ok: true, count: 2, from: 'x' };
let acceptDir = true;
let backendDown = false;
const calls = [];
const Millennium = {
  async callServerMethod(plugin, fn, args) {
    calls.push({ plugin, fn, args });
    for (const [k, v] of Object.entries(args || {})) if (typeof v !== 'string') throw new Error('non-string argument ' + k + ' would crash the real backend');
    if (Object.keys(args || {}).length && Object.keys(args).join() !== 'json') throw new Error('arguments must be one packed json string, got keys: ' + Object.keys(args));
    const unpacked = args && args.json ? JSON.parse(args.json) : (args || {});
    if (backendDown) throw new Error('RPC timeout for child: MoreNotes');
    if (fn === 'get_all') return JSON.stringify({ ok: true, notes: backendNotes, settings: backendSettings });
    if (fn === 'backup_info') return JSON.stringify(backupInfoReply);
    if (fn === 'backup_now') return JSON.stringify({ ...backupInfoReply, ok: true });
    if (fn === 'restore_backup') return JSON.stringify(restoreReply);
    if (fn === 'set_settings') { const incoming = JSON.parse(args.json); if ('backupdir' in incoming && !acceptDir) delete incoming.backupdir; if ('backupfile' in incoming && !acceptDir) delete incoming.backupfile; if ('snapdir' in incoming && !acceptDir) delete incoming.snapdir; backendSettings = { ...backendSettings, ...incoming }; return JSON.stringify({ ok: true, settings: backendSettings }); }
    if (fn === 'get_info') return JSON.stringify({ ok: true, path: 'C:/Steam/config/MoreNotes_notes.json', count: Object.keys(backendNotes).length });
    if (fn === 'set_note') {
      if (!/^[\w:.\-\/~]+$/.test(unpacked.key || '')) return JSON.stringify({ ok: false, error: 'bad_key' });
      const text = String(unpacked.text || '').trim();
      if (!text) delete backendNotes[unpacked.key]; else backendNotes[unpacked.key] = { text, label: unpacked.label || '', updated: 1 };
      return JSON.stringify({ ok: true, key: unpacked.key });
    }
    return JSON.stringify({ ok: false, error: 'unknown_fn' });
  },
};

const modalCalls = [];
const patched = [];
const jsxRuntime = { jsx() {}, jsxs() {} };
const API = {
  Field: stub('Field'), ButtonItem: stub('ButtonItem'), Toggle: stub('Toggle'), Dropdown: stub('Dropdown'),
  TextField: stub('TextField'), Focusable: stub('Focusable'), DialogButton: stub('DialogButton'),
  DialogButtonPrimary: stub('DialogButtonPrimary'), ModalRoot: stub('ModalRoot'), SliderField: stub('SliderField'),
  showModal: (el, win, opts) => { modalCalls.push({ el, win, opts }); },
  findModuleByExport: () => jsxRuntime,
  // like Steam's: replaces the function with a wrapper, so the watchdog sees it was patched
  beforePatch: (obj, name, cb) => {
    const original = obj[name];
    obj[name] = function (...a) { cb(a); return original.apply(this, a); };
    patched.push({ name, cb });
    return { unpatch() { obj[name] = original; patched.length = 0; } };
  },
};

const window = {
  SP_REACT: React, MILLENNIUM_API: API, PLUGIN_LIST: {}, MILLENNIUM_SIDEBAR_NAVIGATION_PANELS: {},
  g_PopupManager: { GetExistingPopup: id => ({ id }) },
  appStore: { GetAppOverviewByAppID: id => (id === 620 ? { display_name: 'Portal 2' } : null) },
};
const ctx = {
  window, Millennium, console, setInterval, clearInterval, setTimeout, clearTimeout, Date, JSON, BigInt, Promise, URL,
  navigator: { clipboard: { writeText: async t => { ctx.__clip = t; } } },
  MILLENNIUM_BACKEND_IPC: { postMessage() {} },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(built, ctx);

const tick = () => new Promise(r => setTimeout(r, 20));
await tick();

// ---- tests -------------------------------------------------------------------------------------
const assertSame = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  -', name); };

const panel = window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS.MoreNotes;
function renderPanel() {
  hookIndex = 0; currentPath = 'root';
  return expand(panel.content, 'root');
}
let tree;
const rerender = () => { tree = renderPanel(); };
rootRender = rerender;

await test('registers a sidebar panel with title, icon and content', () => {
  assert.equal(panel.title, 'More Notes');
  assert.ok(panel.icon && panel.content);
  assert.ok(window.__moreNotes && window.__moreNotes.store);
  assert.ok(calls.some(c => c.fn === 'get_all' && c.plugin === 'MoreNotes'));
});

rerender();
effects.splice(0).forEach(fn => fn());
await tick(); rerender();

await test('renders empty state after load', () => {
  assert.match(textOf(tree), /No notes yet\./);
  assert.match(textOf(tree), /MoreNotes_notes\.json/);
});

const fields = () => findAll(tree, n => n.host === 'TextField');
const buttons = () => findAll(tree, n => n.host === 'ButtonItem');
const clickAction = async label => {
  const b = buttons().find(x => x.props.label === label);
  assert.ok(b, 'button not found: ' + label);
  b.props.onClick(); await tick(); rerender();
};

await test('adds a person note from a short friend-code number (converted to SteamID64)', async () => {
  fields().find(f => /SteamID64/.test(f.props.placeholder)).props.onChange({ target: { value: '1234' } }); rerender();
  fields().find(f => f.props.placeholder === 'Note').props.onChange({ target: { value: 'met at the LAN party' } }); rerender();
  await clickAction('Save note');
  assert.equal(backendNotes['user:76561197960266962'].text, 'met at the LAN party');
  assert.match(textOf(tree), /met at the LAN party/);
});

await test('rejects bad ids without calling the backend', async () => {
  const before = calls.length;
  fields().find(f => /SteamID64/.test(f.props.placeholder)).props.onChange({ target: { value: 'abc' } }); rerender();
  fields().find(f => f.props.placeholder === 'Note').props.onChange({ target: { value: 'x' } }); rerender();
  await clickAction('Save note');
  assert.equal(calls.length, before);
  assert.match(textOf(tree), /SteamID64 or the number from a friend code/);
});

await test('adds a game note by app id', async () => {
  const addField = findAll(tree, n => n.host === 'Field' && n.props.label === 'Add a note')[0];
  findAll(addField, n => n.host === 'Dropdown')[0].props.onChange({ data: 1 }); rerender();
  fields().find(f => /App ID/.test(f.props.placeholder)).props.onChange({ target: { value: '620' } }); rerender();
  fields().find(f => f.props.placeholder === 'Note').props.onChange({ target: { value: 'play co-op with Sam' } }); rerender();
  await clickAction('Save note');
  assert.equal(backendNotes['app:620'].text, 'play co-op with Sam');
});

await test('adds a page note by address; rejects other sites and checkout pages', async () => {
  const addField = findAll(tree, n => n.host === 'Field' && n.props.label === 'Add a note')[0];
  findAll(addField, n => n.host === 'Dropdown')[0].props.onChange({ data: 2 }); rerender();
  const idField = () => fields().find(f => /^Address/.test(f.props.placeholder));
  const bad = ['https://example.com/', 'store.steampowered.com/checkout/'];
  for (const b of bad) {
    const before = calls.length;
    idField().props.onChange({ target: { value: b } }); rerender();
    fields().find(f => f.props.placeholder === 'Note').props.onChange({ target: { value: 'x' } }); rerender();
    await clickAction('Save note');
    assert.equal(calls.length, before, b + ' must not reach the backend');
  }
  assert.match(textOf(tree), /store\.steampowered\.com or steamcommunity\.com address/);
  idField().props.onChange({ target: { value: 'https://store.steampowered.com/?utm=1' } }); rerender();
  fields().find(f => f.props.placeholder === 'Note').props.onChange({ target: { value: 'front page deals' } }); rerender();
  await clickAction('Save note');
  assert.equal(backendNotes['page:store.steampowered.com/'].text, 'front page deals');
  assert.match(textOf(tree), /Page: store\.steampowered\.com\//);
});

await test('search filters the list', async () => {
  fields().find(f => /^Search/.test(f.props.placeholder)).props.onChange({ target: { value: 'lan party' } }); rerender();
  const t = textOf(tree);
  assert.match(t, /lan party/i);
  assert.doesNotMatch(t, /co-op with Sam/);
  fields().find(f => /^Search/.test(f.props.placeholder)).props.onChange({ target: { value: '' } }); rerender();
});

const counterText = t => { let out = ''; walk(t, n => { if (n.host === 'NoteCounter') out += textOf(n); }); return out; };

await test('Edit expands an inline editor under the row; no popup is needed', async () => {
  const modalsBefore = modalCalls.length;
  const editBtn = () => findAll(findAll(tree, n => n.host === 'Field' && n.props.label === 'Game: 620')[0], n => n.host === 'DialogButton').find(b => b.props.children === 'Edit' || b.props.children === 'Close');
  const original = backendNotes['app:620'].text;
  editBtn().props.onClick(); rerender();
  assert.equal(modalCalls.length, modalsBefore, 'Edit never calls showModal');
  const field = () => findAll(tree, n => n.host === 'TextField' && n.props.placeholder === 'Write a note…')[0];
  assert.ok(field(), 'the inline text box appears');
  assert.ok(findAll(tree, n => n.host === 'DialogButton').some(b => b.props.children === 'Close'), 'the row button becomes Close');
  assert.match(counterText(tree), /\d+ \/ 4000/);
  field().props.onChange({ target: { value: 'edited in place' } }); rerender();
  assert.match(counterText(tree), /15 \/ 4000/);
  // Cancel discards
  findAll(tree, n => n.host === 'DialogButton').find(b => b.props.children === 'Cancel').props.onClick(); rerender();
  assert.equal(field(), undefined);
  assert.equal(backendNotes['app:620'].text, original);
  // Save writes the note
  editBtn().props.onClick(); rerender();
  field().props.onChange({ target: { value: 'edited in place' } }); rerender();
  await findAll(tree, n => n.host === 'DialogButtonPrimary').find(b => b.props.children === 'Save').props.onClick(); await tick(); rerender();
  assert.equal(backendNotes['app:620'].text, 'edited in place');
  assert.equal(field(), undefined, 'the editor closes after saving');
  assert.match(textOf(tree), /edited in place/);
});


await test('the native note editor opens over the best available window', async () => {
  assert.equal(window.__moreNotes.openEditor('app:620', 'Portal 2'), true);
  assert.equal(modalCalls.at(-1).win.id, 'SP Desktop_uid0');
  assert.equal(modalCalls.at(-1).opts.strTitle, 'Note');
  // the window the click came from is tried first
  window.__moreNotes.openEditor('app:620', 'Portal 2', { view: { marker: 'click-window' } });
  assert.equal(modalCalls.at(-1).win.marker, 'click-window');
  // a parent that throws is skipped
  const real = API.showModal;
  API.showModal = (el, win, opts) => { if (win && win.marker === 'bad') throw new Error('refused'); return real(el, win, opts); };
  assert.equal(window.__moreNotes.openEditor('app:620', 'Portal 2', { view: { marker: 'bad' } }), true);
  assert.equal(modalCalls.at(-1).win.id, 'SP Desktop_uid0', 'fell back to the Library window');
  API.showModal = () => { throw new Error('nothing works'); };
  assert.equal(window.__moreNotes.openEditor('app:620', 'Portal 2'), false, 'reports failure when every parent refuses');
  API.showModal = real;
});

await test('editor saves a changed note and closes', async () => {
  const el = modalCalls.find(c => c.opts && c.opts.strTitle === 'Note').el;
  let closed = false;
  const editorProps = { ...el.props, closeModal: () => { closed = true; } };
  hookIndex = 0; currentPath = 'editor';
  const edTree = expand({ ...el, props: editorProps }, 'editor');
  const tf = findAll(edTree, n => n.host === 'TextField')[0];
  tf.props.onChange({ target: { value: 'edited text' } });
  hookIndex = 0; currentPath = 'editor';
  const ed2 = expand({ ...el, props: editorProps }, 'editor');
  const save = findAll(ed2, n => n.host === 'DialogButtonPrimary')[0];
  await save.props.onClick(); await tick();
  assert.ok(closed);
  assert.equal(Object.values(backendNotes).some(n => n.text === 'edited text'), true);
  rerender();
});

const counterNode = t => findAll(t, n => n.host === 'NoteCounter')[0];

await test('note editor shows "current / maximum" beneath the writing area and clamps at the limit', async () => {
  const el = modalCalls.find(c => c.opts && c.opts.strTitle === 'Note').el;
  const render = () => { hookIndex = 0; currentPath = 'edcount'; return expand({ ...el, props: { ...el.props, closeModal() {} } }, 'edcount'); };
  let t = render();
  const field = () => findAll(t, n => n.host === 'TextField')[0];
  assert.match(counterText(t), /\d+ \/ 4000/);
  // the counter sits after the text field in the layout
  const kinds = findAll(t, n => n.host === 'TextField' || n.host === 'NoteCounter').map(n => n.host);
  assertSame(kinds, ['TextField', 'NoteCounter']);
  field().props.onChange({ target: { value: 'héllo' } }); t = render();
  assert.match(counterText(t), /5 \/ 4000/);
  assert.equal(counterNode(t).kids.props.style.color, undefined, 'plain colour when far from the limit');
  field().props.onChange({ target: { value: 'a'.repeat(3700) } }); t = render();
  assert.equal(counterNode(t).kids.props.style.color, '#e8b24a', 'amber from 90%');
  field().props.onChange({ target: { value: 'a'.repeat(4005) } }); t = render();
  assert.match(counterText(t), /4000 \/ 4000/);
  assert.equal(field().props.value.length, 4000, 'typing past the limit is cut');
  assert.match(String(counterNode(t).kids.props.style.color), /gpColor-Red/, 'red at the limit');
  field().props.onChange({ target: { value: '😀'.repeat(4001) } }); t = render();
  assert.match(counterText(t), /4000 \/ 4000/, 'an emoji counts once, like the backend counts it');
  assert.equal(Array.from(field().props.value).length, 4000);
});

await test('settings add-note form shows a counter too', () => {
  assert.match(textOf(tree), /0 \/ 4000/);
  fields().find(f => f.props.placeholder === 'Note').props.onChange({ target: { value: 'hello' } }); rerender();
  assert.match(counterText(tree), /5 \/ 4000/);
  fields().find(f => f.props.placeholder === 'Note').props.onChange({ target: { value: '' } }); rerender();
});

await test('delete needs a second click', async () => {
  const del = () => findAll(tree, n => n.host === 'DialogButton').find(b => b.props.children === 'Delete' || b.props.children === 'Confirm?');
  const count = Object.keys(backendNotes).length;
  del().props.onClick(); await tick(); rerender();
  assert.equal(Object.keys(backendNotes).length, count, 'first click must not delete');
  assert.equal(del().props.children, 'Confirm?');
  del().props.onClick(); await tick(); rerender();
  assert.equal(Object.keys(backendNotes).length, count - 1);
});

await test('empty text deletes through set_note', async () => {
  const r = await window.__moreNotes.store.save('app:620', '   ', '');
  assert.ok(r.ok);
  assert.equal(backendNotes['app:620'], undefined);
});


const settingsCalls = () => calls.filter(c => c.fn === 'set_settings');
const labelRow = label => findAll(tree, n => n.host === 'Field' && n.props.label === label)[0];
const wait = ms => new Promise(r => setTimeout(r, ms));

await test('settings section lists the tab options with defaults from the backend', () => {
  const t = textOf(tree);
  for (const l of ['Note tab', 'Show the tab', 'Facing', 'Up/down offset \\(all tabs\\)', 'Final location', 'Shape', 'Size', 'Colour', 'Notes tab on game pages']) assert.match(t, new RegExp(l));
  assert.doesNotMatch(t, /Swatches|Custom colour/, 'the custom colour panel stays hidden for a suggested colour');
  assert.equal(findAll(tree, n => n.host === 'SliderField').length, 1); // only the offset until Custom is chosen
  assert.doesNotMatch(t, /\|Side\|/, 'the old Side row is gone');
  const facing = labelRow('Facing');
  assert.equal(facing.props.description, 'Direction');
  const dd = findAll(facing, n => n.host === 'Dropdown')[0];
  assert.equal(dd.props.strDefaultLabel, 'Right edge');
  assertSame(dd.props.rgOptions.map(o => o.label), ['Left edge', 'Right edge', 'Top edge', 'Bottom edge', 'Top-left corner', 'Top-right corner', 'Bottom-left corner', 'Bottom-right corner', 'Address bar']);
  assert.equal(findAll(labelRow('Notes tab on game pages'), n => n.host === 'Toggle')[0].props.value, false, 'the library Notes tab is off by default');
  assert.equal(findAll(labelRow('Also show a note line under titles'), n => n.host === 'Toggle')[0].props.value, false, 'the inline note line is off by default');
});

await test('facing, shape and size dropdowns update locally at once and write after a pause', async () => {
  const before = settingsCalls().length;
  findAll(labelRow('Facing'), n => n.host === 'Dropdown')[0].props.onChange({ data: 0 }); rerender();
  findAll(labelRow('Shape'), n => n.host === 'Dropdown')[0].props.onChange({ data: 1 }); rerender();
  findAll(labelRow('Size'), n => n.host === 'Dropdown')[0].props.onChange({ data: 2 }); rerender();
  assert.equal(window.__moreNotes.store.settings.facing, 'left');
  assert.equal(window.__moreNotes.store.settings.shape, 'circle');
  assert.equal(window.__moreNotes.store.settings.size, 'large');
  assert.equal(settingsCalls().length, before, 'must debounce');
  await wait(450);
  assert.equal(settingsCalls().length, before + 1, 'three quick changes become one write');
  assert.equal(backendSettings.facing, 'left');
  assert.equal(backendSettings.shape, 'circle');
  assert.equal(backendSettings.size, 'large');
});

const sliderByLabel = label => findAll(tree, n => n.host === 'SliderField' && n.props.label === label)[0];
const hueOf = hex => { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; };

await test('offset slider is centred on 0, writes once, and moves the tab (negative = up)', async () => {
  const before = settingsCalls().length;
  const offset = () => sliderByLabel('Up/down offset (all tabs)');
  assert.equal(offset().props.value, 0);
  assert.equal(offset().props.min, -42); assert.equal(offset().props.max, 42);
  for (const v of [-10, -20, -33]) { offset().props.onChange(v); rerender(); }
  await wait(450);
  assert.equal(settingsCalls().length, before + 1);
  assert.equal(backendSettings.vertical, 17);
  assert.equal(offset().props.value, -33);
});

await test('the final-location preview copies the icon on the chosen edge and offset', () => {
  const prev = findAll(tree, n => n.host === 'PlacementPreview')[0];
  assert.ok(prev);
  assert.equal(prev.props.st.facing, 'left'); // set by the dropdown test above
  assert.equal(prev.props.st.vertical, 17);
  const icons = findAll(prev, n => n.host === 'TabIcon');
  assert.equal(icons.length, 1);
  assert.equal(icons[0].props.st.shape, 'circle');
  assert.equal(icons[0].props.st.size, 'large');
  // the absolutely positioned wrapper sits at 17% from the top on the left edge
  const wrapper = findAll(prev, n => n.host === 'div' && n.props.style && n.props.style.top === '17%')[0];
  assert.ok(wrapper, 'wrapper at 17%');
  assert.equal(wrapper.props.style.left, 6);
  assert.equal(wrapper.props.style.right, undefined);
});

const previewIcon = () => { const prev = findAll(tree, n => n.host === 'PlacementPreview')[0]; return { prev, icon: findAll(prev, n => n.host === 'TabIcon')[0] }; };
const iconStyle = () => previewIcon().icon.kids.props.style;
const wrapperStyle = () => findAll(previewIcon().prev, n => n.host === 'div' && n.props.style && n.props.style.position === 'absolute' && n.props.style.transform !== 'translate(-50%, -50%)' )[0].props.style;
const setLook = patch => { window.__moreNotes.store.saveSettings(patch); rerender(); };

await test('top and bottom edges: the offset runs left/right and the preview docks to that edge', () => {
  setLook({ facing: 'top' });
  assert.ok(labelRow('Facing') && sliderByLabel('Left/right offset (all tabs)'), 'slider is relabelled for a horizontal edge');
  assert.equal(sliderByLabel('Up/down offset (all tabs)'), undefined);
  assert.equal(sliderByLabel('Left/right offset (all tabs)').props.value, -33);
  const w = wrapperStyle();
  assert.equal(w.left, '17%'); assert.equal(w.top, 6); assert.equal(w.transform, 'translateX(-50%)');
  setLook({ facing: 'bottom', shape: 'tab' });
  const w2 = wrapperStyle();
  assert.equal(w2.bottom, 0, 'a tab is flush with its edge');
  const t = 12 * 0.7;
  assert.equal(iconStyle().borderRadius, `${t}px ${t}px 0 0`, 'rounded away from the bottom edge');
  assert.equal(iconStyle().width, 124 * 0.7, 'a tab lies flat on a horizontal edge (large size)');
  setLook({ facing: 'left', shape: 'circle' });
});

await test('corners ignore the offset; the dot floats, every other shape bends to follow the corner', () => {
  setLook({ facing: 'bottomright', shape: 'pill', size: 'medium' });
  assert.equal(sliderByLabel('Up/down offset (all tabs)'), undefined);
  assert.equal(sliderByLabel('Left/right offset (all tabs)'), undefined);
  assert.equal(labelRow('Offset (all tabs)').props.description, 'Corners ignore offset.');
  assert.equal(iconStyle().borderRadius, '100% 0 0 0', 'bent pill: only the inner corner is rounded');
  assert.equal(iconStyle().width, 68 * 0.7);
  assert.equal(iconStyle().height, 68 * 0.7);
  assertSame([wrapperStyle().bottom, wrapperStyle().right], [0, 0], 'flush in the corner');
  const expected = { topleft: '0 0 100% 0', topright: '0 0 0 100%', bottomleft: '0 100% 0 0', bottomright: '100% 0 0 0' };
  for (const f of Object.keys(expected)) { setLook({ facing: f, shape: 'pill' }); assert.equal(iconStyle().borderRadius, expected[f], f + ' pill'); }
  setLook({ facing: 'topleft', shape: 'tab' }); assert.equal(iconStyle().borderRadius, `0 0 ${18 * 0.7}px 0`);
  setLook({ facing: 'topleft', shape: 'square' }); assert.equal(iconStyle().borderRadius, `0 0 ${12 * 0.7}px 0`);
  setLook({ facing: 'topright', shape: 'circle' });
  assert.equal(iconStyle().borderRadius, '50%', 'the dot is not bent');
  assert.equal(iconStyle().width, 48 * 0.7);
  assertSame([wrapperStyle().top, wrapperStyle().right], [6, 6], 'the dot floats 6px in from the corner');
  setLook({ facing: 'left', shape: 'circle' });
  assert.ok(sliderByLabel('Up/down offset (all tabs)'), 'the offset slider returns for an edge');
});

await test('the Library tab has its own switch and status line', async () => {
  assert.match(textOf(tree), /Show the tab in the Library/);
  assert.equal(findAll(labelRow('Show the tab in the Library'), n => n.host === 'Toggle')[0].props.value, true, 'on by default');
  assert.match(textOf(tree), /Library tab status\|main window not found/, 'the stub popup has no window, and the status says so');
  findAll(labelRow('Show the tab in the Library'), n => n.host === 'Toggle')[0].props.onChange(false); rerender();
  await wait(450);
  assert.equal(backendSettings.libdock, false);
  assert.doesNotMatch(textOf(tree), /Library tab status/, 'no status line while it is off');
  findAll(labelRow('Show the tab in the Library'), n => n.host === 'Toggle')[0].props.onChange(true); rerender();
  await wait(450);
  assert.equal(backendSettings.libdock, true);
});

await test('choosing Address bar disables and hides the edge controls', () => {
  const rows = () => ({ offset: sliderByLabel('Up/down offset (all tabs)') || sliderByLabel('Left/right offset (all tabs)'), cornerNote: labelRow('Offset (all tabs)'),
    place: labelRow('Final location'), preview: findAll(tree, n => n.host === 'PlacementPreview')[0], size: labelRow('Size'), lib: labelRow('Show the tab in the Library'),
    libStatus: labelRow('Library tab status'), shape: labelRow('Shape'), colour: labelRow('Colour'), bar: labelRow('Address bar button status') });
  let r = rows(); assert.ok(r.offset && r.place && r.preview && r.size && r.lib && r.shape && r.colour); assert.equal(r.bar, undefined);
  findAll(labelRow('Facing'), n => n.host === 'Dropdown')[0].props.onChange({ data: 8 }); rerender();
  assert.equal(window.__moreNotes.store.settings.facing, 'addressbar');
  assert.equal(findAll(labelRow('Facing'), n => n.host === 'Dropdown')[0].props.strDefaultLabel, 'Address bar');
  r = rows();
  assert.equal(r.offset, undefined, 'offset hidden'); assert.equal(r.cornerNote, undefined); assert.equal(r.place, undefined, 'final location hidden');
  assert.equal(r.preview, undefined); assert.equal(r.size, undefined, 'size hidden');
  assert.equal(r.lib, undefined, 'the Library edge tab is hidden too'); assert.equal(r.libStatus, undefined);
  assert.ok(r.shape && r.colour, 'shape and colour still style the button');
  assert.ok(r.bar && /main window not found/.test(r.bar.props.description), 'an address bar status line appears');
  // and everything returns when an edge is chosen again
  findAll(labelRow('Facing'), n => n.host === 'Dropdown')[0].props.onChange({ data: 0 }); rerender();
  r = rows(); assert.ok(r.offset && r.place && r.preview && r.size && r.lib); assert.equal(r.bar, undefined);
  setLook({ facing: 'left', shape: 'circle' });
});

await test('an older saved side is understood as the facing', async () => {
  backendSettings = { ...backendSettings, facing: undefined, side: 'right' };
  delete backendSettings.facing;
  await window.__moreNotes.store.load(); rerender();
  assert.equal(window.__moreNotes.store.settings.facing, 'right');
  backendSettings = { ...backendSettings, facing: 'left' }; delete backendSettings.side;
  await window.__moreNotes.store.load(); rerender();
  assert.equal(window.__moreNotes.store.settings.facing, 'left');
  assert.equal(window.__moreNotes.store.settings.vertical, 17, 'offset survives a reload');
});

await test('colour is a short list of suggested colours; Custom opens the colour box as its own window', async () => {
  const st = () => window.__moreNotes.store.settings;
  const colourDd = () => findAll(labelRow('Colour'), n => n.host === 'Dropdown')[0];
  assertSame(colourDd().props.rgOptions.map(o => o.label), ['Steam blue', 'Green', 'Orange', 'Purple', 'Pink', 'Red', 'Grey', 'Custom']);
  assert.equal(colourDd().props.strDefaultLabel, 'Steam blue');
  colourDd().props.onChange({ data: 4 }); rerender();           // Pink
  assert.equal(st().color, '#e0589b');
  assert.equal(colourDd().props.strDefaultLabel, 'Pink');
  assert.doesNotMatch(textOf(tree), /Custom colour/);
  const popups = modalCalls.length;
  colourDd().props.onChange({ data: 7 }); rerender();           // Custom
  assert.equal(modalCalls.length, popups + 1, 'a popup opened');
  const call = modalCalls.at(-1);
  assert.equal(call.el.type.name, 'ColourPicker');
  assert.equal(call.opts.strTitle, 'Colour');
  assert.equal(call.el.props.initial.color, '#e0589b');
  assert.equal(st().color, '#e0589b', 'choosing Custom keeps the current colour');
  assert.match(textOf(tree), /Custom colour/);
  assert.ok(buttons().some(b => b.props.label === 'Open the colour box'), 'the box can be reopened');
  assert.equal(findAll(tree, n => n.host === 'SliderField').length, 1, 'nothing is drawn inline while the popup works');
  // the popup mounts: no inline fallback
  hookIndex = 0; currentPath = 'picker-mount'; expand(call.el, 'picker-mount'); effects.splice(0).forEach(fn => fn());
  await wait(1300); rerender();
  assert.doesNotMatch(textOf(tree), /did not open as its own window/);
  colourDd().props.onChange({ data: 0 }); rerender();           // back to Steam blue
  assert.equal(st().color, '#1a9fff');
  assert.doesNotMatch(textOf(tree), /Custom colour/);
});

await test('if the colour popup never mounts, the box is shown inside the settings page instead', async () => {
  const st = () => window.__moreNotes.store.settings;
  const colourDd = () => findAll(labelRow('Colour'), n => n.host === 'Dropdown')[0];
  colourDd().props.onChange({ data: 7 }); rerender();           // Custom; showModal accepts but nothing ever mounts
  await wait(1300); rerender();
  assert.match(textOf(tree), /did not open as its own window/);
  assert.equal(findAll(tree, n => n.host === 'ColourPicker').length, 1);
  assert.equal(sliderByLabel('Red').props.value, 26, 'the inline box starts from the current colour (#1a9fff)');
  await findAll(tree, n => n.host === 'DialogButton').find(b => b.props.children === 'Cancel').props.onClick(); rerender();
  assert.equal(findAll(tree, n => n.host === 'ColourPicker').length, 0, 'Cancel closes it');
  // when showModal refuses outright the box appears at once
  const real = API.showModal; API.showModal = () => { throw new Error('refused'); };
  colourDd().props.onChange({ data: 0 }); rerender();
  colourDd().props.onChange({ data: 7 }); rerender();
  assert.equal(findAll(tree, n => n.host === 'ColourPicker').length, 1, 'inline immediately when no popup can open');
  API.showModal = real;
  colourDd().props.onChange({ data: 0 }); rerender();
  assert.equal(st().color, '#1a9fff');
});

await test('the colour box: square, hue, saturation, brightness, RGB, hex, a full palette and the icon colour', async () => {
  const st = () => window.__moreNotes.store.settings;
  st(); window.__moreNotes.store.saveSettings({ color: '#e0589b', iconcolor: 'auto' }); rerender();
  assert.equal(window.__moreNotes.openColourPicker(undefined), true);
  const el = modalCalls.at(-1).el;
  let closed = 0;
  const props = { ...el.props, closeModal: () => { closed++; } };
  const render = path => { hookIndex = 0; currentPath = path; return expand({ ...el, props }, path); };
  let t = render('cp');
  const slider = label => findAll(t, n => n.host === 'SliderField' && n.props.label === label)[0];
  const hexField = () => findAll(t, n => n.host === 'TextField')[0];
  for (const l of ['Hue', 'Saturation', 'Brightness', 'Red', 'Green', 'Blue']) assert.ok(slider(l), l + ' slider');
  assert.equal([slider('Red').props.value, slider('Green').props.value, slider('Blue').props.value].join(), '224,88,155', 'RGB match the colour exactly');
  assert.equal(hexField().props.value, '#e0589b');
  assert.match(textOf(t), /#e0589b   rgb\(224, 88, 155\)/);
  const swatches = () => findAll(t, n => n.host === 'Focusable' && typeof n.props.title === 'string' && n.props.title.startsWith('#'));
  assert.equal(swatches().length, 72, 'a 12 x 5 colour grid plus a row of 12 greys');
  assert.equal(new Set(swatches().map(n => n.props.title)).size, 72, 'every swatch is a different colour');
  // RGB
  slider('Red').props.onChange(0); t = render('cp');
  assert.equal(hexField().props.value, '#00589b');
  slider('Blue').props.onChange(255); t = render('cp');
  assert.equal(hexField().props.value, '#0058ff');
  // hex
  hexField().props.onChange({ target: { value: 'FF8800' } }); t = render('cp');
  assert.equal([slider('Red').props.value, slider('Green').props.value, slider('Blue').props.value].join(), '255,136,0');
  hexField().props.onChange({ target: { value: 'zz' } }); t = render('cp');
  assert.match(textOf(t), /six hex digits/);
  assert.equal(slider('Red').props.value, 255, 'an invalid hex changes nothing');
  // palette
  swatches()[0].props.onClick(); t = render('cp');
  assert.equal(hexField().props.value, swatches()[0].props.title);
  // saturation / brightness / hue sliders
  hexField().props.onChange({ target: { value: '#2060c0' } }); t = render('cp');
  slider('Saturation').props.onChange(0); t = render('cp');
  assert.equal(slider('Saturation').props.value, 0);
  slider('Brightness').props.onChange(50); t = render('cp');
  assert.equal(hexField().props.value, '#808080', 'zero saturation is a grey');
  slider('Hue').props.onChange(120); slider('Saturation').props.onChange(100); t = render('cp');
  // the saturation/brightness square
  const square = () => findAll(t, n => n.host === 'div' && typeof n.props.onMouseDown === 'function')[0];
  const listeners = {};
  const fakeDoc = { addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener: type => { delete listeners[type]; } };
  const evt = (x, y) => ({ clientX: x, clientY: y, preventDefault() {}, currentTarget: { ownerDocument: fakeDoc, getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }) } });
  square().props.onMouseDown(evt(100, 25)); t = render('cp');
  assert.equal([slider('Saturation').props.value, slider('Brightness').props.value].join(), '50,75', 'clicking the square sets saturation and brightness');
  assert.equal(slider('Hue').props.value, 120, 'hue is untouched by the square');
  assert.ok(listeners.mousemove && listeners.mouseup, 'dragging is tracked');
  listeners.mousemove({ clientX: 260, clientY: -30 }); t = render('cp');
  assert.equal([slider('Saturation').props.value, slider('Brightness').props.value].join(), '100,100', 'dragging beyond the square is held at its edge');
  listeners.mouseup(); assert.equal(Object.keys(listeners).length, 0, 'drag listeners are removed on release');
  // icon colour + Use this colour
  hexField().props.onChange({ target: { value: 'FF8800' } }); t = render('cp');
  findAll(t, n => n.host === 'Dropdown')[0].props.onChange({ data: 2 }); t = render('cp');   // Dark
  assert.equal(st().color, '#e0589b', 'nothing is applied until the button is pressed');
  findAll(t, n => n.host === 'DialogButtonPrimary').find(b => b.props.children === 'Use this colour').props.onClick(); rerender();
  assert.equal(st().color, '#ff8800'); assert.equal(st().iconcolor, 'dark'); assert.equal(closed, 1);
  // Cancel discards
  window.__moreNotes.openColourPicker(undefined);
  const el2 = modalCalls.at(-1).el;
  hookIndex = 0; currentPath = 'cp2'; t = expand({ ...el2, props: { ...el2.props, closeModal: () => { closed++; } } }, 'cp2');
  findAll(t, n => n.host === 'TextField')[0].props.onChange({ target: { value: '00ff00' } });
  hookIndex = 0; currentPath = 'cp2'; t = expand({ ...el2, props: { ...el2.props, closeModal: () => { closed++; } } }, 'cp2');
  findAll(t, n => n.host === 'DialogButton').find(b => b.props.children === 'Cancel').props.onClick();
  assert.equal(st().color, '#ff8800', 'Cancel keeps the colour'); assert.equal(closed, 2);
  await wait(450);
  assert.equal(backendSettings.color, '#ff8800'); assert.equal(backendSettings.iconcolor, 'dark');
  window.__moreNotes.store.saveSettings({ color: '#1a9fff', iconcolor: 'auto' }); rerender();
});

await test('pill and inline toggles write through', async () => {
  findAll(labelRow('Show the tab'), n => n.host === 'Toggle')[0].props.onChange(false); rerender();
  findAll(labelRow('Also show a note line under titles'), n => n.host === 'Toggle')[0].props.onChange(true); rerender();
  await wait(450);
  assert.equal(backendSettings.pill, false);
  assert.equal(backendSettings.inline, true);
  findAll(labelRow('Notes tab on game pages'), n => n.host === 'Toggle')[0].props.onChange(true); rerender();
  await wait(450);
  assert.equal(backendSettings.libtab, true); // switched on for the library tab tests below
});

await test('backup section lists the toggle, folder, status and actions', () => {
  const t = textOf(tree);
  for (const l of ['Automatic backup', 'Keep a second copy', 'Backup status', 'Back up now', 'Use this path', 'Use this backup folder']) assert.match(t, new RegExp(l));
  assert.match(t, /Last copy .*3 notes, in C:\/Users\/me\/Documents\/MoreNotes/);
  assert.equal(findAll(tree, n => n.host === 'ButtonItem' && /^Restore notes and settings/.test(n.props.label)).length, 1);
});

await test('backup toggle writes through as a JSON string', async () => {
  findAll(labelRow('Keep a second copy'), n => n.host === 'Toggle')[0].props.onChange(false); rerender();
  await wait(450);
  assert.equal(backendSettings.backup, false);
  findAll(labelRow('Keep a second copy'), n => n.host === 'Toggle')[0].props.onChange(true); rerender();
  await wait(450);
  assert.equal(backendSettings.backup, true);
});

await test('a chosen backup folder is only sent when Use this path is pressed', async () => {
  const before = settingsCalls().length;
  const dirField = () => fields().find(f => String(f.props.placeholder).startsWith('Default file path'));
  dirField().props.onChange({ target: { value: 'D:\\Backups\\Notes' } }); rerender();
  dirField().props.onChange({ target: { value: 'D:\\Backups\\Notes2' } }); rerender();
  await wait(450);
  assert.equal(settingsCalls().length, before, 'typing alone must not create folders');
  await clickAction('Use this path');
  assert.equal(JSON.parse(settingsCalls().at(-1).args.json).backupdir, 'D:\\Backups\\Notes2');
});

await test('a rejected folder shows an explanation', async () => {
  acceptDir = false;
  fields().find(f => String(f.props.placeholder).startsWith('Default file path')).props.onChange({ target: { value: 'C:\\bad&path' } }); rerender();
  await clickAction('Use this path');
  assert.match(textOf(tree), /That path was not accepted/);
  acceptDir = true;
});

await test('a path ending in .json is sent as the backup file, anything else as the folder', async () => {
  const f = () => fields().find(f => String(f.props.placeholder).startsWith('Default file path'));
  f().props.onChange({ target: { value: 'D:\\Backups\\mine.json' } }); rerender();
  await clickAction('Use this path');
  let sent = JSON.parse(settingsCalls().at(-1).args.json);
  assert.deepEqual([sent.backupfile, sent.backupdir], ['D:\\Backups\\mine.json', '']);
  f().props.onChange({ target: { value: 'D:\\Backups\\Folder' } }); rerender();
  await clickAction('Use this path');
  sent = JSON.parse(settingsCalls().at(-1).args.json);
  assert.deepEqual([sent.backupfile, sent.backupdir], ['', 'D:\\Backups\\Folder']);
});

await test('a separate backup folder is only sent when Use this backup folder is pressed', async () => {
  const before = settingsCalls().length;
  const f = () => fields().find(f => String(f.props.placeholder).startsWith('Default backup folder path'));
  assert.ok(f(), 'the backup folder input exists');
  f().props.onChange({ target: { value: 'E:\\Snaps' } }); rerender();
  await wait(450);
  assert.equal(settingsCalls().length, before, 'typing alone must not save anything');
  await clickAction('Use this backup folder');
  assert.equal(JSON.parse(settingsCalls().at(-1).args.json).snapdir, 'E:\\Snaps');
});

await test('a rejected backup folder shows an explanation', async () => {
  acceptDir = false;
  fields().find(f => String(f.props.placeholder).startsWith('Default backup folder path')).props.onChange({ target: { value: 'C:\\bad&path' } }); rerender();
  await clickAction('Use this backup folder');
  assert.match(textOf(tree), /That backup folder was not accepted/);
  acceptDir = true;
});

await test('Back up now calls the backend and reports it', async () => {
  const before = calls.filter(c => c.fn === 'backup_now').length;
  await clickAction('Back up now');
  assert.equal(calls.filter(c => c.fn === 'backup_now').length, before + 1);
  assert.match(textOf(tree), /Copy saved\./);
});

await test('restore needs a second click, then reloads the notes', async () => {
  const restores = () => calls.filter(c => c.fn === 'restore_backup');
  const before = restores().length;
  await clickAction('Restore notes and settings from the backup copy');
  assert.equal(restores().length, before, 'first click must not restore');
  assert.ok(buttons().some(b => /^Click again to replace your notes/.test(b.props.label)));
  const loads = calls.filter(c => c.fn === 'get_all').length;
  await clickAction('Click again to replace your notes with the backup copy');
  assert.equal(restores().length, before + 1);
  assert.equal(JSON.parse(restores().at(-1).args.json).which, 'latest');
  assert.ok(calls.filter(c => c.fn === 'get_all').length > loads, 'notes are reloaded after a restore');
  assert.match(textOf(tree), /Restored 2 notes\./);
});

await test('undo restore asks for the earlier backup and explains when there is none', async () => {
  restoreReply = { ok: false, error: 'no_previous' };
  await clickAction('Undo: restore the latest backup from an earlier day');
  await clickAction('Click again to restore the earlier backup');
  assert.equal(JSON.parse(calls.filter(c => c.fn === 'restore_backup').at(-1).args.json).which, 'previous');
  assert.match(textOf(tree), /No backup from an earlier day was found\./);
  restoreReply = { ok: true, count: 2, from: 'x' };
});

await test('status explains an error, being off, and a start-up restore', async () => {
  backupInfoReply = { ...backupInfoReply, error: 'Permission denied', saved_at: 0 };
  await window.__moreNotes.store.refreshBackup(); rerender();
  assert.match(textOf(tree), /Could not write a copy: Permission denied/);
  backupInfoReply = { ...backupInfoReply, error: '', enabled: false };
  await window.__moreNotes.store.refreshBackup(); rerender();
  assert.match(textOf(tree), /Off\. Notes are only stored/);
  backupInfoReply = { ...backupInfoReply, enabled: true, restored_from: 'C:/x/MoreNotes_notes.json' };
  await window.__moreNotes.store.refreshBackup(); rerender();
  assert.match(textOf(tree), /recovered from C:\/x\/MoreNotes_notes\.json/);
});

await test('only plain strings are ever sent to the backend', () => {
  assert.ok(calls.length > 5);
  for (const c of calls) for (const v of Object.values(c.args || {})) assert.equal(typeof v, 'string', c.fn);
  for (const c of calls) assert.ok(Object.keys(c.args || {}).length === 0 || Object.keys(c.args).join() === 'json', c.fn + ' sends one packed argument');
  const note = calls.find(c => c.fn === 'set_note');
  assert.ok(note && JSON.parse(note.args.json).key, 'the note key travels inside the packed argument');
  assert.ok(calls.filter(c => c.fn === 'set_settings').every(c => typeof c.args.json === 'string' && typeof JSON.parse(c.args.json) === 'object'));
});

await test('invalid values from the backend are ignored on load', async () => {
  backendSettings = { pill: 'yes', facing: 'sideways', side: 'top', vertical: 'abc', shape: 'star', size: 'huge', color: 'red', inline: 1, iconcolor: 'rainbow', libtab: 'no', libdock: 'maybe' };
  await window.__moreNotes.store.load();
  const st = window.__moreNotes.store.settings;
  assert.equal(JSON.stringify(st), JSON.stringify({ pill: true, facing: 'right', vertical: 50, shape: 'pill', size: 'medium', color: '#1a9fff', inline: false, backup: true, backupdir: '', backupfile: '', snapdir: '', iconcolor: 'auto', libtab: false, libdock: true }));
});

await test('settings write failure shows a message', async () => {
  backendDown = true;
  window.__moreNotes.store.saveSettings({ facing: 'left' });
  await wait(450);
  rerender();
  assert.match(textOf(tree), /Could not save appearance/);
  backendDown = false;
});

const jsxCall = props => patched[0].cb(['div', props]);
const tabProps = (extra = {}) => ({ tabs: [{ id: 'achievements', content: { props: { appid: 620 } } }], onShowTab() {}, autoFocusContents: true, ...extra });

await test('library page: a native Notes tab is added next to the others, once', () => {
  assert.equal(patched.length, 2, 'jsx runtime is patched at start-up');
  window.__moreNotes.store.saveSettings({ libtab: true }); // it is off by default; the tests below need it on
  const props = tabProps();
  jsxCall(props); jsxCall(props); jsxCall(props);
  assert.equal(props.tabs.length, 2);
  assert.equal(props.tabs[1].id, 'morenotes');
  assert.equal(props.tabs[1].title, 'Notes');
  assert.equal(props.tabs[1].content.props.appId, '620');
});

await test('library page: ignored when it is not a game tab row, has no app id, or the setting is off', () => {
  const noHandler = tabProps(); delete noHandler.onShowTab; jsxCall(noHandler); assert.equal(noHandler.tabs.length, 1);
  const noFocus = tabProps(); delete noFocus.autoFocusContents; jsxCall(noFocus); assert.equal(noFocus.tabs.length, 1);
  const noApp = tabProps({ tabs: [{ id: 'achievements', content: { props: {} } }] }); jsxCall(noApp); assert.equal(noApp.tabs.length, 1);
  jsxCall({ tabs: 'not an array', onShowTab() {}, autoFocusContents: true });
  window.__moreNotes.store.saveSettings({ libtab: false });
  const off = tabProps(); jsxCall(off); assert.equal(off.tabs.length, 1, 'setting off');
  window.__moreNotes.store.saveSettings({ libtab: true });
});

await test('library page: the Notes tab edits the game note with the game name', async () => {
  const props = tabProps(); jsxCall(props);
  const content = props.tabs[1].content;
  const render = () => { hookIndex = 0; currentPath = 'notestab'; return expand(content, 'notestab'); };
  let t = render();
  assert.match(textOf(t), /Notes - Portal 2/);
  assert.match(counterText(t), /0 \/ 4000/, 'the library Notes tab has a counter');
  const field = () => findAll(t, n => n.host === 'TextField')[0];
  field().props.onChange({ target: { value: 'finish chapter 9' } }); t = render();
  assert.match(counterText(t), /16 \/ 4000/);
  const save = findAll(t, n => n.host === 'DialogButtonPrimary')[0];
  await save.props.onClick(); await tick(); t = render();
  assert.equal(backendNotes['app:620'].text, 'finish chapter 9');
  assert.equal(backendNotes['app:620'].label, 'Portal 2');
  assert.match(textOf(t), /Saved\./);
  assert.match(textOf(t), /Saved note\|finish chapter 9/);
  const del = findAll(t, n => n.host === 'DialogButton').find(b => b.props.children === 'Delete');
  await del.props.onClick(); await tick();
  assert.equal(backendNotes['app:620'], undefined);
});

await test('diagnostics collect prop names and id values but never message text', async () => {
  const d = window.__moreNotes.diag;
  d.start();
  assert.ok(d.on && patched.length === 2);
  const cb = patched[0].cb;
  function FriendRow() {}
  cb([FriendRow, { steamid: '76561198000000001', message: 'secret chat text', onClick() {} }]);
  cb(['div', { steamid: '1' }]);          // host elements ignored
  cb([function Plain() {}, { color: 'red' }]); // not id-like
  const rep = JSON.stringify(d.report());
  assert.match(rep, /FriendRow/);
  assert.match(rep, /76561198000000001/);
  assert.doesNotMatch(rep, /secret chat text/);
  assert.equal(d.report().collected.length, 1);
  d.stop();
  assert.equal(d.on, false);
});

await test('backend failure shows an error row with Try again', async () => {
  backendDown = true;
  await window.__moreNotes.store.load();
  rerender();
  assert.match(textOf(tree), /Could not load notes/);
  assert.match(textOf(tree), /backend_unreachable/);
  backendDown = false;
  await clickAction('Try again');
  assert.doesNotMatch(textOf(tree), /Could not load notes/);
});

await test('re-running main disposes the previous instance', async () => {
  let stopped = 0;
  window.__moreNotes.dispose = () => { stopped++; };
  // a real reload runs the build in a fresh script scope but the same window
  const ctx2 = { ...ctx };
  vm.createContext(ctx2);
  ctx2.globalThis = ctx2;
  vm.runInContext(built, ctx2);
  await tick();
  assert.equal(stopped, 1);
});

await test('the release build hides the diagnostics panel; the dev build shows it', async () => {
  const { execFileSync } = await import('node:child_process');
  execFileSync('node', [join(root, 'scripts', 'build.mjs'), '--release', '--out', '/tmp/morenotes-release'], { stdio: 'pipe' });
  const releaseCode = readFileSync('/tmp/morenotes-release/index.js', 'utf8');
  assert.match(releaseCode, /const SHOW_DIAGNOSTICS = false;/);
  assert.match(built, /const SHOW_DIAGNOSTICS = true;/);
  const win3 = { ...window, PLUGIN_LIST: {}, MILLENNIUM_SIDEBAR_NAVIGATION_PANELS: {}, __moreNotes: undefined };
  const ctx3 = { ...ctx, window: win3 };
  vm.createContext(ctx3); ctx3.globalThis = ctx3;
  vm.runInContext(releaseCode, ctx3);
  await tick();
  const panel3 = win3.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS.MoreNotes;
  hookIndex = 0; currentPath = 'rel';
  const t3 = expand(panel3.content, 'rel');
  assert.doesNotMatch(textOf(t3), /Collect friends\/chat diagnostics/);
  assert.match(textOf(t3), /Notes file/);
  win3.__moreNotes.diag.start();
  assert.equal(win3.__moreNotes.diag.on, false, 'diagnostics cannot be switched on in the release build');
  win3.__moreNotes.dispose();
  // and the dev build does show it
  hookIndex = 0; currentPath = 'dev';
  assert.match(textOf(expand(panel.content, 'dev')), /Collect friends\/chat diagnostics/);
});

console.log(`\n${passed} tests passed (stubs only; not verified inside real Steam).`);
window.__moreNotes.dispose();
process.exit(0);
