"use client";

/**
 * v6 — Modal "Crear cluster": agrupa cuentas scaneadas del workspace
 * (GET /api/social-accounts + GET /api/devices) en un cluster nuevo.
 *
 * La API ya soporta POST /api/clusters; este modal es solo frontend:
 * lista de cuentas agrupada por plataforma, filtro por texto, selección
 * múltiple por toggle, validación de nombre (duplicados + obligatorio)
 * y estados loading/error/empty/busy del resto del planner.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { plannerApi, PlannerApiError } from "./api";
import { PLATFORM_META } from "./types";
import type { ClusterListItem, PlannerPlatform, WorkspaceAccount, WorkspaceDevice } from "./types";

interface ClusterCreateModalProps {
  token: string;
  open: boolean;
  onClose: () => void;
  onCreated: (cluster: ClusterListItem) => void;
  /** accountId → nombre del cluster que ya la tiene agrupada. */
  occupied: Map<number, string>;
  /** Nombres existentes (lowercase) para bloquear duplicados. */
  existingNames: Set<string>;
}

/** Orden de secciones del picker (solo se renderizan las no vacías). */
const PLATFORM_ORDER: PlannerPlatform[] = ["instagram", "tiktok", "youtube"];

export default function ClusterCreateModal({ token, open, onClose, onCreated, occupied, existingNames }: ClusterCreateModalProps) {
  const [accounts, setAccounts] = useState<WorkspaceAccount[]>([]);
  const [devices, setDevices] = useState<WorkspaceDevice[]>([]);
  /** null = sin cargar todavía (primer open); "" = cargado OK. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Arranca en true: el modal no renderiza nada cerrado, y el primer frame
   *  de cada open sin caché muestra "Cargando cuentas…" sin parpadear. */
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);
  const cacheRef = useRef<{ accounts: WorkspaceAccount[]; devices: WorkspaceDevice[] } | null>(null);

  /** Device de la cuenta: null = no está en la lista de devices del workspace. */
  const deviceOf = useCallback((account: WorkspaceAccount) => (
    devices.find((d) => d.id === account.device_id) ?? null
  ), [devices]);

  const deviceLabel = useCallback((account: WorkspaceAccount) => {
    const device = deviceOf(account);
    return device ? device.alias || device.device_name || `celular #${device.id}` : `celular #${account.device_id}`;
  }, [deviceOf]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Ambas en paralelo; si una falla, todo el picker queda en error con retry.
      const [accountsRes, devicesRes] = await Promise.all([
        plannerApi.getWorkspaceAccounts(token),
        plannerApi.getDevices(token),
      ]);
      // /api/social-accounts manda platform como string: lo normalizamos a
      // PlannerPlatform (mismo fallback "instagram" que el resto del planner).
      const normalized = (accountsRes.accounts ?? []).map((account) => ({
        ...account,
        platform: (["instagram", "tiktok", "youtube"] as PlannerPlatform[]).includes(account.platform as PlannerPlatform)
          ? (account.platform as PlannerPlatform)
          : ("instagram" as PlannerPlatform),
      }));
      cacheRef.current = { accounts: normalized, devices: devicesRes.devices ?? [] };
      setAccounts(normalized);
      setDevices(devicesRes.devices ?? []);
    } catch (cause) {
      // Si el fetch falla no se cachea: el próximo open reintenta.
      cacheRef.current = null;
      setLoadError(PlannerApiError.from(cause).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  /* Cargar cuentas + devices una vez por apertura; el caché en ref hace que
     las reaperturas posteriores sean instantáneas (salvo que haya fallado:
     en ese caso cacheRef queda null y el próximo open reintenta). Cuando hay
     caché, el estado ya quedó seteado en el open anterior. */
  useEffect(() => {
    if (open && !cacheRef.current) void load();
  }, [open, load]);

  /* Foco en el nombre al abrir (patrón autoFocus del rename del detalle). */
  useEffect(() => {
    if (!open) return;
    const task = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(task);
  }, [open]);

  /* Escape cierra (salvo mientras se está creando). */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const trimmedName = name.trim();
  const nameError = trimmedName === ""
    ? ""
    : existingNames.has(trimmedName.toLowerCase())
      ? "Ya existe un cluster con ese nombre"
      : "";

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = accounts.filter((account) => {
      if (query === "") return true;
      return (
        account.username.toLowerCase().includes(query) ||
        deviceLabel(account).toLowerCase().includes(query)
      );
    });
    const groups = new Map<PlannerPlatform, WorkspaceAccount[]>();
    for (const platform of PLATFORM_ORDER) groups.set(platform, []);
    for (const account of list) groups.get(account.platform)?.push(account);
    return groups;
  }, [accounts, query, deviceLabel]);

  const freeCount = accounts.filter((account) => !occupied.has(account.id)).length;
  /** Cuentas agrupables de verdad: libres Y en un celular activo de la flota
   *  (una cuenta en device revocado no puede ejecutar tareas del planner). */
  const selectableCount = accounts.filter((account) => {
    if (occupied.has(account.id)) return false;
    const device = devices.find((d) => d.id === account.device_id);
    return device ? device.lifecycle_status !== "revoked" : false;
  }).length;
  const filteredEmpty = PLATFORM_ORDER.every((platform) => (filtered.get(platform)?.length ?? 0) === 0);

  const toggle = (accountId: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const canSubmit = !nameError && trimmedName !== "" && selected.size > 0 && !busy && !loading;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError("");
    try {
      const cluster = await plannerApi.createCluster(token, {
        name: trimmedName,
        accountIds: [...selected],
      });
      onCreated(cluster);
    } catch (cause) {
      setSubmitError(PlannerApiError.from(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  /* El estado se resetea en cada apertura: nombre, búsqueda y selección
     vuelven a cero para la próxima sesión de creación. El reset se difiere
     con setTimeout(0) (patrón de este codebase para setState desde effects). */
  useEffect(() => {
    if (open) return;
    const task = window.setTimeout(() => {
      setName("");
      setSearch("");
      setSelected(new Set());
      setSubmitError("");
    }, 0);
    return () => window.clearTimeout(task);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="ap-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Crear cluster"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="ap-modal" style={{ maxWidth: 460 }}>
        <div className="ap-modal-head">
          <div>
            <p className="ap-eyebrow ap-eyebrow-accent">NUEVO CLUSTER</p>
            <h3>Crear cluster</h3>
          </div>
          <button className="ap-icon-btn" title="Cancelar" onClick={close}>×</button>
        </div>

        <div className="ap-modal-body">
          {loadError !== null ? (
            <div className="ap-pick-error">
              <p className="ap-inline-error">{loadError}</p>
              <button className="ap-btn ap-btn-muted ap-btn-sm" onClick={() => void load()} disabled={loading}>
                Reintentar
              </button>
            </div>
          ) : loading ? (
            <div className="ap-pick-loading">Cargando cuentas…</div>
          ) : (
            <>
              <label className="ap-field">
                <span>Nombre del cluster</span>
                <input
                  ref={nameRef}
                  className="ap-input"
                  maxLength={60}
                  placeholder="Ej: Marczell Vibes"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {nameError && <p className="ap-inline-error">{nameError}</p>}
              {submitError && <p className="ap-inline-error">{submitError}</p>}

              <input
                className="ap-input ap-pick-search"
                placeholder="Buscar cuenta o celular…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />

              {freeCount === 0 ? (
                <div className="ap-empty ap-pick-empty">
                  <strong>Todas las cuentas scaneadas ya pertenecen a un cluster.</strong>
                  <span>Desagrupá alguna cuenta desde el detalle del cluster para poder crear uno nuevo.</span>
                </div>
              ) : selectableCount === 0 ? (
                <div className="ap-empty ap-pick-empty">
                  <strong>No quedan cuentas con celular activo para agrupar.</strong>
                  <span>Las cuentas libres pertenecen a celulares revocados de la flota: el planner no puede planificarlas.</span>
                </div>
              ) : filteredEmpty ? (
                <div className="ap-empty ap-pick-empty">
                  <strong>No hay cuentas para ese filtro.</strong>
                  <span>Probá con otro término de búsqueda.</span>
                </div>
              ) : (
                <div className="ap-pick-list" role="listbox" aria-label="Cuentas del workspace" aria-multiselectable="true">
                  {PLATFORM_ORDER.map((platform) => {
                    const group = filtered.get(platform) ?? [];
                    if (group.length === 0) return null;
                    const meta = PLATFORM_META[platform] || PLATFORM_META.instagram;
                    return (
                      <div key={platform}>
                        <p className="ap-pick-group">
                          {meta.label} <span>{group.length}</span>
                        </p>
                        {group.map((account) => {
                          const clusterName = occupied.get(account.id);
                          const isSelected = selected.has(account.id);
                          const isOccupied = clusterName !== undefined;
                          /* Cuenta en celular revocado: bloqueada — el planner
                           * no genera tareas para devices fuera de la flota. */
                          const device = deviceOf(account);
                          const isRevoked = !isOccupied && (device === null || device.lifecycle_status === "revoked");
                          const isBlocked = isOccupied || isRevoked;
                          return (
                            <button
                              key={account.id}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              disabled={isBlocked}
                              className={`ap-pick-row ${isSelected ? "is-selected" : ""} ${isBlocked ? "is-occupied" : ""}`}
                              onClick={() => toggle(account.id)}
                            >
                              <span className={`ap-bubble ap-pick-bubble ap-bubble-${account.platform}`}>
                                {meta.short}
                              </span>
                              <span className="ap-pick-main">
                                <strong>@{account.username}</strong>
                                <span>{deviceLabel(account)}</span>
                              </span>
                              {isOccupied ? (
                                <span className="ap-chip ap-chip-neutral">en {clusterName}</span>
                              ) : isRevoked ? (
                                <span className="ap-chip ap-chip-neutral">celular revocado</span>
                              ) : (
                                <span className="ap-pick-check" aria-hidden="true">✓</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="ap-modal-foot">
          <span className="ap-pick-counter">{selected.size} cuenta{selected.size === 1 ? "" : "s"} seleccionada{selected.size === 1 ? "" : "s"}</span>
          <button className="ap-btn ap-btn-ghost" onClick={close} disabled={busy}>Cancelar</button>
          <button
            className="ap-btn ap-btn-primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {busy ? "Creando…" : "Crear cluster"}
          </button>
        </div>
      </div>
    </div>
  );
}
