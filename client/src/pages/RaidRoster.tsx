import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import type { GuildPermissions } from "./GuildPermissions";

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
  return realm.split(/[- ]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

const DEFAULT_PERMISSIONS: GuildPermissions = {
  view_guild_dashboard: true,
  view_guild_roster: true,
  view_raid_roster: true,
  view_raid_schedule: true,
  manage_raids: true,
  manage_raid_roster: true,
  manage_permissions: true,
};

const RAID_ROLES = [
  { value: "", label: "—" },
  { value: "tank", label: "Tank" },
  { value: "healer", label: "Healer" },
  { value: "dps", label: "DPS" },
] as const;

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const DEFAULT_AVAILABILITY = "0000000";

interface RaiderEntry {
  character_name: string;
  character_class: string;
  primary_spec?: string;
  off_spec?: string;
  secondary_spec?: string;
  notes?: string;
  officer_notes?: string;
  notes_public?: boolean;
  raid_role?: string;
  raid_lead?: boolean;
  raid_assist?: boolean;
  availability?: string;
}

interface RaidTeam {
  id: number;
  team_name: string;
  members: Array<{ character_name: string; character_class: string }>;
}

export function RaidRoster() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "Retail";

  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [raiders, setRaiders] = useState<RaiderEntry[]>([]);
  const [teams, setTeams] = useState<RaidTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [classFilter, setClassFilter] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [availabilityFilter, setAvailabilityFilter] = useState<string>("");
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [myCharacters, setMyCharacters] = useState<import("../api").MyCharacter[]>([]);

  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const canEdit = (permissions ?? DEFAULT_PERMISSIONS).manage_raid_roster;
  const canEditOwnAvailabilityAndNotes =
    (permissions ?? DEFAULT_PERMISSIONS).view_raid_roster && !canEdit;
  const myCharacterNames = useMemo(
    () => new Set(myCharacters.map((c) => c.name.toLowerCase())),
    [myCharacters]
  );
  const canEditRaider = (characterName: string) =>
    canEdit || (canEditOwnAvailabilityAndNotes && myCharacterNames.has(characterName.toLowerCase()));

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
      ).then((r) => r.permissions).catch(() => DEFAULT_PERMISSIONS),
      api.get<{ characters: import("../api").MyCharacter[] }>("/auth/me/characters").then((r) => r.characters ?? []).catch(() => []),
      api.get<{ raiders: Array<Omit<RaiderEntry, "notes_public"> & { notes_public?: number; raid_lead?: unknown; raid_assist?: unknown; availability?: string }> }>(
        `/auth/me/raider-roster?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) =>
        (r.raiders ?? []).map((x) => ({
          ...x,
          raid_lead: Boolean(x.raid_lead),
          raid_assist: Boolean(x.raid_assist),
          notes_public: x.notes_public === 1,
          availability: typeof x.availability === "string" ? x.availability.padEnd(7, "0").slice(0, 7) : DEFAULT_AVAILABILITY,
        })
      )),
      api.get<{ teams: RaidTeam[] }>(
        `/auth/me/raid-teams?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => r.teams ?? []),
    ])
      .then(([perms, chars, raidersList, teamsList]) => {
        setPermissions(perms);
        setMyCharacters(chars);
        setRaiders(raidersList);
        setTeams(teamsList);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [realm, realmSlug, guildName, serverType]);

  const characterToTeamId = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of teams) {
      for (const mbr of t.members) {
        m.set(mbr.character_name.toLowerCase(), t.id);
      }
    }
    return m;
  }, [teams]);

  const raiderClassList = useMemo(() => {
    const set = new Set(raiders.map((r) => r.character_class));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [raiders]);

  const filteredRaiders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const roleMatches = (r: RaiderEntry) => {
      if (!roleFilter) return true;
      const rf = roleFilter.toLowerCase();
      if ((r.raid_role || "").toLowerCase() === rf) return true;
      const off = (r.off_spec || "").toLowerCase();
      if (["tank", "healer", "dps"].includes(off) && off === rf) return true;
      return false;
    };
    const availabilityMatches = (r: RaiderEntry) => {
      if (!availabilityFilter) return true;
      const dayIndex = DAYS.indexOf(availabilityFilter as (typeof DAYS)[number]);
      if (dayIndex < 0) return true;
      const avail = (r.availability || DEFAULT_AVAILABILITY).padEnd(7, "0");
      return avail[dayIndex] === "1";
    };
    return raiders
      .filter((r) => !classFilter || r.character_class === classFilter)
      .filter(roleMatches)
      .filter((r) => {
        if (!teamFilter) return true;
        if (teamFilter === "none") return !characterToTeamId.has(r.character_name.toLowerCase());
        const tid = characterToTeamId.get(r.character_name.toLowerCase());
        const team = teams.find((t) => t.id === tid);
        return team?.team_name === teamFilter;
      })
      .filter(availabilityMatches)
      .filter((r) => !q || r.character_name.toLowerCase().includes(q))
      .sort((a, b) => a.character_name.localeCompare(b.character_name, undefined, { sensitivity: "base" }));
  }, [raiders, searchQuery, classFilter, roleFilter, teamFilter, availabilityFilter, characterToTeamId, teams]);

  const updateRaider = (name: string, updates: Partial<RaiderEntry>) => {
    if (updates.officer_notes !== undefined && !canEdit) return; // Only guild/raid leads can edit officer notes
    if (!canEditRaider(name)) return;
    const filtered = canEditOwnAvailabilityAndNotes
      ? {
          ...(updates.availability !== undefined && { availability: updates.availability }),
          ...(updates.notes !== undefined && { notes: updates.notes }),
          ...(updates.raid_role !== undefined && { raid_role: updates.raid_role }),
          ...(updates.primary_spec !== undefined && { primary_spec: updates.primary_spec }),
          ...(updates.off_spec !== undefined && { off_spec: updates.off_spec }),
          ...(updates.secondary_spec !== undefined && { secondary_spec: updates.secondary_spec }),
          ...(updates.notes_public !== undefined && { notes_public: updates.notes_public }),
        }
      : updates;
    if (Object.keys(filtered).length === 0) return;
    setRaiders((prev) =>
      prev.map((r) => (r.character_name.toLowerCase() === name.toLowerCase() ? { ...r, ...filtered } : r))
    );
  };

  const toggleAvailabilityDay = (name: string, dayIndex: number) => {
    if (!canEditRaider(name)) return;
    setRaiders((prev) =>
      prev.map((r) => {
        if (r.character_name.toLowerCase() !== name.toLowerCase()) return r;
        const a = (r.availability || DEFAULT_AVAILABILITY).padEnd(7, "0").slice(0, 7).split("");
        a[dayIndex] = a[dayIndex] === "1" ? "0" : "1";
        return { ...r, availability: a.join("") };
      })
    );
  };

  useEffect(() => {
    if (!saveMsg) return;
    const t = setTimeout(() => setSaveMsg(null), 2500);
    return () => clearTimeout(t);
  }, [saveMsg]);

  const handleSave = async () => {
    if (!canEdit && !canEditOwnAvailabilityAndNotes) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      if (canEdit) {
        await api.put("/auth/me/raider-roster", {
        guild_name: guildName,
        guild_realm: realm,
        guild_realm_slug: realm,
        server_type: serverType,
        raiders: raiders.map((r) => ({
          character_name: r.character_name,
          character_class: r.character_class,
          primary_spec: r.primary_spec || null,
          off_spec: r.off_spec || null,
          secondary_spec: r.secondary_spec || null,
          notes: r.notes || null,
          officer_notes: r.officer_notes || null,
          notes_public: r.notes_public ? 1 : 0,
          raid_role: r.raid_role || null,
          raid_lead: r.raid_lead ? 1 : 0,
          raid_assist: r.raid_assist ? 1 : 0,
          availability: (r.availability || DEFAULT_AVAILABILITY).padEnd(7, "0").slice(0, 7),
        })),
        });
      } else {
        const myUpdates = raiders
          .filter((r) => myCharacterNames.has(r.character_name.toLowerCase()))
          .map((r) => ({
            character_name: r.character_name,
            availability: (r.availability || DEFAULT_AVAILABILITY).padEnd(7, "0").slice(0, 7),
            notes: r.notes ?? "",
            raid_role: r.raid_role ?? "",
            primary_spec: r.primary_spec ?? "",
            off_spec: r.off_spec ?? "",
            secondary_spec: r.secondary_spec ?? "",
            notes_public: r.notes_public ?? false,
          }));
        if (myUpdates.length > 0) {
          const res = await api.patch<{ raiders: Array<Omit<RaiderEntry, "notes_public"> & { notes_public?: number }> }>("/auth/me/raider-roster/self", {
            guild_name: guildName,
            guild_realm: realm,
            guild_realm_slug: realmSlug,
            server_type: serverType,
            updates: myUpdates,
          });
          setRaiders(
            (res.raiders ?? []).map((x) => ({
              character_name: x.character_name ?? "",
              character_class: x.character_class ?? "",
              primary_spec: x.primary_spec ?? "",
              off_spec: x.off_spec ?? "",
              secondary_spec: (x as RaiderEntry & { secondary_spec?: string }).secondary_spec ?? "",
              notes: x.notes ?? "",
              officer_notes: x.officer_notes ?? "",
              notes_public: x.notes_public === 1,
              raid_role: x.raid_role ?? "",
              raid_lead: Boolean(x.raid_lead),
              raid_assist: Boolean(x.raid_assist),
              availability: typeof x.availability === "string" ? x.availability.padEnd(7, "0").slice(0, 7) : DEFAULT_AVAILABILITY,
            }))
          );
        }
      }
      setSaveMsg("Saved.");
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const perms = permissions ?? DEFAULT_PERMISSIONS;

  if (error) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  if (!loading && !perms.view_raid_roster) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">You do not have permission to view the raider roster.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
      <main className="max-w-6xl mx-auto px-4 py-8">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Raid Roster" />

        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-sky-400">{guildName}</h1>
          <p className="text-slate-400 text-sm mt-1">
            Raid Roster · {capitalizeRealm(realm)} · {serverType}
            {!loading && ` · ${raiders.length} raider${raiders.length !== 1 ? "s" : ""}`}
          </p>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <div
            className="rounded-xl border border-white/[0.05] overflow-hidden"
            style={{
              background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            {/* Filters + Save */}
            <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-700/60">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 px-2.5 rounded bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm w-36 focus:ring-1 focus:ring-sky-500/50"
              />
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="h-8 px-2.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:ring-1 focus:ring-sky-500/50"
              >
                <option value="">All classes</option>
                {raiderClassList.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="h-8 px-2.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:ring-1 focus:ring-sky-500/50"
              >
                <option value="">All roles</option>
                <option value="tank">Tank</option>
                <option value="healer">Healer</option>
                <option value="dps">DPS</option>
              </select>
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="h-8 px-2.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:ring-1 focus:ring-sky-500/50"
              >
                <option value="">All teams</option>
                <option value="none">No team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.team_name}>{t.team_name}</option>
                ))}
              </select>
              <select
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value)}
                className="h-8 px-2.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:ring-1 focus:ring-sky-500/50"
                title="Filter by availability"
              >
                <option value="">Any day</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <div className="flex-1" />
              {(canEdit || canEditOwnAvailabilityAndNotes) && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="h-8 px-4 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-sm inline-flex items-center justify-center leading-none border border-sky-500/50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
            </div>

            {/* Table container - header sticks during scroll */}
            <div className="max-h-[60vh] overflow-auto overflow-x-auto">
              {/* Table header - sticky */}
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(105px,1.55fr)_minmax(290px,2.775fr)_minmax(460px,2.875fr)_80px_40px] gap-x-2 gap-y-0 px-4 py-2 h-10 bg-slate-800/95 backdrop-blur-sm border-b border-slate-700/60 text-slate-400 text-xs font-medium uppercase tracking-wider min-w-[960px] items-center shrink-0">
                <span className="truncate" title="The character or player assigned to the roster.">Player</span>
                <span className="truncate" title="Days this player is available to participate in raids.">General Availability</span>
                <span className="truncate whitespace-nowrap" title="Role and spec">ROLE/SPEC</span>
                <span className="truncate" title="The raid team this player is assigned to.">Team</span>
                <span className="flex items-center justify-center" title="Add or edit player and officer notes.">📝</span>
              </div>
              {raiders.length === 0 ? (
                <div className="p-12 text-center text-slate-500">
                  <p>No raiders yet.</p>
                </div>
              ) : filteredRaiders.length === 0 ? (
                <div className="p-12 text-center text-slate-500">No raiders match the current filters.</div>
              ) : (
                filteredRaiders.map((r) => {
                  const classColor = getClassColor(r.character_class);
                  const teamId = characterToTeamId.get(r.character_name.toLowerCase());
                  const team = teams.find((t) => t.id === teamId);
                  return (
                    <div
                      key={r.character_name}
                      className="group grid grid-cols-[minmax(105px,1.55fr)_minmax(290px,2.775fr)_minmax(460px,2.875fr)_80px_40px] gap-x-2 gap-y-0 px-4 py-0 h-10 min-h-10 items-center border-b border-slate-700/30 min-w-[960px] hover:bg-slate-700/20 transition-colors"
                      style={{ borderLeftWidth: 4, borderLeftColor: classColor }}
                    >
                      {/* Player */}
                      <span className="font-semibold text-slate-100 truncate min-w-0" style={{ color: classColor }} title={r.character_name}>
                        {r.character_name}
                      </span>
                      {/* Availability */}
                      <span className="flex items-center gap-1 shrink-0 overflow-hidden">
                        <span className="flex items-center gap-0.5 flex-nowrap min-w-0">
                          {DAYS.map((d, i) => {
                            const avail = (r.availability || DEFAULT_AVAILABILITY).padEnd(7, "0");
                            const checked = avail[i] === "1";
                            const canEditAvail = canEditRaider(r.character_name);
                            return (
                              <label
                                key={i}
                                className={`flex items-center justify-center shrink-0 w-9 h-6 rounded text-[9px] font-medium transition-colors whitespace-nowrap ${
                                  canEditAvail ? "cursor-pointer" : "cursor-default"
                                } ${
                                  canEditAvail
                                    ? checked
                                      ? "bg-sky-500/30 text-sky-400 border border-sky-500/50"
                                      : "bg-slate-700/50 text-slate-500 border border-slate-600 hover:border-slate-500"
                                    : checked
                                      ? "text-sky-400"
                                      : "text-slate-600"
                                }`}
                                title={DAYS[i]}
                              >
                                {canEditAvail ? (
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleAvailabilityDay(r.character_name, i)}
                                    className="sr-only"
                                  />
                                ) : null}
                                {d}
                              </label>
                            );
                          })}
                        </span>
                      </span>
                      {/* Role 1 Spec 1 Role 2 Spec 2 - single column, no wrap */}
                      <span className="min-w-0 flex items-center gap-2 flex-nowrap overflow-hidden">
                        {canEditRaider(r.character_name) ? (
                          <>
                            <select
                              value={r.raid_role ?? ""}
                              onChange={(e) => updateRaider(r.character_name, { raid_role: e.target.value })}
                              className="h-7 min-w-[60px] shrink-0 px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 [color-scheme:dark]"
                              title="Role 1"
                            >
                              {RAID_ROLES.map((opt) => (
                                <option key={opt.value || "_"} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={r.primary_spec ?? ""}
                              onChange={(e) => updateRaider(r.character_name, { primary_spec: e.target.value })}
                              placeholder="Spec"
                              className="h-7 w-[96px] min-w-[96px] shrink-0 px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 placeholder-slate-500"
                              title="Spec 1"
                            />
                            <select
                              value={["tank", "healer", "dps"].includes((r.off_spec ?? "").toLowerCase()) ? (r.off_spec ?? "").toLowerCase() : ""}
                              onChange={(e) => updateRaider(r.character_name, { off_spec: e.target.value })}
                              className="h-7 min-w-[60px] shrink-0 px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 [color-scheme:dark]"
                              title="Role 2"
                            >
                              {RAID_ROLES.map((opt) => (
                                <option key={opt.value || "_"} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={r.secondary_spec ?? ""}
                              onChange={(e) => updateRaider(r.character_name, { secondary_spec: e.target.value })}
                              placeholder="Spec"
                              className="h-7 w-[96px] min-w-[96px] shrink-0 px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 placeholder-slate-500"
                              title="Spec 2"
                            />
                          </>
                        ) : (
                          <span className="text-slate-400 text-sm whitespace-nowrap truncate">
                            {[
                              (r.raid_role || "—").charAt(0).toUpperCase() + (r.raid_role || "").slice(1).toLowerCase(),
                              r.primary_spec || "—",
                              (r.off_spec || "—").charAt(0).toUpperCase() + (r.off_spec || "").slice(1).toLowerCase(),
                              r.secondary_spec || "—",
                            ].join(" ")}
                          </span>
                        )}
                      </span>
                      {/* Team */}
                      <span className="min-w-0 shrink-0">
                        <span className="text-slate-400 text-sm truncate block">{team ? team.team_name : "—"}</span>
                      </span>
                      {/* Notes */}
                      <span className="flex items-center justify-center shrink-0">
                        <button
                          type="button"
                          onClick={() => setNotesFor(r.character_name)}
                          className={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
                            (r.notes || (canEdit && r.officer_notes)) ? "text-sky-400 hover:bg-sky-500/20" : "text-slate-500 hover:bg-slate-600/50"
                          }`}
                          title={(r.notes || (canEdit && r.officer_notes)) ? `Player: ${r.notes || "—"}${canEdit && r.officer_notes ? ` · Officer: ${r.officer_notes}` : ""}` : "Add or edit notes."}
                        >
                          📝
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Notes modal */}
        {notesFor && (() => {
          const r = raiders.find((x) => x.character_name.toLowerCase() === notesFor.toLowerCase());
          return (
            <>
              <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setNotesFor(null)} aria-hidden />
              <div className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-md bg-slate-800 border border-slate-600 rounded-xl shadow-xl z-50 overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                  <h3 className="font-medium text-sky-400">
                    Notes · {r ? r.character_name : notesFor}
                  </h3>
                  <button type="button" onClick={() => setNotesFor(null)} className="text-slate-400 hover:text-slate-200 text-xl leading-none">×</button>
                </div>
                <div className="p-4 space-y-4">
                  {r ? (
                    <>
                      <div>
                        <label className="block text-slate-400 text-xs font-medium uppercase tracking-wider mb-1.5">Player Notes</label>
                        <p className="text-slate-500 text-xs mb-1">
                          {canEdit ? "Visible to the player." : "Visible to you; other members only see these if you make them public."}
                        </p>
                        {canEditRaider(r.character_name) ? (
                          <>
                            <textarea
                              value={r.notes ?? ""}
                              onChange={(e) => updateRaider(r.character_name, { notes: e.target.value })}
                              placeholder="Add player notes..."
                              rows={3}
                              className="w-full px-3 py-2 rounded bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm resize-y focus:ring-1 focus:ring-sky-500/50"
                            />
                            <label className="flex items-center gap-2 mt-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={r.notes_public ?? false}
                                onChange={(e) => updateRaider(r.character_name, { notes_public: e.target.checked })}
                                className="rounded border-slate-600 bg-slate-700 text-sky-500 focus:ring-sky-500/50"
                              />
                              <span className="text-slate-400 text-sm">
                                {canEdit ? "Notes visible to other roster members" : "Make notes visible to other roster members"}
                              </span>
                            </label>
                          </>
                        ) : (
                          <p className="text-slate-300 text-sm whitespace-pre-wrap py-2">{r.notes ?? "No notes."}</p>
                        )}
                      </div>
                      {canEdit ? (
                        <div>
                          <label className="block text-slate-400 text-xs font-medium uppercase tracking-wider mb-1.5">Officer Notes</label>
                          <p className="text-slate-500 text-xs mb-1">Only visible to guild/raid leads.</p>
                          <textarea
                            value={r.officer_notes ?? ""}
                            onChange={(e) => updateRaider(r.character_name, { officer_notes: e.target.value })}
                            placeholder="Add officer notes..."
                            rows={3}
                            className="w-full px-3 py-2 rounded bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm resize-y focus:ring-1 focus:ring-sky-500/50"
                          />
                        </div>
                      ) : null}
                      {canEditRaider(r.character_name) && (
                        <div className="flex justify-end pt-2">
                          <button
                            type="button"
                            onClick={async () => {
                              await handleSave();
                              setNotesFor(null);
                            }}
                            disabled={saving}
                            className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-sm"
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-slate-500 text-sm">Character not found.</p>
                  )}
                </div>
              </div>
            </>
          );
        })()}

        {/* Save toast - bottom right, auto-dismiss */}
        {saveMsg && (
          <div
            className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg shadow-lg border border-white/20"
            style={{
              backgroundColor: saveMsg === "Saved." ? "rgba(14, 165, 233, 0.95)" : "rgba(239, 68, 68, 0.95)",
              color: "#fff",
            }}
          >
            {saveMsg}
          </div>
        )}
      </main>
    </div>
  );
}
