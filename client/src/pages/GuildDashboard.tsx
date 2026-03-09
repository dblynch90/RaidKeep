import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GuildBreadcrumbs } from "../components/GuildBreadcrumbs";
import type { GuildPermissions } from "./GuildPermissions";

function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function DashboardCard({ to, title, description }: { to: string; title: string; description: string }) {
  return (
    <Link
      to={to}
      className="block p-6 rounded-xl border border-white/[0.05] transition-all duration-200 hover:-translate-y-0.5"
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
      <h3 className="font-semibold text-sky-400 mb-2">{title}</h3>
      <p className="text-slate-400 text-sm">{description}</p>
    </Link>
  );
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

/** Restrictive fallback while permissions are loading - prevents flash of admin cards */
const LOADING_PERMISSIONS: GuildPermissions = {
  view_guild_dashboard: true,
  view_guild_roster: false,
  view_raid_roster: false,
  view_raid_schedule: false,
  manage_raids: false,
  manage_raid_roster: false,
  manage_permissions: false,
};

export function GuildDashboard() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? "Retail";

  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);

  const realmSlug = realm.toLowerCase().replace(/\s+/g, "-");
  const rosterUrl = `/guild-roster?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
  const craftersUrl = `/guild-crafters?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
  const manageRaidsUrl = `/manage-raids?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
  const raidScheduleUrl = `/raid-schedule?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
  const raidRosterUrl = `/raid-roster?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
  const permissionsUrl = `/guild-permissions?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;

  useEffect(() => {
    if (!realm || !guildName) return;
    api
      .get<{ permissions: GuildPermissions }>(
        `/auth/me/guild-permissions?realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`
      )
      .then((r) => setPermissions(r.permissions))
      .catch(() => setPermissions(DEFAULT_PERMISSIONS));
  }, [realm, realmSlug, guildName, serverType]);

  const perms = permissions ?? LOADING_PERMISSIONS;

  if (!perms.view_guild_dashboard) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">You do not have permission to view this guild dashboard.</p>
        </main>
      </div>
    );
  }

  if (!realm || !guildName) {
    return (
      <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-amber-500">Missing realm or guild name.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
      <main className="max-w-6xl mx-auto px-4 py-8">
        <GuildBreadcrumbs guildName={guildName} realm={realm} serverType={serverType} currentPage="Guild Dashboard" />

        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-sky-400">{guildName}</h1>
          <p className="text-slate-400 text-sm mt-1">
            Guild Dashboard · {capitalizeRealm(realm)} · {serverType}
          </p>
          <div className="mt-4 h-px bg-slate-700/60" />
        </header>

        <div className="space-y-10">
          {/* Member Section */}
          {(perms.view_guild_roster || perms.view_raid_roster || perms.view_raid_schedule) && (
            <section>
              <h2 className="text-slate-400 font-medium text-sm uppercase tracking-wider mb-4">Member</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {perms.view_guild_roster && (
                  <DashboardCard to={rosterUrl} title="Guild Roster" description="View guild members, filter by class and level." />
                )}
                {perms.view_guild_roster && (
                  <DashboardCard to={craftersUrl} title="Guild Crafters" description="Search recipe books of starred guild crafters." />
                )}
                {perms.view_raid_roster && (
                  <DashboardCard to={raidRosterUrl} title="Raid Roster" description="View raid roster, set your availability and notes." />
                )}
                {perms.view_raid_schedule && (
                  <DashboardCard to={raidScheduleUrl} title="Raid Schedule" description="View upcoming and past raids for this guild." />
                )}
              </div>
            </section>
          )}

          {/* Administrative Section */}
          {(perms.manage_raids || perms.manage_permissions) && (
            <section>
              <h2 className="text-slate-400 font-medium text-sm uppercase tracking-wider mb-4">Administrative</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {perms.manage_raids && (
                  <DashboardCard to={manageRaidsUrl} title="Raid Management" description="Create, edit, and manage raids for this guild." />
                )}
                {perms.manage_permissions && (
                  <DashboardCard to={permissionsUrl} title="Guild Permissions" description="Control access to guild dashboard features." />
                )}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
