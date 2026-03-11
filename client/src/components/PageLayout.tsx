import type { ReactNode } from "react";

interface PageLayoutProps {
  children: ReactNode;
  /** Optional error message – shown instead of children when set */
  error?: string | null;
  /** Extra className for the main wrapper */
  className?: string;
}

/**
 * Consistent page layout: page background + centered main content.
 * Use for all authenticated pages to ensure visual consistency.
 */
export function PageLayout({ children, error, className = "" }: PageLayoutProps) {
  return (
    <div className={`rk-page-bg ${className}`.trim()}>
      <main className="rk-page-main">
        {error ? (
          <p className="rk-error">{error}</p>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
