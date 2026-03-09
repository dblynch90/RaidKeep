/**
 * Sync user's guilds and characters from their Battle.net WoW profile.
 * Supports Retail, Classic Era, and Classic (SoD, TBC, Wrath including TBC Anniversary).
 */

import { getDb } from "../db/init.js";
import {
  fetchWoWProfile,
  extractCharactersFromProfile,
  fetchCharacterGuild,
  fetchGuildRoster,
} from "./blizzard.js";

// Blizzard API: Retail, Classic Era, TBC Anniversary, MOP Classic
const PROFILE_FETCHES: Array<{ serverType: string; apiNamespace: "retail" | "classic-era" | "classic" | "classicann" }> = [
  { serverType: "Retail", apiNamespace: "retail" },
  { serverType: "Classic Era", apiNamespace: "classic-era" },
  { serverType: "TBC Anniversary", apiNamespace: "classicann" },
  { serverType: "MOP Classic", apiNamespace: "classic" },
];

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Sync guilds from user's WoW profile.
 * @param serverTypesToFetch - If empty/null, skips all API calls (for new users who haven't selected a version).
 *   For returning users: array of server types to fetch (e.g. ["Retail", "MOP Classic"]).
 *   Should include: user's default game version + server types where they have cached guilds.
 */
export async function syncGuildsFromBattleNet(
  userId: number,
  accessToken: string,
  region: string,
  serverTypesToFetch: string[] | null
): Promise<{ guildsImported: number; charactersImported: number }> {
  let guildsImported = 0;
  let charactersImported = 0;

  if (!serverTypesToFetch || serverTypesToFetch.length === 0) {
    console.log("Battle.net sync: skipped (no server types to fetch - new user or no selection)");
    return { guildsImported, charactersImported };
  }

  const validTypes = new Set(PROFILE_FETCHES.map((p) => p.serverType));
  const profileFetches = PROFILE_FETCHES.filter((p) =>
    serverTypesToFetch.includes(p.serverType) && validTypes.has(p.serverType)
  );
  if (profileFetches.length === 0) {
    console.log("Battle.net sync: no valid server types to fetch");
    return { guildsImported, charactersImported };
  }

  const debugLog: Array<{ serverType: string; status: string; accounts: number; rawChars: number; parsed: number; sample?: unknown }> = [];

  try {
    const allChars: Array<{ name: string; realmSlug: string; serverType: string; class: string; level: number; race: string }> = [];
    for (const { serverType, apiNamespace } of profileFetches) {
      try {
        const profile = await fetchWoWProfile(accessToken, region, apiNamespace);
        const raw = profile as Record<string, unknown>;
        const accounts = raw.wow_accounts ?? raw.accounts ?? [];
        const accountCount = Array.isArray(accounts) ? accounts.length : 0;
        let rawCharCount = 0;
        let sampleChar: unknown = null;
        if (Array.isArray(accounts)) {
          for (const acc of accounts) {
            const list = (acc as Record<string, unknown>)?.characters ?? [];
            const arr = Array.isArray(list) ? list : [];
            rawCharCount += arr.length;
            if (arr.length > 0 && !sampleChar) {
              sampleChar = arr[0];
            }
          }
        }
        const chars = extractCharactersFromProfile(profile);
        for (const c of chars) {
          allChars.push({ ...c, serverType, level: c.level ?? 1, race: c.race ?? "Unknown" });
        }
        debugLog.push({
          serverType,
          status: "ok",
          accounts: accountCount,
          rawChars: rawCharCount,
          parsed: chars.length,
          sample: sampleChar ?? undefined,
        });
        console.log(`[Blizzard API] ${serverType}: keys=${Object.keys(raw).join(",")} accounts=${accountCount} rawChars=${rawCharCount} parsed=${chars.length}`);
        if (accountCount > 0 && rawCharCount > 0 && chars.length === 0) {
          console.log(`[Blizzard API] ${serverType} sample structure (parsing may need fix):`, JSON.stringify(sampleChar, null, 2));
        }
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        debugLog.push({
          serverType,
          status: "error",
          accounts: 0,
          rawChars: 0,
          parsed: 0,
          sample: err instanceof Error ? err.message : String(err),
        });
        console.error(`Battle.net sync: profile fetch failed for ${serverType}:`, err);
      }
    }
    if (allChars.length === 0) {
      console.log("Battle.net sync: no characters found in any game version (check server console above for API response details)");
      getDb().prepare(
        "UPDATE users SET last_sync_at = datetime('now'), last_sync_characters = 0, last_sync_error = NULL, last_sync_debug = ? WHERE id = ?"
      ).run(JSON.stringify({ fetchLog: debugLog, storedByRealm: {} }, null, 2), userId);
      return { guildsImported, charactersImported };
    }

    const db = getDb();

    if (profileFetches.length < PROFILE_FETCHES.length) {
      const syncedTypes = new Set(profileFetches.map((p) => p.serverType));
      const placeholders = syncedTypes.size > 0 ? [...syncedTypes].map(() => "?").join(",") : "NULL";
      db.prepare(`DELETE FROM battle_net_characters WHERE user_id = ? AND server_type IN (${placeholders})`).run(userId, ...syncedTypes);
    } else {
      db.prepare("DELETE FROM battle_net_characters WHERE user_id = ?").run(userId);
    }
    const insertProfileChar = db.prepare(
      `INSERT INTO battle_net_characters (user_id, name, realm_slug, server_type, class, level, race) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of allChars) {
      insertProfileChar.run(userId, c.name, c.realmSlug, c.serverType, c.class, c.level ?? 1, c.race ?? "Unknown");
    }

    const guildsToImport = new Map<string, { realmSlug: string; guildName: string; serverType: string; myChars: Set<string> }>();

    const updateGuildName = db.prepare(
      "UPDATE battle_net_characters SET guild_name = ? WHERE user_id = ? AND LOWER(name) = ? AND realm_slug = ? AND server_type = ?"
    );
    // Fetch guild info in batches of 8 to avoid Blizzard rate limiting
    const BATCH_SIZE = 8;
    const guildResults: Array<{ char: (typeof allChars)[0]; info: { guildName: string; realmSlug: string } | null }> = [];
    for (let i = 0; i < allChars.length; i += BATCH_SIZE) {
      const batch = allChars.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((c) =>
          fetchCharacterGuild(c.realmSlug, c.name, region, c.serverType)
            .then((info) => ({ char: c, info }))
            .catch(() => ({ char: c, info: null }))
        )
      );
      guildResults.push(...batchResults);
      if (i + BATCH_SIZE < allChars.length) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    for (const { char, info } of guildResults) {
      if (!info) continue;
      updateGuildName.run(info.guildName, userId, char.name.toLowerCase(), char.realmSlug, char.serverType);
      const key = `${char.serverType}:${info.realmSlug}:${info.guildName}`;
      if (!guildsToImport.has(key)) {
        guildsToImport.set(key, {
          realmSlug: info.realmSlug,
          guildName: info.guildName,
          serverType: char.serverType,
          myChars: new Set(),
        });
      }
      guildsToImport.get(key)!.myChars.add(char.name.toLowerCase());
    }

    // Fetch all guild rosters in parallel
    const guildEntries = Array.from(guildsToImport.entries());
    const rosterResults = await Promise.allSettled(
      guildEntries.map(async ([, g]) => {
        const roster = await fetchGuildRoster(region, g.realmSlug, g.guildName, g.serverType);
        return { ...g, roster };
      })
    );

    for (let i = 0; i < rosterResults.length; i++) {
      const result = rosterResults[i];
      const [, { realmSlug, guildName, serverType, myChars }] = guildEntries[i];
      if (result.status === "rejected") {
        const err = result.reason;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          console.warn(`Battle.net sync: guild ${guildName} not found (404) - roster may not be available for this game version`);
        } else {
          console.error(`Battle.net sync: guild import failed for ${guildName}:`, err);
        }
        continue;
      }
      const { roster } = result.value;

      try {
        const existing = db
          .prepare("SELECT id, join_code FROM guilds WHERE name = ? AND server = ? AND server_type = ?")
          .get(roster.name, roster.realm, serverType) as { id: number; join_code: string } | undefined;

        let guildId: number;
        if (existing) {
          guildId = existing.id;
          const memberExists = db
            .prepare("SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?")
            .get(guildId, userId);
          if (!memberExists) {
            db.prepare(
              "INSERT INTO guild_members (guild_id, user_id, is_leader) VALUES (?, ?, 0)"
            ).run(guildId, userId);
          }
        } else {
          let code = generateCode();
          while (db.prepare("SELECT 1 FROM guilds WHERE join_code = ?").get(code)) {
            code = generateCode();
          }
          const insertResult = db
            .prepare(
              "INSERT INTO guilds (name, server, server_type, join_code) VALUES (?, ?, ?, ?)"
            )
            .run(roster.name, roster.realm, serverType, code);
          guildId = insertResult.lastInsertRowid as number;
          db.prepare(
            "INSERT INTO guild_members (guild_id, user_id, is_leader) VALUES (?, ?, 0)"
          ).run(guildId, userId);
        }

        const insertChar = db.prepare(
          `INSERT OR IGNORE INTO characters (guild_id, name, class, role, user_id)
           VALUES (?, ?, ?, ?, ?)`
        );
        const updateOwner = db.prepare(
          "UPDATE characters SET user_id = ? WHERE guild_id = ? AND name = ?"
        );
        for (const m of roster.members) {
          const isMine = myChars.has(m.name.toLowerCase());
          insertChar.run(guildId, m.name, m.class, m.role, isMine ? userId : null);
          if (isMine) {
            updateOwner.run(userId, guildId, m.name);
          }
          charactersImported++;
        }
        guildsImported++;

        const updateGuildId = db.prepare(
          "UPDATE battle_net_characters SET guild_id = ? WHERE user_id = ? AND realm_slug = ? AND server_type = ? AND LOWER(name) = ?"
        );
        const updateGuildRank = db.prepare(
          "UPDATE battle_net_characters SET guild_rank = ?, guild_rank_index = ? WHERE user_id = ? AND realm_slug = ? AND server_type = ? AND LOWER(name) = ?"
        );
        for (const nameLower of myChars) {
          updateGuildId.run(guildId, userId, realmSlug, serverType, nameLower);
        }
        for (const m of roster.members) {
          const nameLower = m.name.toLowerCase();
          if (myChars.has(nameLower) && m.rank) {
            updateGuildRank.run(m.rank, m.rank_index ?? null, userId, realmSlug, serverType, nameLower);
          }
        }
      } catch (err: unknown) {
        console.error(`Battle.net sync: DB error for guild ${guildName}:`, err);
      }
    }

    const totalChars = db.prepare("SELECT COUNT(*) as n FROM battle_net_characters WHERE user_id = ?")
      .get(userId) as { n: number };
    const realmCounts = db.prepare(
      `SELECT server_type, realm_slug, COUNT(*) as n FROM battle_net_characters WHERE user_id = ? GROUP BY server_type, realm_slug ORDER BY server_type, realm_slug`
    ).all(userId) as Array<{ server_type: string; realm_slug: string; n: number }>;
    const debugOutput = {
      fetchLog: debugLog,
      storedByRealm: realmCounts.reduce((acc, r) => {
        const key = r.server_type;
        if (!acc[key]) acc[key] = [] as Array<{ realm: string; count: number }>;
        acc[key].push({ realm: r.realm_slug, count: r.n });
        return acc;
      }, {} as Record<string, Array<{ realm: string; count: number }>>),
    };
    db.prepare(
      "UPDATE users SET last_sync_at = datetime('now'), last_sync_characters = ?, last_sync_error = NULL, last_sync_debug = ? WHERE id = ?"
    ).run(totalChars.n, JSON.stringify(debugOutput, null, 2), userId);

    return { guildsImported, charactersImported };
  } catch (err) {
    console.error("Battle.net sync error:", err);
    getDb().prepare(
      "UPDATE users SET last_sync_at = datetime('now'), last_sync_characters = 0, last_sync_error = ?, last_sync_debug = ? WHERE id = ?"
    ).run(String(err), JSON.stringify({ fetchLog: debugLog, storedByRealm: {}, error: String(err) }, null, 2), userId);
    return { guildsImported, charactersImported };
  }
}

/**
 * Sync a single character's guild from Blizzard API.
 * Used when viewing a character detail - ensures their guild is imported.
 */
export async function syncCharacterGuild(
  userId: number,
  characterId: number,
  region: string
): Promise<{ guild?: { id: number; name: string; server: string }; error?: string }> {
  const db = getDb();
  const row = db.prepare(
    `SELECT bnc.id, bnc.name, bnc.realm_slug, bnc.server_type, bnc.guild_id
     FROM battle_net_characters bnc
     WHERE bnc.id = ? AND bnc.user_id = ?`
  ).get(characterId, userId) as { name: string; realm_slug: string; server_type: string; guild_id: number | null } | undefined;

  if (!row) {
    return { error: "Character not found" };
  }

  try {
    const guildInfo = await fetchCharacterGuild(row.realm_slug, row.name, region, row.server_type);
    if (!guildInfo) {
      return {};
    }

    const roster = await fetchGuildRoster(region, guildInfo.realmSlug, guildInfo.guildName, row.server_type);
    const existing = db.prepare(
      "SELECT id, join_code FROM guilds WHERE name = ? AND server = ? AND server_type = ?"
    ).get(roster.name, roster.realm, row.server_type) as { id: number } | undefined;

    let guildId: number;
    if (existing) {
      guildId = existing.id;
      const memberExists = db.prepare("SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
      if (!memberExists) {
        db.prepare("INSERT INTO guild_members (guild_id, user_id, is_leader) VALUES (?, ?, 0)").run(guildId, userId);
      }
    } else {
      let code = generateCode();
      while (db.prepare("SELECT 1 FROM guilds WHERE join_code = ?").get(code)) {
        code = generateCode();
      }
      const result = db.prepare(
        "INSERT INTO guilds (name, server, server_type, join_code) VALUES (?, ?, ?, ?)"
      ).run(roster.name, roster.realm, row.server_type, code);
      guildId = result.lastInsertRowid as number;
      db.prepare("INSERT INTO guild_members (guild_id, user_id, is_leader) VALUES (?, ?, 0)").run(guildId, userId);
    }

    const insertChar = db.prepare(
      `INSERT OR IGNORE INTO characters (guild_id, name, class, role, user_id) VALUES (?, ?, ?, ?, ?)`
    );
    const updateOwner = db.prepare("UPDATE characters SET user_id = ? WHERE guild_id = ? AND name = ?");
    let myRank: string | null = null;
    let myRankIndex: number | null = null;
    for (const m of roster.members) {
      const isMine = m.name.toLowerCase() === row.name.toLowerCase();
      insertChar.run(guildId, m.name, m.class, m.role, isMine ? userId : null);
      if (isMine) {
        updateOwner.run(userId, guildId, m.name);
        myRank = m.rank ?? null;
        myRankIndex = m.rank_index ?? null;
      }
    }

    db.prepare(
      "UPDATE battle_net_characters SET guild_id = ? WHERE id = ? AND user_id = ?"
    ).run(guildId, characterId, userId);
    if (myRank || myRankIndex !== null) {
      db.prepare(
        "UPDATE battle_net_characters SET guild_rank = ?, guild_rank_index = ? WHERE id = ? AND user_id = ?"
      ).run(myRank ?? null, myRankIndex, characterId, userId);
    }

    const guild = db.prepare("SELECT id, name, server FROM guilds WHERE id = ?").get(guildId) as { id: number; name: string; server: string };
    return { guild };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("syncCharacterGuild error:", err);
    return { error: msg };
  }
}
