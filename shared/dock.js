// Docked note tab ("the pill"): a small tab on an edge or corner that expands into a writing box.
// One implementation shared by the web-page script (store/community pages) and the Library overlay in the client.
// It lives in a shadow root so the host page's CSS cannot restyle it.
//
// env: { id, doc, parent?, settings(), saved(key) -> string, save(key, text, label, cb(result)) }
// returns: { show({key, label}), hide(), refresh(), isOpen(), host() }
function createDock(env) {
  var doc = env.doc;
  var MAX = 4000; // characters; the backend enforces the same limit
  var pill = null;
  var onDocMouseDown = null;

  function cpLen(s) { return Array.from(String(s || '')).length; }
  function clamp(s) { var a = Array.from(String(s || '')); return a.length > MAX ? a.slice(0, MAX).join('') : String(s || ''); }
  function paintCount(el, text) {
    var n = cpLen(text);
    el.textContent = n + ' / ' + MAX;
    el.className = el.className.replace(/\s*\b(warn|full)\b/g, '') + (n >= MAX ? ' full' : n >= MAX * 0.9 ? ' warn' : '');
  }

  var ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4"/><path d="M8 12h8M8 16h6"/></svg>';
  var SIZES = { small: { w: 26, h: 84, d: 40, tw: 22, c: 56 }, medium: { w: 32, h: 104, d: 48, tw: 26, c: 68 }, large: { w: 38, h: 124, d: 56, tw: 30, c: 80 } };
  var PILL_CSS = [
    ':host{all:initial}',
    '.wrap{position:fixed;z-index:2147483000;font:12px/1.4 "Motiva Sans",Arial,Helvetica,sans-serif;color:#c6d4df}',
    // left / right edges: the box opens beside the handle
    '.wrap[data-edge=v]{display:flex;align-items:center;top:var(--pos);transform:translateY(-50%)}',
    '.wrap[data-facing=right]{right:0;flex-direction:row-reverse}',
    '.wrap[data-facing=left]{left:0;flex-direction:row}',
    // top / bottom edges: the box opens below or above the handle
    '.wrap[data-edge=h]{left:var(--pos);transform:translateX(-50%)}',
    '.wrap[data-facing=top]{top:0}.wrap[data-facing=bottom]{bottom:0}',
    '.wrap[data-edge=h] .panel{position:absolute;left:50%;margin:0;transform:translateX(calc(-1 * var(--pos)))}',
    '.wrap[data-facing=top] .panel{top:100%;margin-top:6px}.wrap[data-facing=bottom] .panel{bottom:100%;margin-bottom:6px}',
    // corners: the box opens inward from the corner
    '.wrap[data-facing=topleft]{top:0;left:0}.wrap[data-facing=topright]{top:0;right:0}',
    '.wrap[data-facing=bottomleft]{bottom:0;left:0}.wrap[data-facing=bottomright]{bottom:0;right:0}',
    '.wrap[data-edge=c] .panel{position:absolute;margin:0}',
    '.wrap[data-facing=topleft] .panel{top:100%;left:0;margin:6px 0 0 6px}.wrap[data-facing=topright] .panel{top:100%;right:0;margin:6px 6px 0 0}',
    '.wrap[data-facing=bottomleft] .panel{bottom:100%;left:0;margin:0 0 6px 6px}.wrap[data-facing=bottomright] .panel{bottom:100%;right:0;margin:0 6px 6px 0}',
    // handle shapes
    '.wrap[data-edge=v][data-shape=pill] .handle{border-radius:999px;width:var(--w);height:var(--h)}',
    '.wrap[data-edge=v][data-shape=tab] .handle{margin:0;width:var(--tw);height:var(--h)}',
    '.wrap[data-edge=v][data-shape=tab][data-facing=right] .handle{border-radius:12px 0 0 12px}',
    '.wrap[data-edge=v][data-shape=tab][data-facing=left] .handle{border-radius:0 12px 12px 0}',
    '.wrap[data-edge=v][data-shape=square] .handle{border-radius:10px;width:var(--d);height:var(--d)}',
    '.wrap[data-edge=h] .handle{margin:6px 0;flex-direction:row}',
    '.wrap[data-edge=h] .lbl{writing-mode:horizontal-tb}',
    '.wrap[data-edge=h][data-shape=pill] .handle{border-radius:999px;width:var(--h);height:var(--w)}',
    '.wrap[data-edge=h][data-shape=tab] .handle{margin:0;width:var(--h);height:var(--tw)}',
    '.wrap[data-edge=h][data-shape=tab][data-facing=top] .handle{border-radius:0 0 12px 12px}',
    '.wrap[data-edge=h][data-shape=tab][data-facing=bottom] .handle{border-radius:12px 12px 0 0}',
    '.wrap[data-edge=h][data-shape=square] .handle{border-radius:10px;width:var(--d);height:var(--d)}',
    // the dot (circle) is a dot everywhere; any other shape in a corner bends to follow the corner
    '.wrap[data-shape=circle] .handle{border-radius:50%;width:var(--d);height:var(--d)}',
    '.wrap[data-edge=c] .handle{margin:0;width:var(--cs);height:var(--cs);padding:calc(var(--cs) * .2);--r:18px}',
    '.wrap[data-edge=c][data-shape=pill] .handle{--r:100%}',
    '.wrap[data-edge=c][data-shape=square] .handle{--r:12px}',
    '.wrap[data-edge=c][data-shape=circle] .handle{margin:6px;padding:0;width:var(--d);height:var(--d);border-radius:50%}',
    '.wrap[data-facing=topleft]:not([data-shape=circle]) .handle{border-radius:0 0 var(--r) 0;align-items:flex-start;justify-content:flex-start}',
    '.wrap[data-facing=topright]:not([data-shape=circle]) .handle{border-radius:0 0 0 var(--r);align-items:flex-end;justify-content:flex-start}',
    '.wrap[data-facing=bottomleft]:not([data-shape=circle]) .handle{border-radius:0 var(--r) 0 0;align-items:flex-start;justify-content:flex-end}',
    '.wrap[data-facing=bottomright]:not([data-shape=circle]) .handle{border-radius:var(--r) 0 0 0;align-items:flex-end;justify-content:flex-end}',
    '.wrap[data-edge=c] .lbl{display:none}',
    '.handle{box-sizing:border-box;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;border:0;padding:0;margin:0 6px;background:var(--c);color:var(--fg);font:inherit;opacity:.82;box-shadow:0 2px 10px rgba(0,0,0,.45);transition:opacity .15s}',
    '.handle:hover,.wrap[data-open=true] .handle{opacity:1}',
    '.wrap[data-has=true] .handle{opacity:1;box-shadow:0 0 0 2px rgba(255,255,255,.35),0 2px 14px rgba(0,0,0,.5)}',
    '.lbl{writing-mode:vertical-rl;font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase}',
    '.dot{display:none;position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px var(--c)}',
    '.wrap[data-has=true] .dot{display:block}',
    '.wrap[data-shape=circle] .lbl,.wrap[data-shape=square] .lbl{display:none}',
    '.panel{display:none;box-sizing:border-box;width:min(300px,70vw);margin:0 6px;padding:10px;background:#1b2838;border:1px solid var(--c);border-radius:var(--pr);box-shadow:0 6px 24px rgba(0,0,0,.55)}',
    '.wrap[data-open=true] .panel{display:block}',
    '.title{color:#fff;font-weight:600;border-left:3px solid var(--c);padding-left:8px;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    'textarea{display:block;box-sizing:border-box;width:100%;min-height:96px;padding:6px;margin:0 0 8px;background:rgba(0,0,0,.35);color:#fff;border:1px solid #3a4a5c;border-radius:3px;font:inherit;resize:vertical}',
    'textarea:focus{outline:none;border-color:var(--c)}',
    '.actions{display:flex;gap:8px}',
    'button.act{flex:1;cursor:pointer;border:0;border-radius:3px;padding:6px 8px;background:#2a3f55;color:#c6d4df;font:inherit}',
    'button.act:hover{background:#355070}',
    'button.primary{background:var(--c);color:var(--fg)}',
    'button.primary:hover{background:var(--c);filter:brightness(1.12)}',
    '.count{text-align:right;font-size:11px;opacity:.75;margin:-4px 0 8px}',
    '.count.warn{color:#e8b24a;opacity:1}.count.full{color:#e24c4c;opacity:1}',
    '.err{color:#e24c4c;margin-top:6px}'
  ].join('');

  function contrastColor(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#101820' : '#ffffff';
  }

  function saved() { return pill ? String(env.saved(pill.key) || '') : ''; }

  function setOpen(open) {
    if (!pill) return;
    pill.open = open;
    pill.wrap.setAttribute('data-open', open ? 'true' : 'false');
    pill.err.textContent = '';
    if (open) {
      pill.ta.value = saved();
      paintCount(pill.count, pill.ta.value);
      pill.del.style.display = saved() ? '' : 'none';
      pill.ta.focus();
    }
  }

  function close(save) {
    if (!pill || !pill.open) return;
    var text = pill.ta.value;
    if (save && text.trim() !== saved().trim()) {
      env.save(pill.key, text, pill.label, function (r) {
        if (!r.ok) { pill.err.textContent = (r.error || 'failed') + (r.detail ? ': ' + r.detail : ''); return; }
        setOpen(false);
      });
      return;
    }
    setOpen(false);
  }

  function updateState() {
    if (!pill) return;
    var s = saved();
    pill.wrap.setAttribute('data-has', s ? 'true' : 'false');
    pill.handle.title = s ? s : 'Add a private note';
    if (!pill.open) { pill.ta.value = s; paintCount(pill.count, s); }
  }

  function applySettings() {
    if (!pill) return;
    var settings = env.settings();
    var sz = SIZES[settings.size] || SIZES.medium;
    var pos = Math.max(8, Math.min(92, settings.vertical));
    var f = settings.facing;
    var edge = (f === 'left' || f === 'right') ? 'v' : (f === 'top' || f === 'bottom') ? 'h' : 'c';
    var w = pill.wrap;
    w.setAttribute('data-facing', f);
    w.setAttribute('data-edge', edge);
    w.setAttribute('data-shape', settings.shape);
    w.style.setProperty('--pos', pos + '%');
    w.style.setProperty('--cs', sz.c + 'px');
    w.style.setProperty('--c', settings.color);
    w.style.setProperty('--fg', settings.iconcolor === 'light' ? '#ffffff' : settings.iconcolor === 'dark' ? '#101820' : contrastColor(settings.color));
    w.style.setProperty('--w', sz.w + 'px');
    w.style.setProperty('--h', sz.h + 'px');
    w.style.setProperty('--d', sz.d + 'px');
    w.style.setProperty('--tw', sz.tw + 'px');
    w.style.setProperty('--pr', settings.shape === 'square' ? '10px' : settings.shape === 'tab' ? '12px' : '18px');
  }

  function build() {
    var host = doc.createElement('div');
    host.id = env.id || 'morenotes-pill';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + PILL_CSS + '</style>' +
      '<div class="wrap" data-open="false" data-has="false">' +
      '<button class="handle" type="button"><span class="dot"></span>' + ICON + '<span class="lbl">Notes</span></button>' +
      '<div class="panel"><div class="title"></div><textarea placeholder="Private note"></textarea><div class="count">0 / ' + MAX + '</div>' +
      '<div class="actions"><button class="act del" type="button">Delete</button><button class="act primary done" type="button">Done</button></div>' +
      '<div class="err"></div></div></div>';
    pill = {
      host: host, root: root, wrap: root.querySelector('.wrap'), handle: root.querySelector('.handle'), title: root.querySelector('.title'),
      ta: root.querySelector('textarea'), count: root.querySelector('.count'), err: root.querySelector('.err'), del: root.querySelector('.del'),
      key: '', label: '', open: false
    };
    pill.handle.addEventListener('click', function () { if (pill.open) close(true); else setOpen(true); });
    root.querySelector('.done').addEventListener('click', function () { close(true); });
    pill.del.addEventListener('click', function () {
      env.save(pill.key, '', pill.label, function (r) {
        if (!r.ok) { pill.err.textContent = (r.error || 'failed') + (r.detail ? ': ' + r.detail : ''); return; }
        pill.ta.value = '';
        paintCount(pill.count, '');
        setOpen(false);
      });
    });
    ['keydown', 'keyup', 'keypress'].forEach(function (t) {
      pill.ta.addEventListener(t, function (e) {
        e.stopPropagation();
        if (t !== 'keydown') return;
        if (e.key === 'Escape') close(true);
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); close(true); }
      });
    });
    pill.ta.addEventListener('input', function () {
      var c = clamp(pill.ta.value);
      if (c !== pill.ta.value) pill.ta.value = c;
      paintCount(pill.count, pill.ta.value);
    });
    onDocMouseDown = function (e) {
      if (pill && pill.open && (e.composedPath ? e.composedPath().indexOf(pill.host) < 0 : true)) close(true);
    };
    doc.addEventListener('mousedown', onDocMouseDown, true);
    (env.parent || doc.documentElement).appendChild(host);
  }

  function remove() {
    if (onDocMouseDown) { doc.removeEventListener('mousedown', onDocMouseDown, true); onDocMouseDown = null; }
    if (!pill) return;
    if (pill.host.parentNode) pill.host.parentNode.removeChild(pill.host);
    pill = null;
  }

  function show(subject) {
    if (!pill || !pill.host.isConnected) { remove(); build(); }
    if (pill.key !== subject.key) { pill.key = subject.key; setOpen(false); }
    pill.label = subject.label || '';
    var kind = subject.key.split(':')[0], rest = subject.key.slice(kind.length + 1);
    pill.title.textContent = subject.label || (kind === 'app' ? 'Game ' + rest : kind === 'user' ? 'Person ' + rest : rest);
    applySettings();
    updateState();
  }

  return {
    show: show,
    hide: remove,
    refresh: function () { if (pill) { applySettings(); updateState(); } },
    isOpen: function () { return !!(pill && pill.open); },
    host: function () { return pill ? pill.host : null; }
  };
}
