import { useAuth } from "../context/AuthContext";
import { Logo } from "./Logo";

export function AppBanner() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-700 bg-slate-800/95 backdrop-blur-sm h-14 sm:h-16 flex items-center safe-area-inset-top">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 w-full flex items-center gap-2 sm:gap-4">
        <div className="h-10 sm:h-12 flex items-center shrink-0 overflow-hidden">
          <Logo variant="banner" />
        </div>
        <div className="flex-1 min-w-0" />
        <span className="text-slate-300 text-sm truncate max-w-[100px] sm:max-w-[180px]" title={user?.display_name ?? user?.username}>
          {user?.display_name ?? user?.username}
        </span>
        <button
          type="button"
          onClick={() => logout()}
          className="px-3 py-2 sm:py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition min-h-[44px] sm:min-h-0 flex items-center justify-center"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
