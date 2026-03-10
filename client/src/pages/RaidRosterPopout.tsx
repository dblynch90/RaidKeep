import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

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

/** Read-only Excel-like roster table for a separate window. */
export function RaidRosterPopout() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "Retail";

  const [raiders, setRaiders] = useState<RaiderEntry[]>([]);
  const [teams, setTeams] = useState<RaidTeam[]>([]);
  const [guildMembers, setGuildMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      api.get<{ raiders: RaiderEntry[] }>(
        `/auth/me/raider-roster?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) =>
        (r.raiders ?? []).map((x) => ({
          ...x,
          raid_lead: Boolean(x.raid_lead),
          raid_assist: Boolean(x.raid_assist),
          availability: typeof x.availability === "string" ? x.availability.padEnd(7, "0").slice(0, 7) : DEFAULT_AVAILABILITY,
        }))
      ),
      api.get<{ teams: RaidTeam[] }>(
        `/auth/me/raid-teams?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => (r.teams ?? []) as RaidTeam[]),
      api.get<{ members?: GuildMember[] }>(
        `/auth/me/guild-roster?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => (r.members ?? []) as GuildMember[]).catch(() => []),
    ])
      .then(([raidersList, teamsList, membersList]) => {
        setRaiders(raidersList);
        setTeams(teamsList);
        setGuildMembers(membersList);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load roster"))
      .finally(() => setLoading(false));
  }, [realm, guildName, serverType]);

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

  // Only show raiders who are in the raid roster (raider_roster), not all guild members.
  // When teams exist, filter to raiders in teams; otherwise show all from raider_roster
  const raidersToShow = useMemo(() => {
    if (teams.length === 0) return raiders;
    const inTeam = new Set(characterToTeamId.keys());
    return raiders.filter((r) => inTeam.has(r.character_name.toLowerCase()));
  }, [raiders, teams.length, characterToTeamId]);

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
          <p className="text-slate-500 text-sm">
            {capitalizeRealm(realm)} · {serverType} · {sortedRaiders.length} raider{sortedRaiders.length !== 1 ? "s" : ""}
          </p>
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
        <table className="w-full border-collapse text-sm table-fixed" style={{ minWidth: 800 }}>
          <colgroup>
            <col style={{ width: "14%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "32%" }} />
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
                        {DAYS.map((d, i) => (
                          <span
                            key={d}
                            className={`inline-block w-8 text-center text-xs py-0.5 rounded ${
                              avail[i] === "1" ? "bg-sky-500/20 text-sky-400" : "text-slate-600"
                            }`}
                            title={d}
                          >
                            {d[0]}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-400">
                      {[
                        (r.raid_role || "—").charAt(0).toUpperCase() + (r.raid_role || "").slice(1).toLowerCase(),
                        r.primary_spec ? (r.primary_spec as string).charAt(0).toUpperCase() + (r.primary_spec as string).slice(1).toLowerCase() : "—",
                      ].join(" - ")}
                    </td>
                    <td className="py-2 px-3 text-slate-400">
                      {[
                        (r.off_spec || "—").charAt(0).toUpperCase() + (r.off_spec || "").slice(1).toLowerCase(),
                        r.secondary_spec ? (r.secondary_spec as string).charAt(0).toUpperCase() + (r.secondary_spec as string).slice(1).toLowerCase() : "—",
                      ].join(" - ")}
                    </td>
                    <td className="py-2 px-3 text-slate-400">{team ? team.team_name : "—"}</td>
                    <td className="py-2 px-3 align-top whitespace-pre-wrap break-words">
                      {r.notes ? (
                        <div className="text-slate-400 mb-1"><span className="text-slate-500 text-xs uppercase">Player:</span> {r.notes}</div>
                      ) : null}
                      {r.officer_notes ? (
                        <div className="text-slate-500"><span className="text-slate-500 text-xs uppercase">Officer:</span> {r.officer_notes}</div>
                      ) : null}
                      {!r.notes && !r.officer_notes ? "—" : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
