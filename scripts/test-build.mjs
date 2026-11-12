// Builds runnable bundles for the stub-based tests ONLY (they are not the plugin): the generated frontend/index.tsx and
// webview/preload.ts are plain JavaScript apart from the import/export lines, so this strips those, supplies a `backend`
// object that forwards to the tests' fake host, and writes .millennium/Dist/index.js and .millennium/Dist/webkit.js.
// The real package is built by the user with `bun run build` (Starlight).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const release = args.includes('--release'); // keep the shipped setting: diagnostics hidden
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : join(root, '.millennium', 'Dist');
mkdirSync(outDir, { recursive: true });
const toml = readFileSync(join(root, 'millennium.toml'), 'utf8');
const version = (toml.match(/^version\s*=\s*"([^"]+)"/m) || [])[1];

// ---- frontend
let fe = readFileSync(join(root, 'frontend', 'index.tsx'), 'utf8');
const imp = "import { definePlugin } from 'millennium';";
if (!fe.includes(imp)) throw new Error('definePlugin import not found');
fe = fe.replace(imp, 'const definePlugin = f => f;');
if (!fe.includes('export default definePlugin(')) throw new Error('default export not found');
fe = fe.replace('export default definePlugin(', 'const __default = definePlugin(');
const flag = 'const SHOW_DIAGNOSTICS = false; // @build:diagnostics';
if (!fe.includes(flag)) throw new Error('diagnostics flag not found');
if (!release) fe = fe.replace(flag, 'const SHOW_DIAGNOSTICS = true; // @build:diagnostics (tests only)');
const out =
  `const pluginName="MoreNotes";(window.PLUGIN_LIST||={})[pluginName]||={};window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS||={};\n` +
  `(async()=>{\nconst backend=new Proxy({},{get:(_,fn)=>(...a)=>Millennium.callServerMethod(pluginName,fn,a.length?{json:a[0]}:{})});\n` +
  `${fe}\nconst t=await __default();window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginName]=t;\n})();\n`;
writeFileSync(join(outDir, 'index.js'), out);
console.log(`test bundle (stubs only) -> .millennium/Dist/index.js (${out.length} bytes), plugin ${version}`);

// ---- webview
let web = readFileSync(join(root, 'webview', 'preload.ts'), 'utf8');
if (!web.includes('export default async function main()')) throw new Error('webview main not found');
web = web.replace('export default async function main()', 'async function main()');
const webOut =
  `const backend=new Proxy({},{get:(_,fn)=>(...a)=>window.Millennium.callServerMethod("MoreNotes",fn,a.length?{json:a[0]}:{})});\n` +
  `${web}\ntry{main()}catch(e){console.error("[MoreNotes] webview failed",e)}\n`;
writeFileSync(join(outDir, 'webkit.js'), webOut);
console.log(`test bundle (stubs only) -> .millennium/Dist/webkit.js (${webOut.length} bytes)`);
