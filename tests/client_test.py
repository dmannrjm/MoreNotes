"""Headless Chromium test of the client-side pieces drawn in the main window: the Library tab (docked note tab) and
the address-bar button. The page imitates the main window: a Library area plus the .URLBar structure from the DOM dump
(.URLBar > .URLBarText > .URL, .extensions-bar-container). It does NOT prove the real window exposes them to the plugin."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
built = (root / '.millennium' / 'Dist' / 'index.js').read_text()

HTML = """<html><body style="margin:0">
<div id="library" style="height:800px">Library home</div>
<div class="ContentFrame"><div class="BrowserWrapper"><div class="URLBar" style="display:none">
  <div class="URLBarText"><div class="URL" dir="ltr">https://store.steampowered.com/</div></div>
  <div class="extensions-bar-container"><div class="extensions-bar"></div></div>
</div></div></div></body></html>"""

STUBS = """
window.__modal = []; window.__notes = {}; window.__bad = [];
window.__settings = {pill:true, facing:'right', vertical:50, shape:'pill', size:'medium', color:'#1a9fff', inline:false, backup:true, backupdir:'', iconcolor:'auto', libtab:false, libdock:true};
window.SP_REACT = { createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c }), useState: v => [v, () => {}], useEffect() {} };
window.MILLENNIUM_API = { showModal: (el, win, opts) => window.__modal.push({ el, win, opts }) };
window.MILLENNIUM_BACKEND_IPC = { postMessage() {} };
window.g_PopupManager = { GetExistingPopup: id => (window.__noMain ? null : id === 'SP Desktop_uid0' ? { window } : null) };
window.appStore = { GetAppOverviewByAppID: id => (id === 620 ? { display_name: 'Portal 2' } : null) };
window.Millennium = { callServerMethod: async (p, fn, a) => {
  for (const [k, v] of Object.entries(a || {})) if (typeof v !== 'string') window.__bad.push(fn + ':' + k);
  const u = a && a.json ? JSON.parse(a.json) : {};
  if (fn === 'get_all') return JSON.stringify({ ok: true, notes: window.__notes, settings: window.__settings });
  if (fn === 'get_info') return JSON.stringify({ ok: true, path: 'x', count: 0 });
  if (fn === 'backup_info') return JSON.stringify({ ok: true, enabled: true, dir: 'x', saved_at: 0, count: 0, error: '', restored_from: '', default_dir: 'x' });
  if (fn === 'set_settings') { window.__settings = { ...window.__settings, ...u }; return JSON.stringify({ ok: true, settings: window.__settings }); }
  if (fn === 'set_note') { const t = (u.text || '').trim(); if (t) window.__notes[u.key] = { text: t, label: u.label || '' }; else delete window.__notes[u.key]; return JSON.stringify({ ok: true }); }
  return JSON.stringify({ ok: false, error: 'unknown_fn' });
} };
"""

failures = []
def check(name, cond):
    print(('ok   - ' if cond else 'FAIL - ') + name)
    if not cond: failures.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(HTML)
    page.evaluate(STUBS)
    page.add_script_tag(content=built)
    page.wait_for_function("window.__moreNotes && window.__moreNotes.store.status === 'ready'", timeout=4000)

    tick = lambda: page.evaluate("__moreNotes.libdock.tick(); __moreNotes.urlbar.tick();")
    status = lambda which: page.evaluate("__moreNotes.%s.status" % which)
    sset = lambda patch: page.evaluate("p => __moreNotes.store.saveSettings(p)", patch)
    set_url = lambda u: page.evaluate("u => { document.querySelector('.URL').textContent = u; }", u)
    web_mode = lambda on: page.evaluate("on => { document.querySelector('.URLBar').style.display = on ? 'flex' : 'none'; }", on)
    DOCK = "document.querySelector('#morenotes-library-dock').shadowRoot"
    handle = lambda: page.locator('#morenotes-library-dock .handle').bounding_box()

    # ------------------------------------------------------------------ Library tab
    tick(); page.wait_for_selector('#morenotes-library-dock', state='attached')
    check('the Library tab appears over the Library window', status('libdock') == 'showing' and page.locator('#morenotes-library-dock .handle').is_visible())
    check('it docks on the right edge like the web tab', page.evaluate("%s.querySelector('.wrap').dataset.facing" % DOCK) == 'right' and abs(handle()['x'] + handle()['width'] - 1274) <= 2)
    page.click('#morenotes-library-dock .handle')
    check('the box is titled Library and has a counter', 'Library' in page.inner_text('#morenotes-library-dock .title') and page.inner_text('#morenotes-library-dock .count') == '0 / 4000')
    page.fill('#morenotes-library-dock textarea', 'shelf note \u00e9\U0001F600')
    check('the counter counts characters', page.inner_text('#morenotes-library-dock .count') == '13 / 4000')
    page.click('#morenotes-library-dock .done')
    page.wait_for_function("window.__notes['page:library']")
    check('Done saves the Library note under page:library with the label Library', page.evaluate("__notes['page:library'].text") == 'shelf note \u00e9\U0001F600' and page.evaluate("__notes['page:library'].label") == 'Library')
    check('the tab shows that a note exists', page.evaluate("%s.querySelector('.wrap').dataset.has" % DOCK) == 'true')
    page.click('#morenotes-library-dock .handle'); page.fill('#morenotes-library-dock textarea', 'x' * 4005)
    check('typing past the limit is cut at 4000', page.inner_text('#morenotes-library-dock .count') == '4000 / 4000')
    page.keyboard.press('Escape')
    page.evaluate("__notes['page:library'] && (window.__notes['page:library'].text = 'shelf note')")

    # follows the shared settings
    sset({'facing': 'topleft', 'shape': 'pill', 'color': '#e0589b', 'size': 'medium'}); tick()
    b = handle()
    check('it follows facing / shape / colour (bent corner piece, 68px, pink)', page.evaluate("%s.querySelector('.wrap').dataset.facing" % DOCK) == 'topleft' and abs(b['width'] - 68) <= 1 and abs(b['x']) <= 1 and abs(b['y']) <= 1
          and page.evaluate("getComputedStyle(%s.querySelector('.handle')).backgroundColor" % DOCK) == 'rgb(224, 88, 155)' and page.evaluate("getComputedStyle(%s.querySelector('.handle')).borderBottomRightRadius" % DOCK) == '100%')
    sset({'facing': 'bottom', 'shape': 'tab', 'color': '#1a9fff'}); tick(); b = handle()
    check('bottom edge tab is flush with the bottom', abs(b['y'] + b['height'] - 800) <= 1)
    sset({'facing': 'right', 'shape': 'pill'}); tick()

    # ------------------------------------------------------------------ web page showing: the page has its own tab
    web_mode(True); tick()
    check('hidden while a web page is showing', page.locator('#morenotes-library-dock').count() == 0 and 'web page is showing' in status('libdock'))
    web_mode(False); tick(); page.wait_for_selector('#morenotes-library-dock', state='attached')
    check('back when the Library is showing again, with its note', page.evaluate("%s.querySelector('.wrap').dataset.has" % DOCK) == 'true')

    # ------------------------------------------------------------------ switches
    sset({'libdock': False}); tick()
    check('the Library tab switch removes it', page.locator('#morenotes-library-dock').count() == 0 and status('libdock') == 'turned off')
    sset({'libdock': True}); tick()
    check('and brings it back', page.locator('#morenotes-library-dock').count() == 1)
    sset({'pill': False}); tick()
    check('"Show the tab" off removes it as well', page.locator('#morenotes-library-dock').count() == 0)
    sset({'pill': True}); tick()

    # ------------------------------------------------------------------ address bar option
    check('no address-bar button unless Address bar is chosen', page.locator('#morenotes-urlbtn').count() == 0)
    sset({'facing': 'addressbar'}); web_mode(False); tick()
    check('Library tab hidden when the Address bar option is chosen', page.locator('#morenotes-library-dock').count() == 0 and 'address bar option' in status('libdock'))
    web_mode(True); set_url('https://store.steampowered.com/app/620/Portal_2/'); tick()
    check('button appears beside the address bar on a game page', page.locator('.URLBar #morenotes-urlbtn').count() == 1 and status('urlbar') == 'showing for app:620')
    check('it sits before the extensions bar', page.evaluate("document.getElementById('morenotes-urlbtn').nextElementSibling.className") == 'extensions-bar-container')
    check('it takes the shared colour', page.evaluate("getComputedStyle(document.getElementById('morenotes-urlbtn')).backgroundColor") == 'rgb(26, 159, 255)')
    page.evaluate("window.__modal.length = 0")
    page.click('#morenotes-urlbtn')
    m = page.evaluate("window.__modal.length ? { key: __modal[0].el.props.noteKey, label: __modal[0].el.props.label, fromMain: __modal[0].win === window } : null")
    check('clicking opens the native note editor over the window the click came from', m == {'key': 'app:620', 'label': 'Portal 2', 'fromMain': True})
    set_url('https://store.steampowered.com/'); tick()
    check('the store front page gets a page-note button', status('urlbar') == 'showing for page:store.steampowered.com/')
    set_url('https://steamcommunity.com/profiles/76561197960287930/'); tick()
    check('/profiles/<steamid> pages are keyed by SteamID', status('urlbar') == 'showing for user:76561197960287930')
    for u in ('https://steamcommunity.com/id/gaben', 'https://store.steampowered.com/login/', 'https://store.steampowered.com/checkout/', 'https://example.com/app/620'):
        set_url(u); tick()
        check('no button for %s' % u, page.locator('#morenotes-urlbtn').count() == 0)
    set_url('https://store.steampowered.com/app/620/'); tick()
    page.evaluate("document.getElementById('morenotes-urlbtn').remove()"); tick()
    check('the button is re-added if the page removes it', page.locator('#morenotes-urlbtn').count() == 1)
    sset({'pill': False}); tick()
    check('"Show the tab" off removes the button too', page.locator('#morenotes-urlbtn').count() == 0)
    sset({'pill': True}); tick()
    sset({'facing': 'left'}); tick()
    check('choosing an edge again removes the button', page.locator('#morenotes-urlbtn').count() == 0 and status('urlbar') == 'not selected')
    web_mode(False); tick()
    check('and the Library tab returns', page.locator('#morenotes-library-dock').count() == 1)

    # ------------------------------------------------------------------ failure modes and clean-up
    page.evaluate("window.__noMain = true"); tick()
    check('a missing main window is handled quietly', page.locator('#morenotes-library-dock').count() == 0 and status('libdock') == 'main window not found' and status('urlbar') == 'main window not found')
    page.evaluate("window.__noMain = false"); tick()
    sset({'facing': 'addressbar'}); web_mode(True); set_url('https://store.steampowered.com/app/620/'); tick()
    page.evaluate("__moreNotes.dispose()")
    check('dispose removes the button and the tab and stops polling', page.locator('#morenotes-urlbtn').count() == 0 and page.locator('#morenotes-library-dock').count() == 0
          and page.evaluate("__moreNotes.urlbar.timer") == 0 and page.evaluate("__moreNotes.libdock.timer") == 0)
    check('only plain strings were sent to the backend', page.evaluate("window.__bad.length") == 0)
    # ------------------------------------------------------------------ Library tab inside Steam's content area
    # Layout from the Library DOM dump: OuterFrame > TopBar, ContentFrame (> LocalContentContainer, BrowserWrapper), BottomBarContainer
    LAYOUT = """<html><body style="margin:0"><div class="OuterFrame" style="display:flex;flex-direction:column;height:800px;width:1280px">
      <div class="TopBar" style="height:64px;flex:none">top</div>
      <div class="ContentFrame" style="position:relative;flex:1;margin:0 12px 0 10px;min-height:0">
        <div class="LocalContentContainer" style="display:flex;height:100%"><div class="LeftListSizableContainer" style="width:340px;flex:none">list</div><div class="LibraryWindowDivider" style="width:8px;flex:none;margin:34px 0 20px 0">line</div><div class="MainPanel" style="flex:1;margin:34px 0 20px 0">main page</div></div>
        <div class="BrowserWrapper" style="display:none"><div class="URLBar" style="display:none"><div class="URLBarText"><div class="URL">x</div></div></div></div>
      </div>
      <div class="BottomBarContainer" style="height:48px;flex:none">bottom</div></div></body></html>"""
    page2 = browser.new_page(viewport={'width': 1280, 'height': 800})
    page2.on('pageerror', lambda e: errors.append(str(e)))
    page2.set_content(LAYOUT); page2.evaluate(STUBS); page2.add_script_tag(content=built)
    page2.wait_for_function("window.__moreNotes && window.__moreNotes.store.status === 'ready'", timeout=4000)
    page2.evaluate("__moreNotes.libdock.tick()"); page2.wait_for_selector('#morenotes-library-dock', state='attached')
    frame = page2.evaluate("(() => { const r = document.querySelector('.ContentFrame').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    centre = hb['y'] + hb['height'] / 2
    dv0 = page2.evaluate("(() => { const r = document.querySelector('.LibraryWindowDivider').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()")
    check('the tab sits inside the library area: its vertical position is a share of the divider line\'s length, not of the whole window',
          abs(centre - (dv0['top'] + (dv0['bottom'] - dv0['top']) * 0.5)) <= 3)
    check('the tab stays clear of the top bar and bottom bar', hb['y'] >= frame['top'] and hb['y'] + hb['height'] <= frame['bottom'])
    check('the tab sits against the content frame\'s right edge, not the window edge', abs((hb['x'] + hb['width']) - (frame['right'] - 6)) <= 2)
    page2.evaluate("__moreNotes.store.saveSettings({ vertical: 8 })"); page2.evaluate("__moreNotes.libdock.tick()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('even at the top setting the tab stays below the top bar', hb['y'] >= frame['top'] - 1)
    page2.evaluate("__moreNotes.store.saveSettings({ vertical: 92 })"); page2.evaluate("__moreNotes.libdock.tick()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('even at the bottom setting the tab stays above the bottom bar', hb['y'] + hb['height'] <= frame['bottom'] + 1)
    page2.evaluate("__moreNotes.store.saveSettings({ vertical: 50, facing: 'topright' })"); page2.evaluate("__moreNotes.libdock.tick()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('a corner tab sits in the content frame\'s corner', hb['y'] >= frame['top'] - 1 and hb['x'] + hb['width'] <= frame['right'] + 1)
    page2.evaluate("__moreNotes.store.saveSettings({ facing: 'left', vertical: 50 })"); page2.evaluate("__moreNotes.libdock.tick()")
    dv = page2.evaluate("(() => { const r = document.querySelector('.LibraryWindowDivider').getBoundingClientRect(); return { right: r.right, top: r.top, bottom: r.bottom }; })()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('a left-facing tab follows the library divider line: its left edge touches the line\'s right edge', abs(hb['x'] - dv['right']) <= 1.5)
    page2.evaluate("__moreNotes.store.saveSettings({ size: 'large', vertical: 2 })"); page2.evaluate("__moreNotes.libdock.tick()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('a tall tab at the top setting is slid down so none of it pokes above the line\'s top end', hb['y'] >= dv['top'] - 1)
    page2.evaluate("__moreNotes.store.saveSettings({ vertical: 98 })"); page2.evaluate("__moreNotes.libdock.tick()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('and at the bottom setting none of it goes below the line\'s bottom end', hb['y'] + hb['height'] <= dv['bottom'] + 1)
    page2.evaluate("__moreNotes.store.saveSettings({ vertical: 2 })"); page2.evaluate("__moreNotes.libdock.tick()")
    page2.locator('#morenotes-library-dock .handle').click()
    pb = page2.locator('#morenotes-library-dock .panel').bounding_box()
    check('the open note box also stays within the line\'s top and bottom ends', pb['y'] >= dv['top'] - 1 and pb['y'] + pb['height'] <= dv['bottom'] + 1)
    page2.locator('#morenotes-library-dock .handle').click()
    for vv in (0, 50, 100):
        page2.evaluate("__moreNotes.store.saveSettings({ size: 'large', facing: 'left', vertical: %d })" % vv); page2.evaluate("__moreNotes.libdock.tick()")
        before = page2.locator('#morenotes-library-dock .handle').bounding_box()
        page2.locator('#morenotes-library-dock .handle').click()
        after = page2.locator('#morenotes-library-dock .handle').bounding_box()
        pb = page2.locator('#morenotes-library-dock .panel').bounding_box()
        check('opening the note box does not move the tab (offset %d)' % vv, abs(before['y'] - after['y']) <= 0.5 and abs(before['x'] - after['x']) <= 0.5)
        check('and the box stays inside the main page at offset %d' % vv, pb['y'] >= dv['top'] - 1 and pb['y'] + pb['height'] <= dv['bottom'] + 1 and pb['x'] >= after['x'] + after['width'])
        page2.locator('#morenotes-library-dock .handle').click()
    page2.evaluate("__moreNotes.store.saveSettings({ size: 'medium', facing: 'bottomleft' })"); page2.evaluate("__moreNotes.libdock.tick()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('a left corner tab starts at the line and stays above the line\'s bottom end', hb['x'] >= dv['right'] - 1 and hb['y'] + hb['height'] <= dv['bottom'] + 1)
    # a theme (SpaceTheme) turns the divider into a short grab bar in the middle: the tab must still use the main page's length
    page2.evaluate("(() => { const d = document.querySelector('.LibraryWindowDivider'); d.style.alignSelf = 'center'; d.style.height = '200px'; d.style.margin = '0'; })()")
    mp = page2.evaluate("(() => { const r = document.querySelector('.MainPanel').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()")
    page2.evaluate("__moreNotes.store.saveSettings({ facing: 'left', size: 'large', vertical: 0 })"); page2.evaluate("__moreNotes.libdock.tick()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('with a short grab-bar divider, offset 0 puts the tab flush in the top corner of the main page', abs(hb['y'] - mp['top']) <= 1.5)
    page2.evaluate("__moreNotes.store.saveSettings({ vertical: 100 })"); page2.evaluate("__moreNotes.libdock.tick()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('and offset 100 puts it flush in the bottom corner', abs((hb['y'] + hb['height']) - mp['bottom']) <= 1.5)
    page2.evaluate("(() => { const d = document.querySelector('.LibraryWindowDivider'); d.style.alignSelf = ''; d.style.height = ''; d.style.margin = '34px 0 20px 0'; })()")
    page2.evaluate("__moreNotes.store.saveSettings({ size: 'medium' })")
    page2.evaluate("document.querySelector('.LibraryWindowDivider').style.display = 'none'")
    page2.evaluate("__moreNotes.store.saveSettings({ facing: 'left', vertical: 50 })"); page2.evaluate("__moreNotes.libdock.tick()")
    listr = page2.evaluate("document.querySelector('.LeftListSizableContainer').getBoundingClientRect().right")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('without a divider, the left edge is the game list\'s edge', hb['x'] >= listr - 1 and hb['x'] <= listr + 8)
    page2.evaluate("document.querySelector('.LeftListSizableContainer').style.display = 'none'")
    page2.evaluate("__moreNotes.libdock.tick()")
    hb = page2.locator('#morenotes-library-dock .handle').bounding_box()
    check('with the game list hidden too, the left edge is the content area\'s edge', abs(hb['x'] - (frame['left'] + 6)) <= 2)
    page2.evaluate("document.querySelector('.LeftListSizableContainer').style.display = 'block'")
    page2.evaluate("document.querySelector('.LibraryWindowDivider').style.display = 'block'")
    page2.evaluate("__moreNotes.store.saveSettings({ facing: 'right' })")
    page2.evaluate("document.querySelector('.LocalContentContainer').style.display = 'none'"); page2.evaluate("__moreNotes.libdock.tick()")
    check('the tab hides while the Library itself is not on screen (a settings window covers it)',
          page2.locator('#morenotes-library-dock').count() == 0 and 'Library is not showing' in page2.evaluate("__moreNotes.libdock.status"))
    page2.evaluate("document.querySelector('.LocalContentContainer').style.display = 'flex'"); page2.evaluate("__moreNotes.libdock.tick()")
    check('and comes back when the Library shows again', page2.locator('#morenotes-library-dock .handle').count() == 1)

    check('no page errors' + (' ' + repr(errors[:3]) if errors else ''), not errors)
    page.screenshot(path='/tmp/client_last.png')
    browser.close()

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)
