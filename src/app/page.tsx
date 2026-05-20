"use client";

import { useEffect, useState, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error");
  return data;
}

async function apiGet(path: string, token: string) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

interface Session { id: number; params: string; result: string; status: string; created_at: string; }
interface Device { id: number; device_id: string; device_name: string | null; android_version: string | null; created_at: string; }
type Page = "dashboard" | "fleet" | "warmup" | "history" | "settings";

const NAV: { id: Page; icon: string; label: string }[] = [
  { id: "dashboard", icon: "📊", label: "Dashboard" },
  { id: "fleet", icon: "📱", label: "Fleet" },
  { id: "warmup", icon: "🔄", label: "Warmup" },
  { id: "history", icon: "📋", label: "Historial" },
  { id: "settings", icon: "⚙️", label: "Settings" },
];

function parseResult(s: Session) {
  return JSON.parse(s.result || "{}") as Record<string, number>;
}
function parseParams(s: Session) {
  return JSON.parse(s.params || "{}") as Record<string, string>;
}
function fmtDate(iso: string) {
  try {
    const d = new Date(iso), now = new Date(), diff = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diff < 1) return "Ahora";
    if (diff < 60) return `Hace ${diff}m`;
    if (diff < 1440) return `Hace ${Math.floor(diff / 60)}h`;
    return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch { return ""; }
}

// ─── Shared components ───
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl p-5 ${className}`} style={{ background: "#18181b", border: "1px solid #27272a" }}>{children}</div>;
}

function StatCard({ icon, value, label, color }: { icon: string; value: number; label: string; color: string }) {
  return (
    <Card className="text-center">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-zinc-600">{label}</div>
    </Card>
  );
}

// ─── Auth ───
function AuthPage({ onAuth }: { onAuth: (t: string, n: string) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(""); setLoading(true);
    try {
      const data = isLogin ? await apiPost("/api/auth/login", { email, password }) : await apiPost("/api/auth/register", { email, password, name });
      localStorage.setItem("token", data.token); localStorage.setItem("userName", data.user.name);
      onAuth(data.token, data.user.name);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#09090b" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}><span className="text-3xl">🌿</span></div>
          <h1 className="text-3xl font-bold tracking-tight"><span style={{ color: "#22c55e" }}>South</span>Farm</h1>
          <p className="text-zinc-500 mt-1 text-sm">Control Center</p>
        </div>
        <div className="flex rounded-xl p-1 mb-6" style={{ background: "#18181b" }}>
          <button onClick={() => setIsLogin(true)} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${isLogin ? "text-black" : "text-zinc-500"}`} style={isLogin ? { background: "#22c55e" } : {}}>Iniciar Sesión</button>
          <button onClick={() => setIsLogin(false)} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${!isLogin ? "text-black" : "text-zinc-500"}`} style={!isLogin ? { background: "#22c55e" } : {}}>Crear Cuenta</button>
        </div>
        <div className="space-y-3">
          {!isLogin && <input type="text" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl px-4 py-3 text-white placeholder-zinc-500 outline-none" style={{ background: "#18181b", border: "1px solid #27272a" }} />}
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl px-4 py-3 text-white placeholder-zinc-500 outline-none" style={{ background: "#18181b", border: "1px solid #27272a" }} />
          <input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="w-full rounded-xl px-4 py-3 text-white placeholder-zinc-500 outline-none" style={{ background: "#18181b", border: "1px solid #27272a" }} />
        </div>
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        <button onClick={submit} disabled={loading} className="w-full mt-6 text-black font-bold py-3 rounded-xl transition hover:brightness-110 disabled:opacity-50" style={{ background: "#22c55e" }}>{loading ? "..." : isLogin ? "Iniciar Sesión" : "Crear Cuenta"}</button>
      </div>
    </div>
  );
}

// ─── Sidebar ───
function Sidebar({ current, onNav, userName, onLogout }: { current: Page; onNav: (p: Page) => void; userName: string; onLogout: () => void }) {
  return (
    <aside className="hidden md:flex flex-col w-[240px] h-screen sticky top-0" style={{ background: "#0f0f12", borderRight: "1px solid #1f1f23" }}>
      <div className="px-5 py-5 flex items-center gap-3" style={{ borderBottom: "1px solid #1f1f23" }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}><span className="text-lg">🌿</span></div>
        <span className="font-bold text-lg tracking-tight"><span style={{ color: "#22c55e" }}>South</span>Farm</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map((item) => (
          <button key={item.id} onClick={() => onNav(item.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${current === item.id ? "text-white" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"}`} style={current === item.id ? { background: "rgba(34,197,94,0.1)" } : {}}>
            <span className="text-base">{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <div className="p-4" style={{ borderTop: "1px solid #1f1f23" }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>{userName.charAt(0).toUpperCase()}</div>
          <span className="text-sm text-zinc-300 truncate">{userName}</span>
        </div>
        <button onClick={onLogout} className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition py-2 rounded-lg hover:bg-white/5">Cerrar sesión</button>
      </div>
    </aside>
  );
}

function MobileNav({ current, onNav }: { current: Page; onNav: (p: Page) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex" style={{ background: "#0f0f12", borderTop: "1px solid #1f1f23" }}>
      {NAV.map((item) => (
        <button key={item.id} onClick={() => onNav(item.id)} className={`flex-1 flex flex-col items-center py-2 text-xs transition ${current === item.id ? "text-green-400" : "text-zinc-600"}`}>
          <span className="text-lg mb-0.5">{item.icon}</span><span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── Pages ───
function DashboardPage({ sessions, devices }: { sessions: Session[]; devices: Device[] }) {
  const tR = sessions.reduce((s, r) => s + (parseResult(r).reels_viewed || 0), 0);
  const tL = sessions.reduce((s, r) => s + (parseResult(r).likes || 0), 0);
  const tM = sessions.reduce((s, r) => s + Math.floor((parseResult(r).elapsed_sec || 0) / 60), 0);
  return (
    <div>
      <h2 className="text-xl font-bold mb-5">Dashboard</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon="📋" value={sessions.length} label="Sesiones" color="#22c55e" />
        <StatCard icon="▶️" value={tR} label="Reels vistos" color="#3b82f6" />
        <StatCard icon="❤️" value={tL} label="Likes dados" color="#ec4899" />
        <StatCard icon="⏱️" value={tM} label="Minutos" color="#f59e0b" />
      </div>
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Fleet</h3>
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>{devices.length} dispositivos</span>
        </div>
        {devices.length === 0 ? <p className="text-zinc-600 text-sm">Instalá la app en un teléfono para verlo acá</p> : (
          <div className="space-y-2">{devices.slice(0, 3).map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: "#0f0f12" }}>
              <div className="flex items-center gap-3"><span className="text-lg">📱</span><div><p className="text-sm font-medium">{d.device_name || d.device_id.slice(0, 12)}</p><p className="text-xs text-zinc-600">Android {d.android_version || "?"}</p></div></div>
              <span className="w-2 h-2 rounded-full bg-green-500" />
            </div>
          ))}</div>
        )}
      </Card>
      <Card>
        <h3 className="font-semibold text-sm mb-3">Actividad reciente</h3>
        {sessions.length === 0 ? <p className="text-zinc-600 text-sm">No hay actividad todavía</p> : (
          <div className="space-y-2">{sessions.slice(0, 5).map((s) => { const p = parseParams(s), r = parseResult(s); return (
            <div key={s.id} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: "#0f0f12" }}>
              <div className="flex items-center gap-3"><span>{s.status === "completed" ? "✅" : "⏹️"}</span><span className="text-sm">@{p.account || "?"}</span></div>
              <div className="flex gap-3 text-xs"><span style={{ color: "#93c5fd" }}>{r.reels_viewed || 0} ▶</span><span style={{ color: "#f9a8d4" }}>{r.likes || 0} ❤</span><span style={{ color: "#fcd34d" }}>{r.saves || 0} 🔖</span></div>
            </div>
          ); })}</div>
        )}
      </Card>
    </div>
  );
}

function FleetPage({ devices, loading, onRefresh }: { devices: Device[]; loading: boolean; onRefresh: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold">Fleet</h2>
        <button onClick={onRefresh} className="text-xs px-3 py-1.5 rounded-lg transition hover:bg-white/5" style={{ border: "1px solid #27272a", color: "#a1a1aa" }}>{loading ? "..." : "↻ Refresh"}</button>
      </div>
      {devices.length === 0 ? (
        <Card className="text-center p-8"><span className="text-4xl mb-3 block">📱</span><p className="text-zinc-400 font-medium mb-1">No hay dispositivos conectados</p><p className="text-zinc-600 text-sm">Instalá la app SouthFarm en un teléfono Android y logueate</p></Card>
      ) : (
        <div className="space-y-3">{devices.map((d) => (
          <Card key={d.id} className="flex items-center justify-between">
            <div className="flex items-center gap-4"><div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: "rgba(34,197,94,0.1)" }}>📱</div><div><p className="font-semibold">{d.device_name || "Dispositivo desconocido"}</p><p className="text-xs text-zinc-500 mt-0.5">Android {d.android_version || "?"} · ID: {d.device_id.slice(0, 16)}...</p></div></div>
            <div className="flex items-center gap-3"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /></div>
          </Card>
        ))}</div>
      )}
    </div>
  );
}

interface IGAccount { id: number; username: string; device_id: number; }

function WarmupPage({ devices, token }: { devices: Device[]; token: string }) {
  const [account, setAccount] = useState("");
  const [duration, setDuration] = useState("2");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [igAccounts, setIgAccounts] = useState<IGAccount[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<number>(devices[0]?.id || 0);

  useEffect(() => {
    if (selectedDevice) {
      apiGet(`/api/ig-accounts?device_id=${selectedDevice}`, token).then((data) => {
        setIgAccounts(data.accounts || []);
        if ((data.accounts || []).length > 0) setAccount(data.accounts[0].username);
      });
    }
  }, [selectedDevice, token]);

  const launch = async () => {
    if (!account || devices.length === 0) return;
    setSending(true); setMsg("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const t = localStorage.getItem("token");
      if (t) headers["Authorization"] = `Bearer ${t}`;
      const res = await fetch(`${API}/api/tasks/run`, { method: "POST", headers, body: JSON.stringify({ task_type: "warmup_ig", device_id: selectedDevice || devices[0].id, params: { account, duration_minutes: parseInt(duration) } }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setMsg(`✅ Warmup encolado (ID: ${data.task_run.id})`);
    } catch (e) { setMsg(`❌ Error: ${e instanceof Error ? e.message : "desconocido"}`); } finally { setSending(false); }
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-5">Lanzar Warmup</h2>
      {devices.length === 0 ? (
        <Card className="text-center p-8"><p className="text-zinc-400">No hay dispositivos disponibles</p><p className="text-zinc-600 text-sm mt-1">Conectá un teléfono primero</p></Card>
      ) : (
        <Card className="space-y-4">
          <div><label className="text-xs text-zinc-500 font-medium mb-1.5 block">Dispositivo</label>
            <select value={selectedDevice} onChange={(e) => setSelectedDevice(Number(e.target.value))} className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none" style={{ background: "#0f0f12", border: "1px solid #27272a" }}>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.device_name || d.device_id.slice(0, 16)}</option>)}
            </select>
          </div>
          <div><label className="text-xs text-zinc-500 font-medium mb-1.5 block">Cuenta de Instagram</label>
            {igAccounts.length > 0 ? (
              <select value={account} onChange={(e) => setAccount(e.target.value)} className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none" style={{ background: "#0f0f12", border: "1px solid #27272a" }}>
                {igAccounts.map((a) => <option key={a.id} value={a.username}>@{a.username}</option>)}
              </select>
            ) : (
              <input type="text" placeholder="@username (escaneá cuentas en la app)" value={account} onChange={(e) => setAccount(e.target.value)} className="w-full rounded-xl px-4 py-3 text-white placeholder-zinc-600 outline-none" style={{ background: "#0f0f12", border: "1px solid #27272a" }} />
            )}
          </div>
          <div><label className="text-xs text-zinc-500 font-medium mb-1.5 block">Duración</label><div className="flex gap-2">{["1", "2", "5", "10"].map((d) => (<button key={d} onClick={() => setDuration(d)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${duration === d ? "text-black" : "text-zinc-500"}`} style={duration === d ? { background: "#22c55e" } : { background: "#0f0f12", border: "1px solid #27272a" }}>{d}m</button>))}</div></div>
          <button onClick={launch} disabled={sending || !account} className="w-full py-3 rounded-xl font-bold text-black transition hover:brightness-110 disabled:opacity-40" style={{ background: "#22c55e" }}>{sending ? "Enviando..." : "🚀 Lanzar Warmup"}</button>
          {msg && <p className="text-sm text-center">{msg}</p>}
        </Card>
      )}
    </div>
  );
}

function HistoryPage({ sessions }: { sessions: Session[] }) {
  const tR = sessions.reduce((s, r) => s + (parseResult(r).reels_viewed || 0), 0);
  const tL = sessions.reduce((s, r) => s + (parseResult(r).likes || 0), 0);
  const tS = sessions.reduce((s, r) => s + (parseResult(r).saves || 0), 0);
  return (
    <div>
      <h2 className="text-xl font-bold mb-5">Historial</h2>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl p-4 text-center" style={{ background: "#18181b", border: "1px solid #27272a" }}><div className="text-xl font-bold" style={{ color: "#3b82f6" }}>{tR}</div><div className="text-xs text-zinc-600">Reels</div></div>
        <div className="rounded-xl p-4 text-center" style={{ background: "#18181b", border: "1px solid #27272a" }}><div className="text-xl font-bold" style={{ color: "#ec4899" }}>{tL}</div><div className="text-xs text-zinc-600">Likes</div></div>
        <div className="rounded-xl p-4 text-center" style={{ background: "#18181b", border: "1px solid #27272a" }}><div className="text-xl font-bold" style={{ color: "#f59e0b" }}>{tS}</div><div className="text-xs text-zinc-600">Saves</div></div>
      </div>
      {sessions.length === 0 ? (
        <Card className="text-center p-8"><span className="text-4xl mb-3 block">📋</span><p className="text-zinc-400">No hay sesiones todavía</p></Card>
      ) : (
        <div className="space-y-2">{sessions.map((s) => { const p = parseParams(s), r = parseResult(s); return (
          <Card key={s.id} className="flex items-center justify-between !p-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${s.status === "completed" ? "" : ""}`} style={{ background: s.status === "completed" ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)" }}>{s.status === "completed" ? "✅" : "⏹️"}</div>
              <div><p className="font-semibold text-sm">@{p.account || "?"}</p><p className="text-xs text-zinc-600">{fmtDate(s.created_at)}</p></div>
            </div>
            <div className="flex gap-4 text-sm"><span style={{ color: "#93c5fd" }}>{r.reels_viewed || 0} ▶</span><span style={{ color: "#f9a8d4" }}>{r.likes || 0} ❤</span><span style={{ color: "#fcd34d" }}>{r.saves || 0} 🔖</span></div>
          </Card>
        ); })}</div>
      )}
    </div>
  );
}

function SettingsPage({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-5">Settings</h2>
      <Card>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>{userName.charAt(0).toUpperCase()}</div>
          <div><p className="font-semibold text-lg">{userName}</p><p className="text-sm text-zinc-500">Plan: Free</p></div>
        </div>
        <button onClick={onLogout} className="w-full py-3 rounded-xl font-medium transition hover:brightness-110" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>Cerrar sesión</button>
      </Card>
    </div>
  );
}

// ─── Main App ───
export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [page, setPage] = useState<Page>("dashboard");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  const loadData = useCallback(async (t: string) => {
    setLoading(true);
    const [sData, dData] = await Promise.all([apiGet("/api/warmup-sessions", t), apiGet("/api/devices", t)]);
    setSessions(sData.sessions || []);
    setDevices(dData.devices || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem("token"), n = localStorage.getItem("userName");
    if (t) { setToken(t); setUserName(n || ""); loadData(t); }
    setReady(true);
  }, [loadData]);

  if (!ready) return null;
  if (!token) return <AuthPage onAuth={(t, n) => { setToken(t); setUserName(n); loadData(t); }} />;

  const logout = () => { localStorage.removeItem("token"); localStorage.removeItem("userName"); setToken(null); };

  return (
    <div className="flex min-h-screen" style={{ background: "#09090b" }}>
      <Sidebar current={page} onNav={setPage} userName={userName} onLogout={logout} />
      <main className="flex-1 p-6 pb-24 md:pb-6 max-w-4xl">
        {page === "dashboard" && <DashboardPage sessions={sessions} devices={devices} />}
        {page === "fleet" && <FleetPage devices={devices} loading={loading} onRefresh={() => loadData(token)} />}
        {page === "warmup" && <WarmupPage devices={devices} token={token} />}
        {page === "history" && <HistoryPage sessions={sessions} />}
        {page === "settings" && <SettingsPage userName={userName} onLogout={logout} />}
      </main>
      <MobileNav current={page} onNav={setPage} />
    </div>
  );
}
