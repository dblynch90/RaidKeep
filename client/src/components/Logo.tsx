import { Link } from "react-router-dom";

interface LogoProps {
  /** Size variant: hero for login/landing, full for auth, compact for headers, banner for roster/guild headers */
  variant?: "hero" | "full" | "compact" | "banner";
  /** Whether to wrap in a link to home (use false on login/register) */
  link?: boolean;
  className?: string;
}

const variantConfig: Record<string, { src: string; classes: string }> = {
  hero: { src: "/logo.png", classes: "w-4/5 max-w-[440px] h-auto object-contain mx-auto" },
  full: { src: "/logo.png", classes: "h-[3.85rem] w-auto max-w-[220px] object-contain" },
  compact: { src: "/logo.png", classes: "h-9 w-auto object-contain" },
  banner: { src: "/fulllogo_transparent_nobuffer_noslogan.png", classes: "h-full max-h-12 w-auto object-contain object-left" },
};

export function Logo({ variant = "compact", link = true, className = "" }: LogoProps) {
  if (variant === "banner") {
    const content = (
      <>
        <img
          src="/icononly.png"
          alt=""
          className="h-full max-h-12 w-auto object-contain object-left"
        />
        <img
          src="/nameonly.png"
          alt="RaidKeep"
          className="h-full max-h-12 w-auto object-contain object-left"
        />
      </>
    );
    const wrapperClass = "flex items-center gap-2 shrink-0";
    if (link) {
      return (
        <Link to="/" className={`${wrapperClass} hover:opacity-90 transition-opacity ${className}`}>
          {content}
        </Link>
      );
    }
    return <div className={`${wrapperClass} ${className}`}>{content}</div>;
  }

  const config = variantConfig[variant] ?? variantConfig.compact;
  const img = (
    <img
      src={config.src}
      alt="RaidKeep"
      className={`${config.classes} ${className}`}
    />
  );

  const wrapperClass = variant === "hero"
    ? "flex items-center justify-center w-full"
    : "flex items-center justify-center shrink-0";

  if (link) {
    return (
      <Link to="/" className={`${wrapperClass} hover:opacity-90 transition-opacity`}>
        {img}
      </Link>
    );
  }

  return <div className={wrapperClass}>{img}</div>;
}
