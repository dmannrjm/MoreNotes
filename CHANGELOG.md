# Changelog

## 1.4.2
- Fix for `bad_key` when saving a note: the backend was not receiving the note's key. Notes sent their key, text and label as three separate arguments, while settings (which worked) already sent one packed string. Every call from the settings page and from the web-page script is now a single packed JSON string, and the backend accepts any way the host may hand arguments over (a table, one JSON string, a table with a `json` field, or separate positional values).
- If `bad_key` ever appears again, it now says what the backend received (value types and lengths only, never note text).

## 1.4.1
- Character counter ("current / maximum", for example `22 / 4000`) beneath the writing area of every notes box: the side-tab box, the inline editor on web pages, the native note editor, the library Notes tab and the add-note form in settings. It turns amber from 90% and red at the limit, and typing past the limit is cut.
- The 4000 limit now counts characters, not bytes, in the backend as well, so accented letters and emoji count once and are never cut in half.

## 1.4.0
- Plugin description rewritten so the plugin panel says what More Notes does.
- Notes tab on a game's library page, added to Steam's own tab row (the native `tabs` list next to Achievements). It edits the same note as the game's store page and hub, shows the game's name, and can be switched off in settings.
- One up/down offset for all side tabs (centre = 0, negative up, positive down), with a "Final location" preview that draws a copy of the tab icon on the chosen edge at the chosen height.
- New Colours panel: swatches, hue / saturation / lightness sliders, a hex field and an icon colour option (automatic contrast, light or dark). The colour dropdown is gone.
- The developer diagnostics panel is hidden in the release build. `npm run build` (source) shows it; `npm run build:release` (the shipped zip) hides it.
- Settings use Steam's own components throughout.

## 1.3.1
- The second copy now defaults to `<Steam>/millennium/More-Notes` (for a standard install, `C:\Program Files (x86)\Steam\millennium\More-Notes`), created as soon as the plugin is enabled, even if the copy is switched off. Documents and `%APPDATA%` stay as fallbacks if that folder cannot be written, and recovery still looks in them.
- The folder can still be changed at any time in settings (Use this folder / Use the default folder). A copy is written to the new folder immediately and the earlier days' snapshots are carried over, so Undo history is kept.
- The toggle is now labelled "Keep a second copy".

## 1.3.0
- Automatic backup outside the plugin: notes and settings are kept in `<Steam>/config/MoreNotes_notes.json` (never inside the plugin folder), and every change is also copied to a second location outside Steam (default `Documents\MoreNotes Backup`, falling back to `%APPDATA%\MoreNotes`), with one snapshot file per weekday that tracks the day's saves.
- Automatic recovery: if the main file is missing or damaged at start-up, notes and settings are restored from the newest valid copy (the damaged file is kept as `.corrupt`).
- Settings page: toggle the copy, choose the backup folder (only applied when you press Use this folder), see the last copy time and any error, Back up now, Restore from the backup copy, and Undo (restore the latest snapshot from an earlier day). Restores keep what they replace as `MoreNotes_notes.json.before-restore`.
- Folder paths must be full paths with plain characters only (checked in the backend).

## 1.2.3
- Removed the note button beside the Steam URL bar (code, setting and status row). Notes on store/community pages come from the docked pill only. Restart Steam so the old button disappears from an open window.

## 1.2.2
- Crash fix: changing the pill's side (any appearance setting) crashed Millennium's Lua process (EXCEPTION_ACCESS_VIOLATION in millennium.luavm64.exe while handling `set_settings`). That was the first backend call to carry true/false and number values; every earlier call sent only text. Now every argument sent to the backend is plain text (settings travel as one JSON string), in both the settings page and the web-page script.
- The backend no longer uses the host's native `json` module; it uses its own pure-Lua codec, which is now tested under a real Lua interpreter.

## 1.2.1
- Pages with no single game or person now get a note of their own, keyed by address: the store front page, search, wishlist, friend lists and any other store/community page. Both the web-page pill and the URL-bar button do this, and they share the same note. Login, checkout, cart and account pages are left alone, and the web-page script now only runs on store.steampowered.com and steamcommunity.com.
- Settings page: you can add a page note by address; the URL-bar status wording is clearer.
- Backend accepts `page:` keys (host and path).

## 1.2.0
- Experimental URL-bar note button: the client reads the address shown in the Steam window and, on game pages (`/app/<id>`) and `/profiles/<steamid64>` pages, shows a note button beside the address bar that opens the native note editor. Uses the pill colour and shape; can be switched off in settings, and the settings page shows a status line explaining what it sees.
- New `urlbar` appearance setting stored by the backend.

## 1.1.0
- Note pill: a docked, expandable handle on store/community game pages and profiles. Click it to open a box for writing the note; Done, Escape or clicking away saves, Delete removes.
- Pill appearance is set in Millennium settings -> More Notes: show/hide, left or right edge, height on the page, shape (pill, circle, rounded square, edge tab), size, colour (presets or hex), with a preview.
- The older inline note line under titles is now optional and off by default; friend-list and wishlist rows keep their per-row notes.
- Backend stores appearance settings in the same notes file (`get_settings`, `set_settings`).

## 1.0.0
- First version: Lua notes store, settings panel (add by id, search, edit, delete), webkit note chips for store/community game pages, profiles, community friend lists and wishlists, and an opt-in diagnostics collector for the in-client friends list and chat.
