-- More Notes backend entry (Starlight): lifecycle hooks only. The notes logic and the ---@ffi functions live in
-- rpc_functions.lua.
local logger     = require("logger")
local millennium = require("millennium")

-- defines the RPC functions (get_all, set_note, ...) and moreNotesStartup()
require("rpc_functions")

local ready_called = false

local function on_load()
    local version = "?"
    pcall(function() version = millennium.version() end)
    logger:info("More Notes loaded with Millennium version " .. tostring(version))
    local ok, err = pcall(moreNotesStartup)
    if not ok then logger:error("More Notes start-up failed: " .. tostring(err)) end
    if not ready_called then
        ready_called = true
        millennium.ready()
    end
end

-- Called when the plugin is unloaded (disabled, or Steam shutting down). Do not rely on it for critical cleanup.
local function on_unload()
    logger:info("More Notes unloaded")
end

-- Called when the Steam UI has fully loaded.
local function on_frontend_loaded()
    logger:info("More Notes: Steam UI loaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
    on_frontend_loaded = on_frontend_loaded,
}
