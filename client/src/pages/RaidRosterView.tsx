import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";

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
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

interface RosterMember {
  name: string;
  class: string;
  level: number;
  role?: string;
  race?: string;
}

interface RaiderEntry {
  character_name: string;
  character_class: string;
  primary_spec?: string;
  off_spec?: string;
  notes?: string;
  raid_role?: string;
  raid_lead?: boolean;
  raid_assist?: boolean;
}

interface RaidTeam {
  id: number;
  team_name: string;
  members: Array<{ character_name: string; character_class: string }>;
}

export function RaidRosterView() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "TBC Anniversary";

  const [guildRoster, setGuildRoster] = useState<RosterMember[]>([]);
  const [raiders, setRaiders] = useState<RaiderEntry[]>([]);
  const [teams, setTeams] = useState<RaidTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [classFilter, setClassFilter] = useState<string>("");

  useEffect(() => {
    if (!realm || !guildName) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      api
        .get<{ members: RosterMember[] }>(
          `/auth/me/guild-roster?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
        )
        .then((r) => r.members),
      api
        .get<{ raiders: RaiderEntry[] }>(
          `/auth/me/raider-roster?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
        )
        .then((r) =>
          (r.raiders ?? []).map((x: { character_name: string; character_class: string; raid_lead?: unknown; raid_assist?: unknown }) => ({
            ...x,
            raid_lead: Boolean(x.raid_lead),
            raid_assist: Boolean(x.raid_assist),
          }))
        ),
      api
        .get<{ teams: RaidTeam[] }>(
          `/auth/me/raid-teams?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
        )
        .then((r) => r.teams ?? []),
    ])
      .then(([members, raidersList, teamsList]) => {
        setGuildRoster(members);
        setRaiders(raidersList);
        setTeams(teamsList);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [realm, guildName, serverType]);

  const guildMemberByLowerName = useMemo(() => {
    const m = new Map<string, RosterMember>();
    for (const g of guildRoster) {
      m.set(g.name.toLowerCase(), g);
    }
    return m;
  }, [guildRoster]);

  const raiderClassList = useMemo(() => {
    const set = new Set(raiders.map((r) => r.character_class));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [raiders]);

  const filteredRaiders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return raiders
      .filter((r) => !classFilter || r.character_class === classFilter)
      .filter((r) => !q || r.character_name.toLowerCase().includes(q))
      .sort((a, b) => a.character_name.localeCompare(b.character_name, undefined, { sensitivity: "base" }));
  }, [raiders, searchQuery, classFilter]);

  /** Group raiders by team for display. Teams with at least one filtered member, then "No Team" for unassigned. */
  const raidersByTeam = useMemo(() => {
    const raiderSet = new Set(filteredRaiders.map((r) => r.character_name.toLowerCase()));
    const result: Array<{ teamName: string; teamId?: number; members: typeof filteredRaiders }> = [];
    for (const team of teams) {
      const members = team.members
        .map((m) => filteredRaiders.find((r) => r.character_name.toLowerCase() === m.character_name.toLowerCase()))
        .filter((r): r is RaiderEntry => !!r && raiderSet.has(r.character_name.toLowerCase()));
      if (members.length > 0) {
        result.push({ teamName: team.team_name, teamId: team.id, members });
      }
    }
    const inAnyTeam = new Set<string>();
    for (const t of result) {
      for (const m of t.members) inAnyTeam.add(m.character_name.toLowerCase());
    }
    const noTeamMembers = filteredRaiders.filter((r) => !inAnyTeam.has(r.character_name.toLowerCase()));
    if (noTeamMembers.length > 0) {
      result.push({ teamName: "No Team", members: noTeamMembers });
    }
    return result;
  }, [teams, filteredRaiders]);

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
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Raid Composition" />

        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-sky-400">{guildName}</h1>
          <p className="text-slate-400 text-sm mt-1">
            Raid Composition · {capitalizeRealm(realm)} · {serverType}
            {!loading && ` · ${raiders.length} raider${raiders.length !== 1 ? "s" : ""}`}
          </p>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        {loading ? (
          <p className="text-slate-500">Loading roster...</p>
        ) : (
          <>
            {raiders.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-6">
                <input
                  type="text"
                  placeholder="Search by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-500 text-sm w-full min-w-[160px] max-w-[200px] focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                />
                <select
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                >
                  <option value="">All classes</option>
                  {raiderClassList.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div
              className="rounded-xl border border-white/[0.05] overflow-hidden"
              style={{
                background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              {raiders.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-slate-500">No raiders in the roster yet.</p>
                  <p className="text-slate-500 text-sm mt-2">
                    Go to Raid Roster to add members and create teams.
                  </p>
                </div>
              ) : filteredRaiders.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-slate-500">No raiders match the current filters.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-4">
                  {raidersByTeam.map(({ teamName, members }) => (
                    <div key={teamName} className="border border-slate-700/60 rounded-lg p-4">
                      <h3 className="text-sky-400 font-medium text-sm uppercase tracking-wider mb-3">
                        Team: {teamName}
                        <span className="text-slate-500 font-normal normal-case ml-2">
                          ({members.length} {members.length === 1 ? "member" : "members"})
                        </span>
                      </h3>
                      <div className="space-y-1">
                        {members.map((r) => {
                          const guildMember = guildMemberByLowerName.get(r.character_name.toLowerCase());
                          const classColor = getClassColor(r.character_class);
                          return (
                            <div
                              key={r.character_name}
                              className="pl-3 py-2 border-l-4 flex flex-wrap items-center gap-2 rounded-r"
                              style={{ borderLeftColor: classColor, backgroundColor: `${classColor}10` }}
                            >
                              <span className="font-medium" style={{ color: classColor }}>
                                {r.character_name}
                              </span>
                              <span className="text-slate-500 text-sm">
                                {[
                                  guildMember ? `Lv${guildMember.level}` : null,
                                  guildMember?.race ?? null,
                                  r.character_class,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
