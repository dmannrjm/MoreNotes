// Offline build: wraps the frontend files the way @steambrew/ttc wraps a plugin and writes
// .millennium/Dist/index.js (client frontend) and .millennium/Dist/webkit.js (store/community pages).
// No dependencies: `node scripts/build.mjs`.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// `--release` builds the shipped plugin: the developer diagnostics panel is hidden. Without it (the source build) it is shown.
const args = process.argv.slice(2);
const release = args.includes('--release');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : join(root, '.millennium', 'Dist');
const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
let body = ['index.js'].map(f => readFileSync(join(root, 'frontend', f), 'utf8')).join('\n');
const flag = 'const SHOW_DIAGNOSTICS = true; // @build:diagnostics';
if (!body.includes(flag)) throw new Error('diagnostics build flag not found in frontend/index.js');
if (release) body = body.replace(flag, 'const SHOW_DIAGNOSTICS = false;');

const name = manifest.name;
const out =
  `const MILLENNIUM_IS_CLIENT_MODULE=!0,pluginName=${JSON.stringify(name)};` +
  `(window.PLUGIN_LIST||={})[pluginName]||={},window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS||={};` +
  `let PluginEntryPointMain=function(){var e=function(React,API){"use strict";\n${body}\n` +
  `return{default:main,__esModule:!0}}(window.SP_REACT,window.MILLENNIUM_API);return e};` +
  `(async()=>{const e=PluginEntryPointMain();Object.assign(window.PLUGIN_LIST[pluginName],{...e,__millennium_internal_plugin_name_do_not_use_or_change__:pluginName});` +
  `const t=await e.default();t&&void 0!==t.title&&void 0!==t.icon&&void 0!==t.content&&(window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginName]=t),` +
  `MILLENNIUM_BACKEND_IPC.postMessage(1,{pluginName:pluginName})})();\n`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.js'), out);
console.log(`built ${name} ${manifest.version}${release ? ' (release)' : ' (dev, diagnostics shown)'} -> ${outDir}/index.js (${out.length} bytes)`);

// Webkit (plain DOM) script. The wrapper is minimal; see README: the packaging of webkit.js is unverified.
const webkitSource = join(root, 'webkit', 'index.js');
if (existsSync(webkitSource)) {
  const web =
    `const MILLENNIUM_IS_CLIENT_MODULE=!1,pluginName=${JSON.stringify(name)};\n` +
    `try{\n${readFileSync(webkitSource, 'utf8')}\n}catch(e){console.error("[${name}] webkit failed",e)}\n`;
  writeFileSync(join(outDir, 'webkit.js'), web);
  console.log(`built ${name} ${manifest.version} -> ${outDir}/webkit.js (${web.length} bytes)`);
}
