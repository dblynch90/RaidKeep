import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { AppBanner } from "./components/AppBanner";
import { AppFooter } from "./components/AppFooter";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { BattleNetCallback } from "./pages/BattleNetCallback";
import { Dashboard } from "./pages/Dashboard";
import { GuildRoster } from "./pages/GuildRoster";
import { RaidView } from "./pages/RaidView";
import { RaidRoster } from "./pages/RaidRoster";
import { RaidRosterPopout } from "./pages/RaidRosterPopout";
import { RaidOfficerNotesPopout } from "./pages/RaidOfficerNotesPopout";
import { GuildDashboard } from "./pages/GuildDashboard";
import { GuildLoading } from "./pages/GuildLoading";
import { GuildCrafters } from "./pages/GuildCrafters";
import { RaidSchedule } from "./pages/RaidSchedule";
import { GuildPermissions } from "./pages/GuildPermissions";

const PlanRaid = lazy(() => import("./pages/PlanRaid").then((m) => ({ default: m.PlanRaid })));
const AdminLogin = lazy(() => import("./pages/AdminLogin").then((m) => ({ default: m.AdminLogin })));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const AdminGuildDetail = lazy(() => import("./pages/AdminGuildDetail").then((m) => ({ default: m.AdminGuildDetail })));

function ProtectedRoute({ children, bare }: { children: React.ReactNode; bare?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen text-slate-100 flex flex-col items-center justify-center gap-6" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
        <img src="/logo.png" alt="RaidKeep" className="h-14 w-auto object-contain opacity-90" />
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (bare) return <>{children}</>;
  return (
    <>
      <AppBanner />
      {children}
    </>
  );
}

function PageFallback() {
  return (
    <div className="min-h-[200px] flex items-center justify-center text-slate-400">
      <div className="h-8 w-8 rounded-full border-2 border-slate-600 border-t-sky-500 animate-spin" aria-hidden />
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/admin/guild/:realmSlug/:guildName" element={<AdminGuildDetail />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/auth/battlenet/callback" element={<BattleNetCallback />} />
      <Route
        path="/guild-loading"
        element={
          <ProtectedRoute>
            <GuildLoading />
          </ProtectedRoute>
        }
      />
      <Route
        path="/guild-dashboard"
        element={
          <ProtectedRoute>
            <GuildDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/guild-permissions"
        element={
          <ProtectedRoute>
            <GuildPermissions />
          </ProtectedRoute>
        }
      />
      <Route
        path="/guild-professions"
        element={
          <ProtectedRoute>
            <GuildCrafters />
          </ProtectedRoute>
        }
      />
      <Route
        path="/guild-roster"
        element={
          <ProtectedRoute>
            <GuildRoster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/plan-raid"
        element={
          <ProtectedRoute>
            <PlanRaid />
          </ProtectedRoute>
        }
      />
      <Route
        path="/raid-roster-view"
        element={
          <ProtectedRoute>
            <RaidRoster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/raid-schedule"
        element={
          <ProtectedRoute>
            <RaidSchedule />
          </ProtectedRoute>
        }
      />
      <Route
        path="/raid-roster"
        element={
          <ProtectedRoute>
            <RaidRoster />
          </ProtectedRoute>
        }
      />
      <Route
        path="/raid-roster-popout"
        element={
          <ProtectedRoute bare>
            <RaidRosterPopout />
          </ProtectedRoute>
        }
      />
      <Route
        path="/raid-officer-notes-popout"
        element={
          <ProtectedRoute bare>
            <RaidOfficerNotesPopout />
          </ProtectedRoute>
        }
      />
      <Route
        path="/raid/:id"
        element={
          <ProtectedRoute>
            <RaidView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <div className="min-h-screen flex flex-col text-slate-100" style={{ background: "radial-gradient(circle at 20% 10%, #1e3a5f 0%, #0b1628 60%)" }}>
          <div className="flex-1">
            <AppRoutes />
          </div>
          <AppFooter />
        </div>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
