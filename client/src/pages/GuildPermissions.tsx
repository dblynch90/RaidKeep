import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";

function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export type GuildPermissionKey =
  | "view_guild_dashboard"
  | "view_guild_roster"
  | "view_raid_roster"
  | "view_raid_schedule"
  | "manage_raids"
  | "manage_raid_roster"
  | "manage_permissions"
  | "manage_guild_crafters";

export const GUILD_PERMISSION_LABELS: Record<GuildPermissionKey, string> = {
  view_guild_dashboard: "View Guild Dashboard",
  view_guild_roster: "View Guild Roster",
  view_raid_roster: "View Raid Composition",
  view_raid_schedule: "View Raid Schedule",
  manage_raids: "Manage Raids",
  manage_raid_roster: "Manage Raid Team",
  manage_permissions: "Manage Permissions",
  manage_guild_crafters: "Manage Guild Professions",
};

export type GuildPermissions = Record<GuildPermissionKey, boolean>;

export type GuildPermissionConfig = Record<string, GuildPermissions>;

const RANK_LABELS: Record<string, string> = {
  rank_0: "Rank 0 (Guild Master)",
  rank_1: "Rank 1",
  rank_2: "Rank 2",
  rank_3: "Rank 3",
  rank_4: "Rank 4",
  rank_5: "Rank 5",
  rank_6: "Rank 6",
  rank_7: "Rank 7",
  rank_8: "Rank 8",
  rank_9: "Rank 9",
};

export function GuildPermissions() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "TBC Anniversary";

  const [config, setConfig] = useState<GuildPermissionConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<GuildPermissionConfig | null>(null);
  const [characterOverrides, setCharacterOverrides] = useState<Array<{ character_name: string; permissions: Record<string, boolean> }>>([]);
  const [savedCharacterOverrides, setSavedCharacterOverrides] = useState<Array<{ character_name: string; permissions: Record<string, boolean> }>>([]);
  const [guildMembers, setGuildMembers] = useState<Array<{ name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChar, setSelectedChar] = useState("");

  const fetchConfig = () => {
    if (!realm || !guildName) return;
    setLoading(true);
    setError(null);
    api
      .get<{ config: GuildPermissionConfig; character_overrides?: Array<{ character_name: string; permissions: Record<string, boolean> }> }>(
        `/auth/me/guild-permissions-config?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then((r) => {
        setConfig(r.config);
        setSavedConfig(r.config);
        setCharacterOverrides(r.character_overrides ?? []);
        setSavedCharacterOverrides(r.character_overrides ?? []);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setConfig(null);
        setCharacterOverrides([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!realm || !guildName) return;
    fetchConfig();
  }, [realm, realmSlug, guildName, serverType]);

  useEffect(() => {
    if (!realm || !guildName) return;
    api
      .get<{ members: Array<{ name: string }> }>(
        `/auth/me/guild-roster?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then((r) => setGuildMembers(r.members ?? []))
      .catch(() => setGuildMembers([]));
  }, [realmSlug, guildName, serverType]);

  const handleToggle = (rankKey: string, permKey: GuildPermissionKey, value: boolean) => {
    if (!config) return;
    const next = { ...config };
    if (!next[rankKey]) next[rankKey] = {} as GuildPermissions;
    next[rankKey] = { ...next[rankKey], [permKey]: value };
    setConfig(next);
  };

  const overrideNames = new Set(characterOverrides.map((o) => o.character_name.toLowerCase()));
  const availableMembers = guildMembers.filter((m) => !overrideNames.has(m.name.toLowerCase()));

  const handleAddCharacter = () => {
    const name = selectedChar.trim();
    if (!name) return;
    const existing = characterOverrides.some((o) => o.character_name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setSelectedChar("");
      return;
    }
    setCharacterOverrides((prev) => [...prev, { character_name: name, permissions: {} }]);
    setSelectedChar("");
  };

  const handleCharOverrideToggle = (characterName: string, permKey: GuildPermissionKey, value: boolean) => {
    setCharacterOverrides((prev) =>
      prev.map((o) =>
        o.character_name.toLowerCase() === characterName.toLowerCase()
          ? { ...o, permissions: { ...o.permissions, [permKey]: value } }
          : o
      )
    );
  };

  const handleRemoveCharOverride = (characterName: string) => {
    setCharacterOverrides((prev) => prev.filter((o) => o.character_name.toLowerCase() !== characterName.toLowerCase()));
  };

  const overridesKey = (arr: Array<{ character_name: string; permissions: Record<string, boolean> }>) =>
    JSON.stringify([...arr].sort((a, b) => a.character_name.localeCompare(b.character_name)));
  const hasUnsavedChanges =
    !!config &&
    (JSON.stringify(config) !== JSON.stringify(savedConfig) || overridesKey(characterOverrides) !== overridesKey(savedCharacterOverrides));

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await api.put<{ config: GuildPermissionConfig }>("/auth/me/guild-permissions-config", {
        realm: realmSlug,
        guild_name: guildName,
        server_type: serverType,
        config,
      });
      setSavedConfig(config);
      const currentNames = new Set(characterOverrides.map((o) => o.character_name.toLowerCase()));
      for (const o of savedCharacterOverrides) {
        const nameLower = o.character_name.toLowerCase();
        if (!currentNames.has(nameLower)) {
          await api.delete(
            `/auth/me/guild-character-overrides?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}&character_name=${encodeURIComponent(o.character_name)}`
          );
        }
      }
      for (const o of characterOverrides) {
        await api.put("/auth/me/guild-character-overrides", {
          realm: realmSlug,
          guild_name: guildName,
          server_type: serverType,
          character_name: o.character_name,
          permissions: o.permissions,
        });
      }
      setSavedCharacterOverrides(characterOverrides.map((o) => ({ ...o })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!realm || !guildName) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">Missing realm or guild name.</p>
        </main>
      </div>
    );
  }

  const permKeys = Object.keys(GUILD_PERMISSION_LABELS) as GuildPermissionKey[];
  const rankKeys = ["rank_0", "rank_1", "rank_2", "rank_3", "rank_4", "rank_5", "rank_6", "rank_7", "rank_8", "rank_9"];

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
      <main className="max-w-6xl mx-auto px-4 py-8">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Guild Permissions" />

        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-sky-400">Guild Permissions</h1>
          <p className="text-slate-400 text-sm mt-1">
            {guildName} · {capitalizeRealm(realm)} · {serverType}
          </p>
          <p className="text-slate-500 text-sm mt-2">
            Access is controlled by guild rank. Rank 0 is Guild Master (highest). Configure which features each rank can use.
          </p>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : error ? (
          <p className="text-amber-500">{error}</p>
        ) : config ? (
          <div
            className="rounded-xl border border-white/[0.05] overflow-hidden"
            style={{
              background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <div className="p-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-600/80">
                    <th className="text-left text-slate-400 font-medium py-3 pr-6">Rank</th>
                    {permKeys.map((pk) => (
                      <th key={pk} className="text-left text-slate-400 font-medium py-3 px-2 min-w-[120px]">
                        {GUILD_PERMISSION_LABELS[pk]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rankKeys.map((rk) => (
                    <tr key={rk} className="border-b border-slate-700/50 last:border-b-0">
                      <td className="py-3 pr-6 font-medium text-slate-200">
                        {RANK_LABELS[rk] ?? rk}
                      </td>
                      {permKeys.map((pk) => (
                        <td key={pk} className="py-3 px-2">
                          <label className="flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!config[rk]?.[pk]}
                              onChange={(e) => handleToggle(rk, pk, e.target.checked)}
                              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-800"
                            />
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Character Overrides */}
            <div className="p-6 border-t border-slate-700/60">
              <h3 className="font-semibold text-sky-400 mb-2">Character Overrides</h3>
              <p className="text-slate-500 text-sm mb-4">
                Grant specific permissions to individual characters, regardless of their guild rank. Overrides are merged with rank-based permissions. Only guild members can be added.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                <select
                  value={selectedChar}
                  onChange={(e) => setSelectedChar(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm min-w-[180px] focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                >
                  <option value="">Select character from guild...</option>
                  {availableMembers
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
                    .map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddCharacter}
                  disabled={!selectedChar.trim()}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm border border-sky-500/50"
                >
                  Add Character
                </button>
              </div>
              {guildMembers.length === 0 && (
                <p className="text-slate-500 text-sm mb-4">Guild roster unavailable. Sync your characters or ensure the guild exists in-game.</p>
              )}
              {characterOverrides.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-600/80">
                        <th className="text-left text-slate-400 font-medium py-3 pr-6">Character</th>
                        {permKeys.map((pk) => (
                          <th key={pk} className="text-left text-slate-400 font-medium py-3 px-2 min-w-[100px]">
                            {GUILD_PERMISSION_LABELS[pk]}
                          </th>
                        ))}
                        <th className="text-left text-slate-400 font-medium py-3 pl-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {characterOverrides.map((o) => (
                        <tr key={o.character_name} className="border-b border-slate-700/50 last:border-b-0">
                          <td className="py-3 pr-6 font-medium text-slate-200">{o.character_name}</td>
                          {permKeys.map((pk) => (
                            <td key={pk} className="py-3 px-2">
                              <label className="flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!o.permissions[pk]}
                                  onChange={(e) => handleCharOverrideToggle(o.character_name, pk, e.target.checked)}
                                  className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-800"
                                />
                              </label>
                            </td>
                          ))}
                          <td className="py-3 pl-2">
                            <button
                              type="button"
                              onClick={() => handleRemoveCharOverride(o.character_name)}
                              className="text-slate-500 hover:text-red-400 text-xs"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-slate-500 text-sm">No character overrides. Add a character above to set custom permissions.</p>
              )}
            </div>

            <div className="p-6 border-t border-slate-700/60 flex items-center gap-4">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !hasUnsavedChanges}
                className="px-6 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm border border-sky-500/50"
              >
                {saving ? "Saving..." : "Save Permissions"}
              </button>
              {hasUnsavedChanges && !saving && (
                <span className="text-slate-500 text-sm">You have unsaved changes</span>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
