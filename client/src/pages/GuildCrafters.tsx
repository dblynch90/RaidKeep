import { useState, useEffect, useMemo } from "react";
import { api } from "../api";
import { Card } from "../components/Card";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import type { GuildPermissions } from "./GuildPermissions";
import { getClassColor } from "../utils/classColors";
import { capitalizeRealm } from "../utils/realm";
import { useGuildParams } from "../hooks/useGuildParams";
import { guildQueryStringFromSlug } from "../utils/guildApi";

const PROFESSION_TYPES = [
  "Alchemy", "Blacksmithing", "Cooking", "Enchanting", "Engineering", "First Aid",
  "Fishing", "Herbalism", "Inscription", "Jewelcrafting", "Leatherworking", "Mining", "Skinning", "Tailoring",
];

interface MemberProfession {
  profession_type: string;
  notes: string;
  profession_level: number | null;
}

interface Member {
  name: string;
  class: string;
  level: number;
  professions: MemberProfession[];
}

interface RosterMember {
  name: string;
  class: string;
  level: number;
}

interface GuildCraftersFullResponse {
  members: Member[];
  guild_roster: RosterMember[];
  permissions: GuildPermissions;
  my_character_names: string[];
  my_characters?: RosterMember[];
}

export function GuildCrafters() {
  const { realm, guildName, serverType, realmSlug, isValid } = useGuildParams();

  const [members, setMembers] = useState<Member[]>([]);
  const [guildRoster, setGuildRoster] = useState<RosterMember[]>([]);
  const [myCharacters, setMyCharacters] = useState<RosterMember[]>([]);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [myCharacterNames, setMyCharacterNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"crafters" | "guild">("crafters");
  const [searchQuery, setSearchQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [levelMin, setLevelMin] = useState<number | null>(null);
  const [levelMax, setLevelMax] = useState<number | null>(null);
  const [guildMemberFilter, setGuildMemberFilter] = useState<"all" | "crafter" | "non-crafter">("all");
  const [selectedGuildMembers, setSelectedGuildMembers] = useState<Set<string>>(new Set());
  const [crafterSearchQuery, setCrafterSearchQuery] = useState("");
  const [crafterClassFilter, setCrafterClassFilter] = useState("");
  const [professionFilter, setProfessionFilter] = useState("");
  const [addProfessionFor, setAddProfessionFor] = useState<string | null>(null);
  const [editProfession, setEditProfession] = useState<{ member: string; profession: string; notes: string; profession_level: number | null } | null>(null);

  const canManage = permissions?.manage_guild_crafters ?? false;
  const isOwnChar = (charName: string) => myCharacterNames.has(charName.toLowerCase());
  const canEditMember = (charName: string) => canManage || isOwnChar(charName);
  const canRemoveMember = (charName: string) => canManage || isOwnChar(charName);

  const crafterMap = useMemo(() => {
    const m = new Map<string, Member>();
    for (const c of members) m.set(c.name.toLowerCase(), c);
    return m;
  }, [members]);

  const fetchData = () => {
    if (!isValid) return;
    const qs = guildQueryStringFromSlug({ realmSlug, guildName, serverType });
    api
      .get<GuildCraftersFullResponse>(`/auth/me/guild-crafters-full?${qs}`)
      .then((r) => {
        setMembers(r.members ?? []);
        setGuildRoster(r.guild_roster ?? []);
        setMyCharacters(r.my_characters ?? []);
        setPermissions(r.permissions ?? null);
        setMyCharacterNames(new Set((r.my_character_names ?? []).map((n) => n.toLowerCase())));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!isValid) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    setLoading(true);
    setError(null);
    fetchData();
  }, [realmSlug, guildName, serverType, isValid]);

  const maxLevelInRoster = useMemo(() => (guildRoster.length ? Math.max(...guildRoster.map((m) => m.level)) : 80), [guildRoster]);
  const effectiveLevelMin = levelMin ?? maxLevelInRoster;
  const effectiveLevelMax = levelMax ?? maxLevelInRoster;
  const classList = useMemo(() => [...new Set(guildRoster.map((m) => m.class))].sort((a, b) => a.localeCompare(b)), [guildRoster]);

  const displayGuildMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const roster = canManage ? guildRoster : myCharacters;
    return [...roster]
      .filter((m) => m.level >= effectiveLevelMin && m.level <= effectiveLevelMax)
      .filter((m) => !classFilter || m.class === classFilter)
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .filter((m) => {
        const isCrafter = crafterMap.has(m.name.toLowerCase());
        if (guildMemberFilter === "crafter") return isCrafter;
        if (guildMemberFilter === "non-crafter") return !isCrafter;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [guildRoster, myCharacters, canManage, classFilter, searchQuery, effectiveLevelMin, effectiveLevelMax, guildMemberFilter, crafterMap]);

  const crafterClassList = useMemo(() => [...new Set(members.map((m) => m.class))].filter(Boolean).sort((a, b) => a.localeCompare(b)), [members]);

  const filteredCrafters = useMemo(() => {
    const q = crafterSearchQuery.trim().toLowerCase();
    return [...members]
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .filter((m) => !crafterClassFilter || m.class === crafterClassFilter)
      .filter((m) => !professionFilter || m.professions.some((p) => p.profession_type === professionFilter))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [members, crafterSearchQuery, crafterClassFilter, professionFilter]);

  const rosterNotInCrafterMap = useMemo(() => {
    const roster = canManage ? guildRoster : myCharacters;
    return roster.filter((r) => !crafterMap.has(r.name.toLowerCase()));
  }, [guildRoster, myCharacters, canManage, crafterMap]);

  const selectedNonCrafterCount = useMemo(
    () => displayGuildMembers.filter((m) => !crafterMap.has(m.name.toLowerCase()) && selectedGuildMembers.has(m.name.toLowerCase())).length,
    [displayGuildMembers, crafterMap, selectedGuildMembers]
  );

  const addProfessions = async (charName: string, profs: string[]) => {
    if (profs.length === 0) return;
    await Promise.all(
      profs.map((prof) =>
        api.post("/auth/me/guild-member-profession", {
          realm: realmSlug,
          guild_name: guildName,
          server_type: serverType,
          character_name: charName,
          profession_type: prof,
        })
      )
    );
    fetchData();
    setAddProfessionFor(null);
  };

  const addSelectedAsCrafters = async () => {
    const toAdd = displayGuildMembers
      .filter((m) => !crafterMap.has(m.name.toLowerCase()) && selectedGuildMembers.has(m.name.toLowerCase()))
      .map((m) => m.name);
    if (toAdd.length === 0) return;
    await api.post("/auth/me/guild-crafter-list", {
      realm: realmSlug,
      guild_name: guildName,
      server_type: serverType,
      character_names: toAdd,
    }).catch(() => {});
    setSelectedGuildMembers(new Set());
    fetchData();
  };

  const toggleGuildMemberSelection = (name: string) => {
    const key = name.toLowerCase();
    if (crafterMap.has(key)) return;
    setSelectedGuildMembers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearGuildMemberSelection = () => setSelectedGuildMembers(new Set());

  const updateProfession = (charName: string, prof: string, updates: { notes?: string; profession_level?: number | null }) => {
    api
      .put("/auth/me/guild-member-profession", {
        realm: realmSlug,
        guild_name: guildName,
        server_type: serverType,
        character_name: charName,
        profession_type: prof,
        ...updates,
      })
      .then(() => {
        fetchData();
        setEditProfession(null);
      })
      .catch(() => {});
  };

  const deleteProfession = (charName: string, prof: string) => {
    api
      .delete(
        `/auth/me/guild-member-profession?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}&character_name=${encodeURIComponent(charName)}&profession_type=${encodeURIComponent(prof)}`
      )
      .then(() => {
        fetchData();
        setEditProfession(null);
      })
      .catch(() => {});
  };

  const removeCrafterFromList = (charName: string) => {
    api
      .delete(
        `/auth/me/guild-crafter-list?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}&character_name=${encodeURIComponent(charName)}`
      )
      .then(() => {
        fetchData();
        setEditProfession(null);
      })
      .catch(() => {});
  };

  if (error) {
    return (
      <div className="rk-page-bg text-slate-100" >
        <main className="rk-page-main">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="rk-page-bg text-slate-100" >
      <main className="rk-page-main">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Guild Professions" />

        <header className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-semibold text-sky-400">Guild Professions</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1 truncate">
            {capitalizeRealm(realm)} / {guildName} / {serverType}
          </p>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <Card className="min-w-0 overflow-hidden">
            <div className="p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <nav className="flex rounded-lg bg-slate-800/60 p-1 border border-slate-700/50 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setActiveTab("crafters")}
                    className={`flex-1 sm:flex-initial min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 rounded-md text-sm font-medium transition ${
                      activeTab === "crafters" ? "text-slate-200 bg-[#223657] border-b-2 border-sky-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                    }`}
                  >
                    Professions
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setActiveTab("guild")}
                      className={`flex-1 sm:flex-initial min-h-[44px] sm:min-h-0 px-3 py-2 sm:py-1.5 rounded-md text-sm font-medium transition ${
                        activeTab === "guild" ? "text-slate-200 bg-[#223657] border-b-2 border-sky-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                      }`}
                    >
                      Add From Guild
                    </button>
                  )}
                </nav>
              </div>

              {activeTab === "guild" && (
                <>
                  <p className="text-slate-500 text-sm mb-3">
                    Add members with professions. Select multiple and add at once, or add individually. Members with professions are marked with ✓.
                  </p>
                  <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-3">
                    <input
                      type="text"
                      placeholder="Search by name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2.5 sm:py-2 min-h-[44px] rounded-lg bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                    />
                    <select
                      value={classFilter}
                      onChange={(e) => setClassFilter(e.target.value)}
                      className="w-full sm:w-auto px-3 py-2.5 sm:py-2 min-h-[44px] rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50 [color-scheme:dark]"
                    >
                      <option value="">All classes</option>
                      {classList.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <label className="text-slate-400 text-sm shrink-0">Level</label>
                      <input
                        type="number"
                        min={1}
                        max={maxLevelInRoster}
                        value={effectiveLevelMin}
                        onChange={(e) => setLevelMin(e.target.value === "" ? null : Math.max(1, Math.min(maxLevelInRoster, +e.target.value)))}
                        className="w-16 sm:w-14 px-2 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm [color-scheme:dark]"
                      />
                      <span className="text-slate-500">–</span>
                      <input
                        type="number"
                        min={1}
                        max={maxLevelInRoster}
                        value={effectiveLevelMax}
                        onChange={(e) => setLevelMax(e.target.value === "" ? null : Math.max(1, Math.min(maxLevelInRoster, +e.target.value)))}
                        className="w-16 sm:w-14 px-2 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm [color-scheme:dark]"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 text-sm shrink-0">Show:</span>
                      <div className="flex rounded-lg bg-slate-800/60 p-0.5 border border-slate-700/50 flex-1 sm:flex-initial">
                        {(["all", "crafter", "non-crafter"] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setGuildMemberFilter(f)}
                            className={`flex-1 sm:flex-initial min-h-[36px] sm:min-h-0 px-2 py-1.5 sm:py-0.5 rounded text-xs font-medium transition ${
                              guildMemberFilter === f ? "text-slate-200 bg-[#223657] border-b-2 border-sky-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                            }`}
                          >
                            {f === "all" ? "All" : f === "crafter" ? "With professions" : "Without"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(canManage || myCharacters.length > 0) && rosterNotInCrafterMap.length > 0 && (
                      <div className="flex items-center gap-2 ml-auto flex-wrap">
                        <button
                          type="button"
                          onClick={clearGuildMemberSelection}
                          className="min-h-[44px] px-3 py-2 rounded text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border border-slate-600"
                        >
                          Clear selection
                        </button>
                        <button
                          type="button"
                          onClick={addSelectedAsCrafters}
                          disabled={selectedNonCrafterCount === 0}
                          className="min-h-[44px] px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium border border-sky-500/50"
                        >
                          Add selected {selectedNonCrafterCount > 0 ? `(${selectedNonCrafterCount})` : ""}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="max-h-[420px] overflow-y-auto space-y-1.5">
                    {displayGuildMembers.length === 0 ? (
                      <p className="text-slate-500 text-sm py-4 text-center">
                        No guild members match the current filters.
                      </p>
                    ) : (
                      displayGuildMembers.map((m) => {
                        const classColor = getClassColor(m.class);
                        const isCrafter = crafterMap.has(m.name.toLowerCase());
                        const isSelected = selectedGuildMembers.has(m.name.toLowerCase());
                        const canAdd = (canManage || isOwnChar(m.name)) && !isCrafter;
                        return (
                          <div
                            key={m.name}
                            className="flex items-center gap-2 rounded-lg border border-slate-600 p-3 sm:p-2 min-h-[52px] hover:bg-slate-800/50"
                            style={{ borderLeftWidth: 4, borderLeftColor: classColor }}
                          >
                            {canAdd ? (
                              <label className="shrink-0 flex items-center cursor-pointer min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleGuildMemberSelection(m.name)}
                                  className="rounded border-slate-600 bg-slate-700 text-sky-500 focus:ring-sky-500/50 w-5 h-5"
                                />
                              </label>
                            ) : (
                              <span className="w-5 sm:w-4 shrink-0" />
                            )}
                            <span className="truncate flex-1 min-w-0 text-sm">
                              <span className="font-medium text-sm" style={{ color: classColor }}>{m.name}</span>
                              <span className="text-slate-500"> – {m.level} – {m.class}</span>
                            </span>
                            {isCrafter ? (
                              <span className="shrink-0 h-9 sm:h-7 flex items-center text-emerald-400 text-sm font-medium">
                                ✓
                              </span>
                            ) : canAdd ? (
                              <button
                                type="button"
                                onClick={() => {
                                  api.post("/auth/me/guild-crafter-list", {
                                    realm: realmSlug,
                                    guild_name: guildName,
                                    server_type: serverType,
                                    character_names: [m.name],
                                  }).catch(() => {}).then(() => fetchData());
                                }}
                                className="shrink-0 min-h-[44px] sm:min-h-0 h-9 sm:h-7 px-3 sm:px-2 flex items-center justify-center rounded bg-sky-600/90 hover:bg-sky-500 text-white text-sm font-medium border border-sky-500/50"
                                title="Add to professions list"
                              >
                                Add
                              </button>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}

              {activeTab === "crafters" && (
                <>
                  <p className="text-slate-500 text-sm mb-3">
                    View guild members and their professions. Officers can manage all. Members can edit their own.
                  </p>
                  {members.length > 0 && (
                    <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-3">
                      <input
                        type="text"
                        placeholder="Search by name..."
                        value={crafterSearchQuery}
                        onChange={(e) => setCrafterSearchQuery(e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2.5 sm:py-2 min-h-[44px] rounded-lg bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      />
                      <select
                        value={crafterClassFilter}
                        onChange={(e) => setCrafterClassFilter(e.target.value)}
                        className="w-full sm:w-auto px-3 py-2.5 sm:py-2 min-h-[44px] rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50 [color-scheme:dark]"
                      >
                        <option value="">All classes</option>
                        {crafterClassList.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <select
                        value={professionFilter}
                        onChange={(e) => setProfessionFilter(e.target.value)}
                        className="w-full sm:w-auto px-3 py-2.5 sm:py-2 min-h-[44px] rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50 [color-scheme:dark]"
                        title="Filter by profession"
                      >
                        <option value="">All professions</option>
                        {PROFESSION_TYPES.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {/* Desktop: table layout */}
                  <div className="hidden sm:block max-h-[420px] overflow-y-auto">
                    {members.length === 0 ? (
                      <p className="text-slate-500 text-sm py-8 text-center">
                        {canManage
                          ? "No members with professions yet. Switch to Add From Guild to add them."
                          : "No members with professions yet. Add your characters below to get started."}
                      </p>
                    ) : filteredCrafters.length === 0 ? (
                      <p className="text-slate-500 text-sm py-8 text-center">
                        No members match the current filters.
                      </p>
                    ) : (
                      <table className="w-full border-collapse text-sm table-fixed">
                        <thead>
                          <tr className="text-left text-slate-400 text-xs font-medium uppercase tracking-wider border-b border-slate-600">
                            <th className="py-1.5 pr-3 w-36 shrink-0">Character</th>
                            <th className="py-1.5">Professions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCrafters.map((m) => {
                            const classColor = getClassColor(m.class);
                            return (
                              <tr
                                key={m.name}
                                className="border-b border-slate-700/60 hover:bg-slate-800/50"
                              >
                                <td className="py-1 pr-3 pl-2 align-top border-l-4" style={{ borderLeftColor: classColor }}>
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {canRemoveMember(m.name) && (
                                      <button
                                        type="button"
                                        onClick={() => removeCrafterFromList(m.name)}
                                        className="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0 text-sm"
                                        title="Remove from list"
                                        aria-label="Remove from list"
                                      >
                                        ×
                                      </button>
                                    )}
                                    <span className="font-medium truncate block" style={{ color: classColor }}>{m.name}</span>
                                  </div>
                                </td>
                                <td className="py-1 align-top">
                                  <div className="flex flex-wrap gap-1 items-center leading-tight">
                                    {m.professions.length === 0 ? (
                                      <span className="text-slate-500 text-xs">—</span>
                                    ) : (
                                      m.professions.map((p) => (
                                        <span
                                          key={p.profession_type}
                                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] border shrink-0 transition ${canEditMember(m.name) ? "hover:bg-slate-700/80 cursor-pointer group" : "cursor-default"} bg-slate-800/60 border-slate-600 text-slate-200`}
                                          title={p.notes ? `${p.profession_type}: ${p.notes}` : p.profession_type}
                                        >
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (canEditMember(m.name)) setEditProfession({ member: m.name, profession: p.profession_type, notes: p.notes, profession_level: p.profession_level });
                                            }}
                                            className="text-left min-w-0"
                                          >
                                            <span>{p.profession_type}</span>
                                            {p.profession_level != null ? (
                                              <span className="text-slate-500">({p.profession_level})</span>
                                            ) : null}
                                            {canEditMember(m.name) && <span className="text-sky-400 text-[9px]">✎</span>}
                                          </button>
                                          {canEditMember(m.name) && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                deleteProfession(m.name, p.profession_type);
                                              }}
                                              className="w-3.5 h-3.5 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0 -mr-0.5 text-[10px]"
                                              title={`Remove ${p.profession_type}`}
                                              aria-label={`Remove ${p.profession_type}`}
                                            >
                                              ×
                                            </button>
                                          )}
                                        </span>
                                      ))
                                    )}
                                    {canEditMember(m.name) && (
                                      <AddProfessionRow
                                        existingProfs={m.professions.map((p) => p.profession_type)}
                                        onAdd={(profs) => addProfessions(m.name, profs)}
                                      />
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Mobile: card layout */}
                  <div className="sm:hidden max-h-[420px] overflow-y-auto space-y-3 pb-4">
                    {members.length === 0 ? (
                      <p className="text-slate-500 text-sm py-8 text-center">
                        {canManage
                          ? "No members with professions yet. Switch to Add From Guild to add them."
                          : "No members with professions yet. Add your characters below to get started."}
                      </p>
                    ) : filteredCrafters.length === 0 ? (
                      <p className="text-slate-500 text-sm py-8 text-center">
                        No members match the current filters.
                      </p>
                    ) : (
                      filteredCrafters.map((m) => {
                        const classColor = getClassColor(m.class);
                        return (
                          <div
                            key={m.name}
                            className="rounded-xl border border-slate-700/80 bg-slate-800/60 p-4"
                            style={{ borderLeftWidth: 4, borderLeftColor: classColor }}
                          >
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <span className="font-medium" style={{ color: classColor }}>
                                {m.name}
                              </span>
                              <span className="text-slate-500 text-xs shrink-0">{m.class}</span>
                              {canRemoveMember(m.name) && (
                                <button
                                  type="button"
                                  onClick={() => removeCrafterFromList(m.name)}
                                  className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 w-10 h-10 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0 -mr-2"
                                  title="Remove from list"
                                  aria-label="Remove from list"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                            <div>
                              <span className="text-slate-500 text-xs uppercase block mb-2">Professions</span>
                              <div className="flex flex-wrap gap-2">
                                {m.professions.length === 0 ? (
                                  <span className="text-slate-500 text-sm">—</span>
                                ) : (
                                  m.professions.map((p) => (
                                    <span
                                      key={p.profession_type}
                                      className={`inline-flex items-center gap-1 px-2 py-1.5 rounded text-xs border min-h-[36px] ${canEditMember(m.name) ? "cursor-pointer" : ""} bg-slate-800/80 border-slate-600 text-slate-200`}
                                      title={p.notes ? `${p.profession_type}: ${p.notes}` : p.profession_type}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => canEditMember(m.name) && setEditProfession({ member: m.name, profession: p.profession_type, notes: p.notes, profession_level: p.profession_level })}
                                        className="text-left min-w-0"
                                      >
                                        <span>{p.profession_type}</span>
                                        {p.profession_level != null && (
                                          <span className="text-slate-500"> ({p.profession_level})</span>
                                        )}
                                        {canEditMember(m.name) && <span className="text-sky-400 text-[10px] ml-0.5">✎</span>}
                                      </button>
                                      {canEditMember(m.name) && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteProfession(m.name, p.profession_type);
                                          }}
                                          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                                          title={`Remove ${p.profession_type}`}
                                          aria-label={`Remove ${p.profession_type}`}
                                        >
                                          ×
                                        </button>
                                      )}
                                    </span>
                                  ))
                                )}
                                {canEditMember(m.name) && (
                                  <AddProfessionRow
                                    existingProfs={m.professions.map((p) => p.profession_type)}
                                    onAdd={(profs) => addProfessions(m.name, profs)}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {!canManage && myCharacters.length > 0 && (() => {
                    const myNotInTable = myCharacters.filter((c) => !crafterMap.has(c.name.toLowerCase()));
                    if (myNotInTable.length === 0) return null;
                    return (
                      <div className="mt-6 pt-4 border-t border-slate-700/60">
                        <p className="text-slate-400 text-sm mb-2">Add your characters to the professions list:</p>
                        <div className="flex flex-wrap gap-2">
                          {myNotInTable.map((m) => (
                            <div
                              key={m.name}
                              className="flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-3 sm:py-2 min-h-[52px]"
                              style={{ borderLeftWidth: 4, borderLeftColor: getClassColor(m.class) }}
                            >
                              <span className="font-medium text-sm flex-1 min-w-0 truncate" style={{ color: getClassColor(m.class) }}>{m.name}</span>
                              <span className="text-slate-500 text-sm shrink-0">– {m.level} – {m.class}</span>
                              <button
                                type="button"
                                onClick={() => setAddProfessionFor(m.name)}
                                className="shrink-0 min-h-[44px] sm:min-h-0 h-9 sm:h-7 px-3 sm:px-2 flex items-center justify-center rounded bg-sky-600/90 hover:bg-sky-500 text-white text-sm font-medium border border-sky-500/50"
                                title="Add professions"
                              >
                                Add
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </Card>
        )}

        {addProfessionFor && (
          <AddProfessionModal
            characterName={addProfessionFor}
            onAdd={(profs) => addProfessions(addProfessionFor, profs)}
            onClose={() => setAddProfessionFor(null)}
          />
        )}
        {editProfession && (
          <EditProfessionModal
            member={editProfession.member}
            profession={editProfession.profession}
            notes={editProfession.notes}
            professionLevel={editProfession.profession_level}
            onSave={(updates) => updateProfession(editProfession!.member, editProfession!.profession, updates)}
            onClose={() => setEditProfession(null)}
          />
        )}
      </main>
    </div>
  );
}

function AddProfessionRow({ existingProfs, onAdd }: { existingProfs: string[]; onAdd: (profs: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const available = PROFESSION_TYPES.filter((p) => !existingProfs.includes(p));
  if (available.length === 0) return null;
  const toggle = (p: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };
  const handleAdd = () => {
    if (selected.size > 0) {
      onAdd([...selected]);
      setSelected(new Set());
      setOpen(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap gap-2 items-center">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="min-h-[36px] px-2 py-1.5 rounded text-sky-400 hover:text-sky-300 hover:bg-slate-700/50 text-xs font-medium">
          + Add
        </button>
      ) : (
        <>
          {available.map((p) => (
            <label key={p} className="inline-flex items-center gap-1.5 cursor-pointer min-h-[36px]">
              <input
                type="checkbox"
                checked={selected.has(p)}
                onChange={() => toggle(p)}
                className="rounded border-slate-600 bg-slate-700 text-sky-500 w-4 h-4"
              />
              <span className="text-slate-200 text-xs">{p}</span>
            </label>
          ))}
          <button type="button" onClick={handleAdd} disabled={selected.size === 0} className="min-h-[36px] px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-medium">
            Add ({selected.size})
          </button>
          <button type="button" onClick={() => { setOpen(false); setSelected(new Set()); }} className="min-h-[36px] px-2 py-1 text-slate-500 hover:text-slate-300 text-xs">
            Cancel
          </button>
        </>
      )}
    </span>
  );
}

function AddProfessionModal({
  characterName,
  onAdd,
  onClose,
}: {
  characterName: string;
  onAdd: (profs: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (p: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pb-safe bg-black/60"
      onClick={onClose}
      onPointerDown={onClose}
    >
      <div
        className="rk-card-panel-bordered p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto shadow-xl rounded-t-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Add professions for {characterName}</h3>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {PROFESSION_TYPES.map((p) => (
            <label key={p} className="flex items-center gap-3 cursor-pointer py-2 min-h-[44px]">
              <input
                type="checkbox"
                checked={selected.has(p)}
                onChange={() => toggle(p)}
                className="rounded border-slate-600 bg-slate-700 text-sky-500 w-5 h-5"
              />
              <span className="text-slate-200 text-sm">{p}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className="min-h-[44px] px-4 py-2 rounded bg-slate-600 text-slate-300 text-sm hover:bg-slate-500">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAdd([...selected])}
            disabled={selected.size === 0}
            className="min-h-[44px] px-4 py-2 rounded bg-sky-600 text-white text-sm hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}

function EditProfessionModal({
  member,
  profession,
  notes,
  professionLevel,
  onSave,
  onClose,
}: {
  member: string;
  profession: string;
  notes: string;
  professionLevel: number | null;
  onSave: (updates: { notes?: string; profession_level?: number | null }) => void;
  onClose: () => void;
}) {
  const [notesVal, setNotesVal] = useState(notes);
  const [levelVal, setLevelVal] = useState(professionLevel != null ? String(professionLevel) : "");
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pb-safe bg-black/60"
      onClick={onClose}
      onPointerDown={onClose}
    >
      <div
        className="rk-card-panel-bordered p-6 w-full max-w-md max-h-[85vh] overflow-y-auto shadow-xl rounded-t-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Edit {profession} · {member}</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-slate-400 text-sm mb-1">Profession Level (0–525)</label>
            <input
              type="number"
              min={0}
              max={525}
              value={levelVal}
              onChange={(e) => setLevelVal(e.target.value)}
              className="w-full px-3 py-2.5 min-h-[44px] rounded-lg bg-slate-700 border border-slate-600 text-slate-100 text-sm [color-scheme:dark]"
              placeholder="e.g. 375"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-sm mb-1">Notes</label>
            <textarea
              value={notesVal}
              onChange={(e) => setNotesVal(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 text-sm"
              placeholder="e.g. Ring enchants"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className="min-h-[44px] px-4 py-2 rounded bg-slate-600 text-slate-300 text-sm hover:bg-slate-500">Cancel</button>
          <button
            type="button"
            onClick={() => {
              const parsed = levelVal.trim() === "" ? null : Math.min(525, Math.max(0, parseInt(levelVal, 10) || 0));
              onSave({ notes: notesVal, profession_level: parsed });
            }}
            className="min-h-[44px] px-4 py-2 rounded bg-sky-600 text-white text-sm hover:bg-sky-500"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
