import { Link } from "react-router-dom";

interface CardProps {
  children: React.ReactNode;
  /** Render as link (React Router) */
  to?: string;
  className?: string;
  hover?: boolean;
}

const baseClasses = "block rounded-lg bg-slate-800 border border-slate-700";
const hoverClasses = "hover:border-sky-600/50 transition";

export function Card({
  children,
  to,
  className = "",
  hover = false,
}: CardProps) {
  const classes = `${baseClasses} ${hover ? hoverClasses : ""} ${className}`.trim();

  if (to) {
    return <Link to={to} className={classes}>{children}</Link>;
  }

  return <div className={classes}>{children}</div>;
}

interface CardSectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function CardSection({ title, children, className = "" }: CardSectionProps) {
  return (
    <div className={`p-4 rounded-lg bg-slate-800 border border-slate-700 ${className}`.trim()}>
      <h3 className="font-medium mb-3">{title}</h3>
      {children}
    </div>
  );
}
