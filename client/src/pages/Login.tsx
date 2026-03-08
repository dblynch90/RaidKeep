import { Logo } from "../components/Logo";

export function Login() {
  return (
    <div className="min-h-screen bg-[#0a0e17] relative overflow-hidden">
      {/* Background: radial gradient + subtle texture */}
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_0%,#1e293b_0%,#0f172a_40%,#020617_100%)] pointer-events-none"
        aria-hidden
      />
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
        aria-hidden
      />

      <div className="relative max-w-6xl mx-auto px-5 py-11 sm:py-16">
        <div className="flex flex-col lg:flex-row lg:items-start gap-11 lg:gap-14">
          {/* Hero card */}
          <div className="lg:shrink-0 lg:w-[418px]">
            <div className="rounded-xl bg-slate-800/60 border border-amber-900/30 shadow-2xl backdrop-blur-sm overflow-hidden">
              {/* Gold accent line */}
              <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
              <div className="px-7 py-6 sm:px-9 sm:py-7">
                <div className="mb-5 w-full">
                  <div className="relative inline-block w-full">
                    <div className="absolute inset-0 blur-xl bg-amber-500/10 rounded-full scale-150 pointer-events-none" aria-hidden />
                    <div className="relative">
                      <Logo variant="hero" link={false} />
                    </div>
                  </div>
                </div>

                <div className="mb-7 w-full max-w-[308px] mx-auto space-y-4">
                  <a
                    href="/api/auth/battlenet"
                    className="flex items-center justify-center w-full py-3.5 px-5 rounded-lg bg-[#148EFF] hover:bg-[#148EFF]/90 !text-white font-bold text-base sm:text-lg transition shadow-lg shadow-blue-900/20 whitespace-nowrap"
                  >
                    Log in with Battle.net
                  </a>
                  <p className="text-slate-500 text-sm text-center">
                    Secure login via Blizzard Battle.net OAuth. RaidKeep never stores your password.
                  </p>
                </div>
              </div>
              <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
            </div>
          </div>

          {/* Right side content (desktop) / stacked (mobile) */}
          <div className="flex-1 min-w-0">
        {/* Why RaidKeep */}
        <section className="lg:mt-0">
          <h2 className="text-slate-300 font-semibold text-center lg:text-left mb-7 text-base uppercase tracking-wider">
            Why RaidKeep?
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div className="p-5 rounded-lg bg-slate-800/40 border border-slate-700/50 text-center">
              <span className="text-3xl mb-2.5 block" aria-hidden>🛡</span>
              <h3 className="font-medium text-slate-200 text-base mb-1.5">Raid Planning</h3>
              <p className="text-slate-500 text-sm">Plan raid nights and organize boss progression.</p>
            </div>
            <div className="p-5 rounded-lg bg-slate-800/40 border border-slate-700/50 text-center">
              <span className="text-3xl mb-2.5 block" aria-hidden>📋</span>
              <h3 className="font-medium text-slate-200 text-base mb-1.5">Role Assignments</h3>
              <p className="text-slate-500 text-sm">Assign interrupts, cooldowns, and responsibilities.</p>
            </div>
            <div className="p-5 rounded-lg bg-slate-800/40 border border-slate-700/50 text-center">
              <span className="text-3xl mb-2.5 block" aria-hidden>📊</span>
              <h3 className="font-medium text-slate-200 text-base mb-1.5">Attendance Tracking</h3>
              <p className="text-slate-500 text-sm">Track roster history and raid participation.</p>
            </div>
          </div>
        </section>

        {/* Screenshot preview */}
        <section className="mt-6">
          <h2 className="text-slate-300 font-semibold text-center lg:text-left mb-7 text-base uppercase tracking-wider">
            See RaidKeep in Action
          </h2>
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden shadow-xl">
            <div className="h-2.5 bg-slate-700/50 flex gap-2 px-2.5 pt-2">
              <div className="w-3 h-3 rounded-full bg-slate-600" />
              <div className="w-3 h-3 rounded-full bg-slate-600" />
              <div className="w-3 h-3 rounded-full bg-slate-600" />
            </div>
            <div className="p-5 sm:p-7 grid sm:grid-cols-2 gap-4">
              <div className="space-y-2.5">
                <div className="h-4 w-3/4 bg-amber-500/30 rounded" />
                <div className="h-2.5 w-full bg-slate-700/50 rounded" />
                <div className="h-2.5 w-5/6 bg-slate-700/50 rounded" />
              </div>
              <div className="space-y-2.5">
                <div className="h-9 bg-slate-700/50 rounded" />
                <div className="h-9 bg-slate-700/50 rounded" />
                <div className="h-9 bg-slate-700/40 rounded" />
              </div>
            </div>
            <p className="text-slate-500 text-sm text-center pb-5">Dashboard preview</p>
          </div>
        </section>
          </div>
        </div>
      </div>
    </div>
  );
}
