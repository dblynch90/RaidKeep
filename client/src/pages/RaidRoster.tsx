import { useState, useEffect, useMemo } from "react";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import type { GuildPermissions } from "./GuildPermissions";
import { DEFAULT_PERMISSIONS } from "./GuildPermissions";
import { getClassColor } from "../utils/classColors";
import { capitalizeRealm } from "../utils/realm";
import { useGuildParams } from "../hooks/useGuildParams";
import { guildQueryStringFromSlug, guildRealmQueryString } from "../utils/guildApi";
import type { RaiderEntry, RaidTeam } from "../types/raid";
import { RAID_ROLES, DAYS, DEFAULT_AVAILABILITY } from "../constants/raid";
import { getSpecsForClass } from "../constants/specs";

interface RosterMember {
  name: string;
  class: string;
  level: number;
  role?: string;
  race?: string;
}

export function RaidRoster() {
  const { realm, guildName, serverType, realmSlug, isValid } = useGuildParams();

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
  const [guildRoster, setGuildRoster] = useState<RosterMember[]>([]);
  const [characterSearchName, setCharacterSearchName] = useState("");
  const [characterSearchResult, setCharacterSearchResult] = useState<{ name: string; class: string; level: number } | null>(null);
  const [characterSearching, setCharacterSearching] = useState(false);
  const [characterSearchError, setCharacterSearchError] = useState<string | null>(null);
  const [guildMemberSearch, setGuildMemberSearch] = useState("");
  const [guildClassFilter, setGuildClassFilter] = useState("");
  const [guildMemberFilter, setGuildMemberFilter] = useState<"all" | "raider" | "non-raider">("all");
  const [selectedGuildMembers, setSelectedGuildMembers] = useState<Set<string>>(new Set());
  const [teamNameDrafts, setTeamNameDrafts] = useState<Record<number, string>>({});
  const [teamsToDelete, setTeamsToDelete] = useState<Set<number>>(new Set());
  const [rosterTab, setRosterTab] = useState<"roster" | "guild" | "realm" | "teams">("roster");

  const perms = permissions ?? (loading ? { ...DEFAULT_PERMISSIONS, manage_raid_roster: false } : DEFAULT_PERMISSIONS);
  const canEdit = perms.manage_raid_roster;
  const canEditOwnAvailabilityAndNotes =
    perms.view_raid_roster && !canEdit;
  const myCharacterNames = useMemo(
    () => new Set(myCharacters.map((c) => c.name.toLowerCase())),
    [myCharacters]
  );
  const canEditRaider = (characterName: string) =>
    canEdit || (canEditOwnAvailabilityAndNotes && myCharacterNames.has(characterName.toLowerCase()));

  useEffect(() => {
    if (!isValid) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    setLoading(true);
    setError(null);
    const permsQs = guildQueryStringFromSlug({ realmSlug, guildName, serverType });
    const rosterQs = guildRealmQueryString({ realm, guildName, serverType });
    Promise.all([
      api.get<{ permissions: GuildPermissions }>(`/auth/me/guild-permissions?${permsQs}`).then((r) => r.permissions).catch(() => DEFAULT_PERMISSIONS),
      api.get<{ characters: import("../api").MyCharacter[] }>("/auth/me/characters").then((r) => r.characters ?? []).catch(() => []),
      api.get<{ raiders: Array<Omit<RaiderEntry, "notes_public"> & { notes_public?: number; raid_lead?: unknown; raid_assist?: unknown; availability?: string }> }>(
        `/auth/me/raider-roster?${rosterQs}`
      ).then((r) =>
        (r.raiders ?? []).map((x) => ({
          ...x,
          raid_lead: Boolean(x.raid_lead),
          raid_assist: Boolean(x.raid_assist),
          notes_public: x.notes_public === 1,
          availability: typeof x.availability === "string" ? x.availability.padEnd(7, "0").slice(0, 7) : DEFAULT_AVAILABILITY,
        })
      )),
      api.get<{ teams: RaidTeam[] }>(`/auth/me/raid-teams?${rosterQs}`).then((r) => r.teams ?? []),
      api.get<{ members: RosterMember[] }>(`/auth/me/guild-roster?${permsQs}`).then((r) => r.members ?? []).catch(() => []),
    ])
      .then(([perms, chars, raidersList, teamsList, guildList]) => {
        setPermissions(perms);
        setMyCharacters(chars);
        setRaiders(raidersList);
        setTeams(teamsList);
        setGuildRoster(guildList);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [realmSlug, guildName, serverType, realm, isValid]);

  const characterToTeamId = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of teams) {
      for (const mbr of t.members) {
        m.set(mbr.character_name.toLowerCase(), t.id);
      }
    }
    return m;
  }, [teams]);

  const raiderMap = useMemo(() => {
    const m = new Map<string, RaiderEntry>();
    for (const r of raiders) m.set(r.character_name.toLowerCase(), r);
    return m;
  }, [raiders]);

  const guildClassList = useMemo(() => {
    const set = new Set(guildRoster.map((m) => m.class));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [guildRoster]);

  const displayGuildMembers = useMemo(() => {
    const q = guildMemberSearch.trim().toLowerCase();
    return [...guildRoster]
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .filter((m) => !guildClassFilter || m.class === guildClassFilter)
      .filter((m) => {
        const isRaider = raiderMap.has(m.name.toLowerCase());
        if (guildMemberFilter === "raider") return isRaider;
        if (guildMemberFilter === "non-raider") return !isRaider;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [guildRoster, guildClassFilter, guildMemberSearch, guildMemberFilter, raiderMap]);

  const selectedNonRaiderCount = useMemo(() => {
    return displayGuildMembers.filter(
      (m) => !raiderMap.has(m.name.toLowerCase()) && selectedGuildMembers.has(m.name.toLowerCase())
    ).length;
  }, [displayGuildMembers, raiderMap, selectedGuildMembers]);

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

  const saveRaiderRoster = async (raidersToSave?: RaiderEntry[]) => {
    const list = raidersToSave ?? raiders;
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
          raiders: list.map((r) => ({
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
        const myUpdates = list
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
          await api.patch("/auth/me/raider-roster/self", {
            guild_name: guildName,
            guild_realm: realm,
            guild_realm_slug: realmSlug,
            server_type: serverType,
            updates: myUpdates,
          });
          // Re-fetch roster from GET to ensure full roster is displayed (PATCH response can be inconsistent)
          const rosterQs = guildRealmQueryString({ realm, guildName, serverType });
          const r = await api.get<{ raiders: Array<Omit<RaiderEntry, "notes_public"> & { notes_public?: number; raid_lead?: unknown; raid_assist?: unknown; availability?: string }> }>(
            `/auth/me/raider-roster?${rosterQs}`
          );
          setRaiders(
            (r.raiders ?? []).map((x) => ({
              ...x,
              raid_lead: Boolean(x.raid_lead),
              raid_assist: Boolean(x.raid_assist),
              notes_public: x.notes_public === 1,
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

  const handleSave = () => saveRaiderRoster();

  const toggleRaider = (member: RosterMember, add: boolean) => {
    if (!canEdit) return;
    let newRaiders: RaiderEntry[];
    if (add) {
      newRaiders = [
        ...raiders.filter((r) => r.character_name.toLowerCase() !== member.name.toLowerCase()),
        {
          character_name: member.name,
          character_class: member.class,
          primary_spec: "",
          off_spec: "",
          secondary_spec: "",
          notes: "",
          officer_notes: "",
          notes_public: false,
          raid_role: "",
          raid_lead: false,
          raid_assist: false,
          availability: DEFAULT_AVAILABILITY,
        },
      ];
    } else {
      newRaiders = raiders.filter((r) => r.character_name.toLowerCase() !== member.name.toLowerCase());
    }
    setRaiders(newRaiders);
    saveRaiderRoster(newRaiders);
  };

  const addSelectedMembers = () => {
    if (!canEdit) return;
    const toAdd = displayGuildMembers.filter(
      (m) => !raiderMap.has(m.name.toLowerCase()) && selectedGuildMembers.has(m.name.toLowerCase())
    );
    if (toAdd.length === 0) return;
    const existing = new Set(raiders.map((r) => r.character_name.toLowerCase()));
    const newRaiders = [
      ...raiders,
      ...toAdd.filter((m) => !existing.has(m.name.toLowerCase())).map((m) => ({
        character_name: m.name,
        character_class: m.class,
        primary_spec: "",
        off_spec: "",
        secondary_spec: "",
        notes: "",
        officer_notes: "",
        notes_public: false,
        raid_role: "",
        raid_lead: false,
        raid_assist: false,
        availability: DEFAULT_AVAILABILITY,
      })),
    ];
    setRaiders(newRaiders);
    setSelectedGuildMembers(new Set());
    saveRaiderRoster(newRaiders);
  };

  const toggleGuildMemberSelection = (name: string) => {
    if (!canEdit) return;
    const key = name.toLowerCase();
    if (raiderMap.has(key)) return;
    setSelectedGuildMembers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const searchCharacter = async () => {
    const name = characterSearchName.trim();
    if (!name) return;
    setCharacterSearchError(null);
    setCharacterSearchResult(null);
    setCharacterSearching(true);
    try {
      const result = await api.get<{ name: string; class: string; level: number }>(
        `/auth/me/character-search?realm=${encodeURIComponent(realmSlug)}&character_name=${encodeURIComponent(name)}&server_type=${encodeURIComponent(serverType)}`
      );
      setCharacterSearchResult(result);
    } catch (err: unknown) {
      setCharacterSearchError(err instanceof Error ? err.message : "Character not found");
    } finally {
      setCharacterSearching(false);
    }
  };

  const addSearchedCharacter = async () => {
    if (!characterSearchResult || !canEdit) return;
    setCharacterSearching(true);
    setCharacterSearchError(null);
    try {
      const { raider } = await api.post<{ raider: RaiderEntry & { notes_public?: number; raid_lead?: number; raid_assist?: number } }>(
        "/auth/me/raider-roster-add-character",
        {
          guild_name: guildName,
          guild_realm_slug: realmSlug,
          server_type: serverType,
          character_name: characterSearchResult.name,
        }
      );
      setRaiders((prev) => [
        ...prev,
        {
          character_name: raider.character_name,
          character_class: raider.character_class,
          primary_spec: raider.primary_spec ?? "",
          off_spec: raider.off_spec ?? "",
          secondary_spec: raider.secondary_spec ?? "",
          notes: raider.notes ?? "",
          officer_notes: raider.officer_notes ?? "",
          raid_role: raider.raid_role ?? "",
          raid_lead: Boolean(raider.raid_lead),
          raid_assist: Boolean(raider.raid_assist),
          availability: (raider.availability as string) ?? DEFAULT_AVAILABILITY,
          notes_public: raider.notes_public === 1,
        },
      ]);
      setCharacterSearchResult(null);
      setCharacterSearchName("");
      setSaveMsg("Saved.");
    } catch (err: unknown) {
      setCharacterSearchError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setCharacterSearching(false);
    }
  };

  const updateTeamMembersLocal = (teamId: number, members: Array<{ character_name: string; character_class: string }>) => {
    if (!canEdit) return;
    setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, members } : t)));
  };

  const assignRaiderToTeam = (characterName: string, characterClass: string, newTeamId: number | null) => {
    if (!canEdit) return;
    const currentTeamId = characterToTeamId.get(characterName.toLowerCase());
    if (currentTeamId) {
      const team = teams.find((t) => t.id === currentTeamId);
      if (team) {
        const next = team.members.filter((m) => m.character_name.toLowerCase() !== characterName.toLowerCase());
        updateTeamMembersLocal(currentTeamId, next);
      }
    }
    if (newTeamId) {
      const team = teams.find((t) => t.id === newTeamId);
      if (team) {
        const next = [...team.members, { character_name: characterName, character_class: characterClass }];
        updateTeamMembersLocal(newTeamId, next);
      }
    }
  };

  const createTeam = async () => {
    if (!canEdit) return;
    const name = prompt("Team name:");
    if (!name?.trim()) return;
    try {
      const res = await api.post<{ team: RaidTeam }>("/auth/me/raid-teams", {
        guild_name: guildName,
        guild_realm: realm,
        guild_realm_slug: realmSlug,
        server_type: serverType,
        team_name: name.trim(),
      });
      setTeams((prev) => [...prev, res.team]);
    } catch {
      // ignore
    }
  };

  const deleteTeamLocal = (teamId: number) => {
    if (!canEdit || !confirm("Delete this team?")) return;
    setTeamsToDelete((prev) => new Set(prev).add(teamId));
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
    setTeamNameDrafts((d) => {
      const next = { ...d };
      delete next[teamId];
      return next;
    });
  };

  const saveTeams = async () => {
    if (!canEdit) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const teamsToSave = teams.filter((t) => !teamsToDelete.has(t.id));
      for (const teamId of teamsToDelete) {
        try {
          await api.delete(`/auth/me/raid-teams/${teamId}`);
        } catch (err) {
          setSaveMsg(err instanceof Error ? err.message : "Failed to delete team");
          setSaving(false);
          return;
        }
      }
      setTeamsToDelete(new Set());
      for (const team of teamsToSave) {
        const name = (teamNameDrafts[team.id] ?? team.team_name).trim();
        if (name && name !== team.team_name) {
          try {
            await api.patch(`/auth/me/raid-teams/${team.id}`, { team_name: name });
            setTeams((prev) => prev.map((t) => (t.id === team.id ? { ...t, team_name: name } : t)));
          } catch (err) {
            setSaveMsg(err instanceof Error ? err.message : "Failed to update team name");
            setSaving(false);
            return;
          }
        }
        try {
          await api.put(`/auth/me/raid-teams/${team.id}/members`, { members: team.members });
        } catch (err) {
          setSaveMsg(err instanceof Error ? err.message : "Failed to update team members");
          setSaving(false);
          return;
        }
      }
      setTeamNameDrafts({});
      setSaveMsg("Saved.");
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

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

  if (error) {
    return (
      <div className="rk-page-bg text-slate-100" >
        <main className="rk-page-main">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  if (!loading && !perms.view_raid_roster) {
    return (
      <div className="rk-page-bg text-slate-100" >
        <main className="rk-page-main">
          <p className="text-amber-500">You do not have permission to view the raider roster.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="rk-page-bg text-slate-100" >
      <main className="rk-page-main">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Raid Roster" />

        <header className="mb-4 sm:mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold text-sky-400 truncate">{guildName}</h1>
              <p className="text-slate-400 text-xs sm:text-sm mt-1 truncate">
                Raid Roster · {capitalizeRealm(realm)} · {serverType}
                {!loading && ` · ${raiders.length} raider${raiders.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <button
                type="button"
                onClick={() => {
                  const url = `${window.location.origin}/raid-roster-popout?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
                  window.open(url, "raid-roster-popout", "width=1400,height=900,scrollbars=yes,resizable=yes");
                }}
                className="h-11 min-h-[44px] sm:h-auto px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium text-sm shrink-0 border border-slate-600"
                title="Open roster in a separate window"
              >
                ⧉ Open Fullscreen Roster
              </button>
            </div>
          </div>
          <div className="mt-3 sm:mt-4 h-px bg-slate-700/60" />
        </header>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <div className="rounded-xl border border-white/[0.05] overflow-hidden rk-card-panel">
            {/* Tab nav (officers) + Filters (roster tab) */}
            <div className="p-3 border-b border-slate-700/60 space-y-3">
              {canEdit && (
                <nav className="flex rounded-lg bg-slate-800/60 p-1 border border-slate-700/50">
                  <button
                    type="button"
                    onClick={() => setRosterTab("roster")}
                    className={`flex-1 min-h-[44px] sm:min-h-0 px-3 py-2.5 sm:py-2 rounded-md text-sm font-medium transition flex items-center justify-center ${rosterTab === "roster" ? "text-slate-200 bg-[#223657] border-b-2 border-sky-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"}`}
                  >
                    Roster
                  </button>
                  <button
                    type="button"
                    onClick={() => setRosterTab("guild")}
                    className={`flex-1 min-h-[44px] sm:min-h-0 px-3 py-2.5 sm:py-2 rounded-md text-sm font-medium transition flex items-center justify-center ${rosterTab === "guild" ? "text-white bg-emerald-700/80 border-b-2 border-emerald-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"}`}
                  >
                    Add from Guild
                  </button>
                  <button
                    type="button"
                    onClick={() => setRosterTab("realm")}
                    className={`flex-1 min-h-[44px] sm:min-h-0 px-3 py-2.5 sm:py-2 rounded-md text-sm font-medium transition flex items-center justify-center ${rosterTab === "realm" ? "text-white bg-amber-600/90 border-b-2 border-amber-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"}`}
                    title="Search for a character on the realm"
                  >
                    Add from Realm
                  </button>
                  <button
                    type="button"
                    onClick={() => setRosterTab("teams")}
                    className={`flex-1 min-h-[44px] sm:min-h-0 px-3 py-2.5 sm:py-2 rounded-md text-sm font-medium transition flex items-center justify-center ${rosterTab === "teams" ? "text-white bg-violet-700/80 border-b-2 border-violet-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"}`}
                    title="Create and manage raid teams"
                  >
                    Raid Teams
                  </button>
                </nav>
              )}
              {rosterTab === "roster" && (
                <div className="flex flex-wrap items-center gap-2">
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
                      className="h-11 min-h-[44px] sm:h-8 sm:min-h-0 px-4 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-sm inline-flex items-center justify-center leading-none border border-sky-500/50"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Roster tab: Table */}
            {rosterTab === "roster" && (
            <>
            {/* Table container - header sticks during scroll; scroll horizontally on mobile */}
            <div className="max-h-[60vh] overflow-auto overflow-x-auto rk-scroll-x">
              {/* Table header - sticky */}
              <div className={`sticky top-0 z-10 grid gap-x-2 gap-y-0 px-4 py-2 h-10 bg-slate-800/95 backdrop-blur-sm border-b border-slate-700/60 text-slate-400 text-xs font-medium uppercase tracking-wider min-w-[1040px] items-center shrink-0 ${canEdit ? "grid-cols-[32px_minmax(105px,1.55fr)_minmax(290px,2.775fr)_minmax(200px,1.4fr)_minmax(200px,1.4fr)_80px_40px]" : "grid-cols-[minmax(105px,1.55fr)_minmax(290px,2.775fr)_minmax(200px,1.4fr)_minmax(200px,1.4fr)_80px_40px]"}`}>
                {canEdit && <span />}
                <span className="truncate" title="The character or player assigned to the roster.">Player</span>
                <span className="truncate" title="Days this player is available to participate in raids.">General Availability</span>
                <span className="truncate" title="Primary role and spec">Primary Role/Spec</span>
                <span className="truncate" title="Secondary role and spec">Secondary Role/Spec</span>
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
                      className={`group grid gap-x-2 gap-y-0 px-4 py-0 h-10 min-h-10 items-center border-b border-slate-700/30 min-w-[1040px] hover:bg-slate-700/20 transition-colors ${canEdit ? "grid-cols-[32px_minmax(105px,1.55fr)_minmax(290px,2.775fr)_minmax(200px,1.4fr)_minmax(200px,1.4fr)_80px_40px]" : "grid-cols-[minmax(105px,1.55fr)_minmax(290px,2.775fr)_minmax(200px,1.4fr)_minmax(200px,1.4fr)_80px_40px]"}`}
                      style={{ borderLeftWidth: 4, borderLeftColor: classColor }}
                    >
                      {canEdit && (
                        <div className="flex items-center justify-center">
                          <button
                            type="button"
                            onClick={() => toggleRaider({ name: r.character_name, class: r.character_class, level: 0 }, false)}
                            className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors text-base leading-none"
                            title="Remove from roster"
                            aria-label="Remove from roster"
                          >
                            ×
                          </button>
                        </div>
                      )}
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
                      {/* Primary Role/Spec */}
                      <span className="min-w-0 flex items-center gap-1.5 flex-nowrap overflow-hidden">
                        {canEditRaider(r.character_name) ? (
                          <>
                            <select
                              value={r.raid_role ?? ""}
                              onChange={(e) => updateRaider(r.character_name, { raid_role: e.target.value })}
                              className="h-7 min-w-[60px] shrink-0 px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 [color-scheme:dark]"
                              title="Primary role"
                            >
                              {RAID_ROLES.map((opt) => (
                                <option key={opt.value || "_"} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            <select
                              value={r.primary_spec ?? ""}
                              onChange={(e) => updateRaider(r.character_name, { primary_spec: e.target.value })}
                              className="h-7 flex-1 min-w-0 px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 [color-scheme:dark]"
                              title="Primary spec"
                            >
                              <option value="">—</option>
                              {getSpecsForClass(r.character_class, r.primary_spec ?? undefined).map((spec) => (
                                <option key={spec} value={spec}>{spec}</option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <span className="text-slate-400 text-sm truncate">
                            {[(r.raid_role || "—").charAt(0).toUpperCase() + (r.raid_role || "").slice(1).toLowerCase(), r.primary_spec || "—"].filter(Boolean).join(" – ")}
                          </span>
                        )}
                      </span>
                      {/* Secondary Role/Spec */}
                      <span className="min-w-0 flex items-center gap-1.5 flex-nowrap overflow-hidden">
                        {canEditRaider(r.character_name) ? (
                          <>
                            <select
                              value={["tank", "healer", "dps"].includes((r.off_spec ?? "").toLowerCase()) ? (r.off_spec ?? "").toLowerCase() : ""}
                              onChange={(e) => updateRaider(r.character_name, { off_spec: e.target.value })}
                              className="h-7 min-w-[60px] shrink-0 px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 [color-scheme:dark]"
                              title="Secondary role"
                            >
                              {RAID_ROLES.map((opt) => (
                                <option key={opt.value || "_"} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            <select
                              value={r.secondary_spec ?? ""}
                              onChange={(e) => updateRaider(r.character_name, { secondary_spec: e.target.value })}
                              className="h-7 flex-1 min-w-0 px-1.5 rounded bg-slate-700/80 border border-slate-600 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500/50 [color-scheme:dark]"
                              title="Secondary spec"
                            >
                              <option value="">—</option>
                              {getSpecsForClass(r.character_class, r.secondary_spec ?? undefined).map((spec) => (
                                <option key={spec} value={spec}>{spec}</option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <span className="text-slate-400 text-sm truncate">
                            {[(r.off_spec || "—").charAt(0).toUpperCase() + (r.off_spec || "").slice(1).toLowerCase(), r.secondary_spec || "—"].filter(Boolean).join(" – ")}
                          </span>
                        )}
                      </span>
                      {/* Team */}
                      <span className="min-w-0 shrink-0">
                        {canEdit && teams.length > 0 ? (
                          <select
                            value={teamId ?? "none"}
                            onChange={(e) => {
                              const v = e.target.value;
                              assignRaiderToTeam(r.character_name, r.character_class, v === "none" ? null : parseInt(v, 10));
                            }}
                            className="px-2 py-1 rounded bg-slate-700 border border-slate-600 text-slate-200 text-xs min-w-[80px] focus:ring-1 focus:ring-sky-500/50 [color-scheme:dark]"
                          >
                            <option value="none">No team</option>
                            {teams.map((t) => (
                              <option key={t.id} value={t.id}>{t.team_name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-400 text-sm truncate block">{team ? team.team_name : "—"}</span>
                        )}
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
            </>
            )}

            {/* Guild tab: Add from Guild */}
            {rosterTab === "guild" && canEdit && (
              <div className="p-4">
                <p className="text-slate-500 text-sm mb-3">
                  Add guild members to your raid roster. Select multiple and add at once, or add individually.
                </p>
                <div className="flex flex-wrap gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="Search by name..."
                    value={guildMemberSearch}
                    onChange={(e) => setGuildMemberSearch(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm w-full min-w-0 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                  />
                  <select
                    value={guildClassFilter}
                    onChange={(e) => setGuildClassFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                  >
                    <option value="">All classes</option>
                    {guildClassList.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 text-sm shrink-0">Show:</span>
                    <div className="flex rounded-lg bg-slate-800/60 p-0.5 border border-slate-700/50">
                      {(["all", "raider", "non-raider"] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setGuildMemberFilter(f)}
                          className={`px-2 py-0.5 rounded text-xs font-medium transition ${guildMemberFilter === f ? "text-slate-200 bg-[#223657] border-b-2 border-sky-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"}`}
                        >
                          {f === "all" ? "All" : f === "raider" ? "Raiders" : "Non-raiders"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-auto flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        const nonRaiders = displayGuildMembers.filter((m) => !raiderMap.has(m.name.toLowerCase())).map((m) => m.name.toLowerCase());
                        setSelectedGuildMembers(new Set(nonRaiders));
                      }}
                      className="px-2 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border border-slate-600"
                    >
                      Select all non-raiders
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedGuildMembers(new Set())}
                      className="px-2 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border border-slate-600"
                    >
                      Clear selection
                    </button>
                    <button
                      type="button"
                      onClick={addSelectedMembers}
                      disabled={selectedNonRaiderCount === 0}
                      className="px-3 py-1.5 flex items-center justify-center rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium border border-sky-500/50"
                    >
                      Add selected {selectedNonRaiderCount > 0 ? `(${selectedNonRaiderCount})` : ""}
                    </button>
                  </div>
                </div>
                <div className="max-h-[280px] overflow-y-auto space-y-1.5">
                  {displayGuildMembers.length === 0 ? (
                    <p className="text-slate-500 text-sm py-4 text-center">No guild members match the current filters.</p>
                  ) : (
                    displayGuildMembers.map((m) => {
                      const isRaider = raiderMap.has(m.name.toLowerCase());
                      const isSelected = selectedGuildMembers.has(m.name.toLowerCase());
                      return (
                        <div
                          key={m.name}
                          className="flex items-center gap-2 rounded-lg border border-slate-600 p-2 hover:bg-slate-800/50"
                          style={{ borderLeftWidth: 4, borderLeftColor: getClassColor(m.class) }}
                        >
                          {!isRaider ? (
                            <label className="shrink-0 flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleGuildMemberSelection(m.name)}
                                className="rounded border-slate-600 bg-slate-700 text-sky-500 focus:ring-sky-500/50"
                              />
                            </label>
                          ) : (
                            <span className="w-4 shrink-0" />
                          )}
                          <span className="truncate flex-1 min-w-0 text-sm">
                            <span className="font-medium" style={{ color: getClassColor(m.class) }}>{m.name}</span>
                            <span className="text-slate-500"> – {m.level} – {m.class}</span>
                          </span>
                          {isRaider ? (
                            <span className="shrink-0 text-emerald-400 text-sm font-medium">✓ Raider</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleRaider(m, true)}
                              className="shrink-0 h-7 px-2 flex items-center justify-center rounded bg-sky-600/90 hover:bg-sky-500 text-white text-sm font-medium border border-sky-500/50"
                            >
                              Add
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Realm tab: Add from Realm (Realm Search) */}
            {rosterTab === "realm" && canEdit && (
              <div className="p-4">
                <p className="text-slate-500 text-sm mb-3">
                  Search for any character on {capitalizeRealm(realm)} to add them to your raid roster.
                </p>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <input
                    type="text"
                    placeholder="Character name..."
                    value={characterSearchName}
                    onChange={(e) => { setCharacterSearchName(e.target.value); setCharacterSearchError(null); }}
                    onKeyDown={(e) => e.key === "Enter" && searchCharacter()}
                    className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                  />
                  <button
                    type="button"
                    onClick={searchCharacter}
                    disabled={characterSearching || !characterSearchName.trim()}
                    className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium"
                  >
                    {characterSearching ? "Searching..." : "Search"}
                  </button>
                </div>
                {characterSearchResult && (
                  <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-slate-700/50 border border-slate-600">
                    <span className="text-sm" style={{ color: getClassColor(characterSearchResult.class) }}>
                      {characterSearchResult.name} – {characterSearchResult.level} – {characterSearchResult.class}
                    </span>
                    <button
                      type="button"
                      onClick={addSearchedCharacter}
                      disabled={characterSearching || raiderMap.has(characterSearchResult.name.toLowerCase())}
                      className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium"
                    >
                      Add to Roster
                    </button>
                  </div>
                )}
                {characterSearchError && (
                  <p className="text-amber-500 text-sm mt-2">{characterSearchError}</p>
                )}
              </div>
            )}

            {/* Teams tab */}
            {rosterTab === "teams" && canEdit && (
              <div className="p-4">
                <p className="text-slate-500 text-sm mb-4">
                  Create teams and assign raiders. Use teams when planning raids.
                </p>
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    type="button"
                    onClick={createTeam}
                    className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium border border-sky-500/50"
                  >
                    + Create Team
                  </button>
                  <button
                    type="button"
                    onClick={saveTeams}
                    disabled={saving}
                    className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium border border-sky-500/50"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
                {teams.length === 0 ? (
                  <p className="text-slate-500 text-sm">No teams yet. Create one to get started.</p>
                ) : (
                  <div className="space-y-4">
                    {teams.map((team) => (
                      <div key={team.id} className="rounded-lg border border-slate-700 p-4">
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          <input
                            type="text"
                            value={teamNameDrafts[team.id] ?? team.team_name}
                            onChange={(e) => setTeamNameDrafts((d) => ({ ...d, [team.id]: e.target.value }))}
                            className="px-2 py-1 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                          />
                          <select
                            className="px-2 py-1 rounded bg-slate-700 border border-slate-600 text-sm"
                            onChange={(e) => {
                              const val = e.target.value;
                              e.target.value = "";
                              if (!val) return;
                              const [name, cls] = val.split("|");
                              const current = team.members.map((x) => ({ character_name: x.character_name, character_class: x.character_class }));
                              if (current.some((c) => c.character_name === name)) return;
                              updateTeamMembersLocal(team.id, [...current, { character_name: name, character_class: cls }]);
                            }}
                          >
                            <option value="">+ Add raider</option>
                            {raiders
                              .filter((r) => !team.members.some((m) => m.character_name === r.character_name))
                              .sort((a, b) => a.character_name.localeCompare(b.character_name, undefined, { sensitivity: "base" }))
                              .map((r) => (
                                <option key={r.character_name} value={`${r.character_name}|${r.character_class}`}>
                                  {r.character_name} ({r.character_class})
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => deleteTeamLocal(team.id)}
                            className="text-red-400 hover:text-red-300 text-sm"
                          >
                            Delete Team
                          </button>
                        </div>
                        <ul className="space-y-2">
                          {team.members.map((m) => (
                            <li
                              key={m.character_name}
                              className="flex items-center justify-between rounded px-2 py-1 bg-slate-800/50"
                              style={{ borderLeft: `3px solid ${getClassColor(m.character_class)}` }}
                            >
                              <span style={{ color: getClassColor(m.character_class) }}>{m.character_name}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  updateTeamMembersLocal(
                                    team.id,
                                    team.members.filter((x) => x.character_name !== m.character_name)
                                  );
                                }}
                                className="text-slate-500 hover:text-red-400 text-xs"
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
