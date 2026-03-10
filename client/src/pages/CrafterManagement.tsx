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
  profession_notes?: string;
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
  const [tbcManual, setTbcManual] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [professionFilter, setProfessionFilter] = useState("");
  const [addingCrafter, setAddingCrafter] = useState(false);
  const [newCrafter, setNewCrafter] = useState({ character_name: "", professions: [] as string[], profession_notes: "" });
  const [editingCrafter, setEditingCrafter] = useState<GuildMember | null>(null);

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
      api.get<{ members: GuildMember[]; tbc_manual?: boolean }>(
        `/auth/me/guild-crafters-management?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => {
        setTbcManual(r.tbc_manual ?? false);
        return r.members ?? [];
      }),
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

  const addCrafter = () => {
    if (!newCrafter.character_name.trim()) return;
    api
      .post("/auth/me/guild-crafter", {
        realm: realmSlug,
        guild_name: guildName,
        server_type: serverType,
        character_name: newCrafter.character_name.trim(),
        professions: newCrafter.professions,
        profession_notes: newCrafter.profession_notes.trim() || null,
      })
      .then(() => {
        setMembers((prev) => [
          ...prev,
          {
            name: newCrafter.character_name.trim(),
            class: "",
            level: 0,
            professions: [...newCrafter.professions],
            profession_notes: newCrafter.profession_notes.trim() || "",
            guild_profession_stars: [],
          },
        ]);
        setAddingCrafter(false);
        setNewCrafter({ character_name: "", professions: [], profession_notes: "" });
      })
      .catch(() => {});
  };

  const updateCrafter = (charName: string, updates: { professions: string[]; profession_notes: string }) => {
    api
      .put("/auth/me/guild-crafter", {
        realm: realmSlug,
        guild_name: guildName,
        server_type: serverType,
        character_name: charName,
        professions: updates.professions,
        profession_notes: updates.profession_notes || null,
      })
      .then(() => {
        setMembers((prev) =>
          prev.map((m) =>
            m.name.toLowerCase() === charName.toLowerCase()
              ? { ...m, professions: updates.professions, profession_notes: updates.profession_notes }
              : m
          )
        );
        setEditingCrafter(null);
      })
      .catch(() => {});
  };

  const removeCrafter = (charName: string) => {
    if (!confirm(`Remove ${charName} from the crafter roster?`)) return;
    api
      .delete(
        `/auth/me/guild-crafter?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}&character_name=${encodeURIComponent(charName)}`
      )
      .then(() => {
        setMembers((prev) => prev.filter((m) => m.name.toLowerCase() !== charName.toLowerCase()));
      })
      .catch(() => {});
  };

  const filteredMembers = members
    .filter((m) => {
      const q = searchQuery.trim().toLowerCase();
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (professionFilter) {
        const hasProf =
          m.professions.some((p) => p === professionFilter || p.startsWith(professionFilter + " ")) ||
          m.guild_profession_stars.includes(professionFilter);
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
            {tbcManual
              ? "TBC Anniversary has no Blizzard profession API. Add crafters manually, set their professions and public notes, then star them for the Guild Crafters recipe search."
              : "View all guild members and their professions. Star members as \"Guild Enchanter\", \"Guild Alchemist\", etc. Starred crafters appear in the Guild Crafters recipe search."}
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
              {tbcManual && canManage && (
                <div className="mb-6 flex items-center gap-3 flex-wrap">
                  {!addingCrafter ? (
                    <button
                      onClick={() => setAddingCrafter(true)}
                      className="text-sm px-3 py-2 rounded-lg bg-sky-600/80 hover:bg-sky-500/80 text-white font-medium"
                    >
                      + Add crafter
                    </button>
                  ) : (
                    <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-slate-800/50">
                      <input
                        value={newCrafter.character_name}
                        onChange={(e) => setNewCrafter((x) => ({ ...x, character_name: e.target.value }))}
                        placeholder="Character name"
                        className="px-2 py-1.5 rounded bg-slate-700 text-sm w-40"
                      />
                      <input
                        value={newCrafter.professions.join(", ")}
                        onChange={(e) =>
                          setNewCrafter((x) => ({
                            ...x,
                            professions: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                          }))
                        }
                        placeholder="Professions (comma-separated)"
                        className="px-2 py-1.5 rounded bg-slate-700 text-sm w-56"
                      />
                      <input
                        value={newCrafter.profession_notes}
                        onChange={(e) => setNewCrafter((x) => ({ ...x, profession_notes: e.target.value }))}
                        placeholder="Public notes (optional)"
                        className="px-2 py-1.5 rounded bg-slate-700 text-sm w-48"
                      />
                      <button onClick={addCrafter} className="px-2 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm">
                        Add
                      </button>
                      <button
                        onClick={() => {
                          setAddingCrafter(false);
                          setNewCrafter({ character_name: "", professions: [], profession_notes: "" });
                        }}
                        className="px-2 py-1.5 rounded bg-slate-600 text-slate-300 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
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
                <p className="text-slate-500">
                  {tbcManual ? "No crafters yet. Add one to get started." : "Guild roster could not be loaded from Blizzard."}
                </p>
              ) : filteredMembers.length === 0 ? (
                <p className="text-slate-500">No members match the current filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-600/80">
                        <th className="text-left text-slate-400 font-medium py-3 pr-4">Member</th>
                        {!tbcManual && (
                          <>
                            <th className="text-left text-slate-400 font-medium py-3 pr-4">Class</th>
                            <th className="text-left text-slate-400 font-medium py-3 pr-4">Level</th>
                          </>
                        )}
                        <th className="text-left text-slate-400 font-medium py-3 pr-4">Professions</th>
                        {tbcManual && (
                          <th className="text-left text-slate-400 font-medium py-3 pr-4">Public notes</th>
                        )}
                        <th className="text-left text-slate-400 font-medium py-3 pr-4">Star as Guild Crafter</th>
                        {tbcManual && canManage && <th className="text-left text-slate-400 font-medium py-3">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMembers.map((m) => (
                        <tr key={m.name} className="border-b border-slate-700/50 last:border-b-0">
                          <td className="py-3 pr-4 font-medium text-slate-200">{m.name}</td>
                          {!tbcManual && (
                            <>
                              <td className="py-3 pr-4 text-slate-400">{m.class}</td>
                              <td className="py-3 pr-4 text-slate-400">{m.level}</td>
                            </>
                          )}
                          <td className="py-3 pr-4 text-slate-400">
                            {editingCrafter?.name === m.name ? (
                              <input
                                value={(editingCrafter.professions || []).join(", ")}
                                onChange={(e) =>
                                  setEditingCrafter((x) =>
                                    x ? { ...x, professions: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : null
                                  )
                                }
                                className="px-2 py-1 rounded bg-slate-700 text-sm w-40"
                                placeholder="Professions"
                              />
                            ) : (
                              m.professions.length > 0 ? m.professions.join(", ") : "—"
                            )}
                          </td>
                          {tbcManual && (
                            <td className="py-3 pr-4 text-slate-400 max-w-[200px]">
                              {editingCrafter?.name === m.name ? (
                                <input
                                  value={editingCrafter.profession_notes || ""}
                                  onChange={(e) =>
                                    setEditingCrafter((x) => (x ? { ...x, profession_notes: e.target.value } : null))
                                  }
                                  className="px-2 py-1 rounded bg-slate-700 text-sm w-full"
                                  placeholder="Public notes"
                                />
                              ) : (
                                <span className="truncate block" title={m.profession_notes || ""}>
                                  {m.profession_notes || "—"}
                                </span>
                              )}
                            </td>
                          )}
                          <td className="py-3 pr-4">
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
                          {tbcManual && canManage && (
                            <td className="py-3">
                              {editingCrafter?.name === m.name ? (
                                <>
                                  <button
                                    onClick={() =>
                                      editingCrafter &&
                                      updateCrafter(m.name, {
                                        professions: editingCrafter.professions || [],
                                        profession_notes: editingCrafter.profession_notes || "",
                                      })
                                    }
                                    className="text-sky-400 hover:text-sky-300 text-xs mr-2"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => setEditingCrafter(null)}
                                    className="text-slate-400 hover:text-slate-300 text-xs"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => setEditingCrafter({ ...m })}
                                    className="text-sky-400 hover:text-sky-300 text-xs mr-2"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => removeCrafter(m.name)}
                                    className="text-red-400 hover:text-red-300 text-xs"
                                  >
                                    Remove
                                  </button>
                                </>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-slate-500 text-xs mt-4">
                {tbcManual
                  ? "Add crafters manually, set their professions and public notes. Star them to show in Guild Crafters recipe search."
                  : "Professions and skill levels come from the Blizzard API. You can star any guild member as a guild crafter for any profession."}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
