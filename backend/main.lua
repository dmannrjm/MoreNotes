-- More Notes backend: stores notes in a JSON file in Steam's config folder
-- so they survive plugin updates. Functions defined globally are callable
-- from the frontend/webkit via Millennium.callServerMethod("MoreNotes", name, args).

local millennium = require("millennium")
local logger_ok, logger = pcall(require, "logger")

local function log(msg)
  if logger_ok and logger then pcall(function() logger:info("[MoreNotes] " .. tostring(msg)) end) end
end

---------------------------------------------------------------------------
-- JSON
---------------------------------------------------------------------------
-- Pure-Lua JSON codec. Deliberately not using the host's native json module, and the frontend only ever sends
-- plain strings as arguments (a native conversion of boolean/number arguments crashed the Lua VM process).
local encode, decode

do
  local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t', ['\b'] = '\\b', ['\f'] = '\\f' }

  local function esc(s)
    local r = s:gsub('[%c"\\]', function(c)
      return escapes[c] or string.format("\\u%04x", c:byte())
    end)
    return r
  end

  local function is_array(t)
    local n = #t
    if n == 0 then return false end
    local count = 0
    for _ in pairs(t) do count = count + 1 end
    return count == n
  end

  encode = function(v)
    local tv = type(v)
    if v == nil then return "null" end
    if tv == "boolean" then return v and "true" or "false" end
    if tv == "number" then
      if v == math.floor(v) and v > -1e15 and v < 1e15 then return string.format("%d", v) end
      return string.format("%.14g", v)
    end
    if tv == "string" then return '"' .. esc(v) .. '"' end
    if tv == "table" then
      local out = {}
      if is_array(v) then
        for i = 1, #v do out[#out + 1] = encode(v[i]) end
        return "[" .. table.concat(out, ",") .. "]"
      end
      for k, val in pairs(v) do out[#out + 1] = '"' .. esc(tostring(k)) .. '":' .. encode(val) end
      return "{" .. table.concat(out, ",") .. "}"
    end
    return "null"
  end

  local function utf8_char(cp)
    if cp < 0x80 then return string.char(cp) end
    if cp < 0x800 then return string.char(0xC0 + math.floor(cp / 0x40), 0x80 + cp % 0x40) end
    if cp < 0x10000 then
      return string.char(0xE0 + math.floor(cp / 0x1000), 0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
    end
    return string.char(0xF0 + math.floor(cp / 0x40000), 0x80 + math.floor(cp / 0x1000) % 0x40,
      0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
  end

  decode = function(str)
    local pos = 1
    local parse_value

    local function skip()
      pos = str:find("[^ \t\r\n]", pos) or (#str + 1)
    end

    local function parse_string()
      pos = pos + 1 -- opening quote
      local buf = {}
      while true do
        local c = str:sub(pos, pos)
        if c == "" then error("unterminated string") end
        if c == '"' then pos = pos + 1; break end
        if c == "\\" then
          local n = str:sub(pos + 1, pos + 1)
          if n == "u" then
            local cp = tonumber(str:sub(pos + 2, pos + 5), 16)
            if not cp then error("bad unicode escape") end
            pos = pos + 6
            if cp >= 0xD800 and cp < 0xDC00 and str:sub(pos, pos + 1) == "\\u" then
              local lo = tonumber(str:sub(pos + 2, pos + 5), 16)
              if lo and lo >= 0xDC00 and lo < 0xE000 then
                cp = 0x10000 + (cp - 0xD800) * 0x400 + (lo - 0xDC00)
                pos = pos + 6
              end
            end
            buf[#buf + 1] = utf8_char(cp)
          else
            local map = { b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
            buf[#buf + 1] = map[n] or n
            pos = pos + 2
          end
        else
          buf[#buf + 1] = c
          pos = pos + 1
        end
      end
      return table.concat(buf)
    end

    parse_value = function()
      skip()
      local c = str:sub(pos, pos)
      if c == "{" then
        pos = pos + 1
        local obj = {}
        skip()
        if str:sub(pos, pos) == "}" then pos = pos + 1; return obj end
        while true do
          skip()
          if str:sub(pos, pos) ~= '"' then error("expected key at " .. pos) end
          local k = parse_string()
          skip()
          if str:sub(pos, pos) ~= ":" then error("expected ':' at " .. pos) end
          pos = pos + 1
          obj[k] = parse_value()
          skip()
          local d = str:sub(pos, pos)
          pos = pos + 1
          if d == "}" then return obj end
          if d ~= "," then error("expected ',' or '}' at " .. (pos - 1)) end
        end
      elseif c == "[" then
        pos = pos + 1
        local arr = {}
        skip()
        if str:sub(pos, pos) == "]" then pos = pos + 1; return arr end
        while true do
          arr[#arr + 1] = parse_value()
          skip()
          local d = str:sub(pos, pos)
          pos = pos + 1
          if d == "]" then return arr end
          if d ~= "," then error("expected ',' or ']' at " .. (pos - 1)) end
        end
      elseif c == '"' then
        return parse_string()
      elseif str:sub(pos, pos + 3) == "true" then pos = pos + 4; return true
      elseif str:sub(pos, pos + 4) == "false" then pos = pos + 5; return false
      elseif str:sub(pos, pos + 3) == "null" then pos = pos + 4; return nil
      else
        local num = str:match("^-?%d+%.?%d*[eE]?[+-]?%d*", pos)
        if not num or #num == 0 then error("unexpected character at " .. pos) end
        pos = pos + #num
        return tonumber(num)
      end
    end

    local result = parse_value()
    return result
  end
end

---------------------------------------------------------------------------
-- Storage location
---------------------------------------------------------------------------
local IS_WINDOWS = package.config:sub(1, 1) == "\\"

local function normalise(p)
  local r = p:gsub("\\", "/")
  return r
end

-- Steam's folder (the one with config/config.vdf in it). On Windows, Millennium's plugins sit inside it. On Linux and Mac
-- they do not (Millennium lives in ~/.local/share/millennium), so the plugin's own path cannot be trusted on its own:
-- every candidate is checked for a real config folder before it is used.
local function has_config(p)
  local f = io.open(p .. "/config/config.vdf", "rb")
  if f then f:close(); return true end
  return false
end

local function plugin_path_root()
  local src = ""
  pcall(function() src = debug.getinfo(1, "S").source or "" end)
  src = normalise((src:gsub("^@", "")))
  local root = src:match("^(.*)/millennium/plugins/")
  if root and #root > 0 then return root end
  root = src:match("^(.*)/plugins/MoreNotes/")
  if root and #root > 0 then return root end
  return nil
end

local function find_root()
  local list, seen = {}, {}
  local function add(p)
    if type(p) == "string" and #p > 0 then
      p = normalise(p):gsub("/+$", "")
      if #p > 0 and not seen[p] then seen[p] = true; list[#list + 1] = p end
    end
  end
  add(plugin_path_root())
  local ok, sp = pcall(function() return millennium.steam_path() end)
  local api = (ok and type(sp) == "string" and #sp > 0) and normalise(sp):gsub("/+$", "") or nil
  add(api)
  local home = os.getenv("HOME")
  if home and #home > 0 and not IS_WINDOWS then
    add(home .. "/.local/share/Steam")
    add(home .. "/.steam/steam")
    add(home .. "/.steam/root")
    add(home .. "/.steam/debian-installation")
    add(home .. "/.var/app/com.valvesoftware.Steam/.local/share/Steam")
    add(home .. "/.var/app/com.valvesoftware.Steam/.steam/steam")
    add(home .. "/Library/Application Support/Steam")
  end
  for _, c in ipairs(list) do
    if has_config(c) then return c end
  end
  return api -- not verified, but it is Steam's own answer; the write creates config/ if it is missing
end

-- The notes live in <Steam>/config, outside the plugin folder, so updating or reinstalling the plugin keeps them.
local root = find_root()
local legacy_root = plugin_path_root() -- where 1.3-1.6 put their More-Notes folder
local NOTES_PATH = (root and (root .. "/config/MoreNotes_notes.json")) or "MoreNotes_notes.json"

local notes = {}
local loaded = false
local ready_called = false
local restored_from = nil
local backup_state = { dir = nil, snapdir = nil, error = nil }

local function trim(s)
  local r = s:gsub("^%s+", "")
  r = r:gsub("%s+$", "")
  return r
end

-- A folder path is only accepted if it is absolute and made of plain characters, because it can end up in a
-- shell command (mkdir) when the Windows API route is unavailable.
local function safe_path(p)
  if type(p) ~= "string" or #p == 0 or #p > 240 then return false end
  if not p:match("^[%w _%.%-:/\\%(%)~,]+$") then return false end
  if p:find("%.%.") then return false end
  local n = normalise(p)
  return (n:match("^%a:/") ~= nil) or (n:sub(1, 1) == "/")
end

-- Appearance + backup settings.
local DEFAULTS = { pill = true, facing = "right", vertical = 50, shape = "pill", size = "medium", color = "#1a9fff", inline = false, backup = true, backupdir = "", backupfile = "", snapdir = "", iconcolor = "auto", libtab = false, libdock = true }
local ENUMS = {
  facing = { left = true, right = true, top = true, bottom = true, topleft = true, topright = true, bottomleft = true, bottomright = true, addressbar = true },
  shape = { pill = true, circle = true, square = true, tab = true },
  size = { small = true, medium = true, large = true },
  iconcolor = { auto = true, light = true, dark = true },
}
local settings = {}
for k, v in pairs(DEFAULTS) do settings[k] = v end

local function as_bool(v)
  if type(v) == "boolean" then return v end
  if v == "true" then return true end
  if v == "false" then return false end
  return nil
end

local function apply_settings(a)
  if type(a) ~= "table" then return end
  local b = as_bool(a.pill)
  if b ~= nil then settings.pill = b end
  b = as_bool(a.inline)
  if b ~= nil then settings.inline = b end
  b = as_bool(a.backup)
  if b ~= nil then settings.backup = b end
  b = as_bool(a.libtab)
  if b ~= nil then settings.libtab = b end
  b = as_bool(a.libdock)
  if b ~= nil then settings.libdock = b end
  for k, allowed in pairs(ENUMS) do
    if type(a[k]) == "string" and allowed[a[k]] then settings[k] = a[k] end
  end
  -- older versions stored the edge as "side" (left or right)
  if a.facing == nil and (a.side == "left" or a.side == "right") then settings.facing = a.side end
  local v = tonumber(a.vertical)
  if v then settings.vertical = math.max(0, math.min(100, math.floor(v + 0.5))) end
  if type(a.color) == "string" and a.color:match("^#%x%x%x%x%x%x$") then settings.color = a.color:lower() end
  if type(a.backupfile) == "string" then
    local f = trim(a.backupfile)
    if f == "" then
      settings.backupfile = ""
    elseif safe_path(f) then
      local n = normalise(f)
      local base = n:match("([^/]+)$") or ""
      -- must be a .json file name that cannot collide with the weekday backups, Notes.txt or the main notes file
      if base:lower():match("%.json$") and not base:match("^MoreNotes_backup_%d%.json$") and not base:match("^MoreNotes_snapshot_%d%.json$") and n ~= NOTES_PATH then
        settings.backupfile = n
      end
    end
  end
  if type(a.snapdir) == "string" then
    local d = trim(a.snapdir)
    if d == "" then
      settings.snapdir = ""
    elseif safe_path(d) then
      settings.snapdir = (normalise(d):gsub("/+$", ""))
    end
  end
  if type(a.backupdir) == "string" then
    local d = trim(a.backupdir)
    if d == "" then
      settings.backupdir = ""
    elseif safe_path(d) then
      local n = normalise(d):gsub("/+$", "")
      settings.backupdir = n
    end
  end
end

---------------------------------------------------------------------------
-- Files
---------------------------------------------------------------------------
local function file_exists(path)
  local f = io.open(path, "rb")
  if f then f:close(); return true end
  return false
end

local make_dirs -- defined below

local function write_atomic(path, content)
  local tmp = path .. ".tmp"
  local f, err = io.open(tmp, "wb")
  if not f then
    -- the folder may not exist yet (for instance Steam's config folder on a fresh install): create it once and retry
    local dir = normalise(path):match("^(.*)/[^/]+$")
    if dir and #dir > 0 and make_dirs then
      pcall(make_dirs, dir)
      f, err = io.open(tmp, "wb")
    end
  end
  if not f then return false, tostring(err) end
  local okw, werr = f:write(content)
  f:close()
  if not okw then os.remove(tmp); return false, tostring(werr) end
  if file_exists(path) then os.remove(path) end
  local ok, rerr = os.rename(tmp, path)
  if not ok then return false, tostring(rerr) end
  return true
end

-- Returns the decoded document, or nil plus "missing" / "corrupt".
local function read_doc(path)
  local f = io.open(path, "rb")
  if not f then return nil, "missing" end
  local raw = f:read("*a")
  f:close()
  if not raw or #raw == 0 then return nil, "missing" end
  local ok, data = pcall(decode, raw)
  if ok and type(data) == "table" and type(data.notes) == "table" then return data end
  return nil, "corrupt"
end

local function snapshot_doc()
  return encode({ version = 1, saved_at = os.time(), notes = notes, settings = settings })
end

---------------------------------------------------------------------------
-- External backup (a second copy outside Steam, plus a rolling set of weekday backups)
---------------------------------------------------------------------------
local k32 = nil -- nil = not tried, false = unavailable

local function windows_dir_api()
  if k32 ~= nil then return k32 end
  k32 = false
  if IS_WINDOWS then
    local ok, ffi = pcall(require, "ffi")
    if ok and ffi then
      pcall(function() ffi.cdef("int CreateDirectoryA(const char* lpPathName, void* lpSecurityAttributes);") end)
      local ok2, lib = pcall(ffi.load, "kernel32")
      if ok2 then k32 = lib end
    end
  end
  return k32
end

make_dirs = function(dir)
  local d = normalise(dir)
  local lib = windows_dir_api()
  if lib then
    local acc = (d:sub(1, 1) == "/") and "/" or ""
    local first = true
    for seg in d:gmatch("[^/]+") do
      if acc == "" or acc:sub(-1) == "/" then acc = acc .. seg else acc = acc .. "/" .. seg end
      if not (first and seg:match("^%a:$")) then
        pcall(function() lib.CreateDirectoryA(acc, nil) end)
      end
      first = false
    end
    return
  end
  if not safe_path(d) then return end
  if IS_WINDOWS then
    os.execute('mkdir "' .. d:gsub("/", "\\") .. '" >nul 2>&1')
  else
    os.execute('mkdir -p "' .. d .. '" >/dev/null 2>&1')
  end
end

-- The default folder (all systems): <Documents>/MoreNotes, i.e. %USERPROFILE%\Documents\MoreNotes on Windows and
-- $HOME/Documents/MoreNotes on Linux and Mac. It holds the backup copy, the weekday backups and a readable Notes.txt.
-- Earlier default folders stay as fallbacks (and are searched when recovering), so nothing is lost on update.
local function home_dir()
  local first, second = os.getenv("USERPROFILE"), os.getenv("HOME")
  if not IS_WINDOWS then first, second = second, first end
  for _, h in ipairs({ first or "", second or "" }) do
    if #h > 0 then return (normalise(h):gsub("/+$", "")) end
  end
  return nil
end

local function default_dirs()
  local out = {}
  local home = home_dir()
  if home then out[#out + 1] = home .. "/Documents/MoreNotes" end
  if legacy_root then out[#out + 1] = legacy_root .. "/millennium/More-Notes" end -- the 1.3-1.6 default
  if root and root ~= legacy_root then out[#out + 1] = root .. "/millennium/More-Notes" end
  if home then out[#out + 1] = home .. "/Documents/MoreNotes Backup" end
  local appdata = os.getenv("APPDATA")
  if appdata and #appdata > 0 then
    out[#out + 1] = normalise(appdata):gsub("/+$", "") .. "/MoreNotes"
  elseif home then
    out[#out + 1] = home .. "/.MoreNotes"
  end
  return out
end

local function file_dir(path)
  return (normalise(path):match("^(.*)/[^/]+$"))
end

-- The mirror file for a folder: the exact file the user chose, else MoreNotes_notes.json in that folder.
local function mirror_path(d)
  if settings.backupfile and #settings.backupfile > 0 then return settings.backupfile end
  return d .. "/MoreNotes_notes.json"
end

-- The folder of the file the user chose, else the folder the user chose, else the default folders in order.
local function candidate_dirs()
  if settings.backupfile and #settings.backupfile > 0 then
    local d = file_dir(settings.backupfile)
    if d and #d > 0 then return { d } end
  end
  if settings.backupdir and #settings.backupdir > 0 then return { settings.backupdir } end
  return default_dirs()
end

local function all_known_dirs()
  local out, seen = {}, {}
  local function add(d) if d and not seen[d] then seen[d] = true; out[#out + 1] = d end end
  if settings.snapdir and #settings.snapdir > 0 then add(settings.snapdir) end
  if settings.backupfile and #settings.backupfile > 0 then add(file_dir(settings.backupfile)) end
  if settings.backupdir and #settings.backupdir > 0 then add(settings.backupdir) end
  for _, d in ipairs(default_dirs()) do add(d) end
  return out
end

local function dir_writable(dir)
  local probe = dir .. "/.write_test"
  local f = io.open(probe, "wb")
  if not f then return false end
  f:close()
  os.remove(probe)
  return true
end

-- Creates the default MoreNotes folder in Documents (if it is missing) as soon as the plugin is enabled.
local function ensure_default_folder()
  local d = default_dirs()[1]
  if not d then return false end
  if dir_writable(d) then return true end
  make_dirs(d)
  return dir_writable(d)
end

-- A readable copy of every note (Notes.txt), written next to the backup files.
local function readable_text()
  local keys = {}
  for k in pairs(notes) do keys[#keys + 1] = k end
  table.sort(keys)
  local out = { "More Notes - your private notes for Steam", "Saved " .. os.date("%Y-%m-%d %H:%M"), "" }
  for _, k in ipairs(keys) do
    local n = notes[k]
    if type(n) == "table" then
      out[#out + 1] = "=== " .. ((type(n.label) == "string" and #n.label > 0) and n.label or k) .. " [" .. k .. "] ==="
      out[#out + 1] = tostring(n.text or "")
      out[#out + 1] = ""
    end
  end
  return table.concat(out, "\r\n")
end

local function write_text_export()
  local text = readable_text()
  local done = {}
  local function put(d)
    if d and not done[d] then
      done[d] = true
      write_atomic(d .. "/Notes.txt", text)
    end
  end
  put(default_dirs()[1])
  if settings.backup then put(backup_state.dir) end
end

local function backup_write(content, force)
  if not settings.backup and not force then return nil end
  local last_err = "no backup folder available"
  for _, d in ipairs(candidate_dirs()) do
    local path = mirror_path(d)
    local ok, err = write_atomic(path, content)
    if not ok then
      make_dirs(d)
      ok, err = write_atomic(path, content)
    end
    if ok then
      backup_state.dir, backup_state.error = d, nil
      -- One backup file per weekday, rewritten on every save: today's file tracks today, the other six keep
      -- the last state of the previous days, so a bad edit can be undone up to a week later.
      local sd = d
      if settings.snapdir and #settings.snapdir > 0 then
        sd = settings.snapdir
        make_dirs(sd)
      end
      backup_state.snapdir = sd
      write_atomic(sd .. "/MoreNotes_backup_" .. os.date("%w") .. ".json", content)
      return true
    end
    last_err = tostring(err)
  end
  backup_state.error = last_err
  log("backup failed: " .. last_err)
  return false
end

-- When the folder changes, bring the earlier days' backups along so Undo history is not lost
-- (a backup already in the new folder is only replaced by a newer one). Files from versions before 2.2.0
-- were named MoreNotes_snapshot_N.json; they are read too and carried over under the new name.
local function carry_over(from, to)
  for i = 0, 6 do
    local dst_name = "/MoreNotes_backup_" .. i .. ".json"
    local best_raw, best_t = nil, -1
    for _, name in ipairs({ "/MoreNotes_backup_" .. i .. ".json", "/MoreNotes_snapshot_" .. i .. ".json" }) do
      local f = io.open(from .. name, "rb")
      if f then
        local raw = f:read("*a")
        f:close()
        local ok, src = pcall(decode, raw or "")
        if ok and type(src) == "table" and type(src.notes) == "table" then
          local t = tonumber(src.saved_at) or 0
          if t > best_t then best_raw, best_t = raw, t end
        end
      end
    end
    if best_raw then
      local dst = read_doc(to .. dst_name)
      if not dst or best_t > (tonumber(dst.saved_at) or 0) then
        write_atomic(to .. dst_name, best_raw)
      end
    end
  end
end

-- The newest valid copy among the mirror and the weekday backups of every known folder. With mode "previous"
-- only backups saved before today count (an undo for a bad edit made today).
local function find_backup(mode)
  local today = os.date("%Y-%m-%d")
  local best, best_path, best_time = nil, nil, -1
  for _, d in ipairs(all_known_dirs()) do
    local files = {}
    if mode ~= "previous" then
      files[1] = d .. "/MoreNotes_notes.json"
      if settings.backupfile and #settings.backupfile > 0 and file_dir(settings.backupfile) == d then
        files[2] = settings.backupfile
      end
    end
    for i = 0, 6 do
      files[#files + 1] = d .. "/MoreNotes_backup_" .. i .. ".json"
      files[#files + 1] = d .. "/MoreNotes_snapshot_" .. i .. ".json" -- named this way before 2.2.0
    end
    for _, path in ipairs(files) do
      local doc = read_doc(path)
      if doc then
        local t = tonumber(doc.saved_at) or 0
        local eligible = (mode ~= "previous") or (os.date("%Y-%m-%d", t) < today)
        if eligible and t > best_time then best, best_path, best_time = doc, path, t end
      end
    end
  end
  return best, best_path
end

---------------------------------------------------------------------------
-- Load / save
---------------------------------------------------------------------------
local function load_notes()
  loaded = true
  notes = {}
  local doc, reason = read_doc(NOTES_PATH)
  if doc then
    notes = doc.notes
    apply_settings(doc.settings)
    return
  end
  if reason == "corrupt" then
    -- keep the unreadable file instead of overwriting it silently
    pcall(function()
      os.remove(NOTES_PATH .. ".corrupt")
      os.rename(NOTES_PATH, NOTES_PATH .. ".corrupt")
    end)
    log("notes file could not be parsed; moved to .corrupt")
  end
  -- missing or damaged: recover from the external copy if there is one
  local b, path = find_backup()
  if b then
    notes = b.notes
    apply_settings(b.settings)
    restored_from = path
    log("restored notes from " .. tostring(path))
    pcall(write_atomic, NOTES_PATH, snapshot_doc())
    pcall(backup_write, snapshot_doc()) -- heal a missing main copy as well
  end
end

local function save_notes()
  local content = snapshot_doc()
  local ok, err = write_atomic(NOTES_PATH, content)
  if not ok then return false, err end
  pcall(backup_write, content) -- a backup problem must never fail a save
  pcall(write_text_export)
  return true
end

local function ensure_loaded()
  if not loaded then load_notes() end
end

-- Arguments arrive as a table of strings or as one string. A string field named "json" carries a whole
-- JSON document (used for settings so no boolean/number crosses the native boundary).
local function parse_args(a)
  if type(a) == "string" then
    if #a == 0 then return {} end
    local ok, v = pcall(decode, a)
    if not ok or type(v) ~= "table" then return {} end
    a = v
  end
  if type(a) ~= "table" then return {} end
  if type(a.json) == "string" and #a.json > 0 then
    local ok, v = pcall(decode, a.json)
    if ok and type(v) == "table" then return v end
  end
  return a
end

local MAX_NOTE_CHARS = 4000

-- Counts UTF-8 characters and cuts to at most `max` of them without splitting a character.
local function cut_chars(s, max)
  local count, i, n = 0, 1, #s
  while i <= n do
    local b = s:byte(i)
    local len = (b >= 0xF0 and 4) or (b >= 0xE0 and 3) or (b >= 0xC0 and 2) or 1
    if count == max then return s:sub(1, i - 1) end
    count = count + 1
    i = i + len
  end
  return s
end

local function count_notes()
  local n = 0
  for _ in pairs(notes) do n = n + 1 end
  return n
end

local function backup_info_table()
  local dir = backup_state.dir or candidate_dirs()[1]
  local saved_at, count = 0, 0
  if dir then
    local d = read_doc(mirror_path(dir))
    if d then
      saved_at = tonumber(d.saved_at) or 0
      for _ in pairs(d.notes) do count = count + 1 end
    end
  end
  return {
    ok = true, enabled = settings.backup, dir = dir or "", file = dir and mirror_path(dir) or "",
    snap_dir = (settings.snapdir and #settings.snapdir > 0) and settings.snapdir or (dir or ""),
    default_file = (default_dirs()[1] or "") .. "/MoreNotes_notes.json", saved_at = saved_at, count = count,
    error = backup_state.error or "", restored_from = restored_from or "", default_dir = default_dirs()[1] or "",
  }
end

---------------------------------------------------------------------------
-- Functions callable from the frontend (global)
---------------------------------------------------------------------------
function get_all(_args)
  ensure_loaded()
  return encode({ ok = true, notes = notes, settings = settings })
end

function get_settings(_args)
  ensure_loaded()
  return encode({ ok = true, settings = settings })
end

function set_settings(args)
  ensure_loaded()
  local previous_dir = backup_state.dir
  local previous_snap = backup_state.snapdir or previous_dir
  apply_settings(parse_args(args))
  local ok, err = save_notes()
  if not ok then return encode({ ok = false, error = "write_failed", detail = err }) end
  if previous_dir and backup_state.dir and previous_dir ~= backup_state.dir then
    pcall(carry_over, previous_dir, backup_state.dir)
  end
  -- the backup folder changed: bring the earlier days along
  if previous_snap and backup_state.snapdir and previous_snap ~= backup_state.snapdir then
    pcall(carry_over, previous_snap, backup_state.snapdir)
  end
  return encode({ ok = true, settings = settings })
end

-- Describes what arrived without echoing any note text: types, lengths and the key names only.
local function describe_args(a1, a2, a3)
  local function one(v)
    local t = type(v)
    if t == "string" then return "string(len=" .. #v .. ")" end
    if t == "table" then
      local parts = {}
      for k, val in pairs(v) do
        if #parts < 8 then parts[#parts + 1] = tostring(k) .. ":" .. one(val) end
      end
      table.sort(parts)
      return "table{" .. table.concat(parts, ",") .. "}"
    end
    return t
  end
  return "received " .. one(a1) .. (a2 ~= nil and (", " .. one(a2)) or "") .. (a3 ~= nil and (", " .. one(a3)) or "")
end

-- Works whether the host hands over a table, one JSON string, a table holding a "json" string, or
-- separate positional values (key, text, label).
local function note_args(a1, a2, a3)
  local a = parse_args(a1)
  if type(a.key) ~= "string" and type(a1) == "string" and a2 ~= nil then
    a = { key = a1, text = a2, label = a3 }
  end
  return a
end

function set_note(args, extra_text, extra_label)
  ensure_loaded()
  local a = note_args(args, extra_text, extra_label)
  local key = type(a.key) == "string" and a.key or ""
  if #key == 0 or #key > 120 or not key:match("^[%w_:%.%-/~]+$") then
    return encode({ ok = false, error = "bad_key", detail = describe_args(args, extra_text, extra_label) })
  end
  local text = type(a.text) == "string" and trim(a.text) or ""
  text = cut_chars(text, MAX_NOTE_CHARS)
  if #text == 0 then
    notes[key] = nil
  else
    local label = type(a.label) == "string" and a.label:sub(1, 120) or nil
    local previous = notes[key]
    if (label == nil or #label == 0) and type(previous) == "table" then label = previous.label end
    notes[key] = { text = text, label = label, updated = os.time() }
  end
  local ok, err = save_notes()
  if not ok then return encode({ ok = false, error = "write_failed", detail = err }) end
  return encode({ ok = true, key = key, deleted = (#text == 0) })
end

function delete_note(args)
  local a = parse_args(args)
  local key = (type(a.key) == "string") and a.key or (type(args) == "string" and args) or nil
  return set_note({ key = key, text = "" })
end

function get_info(_args)
  ensure_loaded()
  return encode({ ok = true, path = NOTES_PATH, count = count_notes(), root = root or "" })
end

function backup_info(_args)
  ensure_loaded()
  return encode(backup_info_table())
end

function backup_now(_args)
  ensure_loaded()
  local ok = backup_write(snapshot_doc(), true)
  local info = backup_info_table()
  info.ok = ok == true
  if not info.ok and info.error == "" then info.error = "backup failed" end
  return encode(info)
end

function restore_backup(args)
  ensure_loaded()
  local a = parse_args(args)
  local mode = (a.which == "previous") and "previous" or "latest"
  local b, path = find_backup(mode)
  if not b then return encode({ ok = false, error = (mode == "previous") and "no_previous" or "no_backup" }) end
  pcall(write_atomic, NOTES_PATH .. ".before-restore", snapshot_doc()) -- keep what is being replaced
  local keep_dir, keep_file, keep_snap, keep_on = settings.backupdir, settings.backupfile, settings.snapdir, settings.backup
  notes = b.notes
  apply_settings(b.settings)
  settings.backupdir, settings.backupfile, settings.snapdir, settings.backup = keep_dir, keep_file, keep_snap, keep_on
  local ok, err = save_notes()
  if not ok then return encode({ ok = false, error = "write_failed", detail = err }) end
  return encode({ ok = true, count = count_notes(), from = path })
end

---------------------------------------------------------------------------
-- Lifecycle (globals + returned table; ready() is guarded against double calls)
---------------------------------------------------------------------------
function on_load()
  ensure_loaded()
  log("loaded " .. count_notes() .. " notes from " .. NOTES_PATH)
  pcall(ensure_default_folder)
  pcall(backup_write, snapshot_doc()) -- first copy, or a refresh after an update
  pcall(write_text_export)
  -- bring backups from the 1.3-1.6 default folder into the new default so Undo history is kept
  pcall(function()
    local dirs = default_dirs()
    if dirs[1] and (not settings.backupdir or #settings.backupdir == 0) and (not settings.backupfile or #settings.backupfile == 0) and (not settings.snapdir or #settings.snapdir == 0) then
      for i = 2, #dirs do carry_over(dirs[i], dirs[1]) end
    end
  end)
  if not ready_called then
    ready_called = true
    pcall(function() millennium.ready() end)
  end
end

function on_frontend_loaded() end

function on_unload() end

return { on_load = on_load, on_frontend_loaded = on_frontend_loaded, on_unload = on_unload }
