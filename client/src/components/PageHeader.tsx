import { Link } from "react-router-dom";
import { Logo } from "./Logo";

interface PageHeaderProps {
  /** Optional back link (e.g. "← Back" with to="/") */
  backLink?: { to: string; label: string };
  /** Main title (guild name, page title) */
  title?: string;
  /** Subtitle under title (realm, server type) */
  subtitle?: string;
  /** Use banner logo (transparent, no slogan) - default true for all headers */
  useBannerLogo?: boolean;
  /** Game version dropdown (rendered after logo) */
  gameVersionSelect?: React.ReactNode;
  /** Right-side content: user info, nav links, actions */
  rightContent?: React.ReactNode;
  /** Additional content in the center (e.g. raid details) */
  centerContent?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({
  backLink,
  title,
  subtitle,
  useBannerLogo = true,
  gameVersionSelect,
  rightContent,
  centerContent,
  children,
}: PageHeaderProps) {
  return (
    <header className="border-b border-slate-700 bg-slate-800/50 h-16 flex items-center">
      <div className="max-w-6xl mx-auto px-4 w-full flex flex-wrap items-center gap-4 overflow-hidden">
        {/* Logo always first (left), 80% of banner height (64px) */}
        <div className="h-12 flex items-center shrink-0 overflow-hidden">
          <Logo variant={useBannerLogo ? "banner" : "compact"} />
        </div>
        {backLink && (
          <Link to={backLink.to} className="text-sky-400 hover:text-sky-300 shrink-0 whitespace-nowrap">
            {backLink.label}
          </Link>
        )}
        {(title || centerContent || children) && (
          <div className="flex-1 min-w-0 overflow-hidden">
            {title && (
              <>
                <h1 className="text-xl font-bold text-sky-400 truncate">{title}</h1>
                {subtitle && (
                  <p className="text-slate-500 text-sm mt-0.5 truncate">{subtitle}</p>
                )}
              </>
            )}
            {centerContent}
            {children}
          </div>
        )}
        {gameVersionSelect && (
          <div className="flex-1 flex justify-center items-center gap-2 min-w-0">
            <span className="text-slate-400 text-sm font-medium">Game Version</span>
            {gameVersionSelect}
          </div>
        )}
        <div className="flex items-center gap-4 shrink-0 ml-auto">
          {rightContent}
        </div>
      </div>
    </header>
  );
}
