<<<<<<< HEAD
# More Notes (Millennium plugin, Starlight `.star`)
=======
# More Notes (Millennium plugin)
>>>>>>> e72783ec219df1e2a75546f3b0d03a14e6a1573b

Private notes on **people** and **games**, shown in more places across Steam:

| Where | How |
| --- | --- |
| Store and community game pages | Docked **note pill** (`app:<appid>`); click to expand and write |
| Any other store/community page (front page, search, wishlist, friend lists...) | Docked **note pill** holding a note for that page, keyed by its address (`page:<host>/<path>`) |
| Wishlist rows | One note chip per row (same `app:<appid>` note) |
| User profiles | Docked **note pill** (`user:<steamid64>`) |
| Community friend lists | One note chip per friend block (same `user:<steamid64>` note) |
| Library window | A docked **Library tab** (same look and settings as the web-page tab) holding a Library note; hidden while a web page is showing |
| Steam address bar | Choose **Address bar** under Facing to put the note button beside the address bar instead of along the edges (the edge tabs are hidden) |
| Library game page | A **Notes** tab in Steam's own tab row (next to Achievements); same note as the game's store page |
| Millennium settings -> More Notes | Tab appearance (side, one up/down offset with a final-location preview, shape, size, colour panel), backup, plus search, add by id, edit, delete |
| Friends list and chats inside the Steam client | **Not built yet.** A diagnostics switch in the settings panel collects what is needed. |

A note about a person is the same note everywhere that person appears; a note about a game is the same note on its store page, hub and wishlist row.

## The note pill
A small handle docked to an edge or corner of a game page or profile. Collapsed, it is dimmer when the page has no note and brighter with a dot when it has one. Click to expand a box; **Done**, Escape, or clicking elsewhere saves; **Delete** removes the note. Facing (left, right, top or bottom edge, or a corner), offset, shape, size and colour are set in Millennium settings -> More Notes. In a corner every shape except the dot bends to follow the corner. Open pages pick up changes when you switch back to them. Pages with no single game or person (front page, search, wishlist, friend lists) get a note for the page itself; friend lists and wishlists also keep their per-row notes. Login, checkout, cart and account pages are skipped. An optional older inline line under titles can be switched on.

<<<<<<< HEAD
## Install (Starlight)
This is a **Starlight** project: it builds into a single `more-notes.star` file. You need a current Millennium (v3.5.0 or later) and [Bun](https://bun.sh) (v1.4.3 or later).

1. In this folder run `bun install`, then `bun run build`. With `output_path = "auto"` (see `millennium.toml`) the compiler finds Millennium and puts `more-notes.star` in its plugins folder. (Use `bun run build`, not `bun run dev`: while the dev watcher runs, plugin tabs have timed out with "RPC timeout".)
2. **Remove the old classic More Notes first** (the `MoreNotes` folder under `<Steam>\millennium\plugins\`, or the old plugin entry in Millennium -> Plugins), otherwise both versions run and you get two tabs. Your notes and backups are not in that folder, so they are kept.
3. Enable **More Notes** in Millennium -> Plugins and restart Steam.

The plugin id is `more-notes`, so the package is `more-notes.star`. Changing the id later means removing the old `.star` and enabling the plugin again.
=======
## Install
Copy the `MoreNotes` folder (with `.millennium/Dist`) into `<Steam>\millennium\plugins\`, enable it in Millennium -> Plugins, restart Steam.
>>>>>>> e72783ec219df1e2a75546f3b0d03a14e6a1573b

## Note length
A note can hold up to 4000 characters (letters, accents and emoji each count once). Every notes box shows the current count against that maximum.

## Where notes are stored, and backups
`<Steam>/config/MoreNotes_notes.json` (shown in the settings panel). It lives outside the plugin folder so updating or reinstalling the plugin keeps your notes and settings.

A second copy is written on every change to `%USERPROFILE%\\Documents\\MoreNotes` on Windows or `$HOME/Documents/MoreNotes` on Linux and Mac (created when the plugin is enabled), together with a readable `Notes.txt` listing all notes. If that folder cannot be written it falls back to `<Steam>/millennium/More-Notes` (the 1.3-1.6 default, still searched for recovery), then `Documents/MoreNotes Backup`, then `%APPDATA%\\MoreNotes`. You can choose any other folder in settings and change it whenever you like: a copy is written there at once and earlier backups are carried over: `MoreNotes_notes.json` (latest) plus `MoreNotes_backup_0..6.json`, one per weekday, each holding the last save of that weekday. If the main file is missing or damaged at start-up, the newest valid copy is restored automatically. In settings you can switch the copy off, change the folder, back up now, restore from the copy, or undo with the latest backup from an earlier day. To reset everything on purpose, delete the backup folder as well as the main file.

<<<<<<< HEAD
## Project layout and tests
```
millennium.toml            manifest and compiler settings (id more-notes, version 3.0.0)
backend/main.lua           lifecycle hooks (on_load, on_unload, on_frontend_loaded, millennium.ready)
backend/rpc_functions.lua  notes, settings and backups; the ---@ffi functions the frontend and webview call
frontend/index.tsx         GENERATED: the Millennium settings panel, the Library tab/dock, the address-bar button, the game-page Notes tab
webview/preload.ts         GENERATED: the store and community page script (plain DOM)
src/frontend.js, src/webview.js, src/dock.js   the readable sources the two files above are generated from
scripts/generate.mjs       `node scripts/generate.mjs` regenerates the two files (`--check` reports if they are stale)
scripts/test-build.mjs     builds stub-only bundles for the tests (not the plugin)
resources/                 bundled resources
```
Edit `src/`, run `node scripts/generate.mjs`, commit the generated files. Tests (all against stubs, none run Starlight or Steam): `node scripts/generate.mjs --check && node scripts/test-build.mjs && node tests/frontend.test.mjs` (also `npm test`), `python3 tests/project_test.py` (the Starlight project files agree with each other), `python3 tests/webkit_test.py` (the store/community script in headless Chromium against fixture pages), `python3 tests/client_test.py` (the Library tab and address-bar button in a page imitating the main window) and `python3 tests/backend_test.py` (the Lua backend under a real Lua 5.4 interpreter via ctypes; the host is LuaJIT, so this checks logic, not Steam's argument plumbing).

## Status
Only stub/fixture tests have run. The `.star` has **not** been built or tried yet: that needs `bun install` and `bun run build` on a real machine, and real-Steam behaviour (the Starlight Lua backend, the `backend.*` calls, the webview script and the page selectors) still needs checking in Steam. MIT licensed.
=======
## Build from source
`node scripts/build.mjs` (source build, shows the developer diagnostics panel) or `node scripts/build.mjs --release` (the shipped build, diagnostics hidden) writes `.millennium/Dist/index.js` and `.millennium/Dist/webkit.js`. Tests: `npm test` (frontend logic against stubs), `python3 tests/webkit_test.py` (web-page script in headless Chromium against fixture pages) `python3 tests/client_test.py` (the Library tab and address-bar button in a page imitating the main window) and `python3 tests/backend_test.py` (the Lua backend under a real Lua 5.4 interpreter via ctypes; the host is LuaJIT, so this checks logic, not Steam's argument plumbing).

## Status
Only stub/fixture tests have run. Real-Steam behaviour (Lua backend, modal, webkit loading, and the page selectors) still needs checking in Steam. MIT licensed.
>>>>>>> e72783ec219df1e2a75546f3b0d03a14e6a1573b
