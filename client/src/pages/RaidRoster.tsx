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

interface RosterMember {
  name: string;
  class: string;
  level: number;
  role?: string;
  race?: string;
}

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const DEFAULT_AVAILABILITY = "0000000";

interface RaiderEntry {
  character_name: string;
  character_class: string;
  primary_spec?: string;
  off_spec?: string;
  notes?: string;
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
  const [guildRoster, setGuildRoster] = useState<RosterMember[]>([]);
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
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalSearch, setAddModalSearch] = useState("");
  const [addModalClassFilter, setAddModalClassFilter] = useState("");
  const [addModalLevelMin, setAddModalLevelMin] = useState<string>("");
  const [addModalLevelMax, setAddModalLevelMax] = useState<string>("");
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [showManageTeamsModal, setShowManageTeamsModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [selectedAddModalMembers, setSelectedAddModalMembers] = useState<Set<string>>(new Set());
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
      api.get<{ members: RosterMember[] }>(
        `/auth/me/guild-roster?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => r.members),
      api.get<{ characters: import("../api").MyCharacter[] }>("/auth/me/characters").then((r) => r.characters ?? []).catch(() => []),
      api.get<{ raiders: RaiderEntry[] }>(
        `/auth/me/raider-roster?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) =>
        (r.raiders ?? []).map((x: { character_name: string; character_class: string; primary_spec?: string; off_spec?: string; notes?: string; raid_role?: string; raid_lead?: unknown; raid_assist?: unknown; availability?: string }) => ({
          ...x,
          raid_lead: Boolean(x.raid_lead),
          raid_assist: Boolean(x.raid_assist),
          availability: typeof x.availability === "string" ? x.availability.padEnd(7, "0").slice(0, 7) : DEFAULT_AVAILABILITY,
        })
      )),
      api.get<{ teams: RaidTeam[] }>(
        `/auth/me/raid-teams?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => r.teams ?? []),
    ])
      .then(([perms, members, chars, raidersList, teamsList]) => {
        setPermissions(perms);
        setGuildRoster(members);
        setMyCharacters(chars);
        setRaiders(raidersList);
        setTeams(teamsList);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [realm, realmSlug, guildName, serverType]);

  const raiderMap = useMemo(() => {
    const m = new Map<string, RaiderEntry>();
    for (const r of raiders) {
      m.set(r.character_name.toLowerCase(), r);
    }
    return m;
  }, [raiders]);

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
      const ps = (r.primary_spec || "").toLowerCase();
      if (["tank", "healer", "dps"].includes(ps) && ps === rf) return true;
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

  const toggleRaider = (member: RosterMember, add: boolean) => {
    if (!canEdit) return;
    if (add) {
      setRaiders((prev) => [
        ...prev.filter((r) => r.character_name.toLowerCase() !== member.name.toLowerCase()),
        {
          character_name: member.name,
          character_class: member.class,
          primary_spec: "",
          off_spec: "",
          notes: "",
          raid_role: "",
          raid_lead: false,
          raid_assist: false,
          availability: DEFAULT_AVAILABILITY,
        },
      ]);
    } else {
      setRaiders((prev) => prev.filter((r) => r.character_name.toLowerCase() !== member.name.toLowerCase()));
    }
  };

  const updateRaider = (name: string, updates: Partial<RaiderEntry>) => {
    if (!canEditRaider(name)) return;
    const filtered = canEditOwnAvailabilityAndNotes
      ? { ...(updates.availability !== undefined && { availability: updates.availability }), ...(updates.notes !== undefined && { notes: updates.notes }) }
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

  const assignToTeam = async (characterName: string, teamId: number | null) => {
    if (!canEdit) return;
    const nameLower = characterName.toLowerCase();
    const currentTeamId = characterToTeamId.get(nameLower);

    if (teamId === null) {
      if (currentTeamId) {
        const team = teams.find((t) => t.id === currentTeamId);
        if (team) {
          const newMembers = team.members.filter((m) => m.character_name.toLowerCase() !== nameLower);
          await api.put(`/auth/me/raid-teams/${currentTeamId}/members`, { members: newMembers });
          setTeams((prev) =>
            prev.map((t) =>
              t.id === currentTeamId
                ? { ...t, members: t.members.filter((m) => m.character_name.toLowerCase() !== nameLower) }
                : t
            )
          );
        }
      }
      return;
    }

    const team = teams.find((t) => t.id === teamId);
    if (!team) return;

    const raider = raiders.find((r) => r.character_name.toLowerCase() === nameLower);
    if (!raider) return;

    if (currentTeamId === teamId) return;

    if (currentTeamId) {
      const oldTeam = teams.find((t) => t.id === currentTeamId);
      if (oldTeam) {
        const oldMembers = oldTeam.members.filter((m) => m.character_name.toLowerCase() !== nameLower);
        await api.put(`/auth/me/raid-teams/${currentTeamId}/members`, { members: oldMembers });
      }
    }

    const newMembers = [...team.members.filter((m) => m.character_name.toLowerCase() !== nameLower), { character_name: raider.character_name, character_class: raider.character_class }];
    await api.put(`/auth/me/raid-teams/${teamId}/members`, { members: newMembers });
    setTeams((prev) =>
      prev.map((t) => {
        if (t.id === currentTeamId) {
          return { ...t, members: t.members.filter((m) => m.character_name.toLowerCase() !== nameLower) };
        }
        if (t.id === teamId) {
          return { ...t, members: newMembers };
        }
        return t;
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
          notes: r.notes || null,
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
          }));
        if (myUpdates.length > 0) {
          const res = await api.patch<{ raiders: RaiderEntry[] }>("/auth/me/raider-roster/self", {
            guild_name: guildName,
            guild_realm: realm,
            guild_realm_slug: realmSlug,
            server_type: serverType,
            updates: myUpdates,
          });
          setRaiders(
            (res.raiders ?? []).map((x: { character_name?: string; character_class?: string; primary_spec?: string; off_spec?: string; notes?: string; raid_role?: string; raid_lead?: unknown; raid_assist?: unknown; availability?: string }) => ({
              character_name: x.character_name ?? "",
              character_class: x.character_class ?? "",
              primary_spec: x.primary_spec ?? "",
              off_spec: x.off_spec ?? "",
              notes: x.notes ?? "",
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

  const addTeam = async () => {
    if (!canEdit || !newTeamName.trim()) return;
    try {
      const res = await api.post<{ team: RaidTeam }>("/auth/me/raid-teams", {
        guild_name: guildName,
        guild_realm: realm,
        guild_realm_slug: realm,
        server_type: serverType,
        team_name: newTeamName.trim(),
      });
      setTeams((prev) => [...prev, res.team]);
      setNewTeamName("");
    } catch {
      // ignore
    }
  };

  const deleteTeam = async (teamId: number) => {
    if (!canEdit) return;
    const team = teams.find((t) => t.id === teamId);
    if (!team || !confirm(`Delete team "${team.team_name}"? Raiders will be unassigned from this team (they remain on the roster).`)) return;
    try {
      await api.delete(`/auth/me/raid-teams/${teamId}`);
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
      if (teamFilter === team.team_name) setTeamFilter("");
    } catch {
      // ignore
    }
  };

  const unassignedGuildMembers = useMemo(() => {
    return guildRoster
      .filter((m) => !raiderMap.has(m.name.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [guildRoster, raiderMap]);

  const guildMaxLevel = useMemo(() => {
    if (!guildRoster.length) return 80;
    return Math.max(...guildRoster.map((m) => m.level));
  }, [guildRoster]);

  const addModalMaxLevel = useMemo(() => {
    if (!unassignedGuildMembers.length) return guildMaxLevel;
    return Math.max(...unassignedGuildMembers.map((m) => m.level));
  }, [unassignedGuildMembers, guildMaxLevel]);

  const filteredAddModalMembers = useMemo(() => {
    const q = addModalSearch.trim().toLowerCase();
    const minLvl = addModalLevelMin.trim() ? parseInt(addModalLevelMin, 10) : null;
    const maxLvl = addModalLevelMax.trim() ? parseInt(addModalLevelMax, 10) : null;
    return unassignedGuildMembers.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (addModalClassFilter && m.class !== addModalClassFilter) return false;
      if (minLvl != null && !isNaN(minLvl) && m.level < minLvl) return false;
      if (maxLvl != null && !isNaN(maxLvl) && m.level > maxLvl) return false;
      return true;
    });
  }, [unassignedGuildMembers, addModalSearch, addModalClassFilter, addModalLevelMin, addModalLevelMax]);

  const addModalClassList = useMemo(() => {
    const set = new Set(unassignedGuildMembers.map((m) => m.class));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [unassignedGuildMembers]);

  const openAddModal = () => {
    const maxLvl = addModalMaxLevel;
    setAddModalLevelMin(String(maxLvl));
    setAddModalLevelMax(String(maxLvl));
    setAddModalSearch("");
    setAddModalClassFilter("");
    setSelectedAddModalMembers(new Set());
    setShowAddModal(true);
  };

  const toggleAddModalMemberSelection = (name: string) => {
    const key = name.toLowerCase();
    setSelectedAddModalMembers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllAddModalMembers = () => {
    setSelectedAddModalMembers(new Set(filteredAddModalMembers.map((m) => m.name.toLowerCase())));
  };

  const clearAddModalSelection = () => setSelectedAddModalMembers(new Set());

  const addSelectedMembers = () => {
    const toAdd = filteredAddModalMembers.filter((m) => selectedAddModalMembers.has(m.name.toLowerCase()));
    if (toAdd.length === 0) return;
    for (const m of toAdd) {
      toggleRaider(m, true);
    }
    setSelectedAddModalMembers(new Set());
    setShowAddModal(false);
  };

  const selectedAddModalCount = filteredAddModalMembers.filter((m) =>
    selectedAddModalMembers.has(m.name.toLowerCase())
  ).length;

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
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Raider Roster" />

        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-sky-400">{guildName}</h1>
          <p className="text-slate-400 text-sm mt-1">
            Raider Roster · {capitalizeRealm(realm)} · {serverType}
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
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowManageTeamsModal(true)}
                    className="h-8 px-3 rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 text-sm font-medium inline-flex items-center justify-center leading-none"
                  >
                    Manage Teams
                  </button>
                  <button
                    type="button"
                    onClick={openAddModal}
                    className="h-8 px-3 rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 text-sm font-medium inline-flex items-center justify-center leading-none"
                  >
                    + Add from Guild
                  </button>
                </>
              )}
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
              <div className="sticky top-0 z-10 grid grid-cols-[40px_minmax(140px,2fr)_minmax(320px,3fr)_110px_110px_80px_40px_40px_40px] gap-x-2 gap-y-0 px-4 py-2 h-10 bg-slate-800/95 backdrop-blur-sm border-b border-slate-700/60 text-slate-400 text-xs font-medium uppercase tracking-wider min-w-[900px] items-center shrink-0">
                <span className="flex items-center justify-center" title="Remove this player from the roster.">×</span>
                <span className="truncate" title="The character or player assigned to the roster.">Player</span>
                <span className="truncate" title="Days this player is available to participate in raids.">General Availability</span>
                <span className="truncate" title="The player's primary role for this raid.">Role</span>
                <span className="truncate" title="A secondary role the player can switch to if needed.">Off Role</span>
                <span className="truncate" title="The raid team this player is assigned to.">Team</span>
                <span className="flex items-center justify-center" title="Marks this player as the raid leader.">Lead</span>
                <span className="flex items-center justify-center" title="Marks this player as a raid assistant.">Assist</span>
                <span className="flex items-center justify-center" title="Add or edit notes for this player.">📝</span>
              </div>
              {raiders.length === 0 ? (
                <div className="p-12 text-center text-slate-500">
                  <p>No raiders yet.</p>
                  {canEdit && <p className="text-sm mt-2">Click &quot;+ Add from Guild&quot; to add members.</p>}
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
                      className="group grid grid-cols-[40px_minmax(140px,2fr)_minmax(320px,3fr)_110px_110px_80px_40px_40px_40px] gap-x-2 gap-y-0 px-4 py-0 h-10 min-h-10 items-center border-b border-slate-700/30 min-w-[900px] hover:bg-slate-700/20 transition-colors"
                      style={{ borderLeftWidth: 4, borderLeftColor: classColor }}
                    >
                      {/* Remove */}
                      <span className="flex items-center justify-center shrink-0">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => toggleRaider({ name: r.character_name, class: r.character_class, level: 0 }, false)}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/20 transition-colors"
                            title="Remove this player from the roster."
                          >
                            ×
                          </button>
                        ) : (
                          <span className="w-7" />
                        )}
                      </span>
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
                      {/* Role */}
                      <span className="min-w-0 shrink-0">
                        {canEdit ? (
                          <select
                            value={r.raid_role ?? ""}
                            onChange={(e) => updateRaider(r.character_name, { raid_role: e.target.value })}
                            className="h-7 w-full min-w-0 max-w-[110px] px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 truncate"
                          >
                            {RAID_ROLES.map((opt) => (
                              <option key={opt.value || "_"} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-400 text-sm truncate block">
                            {(r.raid_role || "").toLowerCase() === "dps" ? "DPS" : (r.raid_role || "—").charAt(0).toUpperCase() + (r.raid_role || "").slice(1)}
                          </span>
                        )}
                      </span>
                      {/* Off Role */}
                      <span className="min-w-0 shrink-0">
                        {canEdit ? (
                          <select
                            value={["tank", "healer", "dps"].includes((r.primary_spec ?? "").toLowerCase()) ? (r.primary_spec ?? "").toLowerCase() : ""}
                            onChange={(e) => updateRaider(r.character_name, { primary_spec: e.target.value })}
                            className="h-7 w-full min-w-0 max-w-[110px] px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 truncate"
                          >
                            {RAID_ROLES.map((opt) => (
                              <option key={opt.value || "_"} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-400 text-sm truncate block">
                            {(() => {
                              const p = (r.primary_spec ?? "").toLowerCase();
                              if (p === "dps") return "DPS";
                              if (p === "tank") return "Tank";
                              if (p === "healer") return "Healer";
                              return p ? (r.primary_spec || "").charAt(0).toUpperCase() + (r.primary_spec || "").slice(1) : "—";
                            })()}
                          </span>
                        )}
                      </span>
                      {/* Team */}
                      <span className="min-w-0 shrink-0">
                        {canEdit ? (
                          <select
                            value={teamId ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              assignToTeam(r.character_name, v ? parseInt(v, 10) : null);
                            }}
                            className="h-7 w-full min-w-0 max-w-[80px] px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 truncate"
                          >
                            <option value="">—</option>
                            {teams.map((t) => (
                              <option key={t.id} value={t.id}>{t.team_name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-400 text-sm truncate block">{team ? team.team_name : "—"}</span>
                        )}
                      </span>
                      {/* Lead */}
                      <span className="flex items-center justify-center shrink-0">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => updateRaider(r.character_name, { raid_lead: !r.raid_lead })}
                            className={`w-7 h-7 flex items-center justify-center rounded text-xs transition-colors ${r.raid_lead ? "text-sky-400 bg-sky-500/20" : "text-slate-500 hover:text-sky-400/80"}`}
                            title="Raid Lead"
                          >
                            ★
                          </button>
                        ) : (
                          <span className="text-xs w-7 flex justify-center">{r.raid_lead ? "★" : "—"}</span>
                        )}
                      </span>
                      {/* Assist */}
                      <span className="flex items-center justify-center shrink-0">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => updateRaider(r.character_name, { raid_assist: !r.raid_assist })}
                            className={`w-7 h-7 flex items-center justify-center rounded text-xs transition-colors ${r.raid_assist ? "text-sky-400 bg-sky-500/20" : "text-slate-500 hover:text-sky-400/80"}`}
                            title="Raid Assist"
                          >
                            🛡
                          </button>
                        ) : (
                          <span className="text-xs w-7 flex justify-center">{r.raid_assist ? "🛡" : "—"}</span>
                        )}
                      </span>
                      {/* Notes */}
                      <span className="flex items-center justify-center shrink-0">
                        <button
                          type="button"
                          onClick={() => setNotesFor(r.character_name)}
                          className={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
                            r.notes ? "text-sky-400 hover:bg-sky-500/20" : "text-slate-500 hover:bg-slate-600/50"
                          }`}
                          title={r.notes ? `Notes: ${r.notes}` : "Add or edit notes for this player."}
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

        {/* Manage Teams modal */}
        {showManageTeamsModal && canEdit && (
          <>
            <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setShowManageTeamsModal(false)} aria-hidden />
            <div className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-md bg-slate-800 border border-slate-600 rounded-xl shadow-xl z-50 overflow-hidden flex flex-col">
              <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                <h3 className="font-medium text-sky-400">Manage Teams</h3>
                <button type="button" onClick={() => setShowManageTeamsModal(false)} className="text-slate-400 hover:text-slate-200 text-xl leading-none">×</button>
              </div>
              <div className="p-4 flex flex-col gap-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addTeam()}
                    placeholder="New team name"
                    className="flex-1 px-3 py-2 rounded bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm focus:ring-1 focus:ring-sky-500/50"
                  />
                  <button
                    type="button"
                    onClick={addTeam}
                    disabled={!newTeamName.trim()}
                    className="h-9 px-3 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium shrink-0"
                  >
                    Add
                  </button>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-2">Teams (deleting only removes assignments; raiders stay on the roster)</p>
                  <ul className="space-y-1 max-h-48 overflow-y-auto">
                    {teams.length === 0 ? (
                      <li className="text-slate-500 text-sm py-2">No teams yet.</li>
                    ) : (
                      teams.map((t) => (
                        <li
                          key={t.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-slate-700/50 border border-slate-600"
                        >
                          <span className="text-slate-200 truncate">{t.team_name}</span>
                          <button
                            type="button"
                            onClick={() => deleteTeam(t.id)}
                            className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/20 transition-colors"
                            title={`Delete team "${t.team_name}"`}
                          >
                            ×
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </>
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
                <div className="p-4">
                  {canEditRaider(r?.character_name ?? "") && r ? (
                    <textarea
                      value={r.notes ?? ""}
                      onChange={(e) => updateRaider(r.character_name, { notes: e.target.value })}
                      placeholder="Add notes..."
                      rows={5}
                      className="w-full px-3 py-2 rounded bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm resize-y focus:ring-1 focus:ring-sky-500/50"
                    />
                  ) : r ? (
                    <p className="text-slate-300 text-sm whitespace-pre-wrap">{r.notes || "No notes."}</p>
                  ) : (
                    <p className="text-slate-500 text-sm">Character not found.</p>
                  )}
                </div>
              </div>
            </>
          );
        })()}

        {/* Add from Guild modal */}
        {showAddModal && (
          <>
            <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setShowAddModal(false)} aria-hidden />
            <div className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-md bg-slate-800 border border-slate-600 rounded-xl shadow-xl z-50 overflow-hidden flex flex-col">
              <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                <h3 className="font-medium text-sky-300">Add from Guild</h3>
                <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-200 text-xl leading-none">×</button>
              </div>
              <div className="p-4 border-b border-slate-700 space-y-2">
                <input
                  type="text"
                  placeholder="Search by name..."
                  value={addModalSearch}
                  onChange={(e) => setAddModalSearch(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm focus:ring-1 focus:ring-sky-500/50"
                />
                <div className="flex gap-2">
                  <select
                    value={addModalClassFilter}
                    onChange={(e) => setAddModalClassFilter(e.target.value)}
                    className="h-8 px-2.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm flex-1 focus:ring-1 focus:ring-sky-500/50"
                  >
                    <option value="">All classes</option>
                    {addModalClassList.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 text-xs shrink-0">Lvl</span>
                    <input
                      type="number"
                      min={1}
                      max={guildMaxLevel}
                      value={addModalLevelMin}
                      onChange={(e) => setAddModalLevelMin(e.target.value)}
                      placeholder="Min"
                      className="w-14 h-8 px-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm"
                    />
                    <span className="text-slate-500">–</span>
                    <input
                      type="number"
                      min={1}
                      max={guildMaxLevel}
                      value={addModalLevelMax}
                      onChange={(e) => setAddModalLevelMax(e.target.value)}
                      placeholder="Max"
                      className="w-14 h-8 px-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 max-h-64">
                {unassignedGuildMembers.length === 0 ? (
                  <p className="text-slate-500 text-sm">All guild members are already in the roster.</p>
                ) : filteredAddModalMembers.length === 0 ? (
                  <p className="text-slate-500 text-sm">No guild members match the current filters.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <button
                        type="button"
                        onClick={selectAllAddModalMembers}
                        className="px-2 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={clearAddModalSelection}
                        className="px-2 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={addSelectedMembers}
                        disabled={selectedAddModalCount === 0}
                        className="ml-auto px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
                      >
                        Add selected {selectedAddModalCount > 0 ? `(${selectedAddModalCount})` : ""}
                      </button>
                    </div>
                    <div className="space-y-1">
                      {filteredAddModalMembers.map((m) => {
                        const cc = getClassColor(m.class);
                        const isSelected = selectedAddModalMembers.has(m.name.toLowerCase());
                        return (
                          <div
                            key={m.name}
                            className="flex items-center gap-2 px-3 py-2 rounded hover:bg-slate-700/50"
                            style={{ borderLeftWidth: 4, borderLeftColor: cc }}
                          >
                            <label className="shrink-0 flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleAddModalMemberSelection(m.name)}
                                className="rounded border-slate-600 bg-slate-700 text-sky-500 focus:ring-sky-500/50"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => { toggleRaider(m, true); setShowAddModal(false); }}
                              className="flex-1 text-left min-w-0"
                            >
                              <span className="font-medium" style={{ color: cc }}>{m.name}</span>
                              <span className="text-slate-500 text-sm"> · Lv{m.level} · {m.class}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}

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
