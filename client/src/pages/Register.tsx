import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Logo } from "../components/Logo";

export function Register() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"leader" | "member">("member");
  const [error, setError] = useState("");
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await register(username, password, role);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  };

  return (
    <div className="rk-page-bg flex items-center justify-center px-4 text-slate-100">
      <div className="w-full max-w-3xl rk-card-panel-bordered px-6 pt-4 pb-6 shadow-xl">
        <div className="mb-2 w-full">
          <Logo variant="hero" link={false} />
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-red-400 text-sm bg-red-900/30 p-2 rounded">
              {error}
            </div>
          )}
          <input
            type="text"
            placeholder="Username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-2 rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            required
          />
          <input
            type="password"
            placeholder="Password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            required
          />
          <div>
            <label className="block text-slate-400 text-sm mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "leader" | "member")}
              className="w-full px-4 py-2 rounded bg-slate-700 border border-slate-600 text-white focus:ring-2 focus:ring-amber-500"
            >
              <option value="member">Guild Member</option>
              <option value="leader">Guild Leader</option>
            </select>
          </div>
          <button
            type="submit"
            className="w-full py-2 rounded bg-sky-600 hover:bg-sky-500 text-white font-bold transition border border-sky-500/50"
          >
            Create account
          </button>
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-600" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-slate-800 text-slate-400">or</span>
            </div>
          </div>
          <a
            href="/api/auth/battlenet"
            className="flex items-center justify-center w-full py-2 rounded bg-[#148EFF] hover:bg-[#148EFF]/90 text-white font-bold transition"
          >
            Sign up with Battle.net
          </a>
        </form>
        <p className="mt-4 text-slate-400 text-sm text-center">
          Have an account?{" "}
          <Link to="/login" className="text-amber-400 hover:text-amber-300">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
