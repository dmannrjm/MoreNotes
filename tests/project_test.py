"""Static checks of the Starlight project (no bun/starlight here, so these only prove the files are consistent)."""
import json, re, subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
failures = []
def check(name, cond):
    print(('ok   - ' if cond else 'FAIL - ') + name)
    if not cond: failures.append(name)

read = lambda p: (root / p).read_text()
toml = read('millennium.toml')
pkg = json.loads(read('package.json'))
ver_toml = re.search(r'^version\s*=\s*"([^"]+)"', toml, re.M).group(1)
ver_src = re.search(r"const VERSION = '([^']+)'", read('src/frontend.js')).group(1)
check('millennium.toml, package.json and the frontend VERSION agree (%s)' % ver_toml, ver_toml == pkg['version'] == ver_src)
check('plugin id is more-notes (the .star will be more-notes.star)', re.search(r'^id\s*=\s*"more-notes"', toml, re.M) is not None)
for key, path in (('backend entry', 'backend/main.lua'), ('frontend entry', 'frontend/index.tsx'), ('webkit entry', 'webview/preload.ts')):
    check('%s exists and is named in millennium.toml' % key, (root / path).exists() and path in toml)
check('backend sources glob covers rpc_functions.lua', 'backend/**/*.lua' in toml and (root / 'backend/rpc_functions.lua').exists())
check('resources are bundled and exist', 'resources/**/*' in toml and any((root / 'resources').iterdir()))
check('package.json has the Starlight scripts and dependency', pkg['scripts']['build'].endswith('starlight pack') and pkg['scripts']['dev'].endswith('starlight watch') and '@steambrew/starlight' in pkg['devDependencies'])
for f in ('tsconfig.json', 'frontend/tsconfig.json', 'webview/tsconfig.json', '.luarc.json'):
    json.loads(read(f)); check('%s is valid JSON' % f, True)
gi = read('.gitignore')
check('.gitignore ignores node_modules, .millennium and *.star', all(x in gi for x in ('node_modules/', '.millennium/', '*.star')))

sync = subprocess.run(['node', str(root / 'scripts/generate.mjs'), '--check'], capture_output=True, text=True)
check('frontend/index.tsx and webview/preload.ts are in sync with src/', sync.returncode == 0)

fe, web = read('frontend/index.tsx'), read('webview/preload.ts')
check('generated files start with // @ts-nocheck', fe.startswith('// @ts-nocheck') and web.startswith('// @ts-nocheck'))
check("frontend uses definePlugin from 'millennium' as its default export", "import { definePlugin } from 'millennium';" in fe and 'export default definePlugin(' in fe)
check('webview exports default async function main()', 'export default async function main()' in web)
for name, text in (('frontend', fe), ('webview', web)):
    code = re.sub(r'//[^\n]*', '', text)
    check('%s never defines its own `backend` or `frontend` (it would shadow Steam\'s object)' % name,
          not re.search(r'\b(function|const|let|var|class)\s+(backend|frontend)\b', code) and not re.search(r'\b(backend|frontend)\s*=[^=]', code))
    check('%s has no classic Millennium.callServerMethod' % name, 'callServerMethod' not in code)
    check('%s calls the backend only as literal backend.<fn>(...)' % name, not re.search(r'\bbackend\s*\[', code))

lua = read('backend/rpc_functions.lua')
ffi_funcs = re.findall(r'---@ffi\n(?:---[^\n]*\n)*?function (\w+)\(', lua)
all_funcs = re.findall(r'^function (\w+)\(', lua, re.M)
check('every global Lua function except moreNotesStartup is marked ---@ffi', sorted(set(all_funcs) - set(ffi_funcs)) == ['moreNotesStartup'])
check('annotations use plain types only (no unions)', not re.search(r'---@(param|return)[^\n]*\|', lua))
check('every ---@ffi function takes at most one string param named request', all(
    re.search(r'---@ffi\n(?:---[^\n]*\n)*?function %s\((request)?\)' % f, lua) for f in ffi_funcs))
used = set(re.findall(r'\bbackend\.(\w+)\(', fe)) | set(re.findall(r'\bbackend\.(\w+)\(', web))
check('every backend.<fn>() the frontend/webview calls exists as an ---@ffi function (%s)' % ', '.join(sorted(used)), used <= set(ffi_funcs))
main = read('backend/main.lua')
check('main.lua requires rpc_functions, calls moreNotesStartup and millennium.ready', 'require("rpc_functions")' in main and 'moreNotesStartup' in main and 'millennium.ready()' in main)
check('main.lua returns on_load, on_unload and on_frontend_loaded', all(x in main for x in ('on_load = on_load', 'on_unload = on_unload', 'on_frontend_loaded = on_frontend_loaded')))

print('\n%d failure(s)' % len(failures))
raise SystemExit(1 if failures else 0)
