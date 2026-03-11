import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { Logo } from "../components/Logo";
import { LoadingOverlay } from "../components/LoadingOverlay";

export function BattleNetCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current) return;
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code || !state) {
      setError("Missing authorization data. Please try again.");
      return;
    }

    submitted.current = true;
    api
      .post<{ user: { id: number; username: string; role: string } }>(
        "/auth/battlenet/callback",
        { code, state }
      )
      .then(async () => {
        await refresh();
        navigate("/", { replace: true });
      })
      .catch((err) => {
        submitted.current = false;
        setError(err instanceof Error ? err.message : "Login failed");
      });
  }, [searchParams, navigate, refresh]);

  if (error) {
    return (
      <div className="rk-page-bg flex items-center justify-center px-4 text-slate-100">
        <div className="w-full max-w-sm rk-card-panel-bordered p-8 shadow-xl text-center">
          <div className="mb-6 flex justify-center">
            <Logo variant="full" link={false} />
          </div>
          <h1 className="text-xl font-bold text-amber-400 mb-4">Battle.net Login Failed</h1>
          <p className="text-slate-300 mb-6">{error}</p>
          <a href="/login" className="inline-block px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white font-bold border border-sky-500/50">
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  return <LoadingOverlay message="Loading Data from Battle.net" />;
}
