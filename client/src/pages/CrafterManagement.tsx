import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import type { GuildPermissions } from "./GuildPermissions";

const PROFESSION_TYPES = [
  "Alchemy",
  "Blacksmithing",
  "Enchanting",
  "Engineering",
  "Herbalism",
  "Inscription",
  "Jewelcrafting",
  "Leatherworking",
  "Mining",
  "Skinning",
  "Tailoring",
];

interface RaiderEntry {
  character_name: string;
  character_class: string;
  professions?: string[];
  guild_profession_stars?: string[];
}

const DEFAULT_PERMISSIONS: GuildPermissions = {
  view_guild_dashboard: true,
  view_guild_roster: true,
  view_raid_roster: true,
  view_raid_schedule: true,
  manage_raids: true,
  manage_raid_roster: true,
  manage_permissions: true,
  manage_guild_crafters: true,
};

function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function CrafterManagement() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "Retail";

  const [raiders, setRaiders] = useState<RaiderEntry[]>([]);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");

  useEffect(() => {
    if (!realm || !guildName) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<{ permissions: GuildPermissions }>(
        `/auth/me/guild-permissions?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => r.permissions),
      api.get<{ raiders: RaiderEntry[] }>(
        `/auth/me/raider-roster?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => r.raiders ?? []),
    ])
      .then(([perms, list]) => {
        setPermissions(perms);
        setRaiders(list);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [realm, realmSlug, guildName, serverType]);

  const canManage = (permissions ?? DEFAULT_PERMISSIONS).manage_guild_crafters;

  const toggleProfessionStar = (charName: string, professionType: string, starred: boolean) => {
    if (!canManage) return;
    api
      .put("/auth/me/guild-profession-star", {
        realm: realmSlug,
        guild_name: guildName,
        server_type: serverType,
        character_name: charName,
        profession_type: professionType,
        starred,
      })
      .then(() => {
        setRaiders((prev) =>
          prev.map((r) => {
            if (r.character_name.toLowerCase() !== charName.toLowerCase()) return r;
            const stars = r.guild_profession_stars ?? [];
            const next = starred ? [...stars, professionType] : stars.filter((p) => p !== professionType);
            return { ...r, guild_profession_stars: next };
          })
        );
      })
      .catch(() => {});
  };

  const professionTypesForRoster = useMemo(() => {
    const set = new Set<string>();
    for (const r of raiders) {
      for (const p of r.professions ?? []) set.add(p);
      for (const p of r.guild_profession_stars ?? []) set.add(p);
    }
    return [...PROFESSION_TYPES].filter((p) => set.has(p));
  }, [raiders]);

  if (!realm || !guildName) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">Missing realm or guild name.</p>
        </main>
      </div>
    );
  }

  if (!loading && !canManage) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">You do not have permission to manage guild crafters.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
      <main className="max-w-6xl mx-auto px-4 py-8">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Crafter Management" />

        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-sky-400">Crafter Management</h1>
          <p className="text-slate-400 text-sm mt-1">
            {guildName} · {capitalizeRealm(realm)} · {serverType}
          </p>
          <p className="text-slate-500 text-sm mt-2">
            Star guild members as &quot;Guild Enchanter&quot;, &quot;Guild Alchemist&quot;, etc. Starred crafters appear in the Guild Crafters recipe search for members.
          </p>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : error ? (
          <p className="text-amber-500">{error}</p>
        ) : (
          <div
            className="rounded-xl border border-white/[0.05] overflow-hidden"
            style={{
              background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <div className="p-6">
              {raiders.length === 0 ? (
                <p className="text-slate-500">No raid roster entries yet. Add characters to the Raid Roster first.</p>
              ) : professionTypesForRoster.length === 0 ? (
                <p className="text-slate-500">
                  No professions on the roster. Use &quot;Sync from Blizzard&quot; in Raid Management or add professions manually.
                </p>
              ) : (
                <div className="space-y-4">
                  {professionTypesForRoster.map((prof: string) => {
                    const starred = raiders.filter((r) => r.guild_profession_stars?.includes(prof));
                    const hasProf = raiders.filter(
                      (r) => r.professions?.includes(prof) || r.guild_profession_stars?.includes(prof)
                    );
                    return (
                      <div key={prof} className="rounded-lg border border-slate-600/60 p-4 bg-slate-800/40">
                        <h3 className="font-medium text-slate-200 mb-2">
                          {prof}
                          {starred.length > 0 && (
                            <span className="ml-2 text-amber-400 text-sm font-normal">
                              — {starred.map((s) => s.character_name).join(", ")} (Guild {prof}{starred.length > 1 ? "s" : ""})
                            </span>
                          )}
                        </h3>
                        <div className="flex flex-wrap gap-2 text-sm">
                          {hasProf.map((r) => (
                            <button
                              key={r.character_name}
                              type="button"
                              onClick={() =>
                                toggleProfessionStar(r.character_name, prof, !r.guild_profession_stars?.includes(prof))
                              }
                              className={`px-2 py-0.5 rounded transition ${
                                r.guild_profession_stars?.includes(prof)
                                  ? "bg-amber-600/50 text-amber-200 hover:bg-amber-600/70"
                                  : "bg-slate-700/60 text-slate-300 hover:bg-slate-600/60"
                              }`}
                              title={
                                r.guild_profession_stars?.includes(prof)
                                  ? `Unstar as Guild ${prof}`
                                  : `Star as Guild ${prof}`
                              }
                            >
                              {r.character_name} {r.guild_profession_stars?.includes(prof) && "★"}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
