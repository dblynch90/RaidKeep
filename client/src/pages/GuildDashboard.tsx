import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import type { GuildPermissions } from "./GuildPermissions";
import { DEFAULT_PERMISSIONS } from "./GuildPermissions";
import { capitalizeRealm } from "../utils/realm";
import { useGuildParams } from "../hooks/useGuildParams";
import { guildQueryStringFromSlug } from "../utils/guildApi";

function DashboardCard({ to, title, description }: { to: string; title: string; description: string }) {
  return (
    <Link
      to={to}
      className="rk-card-panel block p-5 sm:p-6 rounded-xl border border-white/[0.05] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 min-h-[88px] sm:min-h-0 flex flex-col justify-center"
    >
      <h3 className="font-semibold text-sky-400 mb-1 sm:mb-2">{title}</h3>
      <p className="text-slate-400 text-xs sm:text-sm">{description}</p>
    </Link>
  );
}

/** Restrictive fallback while permissions are loading - prevents flash of admin cards */
const LOADING_PERMISSIONS: GuildPermissions = {
  view_guild_dashboard: true,
  view_guild_roster: false,
  view_raid_roster: false,
  view_raid_schedule: false,
  manage_raids: false,
  manage_raid_roster: false,
  manage_permissions: false,
  manage_guild_crafters: false,
};

function guildPageUrl(path: string, realm: string, guildName: string, serverType: string): string {
  return `${path}?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
}

export function GuildDashboard() {
  const { realm, guildName, serverType, realmSlug, isValid } = useGuildParams();

  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [loading, setLoading] = useState(true);

  const rosterUrl = guildPageUrl("/guild-roster", realm, guildName, serverType);
  const professionsUrl = guildPageUrl("/guild-professions", realm, guildName, serverType);
  const raidScheduleUrl = guildPageUrl("/raid-schedule", realm, guildName, serverType);
  const raidRosterUrl = guildPageUrl("/raid-roster", realm, guildName, serverType);
  const permissionsUrl = guildPageUrl("/guild-permissions", realm, guildName, serverType);

  useEffect(() => {
    if (!isValid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const qs = guildQueryStringFromSlug({ realmSlug, guildName, serverType });
    api
      .get<{ permissions: GuildPermissions }>(`/auth/me/guild-permissions?${qs}`)
      .then((r) => {
        setPermissions(r.permissions ?? DEFAULT_PERMISSIONS);
        setLoading(false);
      })
      .catch(() => {
        setPermissions(DEFAULT_PERMISSIONS);
        setLoading(false);
      });
  }, [realmSlug, guildName, serverType, isValid]);

  const perms = permissions ?? LOADING_PERMISSIONS;

  if (loading) {
    return (
      <div className="rk-page-bg text-slate-100">
        <main className="rk-page-main">
          <p className="text-slate-500">Loading guild dashboard...</p>
        </main>
      </div>
    );
  }

  if (permissions && permissions.view_guild_dashboard === false) {
    return (
      <div className="rk-page-bg text-slate-100">
        <main className="rk-page-main">
          <p className="text-amber-500">You do not have permission to view this guild dashboard.</p>
        </main>
      </div>
    );
  }

  if (!realm || !guildName) {
    return (
      <div className="rk-page-bg text-slate-100">
        <main className="rk-page-main">
          <p className="text-amber-500">Missing realm or guild name.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="rk-page-bg text-slate-100">
      <main className="rk-page-main">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Guild Dashboard" />

        <header className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-semibold text-sky-400 truncate">{guildName}</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1 truncate">
            Guild Dashboard · {capitalizeRealm(realm)} · {serverType}
          </p>
          <div className="mt-3 sm:mt-4 h-px bg-slate-700/60" />
        </header>

        <div className="space-y-8 sm:space-y-10">
          {/* Member Section */}
          {(perms.view_guild_roster || perms.view_raid_roster || perms.view_raid_schedule) && (
            <section>
              <h2 className="text-slate-400 font-medium text-sm uppercase tracking-wider mb-4">Member</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {perms.view_guild_roster && (
                  <DashboardCard to={rosterUrl} title="Guild Roster" description="View guild members, filter by class and level." />
                )}
                {perms.view_guild_roster && (
                  <DashboardCard to={professionsUrl} title="Guild Professions" description="Add guild members with professions, set levels and notes." />
                )}
                {perms.view_raid_roster && (
                  <DashboardCard to={raidRosterUrl} title="Raid Roster" description="View raid roster, set availability and notes. Officers can add raiders and manage teams." />
                )}
                {perms.view_raid_schedule && (
                  <DashboardCard to={raidScheduleUrl} title="Raid Schedule" description="View and sign up for raids. Officers can create, edit, and delete raids." />
                )}
              </div>
            </section>
          )}

          {/* Administrative Section */}
          {perms.manage_permissions && (
            <section>
              <h2 className="text-slate-400 font-medium text-sm uppercase tracking-wider mb-4">Administrative</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <DashboardCard to={permissionsUrl} title="Guild Permissions" description="Control access to guild dashboard features." />
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
