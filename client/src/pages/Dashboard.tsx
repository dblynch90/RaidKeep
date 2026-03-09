import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { MyCharacter } from "../api";
import type { GuildPermissions } from "./GuildPermissions";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { RaidCard } from "../components/RaidCard";

const GAME_VERSIONS = [
  "Retail",
  "Classic Era",
  "Classic Hardcore",
  "TBC Anniversary",
  "MOP Classic",
  "Seasons of Discovery",
];

const ALLIANCE_RACES = ["Human", "Dwarf", "Night Elf", "Gnome", "Draenei", "Worgen", "Void Elf", "Lightforged Draenei", "Dark Iron Dwarf", "Kul Tiran", "Mechagnome"];
const HORDE_RACES = ["Orc", "Undead", "Tauren", "Troll", "Blood Elf", "Goblin", "Nightborne", "Highmountain Tauren", "Mag'har Orc", "Zandalari Troll", "Vulpera"];

function getFactionFromRace(race: string | undefined): "Alliance" | "Horde" | "Other" {
  if (!race) return "Other";
  if (ALLIANCE_RACES.includes(race)) return "Alliance";
  if (HORDE_RACES.includes(race)) return "Horde";
  return "Other";
}

const CLASS_COLORS: Record<string, string> = {
  Warrior: "#C69B6D",
  Paladin: "#F58CBA",
  Hunter: "#AAD372",
  Rogue: "#FFF569",
  Priest: "#FFFFFF",
  "Death Knight": "#C41E3A",
  Shaman: "#0070DD",
  Mage: "#3FC7EB",
  Warlock: "#8788EE",
  Monk: "#00FF98",
  Druid: "#FF7D0A",
  "Demon Hunter": "#A330C9",
  Evoker: "#33937F",
};

function getClassColor(className: string): string {
  return CLASS_COLORS[className] ?? "#6B7280";
}

function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

interface SavedRaid {
  id: number;
  raid_name: string;
  raid_instance?: string;
  raid_date: string;
  start_time?: string | null;
  finish_time?: string | null;
  guild_name: string;
  guild_realm_slug: string;
  server_type: string;
  slot_counts?: { total: number; filled: number; tanks: number; healers: number; dps: number };
  raid_status?: string;
  my_characters?: Array<{ character_name: string; character_class: string; role?: string }>;
}

type FavoriteGuild = { guildName: string; realmSlug: string; serverType: string };

function favKey(g: { guildName: string; realmSlug: string; serverType: string }) {
  return `${g.guildName.toLowerCase()}|${g.realmSlug.toLowerCase()}|${g.serverType}`;
}

const SYNC_RECENT_MS = 5 * 60 * 1000; // 5 min
function isSyncRecent(lastSyncAt: string | null): boolean {
  if (!lastSyncAt) return false;
  const syncTime = new Date(lastSyncAt).getTime();
  return Date.now() - syncTime < SYNC_RECENT_MS;
}

const SYNC_PENDING_KEY = "raidkeep_login_sync_started";

/** Returns true if sync completed after this login (for post-login flow) */
function isSyncCompleteAfterLogin(lastSyncAt: string | null, loginStartedAt: number): boolean {
  if (!lastSyncAt) return false;
  const syncTime = new Date(lastSyncAt).getTime();
  return syncTime >= loginStartedAt - 5000; // 5s tolerance
}

function isGuildMaster(c: MyCharacter): boolean {
  return (
    c.is_guild_leader === true ||
    c.guild_rank === "0" ||
    (typeof c.guild_rank === "string" && c.guild_rank.toLowerCase().includes("master"))
  );
}

function GuildCard({
  guildName,
  realm,
  realmSlug,
  serverType,
  characters,
  isFavorite,
  onToggleFavorite,
  canViewDashboard,
  guildsSynced,
}: {
  guildName: string;
  realm: string;
  realmSlug: string;
  serverType: string;
  characters: MyCharacter[];
  isFavorite: boolean;
  onToggleFavorite: () => void;
  canViewDashboard: boolean;
  guildsSynced: boolean;
}) {
  const guildDashboardUrl = `/guild-dashboard?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
  const dashboardReady = canViewDashboard && guildsSynced;
  return (
    <div
      className="block rounded-xl border border-white/[0.05] hover:border-sky-600/50 transition overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      }}
    >
      <div className="p-4 relative">
        <button
          type="button"
          onClick={onToggleFavorite}
          className="absolute top-3 right-3 p-1.5 rounded hover:bg-slate-700 transition z-10"
          title={isFavorite ? "Unfavorite" : "Favorite"}
        >
          {isFavorite ? <span className="text-sky-400">★</span> : <span className="text-slate-500 hover:text-sky-400/70">☆</span>}
        </button>
        <div className="pr-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium text-sky-400">{guildName}</span>
            <span className="text-slate-500 text-sm">({capitalizeRealm(realm)})</span>
          </div>
          {canViewDashboard ? (
            dashboardReady ? (
              <Link
                to={guildDashboardUrl}
                className="inline-flex items-center gap-1 text-sm text-sky-400/90 hover:text-sky-400 mb-3"
                aria-label={`Open ${guildName} dashboard`}
              >
                {guildName} Dashboard →
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm text-slate-500 cursor-not-allowed mb-3" title="Guild data is still syncing. Please wait...">
                {guildName} Dashboard →
              </span>
            )
          ) : (
            <div className="mb-3" />
          )}
          <ul className="space-y-1">
            {characters.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 text-sm">
                <span>
                  <span style={{ color: getClassColor(c.class) }} className="font-medium">{c.name}</span>
                  {isGuildMaster(c) && <span className="ml-1.5 text-sky-500" title="Guild Master">★</span>}
                </span>
                <span className="text-slate-400 text-xs shrink-0">
                  {(() => {
                    const name = c.guild_rank?.trim();
                    const num = c.guild_rank_index;
                    // Prefer friendly name when it looks like one (not just a digit)
                    if (name && name !== String(num)) return name;
                    // Fallback when API only gave us the index
                    if (num != null) return `Rank ${num}`;
                    return name || "—";
                  })()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [gameVersion, setGameVersion] = useState("");
  const [favoriteGuilds, setFavoriteGuilds] = useState<FavoriteGuild[]>([]);
  const [allCharacters, setAllCharacters] = useState<MyCharacter[]>([]);
  const [myAssignmentRaids, setMyAssignmentRaids] = useState<SavedRaid[]>([]);
  const [guildPermissions, setGuildPermissions] = useState<Record<string, GuildPermissions>>({});
  const [loading, setLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [guildsSynced, setGuildsSynced] = useState(false);
  const [characterFactionFilter, setCharacterFactionFilter] = useState<string>("");
  const [characterRealmFilter, setCharacterRealmFilter] = useState<string>("");
  const syncedVersionsRef = useRef<Set<string>>(new Set());

  const fetchPreferences = () =>
    api.get<{ preferences: Record<string, string> }>("/auth/me/preferences").then((res) => {
      if (res.preferences.game_version) setGameVersion(res.preferences.game_version);
      try {
        const favs = res.preferences.favorite_guilds ? JSON.parse(res.preferences.favorite_guilds) : [];
        setFavoriteGuilds(Array.isArray(favs) ? favs : []);
      } catch {
        setFavoriteGuilds([]);
      }
      return res;
    });

  const savePreferences = (updates: { game_version?: string; favorite_guilds?: FavoriteGuild[] }) => {
    api
      .get<{ preferences: Record<string, string> }>("/auth/me/preferences")
      .then((res) => {
        const next: Record<string, string> = { ...res.preferences };
        if (updates.game_version !== undefined) next.game_version = updates.game_version;
        if (updates.favorite_guilds !== undefined) next.favorite_guilds = JSON.stringify(updates.favorite_guilds);
        return api.put("/auth/me/preferences", { preferences: next });
      })
      .catch(() => {});
  };

  const toggleFavorite = (guild: { guildName: string; realmSlug: string; serverType: string }) => {
    const key = favKey(guild);
    const isFav = favoriteGuilds.some((f) => favKey(f) === key);
    const next = isFav ? favoriteGuilds.filter((f) => favKey(f) !== key) : [...favoriteGuilds, guild];
    setFavoriteGuilds(next);
    savePreferences({ favorite_guilds: next });
  };

  const isFavorite = (guild: { guildName: string; realmSlug: string; serverType: string }) =>
    favoriteGuilds.some((f) => favKey(f) === favKey(guild));

  const fetchCharacters = (serverType?: string) => {
    const url = serverType ? `/auth/me/characters?server_type=${encodeURIComponent(serverType)}` : "/auth/me/characters";
    return api
      .get<{ characters: MyCharacter[]; syncStatus?: { lastSyncAt: string | null } }>(url)
      .then((res) => {
        setAllCharacters(res.characters);
        setGuildsSynced(isSyncRecent(res.syncStatus?.lastSyncAt ?? null));
        return res;
      });
  };

  useEffect(() => {
    let retries = 0;
    const maxRetries = 3;
    const retryDelay = 2000;
    const syncPollInterval = 2000;
    const syncPollMax = 120000; // 2 min max wait for sync

    const load = async () => {
      setLoading(true);
      const loginSyncStarted = (() => {
        const raw = sessionStorage.getItem(SYNC_PENDING_KEY);
        if (!raw) return null;
        const n = parseInt(raw, 10);
        return isNaN(n) ? null : n;
      })();

      try {
        const prefsRes = await fetchPreferences().catch(() => ({ preferences: {} }));
        const prefs = prefsRes.preferences ?? {};
        const gameVersion = (prefs as Record<string, string>).game_version?.trim();
        const serverType = gameVersion && gameVersion !== "Please Select" ? gameVersion : undefined;

        const [charsRes, raidsRes] = await Promise.all([
          fetchCharacters(serverType).catch(() => ({ characters: [], syncStatus: { lastSyncAt: null } })),
          api
            .get<{ raids: SavedRaid[] }>(
              serverType
                ? `/auth/me/saved-raids/my-assignments?server_type=${encodeURIComponent(serverType)}`
                : "/auth/me/saved-raids/my-assignments"
            )
            .catch(() => ({ raids: [] })),
        ]);
        setMyAssignmentRaids(raidsRes.raids ?? []);
        if ((charsRes.characters?.length ?? 0) === 0 && retries < maxRetries) {
          retries++;
          setTimeout(load, retryDelay);
          return;
        }

        const lastSync = charsRes.syncStatus?.lastSyncAt ?? null;
        const needToPoll =
          (charsRes.characters?.length ?? 0) > 0 &&
          (loginSyncStarted !== null
            ? !isSyncCompleteAfterLogin(lastSync, loginSyncStarted)
            : !isSyncRecent(lastSync));

        if (needToPoll) {
          const syncStart = Date.now();
          const pollSync = async () => {
            while (Date.now() - syncStart < syncPollMax) {
              const r = await api
                .get<{ syncStatus?: { lastSyncAt: string | null } }>("/auth/me/characters")
                .catch(() => ({ syncStatus: { lastSyncAt: null } }));
              const ls = r.syncStatus?.lastSyncAt ?? null;
              const done =
                loginSyncStarted !== null
                  ? isSyncCompleteAfterLogin(ls, loginSyncStarted)
                  : isSyncRecent(ls);
              if (done) {
                if (loginSyncStarted !== null) sessionStorage.removeItem(SYNC_PENDING_KEY);
                setGuildsSynced(true);
                return;
              }
              await new Promise((r) => setTimeout(r, syncPollInterval));
            }
            sessionStorage.removeItem(SYNC_PENDING_KEY);
            setGuildsSynced(true);
          };
          await pollSync();
        } else {
          if (loginSyncStarted !== null) sessionStorage.removeItem(SYNC_PENDING_KEY);
        }
      } finally {
        setLoading(false);
        setInitialLoadDone(true);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!initialLoadDone || !gameVersion || gameVersion === "Please Select") return;
    const hasDataForVersion = allCharacters.some((c) => (c.server_type ?? "Retail") === gameVersion);
    if (hasDataForVersion) return;
    const v = gameVersion;
    setLoading(true);
    const loadForVersion = (ver: string) =>
      Promise.all([
        api.get<{ characters: MyCharacter[]; syncStatus?: { lastSyncAt: string | null } }>(`/auth/me/characters?server_type=${encodeURIComponent(ver)}`),
        api.get<{ raids: SavedRaid[] }>(`/auth/me/saved-raids/my-assignments?server_type=${encodeURIComponent(ver)}`),
      ]);
    loadForVersion(v)
      .then(async ([charsRes, raidsRes]) => {
        setAllCharacters(charsRes.characters ?? []);
        setMyAssignmentRaids(raidsRes.raids ?? []);
        // New user / uncached version: fetch returned empty, trigger on-demand sync
        if ((charsRes.characters?.length ?? 0) === 0 && !syncedVersionsRef.current.has(v)) {
          syncedVersionsRef.current.add(v);
          try {
            await api.post<{ ok: boolean }>("/auth/me/sync", { server_type: v });
            const [afterChars, afterRaids] = await loadForVersion(v);
            setAllCharacters(afterChars.characters ?? []);
            setMyAssignmentRaids(afterRaids.raids ?? []);
          } catch {
            syncedVersionsRef.current.delete(v);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [initialLoadDone, gameVersion]);

  const filteredCharacters = useMemo(() => {
    if (!gameVersion) return [];
    return allCharacters.filter((c) => c.server_type === gameVersion);
  }, [allCharacters, gameVersion]);

  const guildsByRealm = useMemo(() => {
    const guildMap = new Map<string, MyCharacter[]>();
    for (const c of filteredCharacters) {
      if (!c.guild_name?.trim()) continue;
      const key = `${c.guild_name}|${c.realm}|${c.server_type}`;
      const list = guildMap.get(key) ?? [];
      list.push(c);
      guildMap.set(key, list);
    }
    const result: Array<{ guildName: string; realm: string; realmSlug: string; serverType: string; characters: MyCharacter[] }> = [];
    for (const [, chars] of guildMap) {
      const first = chars[0]!;
      const realmSlug = first.realm_slug ?? (first.realm ?? "").toLowerCase().replace(/\s+/g, "-");
      result.push({
        guildName: first.guild_name,
        realm: first.realm || "Unknown",
        realmSlug,
        serverType: first.server_type ?? "Retail",
        characters: chars,
      });
    }
    return result.sort((a, b) => a.guildName.localeCompare(b.guildName, undefined, { sensitivity: "base" }));
  }, [filteredCharacters]);

  const favoritedGuildsInView = useMemo(() => {
    const result: Array<{ guildName: string; realm: string; realmSlug: string; serverType: string; characters: MyCharacter[] }> = [];
    for (const fav of favoriteGuilds) {
      const matchingChars = allCharacters.filter(
        (c) =>
          c.guild_name &&
          (c.realm_slug ?? (c.realm ?? "").toLowerCase().replace(/\s+/g, "-")) === fav.realmSlug &&
          c.guild_name === fav.guildName &&
          (c.server_type ?? "Retail") === fav.serverType
      );
      const realmDisplay = matchingChars[0]?.realm ?? fav.realmSlug.replace(/-/g, " ");
      result.push({
        guildName: fav.guildName,
        realm: realmDisplay,
        realmSlug: fav.realmSlug,
        serverType: fav.serverType,
        characters: matchingChars,
      });
    }
    return result.sort((a, b) => a.guildName.localeCompare(b.guildName, undefined, { sensitivity: "base" }));
  }, [allCharacters, favoriteGuilds]);

  const allGuildCards = useMemo(() => {
    const favKeys = new Set(favoritedGuildsInView.map((g) => favKey(g)));
    const otherGuilds = guildsByRealm.filter((g) => !favKeys.has(favKey(g)));
    return [...favoritedGuildsInView, ...otherGuilds];
  }, [favoritedGuildsInView, guildsByRealm]);

  useEffect(() => {
    if (allGuildCards.length === 0) return;
    const fetchPerms = async () => {
      const results = await Promise.allSettled(
        allGuildCards.map((g) =>
          api.get<{ permissions: GuildPermissions }>(
            `/auth/me/guild-permissions?realm=${encodeURIComponent(g.realmSlug)}&guild_name=${encodeURIComponent(g.guildName)}&server_type=${encodeURIComponent(g.serverType)}`
          )
        )
      );
      const next: Record<string, GuildPermissions> = {};
      allGuildCards.forEach((g, i) => {
        const r = results[i];
        if (r?.status === "fulfilled") next[favKey(g)] = r.value.permissions;
      });
      setGuildPermissions((prev) => ({ ...prev, ...next }));
    };
    fetchPerms();
  }, [allGuildCards]);

  const today = new Date().toISOString().slice(0, 10);
  const upcomingRaids = myAssignmentRaids
    .filter((r) => r.raid_date >= today)
    .sort((a, b) => a.raid_date.localeCompare(b.raid_date) || (a.start_time || "").localeCompare(b.start_time || ""));
  const pastRaids = myAssignmentRaids
    .filter((r) => r.raid_date < today)
    .sort((a, b) => b.raid_date.localeCompare(a.raid_date) || (b.start_time || "").localeCompare(a.start_time || ""));

  const characterRealms = useMemo(() => {
    const set = new Set(filteredCharacters.map((c) => c.realm || "Unknown"));
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [filteredCharacters]);

  const filteredCharactersForList = useMemo(() => {
    let list = filteredCharacters;
    if (characterFactionFilter) {
      list = list.filter((c) => getFactionFromRace(c.race) === characterFactionFilter);
    }
    if (characterRealmFilter) {
      list = list.filter((c) => (c.realm || "Unknown") === characterRealmFilter);
    }
    return list.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));
  }, [filteredCharacters, characterFactionFilter, characterRealmFilter]);

  const hasSelection = !!gameVersion && gameVersion !== "Please Select";

  const cardBaseStyle = {
    background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  };

  if (!initialLoadDone) {
    return <LoadingOverlay message="Loading Data from Battle.net" />;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-8">
          <span className="text-slate-400 text-sm font-medium">Game Version</span>
          <select
            value={gameVersion}
            onChange={(e) => {
              const v = e.target.value;
              setGameVersion(v);
              savePreferences({ game_version: v });
            }}
            className="px-3 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
          >
            <option value="">Please Select</option>
            {GAME_VERSIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {/* My Guilds */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-slate-200 mb-4">
            My Guilds
          </h2>
          {!hasSelection ? (
            <p className="text-slate-500 text-sm py-4">Select a game version to see your guilds.</p>
          ) : loading ? (
            <p className="text-slate-500 text-sm py-4">Loading...</p>
          ) : allGuildCards.length === 0 ? (
            <p className="text-slate-500 text-sm py-4">No guilds found for {gameVersion}.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allGuildCards.map((g) => (
                <GuildCard
                  key={favKey(g)}
                  guildName={g.guildName}
                  realm={g.realm}
                  realmSlug={g.realmSlug}
                  serverType={g.serverType}
                  characters={g.characters}
                  isFavorite={isFavorite(g)}
                  onToggleFavorite={() => toggleFavorite(g)}
                  canViewDashboard={guildPermissions[favKey(g)]?.view_guild_dashboard ?? true}
                  guildsSynced={guildsSynced}
                />
              ))}
            </div>
          )}
        </section>

        {/* My Raids */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-slate-200 mb-4">My Raids</h2>
          {myAssignmentRaids.length === 0 ? (
            <p className="text-slate-500 text-sm py-4">You are not assigned to any raids.</p>
          ) : (
            <>
              {upcomingRaids.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-slate-400 font-medium text-sm uppercase tracking-wider mb-3">Upcoming</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {upcomingRaids.map((r) => (
                      <RaidCard key={r.id} raid={r} isAssigned baseUrl="/raid" />
                    ))}
                  </div>
                </div>
              )}
              {pastRaids.length > 0 && (
                <div>
                  <h3 className="text-slate-400 font-medium text-sm uppercase tracking-wider mb-3">Past Raids</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pastRaids.map((r) => (
                      <RaidCard key={r.id} raid={r} isAssigned baseUrl="/raid" />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* My Characters */}
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4">My Characters</h2>
          {!hasSelection ? (
            <p className="text-slate-500 text-sm py-4">Select a game version to see your characters.</p>
          ) : loading ? (
            <p className="text-slate-500 text-sm py-4">Loading characters...</p>
          ) : filteredCharacters.length === 0 ? (
            <p className="text-slate-500 text-sm py-4">No characters found for {gameVersion}.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-sm">Faction:</span>
                  <select
                    value={characterFactionFilter}
                    onChange={(e) => setCharacterFactionFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500/50"
                  >
                    <option value="">All</option>
                    <option value="Alliance">Alliance</option>
                    <option value="Horde">Horde</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-sm">Server:</span>
                  <select
                    value={characterRealmFilter}
                    onChange={(e) => setCharacterRealmFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500/50"
                  >
                    <option value="">All realms</option>
                    {characterRealms.map((realm) => (
                      <option key={realm} value={realm}>
                        {capitalizeRealm(realm)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div
                className="rounded-xl border border-white/[0.05] overflow-hidden"
                style={cardBaseStyle}
              >
                {filteredCharactersForList.length === 0 ? (
                  <p className="text-slate-500 text-sm p-4">No characters match the filters.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-600/80">
                          <th className="text-left text-slate-400 font-medium text-sm px-4 py-3">Name</th>
                          <th className="text-left text-slate-400 font-medium text-sm px-4 py-3">Race</th>
                          <th className="text-left text-slate-400 font-medium text-sm px-4 py-3">Class</th>
                          <th className="text-left text-slate-400 font-medium text-sm px-4 py-3">Level</th>
                          <th className="text-left text-slate-400 font-medium text-sm px-4 py-3">Server</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCharactersForList.map((c) => (
                          <tr key={c.id} className="border-b border-slate-700/50 last:border-b-0 hover:bg-slate-700/30">
                            <td className="px-4 py-2.5">
                              <span className="font-medium text-slate-100">{c.name}</span>
                              {isGuildMaster(c) && <span className="ml-2 inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-sky-500/20 text-sky-400 border border-sky-500/40" title="Guild Master">GM</span>}
                            </td>
                            <td className="px-4 py-2.5 text-slate-300">{c.race || "—"}</td>
                            <td className="px-4 py-2.5">
                              <span style={{ color: getClassColor(c.class) }}>{c.class || "—"}</span>
                            </td>
                            <td className="px-4 py-2.5 text-slate-300">{c.level ?? 1}</td>
                            <td className="px-4 py-2.5 text-slate-300">{capitalizeRealm(c.realm || "—")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
