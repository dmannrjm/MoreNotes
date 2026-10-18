// More Notes webkit script: runs on Steam store/community web pages (plain DOM, no React).
// Adds a small "Add note" / note line to: store and community game pages, profile pages,
// friend blocks on community friend lists, and wishlist rows.
(function () {
  'use strict';
  if (!/^(store\.steampowered\.com|steamcommunity\.com)$/i.test(location.hostname)) return;
  if (window.__moreNotesWeb) return;
  window.__moreNotesWeb = true;

  var PLUGIN = 'MoreNotes';
  var notes = {};
  var loaded = false;
  var MAX_NOTE = 4000; // characters; the backend enforces the same limit
  function cpLen(s) { return Array.from(String(s || '')).length; }
  function clampNote(s) { var a = Array.from(String(s || '')); return a.length > MAX_NOTE ? a.slice(0, MAX_NOTE).join('') : String(s || ''); }
  function paintCount(el, text) {
    var n = cpLen(text);
    el.textContent = n + ' / ' + MAX_NOTE;
    el.className = el.className.replace(/\s*\b(warn|full)\b/g, '') + (n >= MAX_NOTE ? ' full' : n >= MAX_NOTE * 0.9 ? ' warn' : '');
  }

  var DEFAULTS = { pill: true, side: 'right', vertical: 50, shape: 'pill', size: 'medium', color: '#1a9fff', inline: false, iconcolor: 'auto' };
  var settings = {};
  Object.keys(DEFAULTS).forEach(function (k) { settings[k] = DEFAULTS[k]; });
  var ENUMS = { side: ['left', 'right'], shape: ['pill', 'circle', 'square', 'tab'], size: ['small', 'medium', 'large'], iconcolor: ['auto', 'light', 'dark'] };

  function applySettings(a) {
    if (!a || typeof a !== 'object') return;
    if (typeof a.pill === 'boolean') settings.pill = a.pill;
    if (typeof a.inline === 'boolean') settings.inline = a.inline;
    Object.keys(ENUMS).forEach(function (k) { if (ENUMS[k].indexOf(a[k]) >= 0) settings[k] = a[k]; });
    var v = Number(a.vertical);
    if (isFinite(v)) settings.vertical = Math.max(0, Math.min(100, Math.round(v)));
    if (typeof a.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(a.color)) settings.color = a.color.toLowerCase();
  }

  function parse(r) {
    if (typeof r === 'string') { try { return JSON.parse(r); } catch (e) { return { ok: false, error: 'bad_json' }; } }
    return r && typeof r === 'object' ? r : { ok: false, error: 'empty_reply' };
  }

  function call(fn, args) {
    if (!window.Millennium || typeof window.Millennium.callServerMethod !== 'function') {
      return Promise.reject(new Error('Millennium.callServerMethod unavailable'));
    }
    // one plain string (a JSON document in a field named "json"), however the host hands arguments over
    var keys = Object.keys(args || {});
    var safe = !keys.length ? {} : (keys.length === 1 && keys[0] === 'json' && typeof args.json === 'string') ? args : { json: JSON.stringify(args) };
    return Promise.resolve(window.Millennium.callServerMethod(PLUGIN, fn, safe)).then(parse);
  }

  // ------------------------------------------------------------------ styles
  function addStyles() {
    if (document.getElementById('morenotes-style')) return;
    var s = document.createElement('style');
    s.id = 'morenotes-style';
    s.textContent =
      '.morenotes{font-size:12px;line-height:1.4;margin:4px 0;color:#c6d4df;max-width:100%;text-align:left;text-transform:none;letter-spacing:0}' +
      '.morenotes a{color:#67c1f5;text-decoration:none;cursor:pointer}' +
      '.morenotes a:hover{color:#fff}' +
      '.morenotes-text{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}' +
      '.morenotes textarea{display:block;width:100%;box-sizing:border-box;min-height:56px;padding:6px;margin-bottom:4px;' +
      'background:rgba(0,0,0,.35);color:#fff;border:1px solid #3a4a5c;border-radius:2px;font:inherit;resize:vertical}' +
      '.morenotes-actions a{margin-right:12px}' +
      '.morenotes-err{color:#e24c4c;margin-top:2px}' +
      '.morenotes-count{text-align:right;font-size:11px;opacity:.75;margin:-2px 0 4px}' +
      '.morenotes-count.warn{color:#e8b24a;opacity:1}.morenotes-count.full{color:#e24c4c;opacity:1}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ------------------------------------------------------------------ chip
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function link(text, title, onClick, cls) {
    var a = document.createElement('a');
    a.href = '#';
    a.textContent = text;
    if (title) a.title = title;
    if (cls) a.className = cls;
    a.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); onClick(e); });
    return a;
  }

  function showView(root) {
    var key = root.getAttribute('data-morenotes-key');
    var label = root.getAttribute('data-morenotes-label') || '';
    root.removeAttribute('data-morenotes-editing');
    clear(root);
    var n = notes[key];
    if (n && n.text) {
      root.appendChild(link('Note: ' + n.text, n.text, function () { showEdit(root, key, label); }, 'morenotes-text'));
    } else {
      root.appendChild(link('+ Add note', 'Add a private note', function () { showEdit(root, key, label); }));
    }
  }

  function refreshAll(key) {
    var all = document.querySelectorAll('.morenotes[data-morenotes-key="' + key + '"]');
    for (var i = 0; i < all.length; i++) {
      if (!all[i].hasAttribute('data-morenotes-editing')) showView(all[i]);
    }
    updatePillState();
  }

  function showEdit(root, key, label) {
    root.setAttribute('data-morenotes-editing', '1');
    clear(root);
    var existing = notes[key];
    var ta = document.createElement('textarea');
    ta.value = (existing && existing.text) || '';
    ta.placeholder = 'Private note';
    var counter = document.createElement('div');
    counter.className = 'morenotes-count';
    paintCount(counter, ta.value);
    ta.addEventListener('input', function () {
      var c = clampNote(ta.value);
      if (c !== ta.value) ta.value = c;
      paintCount(counter, ta.value);
    });
    var err = document.createElement('div');
    err.className = 'morenotes-err';

    function stop(e) { e.stopPropagation(); }
    ['click', 'mousedown', 'mouseup', 'keyup', 'keypress'].forEach(function (t) { root.addEventListener(t, stop); });

    function commit(text) {
      err.textContent = '';
      call('set_note', { key: key, text: text, label: label }).then(function (r) {
        if (!r.ok) { err.textContent = (r.error || 'failed') + (r.detail ? ': ' + r.detail : ''); return; }
        var clean = String(text || '').trim();
        if (!clean) delete notes[key];
        else notes[key] = { text: clampNote(clean), label: label, updated: Math.floor(Date.now() / 1000) };
        showView(root);
        refreshAll(key);
      }, function (e) { err.textContent = 'backend_unreachable: ' + (e && e.message ? e.message : e); });
    }

    ta.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') { showView(root); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(ta.value); }
    });

    var actions = document.createElement('div');
    actions.className = 'morenotes-actions';
    actions.appendChild(link('Save', 'Ctrl+Enter', function () { commit(ta.value); }));
    if (existing) actions.appendChild(link('Delete', '', function () { commit(''); }));
    actions.appendChild(link('Cancel', 'Esc', function () { showView(root); }));

    root.appendChild(ta);
    root.appendChild(counter);
    root.appendChild(actions);
    root.appendChild(err);
    ta.focus();
  }

  function makeChip(key, label, role) {
    var root = document.createElement('div');
    root.className = 'morenotes';
    root.setAttribute('data-morenotes-role', role || 'list');
    root.setAttribute('data-morenotes-key', key);
    root.setAttribute('data-morenotes-label', (label || '').slice(0, 120));
    showView(root);
    return root;
  }

  // ------------------------------------------------------------------ scanners
  function text(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

  function placeAfter(anchor, key, label) {
    if (!anchor || !anchor.parentNode) return;
    var next = anchor.nextElementSibling;
    if (next && next.classList && next.classList.contains('morenotes')) return;
    anchor.parentNode.insertBefore(makeChip(key, label, 'subject'), anchor.nextSibling);
  }

  function placeInside(container, key, label) {
    if (!container) return;
    if (container.querySelector(':scope > .morenotes')) return;
    container.appendChild(makeChip(key, label));
  }

  function appIdFromPath() {
    var m = location.pathname.match(/^\/app\/(\d+)/);
    return m ? m[1] : null;
  }

  function scanApp() {
    if (!settings.inline) return;
    var id = appIdFromPath();
    if (!id) return;
    var title = document.getElementById('appHubAppName') || document.querySelector('.apphub_AppName');
    if (title) placeAfter(title, 'app:' + id, text(title));
  }

  function profileSteamId() {
    try { if (window.g_rgProfileData && /^\d{17}$/.test(String(window.g_rgProfileData.steamid))) return String(window.g_rgProfileData.steamid); } catch (e) { /* ignore */ }
    var p = location.pathname.match(/^\/profiles\/(\d{17})/);
    if (p) return p[1];
    var m = document.documentElement.innerHTML.match(/"steamid"\s*:\s*"(\d{17})"/);
    return m ? m[1] : null;
  }

  function scanProfile() {
    if (!settings.inline) return;
    if (!/^\/(id|profiles)\/[^/]+\/?$/.test(location.pathname)) return;
    var anchor = document.querySelector('.profile_header_centered_persona') || document.querySelector('.profile_header_summary');
    if (!anchor) return;
    var id = profileSteamId();
    if (!id) return;
    placeAfter(anchor, 'user:' + id, text(document.querySelector('.actual_persona_name')));
  }

  function scanFriends() {
    var blocks = document.querySelectorAll('.friend_block_v2[data-steamid]');
    for (var i = 0; i < blocks.length; i++) {
      var id = blocks[i].getAttribute('data-steamid');
      if (!/^\d{17}$/.test(id || '')) continue;
      var content = blocks[i].querySelector('.friend_block_content') || blocks[i];
      var first = content.firstChild;
      var name = first && first.nodeType === 3 ? first.nodeValue.trim() : '';
      placeInside(content, 'user:' + id, name);
    }
  }

  function appIdOfHref(href) {
    var m = (href || '').match(/\/app\/(\d+)/);
    return m ? m[1] : null;
  }

  function scanWishlist() {
    if (!/^\/wishlist/.test(location.pathname)) return;
    var links = document.querySelectorAll('a[href*="/app/"]');
    for (var i = 0; i < links.length; i++) {
      var id = appIdOfHref(links[i].getAttribute('href'));
      if (!id) continue;
      var row = links[i];
      for (var depth = 0; depth < 6 && row.parentElement && row.parentElement !== document.body; depth++) {
        var others = row.parentElement.querySelectorAll('a[href*="/app/"]');
        var single = true;
        for (var j = 0; j < others.length; j++) {
          var other = appIdOfHref(others[j].getAttribute('href'));
          if (other && other !== id) { single = false; break; }
        }
        if (!single) break;
        row = row.parentElement;
      }
      if (row.querySelector('.morenotes')) continue;
      var img = links[i].querySelector('img');
      var name = text(links[i]) || (img && img.alt) || '';
      row.appendChild(makeChip('app:' + id, name));
    }
  }


  // ------------------------------------------------------------------ pill
  // A docked, expandable note handle for pages with one subject (a game or a profile).
  // Lives in a shadow root so page CSS cannot restyle it.
  var pill = null;
  var ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4"/><path d="M8 12h8M8 16h6"/></svg>';
  var SIZES = { small: { w: 26, h: 84, d: 40, tw: 22 }, medium: { w: 32, h: 104, d: 48, tw: 26 }, large: { w: 38, h: 124, d: 56, tw: 30 } };
  var PILL_CSS = [
    ':host{all:initial}',
    '.wrap{position:fixed;top:var(--top);transform:translateY(-50%);z-index:2147483000;display:flex;align-items:center;font:12px/1.4 "Motiva Sans",Arial,Helvetica,sans-serif;color:#c6d4df}',
    '.wrap[data-side=right]{right:0;flex-direction:row-reverse}',
    '.wrap[data-side=left]{left:0;flex-direction:row}',
    '.handle{box-sizing:border-box;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;border:0;padding:0;margin:0 6px;background:var(--c);color:var(--fg);font:inherit;opacity:.82;box-shadow:0 2px 10px rgba(0,0,0,.45);transition:opacity .15s}',
    '.handle:hover,.wrap[data-open=true] .handle{opacity:1}',
    '.wrap[data-has=true] .handle{opacity:1;box-shadow:0 0 0 2px rgba(255,255,255,.35),0 2px 14px rgba(0,0,0,.5)}',
    '.lbl{writing-mode:vertical-rl;font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase}',
    '.dot{display:none;position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px var(--c)}',
    '.wrap[data-has=true] .dot{display:block}',
    '.wrap[data-shape=pill] .handle{border-radius:999px;width:var(--w);height:var(--h)}',
    '.wrap[data-shape=circle] .handle{border-radius:50%;width:var(--d);height:var(--d)}',
    '.wrap[data-shape=square] .handle{border-radius:10px;width:var(--d);height:var(--d)}',
    '.wrap[data-shape=tab] .handle{margin:0;width:var(--tw);height:var(--h)}',
    '.wrap[data-shape=tab][data-side=right] .handle{border-radius:12px 0 0 12px}',
    '.wrap[data-shape=tab][data-side=left] .handle{border-radius:0 12px 12px 0}',
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

  function saveNote(key, text, label, cb) {
    call('set_note', { key: key, text: text, label: label || '' }).then(function (r) {
      if (r.ok) {
        var clean = String(text || '').trim();
        if (!clean) delete notes[key];
        else notes[key] = { text: clampNote(clean), label: label || '', updated: Math.floor(Date.now() / 1000) };
        refreshAll(key);
      }
      cb(r);
    }, function (e) { cb({ ok: false, error: 'backend_unreachable', detail: e && e.message ? e.message : String(e) }); });
  }

  function pillSaved() { var n = pill && notes[pill.key]; return (n && n.text) || ''; }

  function setPillOpen(open) {
    if (!pill) return;
    pill.open = open;
    pill.wrap.setAttribute('data-open', open ? 'true' : 'false');
    pill.err.textContent = '';
    if (open) {
      pill.ta.value = pillSaved();
      paintCount(pill.count, pill.ta.value);
      pill.del.style.display = pillSaved() ? '' : 'none';
      pill.ta.focus();
    }
  }

  function closePill(save) {
    if (!pill || !pill.open) return;
    var text = pill.ta.value;
    if (save && text.trim() !== pillSaved().trim()) {
      saveNote(pill.key, text, pill.label, function (r) {
        if (!r.ok) { pill.err.textContent = (r.error || 'failed') + (r.detail ? ': ' + r.detail : ''); return; }
        setPillOpen(false);
      });
      return;
    }
    setPillOpen(false);
  }

  function updatePillState() {
    if (!pill) return;
    var saved = pillSaved();
    pill.wrap.setAttribute('data-has', saved ? 'true' : 'false');
    pill.handle.title = saved ? saved : 'Add a private note';
    if (!pill.open) { pill.ta.value = saved; paintCount(pill.count, saved); }
  }

  function applyPillSettings() {
    if (!pill) return;
    var sz = SIZES[settings.size] || SIZES.medium;
    var top = Math.max(8, Math.min(92, settings.vertical));
    var w = pill.wrap;
    w.setAttribute('data-side', settings.side);
    w.setAttribute('data-shape', settings.shape);
    w.style.setProperty('--top', top + '%');
    w.style.setProperty('--c', settings.color);
    w.style.setProperty('--fg', settings.iconcolor === 'light' ? '#ffffff' : settings.iconcolor === 'dark' ? '#101820' : contrastColor(settings.color));
    w.style.setProperty('--w', sz.w + 'px');
    w.style.setProperty('--h', sz.h + 'px');
    w.style.setProperty('--d', sz.d + 'px');
    w.style.setProperty('--tw', sz.tw + 'px');
    w.style.setProperty('--pr', settings.shape === 'square' ? '10px' : settings.shape === 'tab' ? '12px' : '18px');
  }

  function buildPill() {
    var host = document.createElement('div');
    host.id = 'morenotes-pill';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + PILL_CSS + '</style>' +
      '<div class="wrap" data-open="false" data-has="false">' +
      '<button class="handle" type="button"><span class="dot"></span>' + ICON + '<span class="lbl">Notes</span></button>' +
      '<div class="panel"><div class="title"></div><textarea placeholder="Private note"></textarea><div class="count">0 / ' + MAX_NOTE + '</div>' +
      '<div class="actions"><button class="act del" type="button">Delete</button><button class="act primary done" type="button">Done</button></div>' +
      '<div class="err"></div></div></div>';
    pill = {
      host: host, wrap: root.querySelector('.wrap'), handle: root.querySelector('.handle'), title: root.querySelector('.title'),
      ta: root.querySelector('textarea'), count: root.querySelector('.count'), err: root.querySelector('.err'), del: root.querySelector('.del'),
      key: '', label: '', open: false
    };
    pill.handle.addEventListener('click', function () { if (pill.open) closePill(true); else setPillOpen(true); });
    pill.root = root;
    root.querySelector('.done').addEventListener('click', function () { closePill(true); });
    pill.del.addEventListener('click', function () {
      saveNote(pill.key, '', pill.label, function (r) {
        if (!r.ok) { pill.err.textContent = (r.error || 'failed') + (r.detail ? ': ' + r.detail : ''); return; }
        pill.ta.value = '';
        paintCount(pill.count, '');
        setPillOpen(false);
      });
    });
    ['keydown', 'keyup', 'keypress'].forEach(function (t) {
      pill.ta.addEventListener(t, function (e) {
        e.stopPropagation();
        if (t !== 'keydown') return;
        if (e.key === 'Escape') closePill(true);
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closePill(true); }
      });
    });
    pill.ta.addEventListener('input', function () {
      var c = clampNote(pill.ta.value);
      if (c !== pill.ta.value) pill.ta.value = c;
      paintCount(pill.count, pill.ta.value);
    });
    document.addEventListener('mousedown', function (e) {
      if (pill && pill.open && (e.composedPath ? e.composedPath().indexOf(pill.host) < 0 : true)) closePill(true);
    }, true);
    document.documentElement.appendChild(host);
  }

  function removePill() {
    if (!pill) return;
    if (pill.host.parentNode) pill.host.parentNode.removeChild(pill.host);
    pill = null;
  }

  // Pages with no single game or person (store front page, search, wishlist, friend lists...) get a note of their own,
  // keyed by address. Payment/login/account pages are left alone.
  var EXCLUDED_PATHS = /^\/(login|join|checkout|cart|account|steamguard|twofactor)(\/|$)/i;
  function pagePathId(host, pathname) {
    var p = String(pathname || '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    if (!p) p = '/';
    return (String(host).toLowerCase() + p).replace(/[^A-Za-z0-9_.\-\/~]/g, '_').slice(0, 100);
  }

  var profileIdCache = null;
  function subject() {
    var id = appIdFromPath();
    if (id) {
      var t = document.getElementById('appHubAppName') || document.querySelector('.apphub_AppName');
      var name = text(t) || document.title.replace(/\s+on Steam\s*$/, '').replace(/^.*?::\s*/, '');
      return { key: 'app:' + id, label: name.slice(0, 120) };
    }
    if (/^\/(id|profiles)\/[^/]+\/?$/.test(location.pathname) &&
        (document.querySelector('.profile_header_centered_persona') || document.querySelector('.profile_header_summary'))) {
      if (!profileIdCache || profileIdCache.path !== location.pathname) profileIdCache = { path: location.pathname, id: profileSteamId() };
      if (profileIdCache.id) return { key: 'user:' + profileIdCache.id, label: text(document.querySelector('.actual_persona_name')).slice(0, 120) };
    }
    if (EXCLUDED_PATHS.test(location.pathname)) return null;
    return { key: 'page:' + pagePathId(location.hostname, location.pathname), label: text({ textContent: document.title }).slice(0, 120) };
  }

  function scanPill() {
    var s = subject();
    if (!settings.pill || !s) { removePill(); return; }
    if (!pill || !pill.host.isConnected) { pill = null; buildPill(); }
    if (pill.key !== s.key) {
      pill.key = s.key;
      setPillOpen(false);
    }
    pill.label = s.label;
    var kind = s.key.split(':')[0], rest = s.key.slice(kind.length + 1);
    pill.title.textContent = s.label || (kind === 'app' ? 'Game ' + rest : kind === 'user' ? 'Person ' + rest : rest);
    applyPillSettings();
    updatePillState();
  }

  function removeInlineSubjects() {
    var all = document.querySelectorAll('.morenotes[data-morenotes-role="subject"]');
    for (var i = 0; i < all.length; i++) if (all[i].parentNode) all[i].parentNode.removeChild(all[i]);
  }

  function scan() {
    if (!loaded) return;
    try {
      if (!settings.inline) removeInlineSubjects();
      scanApp(); scanProfile(); scanFriends(); scanWishlist(); scanPill();
    }
    catch (e) { console.warn('[' + PLUGIN + '] scan failed', e); }
  }

  // ------------------------------------------------------------------ start
  var timer = 0;
  function schedule() { clearTimeout(timer); timer = setTimeout(scan, 250); }

  function start() {
    addStyles();
    var attempts = 0;
    (function tryLoad() {
      call('get_all').then(function (r) {
        if (r.ok && r.notes && typeof r.notes === 'object') { notes = Array.isArray(r.notes) ? {} : r.notes; applySettings(r.settings); loaded = true; scan(); }
        else throw new Error(r.error || 'load_failed');
      }).catch(function (e) {
        attempts++;
        if (attempts < 4) setTimeout(tryLoad, attempts * 1500);
        else console.warn('[' + PLUGIN + '] could not load notes:', e && e.message ? e.message : e);
      });
    })();
    function refreshSettings() {
      if (!loaded) return;
      call('get_settings').then(function (r) { if (r.ok) { applySettings(r.settings); scan(); } }, function () { /* keep current look */ });
    }
    window.addEventListener('focus', refreshSettings);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refreshSettings(); });
    try {
      new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* observer unavailable */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
