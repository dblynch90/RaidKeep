import { Link } from "react-router-dom";

function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface GuildBreadcrumbsProps {
  guildName: string;
  realm: string;
  serverType: string;
  currentPage: string;
  extraItems?: BreadcrumbItem[];
}

export function GuildBreadcrumbs({
  guildName,
  realm,
  serverType,
  currentPage,
  extraItems = [],
}: GuildBreadcrumbsProps) {
  const guildDashboardUrl = `/guild-dashboard?realm=${encodeURIComponent(realm)}&guild_name=${encodeURIComponent(guildName)}&server_type=${encodeURIComponent(serverType)}`;

  const items: BreadcrumbItem[] = [
    { label: "Dashboard", href: "/" },
    { label: `${guildName} (${capitalizeRealm(realm)})`, href: guildDashboardUrl },
    ...extraItems,
    { label: currentPage },
  ];

  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-600" aria-hidden>›</span>}
            {item.href ? (
              <Link to={item.href} className="text-sky-400 hover:text-sky-300 transition">
                {item.label}
              </Link>
            ) : (
              <span className="text-slate-300 font-medium" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
