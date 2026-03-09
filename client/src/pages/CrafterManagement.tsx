import { useState, useEffect } from "react";
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

interface GuildMember {
  name: string;
  class: string;
  level: number;
  professions: string[];
  guild_profession_stars: string[];
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

  const [members, setMembers] = useState<GuildMember[]>([]);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [professionFilter, setProfessionFilter] = useState("");

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
      api.get<{ members: GuildMember[] }>(
        `/auth/me/guild-crafters-management?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => r.members ?? []),
    ])
      .then(([perms, list]) => {
        setPermissions(perms);
        setMembers(list);
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
        setMembers((prev) =>
          prev.map((m) => {
            if (m.name.toLowerCase() !== charName.toLowerCase()) return m;
            const stars = m.guild_profession_stars;
            const next = starred ? [...stars, professionType] : stars.filter((p) => p !== professionType);
            return { ...m, guild_profession_stars: next };
          })
        );
      })
      .catch(() => {});
  };

  const filteredMembers = members
    .filter((m) => {
      const q = searchQuery.trim().toLowerCase();
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (professionFilter) {
        const hasProf = m.professions.includes(professionFilter) || m.guild_profession_stars.includes(professionFilter);
        if (!hasProf) return false;
      }
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

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
            View all guild members and their professions. Star members as &quot;Guild Enchanter&quot;, &quot;Guild Alchemist&quot;, etc. Starred crafters appear in the Guild Crafters recipe search.
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
              <div className="flex flex-wrap gap-3 mb-6">
                <input
                  type="text"
                  placeholder="Search by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm min-w-[200px] focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
                <select
                  value={professionFilter}
                  onChange={(e) => setProfessionFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 [color-scheme:dark]"
                >
                  <option value="">All professions</option>
                  {PROFESSION_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              {members.length === 0 ? (
                <p className="text-slate-500">Guild roster could not be loaded from Blizzard.</p>
              ) : filteredMembers.length === 0 ? (
                <p className="text-slate-500">No members match the current filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-600/80">
                        <th className="text-left text-slate-400 font-medium py-3 pr-4">Member</th>
                        <th className="text-left text-slate-400 font-medium py-3 pr-4">Class</th>
                        <th className="text-left text-slate-400 font-medium py-3 pr-4">Level</th>
                        <th className="text-left text-slate-400 font-medium py-3 pr-4">Professions</th>
                        <th className="text-left text-slate-400 font-medium py-3">Star as Guild Crafter</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMembers.map((m) => (
                        <tr key={m.name} className="border-b border-slate-700/50 last:border-b-0">
                          <td className="py-3 pr-4 font-medium text-slate-200">{m.name}</td>
                          <td className="py-3 pr-4 text-slate-400">{m.class}</td>
                          <td className="py-3 pr-4 text-slate-400">{m.level}</td>
                          <td className="py-3 pr-4 text-slate-400">
                            {m.professions.length > 0 ? m.professions.join(", ") : "—"}
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-2">
                              {PROFESSION_TYPES.map((prof) => (
                                <button
                                  key={prof}
                                  type="button"
                                  onClick={() =>
                                    toggleProfessionStar(m.name, prof, !m.guild_profession_stars.includes(prof))
                                  }
                                  className={`text-xs px-2 py-0.5 rounded transition ${
                                    m.guild_profession_stars.includes(prof)
                                      ? "bg-amber-600/50 text-amber-200 hover:bg-amber-600/70"
                                      : "bg-slate-700/60 text-slate-400 hover:bg-slate-600/60 hover:text-slate-300"
                                  }`}
                                  title={
                                    m.guild_profession_stars.includes(prof)
                                      ? `Unstar as Guild ${prof}`
                                      : `Star as Guild ${prof}`
                                  }
                                >
                                  {prof} {m.guild_profession_stars.includes(prof) ? "★" : "☆"}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-slate-500 text-xs mt-4">
                Profession data comes from Raid Roster sync and recipe imports. You can star any guild member as a guild crafter for any profession.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
