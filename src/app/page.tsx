"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ─── Auth helpers ───
async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error");
  return data;
}

async function apiGet(path: string, token: string) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

// ─── Login Page ───
function AuthPage({ onAuth }: { onAuth: (token: string, name: string) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      const data = isLogin
        ? await apiPost("/api/auth/login", { email, password })
        : await apiPost("/api/auth/register", { email, password, name });
      localStorage.setItem("token", data.token);
      localStorage.setItem("userName", data.user.name);
      onAuth(data.token, data.user.name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🌿</div>
          <h1 className="text-3xl font-bold">
            <span className="text-[var(--sf-green)]">South</span>Farm
          </h1>
          <p className="text-gray-500 mt-1">Automatización móvil</p>
        </div>

        {/* Toggle */}
        <div className="flex bg-[var(--sf-card)] rounded-xl p-1 mb-6">
          <button
            onClick={() => setIsLogin(true)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
              isLogin ? "bg-[var(--sf-green)] text-black" : "text-gray-400"
            }`}
          >
            Iniciar Sesión
          </button>
          <button
            onClick={() => setIsLogin(false)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
              !isLogin ? "bg-[var(--sf-green)] text-black" : "text-gray-400"
            }`}
          >
            Crear Cuenta
          </button>
        </div>

        <div className="space-y-3">
          {!isLogin && (
            <input
              type="text"
              placeholder="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[var(--sf-card)] border border-[var(--sf-border)] rounded-xl px-4 py-3 text-white placeholder-gray-500"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[var(--sf-card)] border border-[var(--sf-border)] rounded-xl px-4 py-3 text-white placeholder-gray-500"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full bg-[var(--sf-card)] border border-[var(--sf-border)] rounded-xl px-4 py-3 text-white placeholder-gray-500"
          />
        </div>

        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full mt-6 bg-[var(--sf-green)] text-black font-bold py-3 rounded-xl hover:brightness-110 transition disabled:opacity-50"
        >
          {loading ? "..." : isLogin ? "Iniciar Sesión" : "Crear Cuenta"}
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard ───
interface Session {
  id: number;
  params: string;
  result: string;
  status: string;
  created_at: string;
}

function Dashboard({ token, userName, onLogout }: { token: string; userName: string; onLogout: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet("/api/warmup-sessions", token).then((data) => {
      setSessions(data.sessions || []);
      setLoading(false);
    });
  }, [token]);

  // Stats
  const totalSessions = sessions.length;
  const totalReels = sessions.reduce((s, r) => s + (((JSON.parse(r.result || "{}") as Record<string, number>).reels_viewed) || 0), 0);
  const totalLikes = sessions.reduce((s, r) => s + (((JSON.parse(r.result || "{}") as Record<string, number>).likes) || 0), 0);
  const totalSaves = sessions.reduce((s, r) => s + (((JSON.parse(r.result || "{}") as Record<string, number>).saves) || 0), 0);
  const totalMin = sessions.reduce((s, r) => s + Math.floor(((JSON.parse(r.result || "{}") as Record<string, number>).elapsed_sec || 0) / 60), 0);

  const fmtDate = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = Math.floor((now.getTime() - d.getTime()) / 60000);
      if (diff < 1) return "Ahora";
      if (diff < 60) return `Hace ${diff}m`;
      if (diff < 1440) return `Hace ${Math.floor(diff / 60)}h`;
      return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    } catch {
      return "";
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-8 pb-4">
        <h1 className="text-2xl font-bold">
          <span className="text-[var(--sf-green)]">South</span>Farm
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{userName}</span>
          <button
            onClick={onLogout}
            className="text-xs bg-[var(--sf-card)] border border-[var(--sf-border)] px-3 py-1.5 rounded-lg text-gray-400 hover:text-white transition"
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      <div className="px-6 pb-8">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard icon="📋" value={totalSessions} label="Sesiones" />
          <StatCard icon="▶️" value={totalReels} label="Reels" />
          <StatCard icon="❤️" value={totalLikes} label="Likes" />
          <StatCard icon="⏱️" value={totalMin} label="Minutos" />
        </div>

        {/* Sessions list */}
        <h2 className="text-lg font-semibold mb-3">Historial de Warmups</h2>
        {loading ? (
          <p className="text-gray-500">Cargando...</p>
        ) : sessions.length === 0 ? (
          <p className="text-gray-500">No hay sesiones todavía</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => {
              const params = JSON.parse(s.params || "{}") as Record<string, unknown>;
              const result = JSON.parse(s.result || "{}") as Record<string, number>;
              return (
                <div key={s.id} className="bg-[var(--sf-card)] rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${s.status === "completed" ? "bg-green-500/15" : "bg-orange-500/15"}`}>
                      {s.status === "completed" ? "✅" : "⏹️"}
                    </div>
                    <div>
                      <p className="font-semibold">@{(params.account as string) || "?"}</p>
                      <p className="text-xs text-gray-500">{fmtDate(s.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span className="text-blue-300">{result.reels_viewed || 0} ▶</span>
                    <span className="text-pink-300">{result.likes || 0} ❤</span>
                    <span className="text-yellow-300">{result.saves || 0} 🔖</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <div className="bg-[var(--sf-card)] rounded-xl p-4 text-center">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-xl font-bold text-[var(--sf-green)]">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

// ─── Main ───
export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("token");
    const n = localStorage.getItem("userName");
    if (t) { setToken(t); setUserName(n || ""); }
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!token) {
    return <AuthPage onAuth={(t, n) => { setToken(t); setUserName(n); }} />;
  }

  return (
    <Dashboard
      token={token}
      userName={userName}
      onLogout={() => {
        localStorage.removeItem("token");
        localStorage.removeItem("userName");
        setToken(null);
      }}
    />
  );
}
