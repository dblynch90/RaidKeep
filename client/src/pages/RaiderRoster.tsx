import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "../components/Card";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import type { GuildPermissions } from "./GuildPermissions";
import type { MyCharacter } from "../api";

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

interface RosterMember {
  name: string;
  class: string;
  level: number;
  role?: string;
  race?: string;
}

const RAID_ROLES = [
  { value: "", label: "Primary" },
  { value: "tank", label: "Tank" },
  { value: "healer", label: "Healer" },
  { value: "dps", label: "DPS" },
] as const;

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const DEFAULT_AVAILABILITY = "0000000";

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
  professions?: string[];
  guild_profession_stars?: string[];
}

interface RaidTeam {
  id: number;
  team_name: string;
  members: Array<{ character_name: string; character_class: string }>;
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-slate-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left bg-slate-800/80 hover:bg-slate-700/80 transition"
      >
        <span className="font-medium text-slate-200">{title}</span>
        <span className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && <div className="border-t border-slate-700">{children}</div>}
    </div>
  );
}

export function RaiderRoster() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "Retail";

  const [guildRoster, setGuildRoster] = useState<RosterMember[]>([]);
  const [raiders, setRaiders] = useState<RaiderEntry[]>([]);
  const [teams, setTeams] = useState<RaidTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [classFilter, setClassFilter] = useState<string>("");
  const [levelMin, setLevelMin] = useState<number | null>(null);
  const [levelMax, setLevelMax] = useState<number | null>(null);
  const [raiderSearchQuery, setRaiderSearchQuery] = useState("");
  const [raiderClassFilter, setRaiderClassFilter] = useState<string>("");
  const [professionFilter, setProfessionFilter] = useState<string>("");
  const [raiderLevelMin, setRaiderLevelMin] = useState<number | null>(null);
  const [raiderLevelMax, setRaiderLevelMax] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"guild" | "roster" | "teams">("roster");
  const [guildMemberFilter, setGuildMemberFilter] = useState<"all" | "raider" | "non-raider">("all");
  const [teamNameDrafts, setTeamNameDrafts] = useState<Record<number, string>>({});
  const [selectedGuildMembers, setSelectedGuildMembers] = useState<Set<string>>(new Set());
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [myCharacters, setMyCharacters] = useState<MyCharacter[]>([]);

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

  const manageRaidsUrl = `/manage-raids?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
  const raidScheduleUrl = `/raid-schedule?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;

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
      api.get<{ raiders: Array<Omit<RaiderEntry, "notes_public"> & { notes_public?: number; raid_lead?: unknown; raid_assist?: unknown; availability?: string }> }>(
        `/auth/me/raider-roster?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) =>
        (r.raiders ?? []).map((x) => ({
          ...x,
          notes_public: x.notes_public === 1,
          raid_lead: Boolean(x.raid_lead),
          raid_assist: Boolean(x.raid_assist),
          availability: typeof x.availability === "string" ? x.availability.padEnd(7, "0").slice(0, 7) : DEFAULT_AVAILABILITY,
        }))
      ),
      api.get<{ teams: RaidTeam[] }>(
        `/auth/me/raid-teams?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => r.teams),
      api.get<{ characters: MyCharacter[] }>("/auth/me/characters").then((r) => r.characters ?? []).catch(() => []),
    ])
      .then(([perms, members, raidersList, teamsList, chars]) => {
        setPermissions(perms);
        setGuildRoster(members);
        setRaiders(raidersList);
        setTeams(teamsList);
        setMyCharacters(chars);
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

  const maxLevelInRoster = useMemo(() => {
    if (!guildRoster.length) return 80;
    return Math.max(...guildRoster.map((m) => m.level));
  }, [guildRoster]);

  const effectiveLevelMin = levelMin ?? maxLevelInRoster;
  const effectiveLevelMax = levelMax ?? maxLevelInRoster;

  const classList = useMemo(() => {
    const set = new Set(guildRoster.map((m) => m.class));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [guildRoster]);

  const displayGuildMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...guildRoster]
      .filter((m) => m.level >= effectiveLevelMin && m.level <= effectiveLevelMax)
      .filter((m) => !classFilter || m.class === classFilter)
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .filter((m) => {
        const isRaider = raiderMap.has(m.name.toLowerCase());
        if (guildMemberFilter === "raider") return isRaider;
        if (guildMemberFilter === "non-raider") return !isRaider;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [guildRoster, classFilter, searchQuery, effectiveLevelMin, effectiveLevelMax, guildMemberFilter, raiderMap]);

  const raiderClassList = useMemo(() => {
    const set = new Set(raiders.map((r) => r.character_class));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [raiders]);

  const guildMemberByLowerName = useMemo(() => {
    const m = new Map<string, RosterMember>();
    for (const g of guildRoster) {
      m.set(g.name.toLowerCase(), g);
    }
    return m;
  }, [guildRoster]);

  const characterToTeamId = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of teams) {
      for (const mbr of t.members) {
        m.set(mbr.character_name.toLowerCase(), t.id);
      }
    }
    return m;
  }, [teams]);

  const assignRaiderToTeam = async (characterName: string, characterClass: string, newTeamId: number | null) => {
    if (!canEdit) return;
    const currentTeamId = characterToTeamId.get(characterName.toLowerCase());
    if (currentTeamId) {
      const team = teams.find((t) => t.id === currentTeamId);
      if (team) {
        const next = team.members.filter((m) => m.character_name.toLowerCase() !== characterName.toLowerCase());
        await updateTeamMembers(currentTeamId, next);
      }
    }
    if (newTeamId) {
      const team = teams.find((t) => t.id === newTeamId);
      if (team) {
        const next = [...team.members, { character_name: characterName, character_class: characterClass }];
        await updateTeamMembers(newTeamId, next);
      }
    }
  };

  const effectiveRaiderLevelMin = raiderLevelMin ?? maxLevelInRoster;
  const effectiveRaiderLevelMax = raiderLevelMax ?? maxLevelInRoster;

  const PROFESSION_OPTIONS = ["Alchemy", "Blacksmithing", "Cooking", "Enchanting", "Engineering", "First Aid", "Herbalism", "Inscription", "Jewelcrafting", "Leatherworking", "Mining", "Skinning", "Tailoring"];

  const filteredRaiders = useMemo(() => {
    const q = raiderSearchQuery.trim().toLowerCase();
    return [...raiders]
      .filter((r) => !q || r.character_name.toLowerCase().includes(q))
      .filter((r) => !raiderClassFilter || r.character_class === raiderClassFilter)
      .filter((r) => !professionFilter || r.guild_profession_stars?.includes(professionFilter) || r.professions?.includes(professionFilter))
      .filter((r) => {
        const gm = guildMemberByLowerName.get(r.character_name.toLowerCase());
        if (!gm) return true;
        return gm.level >= effectiveRaiderLevelMin && gm.level <= effectiveRaiderLevelMax;
      })
      .sort((a, b) => a.character_name.localeCompare(b.character_name, undefined, { sensitivity: "base" }));
  }, [raiders, raiderSearchQuery, raiderClassFilter, professionFilter, effectiveRaiderLevelMin, effectiveRaiderLevelMax, guildMemberByLowerName]);

  const perms = permissions ?? DEFAULT_PERMISSIONS;
  if (!loading && !perms.view_raid_roster) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">You do not have permission to view the raid roster.</p>
        </main>
      </div>
    );
  }
  // View-only users should use the simplified Raid Roster page, not the admin Raider Roster
  if (!loading && perms.view_raid_roster && !perms.manage_raid_roster) {
    const viewOnlyUrl = `/raid-roster?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
    navigate(viewOnlyUrl, { replace: true });
    return null;
  }

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
          secondary_spec: "",
          notes: "",
          officer_notes: "",
          notes_public: false,
          raid_role: "",
          raid_lead: false,
          raid_assist: false,
          availability: DEFAULT_AVAILABILITY,
        },
      ]);
    } else {
      setRaiders((prev) =>
        prev.filter((r) => r.character_name.toLowerCase() !== member.name.toLowerCase())
      );
    }
  };

  const addSelectedMembers = () => {
    if (!canEdit) return;
    const toAdd = displayGuildMembers.filter(
      (m) => !raiderMap.has(m.name.toLowerCase()) && selectedGuildMembers.has(m.name.toLowerCase())
    );
    if (toAdd.length === 0) return;
    setRaiders((prev) => {
      const existing = new Set(prev.map((r) => r.character_name.toLowerCase()));
      const newRaiders = toAdd
        .filter((m) => !existing.has(m.name.toLowerCase()))
        .map((m) => ({
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
        }));
      return [...prev, ...newRaiders];
    });
    setSelectedGuildMembers(new Set());
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

  const selectAllNonRaiders = () => {
    const nonRaiders = displayGuildMembers
      .filter((m) => !raiderMap.has(m.name.toLowerCase()))
      .map((m) => m.name.toLowerCase());
    setSelectedGuildMembers(new Set(nonRaiders));
  };

  const clearGuildMemberSelection = () => setSelectedGuildMembers(new Set());

  const selectedNonRaiderCount = useMemo(() => {
    return displayGuildMembers.filter(
      (m) => !raiderMap.has(m.name.toLowerCase()) && selectedGuildMembers.has(m.name.toLowerCase())
    ).length;
  }, [displayGuildMembers, raiderMap, selectedGuildMembers]);

  const updateRaider = (name: string, updates: Partial<RaiderEntry>) => {
    if (updates.officer_notes !== undefined && !canEdit) return;
    if (!canEditRaider(name)) return;
    const filtered = canEditOwnAvailabilityAndNotes
      ? { ...(updates.availability !== undefined && { availability: updates.availability }), ...(updates.notes !== undefined && { notes: updates.notes }) }
      : updates;
    if (Object.keys(filtered).length === 0) return;
    setRaiders((prev) =>
      prev.map((r) =>
        r.character_name.toLowerCase() === name.toLowerCase() ? { ...r, ...filtered } : r
      )
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
            (res.raiders ?? []).map((r) => ({
              character_name: r.character_name ?? "",
              character_class: r.character_class ?? "",
              primary_spec: r.primary_spec ?? "",
              off_spec: r.off_spec ?? "",
              secondary_spec: (r as RaiderEntry & { secondary_spec?: string }).secondary_spec ?? "",
              notes: r.notes ?? "",
              officer_notes: r.officer_notes ?? "",
              notes_public: r.notes_public === 1 || Boolean(r.notes_public),
              raid_role: r.raid_role ?? "",
              raid_lead: Boolean(r.raid_lead),
              raid_assist: Boolean(r.raid_assist),
              availability: typeof r.availability === "string" ? r.availability.padEnd(7, "0").slice(0, 7) : DEFAULT_AVAILABILITY,
            }))
          );
        }
      }
      setSaveMsg("Raid team saved.");
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
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
        guild_realm_slug: realm,
        server_type: serverType,
        team_name: name.trim(),
      });
      setTeams((prev) => [...prev, res.team]);
    } catch {
      // ignore
    }
  };

  const updateTeamMembers = async (teamId: number, members: Array<{ character_name: string; character_class: string }>) => {
    if (!canEdit) return;
    try {
      await api.put(`/auth/me/raid-teams/${teamId}/members`, { members });
      setTeams((prev) =>
        prev.map((t) => (t.id === teamId ? { ...t, members } : t))
      );
    } catch {
      // ignore
    }
  };

  const updateTeamName = async (teamId: number, teamName: string) => {
    if (!canEdit || !teamName.trim()) return;
    try {
      await api.patch(`/auth/me/raid-teams/${teamId}`, { team_name: teamName.trim() });
      setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, team_name: teamName.trim() } : t)));
      setTeamNameDrafts((d) => {
        const next = { ...d };
        delete next[teamId];
        return next;
      });
    } catch {
      // ignore
    }
  };

  const deleteTeam = async (teamId: number) => {
    if (!canEdit || !confirm("Delete this team?")) return;
    try {
      await api.delete(`/auth/me/raid-teams/${teamId}`);
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
    } catch {
      // ignore
    }
  };

  if (error) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
      <main className="max-w-6xl mx-auto px-4 py-8">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Raid Roster" />

        <header className="mb-8">
          <h1 className="text-lg font-semibold text-slate-200">Raid Roster</h1>
          <p className="text-slate-400 text-sm mt-1">
            {capitalizeRealm(realm)} / {guildName} / {serverType}
          </p>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        <div className="mb-8">
          <nav className="flex rounded-lg bg-slate-800/60 p-1 border border-slate-700/50 w-fit">
            {(perms.view_raid_schedule || perms.manage_raids) && (
              <Link
                to={perms.manage_raids ? manageRaidsUrl : raidScheduleUrl}
                className="px-4 py-2 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 text-sm font-medium transition"
              >
                View Raids
              </Link>
            )}
            <span
              className="px-4 py-2 rounded-md text-slate-200 bg-[#223657] border-b-2 border-sky-500 text-sm font-medium"
              aria-current="page"
            >
              Raid Roster
            </span>
          </nav>
        </div>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <Card>
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <nav className="flex rounded-lg bg-slate-800/60 p-1 border border-slate-700/50">
                  <button
                    type="button"
                    onClick={() => setActiveTab("roster")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                      activeTab === "roster" ? "text-slate-200 bg-[#223657] border-b-2 border-sky-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                    }`}
                  >
                    Raid Roster
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("teams")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                      activeTab === "teams" ? "text-slate-200 bg-[#223657] border-b-2 border-sky-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                    }`}
                  >
                    Raid Teams
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("guild")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                      activeTab === "guild" ? "text-slate-200 bg-[#223657] border-b-2 border-sky-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                    }`}
                  >
                    Guild Members
                  </button>
                </nav>
                {activeTab === "roster" ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const url = `${window.location.origin}/raid-roster-popout?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
                        window.open(url, "raid-roster-popout", "width=1400,height=900,scrollbars=yes,resizable=yes");
                      }}
                      className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium text-sm shrink-0 border border-slate-600"
                      title="Open roster in a separate window"
                    >
                      ⧉ Open Fullscreen Roster
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-sm shrink-0 border border-sky-500/50"
                      >
                        {saving ? "Saving..." : "Save Roster"}
                      </button>
                    )}
                  </div>
                ) : activeTab === "teams" && canEdit ? (
                  <button
                    type="button"
                    onClick={createTeam}
                    className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-sm shrink-0 border border-sky-500/50"
                  >
                    + Create Team
                  </button>
                ) : null}
              </div>
              {activeTab === "guild" && (
                <>
                  <p className="text-slate-500 text-sm mb-3">
                    Add members to your raid roster. Select multiple and add at once, or add individually. Raiders are marked with ✓ Raider.
                  </p>
                  <div className="flex flex-wrap gap-3 mb-3">
                    <input
                      type="text"
                      placeholder="Search by name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm w-full min-w-0 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                    />
                    <select
                      value={classFilter}
                      onChange={(e) => setClassFilter(e.target.value)}
                      className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm w-full focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                    >
                      <option value="">All classes</option>
                      {classList.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
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
                        className="w-14 px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm"
                      />
                      <span className="text-slate-500">–</span>
                      <input
                        type="number"
                        min={1}
                        max={maxLevelInRoster}
                        value={effectiveLevelMax}
                        onChange={(e) => setLevelMax(e.target.value === "" ? null : Math.max(1, Math.min(maxLevelInRoster, +e.target.value)))}
                        className="w-14 px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 text-sm shrink-0">Show:</span>
                      <div className="flex rounded-lg bg-slate-800/60 p-0.5 border border-slate-700/50">
                        {(["all", "raider", "non-raider"] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setGuildMemberFilter(f)}
                            className={`px-2 py-0.5 rounded text-xs font-medium transition ${
                              guildMemberFilter === f ? "text-slate-200 bg-[#223657] border-b-2 border-sky-500" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                            }`}
                          >
                            {f === "all" ? "All" : f === "raider" ? "Raiders" : "Non-raiders"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-2 ml-auto flex-wrap">
                        <button
                          type="button"
                          onClick={selectAllNonRaiders}
                          className="px-2 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border border-slate-600"
                        >
                          Select all non-raiders
                        </button>
                        <button
                          type="button"
                          onClick={clearGuildMemberSelection}
                          className="px-2 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border border-slate-600"
                        >
                          Clear selection
                        </button>
                        <button
                          type="button"
                          onClick={addSelectedMembers}
                          disabled={selectedNonRaiderCount === 0}
                          className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium border border-sky-500/50"
                        >
                          Add selected {selectedNonRaiderCount > 0 ? `(${selectedNonRaiderCount})` : ""}
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
                        const isRaider = raiderMap.has(m.name.toLowerCase());
                        const isSelected = selectedGuildMembers.has(m.name.toLowerCase());
                        return (
                          <div
                            key={m.name}
                            className="flex items-center gap-2 rounded-lg border border-slate-600 p-2 hover:bg-slate-800/50"
                            style={{ borderLeftWidth: 4, borderLeftColor: classColor }}
                          >
                            {!isRaider && canEdit ? (
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
                              <span className="font-medium text-sm" style={{ color: classColor }}>{m.name}</span>
                              <span className="text-slate-500"> – {m.level} – {m.class}</span>
                            </span>
                            {isRaider ? (
                              <span className="shrink-0 h-7 flex items-center gap-1 text-emerald-400 text-sm font-medium">
                                <span>✓</span>
                                Raider
                              </span>
                            ) : canEdit ? (
                              <button
                                type="button"
                                onClick={() => toggleRaider(m, true)}
                                className="shrink-0 h-7 px-2 flex items-center justify-center rounded bg-sky-600/90 hover:bg-sky-500 text-white text-sm font-medium border border-sky-500/50"
                                title="Add to roster"
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
              {activeTab === "roster" && (
                    <>
                  {saveMsg && (
                    <p className={`text-sm mb-3 ${saveMsg.startsWith("Raid") ? "text-emerald-400" : "text-red-400"}`}>
                      {saveMsg}
                    </p>
                  )}
                  <p className="text-slate-500 text-sm mb-3">
                    Designate roles (Tank, Healer, DPS), Raid Lead/Raid Assist, specs, and notes for each raider.
                  </p>
                  {raiders.length > 0 && (
                    <div className="flex flex-wrap gap-3 mb-3">
                      <input
                        type="text"
                        placeholder="Search by name..."
                        value={raiderSearchQuery}
                        onChange={(e) => setRaiderSearchQuery(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm flex-1 min-w-[120px] focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      />
                      <select
                        value={raiderClassFilter}
                        onChange={(e) => setRaiderClassFilter(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      >
                        <option value="">All classes</option>
                        {raiderClassList.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <select
                        value={professionFilter}
                        onChange={(e) => setProfessionFilter(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                        title="Find crafters by profession"
                      >
                        <option value="">All / Find crafters</option>
                        {PROFESSION_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <label className="text-slate-400 text-sm shrink-0">Level</label>
                        <input
                          type="number"
                          min={1}
                          max={maxLevelInRoster}
                          value={effectiveRaiderLevelMin}
                          onChange={(e) => setRaiderLevelMin(e.target.value === "" ? null : Math.max(1, Math.min(maxLevelInRoster, +e.target.value)))}
                          className="w-14 px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm"
                        />
                        <span className="text-slate-500">–</span>
                        <input
                          type="number"
                          min={1}
                          max={maxLevelInRoster}
                          value={effectiveRaiderLevelMax}
                          onChange={(e) => setRaiderLevelMax(e.target.value === "" ? null : Math.max(1, Math.min(maxLevelInRoster, +e.target.value)))}
                          className="w-14 px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm"
                        />
                      </div>
                    </div>
                  )}
                  <div className="max-h-[420px] overflow-y-auto space-y-2">
                    {raiders.length === 0 ? (
                      <p className="text-slate-500 text-sm py-8 text-center">
                        No raiders yet. Switch to the Guild Members tab to add them.
                      </p>
                    ) : filteredRaiders.length === 0 ? (
                      <p className="text-slate-500 text-sm py-8 text-center">
                        No raiders match the current filters.
                      </p>
                    ) : (
                      filteredRaiders.map((r) => {
                          const guildMember = guildRoster.find((m) => m.name.toLowerCase() === r.character_name.toLowerCase());
                          const classColor = getClassColor(r.character_class);
                          return (
                            <div
                              key={r.character_name}
                              className="rounded-lg border border-slate-600 grid grid-cols-[32px_1fr]"
                              style={{ borderLeftWidth: 4, borderLeftColor: classColor }}
                            >
                              {/* Left: remove control */}
                              <div className="flex items-center justify-center py-2 pl-1">
                                {canEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleRaider({ name: r.character_name, class: r.character_class, level: guildMember?.level ?? 0 }, false)}
                                    className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors text-base leading-none"
                                    title="Remove from roster"
                                    aria-label="Remove from roster"
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </div>
                              {/* Right: card content */}
                              <div className="p-3 min-w-0">
                              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-x-4 gap-y-2 items-start">
                                {/* Left: character info + checkboxes + availability */}
                                <div className="flex flex-col gap-1.5 min-w-0">
                                  <span className="font-medium text-slate-100 truncate" style={{ color: classColor }}>
                                    {r.character_name} {guildMember ? `- ${guildMember.level}` : ""} {r.character_class}
                                    {(r.guild_profession_stars?.length ?? 0) > 0 && (
                                      <span className="ml-1.5 text-amber-400 text-xs font-normal" title={`Guild: ${r.guild_profession_stars!.join(", ")}`}>
                                        ★ {r.guild_profession_stars!.join(", ")}
                                      </span>
                                    )}
                                  </span>
                                  {canEdit && (
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                      <label className="flex items-center gap-1 text-slate-400 text-sm cursor-pointer shrink-0">
                                        <input
                                          type="checkbox"
                                          checked={r.raid_lead ?? false}
                                          onChange={(e) => updateRaider(r.character_name, { raid_lead: e.target.checked })}
                                          className="rounded border-slate-600 bg-slate-700 text-amber-500 focus:ring-amber-500/50"
                                        />
                                        Raid Lead
                                      </label>
                                      <label className="flex items-center gap-1 text-slate-400 text-sm cursor-pointer shrink-0">
                                        <input
                                          type="checkbox"
                                          checked={r.raid_assist ?? false}
                                          onChange={(e) => updateRaider(r.character_name, { raid_assist: e.target.checked })}
                                          className="rounded border-slate-600 bg-slate-700 text-amber-500 focus:ring-amber-500/50"
                                        />
                                        Assist
                                      </label>
                                    </div>
                                  )}
                                  {canEdit && teams.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-slate-500 text-xs shrink-0">Team:</span>
                                      <select
                                        value={characterToTeamId.get(r.character_name.toLowerCase()) ?? "none"}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          assignRaiderToTeam(
                                            r.character_name,
                                            r.character_class,
                                            v === "none" ? null : parseInt(v, 10)
                                          );
                                        }}
                                        className="px-2 py-1 rounded bg-slate-700 border border-slate-600 text-slate-200 text-xs min-w-[100px] focus:ring-1 focus:ring-sky-500/50 [color-scheme:dark]"
                                      >
                                        <option value="none">No team</option>
                                        {teams.map((t) => (
                                          <option key={t.id} value={t.id}>{t.team_name}</option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                  {!canEdit && teams.length > 0 && characterToTeamId.has(r.character_name.toLowerCase()) && (
                                    <div className="text-slate-500 text-xs">
                                      Team: {teams.find((t) => t.id === characterToTeamId.get(r.character_name.toLowerCase()))?.team_name ?? "—"}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-slate-500 text-xs shrink-0">Availability:</span>
                                    <div className="flex items-center gap-0.5 flex-wrap">
                                      {DAYS.map((d, i) => {
                                        const avail = (r.availability || DEFAULT_AVAILABILITY).padEnd(7, "0");
                                        const checked = avail[i] === "1";
                                        const canEditAvail = canEditRaider(r.character_name);
                                        return (
                                          <label
                                            key={i}
                                            className={`flex items-center justify-center shrink-0 w-9 h-6 rounded text-[9px] font-medium transition-colors ${
                                              canEditAvail ? "cursor-pointer" : "cursor-default"
                                            } ${
                                              checked
                                                ? "bg-sky-500/30 text-sky-400 border border-sky-500/50"
                                                : "bg-slate-700/50 text-slate-500 border border-slate-600" + (canEditAvail ? " hover:border-slate-500" : "")
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
                                            {d}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                                {/* Middle: role/spec in 2x2 grid */}
                                <div className="flex flex-col justify-center min-w-0">
                                  {canEdit ? (
                                    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center">
                                      <select
                                        value={r.raid_role ?? ""}
                                        onChange={(e) => updateRaider(r.character_name, { raid_role: e.target.value })}
                                        className="px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm min-w-[72px]"
                                        title="Primary role"
                                      >
                                        {RAID_ROLES.map((opt) => (
                                          <option key={opt.value || "_"} value={opt.value}>{opt.label}</option>
                                        ))}
                                      </select>
                                      <input
                                        type="text"
                                        placeholder="Primary spec"
                                        value={r.primary_spec ?? ""}
                                        onChange={(e) => updateRaider(r.character_name, { primary_spec: e.target.value })}
                                        className="px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm min-w-0"
                                        title="e.g. Restoration, Feral"
                                      />
                                      <select
                                        value={["tank", "healer", "dps"].includes((r.off_spec ?? "").toLowerCase()) ? (r.off_spec ?? "").toLowerCase() : ""}
                                        onChange={(e) => updateRaider(r.character_name, { off_spec: e.target.value })}
                                        className="px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm min-w-[72px]"
                                        title="Secondary role"
                                      >
                                        <option value="">Secondary</option>
                                        <option value="tank">Tank</option>
                                        <option value="healer">Healer</option>
                                        <option value="dps">DPS</option>
                                      </select>
                                      <input
                                        type="text"
                                        placeholder="Secondary spec"
                                        value={r.secondary_spec ?? ""}
                                        onChange={(e) => updateRaider(r.character_name, { secondary_spec: e.target.value })}
                                        className="px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm min-w-0"
                                        title="e.g. Protection, Discipline"
                                      />
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 text-sm py-0.5">
                                      {[r.raid_role, r.primary_spec, r.off_spec, r.secondary_spec].filter(Boolean).join(" · ") || "—"}
                                    </span>
                                  )}
                                </div>
                                {/* Right: notes (compact textareas) */}
                                <div className="flex flex-col gap-1.5 min-w-0">
                                  {canEditRaider(r.character_name) ? (
                                    <textarea
                                      placeholder="Player notes..."
                                      value={r.notes ?? ""}
                                      onChange={(e) => updateRaider(r.character_name, { notes: e.target.value })}
                                      rows={2}
                                      className="min-h-[3rem] px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm w-full resize-y focus:ring-1 focus:ring-sky-500/50 placeholder-slate-500"
                                    />
                                  ) : (
                                    <div className="text-slate-400 text-sm py-0.5 min-h-[1.5rem]">{r.notes || "—"}</div>
                                  )}
                                  {canEdit && (
                                    <label className="flex items-center gap-1 cursor-pointer text-slate-500 text-xs shrink-0">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(r.notes_public)}
                                        onChange={(e) => updateRaider(r.character_name, { notes_public: e.target.checked })}
                                        className="rounded border-slate-600 bg-slate-700 text-sky-500"
                                      />
                                      Visible to roster
                                    </label>
                                  )}
                                  {canEdit && (
                                    <textarea
                                      placeholder="Officer notes..."
                                      value={r.officer_notes ?? ""}
                                      onChange={(e) => updateRaider(r.character_name, { officer_notes: e.target.value })}
                                      rows={2}
                                      className="min-h-[3rem] px-2 py-1.5 rounded bg-slate-700 border border-amber-700/50 text-slate-200 text-sm w-full resize-y focus:ring-1 focus:ring-amber-500/50 placeholder-slate-500"
                                    />
                                  )}
                                </div>
                              </div>
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                    </>
                  )}
                  {activeTab === "teams" && (
                    <>
                  <p className="text-slate-500 text-sm mb-4">
                    Create teams and assign raiders from your roster. Use teams when planning raids.
                  </p>
                  {teams.length === 0 ? (
                    <p className="text-slate-500">No teams yet. Create one to get started.</p>
                  ) : (
                    <div className="space-y-4 max-h-[420px] overflow-y-auto">
                      {teams.map((team) => (
                        <CollapsibleSection key={team.id} title={`${team.team_name} (${team.members.length})`} defaultOpen={false}>
                          <div className="p-4">
                            {canEdit ? (
                              <>
                                <div className="flex flex-wrap items-center gap-2 mb-3">
                                  <span className="text-slate-400 text-sm">Team name:</span>
                                  <input
                                    type="text"
                                    value={teamNameDrafts[team.id] ?? team.team_name}
                                    onChange={(e) => setTeamNameDrafts((d) => ({ ...d, [team.id]: e.target.value }))}
                                    className="px-2 py-1 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                                    placeholder="Team name"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateTeamName(team.id, teamNameDrafts[team.id] ?? team.team_name)}
                                    className="px-2 py-1 rounded bg-sky-600/90 hover:bg-sky-500 text-white text-sm border border-sky-500/50"
                                  >
                                    Update name
                                  </button>
                                </div>
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="text-slate-400 text-sm">Assign raiders:</span>
                                  <select
                                    className="px-2 py-1 rounded bg-slate-700 border border-slate-600 text-sm"
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      e.target.value = "";
                                      if (!val) return;
                                      const [name, cls] = val.split("|");
                                      const current = team.members.map((x) => ({ character_name: x.character_name, character_class: x.character_class }));
                                      if (current.some((c) => c.character_name === name)) return;
                                      updateTeamMembers(team.id, [...current, { character_name: name, character_class: cls }]);
                                    }}
                                  >
                                    <option value="">+ Add raider</option>
                                    {[...raiders]
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
                                    onClick={() => deleteTeam(team.id)}
                                    className="text-red-400 hover:text-red-300 text-sm"
                                  >
                                    Delete team
                                  </button>
                                </div>
                              </>
                            ) : null}
                            <ul className="space-y-2">
                              {team.members.map((m) => (
                                <li
                                  key={m.character_name}
                                  className="flex items-center justify-between rounded px-2 py-1 bg-slate-800/50"
                                  style={{ borderLeft: `3px solid ${getClassColor(m.character_class)}` }}
                                >
                                  <span style={{ color: getClassColor(m.character_class) }}>{m.character_name}</span>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        updateTeamMembers(
                                          team.id,
                                          team.members.filter((x) => x.character_name !== m.character_name)
                                        );
                                      }}
                                      className="text-slate-500 hover:text-red-400 text-xs"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </CollapsibleSection>
                      ))}
                    </div>
                  )}
                    </>
                  )}
                </div>
              </Card>
        )}
      </main>
    </div>
  );
}
