import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import { formatRaidDateTime } from "../utils/raidDateTime";
import type { GuildPermissions } from "./GuildPermissions";

interface SavedRaid {
  id: number;
  raid_name: string;
  raid_instance?: string;
  raid_date: string;
  start_time?: string;
  finish_time?: string;
  guild_name: string;
  guild_realm: string;
  guild_realm_slug: string;
  server_type: string;
}

function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function isUpcoming(raidDate: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return raidDate >= today;
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

export function ManageRaids() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "Retail";

  const [raids, setRaids] = useState<SavedRaid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);

  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");

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
      api.get<{ raids: SavedRaid[] }>(
        `/auth/me/saved-raids?guild_realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      ).then((r) => r.raids),
    ])
      .then(([perms, r]) => {
        setPermissions(perms);
        setRaids(r);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load raids"))
      .finally(() => setLoading(false));
  }, [realm, guildName, serverType]);

  const planRaidUrl = `/plan-raid?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this raid?")) return;
    setDeletingId(id);
    try {
      await api.delete(`/auth/me/saved-raids/${id}`);
      setRaids((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  const raidRosterUrl = `/raider-roster?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;

  const perms = permissions ?? DEFAULT_PERMISSIONS;
  const canManageRaids = perms.manage_raids;
  const canViewRaidSchedule = perms.view_raid_schedule;

  if (error) {
    return (
      <div className="min-h-screen bg-[#0b1628]" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  if (!loading && !canViewRaidSchedule) {
    return (
      <div className="min-h-screen bg-[#0b1628]" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">You do not have permission to view the raid schedule.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
      <main className="max-w-6xl mx-auto px-4 py-8">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Raid Management" />

        {/* Header */}
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-sky-400">{guildName}</h1>
          <p className="text-slate-400 text-sm mt-1">
            Raid Management · {capitalizeRealm(realm)} · {serverType}
          </p>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        {/* Tabs + Primary Action */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <nav className="flex rounded-lg bg-slate-800/60 p-1 border border-slate-700/50">
            <span
              className="px-4 py-2 rounded-md text-slate-200 bg-[#223657] border-b-2 border-sky-500 text-sm font-medium"
              aria-current="page"
            >
              Raid Schedule
            </span>
            <Link
              to={raidRosterUrl}
              className="px-4 py-2 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 text-sm font-medium transition"
            >
              Raider Roster
            </Link>
          </nav>
          {canManageRaids && (
            <Link
              to={planRaidUrl}
              className="h-9 px-3.5 rounded-lg bg-slate-700/80 hover:bg-slate-600 border border-slate-600 text-slate-200 text-sm font-medium flex items-center shrink-0 transition"
            >
              + Create Raid
            </Link>
          )}
        </div>

        {loading ? (
          <p className="text-slate-500">Loading raids...</p>
        ) : raids.length === 0 ? (
          <div
            className="rounded-xl border border-white/[0.05] p-12 text-center"
            style={{
              background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <div className="text-4xl mb-4">📅</div>
            <p className="text-slate-400 font-medium mb-1">No raids scheduled yet</p>
            <p className="text-slate-500 text-sm mb-6">{canManageRaids ? "Create your first raid to get started." : "Raids will appear here once they are scheduled."}</p>
            {canManageRaids && (
              <Link
                to={planRaidUrl}
                className="inline-flex h-9 px-3.5 items-center rounded-lg bg-slate-700/80 hover:bg-slate-600 border border-slate-600 text-slate-200 text-sm font-medium transition"
              >
                + Create Raid
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {raids.map((r) => {
              const upcoming = isUpcoming(r.raid_date);
              const dateTimeStr = formatRaidDateTime(r.raid_date, r.start_time, r.finish_time);
              const metaParts = [r.raid_instance || "Raid", dateTimeStr];
              return (
                <div
                  key={r.id}
                  className="group rounded-xl border border-white/[0.05] p-5 transition-all duration-200 hover:-translate-y-0.5"
                  style={{
                    background: "linear-gradient(180deg, #1b2a44 0%, #162338 100%)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,0,0,0.4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl" aria-hidden>🗝</span>
                        <h3 className="font-semibold text-slate-100 truncate">{r.raid_name}</h3>
                        {upcoming && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">
                            ● Upcoming
                          </span>
                        )}
                      </div>
                      <p className="text-slate-500 text-sm mt-1">
                        {metaParts.join(" • ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        to={`/raid/${r.id}`}
                        className="h-9 px-3.5 rounded-lg bg-slate-600 hover:bg-slate-500 border border-slate-500 text-slate-100 text-sm font-medium flex items-center justify-center"
                      >
                        View
                      </Link>
                      {canManageRaids && (
                        <>
                          <Link
                            to={`/plan-raid?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}&raidId=${r.id}`}
                            className="h-9 px-3.5 rounded-lg bg-slate-600 hover:bg-slate-500 border border-slate-500 text-slate-100 text-sm font-medium flex items-center justify-center"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(r.id)}
                            disabled={deletingId === r.id}
                            className="h-9 px-3.5 rounded-lg bg-red-900/30 hover:bg-red-800/40 border border-red-800/50 text-red-400 text-sm font-medium disabled:opacity-50 flex items-center justify-center"
                          >
                            {deletingId === r.id ? "..." : "Delete"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
