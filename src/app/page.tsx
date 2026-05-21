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
  duration_minutes?: number;
}

interface Device { id: number; device_id: string; device_name: string | null; android_version: string | null; created_at: string; }
interface IGAccount { id: number; username: string; device_id: number; }
type Page = "dashboard" | "fleet" | "history" | "settings";

// ─── SVG Icons ──────────────────────────────────────────
const IconDashboard = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
);
const IconPhone = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18.01" /></svg>
);
const IconActivity = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
);
const IconGear = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001.08 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09c-.658.003-1.25.396-1.51 1z" /></svg>
);
const IconCheck = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);
const IconStop = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
);
const IconRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
);
const IconClock = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
);
const IconSend = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
);
const IconZap = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
);
const IconUpload = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
);
const IconHourglass = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3h14M5 21h14M7 3v1.5a8 8 0 004 6.93A8 8 0 007 18.36V21M17 3v1.5a8 8 0 01-4 6.93A8 8 0 0117 18.36V21" /></svg>
);
const IconCheckCircle = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
);
const IconPalette = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" /><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" /><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" /><circle cx="6.5" cy="12" r="0.5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" /></svg>
);
const IconFlame = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z" /></svg>
);
const IconSprout = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 20h10" /><path d="M10 20c5.5-2.5.8-6.4 3-10" /><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" /><path d="M14.1 6a7 7 0 00-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" /></svg>
);

const NAV_SECTIONS = [
  { title: "Overview", items: [
    { id: "dashboard" as Page, label: "Dashboard", Icon: IconDashboard },
  ]},
  { title: "Operations", items: [
    { id: "fleet" as Page, label: "Fleet", Icon: IconPhone },
    { id: "history" as Page, label: "History", Icon: IconClock },
  ]},
  { title: "System", items: [
    { id: "settings" as Page, label: "Settings", Icon: IconGear },
  ]},
];

const NAV_FLAT: { id: Page; label: string; Icon: () => React.ReactNode }[] = NAV_SECTIONS.flatMap(s => s.items);

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
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
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

  const inputStyle = { background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg-base)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-[var(--radius-md)] flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(135deg, var(--accent) 0%, #15803d 100%)", boxShadow: "var(--shadow-md), var(--shadow-glow)" }}>
            <IconSprout />
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}><span style={{ color: "var(--accent)" }}>South</span>Farm</h1>
          <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Control Center</p>
        </div>
        <div className="rounded-[var(--radius-lg)]" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
          <div className="p-5 pb-0">
            <div className="flex rounded-[var(--radius-md)] p-1 mb-5" style={{ background: "var(--bg-elevated)" }}>
              <button onClick={() => setIsLogin(true)} className="flex-1 py-2 rounded-[var(--radius-sm)] text-sm font-semibold transition-all" style={isLogin ? { background: "var(--accent)", color: "#000" } : { color: "var(--text-secondary)" }}>Login</button>
              <button onClick={() => setIsLogin(false)} className="flex-1 py-2 rounded-[var(--radius-sm)] text-sm font-semibold transition-all" style={!isLogin ? { background: "var(--accent)", color: "#000" } : { color: "var(--text-secondary)" }}>Register</button>
            </div>
          </div>
          <div className="p-5 pt-0 space-y-3">
            {!isLogin && <input type="text" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-[var(--radius-md)] px-4 py-3 text-sm placeholder-zinc-600" style={inputStyle} />}
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-[var(--radius-md)] px-4 py-3 text-sm placeholder-zinc-600" style={inputStyle} />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="w-full rounded-[var(--radius-md)] px-4 py-3 text-sm placeholder-zinc-600" style={inputStyle} />
          </div>
          {error && <p className="text-sm px-5" style={{ color: "var(--error)" }}>{error}</p>}
          <div className="p-5 pt-2">
            <button onClick={submit} disabled={loading} className="w-full font-bold py-3 rounded-[var(--radius-md)] text-sm transition-all hover:brightness-110 disabled:opacity-50" style={{ background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)", color: "#000", border: "1px solid var(--accent)" }}>
              {loading ? "..." : isLogin ? "Login" : "Crear Cuenta"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar (full, with sections) ─────────────────────
function Sidebar({ current, onNav, deviceCount }: { current: Page; onNav: (p: Page) => void; deviceCount: number }) {
  return (
    <aside className="hidden lg:flex flex-col flex-shrink-0 h-screen" style={{ width: "var(--sidebar-width)", background: "var(--bg-surface)", borderRight: "1px solid var(--border-subtle)", zIndex: 100 }}>
      {/* Header */}
      <div style={{ padding: 20, borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center flex-shrink-0" style={{ width: 42, height: 42, background: "linear-gradient(135deg, var(--accent) 0%, #15803d 100%)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md), var(--shadow-glow)" }}>
            <IconSprout />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.2 }}><span style={{ color: "var(--accent)" }}>South</span>Farm</h1>
            <small style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Control Center</small>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto" style={{ padding: "16px 12px" }}>
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-dim)", padding: "0 12px", marginBottom: 8 }}>{section.title}</div>
            {section.items.map((item) => (
              <button
                key={item.id}
                onClick={() => onNav(item.id)}
                className="flex items-center gap-3 w-full relative mb-1"
                style={{
                  padding: "11px 14px",
                  borderRadius: "var(--radius-md)",
                  fontWeight: 500,
                  transition: "all 0.15s ease",
                  background: current === item.id ? "var(--accent-dim)" : "transparent",
                  color: current === item.id ? "var(--accent)" : "var(--text-secondary)",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {current === item.id && <span style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 20, background: "var(--accent)", borderRadius: "0 3px 3px 0" }} />}
                <span className="flex-shrink-0"><item.Icon /></span>
                <span className="flex-1">{item.label}</span>
                {item.id === "fleet" && deviceCount > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: "var(--accent)", color: "#000" }}>{deviceCount}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2.5" style={{ padding: "10px 14px", background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", fontSize: 12 }}>
          <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)", boxShadow: "0 0 8px var(--success)", flexShrink: 0 }} />
          <span style={{ color: "var(--text-secondary)" }}>Connected</span>
        </div>
      </div>
    </aside>
  );
}

function MobileNav({ current, onNav }: { current: Page; onNav: (p: Page) => void }) {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex" style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border-subtle)" }}>
      {NAV_FLAT.map((item) => (
        <button key={item.id} onClick={() => onNav(item.id)} className="flex-1 flex flex-col items-center py-2.5 text-xs transition gap-0.5" style={current === item.id ? { color: "var(--accent)" } : { color: "var(--text-muted)" }}>
          <item.Icon /><span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── Top Bar ───────────────────────────────────────────
function TopBar({ title, onSync, loading }: { title: string; onSync: () => void; loading: boolean }) {
  return (
    <header className="hidden lg:flex items-center justify-between flex-shrink-0" style={{ height: 64, background: "var(--glass-bg)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--border-subtle)", padding: "0 28px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>{title}</h1>
      <div className="flex items-center gap-3">
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{fmtToday()}</span>
        <button onClick={onSync} className="flex items-center gap-1.5 transition-all" style={{ padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer" }} disabled={loading}>
          <IconRefresh /> Sync
        </button>
      </div>
    </header>
  );
}

// ─── Metric Card ───────────────────────────────────────
function MetricCard({ icon, value, label, color }: { icon: React.ReactNode; value: number | string; label: string; color: string }) {
  const bgMap: Record<string, string> = {
    green: "var(--success-dim)", blue: "var(--info-dim)", yellow: "var(--warning-dim)", purple: "var(--purple-dim)",
  };
  return (
    <div style={{ background: "linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 22, position: "relative", overflow: "hidden", transition: "all 0.2s ease" }}
      className="hover:-translate-y-0.5"
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-subtle)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ position: "absolute", top: 0, right: 0, width: 100, height: 100, background: "radial-gradient(circle, var(--accent-dim) 0%, transparent 70%)", opacity: 0.5 }} />
      <div className="flex items-center justify-center" style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: bgMap[color] || bgMap.green, marginBottom: 14, color: "var(--accent)" }}>
        {icon}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, lineHeight: 1, marginBottom: 6 }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>{label}</div>
    </div>
  );
}

// ─── Glass Card ────────────────────────────────────────
function GlassCard({ title, icon, actions, children, noPadding }: { title?: string; icon?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; noPadding?: boolean }) {
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", overflow: "hidden", transition: "all 0.2s ease" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border-default)"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-subtle)"}
    >
      {title && (
        <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--border-subtle)", background: "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)" }}>
          <div className="flex items-center gap-2.5" style={{ fontSize: 15, fontWeight: 600 }}>
            {icon}{title}
          </div>
          {actions}
        </div>
      )}
      <div style={noPadding ? {} : { padding: 22 }}>{children}</div>
    </div>
  );
}

// ─── Badge ─────────────────────────────────────────────
function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  const map: Record<string, { bg: string; c: string }> = {
    success: { bg: "var(--success-dim)", c: "var(--success)" },
    info: { bg: "var(--info-dim)", c: "var(--info)" },
    warning: { bg: "var(--warning-dim)", c: "var(--warning)" },
    error: { bg: "var(--error-dim)", c: "var(--error)" },
    purple: { bg: "var(--purple-dim)", c: "var(--purple)" },
    orange: { bg: "var(--orange-dim)", c: "var(--orange)" },
  };
  const s = map[color] || map.success;
  return <span className="inline-flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 20, background: s.bg, color: s.c }}>{children}</span>;
}

// ─── Dashboard Page ────────────────────────────────────
function DashboardPage({ sessions, devices }: { sessions: Session[]; devices: Device[] }) {
  const activeSessions = sessions.filter(s => s.status === "running" || s.status === "pending").length;
  const completedSessions = sessions.filter(s => s.status === "completed").length;
  const totalReels = sessions.reduce((s, r) => s + (r.reels_viewed || 0), 0);
  const successRate = sessions.length > 0 ? Math.round((completedSessions / sessions.length) * 100) + "%" : "—";

  return (
    <div>
      <div className="hidden lg:block" style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6 }}>Overview</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Your phone farm at a glance</p>
      </div>
      <div className="lg:hidden flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold">Dashboard</h1>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-7">
        <MetricCard icon={<IconPhone />} value={devices.length} label="Devices Online" color="green" />
        <MetricCard icon={<IconUpload />} value={totalReels} label="Reels Viewed" color="blue" />
        <MetricCard icon={<IconHourglass />} value={activeSessions} label="Active Sessions" color="yellow" />
        <MetricCard icon={<IconCheckCircle />} value={successRate} label="Success Rate" color="purple" />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <GlassCard title="Quick Actions" icon={<IconZap />}>
          <div className="flex flex-col gap-3">
            <button className="flex items-center justify-center gap-2 w-full font-bold py-2.5 rounded-[var(--radius-md)] text-sm transition-all hover:brightness-110" style={{ background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)", border: "1px solid var(--accent)", color: "#000" }}>
              <IconFlame /> Start Warmup
            </button>
            <button className="flex items-center justify-center gap-2 w-full font-semibold py-2.5 rounded-[var(--radius-md)] text-sm transition-all" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", color: "var(--text-primary)", cursor: "pointer" }}>
              <IconSend /> View Fleet
            </button>
          </div>
        </GlassCard>

        {/* Recent Activity */}
        <GlassCard title="Recent Activity" icon={<IconActivity />} actions={<button style={{ padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer" }}><IconRefresh /></button>}>
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center py-8" style={{ color: "var(--text-muted)" }}>
              <IconActivity />
              <p className="mt-2 text-sm">No recent activity</p>
            </div>
          ) : (
            <div className="space-y-0">
              {sessions.slice(0, 8).map((s) => {
                const colors = ["var(--info)", "var(--pink)", "var(--warning)", "var(--accent)"];
                const c = colors[s.id % colors.length];
                return (
                  <div key={s.id} className="flex items-center py-3 gap-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <div className="flex items-center justify-center flex-shrink-0" style={{ width: 28, height: 28, borderRadius: "50%", background: c.startsWith("var(--info)") ? "var(--info-dim)" : c.startsWith("var(--pink)") ? "rgba(244,114,182,0.12)" : c.startsWith("var(--warning)") ? "var(--warning-dim)" : "var(--success-dim)", color: c, fontSize: 11, fontWeight: 700 }}>
                      {(s.account || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 text-[13px]">
                      <strong style={{ color: "var(--accent)" }}>@{s.account || "?"}</strong> warmup — {s.reels_viewed || 0} reels, {s.likes || 0} likes
                    </div>
                    <div className="text-[11px] flex-shrink-0" style={{ color: "var(--text-muted)" }}>{fmtDate(s.timestamp)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Fleet Summary */}
        <GlassCard title="Fleet Status" icon={<IconPhone />} actions={<Badge color="success">{devices.length} online</Badge>}>
          {devices.length === 0 ? (
            <div className="flex flex-col items-center py-8" style={{ color: "var(--text-muted)" }}>
              <IconPhone />
              <p className="mt-2 text-sm">No devices connected</p>
            </div>
          ) : (
            <div className="space-y-2">
              {devices.map((d) => (
                <div key={d.id} className="flex items-center gap-3 p-2.5 rounded-[var(--radius-md)]" style={{ background: "var(--bg-elevated)" }}>
                  <span className="pulse-dot flex-shrink-0" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />
                  <span className="flex-1 text-sm font-medium truncate">{d.device_name || d.device_id.slice(0, 16)}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Android {d.android_version || "?"}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

// ─── Single Device Card (with inline warmup) ─────────────────
function DeviceCard({ d, token, igAccounts, sessions, activeRun, onLaunched }: { d: Device; token: string; igAccounts: IGAccount[]; sessions: Session[]; activeRun?: any; onLaunched: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [account, setAccount] = useState("");
  const [duration, setDuration] = useState("2");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(Date.now());

  // Tick every second for timer
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (igAccounts.length > 0 && !account) setAccount(igAccounts[0].username);
  }, [igAccounts]);

  const stats = (() => {
    const accNames = igAccounts.map(a => a.username);
    const ds = sessions.filter(s => accNames.includes(s.account));
    return { total: ds.length, reels: ds.reduce((s, x) => s + (x.reels_viewed || 0), 0), likes: ds.reduce((s, x) => s + (x.likes || 0), 0), mins: Math.round(ds.reduce((s, x) => s + (x.elapsed_sec || 0), 0) / 60) };
  })();

  const last = sessions.filter(s => igAccounts.some(a => a.username === s.account)).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] || null;
  const isActive = (() => {
    if (!activeRun || (activeRun.status !== 'pending' && activeRun.status !== 'running')) return false;
    const started = new Date(activeRun.created_at).getTime();
    const params = JSON.parse(activeRun.params || '{}');
    const durMin = params.duration_minutes || 2;
    const totalMs = durMin * 60000;
    // If more than 2x the duration has passed, consider it stale
    if (Date.now() - started > totalMs * 2) return false;
    return true;
  })();

  // Timer calculation from active task_run
  const timerInfo = (() => {
    if (!isActive || !activeRun) return null;
    const started = new Date(activeRun.created_at).getTime();
    const params = JSON.parse(activeRun.params || '{}');
    const durMin = params.duration_minutes || 2;
    const totalMs = durMin * 60000;
    const elapsedMs = now - started;
    const pct = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
    const elSec = Math.floor(elapsedMs / 1000);
    return { pct, elapsed: elSec >= 60 ? `${Math.floor(elSec/60)}m ${elSec%60}s` : `${elSec}s`, durMin };
  })();

  const launch = async () => {
    if (!account) return;
    setSending(true); setMsg("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const res = await fetch(`${API}/api/tasks/run`, { method: "POST", headers, body: JSON.stringify({ task_type: "warmup_ig", device_id: d.id, params: { account, duration_minutes: parseInt(duration) } }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setMsg(`Warmup encolado!`);
      onLaunched();
      setTimeout(() => { setExpanded(false); setMsg(""); }, 2000);
    } catch (e) { setMsg(`Error: ${e instanceof Error ? e.message : "desconocido"}`); } finally { setSending(false); }
  };

  return (
    <div style={{ position: "relative", borderRadius: "var(--radius-lg)", padding: isActive ? 2 : 0, overflow: "hidden" }}>
      {isActive && (
        <div style={{ position: "absolute", top: "50%", left: "50%", width: "200%", height: "200%", transform: "translate(-50%, -50%)", background: "conic-gradient(from 0deg, transparent 0%, #22c55e 10%, #3b82f6 20%, #a855f7 30%, #22c55e 40%, transparent 50%)", animation: "borderSpin 3s linear infinite", zIndex: 0 }} />
      )}
      <div className="device-card-inner" style={{ background: "linear-gradient(145deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)", border: isActive ? "none" : "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 22, position: "relative", overflow: "hidden", zIndex: 1, transition: "all 0.25s ease", boxShadow: isActive ? "0 0 12px rgba(34,197,94,0.2)" : "none" }}
        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "var(--shadow-lg)"; } }}
        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderColor = "var(--border-subtle)"; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; } }}
      >
        {/* Green glow */}
        <div style={{ position: "absolute", top: "-50%", right: "-50%", width: "100%", height: "100%", background: "radial-gradient(circle, rgba(34,197,94,0.06) 0%, transparent 60%)", pointerEvents: "none" }} />

        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center" style={{ width: 48, height: 48, borderRadius: "var(--radius-md)", background: "var(--bg-active)" }}><IconPhone /></div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{d.device_name || "Unknown Device"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Android {d.android_version || "?"} · {d.device_id.slice(0, 12)}</div>
            </div>
          </div>
          <span className="px-3 py-1.5 rounded-full font-bold uppercase tracking-wide" style={{ fontSize: 11, letterSpacing: 0.3, background: "var(--success-dim)", color: "var(--success)", boxShadow: "0 0 12px var(--success-dim)" }}>
            <span className="pulse-dot inline-block mr-1" style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} /> Online
          </span>
        </div>

        {/* Activity badge + progress bar */}
        <div style={{ marginBottom: 14 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: isActive && timerInfo ? 8 : 0 }}>
            {isActive ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 14, fontWeight: 600, background: "rgba(249,115,22,0.15)", color: "#f97316", border: "1px solid rgba(249,115,22,0.3)", animation: "activityPulse 2s ease-in-out infinite" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", animation: "dotPulse 1.5s ease-in-out infinite" }} /> Warmup en curso
              </div>
          ) : last ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 13, fontWeight: 600, background: "rgba(34,197,94,0.1)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.2)" }}>
              <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} /> Listo
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 13, fontWeight: 600, background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", border: "1px solid var(--border-subtle)" }}>Sin actividad</div>
            )}
          </div>
          {/* Progress bar for active warmup */}
          {isActive && timerInfo && (
            <div>
              <div style={{ width: "100%", height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${timerInfo.pct}%`, height: "100%", borderRadius: 2, background: "#f97316", transition: "width 1s linear" }} />
              </div>
              <div className="flex justify-between" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                <span>{timerInfo.elapsed}</span>
                <span>{timerInfo.durMin}min</span>
              </div>
            </div>
          )}
        </div>
        {/* Stats 2x2 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div style={{ background: "var(--bg-base)", padding: 14, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03rem", marginBottom: 6 }}>Sesiones</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--accent)" }}>{stats.total}</div>
          </div>
          <div style={{ background: "var(--bg-base)", padding: 14, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03rem", marginBottom: 6 }}>Reels</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#60a5fa" }}>{stats.reels}</div>
          </div>
          <div style={{ background: "var(--bg-base)", padding: 14, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03rem", marginBottom: 6 }}>Likes</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f472b6" }}>{stats.likes}</div>
          </div>
          <div style={{ background: "var(--bg-base)", padding: 14, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03rem", marginBottom: 6 }}>Minutos</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fbbf24" }}>{stats.mins}</div>
          </div>
        </div>

        {/* IG Accounts */}
        {igAccounts.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05rem", marginBottom: 8 }}>Cuentas IG</div>
            <div className="flex flex-wrap gap-1.5">
              {igAccounts.map(a => (
                <span key={a.id} className="px-2.5 py-1 rounded-md text-xs font-medium" style={{ background: "rgba(34,197,94,0.1)", color: "var(--accent)", border: "1px solid rgba(34,197,94,0.2)" }}>@{a.username}</span>
              ))}
            </div>
          </div>
        )}

        {/* Launch Warmup button */}
        <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-bold text-sm transition-all" style={{ background: expanded ? "var(--bg-hover)" : "linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)", border: `1px solid ${expanded ? "var(--border-default)" : "var(--accent)"}`, color: expanded ? "var(--text-primary)" : "#000", cursor: "pointer" }}>
          <IconFlame /> {isActive ? "En curso..." : expanded ? "Cancelar" : "Launch Warmup"}
        </button>

        {/* Expanded warmup panel */}
        {expanded && !isActive && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
            {/* Account selector */}
            <div className="mb-3">
              <label className="block mb-1.5 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Cuenta</label>
              {igAccounts.length > 0 ? (
                <select value={account} onChange={e => setAccount(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }}>
                  {igAccounts.map(a => <option key={a.id} value={a.username}>@{a.username}</option>)}
                </select>
              ) : (
                <input type="text" placeholder="@username" value={account} onChange={e => setAccount(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
              )}
            </div>
            {/* Duration chips */}
            <div className="mb-3">
              <label className="block mb-1.5 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Duración</label>
              <div className="flex gap-2">{["2", "5", "10", "20"].map(dm => (
                <button key={dm} onClick={() => setDuration(dm)} className="flex-1 py-2 rounded-lg text-sm font-medium" style={duration === dm ? { background: "var(--accent)", color: "#000", border: "1px solid var(--accent)" } : { background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)", cursor: "pointer" }}>{dm}m</button>
              ))}</div>
            </div>
            {/* Launch */}
            <button onClick={launch} disabled={sending || !account} className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-bold text-sm transition-all hover:brightness-110 disabled:opacity-40" style={{ background: "var(--accent)", border: "1px solid var(--accent)", color: "#000", cursor: "pointer" }}>
              {sending ? "Lanzando..." : "Confirmar"}
            </button>
            {msg && <p className="text-sm text-center mt-2" style={{ color: msg.startsWith("Error") ? "var(--error)" : "var(--accent)" }}>{msg}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fleet Page (uses DeviceCard) ─────────────────────────
function FleetPage({ devices, loading, onRefresh, token }: { devices: Device[]; loading: boolean; onRefresh: () => void; token: string }) {
  const [igAccountsMap, setIgAccountsMap] = useState<Record<number, IGAccount[]>>({});
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeRuns, setActiveRuns] = useState<Record<number, any>>({});
  const [showQR, setShowQR] = useState(false);

  const loadExtra = useCallback(() => {
    if (!token) return;
    devices.forEach(d => {
      apiGet(`/api/ig-accounts?device_id=${d.id}`, token).then(data => {
        setIgAccountsMap(prev => ({ ...prev, [d.id]: data.accounts || [] }));
      }).catch(() => {});
    });
    apiGet("/api/warmup-sessions", token).then(data => {
      setSessions(data.sessions || data || []);
    }).catch(() => {});
    // Fetch active task runs
    apiGet("/api/tasks/runs", token).then(data => {
      const active: Record<number, any> = {};
      (data.runs || []).forEach((r: any) => {
        if (r.status === "pending" || r.status === "running") {
          active[r.device_id] = r;
        }
      });
      setActiveRuns(active);
    }).catch(() => {});
  }, [devices, token]);

  useEffect(() => { loadExtra(); }, [loadExtra]);

  return (
    <div>
      {/* QR Modal */}
      {showQR && (
        <div onClick={() => setShowQR(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "pointer" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 32, maxWidth: 360, width: "90%", textAlign: "center", cursor: "default" }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Add New Device</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>Scan with your Android phone to download SouthFarm</p>
            <img src="/qr-download.png" alt="QR Code" width={200} height={200} style={{ margin: "0 auto 16px", borderRadius: 12, display: "block" }} />
            <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Or visit: <span style={{ color: "var(--accent)" }}>southfarm.tech/southfarm.apk</span></p>
            <button onClick={() => setShowQR(false)} style={{ marginTop: 16, padding: "8px 20px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>Close</button>
          </div>
        </div>
      )}
      <div className="hidden lg:block" style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6 }}>Device Fleet</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Monitor, control and launch warmups on your devices</p>
      </div>
      <div className="lg:hidden flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold">Fleet</h1>
        <button onClick={onRefresh} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ border: "1px solid var(--border-default)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer" }}>
          {loading ? "..." : <><IconRefresh /> Refresh</>}
        </button>
      </div>

      <div style={{ border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center gap-2.5">
            <span style={{ color: "var(--accent)" }}><IconPhone /></span>
            <h3 className="font-semibold" style={{ fontSize: 15 }}>Connected Devices</h3>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: "var(--success-dim)", color: "var(--success)" }}>{devices.length} online</span>
            <button onClick={() => setShowQR(true)} className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: "var(--radius-md)", border: "1px solid var(--accent)", background: "var(--success-dim)", color: "var(--accent)", fontSize: 18, fontWeight: 700, cursor: "pointer" }}>+</button>
            <button onClick={onRefresh} className="hidden lg:flex items-center gap-1.5" style={{ padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer" }}>
              <IconRefresh /> Refresh
            </button>
          </div>
        </div>

        <div className="p-5">
          {devices.length === 0 ? (
            <div className="flex flex-col items-center py-16" style={{ color: "var(--text-muted)" }}>
              <div style={{ marginBottom: 16, opacity: 0.5 }}><IconPhone /></div>
              <p className="font-medium mb-1" style={{ color: "var(--text-secondary)" }}>No devices connected</p>
              <p className="text-sm">Install SouthFarm on an Android phone to get started</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
              {devices.map(d => (
                <DeviceCard key={d.id} d={d} token={token} igAccounts={igAccountsMap[d.id] || []} sessions={sessions} activeRun={activeRuns[d.id]} onLaunched={loadExtra} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Warmup Page ───────────────────────────────────────
// ─── History Page ──────────────────────────────────────
function HistoryPage({ sessions }: { sessions: Session[] }) {
  const tR = sessions.reduce((s, r) => s + (r.reels_viewed || 0), 0);
  const tL = sessions.reduce((s, r) => s + (r.likes || 0), 0);
  const tS = sessions.reduce((s, r) => s + (r.saves || 0), 0);
  const tM = sessions.reduce((s, r) => s + Math.floor((r.elapsed_sec || 0) / 60), 0);

  return (
    <div>
      <div className="hidden lg:block" style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6 }}>Session History</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>All warmup sessions and their metrics</p>
      </div>
      <div className="lg:hidden flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold">History</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-7">
        <MetricCard icon={<IconActivity />} value={sessions.length} label="Sessions" color="green" />
        <MetricCard icon={<IconActivity />} value={tR} label="Reels Viewed" color="blue" />
        <MetricCard icon={<IconActivity />} value={tL} label="Likes" color="yellow" />
        <MetricCard icon={<IconActivity />} value={tM} label="Minutes" color="purple" />
      </div>

      <GlassCard title="Sessions" icon={<IconClock />}>
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center py-12" style={{ color: "var(--text-muted)" }}>
            <IconClock />
            <p className="mt-2 text-sm">No sessions yet</p>
          </div>
        ) : (
          <div className="space-y-0">
            {sessions.map((s) => {
              const colors = ["var(--info)", "var(--pink)", "var(--warning)"];
              const c = colors[s.id % colors.length];
              const bg = c === "var(--info)" ? "var(--info-dim)" : c === "var(--pink)" ? "rgba(244,114,182,0.12)" : "var(--warning-dim)";
              return (
                <div key={s.id} className="flex items-center py-3 gap-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <div className="flex items-center justify-center flex-shrink-0" style={{ width: 28, height: 28, borderRadius: "50%", background: bg, color: c }}>
                    {s.status === "completed" ? <IconCheck /> : <IconStop />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold" style={{ color: "var(--accent)" }}>@{s.account || "?"}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>{fmtDate(s.timestamp)}</div>
                  </div>
                  <div className="hidden sm:flex gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--info)" }}>{s.reels_viewed || 0} reels</span>
                    <span style={{ color: "var(--pink)" }}>{s.likes || 0} likes</span>
                    <span style={{ color: "var(--warning)" }}>{s.saves || 0} saves</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

// ─── Settings Page ─────────────────────────────────────
function SettingsPage({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  return (
    <div>
      <div className="hidden lg:block" style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6 }}>Settings</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Manage your account and preferences</p>
      </div>
      <div className="lg:hidden flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      <GlassCard>
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", fontSize: 24, fontWeight: 700 }}>
            {userName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-lg">{userName}</p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Plan: Free</p>
          </div>
        </div>
        <button onClick={onLogout} className="w-full py-3 rounded-[var(--radius-md)] font-medium transition-all hover:brightness-110" style={{ background: "var(--error-dim)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", cursor: "pointer" }}>
          Cerrar sesion
        </button>
      </GlassCard>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────
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

  const pageTitles: Record<Page, string> = { dashboard: "Dashboard", fleet: "Fleet", history: "History", settings: "Settings" };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar current={page} onNav={setPage} deviceCount={devices.length} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar title={pageTitles[page]} onSync={() => loadData(token!)} loading={loading} />
        <main className="flex-1 overflow-y-auto p-5 lg:p-7 pb-24 lg:pb-7" style={{ scrollBehavior: "smooth" }}>
          {page === "dashboard" && <DashboardPage sessions={sessions} devices={devices} />}
          {page === "fleet" && <FleetPage devices={devices} loading={loading} onRefresh={() => loadData(token!)} token={token!} />}
          
          {page === "history" && <HistoryPage sessions={sessions} />}
          {page === "settings" && <SettingsPage userName={userName} onLogout={logout} />}
        </main>
      </div>
      <MobileNav current={page} onNav={setPage} />
    </div>
  );
}
