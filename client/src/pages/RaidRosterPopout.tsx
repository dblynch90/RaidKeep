import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    ])
      .then(([raidersList, teamsList]) => {
        setRaiders(raidersList);
        setTeams(teamsList);
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

  // Only show raiders who are in the raid roster (raider_roster), not all guild members.
  // When teams exist, filter to raiders in teams; otherwise show all from raider_roster
  // (avoids showing full guild when raider_roster was bulk-synced from Blizzard)
  const raidersToShow = useMemo(() => {
    if (teams.length === 0) return raiders;
    const inTeam = new Set(characterToTeamId.keys());
    return raiders.filter((r) => inTeam.has(r.character_name.toLowerCase()));
  }, [raiders, teams.length, characterToTeamId]);

  const sortedRaiders = useMemo(
    () => [...raidersToShow].sort((a, b) => a.character_name.localeCompare(b.character_name, undefined, { sensitivity: "base" })),
    [raidersToShow]
  );

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-8">
        <p className="text-amber-500">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-8">
        <p className="text-slate-500">Loading roster...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Minimal header */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-700/60 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-sky-400">
            {guildName} · Raid Roster
          </h1>
          <p className="text-slate-500 text-sm">
            {capitalizeRealm(realm)} · {serverType} · {sortedRaiders.length} raider{sortedRaiders.length !== 1 ? "s" : ""}
          </p>
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
