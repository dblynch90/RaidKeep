/**
 * QA Test Mode: Returns mock data for Battle.net–dependent endpoints so QA can run without Battle.net login.
 * Enable with QA_TEST_MODE=1 and send header X-QA-Test-Mode: 1 on API requests.
 */

import type { Request, Response, NextFunction } from "express";

const QA_REALM = "stormrage";
const QA_REALM_SLUG = "stormrage";
const QA_GUILD = "Test Guild";
const QA_SERVER_TYPE = "TBC Anniversary";

export const QA_MOCK_CHARACTERS = [
  { id: 1, name: "QaTank", class: "Warrior", role: "dps", guild_name: QA_GUILD, realm: "Stormrage", realm_slug: QA_REALM_SLUG, guild_id: 1, guild_rank: "Raider", guild_rank_index: 3, is_guild_leader: false, server_type: QA_SERVER_TYPE, portrait_url: undefined, level: 70, race: "Human" },
  { id: 2, name: "QaHealer", class: "Priest", role: "dps", guild_name: QA_GUILD, realm: "Stormrage", realm_slug: QA_REALM_SLUG, guild_id: 1, guild_rank: "Raider", guild_rank_index: 3, is_guild_leader: false, server_type: QA_SERVER_TYPE, portrait_url: undefined, level: 70, race: "Draenei" },
  { id: 3, name: "QaDps", class: "Mage", role: "dps", guild_name: QA_GUILD, realm: "Stormrage", realm_slug: QA_REALM_SLUG, guild_id: 1, guild_rank: "Officer", guild_rank_index: 1, is_guild_leader: true, server_type: QA_SERVER_TYPE, portrait_url: undefined, level: 70, race: "Blood Elf" },
  { id: 4, name: "QaHunter", class: "Hunter", role: "dps", guild_name: QA_GUILD, realm: "Stormrage", realm_slug: QA_REALM_SLUG, guild_id: 1, guild_rank: "Raider", guild_rank_index: 3, is_guild_leader: false, server_type: QA_SERVER_TYPE, portrait_url: undefined, level: 70, race: "Night Elf" },
  { id: 5, name: "QaRogue", class: "Rogue", role: "dps", guild_name: QA_GUILD, realm: "Stormrage", realm_slug: QA_REALM_SLUG, guild_id: 1, guild_rank: "Raider", guild_rank_index: 3, is_guild_leader: false, server_type: QA_SERVER_TYPE, portrait_url: undefined, level: 70, race: "Undead" },
];

const QA_MOCK_PERMISSIONS = {
  view_guild_dashboard: true,
  view_guild_roster: true,
  view_raid_roster: true,
  view_raid_schedule: true,
  manage_raids: true,
  manage_raid_roster: true,
  manage_permissions: true,
  manage_guild_crafters: true,
};

const QA_MOCK_GUILD_ROSTER = {
  guild: { name: QA_GUILD, realm: "Stormrage", server_type: QA_SERVER_TYPE },
  members: QA_MOCK_CHARACTERS.map((c) => ({
    name: c.name,
    class: c.class,
    level: c.level,
    role: c.role,
    rank: c.guild_rank,
    rank_index: c.guild_rank_index,
  })),
};

export function isQaTestMode(req: Request): boolean {
  if (process.env.QA_TEST_MODE !== "1") return false;
  const header = (req.headers["x-qa-test-mode"] as string)?.toLowerCase();
  return header === "1" || header === "true";
}

export function qaMockMiddleware(route: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isQaTestMode(req) || !req.session?.user) {
      next();
      return;
    }
    switch (route) {
      case "characters": {
        const serverType = (req.query.server_type as string)?.trim() || QA_SERVER_TYPE;
        const chars = QA_MOCK_CHARACTERS.filter((c) => !serverType || c.server_type === serverType);
        res.json({
          characters: chars,
          syncStatus: { lastSyncAt: new Date().toISOString(), charactersFound: chars.length, error: null },
          syncDebug: null,
        });
        return;
      }
      case "guild-permissions": {
        res.json({ permissions: QA_MOCK_PERMISSIONS });
        return;
      }
      case "guild-roster": {
        res.json(QA_MOCK_GUILD_ROSTER);
        return;
      }
      case "character-search": {
        const name = (req.query.character_name as string)?.trim();
        if (!name) {
          res.status(400).json({ error: "character_name required" });
          return;
        }
        const match = QA_MOCK_CHARACTERS.find((c) => c.name.toLowerCase() === name.toLowerCase())
          ?? { name, class: "Warrior", level: 70 };
        res.json({ name: match.name, class: match.class, level: match.level });
        return;
      }
      case "my-assignments": {
        res.json({ raids: [] });
        return;
      }
      case "saved-raids": {
        res.json({ raids: [] });
        return;
      }
      case "raider-roster": {
        res.json({
          raiders: QA_MOCK_CHARACTERS.map((c) => ({
            character_name: c.name,
            character_class: c.class,
            raid_role: "dps",
            raid_lead: c.is_guild_leader ? 1 : 0,
            raid_assist: 0,
          })),
        });
        return;
      }
      case "raid-teams": {
        res.json({ teams: [] });
        return;
      }
      case "sync": {
        res.json({ ok: true });
        return;
      }
      default:
        next();
        return;
    }
  };
}
