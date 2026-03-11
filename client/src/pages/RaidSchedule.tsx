import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import { RaidCard, type RaidCardData } from "../components/RaidCard";
import type { GuildPermissions } from "./GuildPermissions";
import { DEFAULT_PERMISSIONS } from "./GuildPermissions";
import { capitalizeRealm } from "../utils/realm";
import { useGuildParams } from "../hooks/useGuildParams";
import { guildQueryStringFromSlug, guildRealmQueryString } from "../utils/guildApi";

interface SavedRaid extends RaidCardData {
  guild_name: string;
  guild_realm: string;
  guild_realm_slug: string;
  server_type: string;
}

function guildPageUrl(path: string, realm: string, guildName: string, serverType: string): string {
  return `${path}?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
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
  const prevDefaultOpen = useRef(defaultOpen);
  useEffect(() => {
    if (defaultOpen && !prevDefaultOpen.current) setOpen(true);
    prevDefaultOpen.current = defaultOpen;
  }, [defaultOpen]);
  return (
    <div className="rounded-xl overflow-hidden rk-card-panel border border-white/[0.05]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left bg-transparent hover:bg-slate-700/30 transition"
      >
        <span className="font-medium text-slate-200">{title}</span>
        <span className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          ▼
        </span>
      </button>
      {open && <div className="border-t border-slate-700/60">{children}</div>}
    </div>
  );
}

export function RaidSchedule() {
  const { realm, guildName, serverType, realmSlug, isValid } = useGuildParams();

  const [raids, setRaids] = useState<SavedRaid[]>([]);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const perms = permissions ?? DEFAULT_PERMISSIONS;
  const canManageRaids = perms.manage_raids;

  const planRaidUrl = guildPageUrl("/plan-raid", realm, guildName, serverType);

  useEffect(() => {
    if (!isValid) {
      setLoading(false);
      setError("Missing realm or guild name");
      return;
    }
    setLoading(true);
    setError(null);
    const permsQs = guildQueryStringFromSlug({ realmSlug, guildName, serverType });
    const raidsQs = guildRealmQueryString({ realm, guildName, serverType });
    Promise.all([
      api.get<{ permissions: GuildPermissions }>(`/auth/me/guild-permissions?${permsQs}`).then((r) => r.permissions).catch(() => DEFAULT_PERMISSIONS),
      api.get<{ raids: SavedRaid[] }>(`/auth/me/saved-raids?${raidsQs}`).then((r) => r.raids),
    ])
      .then(([perms, r]) => {
        setPermissions(perms);
        setRaids(r);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load raids"))
      .finally(() => setLoading(false));
  }, [realmSlug, guildName, serverType, realm, isValid]);

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

  const today = new Date().toISOString().slice(0, 10);
  const upcomingRaids = raids
    .filter((r) => r.raid_date >= today)
    .sort((a, b) => a.raid_date.localeCompare(b.raid_date) || (a.start_time || "").localeCompare(b.start_time || ""));
  const pastRaids = raids
    .filter((r) => r.raid_date < today)
    .sort((a, b) => b.raid_date.localeCompare(a.raid_date) || (b.start_time || "").localeCompare(a.start_time || ""));

  if (error) {
    return (
      <div className="rk-page-bg text-slate-100" >
        <main className="rk-page-main">
          <p className="text-amber-500">{error}</p>
        </main>
      </div>
    );
  }

  if (!loading && !perms.view_raid_schedule) {
    return (
      <div className="rk-page-bg text-slate-100" >
        <main className="rk-page-main">
          <p className="text-amber-500">You do not have permission to view the raid schedule.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="rk-page-bg text-slate-100" >
      <main className="rk-page-main">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Raid Schedule" />

        <header className="mb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-sky-400">{guildName}</h1>
              <p className="text-slate-400 text-sm mt-1">
                Raid Schedule · {capitalizeRealm(realm)} · {serverType}
              </p>
            </div>
            {canManageRaids && (
              <Link
                to={planRaidUrl}
                className="h-9 px-3.5 rounded-lg bg-slate-700/80 hover:bg-slate-600 border border-slate-600 text-slate-200 text-sm font-medium flex items-center shrink-0 transition"
              >
                + Create Raid
              </Link>
            )}
          </div>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        {loading ? (
          <p className="text-slate-500">Loading raids...</p>
        ) : raids.length === 0 ? (
          <div className="rounded-xl border border-white/[0.05] p-12 text-center rk-card-panel">
            <div className="text-4xl mb-4">📅</div>
            <p className="text-slate-400 font-medium mb-1">No raids scheduled yet</p>
            <p className="text-slate-500 text-sm mb-6">
              {canManageRaids ? "Create your first raid to get started." : "Raids will appear here once they are scheduled."}
            </p>
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
          <div className="space-y-6">
            <section>
              <h2 className="text-slate-400 font-medium text-sm uppercase tracking-wider mb-4">
                Upcoming Raids
              </h2>
              {upcomingRaids.length === 0 ? (
                <p className="text-slate-500 text-sm py-4">No upcoming raids scheduled.</p>
              ) : (
                <div className="space-y-4">
                  {upcomingRaids.map((r) => (
                    <RaidCard
                      key={r.id}
                      raid={r}
                      showSignUp
                      baseUrl="/raid"
                      editUrl={canManageRaids ? `${planRaidUrl}&raidId=${r.id}` : undefined}
                      onDelete={canManageRaids ? () => handleDelete(r.id) : undefined}
                      deleting={deletingId === r.id}
                    />
                  ))}
                </div>
              )}
            </section>

            {pastRaids.length > 0 && (
              <CollapsibleSection title={`Past Raids (${pastRaids.length})`} defaultOpen={false}>
                <div className="p-4 space-y-4">
                  {pastRaids.map((r) => (
                    <RaidCard
                      key={r.id}
                      raid={r}
                      baseUrl="/raid"
                      editUrl={canManageRaids ? `${planRaidUrl}&raidId=${r.id}` : undefined}
                      onDelete={canManageRaids ? () => handleDelete(r.id) : undefined}
                      deleting={deletingId === r.id}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
