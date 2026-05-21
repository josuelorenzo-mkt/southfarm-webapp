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

// SVG Icons — stroke-based, 1.5px
const DashboardIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
);
const PhoneIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18.01" /></svg>
);
const ActivityIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
);
const GearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001.08 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09c-.658.003-1.25.396-1.51 1z" /></svg>
);
const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
);
const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
);
const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
);

const NAV: { id: Page; label: string; icon: () => React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: () => <DashboardIcon /> },
  { id: "fleet", label: "Fleet", icon: () => <PhoneIcon /> },
  { id: "warmup", label: "Warmup", icon: () => <ActivityIcon /> },
  { id: "history", label: "Historial", icon: () => <ActivityIcon /> },
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

function fmtToday() {
  const d = new Date();
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ─── Auth ──────────────────────────────────────────────
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
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--sf-bg)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold" style={{ background: "var(--sf-accent)", color: "#0a0a0a" }}>S</div>
          <p className="text-sm" style={{ color: "var(--sf-text-secondary)" }}>Control Center</p>
        </div>
        <div className="rounded-xl p-6" style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)" }}>
          <div className="flex rounded-lg p-1 mb-5" style={{ background: "var(--sf-muted)" }}>
            <button onClick={() => setIsLogin(true)} className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${isLogin ? "" : ""}`} style={isLogin ? { background: "var(--sf-accent)", color: "#0a0a0a" } : { color: "var(--sf-text-secondary)" }}>Login</button>
            <button onClick={() => setIsLogin(false)} className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all`} style={!isLogin ? { background: "var(--sf-accent)", color: "#0a0a0a" } : { color: "var(--sf-text-secondary)" }}>Register</button>
          </div>
          <div className="space-y-3">
            {!isLogin && <input type="text" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg px-4 py-3 text-sm placeholder-zinc-600" style={{ background: "var(--sf-muted)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }} />}
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg px-4 py-3 text-sm placeholder-zinc-600" style={{ background: "var(--sf-muted)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }} />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="w-full rounded-lg px-4 py-3 text-sm placeholder-zinc-600" style={{ background: "var(--sf-muted)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }} />
          </div>
          {error && <p className="text-sm mt-3" style={{ color: "var(--sf-red)" }}>{error}</p>}
          <button onClick={submit} disabled={loading} className="w-full mt-5 font-bold py-3 rounded-lg text-sm transition hover:brightness-110 disabled:opacity-50" style={{ background: "var(--sf-accent)", color: "#0a0a0a" }}>{loading ? "..." : isLogin ? "Login" : "Crear Cuenta"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar (60px icon-only) ──────────────────────────
function Sidebar({ current, onNav }: { current: Page; onNav: (p: Page) => void }) {
  return (
    <aside className="hidden md:flex flex-col items-center w-[60px] h-screen sticky top-0 py-4 gap-1" style={{ background: "var(--sf-sidebar)" }}>
      <div className="text-xl font-bold mb-6" style={{ color: "var(--sf-accent)" }}>S</div>
      {NAV.map((item) => (
        <button key={item.id} onClick={() => onNav(item.id)} title={item.label} className="w-10 h-10 flex items-center justify-center rounded-[10px] transition-all" style={current === item.id ? { background: "var(--sf-card)", color: "var(--sf-accent)", opacity: 1 } : { color: "#e8dcc8", opacity: 0.5 }}>
          {item.icon()}
        </button>
      ))}
    </aside>
  );
}

function MobileNav({ current, onNav }: { current: Page; onNav: (p: Page) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex" style={{ background: "var(--sf-sidebar)", borderTop: "1px solid var(--sf-border)" }}>
      {NAV.map((item) => (
        <button key={item.id} onClick={() => onNav(item.id)} className="flex-1 flex flex-col items-center py-2 text-xs transition gap-0.5" style={current === item.id ? { color: "var(--sf-accent)" } : { color: "var(--sf-text-secondary)", opacity: 0.5 }}>
          {item.icon()}<span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── Stats Strip ───────────────────────────────────────
function StatsStrip({ sessions }: { sessions: Session[] }) {
  const tR = sessions.reduce((s, r) => s + (r.reels_viewed || 0), 0);
  const tL = sessions.reduce((s, r) => s + (r.likes || 0), 0);
  const tM = sessions.reduce((s, r) => s + Math.floor((r.elapsed_sec || 0) / 60), 0);
  const stats = [
    { value: sessions.length, label: "Sesiones", color: "var(--sf-accent)" },
    { value: tR, label: "Reels", color: "var(--sf-blue)" },
    { value: tL, label: "Likes", color: "var(--sf-pink)" },
    { value: tM, label: "Minutos", color: "var(--sf-amber)" },
  ];
  return (
    <div className="flex mb-8 rounded-lg overflow-hidden" style={{ border: "1px solid var(--sf-border)" }}>
      {stats.map((s, i) => (
        <div key={i} className="flex-1 py-5 text-center" style={{ borderRight: i < stats.length - 1 ? "1px solid var(--sf-border)" : "none" }}>
          <div className="text-[36px] font-bold leading-none" style={{ color: s.color }}>{s.value}</div>
          <div className="text-[11px] uppercase mt-1" style={{ letterSpacing: "2px", opacity: 0.4 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] uppercase font-semibold mb-4" style={{ letterSpacing: "2px", opacity: 0.4 }}>{children}</div>;
}

// ─── Dashboard ─────────────────────────────────────────
function DashboardPage({ sessions, devices }: { sessions: Session[]; devices: Device[] }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[22px] font-semibold" style={{ color: "var(--sf-text)" }}>Dashboard</h1>
        <span className="text-sm" style={{ opacity: 0.4 }}>{fmtToday()}</span>
      </div>
      <StatsStrip sessions={sessions} />

      <SectionTitle>Fleet</SectionTitle>
      <div className="flex gap-3 overflow-x-auto pb-2 mb-8">
        {devices.length === 0 ? (
          <div className="rounded-lg px-4 py-3 text-sm" style={{ background: "var(--sf-card)", color: "var(--sf-text-secondary)" }}>No hay dispositivos conectados</div>
        ) : devices.map((d) => (
          <div key={d.id} className="rounded-[10px] p-4 flex-shrink-0" style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)", minWidth: 200 }}>
            <div className="font-semibold text-[15px] mb-1" style={{ color: "var(--sf-text)" }}>{d.device_name || d.device_id.slice(0, 12)}</div>
            <div className="text-xs mb-2" style={{ color: "var(--sf-text-secondary)", opacity: 0.4 }}>Android {d.android_version || "?"}</div>
            <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: "var(--sf-muted)", color: "var(--sf-accent)" }}>Active</span>
          </div>
        ))}
      </div>

      <SectionTitle>Activity</SectionTitle>
      <div>
        {sessions.length === 0 ? (
          <div className="text-sm py-4" style={{ color: "var(--sf-text-secondary)" }}>No hay actividad todavia</div>
        ) : sessions.slice(0, 8).map((s) => {
          const colors = ["var(--sf-blue)", "var(--sf-pink)", "var(--sf-amber)", "var(--sf-accent)"];
          const c = colors[s.id % colors.length];
          const initial = (s.account || "?").charAt(0).toUpperCase();
          return (
            <div key={s.id} className="flex items-center py-3 gap-3" style={{ borderBottom: "1px solid var(--sf-border)" }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c }}>{initial}</div>
              <div className="flex-1 text-[13px]">
                <strong style={{ color: "var(--sf-accent)" }}>@{s.account || "?"}</strong> warmup session — {s.reels_viewed || 0} reels, {s.likes || 0} likes
              </div>
              <div className="text-[11px] flex-shrink-0" style={{ opacity: 0.3 }}>{fmtDate(s.timestamp)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Fleet ─────────────────────────────────────────────
function FleetPage({ devices, loading, onRefresh }: { devices: Device[]; loading: boolean; onRefresh: () => void }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[22px] font-semibold" style={{ color: "var(--sf-text)" }}>Fleet</h1>
        <button onClick={onRefresh} className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition hover:bg-white/5" style={{ border: "1px solid var(--sf-border)", color: "var(--sf-text-secondary)" }}>{loading ? "..." : <><RefreshIcon /> Refresh</>}</button>
      </div>
      <StatsStrip sessions={[]} />
      {devices.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)" }}>
          <div className="flex justify-center mb-3" style={{ color: "var(--sf-text-secondary)" }}><PhoneIcon /></div>
          <p className="font-medium mb-1">No hay dispositivos conectados</p>
          <p className="text-sm" style={{ color: "var(--sf-text-secondary)" }}>Instala SouthFarm en un telefono Android</p>
        </div>
      ) : (
        <div className="space-y-3">{devices.map((d) => (
          <div key={d.id} className="rounded-[10px] p-4 flex items-center justify-between" style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)" }}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "var(--sf-muted)" }}><PhoneIcon /></div>
              <div>
                <p className="font-semibold">{d.device_name || "Dispositivo desconocido"}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--sf-text-secondary)" }}>Android {d.android_version || "?"} · {d.device_id.slice(0, 16)}</p>
              </div>
            </div>
            <span className="pulse-dot inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--sf-accent)" }} />
          </div>
        ))}</div>
      )}
    </div>
  );
}

// ─── Warmup ────────────────────────────────────────────
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

  const sel = { background: "var(--sf-muted)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[22px] font-semibold" style={{ color: "var(--sf-text)" }}>Lanzar Warmup</h1>
      </div>
      {devices.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)" }}>
          <p className="font-medium">No hay dispositivos disponibles</p>
          <p className="text-sm mt-1" style={{ color: "var(--sf-text-secondary)" }}>Conecta un telefono primero</p>
        </div>
      ) : (
        <div className="rounded-xl p-6 space-y-5" style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)" }}>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--sf-text-secondary)" }}>Dispositivo</label>
            <select value={selectedDevice} onChange={(e) => setSelectedDevice(Number(e.target.value))} className="w-full rounded-lg px-4 py-3 text-sm" style={sel}>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.device_name || d.device_id.slice(0, 16)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--sf-text-secondary)" }}>Cuenta de Instagram</label>
            {igAccounts.length > 0 ? (
              <select value={account} onChange={(e) => setAccount(e.target.value)} className="w-full rounded-lg px-4 py-3 text-sm" style={sel}>
                {igAccounts.map((a) => <option key={a.id} value={a.username}>@{a.username}</option>)}
              </select>
            ) : (
              <input type="text" placeholder="@username" value={account} onChange={(e) => setAccount(e.target.value)} className="w-full rounded-lg px-4 py-3 text-sm placeholder-zinc-600" style={{ background: "var(--sf-muted)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }} />
            )}
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--sf-text-secondary)" }}>Duracion</label>
            <div className="flex gap-2">{["2", "5", "10", "20"].map((d) => (
              <button key={d} onClick={() => setDuration(d)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition`} style={duration === d ? { background: "var(--sf-accent)", color: "#0a0a0a" } : { background: "var(--sf-muted)", border: "1px solid var(--sf-border)", color: "var(--sf-text-secondary)" }}>{d}m</button>
            ))}</div>
          </div>
          <button onClick={launch} disabled={sending || !account} className="w-full py-3.5 rounded-lg font-bold text-sm transition hover:brightness-110 disabled:opacity-40" style={{ background: "var(--sf-accent)", color: "#0a0a0a" }}>
            {sending ? "Enviando..." : "Lanzar Warmup"}
          </button>
          {msg && <p className="text-sm text-center" style={{ color: msg.startsWith("Error") ? "var(--sf-red)" : "var(--sf-accent)" }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}

// ─── History ───────────────────────────────────────────
function HistoryPage({ sessions }: { sessions: Session[] }) {
  const tR = sessions.reduce((s, r) => s + (r.reels_viewed || 0), 0);
  const tL = sessions.reduce((s, r) => s + (r.likes || 0), 0);
  const tS = sessions.reduce((s, r) => s + (r.saves || 0), 0);
  const tM = sessions.reduce((s, r) => s + Math.floor((r.elapsed_sec || 0) / 60), 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[22px] font-semibold" style={{ color: "var(--sf-text)" }}>Historial</h1>
        <span className="text-sm" style={{ opacity: 0.4 }}>{fmtToday()}</span>
      </div>
      {/* Stats strip */}
      <div className="flex mb-8 rounded-lg overflow-hidden" style={{ border: "1px solid var(--sf-border)" }}>
        {[
          { value: sessions.length, label: "Sesiones", color: "var(--sf-accent)" },
          { value: tR, label: "Reels", color: "var(--sf-blue)" },
          { value: tL, label: "Likes", color: "var(--sf-pink)" },
          { value: tM, label: "Minutos", color: "var(--sf-amber)" },
        ].map((s, i, arr) => (
          <div key={i} className="flex-1 py-5 text-center" style={{ borderRight: i < arr.length - 1 ? "1px solid var(--sf-border)" : "none" }}>
            <div className="text-[36px] font-bold leading-none" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[11px] uppercase mt-1" style={{ letterSpacing: "2px", opacity: 0.4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {sessions.length === 0 ? (
        <div className="text-sm py-4" style={{ color: "var(--sf-text-secondary)" }}>No hay sesiones todavia</div>
      ) : sessions.map((s) => {
        const colors = ["var(--sf-blue)", "var(--sf-pink)", "var(--sf-amber)"];
        const c = colors[s.id % colors.length];
        return (
          <div key={s.id} className="flex items-center py-3 gap-3" style={{ borderBottom: "1px solid var(--sf-border)" }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c }}>
              {s.status === "completed" ? <CheckIcon /> : <StopIcon />}
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-semibold" style={{ color: "var(--sf-accent)" }}>@{s.account || "?"}</div>
              <div className="text-xs" style={{ color: "var(--sf-text-secondary)", opacity: 0.4 }}>{fmtDate(s.timestamp)}</div>
            </div>
            <div className="flex gap-4 text-xs" style={{ color: "var(--sf-text-secondary)" }}>
              <span style={{ color: "var(--sf-blue)" }}>{s.reels_viewed || 0} reels</span>
              <span style={{ color: "var(--sf-pink)" }}>{s.likes || 0} likes</span>
              <span style={{ color: "var(--sf-amber)" }}>{s.saves || 0} saves</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Settings ──────────────────────────────────────────
function SettingsPage({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[22px] font-semibold" style={{ color: "var(--sf-text)" }}>Settings</h1>
      </div>
      <div className="rounded-xl p-6" style={{ background: "var(--sf-card)", border: "1px solid var(--sf-border)" }}>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold" style={{ background: "var(--sf-muted)", color: "var(--sf-accent)" }}>{userName.charAt(0).toUpperCase()}</div>
          <div>
            <p className="font-semibold text-lg">{userName}</p>
            <p className="text-sm" style={{ color: "var(--sf-text-secondary)" }}>Plan: Free</p>
          </div>
        </div>
        <button onClick={onLogout} className="w-full py-3 rounded-lg font-medium transition hover:brightness-110" style={{ background: "rgba(239,68,68,0.1)", color: "var(--sf-red)" }}>Cerrar sesion</button>
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────
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
      <Sidebar current={page} onNav={setPage} />
      <main className="flex-1 p-6 pb-24 md:pb-6">
        {page === "dashboard" && <DashboardPage sessions={sessions} devices={devices} />}
        {page === "fleet" && <FleetPage devices={devices} loading={loading} onRefresh={() => loadData(token!)} />}
        {page === "warmup" && <WarmupPage devices={devices} token={token!} />}
        {page === "history" && <HistoryPage sessions={sessions} />}
        {page === "settings" && <SettingsPage userName={userName} onLogout={logout} />}
      </main>
      <MobileNav current={page} onNav={setPage} />
    </div>
  );
}
