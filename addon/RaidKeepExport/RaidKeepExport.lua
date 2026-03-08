-- RaidKeep Export - Export guild roster for raidkeep.app
-- Usage: /raidkeep or /rk - opens window. Click "Fetch Roster" to export.

RaidKeepExport = RaidKeepExport or {}

local CLASS_MAP = {
    WARRIOR = { name = "Warrior", role = "tank" },
    PALADIN = { name = "Paladin", role = "tank" },
    HUNTER = { name = "Hunter", role = "dps" },
    ROGUE = { name = "Rogue", role = "dps" },
    PRIEST = { name = "Priest", role = "healer" },
    SHAMAN = { name = "Shaman", role = "healer" },
    MAGE = { name = "Mage", role = "dps" },
    WARLOCK = { name = "Warlock", role = "dps" },
    DRUID = { name = "Druid", role = "tank" },
    DEATHKNIGHT = { name = "Death Knight", role = "tank" },
    MONK = { name = "Monk", role = "tank" },
    DEMONHUNTER = { name = "Demon Hunter", role = "tank" },
    EVOKER = { name = "Evoker", role = "dps" },
}

local CLASS_DISPLAY_FALLBACK = {
    ["Warrior"] = { name = "Warrior", role = "tank" },
    ["Paladin"] = { name = "Paladin", role = "tank" },
    ["Hunter"] = { name = "Hunter", role = "dps" },
    ["Rogue"] = { name = "Rogue", role = "dps" },
    ["Priest"] = { name = "Priest", role = "healer" },
    ["Shaman"] = { name = "Shaman", role = "healer" },
    ["Mage"] = { name = "Mage", role = "dps" },
    ["Warlock"] = { name = "Warlock", role = "dps" },
    ["Druid"] = { name = "Druid", role = "tank" },
    ["Death Knight"] = { name = "Death Knight", role = "tank" },
    ["Monk"] = { name = "Monk", role = "tank" },
    ["Demon Hunter"] = { name = "Demon Hunter", role = "tank" },
    ["Evoker"] = { name = "Evoker", role = "dps" },
}

local function getClassAndRole(classFile, classDisplayName)
    if classFile and CLASS_MAP[classFile] then
        return CLASS_MAP[classFile].name, CLASS_MAP[classFile].role
    end
    if classDisplayName and CLASS_DISPLAY_FALLBACK[classDisplayName] then
        return CLASS_DISPLAY_FALLBACK[classDisplayName].name, CLASS_DISPLAY_FALLBACK[classDisplayName].role
    end
    return classDisplayName or "Unknown", "dps"
end

local function realmToSlug(realmName)
    if not realmName or realmName == "" then return "unknown" end
    return string.lower(string.gsub(realmName, "%s+", "-"))
end

local function escape(s)
    if type(s) ~= "string" then return tostring(s) end
    return string.gsub(s, '["\\]', "\\%1")
end

local function encode(val)
    if type(val) == "nil" then return "null"
    elseif type(val) == "boolean" then return val and "true" or "false"
    elseif type(val) == "number" then return tostring(val)
    elseif type(val) == "string" then return '"' .. escape(val) .. '"'
    elseif type(val) == "table" then
        if val[1] ~= nil then
            local arr = {}
            for i = 1, #val do
                arr[i] = encode(val[i])
            end
            return "[" .. table.concat(arr, ",") .. "]"
        else
            local obj = {}
            for k, v in pairs(val) do
                if type(k) == "string" then
                    table.insert(obj, '"' .. escape(k) .. '":' .. encode(v))
                end
            end
            return "{" .. table.concat(obj, ",") .. "}"
        end
    end
    return "null"
end

local function buildExport()
    if not IsInGuild() then
        return nil, "You must be in a guild."
    end

    local guildName = GetGuildInfo("player")
    if not guildName then
        return nil, "Could not get guild name. Open Guild panel (G) and try again."
    end

    local realmName = GetNormalizedRealmName and GetNormalizedRealmName() or GetRealmName()
    local realmSlug = realmToSlug(realmName)

    local numTotal = select(1, GetNumGuildMembers()) or 0

    local members = {}
    for i = 1, numTotal do
        local name, rankName, rankIndex, level, classDisplayName, zone, publicNote, officerNote, isOnline, status, classFile =
            GetGuildRosterInfo(i)

        if name and name ~= "" then
            local charName = name
            local dash = string.find(name, "-")
            if dash then
                charName = string.sub(name, 1, dash - 1)
            end

            local className, role = getClassAndRole(classFile, classDisplayName)

            table.insert(members, {
                name = charName,
                class = className,
                level = level or 1,
                role = role,
                rank = rankName,
            })
        end
    end

    if #members == 0 then
        return nil, "Guild roster is empty. Open Guild panel (G), wait for it to load, then click Fetch Roster."
    end

    local export = {
        guild_name = guildName,
        realm = realmSlug,
        server_type = "Classic TBC",
        members = members,
    }

    return encode(export), #members
end

-- Create the main window
local function createWindow()
    if _G.RaidKeepExportFrame then
        return _G.RaidKeepExportFrame
    end

    local frame = CreateFrame("Frame", "RaidKeepExportFrame", UIParent)
    frame:SetSize(520, 420)
    frame:SetPoint("CENTER", 0, 0)
    frame:SetFrameStrata("DIALOG")
    frame:SetMovable(true)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")

    -- Backdrop: try SetBackdrop first; fall back to CreateTexture if not available (e.g. TBC)
    if frame.SetBackdrop then
        frame:SetBackdrop({
            bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
            edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
            tile = true, tileSize = 32, edgeSize = 32,
            insets = { left = 11, right = 12, top = 12, bottom = 11 },
        })
        if frame.SetBackdropColor then
            frame:SetBackdropColor(0, 0, 0, 1)
        end
    else
        -- Fallback for clients without SetBackdrop (e.g. older TBC)
        local bg = frame:CreateTexture(nil, "BACKGROUND")
        bg:SetAllPoints(frame)
        local ok = pcall(bg.SetTexture, bg, "Interface\\DialogFrame\\UI-DialogBox-Background")
        if not ok then
            bg:SetTexture(0.12, 0.12, 0.12, 1)
        end
        -- Simple border: 4 edge bars
        local edgeColor = { 0.4, 0.35, 0.25, 1 }
        local thick = 8
        local top = frame:CreateTexture(nil, "BORDER")
        top:SetHeight(thick) top:SetPoint("TOPLEFT", thick, thick) top:SetPoint("TOPRIGHT", -thick, thick)
        top:SetTexture(unpack(edgeColor))
        local bot = frame:CreateTexture(nil, "BORDER")
        bot:SetHeight(thick) bot:SetPoint("BOTTOMLEFT", thick, -thick) bot:SetPoint("BOTTOMRIGHT", -thick, -thick)
        bot:SetTexture(unpack(edgeColor))
        local left = frame:CreateTexture(nil, "BORDER")
        left:SetWidth(thick) left:SetPoint("TOPLEFT", 0, thick) left:SetPoint("BOTTOMLEFT", 0, -thick)
        left:SetTexture(unpack(edgeColor))
        local right = frame:CreateTexture(nil, "BORDER")
        right:SetWidth(thick) right:SetPoint("TOPRIGHT", 0, thick) right:SetPoint("BOTTOMRIGHT", 0, -thick)
        right:SetTexture(unpack(edgeColor))
    end

    local title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    title:SetPoint("TOP", 0, -18)
    title:SetText("RaidKeep Roster Export")

    local fetchBtn = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
    fetchBtn:SetSize(140, 28)
    fetchBtn:SetPoint("TOP", 0, -45)
    fetchBtn:SetText("Fetch Roster")
    fetchBtn:SetScript("OnClick", function()
        local editBox = _G.RaidKeepExportFrameEditBox
        if not editBox then return end

        if not IsInGuild() then
            editBox:SetText("Error: You must be in a guild.")
            return
        end

        editBox:SetText("Fetching roster... (this may take a moment)")
        GuildRoster()

        -- Roster loads asynchronously; wait for GUILD_ROSTER_UPDATE
        local ev = CreateFrame("Frame", nil, frame)
        ev:RegisterEvent("GUILD_ROSTER_UPDATE")
        ev:SetScript("OnEvent", function(_, event)
            ev:UnregisterEvent("GUILD_ROSTER_UPDATE")
            ev:SetScript("OnEvent", nil)

            local json, count = buildExport()
            if json then
                editBox:SetText(json)
                editBox:HighlightText(0, string.len(json))
                DEFAULT_CHAT_FRAME:AddMessage("RaidKeep: Exported " .. count .. " members.", 0.5, 0.8, 0.5)
            else
                editBox:SetText("Error: " .. (count or "Unknown error"))
                DEFAULT_CHAT_FRAME:AddMessage("RaidKeep: " .. (count or "Unknown error"), 1, 0.3, 0.3)
            end
        end)
    end)

    local hint = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    hint:SetPoint("TOP", 0, -78)
    hint:SetText("Open Guild panel (G) first if roster is empty. Ctrl+A, Ctrl+C to copy.")
    hint:SetTextColor(0.7, 0.7, 0.7)

    local editBox = CreateFrame("EditBox", "RaidKeepExportFrameEditBox", frame)
    editBox:SetSize(480, 280)
    editBox:SetPoint("TOP", 0, -100)
    editBox:SetMultiLine(true)
    editBox:SetAutoFocus(false)
    editBox:SetFontObject(ChatFontNormal)
    editBox:SetTextColor(1, 1, 1, 1)
    editBox:SetScript("OnEscapePressed", function() frame:Hide() end)
    if editBox.SetTextInsets then
        editBox:SetTextInsets(6, 6, 6, 6)
    end
    editBox:SetText("Click 'Fetch Roster' to export your guild roster for raidkeep.app")

    local closeBtn = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
    closeBtn:SetSize(100, 24)
    closeBtn:SetPoint("BOTTOM", 0, 18)
    closeBtn:SetText("Close")
    closeBtn:SetScript("OnClick", function() frame:Hide() end)

    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)

    return frame
end

local function showWindow()
    local frame = createWindow()
    frame:Show()
    frame:Raise()
end

SLASH_RAIDKEEP1 = "/raidkeep"
SLASH_RAIDKEEP2 = "/rk"
SlashCmdList["RAIDKEEP"] = function()
    showWindow()
end
