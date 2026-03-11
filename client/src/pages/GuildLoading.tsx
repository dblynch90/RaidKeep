import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api";
import type { GuildPermissions } from "./GuildPermissions";
import { capitalizeRealm } from "../utils/realm";
import { useGuildParams } from "../hooks/useGuildParams";
import { guildQueryStringFromSlug, guildRealmQueryString } from "../utils/guildApi";

function guildPageUrl(path: string, realm: string, guildName: string, serverType: string): string {
  return `${path}?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;
}

export function GuildLoading() {
  const { realm, guildName, serverType, realmSlug, isValid } = useGuildParams();
  const navigate = useNavigate();

  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [guildDataLoaded, setGuildDataLoaded] = useState(false);
  const [permissions, setPermissions] = useState<GuildPermissions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const guildDashboardUrl = guildPageUrl("/guild-dashboard", realm, guildName, serverType);
  const permissionsUrl = `/auth/me/guild-permissions?${guildQueryStringFromSlug({ realmSlug, guildName, serverType })}`;

  useEffect(() => {
    if (!isValid) {
      setError("Missing realm or guild name");
      return;
    }
    setError(null);
    setPermissionsLoaded(false);
    setGuildDataLoaded(false);
    setRetryCount(0);
  }, [isValid]);

  // Step 1: Load permissions (with retries for post-login sync race)
  useEffect(() => {
    if (!isValid) return;

    const maxRetries = 3;
    const retryDelayMs = 1500;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const fetchPerms = (attempt: number) => {
      if (cancelled) return;
      api
        .get<{ permissions: GuildPermissions }>(permissionsUrl)
        .then((r) => {
          if (cancelled) return;
          const perms = r.permissions;
          if (perms.view_guild_dashboard || attempt >= maxRetries) {
            setPermissions(perms);
            setPermissionsLoaded(true);
          } else {
            // No access yet - may be sync race; retry after delay
            setRetryCount((c) => c + 1);
            timeoutId = setTimeout(() => fetchPerms(attempt + 1), retryDelayMs);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load permissions");
        });
    };

    fetchPerms(0);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [realmSlug, guildName, serverType, permissionsUrl, isValid]);

  // Step 2: Load guild data (saved raids - lightweight check that guild is accessible)
  useEffect(() => {
    if (!permissionsLoaded || !isValid) return;

    const qs = guildRealmQueryString({ realm, guildName, serverType });
    api
      .get<{ raids: unknown[] }>(`/auth/me/saved-raids?${qs}`)
      .then(() => {
        setGuildDataLoaded(true);
      })
      .catch(() => {
        // Saved-raids can fail for new guilds; still allow access if we have permissions
        setGuildDataLoaded(true);
      });
  }, [permissionsLoaded, realm, guildName, serverType, isValid]);

  // Navigate when both conditions are met
  useEffect(() => {
    if (!permissionsLoaded || !guildDataLoaded || !permissions) return;
    if (permissions.view_guild_dashboard) {
      navigate(guildDashboardUrl, { replace: true });
    }
  }, [permissionsLoaded, guildDataLoaded, permissions, navigate, guildDashboardUrl]);

  if (error) {
    return (
      <div className="rk-page-bg text-slate-100">
        <main className="rk-page-main">
          <p className="text-amber-500 mb-4">{error}</p>
          <Link to="/" className="text-sky-400 hover:text-sky-300">
            ← Back to Dashboard
          </Link>
        </main>
      </div>
    );
  }

  if (permissionsLoaded && guildDataLoaded && permissions && !permissions.view_guild_dashboard) {
    return (
      <div className="rk-page-bg text-slate-100">
        <main className="rk-page-main">
          <p className="text-amber-500 mb-4">You do not have permission to view this guild dashboard.</p>
          <Link to="/" className="text-sky-400 hover:text-sky-300">
            ← Back to Dashboard
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="rk-page-bg text-slate-100">
      <main className="rk-page-main">
        <div className="max-w-md mx-auto mt-16 text-center">
          <h1 className="text-xl font-semibold text-sky-400 mb-2">
            {guildName}
          </h1>
          <p className="text-slate-400 text-sm mb-8">
            {capitalizeRealm(realm)} · {serverType}
          </p>

          <div className="space-y-4 text-left">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
              {permissionsLoaded ? (
                <span className="text-emerald-400 text-lg" aria-hidden>✓</span>
              ) : (
                <div className="h-5 w-5 rounded-full border-2 border-slate-500 border-t-sky-500 animate-spin" aria-hidden />
              )}
              <span className={permissionsLoaded ? "text-slate-300" : "text-slate-400"}>
                Loading Permissions
              </span>
            </div>

            {retryCount > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                {permissionsLoaded ? (
                  <span className="text-emerald-400 text-lg" aria-hidden>✓</span>
                ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-slate-500 border-t-sky-500 animate-spin" aria-hidden />
                )}
                <span className={permissionsLoaded ? "text-slate-300" : "text-slate-400"}>
                  Syncing characters…
                </span>
              </div>
            )}

            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
              {guildDataLoaded ? (
                <span className="text-emerald-400 text-lg" aria-hidden>✓</span>
              ) : (
                <div className="h-5 w-5 rounded-full border-2 border-slate-500 border-t-sky-500 animate-spin" aria-hidden />
              )}
              <span className={guildDataLoaded ? "text-slate-300" : "text-slate-400"}>
                Loading Guild Data
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
