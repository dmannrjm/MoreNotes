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
