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

// Updated interfaces - backend returns merged fields
interface Session {
  id: number;
  account: string;
  reels_viewed: number;
  likes: number;
  saves: number;
  elapsed_sec: number;
  status: string;
  timestamp: string;
}

interface Device { id: number; device_id: string; device_name: string | null; android_version: string | null; created_at: string; }
interface IGAccount { id: number; username: string; device_id: number; }
type Page = "dashboard" | "fleet" | "warmup" | "history" | "settings";

// SVG Icons (no emojis)
const LeafIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.8 10-10 10Z" />
    <path d="M2 21c0-3 1.9-5.5 4.5-6.5" />
  </svg>
);

const DashboardIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
);

const PhoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18.01" /></svg>
);

const PlayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
);

const ClockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
);

const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
);

const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
);

const NAV: { id: Page; label: string; icon: () => React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: () => <DashboardIcon /> },
  { id: "fleet", label: "Fleet", icon: () => <PhoneIcon /> },
  { id: "warmup", label: "Warmup", icon: () => <PlayIcon /> },
  { id: "history", label: "Historial", icon: () => <ClockIcon /> },
  { id: "settings", label: "Settings", icon: () => <GearIcon /> },
];

function fmtDate(iso: string) {
  try {
    const d = new Date(iso), now = new Date(), diff = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diff < 1) return "Ahora";
    if (diff < 60) return `hace ${diff}m`;
    if (diff < 1440) return `hace ${Math.floor(diff / 60)}h`;
    if (diff < 2880) return "ayer";
    return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch { return ""; }
}

function Logo({ size = "lg" }: { size?: "sm" | "lg" }) {
  const s = size === "lg" ? 28 : 18;
  return (
    <span className="flex items-center gap-2 font-bold tracking-tight" style={{ fontSize: size === "lg" ? "1.5rem" : "1rem" }}>
      <span style={{ color: "var(--sf-accent)" }}><LeafIcon size={s} /></span>
      <span><span style={{ color: "var(--sf-accent)" }}>South</span><span style={{ color: "var(--sf-text)" }}>Farm</span></span>
    </span>
  );
}

// Shared
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl p-5 ${className}`} style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)" }}>{children}</div>;
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <Card className="flex flex-col items-center justify-center py-6">
      <div className="mb-2" style={{ color: "var(--sf-accent)" }}>{icon}</div>
      <div className="text-2xl font-bold" style={{ fontFamily: "var(--font-mono), monospace", color: "var(--sf-text)" }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: "var(--sf-text-dim)" }}>{label}</div>
    </Card>
  );
}

function OnlineDot() {
  return <span className="pulse-dot inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--sf-accent)" }} />;
}

// Auth
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

  const inputStyle = { background: "var(--sf-card)", border: "1px solid var(--sf-border)" };

  return (
    <div className="min-h-screen flex">
      {/* Left: gradient */}
      <div className="hidden md:flex flex-1 items-center justify-center" style={{ background: "radial-gradient(ellipse at 30% 50%, #0d2818 0%, #0b0f0b 70%)" }}>
        <div className="text-center">
          <LeafIcon size={64} />
          <p className="mt-4 text-sm" style={{ color: "var(--sf-text-dim)" }}>Digital Growth Automation</p>
        </div>
      </div>
      {/* Right: form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4"><Logo size="lg" /></div>
            <p className="text-sm" style={{ color: "var(--sf-text-dim)" }}>Control Center</p>
          </div>
          <div className="flex rounded-xl p-1 mb-6" style={{ background: "var(--sf-card)" }}>
            <button onClick={() => setIsLogin(true)} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${isLogin ? "text-black" : ""}`} style={isLogin ? { background: "var(--sf-accent)" } : { color: "var(--sf-text-dim)" }}>Iniciar Sesion</button>
            <button onClick={() => setIsLogin(false)} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${!isLogin ? "text-black" : ""}`} style={!isLogin ? { background: "var(--sf-accent)" } : { color: "var(--sf-text-dim)" }}>Crear Cuenta</button>
          </div>
          <div className="space-y-3">
            {!isLogin && <input type="text" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl px-4 py-3 placeholder-zinc-600" style={{ ...inputStyle, color: "var(--sf-text)" }} />}
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl px-4 py-3 placeholder-zinc-600" style={{ ...inputStyle, color: "var(--sf-text)" }} />
            <input type="password" placeholder="Contrasena" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="w-full rounded-xl px-4 py-3 placeholder-zinc-600" style={{ ...inputStyle, color: "var(--sf-text)" }} />
          </div>
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          <button onClick={submit} disabled={loading} className="w-full mt-6 font-bold py-3 rounded-xl transition hover:brightness-110 disabled:opacity-50" style={{ background: "var(--sf-accent)", color: "#0b0f0b" }}>{loading ? "..." : isLogin ? "Iniciar Sesion" : "Crear Cuenta"}</button>
        </div>
      </div>
    </div>
  );
}

// Sidebar
function Sidebar({ current, onNav, userName, onLogout }: { current: Page; onNav: (p: Page) => void; userName: string; onLogout: () => void }) {
  return (
    <aside className="hidden md:flex flex-col w-[240px] h-screen sticky top-0" style={{ background: "#0d120d", borderRight: "1px solid var(--sf-border)" }}>
      <div className="px-5 py-5 flex items-center gap-3" style={{ borderBottom: "1px solid var(--sf-border)" }}>
        <Logo size="sm" />
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map((item) => (
          <button key={item.id} onClick={() => onNav(item.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all`} style={current === item.id ? { background: "var(--sf-accent-dim)", color: "var(--sf-accent)" } : { color: "var(--sf-text-dim)" }}>
            {item.icon()}{item.label}
          </button>
        ))}
      </nav>
      <div className="p-4" style={{ borderTop: "1px solid var(--sf-border)" }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "var(--sf-accent-dim)", color: "var(--sf-accent)" }}>{userName.charAt(0).toUpperCase()}</div>
          <span className="text-sm truncate" style={{ color: "var(--sf-text)" }}>{userName}</span>
        </div>
        <button onClick={onLogout} className="w-full text-xs py-2 rounded-lg transition hover:bg-white/5" style={{ color: "var(--sf-text-dim)" }}>Cerrar sesion</button>
      </div>
    </aside>
  );
}

function MobileNav({ current, onNav }: { current: Page; onNav: (p: Page) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex" style={{ background: "#0d120d", borderTop: "1px solid var(--sf-border)" }}>
      {NAV.map((item) => (
        <button key={item.id} onClick={() => onNav(item.id)} className="flex-1 flex flex-col items-center py-2 text-xs transition gap-0.5" style={current === item.id ? { color: "var(--sf-accent)" } : { color: "var(--sf-text-dim)" }}>
          {item.icon()}<span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

// Dashboard
function DashboardPage({ sessions, devices }: { sessions: Session[]; devices: Device[] }) {
  const tR = sessions.reduce((s, r) => s + (r.reels_viewed || 0), 0);
  const tL = sessions.reduce((s, r) => s + (r.likes || 0), 0);
  const tM = sessions.reduce((s, r) => s + Math.floor((r.elapsed_sec || 0) / 60), 0);
  return (
    <div>
      <h2 className="text-xl font-bold mb-5" style={{ color: "var(--sf-text)" }}>Dashboard</h2>
      {/* Bento grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={<ClockIcon />} value={sessions.length} label="Sesiones" />
        <StatCard icon={<PlayIcon />} value={tR} label="Reels vistos" />
        <StatCard icon={<span className="text-lg">{"\u2665"}</span>} value={tL} label="Likes" />
        <StatCard icon={<span className="text-lg">{"\u25C6"}</span>} value={tM} label="Minutos" />
      </div>
      {/* Greenhouse */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm" style={{ color: "var(--sf-text)" }}>Greenhouse</h3>
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--sf-accent-dim)", color: "var(--sf-accent)" }}>{devices.length} dispositivos</span>
        </div>
        {devices.length === 0 ? <p className="text-sm" style={{ color: "var(--sf-text-dim)" }}>Instala la app en un telefono para verlo aca</p> : (
          <div className="space-y-2">{devices.slice(0, 3).map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: "var(--sf-bg)" }}>
              <div className="flex items-center gap-3"><PhoneIcon /><div><p className="text-sm font-medium" style={{ color: "var(--sf-text)" }}>{d.device_name || d.device_id.slice(0, 12)}</p><p className="text-xs" style={{ color: "var(--sf-text-dim)" }}>Android {d.android_version || "?"}</p></div></div>
              <OnlineDot />
            </div>
          ))}</div>
        )}
      </Card>
      {/* Recent activity */}
      <Card>
        <h3 className="font-semibold text-sm mb-3" style={{ color: "var(--sf-text)" }}>Actividad reciente</h3>
        {sessions.length === 0 ? <p className="text-sm" style={{ color: "var(--sf-text-dim)" }}>No hay actividad todavia</p> : (
          <div className="space-y-2">{sessions.slice(0, 5).map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: "var(--sf-bg)" }}>
              <div className="flex items-center gap-3">
                <span style={{ color: s.status === "completed" ? "var(--sf-accent)" : "var(--sf-amber)" }}>{s.status === "completed" ? <CheckIcon /> : <StopIcon />}</span>
                <span className="text-sm" style={{ fontFamily: "var(--font-mono), monospace", color: "var(--sf-text)" }}>@{s.account || "?"}</span>
              </div>
              <div className="flex gap-4 text-xs" style={{ fontFamily: "var(--font-mono), monospace", color: "var(--sf-text-dim)" }}>
                <span>{s.reels_viewed || 0} reels</span>
                <span>{s.likes || 0} likes</span>
              </div>
            </div>
          ))}</div>
        )}
      </Card>
    </div>
  );
}

// Fleet
function FleetPage({ devices, loading, onRefresh }: { devices: Device[]; loading: boolean; onRefresh: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold" style={{ color: "var(--sf-text)" }}>Fleet</h2>
        <button onClick={onRefresh} className="text-xs px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 hover:bg-white/5" style={{ border: "1px solid var(--sf-border)", color: "var(--sf-text-dim)" }}>{loading ? "..." : <><RefreshIcon /> Refresh</>}</button>
      </div>
      {devices.length === 0 ? (
        <Card className="text-center p-8">
          <div className="flex justify-center mb-3" style={{ color: "var(--sf-text-dim)" }}><PhoneIcon /></div>
          <p className="font-medium mb-1" style={{ color: "var(--sf-text)" }}>No hay dispositivos conectados</p>
          <p className="text-sm" style={{ color: "var(--sf-text-dim)" }}>Instala SouthFarm en un telefono Android y logueate</p>
        </Card>
      ) : (
        <div className="space-y-3">{devices.map((d) => (
          <Card key={d.id} className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "var(--sf-accent-dim)", color: "var(--sf-accent)" }}><PhoneIcon /></div>
              <div>
                <p className="font-semibold" style={{ color: "var(--sf-text)" }}>{d.device_name || "Dispositivo desconocido"}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--sf-text-dim)", fontFamily: "var(--font-mono), monospace" }}>Android {d.android_version || "?"} / {d.device_id.slice(0, 16)}</p>
              </div>
            </div>
            <OnlineDot />
          </Card>
        ))}</div>
      )}
    </div>
  );
}

// Warmup
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
      setMsg(`Warmup encolado (ID: ${data.task_run.id})`);
    } catch (e) { setMsg(`Error: ${e instanceof Error ? e.message : "desconocido"}`); } finally { setSending(false); }
  };

  const selectStyle = { background: "var(--sf-bg)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" };

  return (
    <div>
      <h2 className="text-xl font-bold mb-5" style={{ color: "var(--sf-text)" }}>Lanzar Warmup</h2>
      {devices.length === 0 ? (
        <Card className="text-center p-8">
          <p style={{ color: "var(--sf-text)" }}>No hay dispositivos disponibles</p>
          <p className="text-sm mt-1" style={{ color: "var(--sf-text-dim)" }}>Conecta un telefono primero</p>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--sf-text-dim)" }}>Dispositivo</label>
            <select value={selectedDevice} onChange={(e) => setSelectedDevice(Number(e.target.value))} className="w-full rounded-xl px-4 py-3 text-sm" style={selectStyle}>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.device_name || d.device_id.slice(0, 16)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--sf-text-dim)" }}>Cuenta de Instagram</label>
            {igAccounts.length > 0 ? (
              <select value={account} onChange={(e) => setAccount(e.target.value)} className="w-full rounded-xl px-4 py-3 text-sm" style={selectStyle}>
                {igAccounts.map((a) => <option key={a.id} value={a.username}>@{a.username}</option>)}
              </select>
            ) : (
              <input type="text" placeholder="@username" value={account} onChange={(e) => setAccount(e.target.value)} className="w-full rounded-xl px-4 py-3 placeholder-zinc-600" style={{ background: "var(--sf-bg)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }} />
            )}
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--sf-text-dim)" }}>Duracion</label>
            <div className="flex gap-2">{["1", "2", "5", "10"].map((d) => (
              <button key={d} onClick={() => setDuration(d)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${duration === d ? "font-bold" : ""}`} style={duration === d ? { background: "var(--sf-accent)", color: "#0b0f0b" } : { background: "var(--sf-bg)", border: "1px solid var(--sf-border)", color: "var(--sf-text-dim)" }}>{d}m</button>
            ))}</div>
          </div>
          <button onClick={launch} disabled={sending || !account} className="w-full py-3.5 rounded-xl font-bold text-lg transition hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "var(--sf-accent)", color: "#0b0f0b" }}>
            <PlayIcon />{sending ? "Enviando..." : "Lanzar Warmup"}
          </button>
          {msg && <p className="text-sm text-center" style={{ color: msg.startsWith("Error") ? "#ef4444" : "var(--sf-accent)" }}>{msg}</p>}
        </Card>
      )}
    </div>
  );
}

// History - FIXED: access merged fields directly, no parseResult/parseParams
function HistoryPage({ sessions }: { sessions: Session[] }) {
  const tR = sessions.reduce((s, r) => s + (r.reels_viewed || 0), 0);
  const tL = sessions.reduce((s, r) => s + (r.likes || 0), 0);
  const tS = sessions.reduce((s, r) => s + (r.saves || 0), 0);
  return (
    <div>
      <h2 className="text-xl font-bold mb-5" style={{ color: "var(--sf-text)" }}>Historial</h2>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl p-4 text-center" style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)" }}>
          <div className="text-xl font-bold" style={{ fontFamily: "var(--font-mono), monospace", color: "var(--sf-accent)" }}>{tR}</div>
          <div className="text-xs" style={{ color: "var(--sf-text-dim)" }}>Reels</div>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)" }}>
          <div className="text-xl font-bold" style={{ fontFamily: "var(--font-mono), monospace", color: "var(--sf-accent)" }}>{tL}</div>
          <div className="text-xs" style={{ color: "var(--sf-text-dim)" }}>Likes</div>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)" }}>
          <div className="text-xl font-bold" style={{ fontFamily: "var(--font-mono), monospace", color: "var(--sf-amber)" }}>{tS}</div>
          <div className="text-xs" style={{ color: "var(--sf-text-dim)" }}>Saves</div>
        </div>
      </div>
      {sessions.length === 0 ? (
        <Card className="text-center p-8">
          <div className="flex justify-center mb-3" style={{ color: "var(--sf-text-dim)" }}><ClockIcon /></div>
          <p style={{ color: "var(--sf-text)" }}>No hay sesiones todavia</p>
        </Card>
      ) : (
        <div className="space-y-2">{sessions.map((s) => (
          <Card key={s.id} className="flex items-center justify-between !p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: s.status === "completed" ? "var(--sf-accent-dim)" : "rgba(245,158,11,0.12)", color: s.status === "completed" ? "var(--sf-accent)" : "var(--sf-amber)" }}>
                {s.status === "completed" ? <CheckIcon /> : <StopIcon />}
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ fontFamily: "var(--font-mono), monospace", color: "var(--sf-text)" }}>@{s.account || "?"}</p>
                <p className="text-xs" style={{ color: "var(--sf-text-dim)" }}>{fmtDate(s.timestamp)}</p>
              </div>
            </div>
            <div className="flex gap-4 text-sm" style={{ fontFamily: "var(--font-mono), monospace", color: "var(--sf-text-dim)" }}>
              <span>{s.reels_viewed || 0} reels</span>
              <span>{s.likes || 0} likes</span>
              <span>{s.saves || 0} saves</span>
            </div>
          </Card>
        ))}</div>
      )}
    </div>
  );
}

// Settings
function SettingsPage({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-5" style={{ color: "var(--sf-text)" }}>Settings</h2>
      <Card>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold" style={{ background: "var(--sf-accent-dim)", color: "var(--sf-accent)" }}>{userName.charAt(0).toUpperCase()}</div>
          <div>
            <p className="font-semibold text-lg" style={{ color: "var(--sf-text)" }}>{userName}</p>
            <p className="text-sm" style={{ color: "var(--sf-text-dim)" }}>Plan: Free</p>
          </div>
        </div>
        <button onClick={onLogout} className="w-full py-3 rounded-xl font-medium transition hover:brightness-110" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>Cerrar sesion</button>
      </Card>
    </div>
  );
}

// Main
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
    <div className="flex min-h-screen" style={{ background: "var(--sf-bg)" }}>
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
