# More Notes (Millennium plugin)

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

## Install
Copy the `MoreNotes` folder (with `.millennium/Dist`) into `<Steam>\millennium\plugins\`, enable it in Millennium -> Plugins, restart Steam.

## Note length
A note can hold up to 4000 characters (letters, accents and emoji each count once). Every notes box shows the current count against that maximum.

## Where notes are stored, and backups
`<Steam>/config/MoreNotes_notes.json` (shown in the settings panel). It lives outside the plugin folder so updating or reinstalling the plugin keeps your notes and settings.

A second copy is written on every change to `<Steam>/millennium/More-Notes` (created when the plugin is enabled; `C:\Program Files (x86)\Steam\millennium\More-Notes` on a standard install). If that folder cannot be written it falls back to `Documents\MoreNotes Backup`, then `%APPDATA%\MoreNotes`. You can choose any other folder in settings and change it whenever you like: a copy is written there at once and earlier snapshots are carried over: `MoreNotes_notes.json` (latest) plus `MoreNotes_snapshot_0..6.json`, one per weekday, each holding the last save of that weekday. If the main file is missing or damaged at start-up, the newest valid copy is restored automatically. In settings you can switch the copy off, change the folder, back up now, restore from the copy, or undo with the latest snapshot from an earlier day. To reset everything on purpose, delete the backup folder as well as the main file.

## Build from source
`node scripts/build.mjs` (source build, shows the developer diagnostics panel) or `node scripts/build.mjs --release` (the shipped build, diagnostics hidden) writes `.millennium/Dist/index.js` and `.millennium/Dist/webkit.js`. Tests: `npm test` (frontend logic against stubs), `python3 tests/webkit_test.py` (web-page script in headless Chromium against fixture pages) `python3 tests/client_test.py` (the Library tab and address-bar button in a page imitating the main window) and `python3 tests/backend_test.py` (the Lua backend under a real Lua 5.4 interpreter via ctypes; the host is LuaJIT, so this checks logic, not Steam's argument plumbing).

## Status
Only stub/fixture tests have run. Real-Steam behaviour (Lua backend, modal, webkit loading, and the page selectors) still needs checking in Steam. MIT licensed.
