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

function isGuildMaster(rank: string | undefined): boolean {
  if (!rank) return false;
  return rank === "0" || rank.toLowerCase().includes("master") || rank === "Guild Master";
}

interface RosterMember {
  name: string;
  class: string;
  level: number;
  role: string;
  rank?: string;
  race?: string;
}

interface GuildRosterData {
  guild: { name: string; realm: string; server_type: string };
  members: RosterMember[];
}

type SortKey = "rank" | "name" | "level" | "race" | "class";

export function GuildRoster() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "TBC Anniversary";

  const [data, setData] = useState<GuildRosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [minLevel, setMinLevel] = useState<string>("");
  const [maxLevel, setMaxLevel] = useState<string>("");
  const [classFilter, setClassFilter] = useState<string>("");

  useEffect(() => {
    if (!realm || !guildName) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    setLoading(true);
    setError(null);
    api
      .get<GuildRosterData>(
        `/auth/me/guild-roster?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to fetch roster"))
      .finally(() => setLoading(false));
  }, [realm, guildName, serverType]);

  if (error) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  const capitalizeRealm = (r: string) =>
    r
      .split(/[- ]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

  const uniqueClasses = useMemo(() => {
    const classes = new Set<string>();
    (data?.members ?? []).forEach((m) => classes.add(m.class));
    return [...classes].sort((a, b) => a.localeCompare(b));
  }, [data?.members]);

  const filteredAndSortedMembers = useMemo(() => {
    let members = data?.members ?? [];
    const min = minLevel.trim() ? parseInt(minLevel, 10) : null;
    const max = maxLevel.trim() ? parseInt(maxLevel, 10) : null;
    if (min != null && !isNaN(min)) {
      members = members.filter((m) => m.level >= min);
    }
    if (max != null && !isNaN(max)) {
      members = members.filter((m) => m.level <= max);
    }
    if (classFilter) {
      members = members.filter((m) => m.class === classFilter);
    }
    return [...members].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortKey) {
        case "rank":
          aVal = a.rank ?? "—";
          bVal = b.rank ?? "—";
          if (typeof aVal === "string" && typeof bVal === "string") {
            const aNum = parseInt(aVal, 10);
            const bNum = parseInt(bVal, 10);
            if (!isNaN(aNum) && !isNaN(bNum)) return sortDir === "asc" ? aNum - bNum : bNum - aNum;
            return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
          }
          return sortDir === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
        case "name":
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          return sortDir === "asc" ? (aVal as string).localeCompare(bVal as string) : (bVal as string).localeCompare(aVal as string);
        case "level":
          aVal = a.level;
          bVal = b.level;
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        case "race":
          aVal = (a.race ?? "—").toLowerCase();
          bVal = (b.race ?? "—").toLowerCase();
          return sortDir === "asc" ? (aVal as string).localeCompare(bVal as string) : (bVal as string).localeCompare(aVal as string);
        case "class":
          aVal = a.class.toLowerCase();
          bVal = b.class.toLowerCase();
          return sortDir === "asc" ? (aVal as string).localeCompare(bVal as string) : (bVal as string).localeCompare(aVal as string);
        default:
          return 0;
      }
    });
  }, [data?.members, sortKey, sortDir, minLevel, maxLevel, classFilter]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortHeader = ({ col, label }: { col: SortKey; label: string }) => (
    <th
      className="text-left p-3 text-slate-400 font-medium cursor-pointer hover:text-slate-200 select-none"
      onClick={() => handleSort(col)}
    >
      {label}
      {sortKey === col && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
      <main className="max-w-6xl mx-auto px-4 py-8">
        {realm && guildName && (
          <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Guild Roster" />
        )}

        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-sky-400">{data?.guild?.name ?? guildName}</h1>
          <p className="text-slate-400 text-sm mt-1">
            Guild Roster · {(data?.guild?.realm ? capitalizeRealm(data.guild.realm) : capitalizeRealm(realm))} · {serverType}
            {data?.members && ` · ${data.members.length} member${data.members.length !== 1 ? "s" : ""}`}
          </p>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        {loading ? (
          <p className="text-slate-500">Loading roster...</p>
        ) : data?.members && data.members.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-4 mb-6">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm">Level range:</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  placeholder="Min"
                  value={minLevel}
                  onChange={(e) => setMinLevel(e.target.value)}
                  className="w-20 px-2 py-1 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm"
                />
                <span className="text-slate-500">–</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  placeholder="Max"
                  value={maxLevel}
                  onChange={(e) => setMaxLevel(e.target.value)}
                  className="w-20 px-2 py-1 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm"
                />
                {(minLevel || maxLevel) && (
                  <button
                    type="button"
                    onClick={() => { setMinLevel(""); setMaxLevel(""); }}
                    className="text-slate-500 hover:text-slate-300 text-sm"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm">Class:</span>
                <select
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                >
                  <option value="">All classes</option>
                  {uniqueClasses.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div
              className="rounded-xl border border-white/[0.05] overflow-hidden"
              style={{
                background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
            <table className="w-full text-sm">
              <thead className="bg-slate-800/80">
                <tr>
                  <SortHeader col="rank" label="Rank" />
                  <SortHeader col="name" label="Name" />
                  <SortHeader col="level" label="Level" />
                  <SortHeader col="race" label="Race" />
                  <SortHeader col="class" label="Class" />
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedMembers.map((m: RosterMember, i: number) => {
                  const bg = getClassColor(m.class);
                  const gm = isGuildMaster(m.rank);
                  return (
                    <tr
                      key={`${m.name}-${i}`}
                      className="border-t border-slate-700"
                      style={{
                        backgroundColor: `${bg}15`,
                      }}
                    >
                      <td className="p-3 text-slate-400">
                        {m.rank ?? "—"}
                        {gm && <span className="ml-1 text-sky-400" title="Guild Master">★</span>}
                      </td>
                      <td className="p-3">
                        <span
                          className="font-medium"
                          style={{ color: bg }}
                        >
                          {m.name}
                        </span>
                      </td>
                      <td className="p-3 text-slate-300">{m.level}</td>
                      <td className="p-3 text-slate-400">{m.race ?? "—"}</td>
                      <td className="p-3">
                        <span style={{ color: bg }}>{m.class}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredAndSortedMembers.length === 0 && (minLevel || maxLevel || classFilter) && (
            <p className="text-slate-500 text-sm mt-2">No members match the current filters.</p>
          )}
          </>
        ) : (
          <div
            className="rounded-xl border border-white/[0.05] p-12 text-center"
            style={{
              background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <p className="text-slate-400">No members in roster.</p>
          </div>
        )}
      </main>
    </div>
  );
}
