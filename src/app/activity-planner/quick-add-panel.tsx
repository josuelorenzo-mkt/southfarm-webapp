"use client";

/**
 * Acciones rápidas — vista día de UN clúster (Fase 2.5).
 * Permite agregar tareas (warmup/scan) para una o varias cuentas del clúster
 * a una hora del día SIN salir de la vista:
 *  - "Colocar en el próximo hueco libre": cada tarea cae en el primer hueco
 *    disponible de su teléfono a partir de la hora elegida (el backend la
 *    desliza solo — reserveSlot 'shift').
 *  - "Forzar horario y correr el resto": la tarea entra exactamente a la hora
 *    elegida y el resto de la agenda del teléfono se recorre en cascada
 *    (POST /tasks/runs/:id/move, todo-o-nada).
 * La publicación requiere un video real: se sugiere el flujo de publicación.
 */
import { useMemo, useState } from "react";
import { plannerApi, PlannerApiError } from "./api";
import { PLATFORM_META, formatBATime } from "./types";
import type { ClusterAccount } from "./types";

interface QuickAddPanelProps {
  token: string;
  clusterName: string;
  /** Cuentas del clúster (week payload). */
  accounts: ClusterAccount[];
  /** Cuentas completas del workspace (device_id incluido). */
  workspaceAccounts: { id: number; device_id: number }[];
  /** Fecha del día visible (YYYY-MM-DD). */
  date: string;
  onChanged: () => void;
}

/** Hora BA actual + 30 min, redondeada a 5', como default del input. */
function defaultTimeBA(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(Date.now() + 30 * 60e3));
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 12);
  const minute = Math.ceil(Number(parts.find((p) => p.type === "minute")?.value || 0) / 5) * 5;
  return `${String(hour % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export default function QuickAddPanel({ token, clusterName, accounts, workspaceAccounts, date, onChanged }: QuickAddPanelProps) {
  const [actionType, setActionType] = useState<"warmup" | "scan">("warmup");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [time, setTime] = useState<string>(() => defaultTimeBA());
  const [durationMin, setDurationMin] = useState(40);
  const [conflictMode, setConflictMode] = useState<"auto" | "exacto">("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<string[]>([]);

  const deviceByAccountId = useMemo(() => {
    const map = new Map<number, number>();
    for (const account of workspaceAccounts) map.set(Number(account.id), Number(account.device_id));
    return map;
  }, [workspaceAccounts]);

  const usableAccounts = useMemo(
    () => accounts.filter((account) => account.deviceActive !== false && deviceByAccountId.has(Number(account.id))),
    [accounts, deviceByAccountId],
  );

  const toggleAccount = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  // OJO: los tipos reales son warmup_ig (no warmup_instagram), warmup_tiktok,
  // warmup_youtube; los scans sí se llaman scan_<plataforma>.
  const taskTypeFor = (platform: string): string => {
    if (actionType === "scan") return `scan_${platform}`;
    if (platform === "tiktok") return "warmup_tiktok";
    if (platform === "youtube") return "warmup_youtube";
    return "warmup_ig";
  };

  const submit = async () => {
    setError("");
    setSummary([]);
    if (!selectedIds.length) { setError("Elegí al menos una cuenta."); return; }
    if (!/^\d{2}:\d{2}$/.test(time)) { setError("Horario inválido."); return; }
    const targetIso = new Date(`${date}T${time}:00-03:00`).toISOString();
    setBusy(true);
    const lines: string[] = [];
    const failures: string[] = [];
    try {
      for (const account of usableAccounts.filter((a) => selectedIds.includes(a.id))) {
        const deviceId = deviceByAccountId.get(Number(account.id));
        if (!deviceId) { failures.push(`${account.username}: sin teléfono asignado`); continue; }
        try {
          const created = await plannerApi.createTask(token, {
            task_type: taskTypeFor(account.platform),
            device_id: deviceId,
            scheduled_for: targetIso,
            duration_minutes: actionType === "scan" ? 10 : durationMin,
            social_account_id: Number(account.id),
            params: { account: account.username, platform: account.platform },
          });
          let effective = created?.scheduled_for_effective || targetIso;
          if (conflictMode === "exacto") {
            // Forzar la hora exacta: el resto de la agenda del teléfono se
            // recorre en cascada (el backend recalcula y aplica todo-o-nada).
            const moved = await plannerApi.applyCascadeMove(token, Number(created?.task_run?.id), targetIso);
            if (moved.ok) effective = targetIso;
          }
          lines.push(`${account.username} → ${formatBATime(effective)}`);
        } catch (cause) {
          const apiError = PlannerApiError.from(cause);
          failures.push(`${account.username}: ${apiError.message}`);
        }
      }
      setSummary(lines);
      if (failures.length) setError(failures.join(" · "));
      if (lines.length) onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ap-card">
      <div className="ap-card-heading" style={{ marginBottom: 10 }}>
        <div>
          <p className="ap-eyebrow ap-eyebrow-accent">ACCIONES RÁPIDAS</p>
          <h3>Agregar tarea al día</h3>
          <p className="ap-card-subtitle">{clusterName} · para {date}</p>
        </div>
      </div>

      <div className="ap-quickadd">
        <div className="ap-qa-row">
          <span className="ap-qa-label">Acción</span>
          <div className="ap-qa-seg" role="group" aria-label="Tipo de acción">
            <button className={actionType === "warmup" ? "is-on" : ""} onClick={() => setActionType("warmup")}>Warmup</button>
            <button className={actionType === "scan" ? "is-on" : ""} onClick={() => setActionType("scan")}>Scan</button>
            <button disabled title="La publicación necesita un video: usá 'Crear publicación' o la sección Rutinas">Publicación</button>
          </div>
          {actionType === "warmup" && (
            <div className="ap-qa-slider">
              <input
                type="range"
                min={5}
                max={60}
                step={5}
                value={durationMin}
                aria-label="Duración del warmup en minutos"
                onChange={(event) => setDurationMin(Number(event.target.value))}
              />
              <span className="ap-qa-slider-value">{durationMin} min</span>
            </div>
          )}
          {actionType === "scan" && <span className="ap-qa-note">10 min</span>}
        </div>

        <div className="ap-qa-row">
          <span className="ap-qa-label">Cuentas (multiples)</span>
          {usableAccounts.length ? usableAccounts.map((account) => (
            <button
              key={account.id}
              className={`ap-qa-chip ${selectedIds.includes(account.id) ? "is-on" : ""}`}
              onClick={() => toggleAccount(account.id)}
            >
              @{account.username} <small>{PLATFORM_META[account.platform]?.short || account.platform}</small>
            </button>
          )) : <span className="ap-qa-note">Este clúster no tiene cuentas con teléfono activo.</span>}
        </div>

        <div className="ap-qa-row">
          <span className="ap-qa-label">Horario de inicio (Buenos Aires)</span>
          <input
            type="time"
            className="ap-qa-time"
            value={time}
            step={300}
            aria-label="Horario de inicio de la tarea"
            onChange={(event) => setTime(event.target.value || time)}
          />
        </div>

        <div className="ap-qa-row">
          <span className="ap-qa-label">Si el horario está ocupado</span>
          <div className="ap-qa-radio">
            <label>
              <input type="radio" name="qa-conflict" checked={conflictMode === "auto"} onChange={() => setConflictMode("auto")} />
              <span><strong>Colocar en el próximo hueco libre</strong> — cada tarea entra lo antes posible desde la hora elegida, sin mover a nadie.</span>
            </label>
            <label>
              <input type="radio" name="qa-conflict" checked={conflictMode === "exacto"} onChange={() => setConflictMode("exacto")} />
              <span><strong>Forzar horario y correr el resto</strong> — la tarea entra a esa hora y las actividades siguientes del teléfono se recorren en cascada.</span>
            </label>
          </div>
        </div>

        {error && <div className="cc-alert cc-alert-error"><span>{error}<button onClick={() => setError("")}>×</button></span></div>}
        {summary.length > 0 && (
          <div className="ap-qa-summary" role="status">
            {summary.map((line) => <span key={line}>✓ {line}</span>)}
          </div>
        )}

        <button
          className="ap-btn ap-btn-primary"
          disabled={busy || !selectedIds.length || !usableAccounts.length}
          onClick={() => void submit()}
        >
          {busy ? "Agregando…" : `Agregar ${selectedIds.length > 1 ? `${selectedIds.length} tareas` : "tarea"}`}
        </button>
        <p className="ap-qa-note">
          Publicación requiere un video real: se crea desde <strong>Crear publicación</strong> o desde
          la sección <strong>Rutinas</strong> de este clúster.
        </p>
      </div>
    </section>
  );
}
