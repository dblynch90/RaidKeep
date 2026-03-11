import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { GuildPermissions } from "./GuildPermissions";
import type { MyCharacter } from "../api";

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

const RAID_ROLES = [
  { value: "", label: "—" },
  { value: "tank", label: "Tank" },
  { value: "healer", label: "Healer" },
  { value: "dps", label: "DPS" },
] as const;

interface GuildMember {
  name: string;
  class: string;
  level: number;
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
  return realm.split(/[- ]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

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

/** Editable Excel-like roster table for a separate window. */
export function RaidRosterPopout() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "TBC Anniversary";

  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");

  const [raiders, setRaiders] = useState<RaiderEntry[]>([]);
  const [teams, setTeams] = useState<RaidTeam[]>([]);
  const [guildMembers, setGuildMembers] = useState<GuildMember[]>([]);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [myCharacters, setMyCharacters] = useState<MyCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);

  const perms = permissions ?? DEFAULT_PERMISSIONS;
  const canEdit = perms.manage_raid_roster;
  const canEditOwnAvailabilityAndNotes = perms.view_raid_roster && !canEdit;
  const myCharacterNames = useMemo(
    () => new Set(myCharacters.map((c) => c.name.toLowerCase())),
    [myCharacters]
  );
  const canEditRaider = (characterName: string) =>
    canEdit || (canEditOwnAvailabilityAndNotes && myCharacterNames.has(characterName.toLowerCase()));

  const [playerSearch, setPlayerSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [maxLevel, setMaxLevel] = useState("");

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
      api.get<{ characters: MyCharacter[] }>("/auth/me/characters").then((r) => r.characters ?? []).catch(() => []),
      api.get<{ raiders: Array<Omit<RaiderEntry, "notes_public"> & { notes_public?: number; raid_lead?: unknown; raid_assist?: unknown; availability?: string }> }>(
        `/auth/me/raider-roster?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) =>
        (r.raiders ?? []).map((x) => ({
          ...x,
          raid_lead: Boolean(x.raid_lead),
          raid_assist: Boolean(x.raid_assist),
          notes_public: x.notes_public === 1,
          availability: typeof x.availability === "string" ? x.availability.padEnd(7, "0").slice(0, 7) : DEFAULT_AVAILABILITY,
        }))
      ),
      api.get<{ teams: RaidTeam[] }>(
        `/auth/me/raid-teams?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => (r.teams ?? []) as RaidTeam[]),
    ])
      .then(([perms, chars, raidersList, teamsList]) => {
        setPermissions(perms);
        setMyCharacters(chars);
        setRaiders(raidersList);
        setTeams(teamsList);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load roster");
        setLoading(false);
      });
    // Fetch guild-roster in background for level filter - non-blocking
    api
      .get<{ members?: GuildMember[] }>(
        `/auth/me/guild-roster?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then((r) => setGuildMembers((r.members ?? []) as GuildMember[]))
      .catch(() => {});
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

  const levelByChar = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of guildMembers) m.set(g.name.toLowerCase(), g.level);
    return m;
  }, [guildMembers]);

  const updateRaider = (name: string, updates: Partial<RaiderEntry>) => {
    if (updates.officer_notes !== undefined && !canEdit) return;
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

  const handleSave = async () => {
    if (!canEdit && !canEditOwnAvailabilityAndNotes) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      if (canEdit) {
        await api.put("/auth/me/raider-roster", {
          guild_name: guildName,
          guild_realm: realm,
          guild_realm_slug: realmSlug,
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

  useEffect(() => {
    if (!saveMsg) return;
    const t = setTimeout(() => setSaveMsg(null), 2500);
    return () => clearTimeout(t);
  }, [saveMsg]);

  const raidersToShow = raiders;

  const classList = useMemo(
    () => [...new Set(raidersToShow.map((r) => r.character_class))].sort((a, b) => a.localeCompare(b)),
    [raidersToShow]
  );

  const maxLevelInRoster = useMemo(() => {
    if (raidersToShow.length === 0) return 80;
    return Math.max(...raidersToShow.map((r) => levelByChar.get(r.character_name.toLowerCase()) ?? 0), 1);
  }, [raidersToShow, levelByChar]);

  const filteredRaiders = useMemo(() => {
    let list = raidersToShow;
    const search = playerSearch.trim().toLowerCase();
    if (search) {
      list = list.filter((r) => r.character_name.toLowerCase().includes(search));
    }
    if (classFilter) {
      list = list.filter((r) => r.character_class === classFilter);
    }
    const roleLower = roleFilter.toLowerCase();
    if (roleLower) {
      list = list.filter((r) => (r.raid_role ?? "").toLowerCase() === roleLower);
    }
    const min = minLevel.trim() ? parseInt(minLevel, 10) : null;
    const max = maxLevel.trim() ? parseInt(maxLevel, 10) : null;
    if (min != null && !isNaN(min)) {
      list = list.filter((r) => {
        const lvl = levelByChar.get(r.character_name.toLowerCase());
        return lvl == null || lvl >= min;
      });
    }
    if (max != null && !isNaN(max)) {
      list = list.filter((r) => {
        const lvl = levelByChar.get(r.character_name.toLowerCase());
        return lvl == null || lvl <= max;
      });
    }
    return [...list].sort((a, b) => a.character_name.localeCompare(b.character_name, undefined, { sensitivity: "base" }));
  }, [raidersToShow, playerSearch, classFilter, roleFilter, minLevel, maxLevel, levelByChar]);

  const sortedRaiders = filteredRaiders;

  if (error) {
    return (
      <div className="min-h-screen text-slate-100 flex items-center justify-center p-8" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <p className="text-amber-500">{error}</p>
      </div>
    );
  }

  if (!loading && !perms.view_raid_roster) {
    return (
      <div className="min-h-screen text-slate-100 flex items-center justify-center p-8" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <p className="text-amber-500">You do not have permission to view the raid roster.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen text-slate-100 flex items-center justify-center p-8" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <p className="text-slate-500">Loading roster...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
      {/* Header with filters - similar to Guild Roster in PlanRaid */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-700/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h1 className="text-lg font-semibold text-sky-400">
            {guildName} · Raid Roster
          </h1>
          <div className="flex items-center gap-3">
            <p className="text-slate-500 text-sm">
              {capitalizeRealm(realm)} · {serverType} · {sortedRaiders.length} raider{sortedRaiders.length !== 1 ? "s" : ""}
            </p>
            {(canEdit || canEditOwnAvailabilityAndNotes) && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-sm border border-sky-500/50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search player..."
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-100 placeholder-slate-500 text-sm w-40 focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50 [color-scheme:dark]"
          />
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="px-2.5 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50 [color-scheme:dark]"
          >
            <option value="">All classes</option>
            {classList.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-2.5 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50 [color-scheme:dark]"
          >
            <option value="">All roles</option>
            <option value="tank">Tank</option>
            <option value="healer">Healer</option>
            <option value="dps">DPS</option>
          </select>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-xs">Level:</span>
            <input
              type="number"
              min={1}
              max={maxLevelInRoster}
              placeholder="Min"
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value)}
              className="w-14 px-2 py-1.5 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-100 text-sm placeholder-slate-600 [color-scheme:dark]"
            />
            <span className="text-slate-600">–</span>
            <input
              type="number"
              min={1}
              max={maxLevelInRoster}
              placeholder="Max"
              value={maxLevel}
              onChange={(e) => setMaxLevel(e.target.value)}
              className="w-14 px-2 py-1.5 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-100 text-sm placeholder-slate-600 [color-scheme:dark]"
            />
            {(minLevel || maxLevel) && (
              <button
                type="button"
                onClick={() => { setMinLevel(""); setMaxLevel(""); }}
                className="text-slate-500 hover:text-slate-300 text-xs px-1"
                title="Clear level filter"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Excel-style table - full width */}
      <div className="overflow-auto p-4" style={{ minHeight: "calc(100vh - 60px)" }}>
        <table className="w-full border-collapse text-sm table-fixed" style={{ minWidth: 960 }}>
          <colgroup>
            <col style={{ width: "12%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "38%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-600">
              <th className="text-left py-2 px-3 text-slate-400 font-medium uppercase tracking-wider">Player</th>
              <th className="text-left py-2 px-3 text-slate-400 font-medium uppercase tracking-wider">General Availability</th>
              <th className="text-left py-2 px-3 text-slate-400 font-medium uppercase tracking-wider">Role - Spec</th>
              <th className="text-left py-2 px-3 text-slate-400 font-medium uppercase tracking-wider">Role - Spec</th>
              <th className="text-left py-2 px-3 text-slate-400 font-medium uppercase tracking-wider">Team</th>
              <th className="text-left py-2 px-3 text-slate-400 font-medium uppercase tracking-wider">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sortedRaiders.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">
                  No raiders in roster.
                </td>
              </tr>
            ) : (
              sortedRaiders.map((r) => {
                const classColor = getClassColor(r.character_class);
                const teamId = characterToTeamId.get(r.character_name.toLowerCase());
                const team = teams.find((t) => t.id === teamId);
                const avail = (r.availability || DEFAULT_AVAILABILITY).padEnd(7, "0");
                return (
                  <tr
                    key={r.character_name}
                    className="border-b border-slate-700/50 hover:bg-slate-800/30 transition-colors"
                    style={{ borderLeft: `3px solid ${classColor}` }}
                  >
                    <td className="py-2 px-3 font-medium" style={{ color: classColor }}>
                      {r.character_name}
                    </td>
                    <td className="py-2 px-3">
                      <span className="flex gap-0.5 flex-wrap">
                        {DAYS.map((d, i) => {
                          const checked = avail[i] === "1";
                          const canEditAvail = canEditRaider(r.character_name);
                          return (
                            <label
                              key={d}
                              className={`inline-flex items-center justify-center w-8 text-center text-xs py-0.5 rounded ${canEditAvail ? "cursor-pointer" : "cursor-default"} ${
                                canEditAvail
                                  ? checked
                                    ? "bg-sky-500/20 text-sky-400 border border-sky-500/50"
                                    : "text-slate-600 border border-slate-600 hover:border-slate-500"
                                  : checked
                                    ? "bg-sky-500/20 text-sky-400"
                                    : "text-slate-600"
                              }`}
                              title={d}
                            >
                              {canEditAvail ? (
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleAvailabilityDay(r.character_name, i)}
                                  className="sr-only"
                                />
                              ) : null}
                              {d[0]}
                            </label>
                          );
                        })}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      {canEditRaider(r.character_name) ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <select
                            value={r.raid_role ?? ""}
                            onChange={(e) => updateRaider(r.character_name, { raid_role: e.target.value })}
                            className="h-7 min-w-[60px] px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 [color-scheme:dark]"
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
                            className="h-7 w-20 px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 placeholder-slate-500"
                          />
                        </div>
                      ) : (
                        <span className="text-slate-400 text-sm">
                          {[(r.raid_role || "—").charAt(0).toUpperCase() + (r.raid_role || "").slice(1).toLowerCase(), r.primary_spec || "—"].join(" - ")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {canEditRaider(r.character_name) ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <select
                            value={["tank", "healer", "dps"].includes((r.off_spec ?? "").toLowerCase()) ? (r.off_spec ?? "").toLowerCase() : ""}
                            onChange={(e) => updateRaider(r.character_name, { off_spec: e.target.value })}
                            className="h-7 min-w-[60px] px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 [color-scheme:dark]"
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
                            className="h-7 w-20 px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 placeholder-slate-500"
                          />
                        </div>
                      ) : (
                        <span className="text-slate-400 text-sm">
                          {[(r.off_spec || "—").charAt(0).toUpperCase() + (r.off_spec || "").slice(1).toLowerCase(), r.secondary_spec || "—"].join(" - ")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-slate-400">{team ? team.team_name : "—"}</td>
                    <td className="py-2 px-3 align-top">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="flex-1 min-w-0 align-top whitespace-pre-wrap break-words text-sm">
                          {r.notes ? (
                            <div className="text-slate-400 mb-1">
                              <span className="text-slate-500 text-xs uppercase">Player:</span> {r.notes}
                            </div>
                          ) : null}
                          {canEdit && r.officer_notes ? (
                            <div className="text-slate-500">
                              <span className="text-slate-500 text-xs uppercase">Officer:</span> {r.officer_notes}
                            </div>
                          ) : null}
                          {!r.notes && !(canEdit && r.officer_notes) ? (
                            <span className="text-slate-600">—</span>
                          ) : null}
                        </div>
                        {canEditRaider(r.character_name) && (
                          <button
                            type="button"
                            onClick={() => setNotesFor(r.character_name)}
                            className={`shrink-0 w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
                              (r.notes || (canEdit && r.officer_notes)) ? "text-sky-400 hover:bg-sky-500/20" : "text-slate-500 hover:bg-slate-600/50"
                            }`}
                            title="Edit notes"
                          >
                            📝
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

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

      {/* Save toast */}
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
    </div>
  );
}
