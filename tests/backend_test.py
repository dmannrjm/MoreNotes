"""Runs backend/main.lua under a real Lua interpreter (liblua5.4 via ctypes) with stubbed `millennium`/`logger` modules.
The host is LuaJIT, not Lua 5.4, and the real Millennium argument/return plumbing is not reproduced; this checks the
backend's own logic (JSON codec, settings validation, storage), not how Steam calls it."""
import ctypes, json, os, shutil, sys, time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
STEAM = Path('/tmp/steamtest')
BACKEND = STEAM / 'millennium' / 'plugins' / 'MoreNotes' / 'backend' / 'main.lua'
NOTES = STEAM / 'config' / 'MoreNotes_notes.json'
HOME = Path('/tmp/steamtest_home'); APPD = Path('/tmp/steamtest_appdata'); CUSTOM = Path('/tmp/steamtest_custom')
os.environ['USERPROFILE'] = str(HOME); os.environ['HOME'] = str(HOME); os.environ['APPDATA'] = str(APPD)
BK = HOME / 'Documents' / 'MoreNotes'            # the default (1.7.0): <home>/Documents/MoreNotes
BK_OLD = STEAM / 'millennium' / 'More-Notes'      # the 1.3-1.6 default, now a fallback
BK_DOCS = HOME / 'Documents' / 'MoreNotes Backup'      # older fallback
BK_APPDATA = APPD / 'MoreNotes'                          # fallback

lib = ctypes.CDLL('liblua5.4.so.0')
lib.luaL_newstate.restype = ctypes.c_void_p
lib.luaL_openlibs.argtypes = [ctypes.c_void_p]
lib.luaL_loadstring.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
lib.lua_pcallk.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ssize_t, ctypes.c_void_p]
lib.lua_tolstring.restype = ctypes.c_char_p
lib.lua_tolstring.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
lib.lua_settop.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.lua_close.argtypes = [ctypes.c_void_p]

class Lua:
    def __init__(self, backend=None, steam_path='/tmp/steamtest'):
        self.L = lib.luaL_newstate(); lib.luaL_openlibs(self.L)
        self.run("""
          package.preload['millennium'] = function() return { ready = function() READY = (READY or 0) + 1 end, steam_path = function() return '%s' end } end
          package.preload['logger'] = function() return { info = function(self, m) end } end
          dofile('%s')""" % (steam_path, backend or BACKEND))
    def run(self, code):
        if lib.luaL_loadstring(self.L, ('return (function() ' + code + ' end)()').encode()) != 0:
            msg = lib.lua_tolstring(self.L, -1, None); raise RuntimeError('load: ' + msg.decode())
        if lib.lua_pcallk(self.L, 0, 1, 0, 0, None) != 0:
            msg = lib.lua_tolstring(self.L, -1, None); lib.lua_settop(self.L, -2); raise RuntimeError('lua error: ' + (msg or b'?').decode())
        out = lib.lua_tolstring(self.L, -1, None); lib.lua_settop(self.L, -2)
        return out.decode() if out is not None else None
    def call(self, fn, lua_args='nil'):
        return json.loads(self.run('return %s(%s)' % (fn, lua_args)))
    def close(self): lib.lua_close(self.L)

def lua_str(s):  # a Lua long-string literal for arbitrary text
    return '[==[' + s + ']==]'

def fresh():
    for d in (STEAM, HOME, APPD, CUSTOM):
        if d.exists(): shutil.rmtree(d)
    BACKEND.parent.mkdir(parents=True); (STEAM / 'config').mkdir()
    shutil.copy(root / 'backend' / 'main.lua', BACKEND)

failures = []
def check(name, cond):
    print(('ok   - ' if cond else 'FAIL - ') + name)
    if not cond: failures.append(name)

DEFAULTS = {'pill': True, 'facing': 'right', 'vertical': 50, 'shape': 'pill', 'size': 'medium', 'color': '#1a9fff', 'inline': False, 'backup': True, 'backupdir': '', 'backupfile': '', 'snapdir': '', 'iconcolor': 'auto', 'libtab': False, 'libdock': True}

fresh()
L = Lua()
r = L.call('get_all')
check('get_all on a fresh install returns defaults and no notes', r['ok'] and r['notes'] == {} and r['settings'] == DEFAULTS)
for a in ('nil', "''", '{}'):
    check('get_all tolerates args %s' % a, L.call('get_all', a)['ok'])
L.run('on_load() on_load() return ""')
check('ready() is called once even if on_load runs twice', L.run('return tostring(READY)') == '1')
check('get_info reports the config path', L.call('get_info')['path'] == '/tmp/steamtest/config/MoreNotes_notes.json')

# ---- the call that crashed Steam: settings, delivered as one JSON string
payload = json.dumps({'pill': False, 'facing': 'left', 'vertical': 30, 'shape': 'circle', 'size': 'large', 'color': '#E0589B', 'inline': True})
r = L.call('set_settings', '{ json = %s }' % lua_str(payload))
check('set_settings accepts one JSON string and returns the settings', r['ok'] and r['settings'] == {'pill': False, 'facing': 'left', 'vertical': 30, 'shape': 'circle', 'size': 'large', 'color': '#e0589b', 'inline': True, 'backup': True, 'backupdir': '', 'backupfile': '', 'snapdir': '', 'iconcolor': 'auto', 'libtab': False, 'libdock': True})
check('settings are written to disk', json.loads(NOTES.read_text())['settings']['facing'] == 'left')
L.close(); L = Lua()
check('settings survive a restart', L.call('get_all')['settings']['shape'] == 'circle' and L.call('get_settings')['settings']['color'] == '#e0589b')

r = L.call('set_settings', "{ pill = 'true', vertical = '45' }")
check('string-valued table arguments still work', r['ok'] and r['settings']['pill'] is True and r['settings']['vertical'] == 45)
before = L.call('get_settings')['settings']
bad = json.dumps({'facing': 'sideways', 'side': 'top', 'shape': 'star', 'size': 'huge', 'vertical': 'abc', 'color': 'red', 'pill': 'maybe', 'inline': 7})
L.call('set_settings', '{ json = %s }' % lua_str(bad))
check('invalid values are ignored', L.call('get_settings')['settings'] == before)
check('vertical is clamped to 0-100', L.call('set_settings', '{ json = %s }' % lua_str('{"vertical":150}'))['settings']['vertical'] == 100 and L.call('set_settings', '{ json = %s }' % lua_str('{"vertical":-5}'))['settings']['vertical'] == 0)
check('whole-document string argument works', L.call('set_settings', lua_str('{"facing":"right"}'))['settings']['facing'] == 'right')
check('a leftover urlbar key from an older version is ignored', 'urlbar' not in L.call('set_settings', '{ json = %s }' % lua_str('{"urlbar":false,"facing":"left"}'))['settings'])
r = L.call('set_settings', '{ json = %s }' % lua_str('{"iconcolor":"dark","libtab":true}'))
check('icon colour and library-tab settings are accepted', r['settings']['iconcolor'] == 'dark' and r['settings']['libtab'] is True)
r = L.call('set_settings', '{ json = %s }' % lua_str('{"iconcolor":"rainbow","libtab":"maybe"}'))
check('invalid icon colour / library-tab values are ignored', r['settings']['iconcolor'] == 'dark' and r['settings']['libtab'] is True)
L.call('set_settings', '{ json = %s }' % lua_str('{"iconcolor":"auto","libtab":false}'))
check('garbage JSON is harmless', L.call('set_settings', '{ json = %s }' % lua_str('{not json'))['ok'])

# ---- notes
r = L.call('set_note', '{ key = "app:620", text = "play co-op", label = "Portal 2" }')
check('set_note stores a note', r['ok'] and L.call('get_all')['notes']['app:620']['text'] == 'play co-op')
check('page keys with / and ~ are accepted', L.call('set_note', '{ key = "page:store.steampowered.com/wishlist/id/x~y", text = "w" }')['ok'])
for bad_key in ('', 'has space', 'bad!key', 'x' * 121, 'quote"d'):
    check('bad key rejected: %r' % bad_key[:20], L.call('set_note', '{ key = %s, text = "x" }' % lua_str(bad_key))['error'] == 'bad_key')
check('missing key rejected', L.call('set_note', '{ text = "x" }')['error'] == 'bad_key')
r = L.call('set_note', '{ text = "secret words" }')
check('a bad key explains what arrived, without echoing note text', 'detail' in r and 'table{' in r['detail'] and 'secret' not in r['detail'])
r = L.call('set_note', lua_str('not json at all'))
check('an undecodable string argument is reported with its length', r['error'] == 'bad_key' and 'string(len=15)' in r['detail'])

# every way the host might hand the arguments over
packed = json.dumps({'key': 'app:900', 'text': 'packed note', 'label': 'Packed'})
check('one packed JSON string in a "json" field', L.call('set_note', '{ json = %s }' % lua_str(packed))['ok'] and L.call('get_all')['notes']['app:900']['text'] == 'packed note')
check('one JSON string as the whole argument', L.call('set_note', lua_str(json.dumps({'key': 'app:901', 'text': 'as string'})))['ok'] and L.call('get_all')['notes']['app:901']['text'] == 'as string')
check('separate positional values (key, text, label)', L.call('set_note', '"app:902", "positional", "Pos"')['ok'] and L.call('get_all')['notes']['app:902']['label'] == 'Pos')
check('a table of strings', L.call('set_note', '{ key = "app:903", text = "table" }')['ok'])
check('delete through a packed argument', L.call('delete_note', '{ json = %s }' % lua_str(json.dumps({'key': 'app:900'})))['ok'] and 'app:900' not in L.call('get_all')['notes'])
check('delete with just the key as a string', L.call('delete_note', '"app:902"')['ok'] and 'app:902' not in L.call('get_all')['notes'])
for k in ('app:901', 'app:903'): L.call('delete_note', '{ key = "%s" }' % k)

tricky = 'quote " backslash \\ newline\nline2\ttab é ü 日本語 😀 </script>'
L.call('set_note', '{ key = "user:76561198000000001", text = %s }' % lua_str(tricky))
L.close(); L = Lua()
check('awkward text round-trips through the file and a restart', L.call('get_all')['notes']['user:76561198000000001']['text'] == tricky)
check('the file is valid JSON for any other reader', json.loads(NOTES.read_text(encoding='utf-8'))['notes']['user:76561198000000001']['text'] == tricky)

r = L.call('set_note', '{ json = %s }' % lua_str(json.dumps({'key': 'user:7656119800000002', 'text': 'emoji \U0001F600 and \u00e9'}, ensure_ascii=True)))
check('JSON \\u escapes (incl. surrogate pairs) decode to UTF-8', r['ok'] and L.call('get_all')['notes']['user:7656119800000002']['text'] == 'emoji \U0001F600 and \u00e9')

L.call('set_note', '{ key = "app:620", text = "  trimmed  " }')
n = L.call('get_all')['notes']['app:620']
check('text is trimmed and the label is kept when none is sent', n['text'] == 'trimmed' and n['label'] == 'Portal 2')
L.call('set_note', '{ key = "app:1", text = "%s", label = "%s" }' % ('a' * 5000, 'b' * 300))
n = L.call('get_all')['notes']['app:1']
check('text capped at 4000 and label at 120', len(n['text']) == 4000 and len(n['label']) == 120)
L.call('set_note', '{ key = "app:mb", text = %s }' % lua_str('é' * 4001))
n = L.call('get_all')['notes']['app:mb']['text']
check('the 4000 limit counts characters, not bytes (accented letters)', len(n) == 4000 and set(n) == {'é'})
L.call('set_note', '{ key = "app:mb", text = %s }' % lua_str('😀' * 4000))
check('4000 emoji (16000 bytes) are all kept', len(L.call('get_all')['notes']['app:mb']['text']) == 4000)
L.call('set_note', '{ key = "app:mb", text = %s }' % lua_str('😀' * 4003))
check('cutting never splits a character', L.call('get_all')['notes']['app:mb']['text'] == '😀' * 4000)
mixed = ('a' + 'é' + '日' + '😀') * 1100  # 4400 characters of 1-4 bytes each
L.call('set_note', '{ key = "app:mb", text = %s }' % lua_str(mixed))
check('mixed-width text is cut at exactly 4000 characters', L.call('get_all')['notes']['app:mb']['text'] == mixed[:4000])
L.call('delete_note', '{ key = "app:mb" }')
L.call('set_note', '{ key = "app:620", text = "   " }')
check('blank text deletes the note', 'app:620' not in L.call('get_all')['notes'])
L.call('delete_note', '{ key = "app:1" }')
check('delete_note removes it', 'app:1' not in L.call('get_all')['notes'])
check('settings survive note edits', L.call('get_settings')['settings']['facing'] == 'left')

# ---- corrupted file
L.close()
for d in (HOME, APPD, CUSTOM, BK):
    if d.exists(): shutil.rmtree(d)
NOTES.write_text('{ this is not json')
L = Lua()
r = L.call('get_all')
check('a corrupt file is set aside and the plugin starts empty', r['ok'] and r['notes'] == {} and Path(str(NOTES) + '.corrupt').exists())
check('writing works again afterwards', L.call('set_note', '{ key = "app:2", text = "again" }')['ok'] and json.loads(NOTES.read_text())['notes']['app:2']['text'] == 'again')
L.close()


# =====================================================================================================
# Automatic backup outside the plugin and outside Steam's config folder
# =====================================================================================================
def mirror_doc(d=BK):
    return json.loads((d / 'MoreNotes_notes.json').read_text(encoding='utf-8'))

def mirror_doc_path(p):
    return json.loads(p.read_text(encoding='utf-8'))

fresh()
L = Lua()
L.run('on_load() return ""')
check('first load writes an external copy', (BK / 'MoreNotes_notes.json').exists() and mirror_doc()['settings']['facing'] == 'right' and mirror_doc()['saved_at'] > 0)
L.call('set_note', '{ key = "app:1", text = "one", label = "Game one" }')
check('every note change updates the external copy', mirror_doc()['notes']['app:1']['text'] == 'one')
check('a weekly snapshot is kept (one file per weekday, never more than seven)', (BK / ('MoreNotes_backup_%s.json' % time.strftime('%w'))).exists())
check('today\'s snapshot tracks every save', mirror_doc_path(BK / ('MoreNotes_backup_%s.json' % time.strftime('%w')))['notes']['app:1']['text'] == 'one')
L.call('set_settings', '{ json = %s }' % lua_str('{"facing":"left"}'))
check('settings changes are copied too', mirror_doc()['settings']['facing'] == 'left')
info = L.call('backup_info')
check('backup_info reports folder, time and count', info['ok'] and info['enabled'] and info['dir'] == str(BK) and info['count'] == 1 and info['saved_at'] > 0 and info['error'] == '')
check('the default folder is reported for the settings page', info['default_dir'] == str(BK))
check('no temp files are left behind', not list(BK.glob('*.tmp')) and not list((STEAM / 'config').glob('*.tmp')))
check('the primary file is outside the plugin folder', NOTES.parent == STEAM / 'config')

# primary file lost (new Steam install, deleted config): restored automatically
L.close(); NOTES.unlink()
L = Lua()
r = L.call('get_all')
check('missing primary file is restored from the external copy (notes and settings)', r['notes']['app:1']['text'] == 'one' and r['settings']['facing'] == 'left')
check('the restore is reported and the primary file is back', L.call('backup_info')['restored_from'].endswith('.json') and NOTES.exists())

# primary file damaged
L.close(); NOTES.write_text('{ broken')
L = Lua()
check('damaged primary file is set aside and restored from the copy', L.call('get_all')['notes']['app:1']['text'] == 'one' and Path(str(NOTES) + '.corrupt').exists())

# only a snapshot survives
L.close(); NOTES.unlink(); (BK / 'MoreNotes_notes.json').unlink()
L = Lua()
check('a weekly snapshot is used when the main copy is gone', L.call('get_all')['notes']['app:1']['text'] == 'one')

# switching it off
L.call('set_settings', '{ json = %s }' % lua_str('{"backup":false}'))
L.call('set_note', '{ key = "app:2", text = "two" }')
check('with the copy switched off, changes are not copied', 'app:2' not in mirror_doc()['notes'] and L.call('backup_info')['enabled'] is False)
r = L.call('backup_now')
check('Back up now works even when switched off', r['ok'] and mirror_doc()['notes']['app:2']['text'] == 'two')
L.call('set_note', '{ key = "app:3", text = "three" }')

# restore on request
r = L.call('restore_backup')
check('restore replaces the notes with the copy and reports the count', r['ok'] and r['count'] == 2 and 'app:3' not in L.call('get_all')['notes'])
check('what was replaced is kept as .before-restore', 'app:3' in json.loads(Path(str(NOTES) + '.before-restore').read_text())['notes'])
check('restore keeps the backup settings as they were', L.call('get_settings')['settings']['backup'] is False)
L.call('set_settings', '{ json = %s }' % lua_str('{"backup":true}'))

# undo with an earlier day's snapshot
check('"previous" finds nothing when every snapshot is from today', L.call('restore_backup', '{ which = "previous" }')['error'] == 'no_previous')
other = '0' if time.strftime('%w') != '0' else '1'
old_doc = {'version': 1, 'saved_at': int(time.time()) - 3 * 86400, 'notes': {'app:old': {'text': 'from three days ago', 'updated': 1}}, 'settings': {'side': 'right'}}
(BK / ('MoreNotes_backup_%s.json' % other)).write_text(json.dumps(old_doc))
r = L.call('restore_backup', '{ which = "previous" }')
check('"previous" restores the newest snapshot from an earlier day', r['ok'] and list(L.call('get_all')['notes']) == ['app:old'])
(BK / ('MoreNotes_backup_%s.json' % other)).unlink()
L.call('set_note', '{ key = "app:1", text = "one" }')
L.call('set_note', '{ key = "app:2", text = "two" }')

# custom folder
custom = '/tmp/steamtest_custom/My Backup (1)'
r = L.call('set_settings', '{ json = %s }' % lua_str(json.dumps({'backupdir': custom + '/'})))
check('a custom folder is accepted (and created, trailing slash removed)', r['settings']['backupdir'] == custom and (Path(custom) / 'MoreNotes_notes.json').exists())
L.call('set_note', '{ key = "app:4", text = "four" }')
check('copies go to the custom folder', mirror_doc(Path(custom))['notes']['app:4']['text'] == 'four' and 'app:4' not in mirror_doc()['notes'])
for bad in ('/tmp/x"; touch /tmp/pwned; "', '/tmp/a$(touch /tmp/pwned)', '/tmp/a`id`', '/tmp/a&b', '/tmp/a|b', '../relative', 'relative/path', '/tmp/../etc', '/tmp/a;b', '/tmp/a%PATH%b', '/tmp/a>b'):
    r = L.call('set_settings', '{ json = %s }' % lua_str(json.dumps({'backupdir': bad})))
    check('unsafe folder rejected: %s' % bad, r['settings']['backupdir'] == custom)
check('no command injection happened', not Path('/tmp/pwned').exists())
r = L.call('set_settings', '{ json = %s }' % lua_str('{"backupdir":""}'))
check('an empty folder goes back to the default', r['settings']['backupdir'] == '' and L.call('backup_info')['dir'] == str(BK))

# custom backup file path
cfile = '/tmp/steamtest_custom/Chosen Place/my notes.json'
r = L.call('set_settings', '{ json = %s }' % lua_str(json.dumps({'backupfile': cfile})))
check('a backup file path is accepted', r['settings']['backupfile'] == cfile)
L.call('set_note', '{ key = "app:6", text = "six" }')
check('the copy is written to exactly that file', json.loads(Path(cfile).read_text())['notes']['app:6']['text'] == 'six')
check('snapshots and Notes.txt go to that file\'s folder', (Path(cfile).parent / 'Notes.txt').exists() and any(p.name.startswith('MoreNotes_backup_') for p in Path(cfile).parent.iterdir()))
bi = L.call('backup_info')
check('backup_info reports the chosen file', bi['file'] == cfile and bi['dir'] == str(Path(cfile).parent))
for bad in ('/tmp/steamtest_custom/x.txt', '/tmp/steamtest_custom/', '/tmp/steamtest_custom/MoreNotes_backup_3.json', '/tmp/steamtest/config/MoreNotes_notes.json', '/tmp/a&b.json', 'relative/file.json', '/tmp/x$(id).json'):
    r = L.call('set_settings', '{ json = %s }' % lua_str(json.dumps({'backupfile': bad})))
    check('unsafe or colliding file path rejected: %s' % bad, r['settings']['backupfile'] == cfile)
L.close(); L = Lua()
check('the chosen file path survives a restart', L.call('get_settings')['settings']['backupfile'] == cfile)
r = L.call('set_settings', '{ json = %s }' % lua_str('{"backupfile":""}'))
check('an empty file path goes back to the folder setting', r['settings']['backupfile'] == '' and L.call('backup_info')['file'].endswith('/MoreNotes_notes.json'))

# separate snapshot folder
L.call('set_settings', '{ json = %s }' % lua_str('{"backupfile":""}'))
snapd = '/tmp/steamtest_custom/Backups Here'
r = L.call('set_settings', '{ json = %s }' % lua_str(json.dumps({'snapdir': snapd + '/'})))
check('a snapshot folder is accepted (trailing slash removed)', r['settings']['snapdir'] == snapd)
L.call('set_note', '{ key = "app:9", text = "nine" }')
today = time.strftime('%w')
check('the weekday snapshot goes to the snapshot folder, not next to the copy', (Path(snapd) / ('MoreNotes_backup_%s.json' % today)).exists())
check('the second copy stays where it was', 'app:9' in mirror_doc(Path(custom))['notes'] or 'app:9' in mirror_doc()['notes'])
check('backup_info reports the snapshot folder', L.call('backup_info')['snap_dir'] == snapd)
r = L.call('set_settings', '{ json = %s }' % lua_str(json.dumps({'snapdir': '/tmp/a&b'})))
check('an unsafe snapshot folder is rejected', r['settings']['snapdir'] == snapd)
L.close(); L = Lua()
check('the snapshot folder survives a restart', L.call('get_settings')['settings']['snapdir'] == snapd)
r = L.call('set_settings', '{ json = %s }' % lua_str('{"snapdir":""}'))
check('an empty snapshot folder goes back to the copy folder', r['settings']['snapdir'] == '' and L.call('backup_info')['snap_dir'] == L.call('backup_info')['dir'])

# unwritable folder never breaks saving
L.call('set_settings', '{ json = %s }' % lua_str('{"backupdir":"/proc/nope/sub"}'))
r = L.call('set_note', '{ key = "app:5", text = "five" }')
info = L.call('backup_info')
check('an unwritable backup folder does not fail the save and is reported', r['ok'] and info['error'] != '' and L.call('get_all')['notes']['app:5']['text'] == 'five')
L.call('set_settings', '{ json = %s }' % lua_str('{"backupdir":""}'))
L.call('set_note', '{ key = "app:6", text = "six" }')
check('recovers once the folder is valid again', L.call('backup_info')['error'] == '' and mirror_doc()['notes']['app:6']['text'] == 'six')
check('only expected files in the backup folder', sorted(p.name for p in BK.iterdir() if not p.name.startswith('MoreNotes_backup_')) == ['MoreNotes_notes.json', 'Notes.txt'])
L.close()


# =====================================================================================================
# Default folder: <home>/Documents/MoreNotes, created when the plugin is enabled
# =====================================================================================================
fresh()
check('the folder does not exist before the plugin loads', not BK.exists())
L = Lua()
L.run('on_load() return ""')
check('enabling the plugin creates <home>/Documents/MoreNotes', BK.is_dir())
check('the first copy lands in that folder', (BK / 'MoreNotes_notes.json').exists() and not BK_DOCS.exists() and not BK_OLD.exists())
check('a readable Notes.txt is created there too', (BK / 'Notes.txt').exists() and 'More Notes' in (BK / 'Notes.txt').read_text())
check('it is reported as the default folder', L.call('backup_info')['default_dir'] == str(BK) and L.call('backup_info')['dir'] == str(BK))
L.close()

# folder is created even when the copy is switched off
fresh()
NOTES.parent.mkdir(parents=True, exist_ok=True)
NOTES.write_text(json.dumps({'version': 1, 'notes': {}, 'settings': {'backup': False}}))
L = Lua(); L.run('on_load() return ""')
check('the folder is created even if the second copy is off (and no copy is written)', BK.is_dir() and not (BK / 'MoreNotes_notes.json').exists())
L.close()

# unwritable default: falls back to the older Steam folder
fresh()
BK.parent.mkdir(parents=True, exist_ok=True)
BK.write_text('a plain file where the folder should be')
L = Lua(); L.run('on_load() return ""')
check('if Documents/MoreNotes cannot be created, the copy falls back to <Steam>/millennium/More-Notes', (BK_OLD / 'MoreNotes_notes.json').exists() and L.call('backup_info')['dir'] == str(BK_OLD))
L.close()

# notes written readable, and snapshots from the old default folder are carried into the new one
fresh()
BK_OLD.mkdir(parents=True)
(BK_OLD / 'MoreNotes_backup_9.json').write_text('x')
yday = [d for d in range(7) if str(d) != time.strftime('%w')][0]
(BK_OLD / ('MoreNotes_backup_%d.json' % yday)).write_text(json.dumps({'version': 1, 'saved_at': int(time.time()) - 86400, 'notes': {'app:5': {'text': 'old day', 'updated': 1}}, 'settings': {}}))
L = Lua(); L.run('on_load() return \"\"')
check('on load, earlier snapshots from the old default folder are carried into Documents/MoreNotes', (BK / ('MoreNotes_backup_%d.json' % yday)).exists())
L.call('set_note', '{ key = \"app:1\", text = \"line one\", label = \"Game one\" }')
txt = (BK / 'Notes.txt').read_text()
check('Notes.txt lists each note with its label, key and text', 'Game one [app:1]' in txt and 'line one' in txt)
L.close()

# an older copy in Documents is still found for recovery
fresh()
BK_DOCS.mkdir(parents=True)
(BK_DOCS / 'MoreNotes_notes.json').write_text(json.dumps({'version': 1, 'saved_at': int(time.time()), 'notes': {'app:7': {'text': 'from the old default folder', 'updated': 1}}, 'settings': {}}))
L = Lua()
check('recovery also looks in the older Documents location', L.call('get_all')['notes']['app:7']['text'] == 'from the old default folder')
L.close()


# =====================================================================================================
# Changing the folder at any time carries the earlier snapshots along
# =====================================================================================================
fresh()
L = Lua(); L.run('on_load() return ""')
others = [str(d) for d in range(7) if str(d) != time.strftime('%w')]
def snap(folder, day, age_days, text):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / ('MoreNotes_backup_%s.json' % day)).write_text(json.dumps({'version': 1, 'saved_at': int(time.time()) - age_days * 86400, 'notes': {'app:' + text: {'text': text, 'updated': 1}}, 'settings': {}}))
snap(BK, others[0], 1, 'yesterday')
snap(BK, others[1], 3, 'three-days-ago')
dest = CUSTOM / 'Moved Here'
snap(dest, others[0], 5, 'stale-in-destination')
r = L.call('set_settings', '{ json = %s }' % lua_str(json.dumps({'backupdir': str(dest)})))
check('the folder can be changed while running and a copy is written there at once', r['settings']['backupdir'] == str(dest) and mirror_doc(dest)['settings']['facing'] == 'right')
check('earlier snapshots come along to the new folder', 'app:three-days-ago' in mirror_doc_path(dest / ('MoreNotes_backup_%s.json' % others[1]))['notes'])
check('a newer snapshot replaces a stale one in the destination', 'app:yesterday' in mirror_doc_path(dest / ('MoreNotes_backup_%s.json' % others[0]))['notes'])
check("today's snapshot in the new folder tracks the current notes", (dest / ('MoreNotes_backup_%s.json' % time.strftime('%w'))).exists())
L.call('set_note', '{ key = "app:moved", text = "after the move" }')
check('later changes go to the new folder only', mirror_doc(dest)['notes']['app:moved']['text'] == 'after the move' and 'app:moved' not in mirror_doc()['notes'])
r = L.call('set_settings', '{ json = %s }' % lua_str('{"backupdir":""}'))
check('and it can be switched back to the default folder', r['settings']['backupdir'] == '' and L.call('backup_info')['dir'] == str(BK) and mirror_doc()['notes']['app:moved']['text'] == 'after the move')
L.close()

# =====================================================================================================
# Facing: four edges and four corners; older "side" values migrate
# =====================================================================================================
fresh()
L = Lua(); L.run('on_load() return ""')
for f in ('left', 'right', 'top', 'bottom', 'topleft', 'topright', 'bottomleft', 'bottomright', 'addressbar'):
    r = L.call('set_settings', '{ json = %s }' % lua_str(json.dumps({'facing': f})))
    check('facing "%s" is accepted' % f, r['settings']['facing'] == f)
for bad_f in ('center', 'TOP', 'top-left', '', 'sideways'):
    r = L.call('set_settings', '{ json = %s }' % lua_str(json.dumps({'facing': bad_f})))
    check('facing %r is rejected' % bad_f, r['settings']['facing'] == 'addressbar')
check('the old "side" key is no longer part of the settings', 'side' not in L.call('get_settings')['settings'])
L.close()

# an older file that stored side: "left" keeps working
fresh()
NOTES.parent.mkdir(parents=True, exist_ok=True)
NOTES.write_text(json.dumps({'version': 1, 'notes': {}, 'settings': {'side': 'left', 'vertical': 30}}))
L = Lua()
r = L.call('get_all')
check('an older saved side becomes the facing', r['settings']['facing'] == 'left' and 'side' not in r['settings'] and r['settings']['vertical'] == 30)
L.call('set_settings', '{ json = %s }' % lua_str('{"side":"right"}'))
check('a legacy side value in an update is still understood', L.call('get_settings')['settings']['facing'] == 'right')
L.call('set_settings', '{ json = %s }' % lua_str('{"side":"top"}'))
check('a legacy side value outside left/right is ignored', L.call('get_settings')['settings']['facing'] == 'right')
L.call('set_settings', '{ json = %s }' % lua_str('{"facing":"topleft","side":"right"}'))
check('facing wins over a legacy side sent alongside it', L.call('get_settings')['settings']['facing'] == 'topleft')
r = L.call('set_settings', '{ json = %s }' % lua_str('{"libdock":false}'))
check('the Library tab switch (libdock) is accepted and defaults to on', r['settings']['libdock'] is False and DEFAULTS['libdock'] is True)
r = L.call('set_settings', '{ json = %s }' % lua_str('{"libdock":"maybe"}'))
check('an invalid libdock value is ignored', r['settings']['libdock'] is False)
L.call('set_settings', '{ json = %s }' % lua_str('{"libdock":true}'))
check('the library note tab is off by default', DEFAULTS['libtab'] is False and L.call('get_settings')['settings']['libtab'] is False)
check('the inline note line under titles is off by default', L.call('get_settings')['settings']['inline'] is False)
L.close()

# ---- Linux/Mac layout: Millennium lives in ~/.local/share/millennium, Steam in ~/.local/share/Steam
fresh()
LX_BACKEND = HOME / '.local' / 'share' / 'millennium' / 'plugins' / 'MoreNotes' / 'backend' / 'main.lua'
LX_BACKEND.parent.mkdir(parents=True); shutil.copy(root / 'backend' / 'main.lua', LX_BACKEND)
LX_STEAM = HOME / '.local' / 'share' / 'Steam'
(LX_STEAM / 'config').mkdir(parents=True); (LX_STEAM / 'config' / 'config.vdf').write_text('"InstallConfigStore" {}')
L = Lua(backend=LX_BACKEND, steam_path='')
check('on Linux the notes go to the real Steam config folder, not next to millennium', L.call('get_info')['path'] == str(LX_STEAM / 'config' / 'MoreNotes_notes.json'))
r = L.call('set_note', '{ key = "app:7", text = "linux note" }')
check('saving works on the Linux layout', r['ok'] and (LX_STEAM / 'config' / 'MoreNotes_notes.json').exists() and not (HOME / '.local' / 'share' / 'config').exists())
L.close()
# the same layout when Millennium reports Steam's path itself
L = Lua(backend=LX_BACKEND, steam_path=str(LX_STEAM))
check('Millennium steam_path is used when it is right', L.call('get_info')['path'] == str(LX_STEAM / 'config' / 'MoreNotes_notes.json'))
L.close()
# a Steam folder whose config/ does not exist yet: the folder is created on the first save
fresh()
LX_BACKEND.parent.mkdir(parents=True); shutil.copy(root / 'backend' / 'main.lua', LX_BACKEND)
(HOME / '.local' / 'share' / 'Steam').mkdir(parents=True)
L = Lua(backend=LX_BACKEND, steam_path=str(HOME / '.local' / 'share' / 'Steam'))
r = L.call('set_note', '{ key = "app:8", text = "needs config folder" }')
check('a missing config folder is created on save instead of failing with write_failed', r['ok'] and (HOME / '.local' / 'share' / 'Steam' / 'config' / 'MoreNotes_notes.json').exists())
L.close()

# files named MoreNotes_snapshot_N.json by versions before 2.2.0 are still found and carried over
fresh()
BK.mkdir(parents=True)
old_day = [d for d in range(7) if str(d) != time.strftime('%w')][0]
(BK / ('MoreNotes_snapshot_%d.json' % old_day)).write_text(json.dumps({'version': 1, 'saved_at': int(time.time()) - 86400, 'notes': {'app:legacy': {'text': 'from an old snapshot file', 'updated': 1}}, 'settings': {}}))
L = Lua()
check('a legacy MoreNotes_snapshot_N.json is used for "previous" recovery', L.call('restore_backup', '{ which = "previous" }')['ok'] and 'app:legacy' in L.call('get_all')['notes'])
dest2 = CUSTOM / 'Carried'
L.call('set_settings', '{ json = %s }' % lua_str(json.dumps({'snapdir': str(dest2)})))
check('a legacy snapshot file is carried into the new backup name', (dest2 / ('MoreNotes_backup_%d.json' % old_day)).exists())
L.close()

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)
