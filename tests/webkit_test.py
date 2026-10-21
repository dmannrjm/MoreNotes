"""Headless Chromium test of webkit/index.js against static fixture pages.
Fixtures imitate Steam page structure from memory; they do NOT prove the selectors match the live sites."""
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
script = (root / '.millennium' / 'Dist' / 'webkit.js').read_text()

store_notes = {}
calls = []
# legacy inline-chip tests run first with the pill off; pill tests switch the settings later
settings = {'pill': False, 'facing': 'right', 'vertical': 50, 'shape': 'pill', 'size': 'medium', 'color': '#1a9fff', 'inline': True, 'iconcolor': 'auto'}

bad_args = []

def backend(fn, raw):
    args = json.loads(raw)
    calls.append(fn)
    if any(not isinstance(v, str) for v in args.values()): bad_args.append(fn)
    if args and list(args) != ['json']: bad_args.append(fn + ':not-packed')
    if 'json' in args: args = json.loads(args['json'])
    if fn == 'get_all':
        return json.dumps({'ok': True, 'notes': store_notes, 'settings': settings})
    if fn == 'get_settings':
        return json.dumps({'ok': True, 'settings': settings})
    if fn == 'set_note':
        text = (args.get('text') or '').strip()
        if text:
            store_notes[args['key']] = {'text': text, 'label': args.get('label', ''), 'updated': 1}
        else:
            store_notes.pop(args['key'], None)
        return json.dumps({'ok': True})
    return json.dumps({'ok': False, 'error': 'unknown_fn'})

INIT = """
window.Millennium = { callServerMethod: (p, fn, args) => window.__backend(fn, JSON.stringify(args || {})) };
"""

PAGES = {
 'https://store.steampowered.com/app/620/Portal_2/': '<html><body><div id="appHubAppName">Portal 2</div><p>store page</p></body></html>',
 'https://store.steampowered.com/': '<html><head><title>Welcome to Steam</title></head><body><p>front page</p></body></html>',
 'https://store.steampowered.com/login/': '<html><head><title>Sign In</title></head><body>login</body></html>',
 'https://store.steampowered.com/checkout/': '<html><body>checkout</body></html>',
 'https://example.com/app/620': '<html><body><div id="appHubAppName">Not Steam</div></body></html>',
 'https://steamcommunity.com/id/gaben': '''<html><body><div class="profile_header_centered_persona"><span class="actual_persona_name">Gabe</span></div>
   <script>window.g_rgProfileData={steamid:"76561197960287930"};</script></body></html>''',
 'https://steamcommunity.com/id/gaben/friends/': '''<html><body>
   <div class="friend_block_v2" data-steamid="76561198000000001"><div class="friend_block_content">Alice<br><span>Online</span></div></div>
   <div class="friend_block_v2" data-steamid="76561198000000002"><div class="friend_block_content">Bob<br><span>Offline</span></div></div>
   </body></html>''',
 'https://store.steampowered.com/wishlist/id/gaben/': '''<html><body><div id="root"></div><script>
   setTimeout(()=>{ const root=document.getElementById('root');
     [['620','Portal 2'],['730','Counter-Strike 2'],['440','Team Fortress 2']].forEach(([id,name])=>{
       const row=document.createElement('div'); row.className='row';
       row.innerHTML='<a href="https://store.steampowered.com/app/'+id+'/"><img alt="'+name+'" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a><div class="info"><a href="https://store.steampowered.com/app/'+id+'/">'+name+'</a><span>$9.99</span></div>';
       root.appendChild(row); }); }, 300);
   </script></body></html>''',
}

failures = []
def check(name, cond):
    print(('ok   - ' if cond else 'FAIL - ') + name)
    if not cond: failures.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context()
    ctx.expose_function('__backend', backend)
    ctx.add_init_script(INIT)
    ctx.add_init_script(script)
    def route(r):
        url = r.request.url
        body = PAGES.get(url) or PAGES.get(url.rstrip('/')) or PAGES.get(url + '/')
        if body is None: r.fulfill(status=404, body='nf'); return
        r.fulfill(status=200, content_type='text/html', body=body)
    ctx.route('**/*', route)

    # store page: add, persist, reload, delete
    page = ctx.new_page()
    page.goto('https://store.steampowered.com/app/620/Portal_2/')
    page.wait_for_selector('.morenotes')
    check('store app page shows an add-note link', 'Add note' in page.inner_text('.morenotes'))
    page.click('.morenotes a')
    page.fill('.morenotes textarea', 'finish the co-op campaign <b>x</b>')
    page.click('text=Save')
    page.wait_for_function("document.querySelector('.morenotes').innerText.startsWith('Note:')")
    check('note saved to backend under app:620', store_notes.get('app:620', {}).get('text') == 'finish the co-op campaign <b>x</b>')
    check('label captured from the page title', store_notes['app:620']['label'] == 'Portal 2')
    check('note text rendered as text, not HTML', page.query_selector('.morenotes b') is None)
    page.reload()
    page.wait_for_selector('.morenotes')
    check('note persists across page loads', 'finish the co-op campaign' in page.inner_text('.morenotes'))
    check('only one chip on the page after repeated scans', page.locator('.morenotes').count() == 1)
    page.click('.morenotes a'); page.click('text=Delete')
    page.wait_for_function("document.querySelector('.morenotes').innerText.includes('Add note')")
    check('delete removes the note', 'app:620' not in store_notes)
    page.click('.morenotes a'); page.keyboard.press('Escape')
    check('Escape cancels editing', page.locator('.morenotes textarea').count() == 0)

    # character counter in the inline editor
    page.click('.morenotes a')
    check('inline editor shows a counter beneath the box', page.inner_text('.morenotes-count') == '0 / 4000')
    check('the counter sits after the text area', page.evaluate("document.querySelector('.morenotes textarea').nextElementSibling.className.startsWith('morenotes-count')"))
    page.fill('.morenotes textarea', 'h\u00e9llo \U0001F600')
    check('counts characters (an emoji is one)', page.inner_text('.morenotes-count') == '7 / 4000')
    page.fill('.morenotes textarea', 'a' * 3700)
    check('counter turns amber from 90%', 'warn' in page.get_attribute('.morenotes-count', 'class'))
    page.fill('.morenotes textarea', 'a' * 4005)
    check('typing past the limit is cut and the counter turns red', len(page.input_value('.morenotes textarea')) == 4000 and page.inner_text('.morenotes-count') == '4000 / 4000' and 'full' in page.get_attribute('.morenotes-count', 'class'))
    page.fill('.morenotes textarea', '\U0001F600' * 4001)
    check('emoji are cut at 4000 characters, not 2000', page.inner_text('.morenotes-count') == '4000 / 4000' and len(list(page.input_value('.morenotes textarea'))) == 4000)
    page.keyboard.press('Escape')

    # profile page
    page.goto('https://steamcommunity.com/id/gaben')
    page.wait_for_selector('.morenotes')
    page.click('.morenotes a'); page.fill('.morenotes textarea', 'trading partner')
    page.keyboard.press('Control+Enter')
    page.wait_for_function("document.querySelector('.morenotes').innerText.startsWith('Note:')")
    check('profile note keyed by steamid64 from g_rgProfileData', store_notes.get('user:76561197960287930', {}).get('text') == 'trading partner')
    check('profile label is the persona name', store_notes['user:76561197960287930']['label'] == 'Gabe')

    # friends list
    page.goto('https://steamcommunity.com/id/gaben/friends/')
    page.wait_for_selector('.morenotes')
    check('one chip per friend block', page.locator('.morenotes').count() == 2)
    page.locator('.morenotes a').first.click()
    page.fill('.morenotes textarea', 'owes me a game'); page.click('text=Save')
    page.wait_for_function("document.querySelector('.morenotes').innerText.startsWith('Note:')")
    check('friend note keyed by data-steamid', store_notes.get('user:76561198000000001', {}).get('text') == 'owes me a game')
    check('friend label is the name text', store_notes['user:76561198000000001']['label'] == 'Alice')
    check('URL unchanged after clicking chip inside block', page.url.endswith('/friends/'))

    # wishlist (rows appear after load, like a React page)
    page.goto('https://store.steampowered.com/wishlist/id/gaben/')
    page.wait_for_function("document.querySelectorAll('.morenotes').length >= 3", timeout=5000)
    check('wishlist: exactly one chip per row', page.locator('.morenotes').count() == 3 and page.locator('.row > .morenotes').count() == 3)
    page.locator('.row').nth(1).locator('.morenotes a').click()
    page.fill('.morenotes textarea', 'wait for sale'); page.click('text=Save')
    page.wait_for_function("document.querySelectorAll('.morenotes')[1].innerText.startsWith('Note:')")
    check('wishlist note keyed by app id', store_notes.get('app:730', {}).get('text') == 'wait for sale')
    check('wishlist label from link text', store_notes['app:730']['label'] == 'Counter-Strike 2')


    # ------------------------------------------------------------------ pill
    store_notes.clear()
    settings.update({'pill': True, 'inline': False, 'facing': 'right', 'shape': 'pill', 'size': 'medium', 'color': '#1a9fff', 'vertical': 50})
    pg = ctx.new_page()
    pg.set_viewport_size({'width': 1280, 'height': 800})
    pg.goto('https://store.steampowered.com/app/620/Portal_2/')
    pg.wait_for_selector('#morenotes-pill', state='attached')
    check('pill appears on a game page', pg.locator('#morenotes-pill .handle').count() == 1)
    check('inline line is off by default', pg.locator('.morenotes').count() == 0)
    box = pg.locator('#morenotes-pill .handle').bounding_box()
    check('pill docks on the right edge', 1280 - (box['x'] + box['width']) < 12)
    check('pill is vertically centred at 50%', abs((box['y'] + box['height'] / 2) - 400) < 4)
    check('panel hidden until expanded', not pg.locator('#morenotes-pill textarea').is_visible())
    pg.screenshot(path='/tmp/pill_collapsed.png')
    pg.click('#morenotes-pill .handle')
    check('clicking the pill expands the notation area', pg.locator('#morenotes-pill textarea').is_visible())
    check('panel title shows the game name', 'Portal 2' in pg.locator('#morenotes-pill .title').inner_text())
    check('pill box shows a counter beneath the text area', pg.inner_text('#morenotes-pill .count') == '0 / 4000' and pg.evaluate("document.querySelector('#morenotes-pill').shadowRoot.querySelector('textarea').nextElementSibling.className.startsWith('count')"))
    pg.fill('#morenotes-pill textarea', 'x' * 4005)
    check('pill counter clamps at the limit and turns red', pg.inner_text('#morenotes-pill .count') == '4000 / 4000' and len(pg.input_value('#morenotes-pill textarea')) == 4000 and 'full' in pg.get_attribute('#morenotes-pill .count', 'class'))
    pg.fill('#morenotes-pill textarea', 'x' * 3700)
    check('pill counter amber from 90%', 'warn' in pg.get_attribute('#morenotes-pill .count', 'class'))
    pg.fill('#morenotes-pill textarea', '')
    pg.fill('#morenotes-pill textarea', 'try the speedrun route')
    check('pill counter follows typing', pg.inner_text('#morenotes-pill .count') == '22 / 4000')
    pg.screenshot(path='/tmp/pill_open.png')
    pg.click('#morenotes-pill .done')
    pg.wait_for_function("document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap').dataset.open==='false'")
    check('Done saves under app:620', store_notes.get('app:620', {}).get('text') == 'try the speedrun route')
    check('pill marks that a note exists', pg.locator('#morenotes-pill .wrap').get_attribute('data-has') == 'true')
    check('hover title carries the note', 'speedrun' in (pg.locator('#morenotes-pill .handle').get_attribute('title') or ''))

    # click outside with unsaved changes autosaves
    pg.click('#morenotes-pill .handle')
    pg.fill('#morenotes-pill textarea', 'try the speedrun route twice')
    pg.mouse.click(300, 300)
    pg.wait_for_function("document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap').dataset.open==='false'")
    check('clicking outside saves and collapses', store_notes['app:620']['text'] == 'try the speedrun route twice')

    # Escape saves and collapses; Delete removes
    pg.click('#morenotes-pill .handle'); pg.fill('#morenotes-pill textarea', 'esc note'); pg.keyboard.press('Escape')
    pg.wait_for_function("document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap').dataset.open==='false'")
    check('Escape saves and collapses', store_notes['app:620']['text'] == 'esc note')
    pg.click('#morenotes-pill .handle'); pg.click('#morenotes-pill .del')
    pg.wait_for_function("document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap').dataset.has==='false'")
    check('Delete removes the note', 'app:620' not in store_notes)

    # settings: left edge, circle, custom colour, top-ish; applied when the page regains focus
    settings.update({'facing': 'left', 'shape': 'circle', 'color': '#e0589b', 'vertical': 20, 'size': 'large'})
    pg.evaluate("window.dispatchEvent(new Event('focus'))")
    pg.wait_for_function("document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap').dataset.facing==='left'")
    box = pg.locator('#morenotes-pill .handle').bounding_box()
    check('pill moves to the left edge', box['x'] < 12)
    check('pill height follows the vertical setting', abs((box['y'] + box['height'] / 2) - 160) < 4)
    check('circle shape and large size', abs(box['width'] - 56) < 1 and abs(box['height'] - 56) < 1)
    colour = pg.evaluate("getComputedStyle(document.querySelector('#morenotes-pill').shadowRoot.querySelector('.handle')).backgroundColor")
    check('colour setting applied', colour == 'rgb(224, 88, 155)')
    fg = lambda: pg.evaluate("getComputedStyle(document.querySelector('#morenotes-pill').shadowRoot.querySelector('.handle')).color")
    check('automatic icon colour picks a readable shade (light on pink)', fg() == 'rgb(255, 255, 255)')
    settings.update({'iconcolor': 'dark', 'color': '#ffffff'})
    pg.evaluate("window.dispatchEvent(new Event('focus'))")
    pg.wait_for_function("getComputedStyle(document.querySelector('#morenotes-pill').shadowRoot.querySelector('.handle')).backgroundColor==='rgb(255, 255, 255)'")
    check('dark icon colour is applied', fg() == 'rgb(16, 24, 32)')
    settings.update({'iconcolor': 'light', 'color': '#e0589b'})
    pg.evaluate("window.dispatchEvent(new Event('focus'))")
    pg.wait_for_function("getComputedStyle(document.querySelector('#morenotes-pill').shadowRoot.querySelector('.handle')).backgroundColor==='rgb(224, 88, 155)'")
    check('light icon colour is applied', fg() == 'rgb(255, 255, 255)')
    settings.update({'iconcolor': 'auto'})
    pg.screenshot(path='/tmp/pill_circle_left.png')
    pg.click('#morenotes-pill .handle')
    pbox = pg.locator('#morenotes-pill .panel').bounding_box()
    check('panel opens to the right of a left-docked pill', pbox['x'] > box['x'] + box['width'])
    pg.keyboard.press('Escape')

    for shape in ('square', 'tab'):
        settings.update({'shape': shape, 'facing': 'right', 'vertical': 60, 'size': 'medium', 'color': '#5ba32b'})
        pg.evaluate("window.dispatchEvent(new Event('focus'))")
        pg.wait_for_function("document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap').dataset.shape==='%s'" % shape)
        pg.screenshot(path='/tmp/pill_%s.png' % shape)
        check('%s shape renders' % shape, pg.locator('#morenotes-pill .handle').is_visible())


    # ------------------------------------------------------------------ facing: edges and corners
    WRAP = "document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap')"
    def look(**kw):
        settings.update(kw)
        pg.evaluate("window.dispatchEvent(new Event('focus'))")
        pg.wait_for_function("(()=>{const w=%s;return w.dataset.facing==='%s'&&w.dataset.shape==='%s'})()" % (WRAP, settings['facing'], settings['shape']))
        pg.wait_for_timeout(60)
    handle = lambda: pg.locator('#morenotes-pill .handle').bounding_box()
    radius = lambda corner: pg.evaluate("getComputedStyle(document.querySelector('#morenotes-pill').shadowRoot.querySelector('.handle')).%s" % corner)
    near = lambda a, b, tol=2: abs(a - b) <= tol
    base = dict(shape='pill', size='medium', vertical=50, color='#1a9fff', iconcolor='auto')

    look(facing='top', **base); b = handle()
    check('top edge: the pill lies flat (wide, short), centred, 6px from the top', near(b['width'], 104) and near(b['height'], 32) and near(b['x'] + b['width'] / 2, 640) and near(b['y'], 6))
    check('top edge: the label reads horizontally', pg.evaluate("getComputedStyle(document.querySelector('#morenotes-pill').shadowRoot.querySelector('.lbl')).writingMode") == 'horizontal-tb')
    pg.click('#morenotes-pill .handle'); pb = pg.locator('#morenotes-pill .panel').bounding_box()
    check('top edge: the box opens below the handle', pb['y'] > b['y'] + b['height'] and pb['x'] >= 0 and pb['x'] + pb['width'] <= 1280)
    pg.keyboard.press('Escape')
    look(facing='bottom', **base); b = handle()
    check('bottom edge: 6px above the bottom, centred', near(b['y'] + b['height'], 794) and near(b['x'] + b['width'] / 2, 640))
    pg.click('#morenotes-pill .handle'); pb = pg.locator('#morenotes-pill .panel').bounding_box()
    check('bottom edge: the box opens above the handle', pb['y'] + pb['height'] < b['y'])
    pg.keyboard.press('Escape')
    look(facing='top', **{**base, 'vertical': 20}); b = handle()
    check('top edge: the offset moves the tab along the edge (20% of the width)', near(b['x'] + b['width'] / 2, 256))
    look(facing='top', **{**base, 'vertical': 0}); b = handle()
    pg.click('#morenotes-pill .handle'); pb = pg.locator('#morenotes-pill .panel').bounding_box(); pg.keyboard.press('Escape')
    check('top edge: the offset is held within 8%-92% and the box stays on screen', near(b['x'] + b['width'] / 2, 102.4) and pb['x'] >= 0)
    look(facing='bottom', **{**base, 'vertical': 100}); pg.click('#morenotes-pill .handle'); pb = pg.locator('#morenotes-pill .panel').bounding_box(); pg.keyboard.press('Escape')
    check('bottom edge at the far end keeps the box on screen', pb['x'] + pb['width'] <= 1280 and pb['x'] >= 0)
    look(facing='top', **{**base, 'shape': 'tab'}); b = handle()
    check('top edge tab is flush with the edge and rounded away from it', near(b['y'], 0) and near(b['width'], 104) and near(b['height'], 26) and radius('borderBottomLeftRadius') == '12px' and radius('borderTopLeftRadius') == '0px')
    look(facing='bottom', **{**base, 'shape': 'tab'}); b = handle()
    check('bottom edge tab is flush with the bottom', near(b['y'] + b['height'], 800) and radius('borderTopLeftRadius') == '12px' and radius('borderBottomLeftRadius') == '0px')

    corners = {'topleft': ('borderBottomRightRadius', lambda b: near(b['x'], 0) and near(b['y'], 0)),
               'topright': ('borderBottomLeftRadius', lambda b: near(b['x'] + b['width'], 1280) and near(b['y'], 0)),
               'bottomleft': ('borderTopRightRadius', lambda b: near(b['x'], 0) and near(b['y'] + b['height'], 800)),
               'bottomright': ('borderTopLeftRadius', lambda b: near(b['x'] + b['width'], 1280) and near(b['y'] + b['height'], 800))}
    all_radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']
    for f, (inner, flush) in corners.items():
        for shape, expect in (('pill', ['68px', '100%']), ('tab', ['18px']), ('square', ['12px'])):
            look(facing=f, **{**base, 'shape': shape}); b = handle()
            others = [radius(c) for c in all_radii if c != inner]
            check('%s %s: bent piece fills the corner (68px) flush with both edges' % (f, shape), near(b['width'], 68) and near(b['height'], 68) and flush(b))
            check('%s %s: only the inner corner is rounded (%s)' % (f, shape, expect[0]), radius(inner) in expect and all(o == '0px' for o in others))
        look(facing=f, **{**base, 'shape': 'circle'}); b = handle()
        check('%s: the dot stays a dot, floating 6px in' % f, near(b['width'], 48) and near(b['height'], 48) and radius('borderTopLeftRadius') in ('50%', '24px') and not flush(b) and (near(b['x'], 6) or near(b['x'] + b['width'], 1274)))
    look(facing='topleft', **base); a1 = handle()
    look(facing='topleft', **{**base, 'vertical': 90}); a2 = handle()
    check('corners ignore the offset', near(a1['x'], a2['x']) and near(a1['y'], a2['y']))
    check('corner pieces show only the icon (no label)', pg.evaluate("getComputedStyle(document.querySelector('#morenotes-pill').shadowRoot.querySelector('.lbl')).display") == 'none')
    look(facing='topleft', **base); hb = handle(); pg.click('#morenotes-pill .handle'); pb = pg.locator('#morenotes-pill .panel').bounding_box(); pg.keyboard.press('Escape')
    check('top-left corner: the box opens below, inside the page', pb['y'] > hb['y'] + hb['height'] and pb['x'] >= 0)
    look(facing='bottomright', **base); hb = handle(); pg.click('#morenotes-pill .handle'); pb = pg.locator('#morenotes-pill .panel').bounding_box(); pg.keyboard.press('Escape')
    check('bottom-right corner: the box opens above, inside the page', pb['y'] + pb['height'] < hb['y'] and pb['x'] + pb['width'] <= 1280)
    look(facing='topright', **base); pg.click('#morenotes-pill .handle'); pb = pg.locator('#morenotes-pill .panel').bounding_box(); pg.keyboard.press('Escape')
    check('top-right corner: the box is right-aligned inside the page', pb['x'] + pb['width'] <= 1280 and pb['x'] >= 0)
    look(facing='bottomleft', **{**base, 'size': 'large'}); b = handle()
    check('large corner pieces are 80px', near(b['width'], 80) and near(b['height'], 80))
    pg.screenshot(path='/tmp/pill_corner_bl.png')
    look(facing='topright', **{**base, 'color': '#e0589b'}); pg.screenshot(path='/tmp/pill_corner_tr.png')
    look(facing='top', **base); pg.screenshot(path='/tmp/pill_top.png')
    look(facing='right', **base)

    # address bar option: the edge tab is not drawn on web pages
    settings.update({'facing': 'addressbar'})
    pg.evaluate("window.dispatchEvent(new Event('focus'))")
    pg.wait_for_function("!document.querySelector('#morenotes-pill')")
    check('the Address bar option removes the edge tab on web pages', pg.locator('#morenotes-pill').count() == 0)
    settings.update({'facing': 'right'})
    pg.evaluate("window.dispatchEvent(new Event('focus'))")
    pg.wait_for_selector('#morenotes-pill', state='attached')
    check('choosing an edge again brings the tab back', pg.locator('#morenotes-pill .handle').is_visible())

    # inline setting on/off
    settings.update({'inline': True})
    pg.evaluate("window.dispatchEvent(new Event('focus'))")
    pg.wait_for_selector('.morenotes[data-morenotes-role="subject"]')
    check('inline line appears when enabled', pg.locator('.morenotes').count() == 1)
    settings.update({'inline': False})
    pg.evaluate("window.dispatchEvent(new Event('focus'))")
    pg.wait_for_function("document.querySelectorAll('.morenotes').length===0")
    check('inline line removed when disabled', pg.locator('.morenotes').count() == 0)

    # pill off removes it
    settings.update({'pill': False})
    pg.evaluate("window.dispatchEvent(new Event('focus'))")
    pg.wait_for_function("!document.querySelector('#morenotes-pill')")
    check('disabling the pill removes it', pg.locator('#morenotes-pill').count() == 0)
    settings.update({'pill': True})

    # profile page: pill keyed by steam id; list pages: no pill
    pg.goto('https://steamcommunity.com/id/gaben')
    pg.wait_for_selector('#morenotes-pill', state='attached')
    pg.click('#morenotes-pill .handle'); pg.fill('#morenotes-pill textarea', 'pill on profile'); pg.click('#morenotes-pill .done')
    pg.wait_for_function("document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap').dataset.has==='true'")
    check('profile pill note keyed by steamid64', store_notes.get('user:76561197960287930', {}).get('text') == 'pill on profile')
    pg.goto('https://steamcommunity.com/id/gaben/friends/')
    pg.wait_for_selector('.morenotes')
    pg.wait_for_selector('#morenotes-pill', state='attached')
    check('friend list: per-row chips and a page pill', pg.locator('.morenotes').count() == 2 and pg.locator('#morenotes-pill').count() == 1)
    pg.click('#morenotes-pill .handle'); pg.fill('#morenotes-pill textarea', 'friends page note'); pg.click('#morenotes-pill .done')
    pg.wait_for_function("document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap').dataset.has==='true'")
    check('friend list page note keyed by address', store_notes.get('page:steamcommunity.com/id/gaben/friends', {}).get('text') == 'friends page note')
    pg.goto('https://store.steampowered.com/wishlist/id/gaben/')
    pg.wait_for_function("document.querySelectorAll('.morenotes').length >= 3", timeout=5000)
    pg.wait_for_selector('#morenotes-pill', state='attached')
    check('wishlist: per-row chips and a page pill', pg.locator('#morenotes-pill').count() == 1)

    # main store page and other pages without a single subject
    pg.goto('https://store.steampowered.com/')
    pg.wait_for_selector('#morenotes-pill', state='attached')
    check('store front page gets a pill', pg.locator('#morenotes-pill .handle').is_visible())
    pg.click('#morenotes-pill .handle')
    check('front page panel title is the page title', 'Welcome to Steam' in pg.locator('#morenotes-pill .title').inner_text())
    pg.fill('#morenotes-pill textarea', 'check the sale on Friday'); pg.click('#morenotes-pill .done')
    pg.wait_for_function("document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap').dataset.has==='true'")
    check('front page note keyed by address', store_notes.get('page:store.steampowered.com/', {}).get('text') == 'check the sale on Friday')
    check('front page label is the page title', store_notes['page:store.steampowered.com/']['label'] == 'Welcome to Steam')
    pg.reload(); pg.wait_for_selector('#morenotes-pill', state='attached')
    pg.wait_for_function("document.querySelector('#morenotes-pill').shadowRoot.querySelector('.wrap').dataset.has==='true'")
    check('front page note persists', True)
    pg.goto('https://store.steampowered.com/login/'); pg.wait_for_timeout(700)
    check('login page is left alone', pg.locator('#morenotes-pill').count() == 0)
    pg.goto('https://store.steampowered.com/checkout/'); pg.wait_for_timeout(700)
    check('checkout page is left alone', pg.locator('#morenotes-pill').count() == 0)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('https://example.com/app/620'); pg.wait_for_timeout(700)
    check('other sites are untouched', pg.locator('#morenotes-pill').count() == 0 and pg.locator('.morenotes').count() == 0 and not errs)
    pg.close()

    # backend down: no crash, no chips
    page2 = ctx.new_page()
    errors = []
    page2.on('pageerror', lambda e: errors.append(str(e)))
    ctx2 = browser.new_context()
    ctx2.route('**/*', route)
    ctx2.add_init_script(script)  # no Millennium object at all
    pg = ctx2.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('https://store.steampowered.com/app/620/Portal_2/')
    pg.wait_for_timeout(600)
    check('without Millennium the page is untouched and throws no errors', pg.locator('.morenotes').count() == 0 and not errors)
    browser.close()

check('only plain strings were sent to the backend', not bad_args and len(calls) > 10)
print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)
