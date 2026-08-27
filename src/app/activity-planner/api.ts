/**
 * Activity Planner — cliente tipado del contrato de API v1.
 * Mismo patrón de fetch/token/refresh que scheduler-panel.tsx (authRequest de auth-client).
 */
import { AuthApiError, authRequest } from "../auth-client";
import type {
  ClusterDetailResponse,
  ClusterListItem,
  ClustersResponse,
  CreateClusterBody,
  DayResponse,
  GenerateWeekResponse,
  PutRoutineBody,
  PutRoutineResponse,
  PublishToClusterBody,
  PublishToClusterFileBody,
  PublishToClusterResponse,
  RoutinesResponse,
  ScanSuggestionsResponse,
  WeekResponse,
  WorkspaceAccount,
  WorkspaceDevice,
} from "./types";

export const PLANNER_API = (process.env.NEXT_PUBLIC_API_URL || "https://api.southfarm.tech").replace(/\/$/, "");

/** Movimiento individual dentro de un plan de cascada (Fase 2.5). */
export interface CascadeMoveDto {
  task_id: number;
  task_type?: string;
  from: string | null;
  to: string;
}

/** Respuesta del preview: plan completo o motivo por el que no hay arreglo. */
export interface CascadePreviewResponse {
  ok: boolean;
  moves?: CascadeMoveDto[];
  reason?: string;
  detail?: string;
  requested_scheduled_for?: string;
}

export interface CascadeApplyResponse {
  ok: boolean;
  applied?: CascadeMoveDto[];
}

function plannerRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  return authRequest<T>(PLANNER_API, path, token, init);
}

export class PlannerApiError extends Error {
  status: number;
  error_code?: string;
  /** Cuerpo completo del error (ej. 409 de agenda con conflicts + next_free_slot). */
  data?: Record<string, unknown>;

  constructor(message: string, status: number, error_code?: string, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    if (error_code !== undefined) this.error_code = error_code;
    if (data !== undefined) this.data = data;
  }

  static from(cause: unknown): PlannerApiError {
    if (cause instanceof PlannerApiError) return cause;
    if (cause instanceof AuthApiError) {
      return new PlannerApiError(cause.message, cause.status, cause.error_code, cause.data);
    }
    return new PlannerApiError(cause instanceof Error ? cause.message : "No se pudo completar la solicitud", 0);
  }

  /** True si el error es un choque de agenda del sistema de reservas. */
  get slotConflict(): boolean {
    return this.status === 409 && Array.isArray(this.data?.conflicts);
  }

  /** Próximo hueco libre sugerido por la API (ISO) en un conflicto de agenda. */
  get nextFreeSlot(): string | null {
    const value = this.data?.next_free_slot;
    return typeof value === "string" && value ? value : null;
  }
}

export const plannerApi = {
  /** GET /api/planner/week?start=YYYY-MM-DD */
  getWeek(token: string, start?: string): Promise<WeekResponse> {
    const query = start ? `?start=${encodeURIComponent(start)}` : "";
    return plannerRequest<WeekResponse>(`/api/planner/week${query}`, token);
  },

  /** GET /api/planner/day?date=YYYY-MM-DD */
  getDay(token: string, date?: string): Promise<DayResponse> {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    return plannerRequest<DayResponse>(`/api/planner/day${query}`, token);
  },

  /** GET /api/clusters */
  getClusters(token: string): Promise<ClustersResponse> {
    return plannerRequest<ClustersResponse>("/api/clusters", token);
  },

  /** POST /api/clusters */
  createCluster(token: string, body: CreateClusterBody): Promise<ClusterListItem> {
    return plannerRequest<ClusterListItem>("/api/clusters", token, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** POST /api/clusters/:id/confirm */
  confirmCluster(token: string, id: number): Promise<ClusterListItem> {
    return plannerRequest<ClusterListItem>(`/api/clusters/${id}/confirm`, token, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  /** DELETE /api/clusters/:id?mode=reject */
  rejectCluster(token: string, id: number): Promise<Record<string, never>> {
    return plannerRequest<Record<string, never>>(`/api/clusters/${id}?mode=reject`, token, {
      method: "DELETE",
    });
  },

  /** DELETE /api/clusters/:id?mode=delete */
  deleteCluster(token: string, id: number): Promise<Record<string, never>> {
    return plannerRequest<Record<string, never>>(`/api/clusters/${id}?mode=delete`, token, {
      method: "DELETE",
    });
  },

  /** PATCH /api/clusters/:id (rename) */
  renameCluster(token: string, id: number, name: string): Promise<ClusterListItem> {
    return plannerRequest<ClusterListItem>(`/api/clusters/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },

  /** POST /api/clusters/:id/members */
  addMembers(token: string, id: number, accountIds: number[]): Promise<ClusterListItem> {
    return plannerRequest<ClusterListItem>(`/api/clusters/${id}/members`, token, {
      method: "POST",
      body: JSON.stringify({ accountIds }),
    });
  },

  /** DELETE /api/clusters/:id/members/:accountId */
  removeMember(token: string, id: number, accountId: number): Promise<Record<string, never>> {
    return plannerRequest<Record<string, never>>(`/api/clusters/${id}/members/${accountId}`, token, {
      method: "DELETE",
    });
  },

  /** POST /api/clusters/suggestions/scan */
  scanSuggestions(token: string): Promise<ScanSuggestionsResponse> {
    return plannerRequest<ScanSuggestionsResponse>("/api/clusters/suggestions/scan", token, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  /** GET /api/clusters/:id */
  getClusterDetail(token: string, id: number): Promise<ClusterDetailResponse> {
    return plannerRequest<ClusterDetailResponse>(`/api/clusters/${id}`, token);
  },

  /** GET /api/clusters/:id/routines */
  getRoutines(token: string, clusterId: number): Promise<RoutinesResponse> {
    return plannerRequest<RoutinesResponse>(`/api/clusters/${clusterId}/routines`, token);
  },

  /** PUT /api/clusters/:id/routines/:routineId */
  putRoutine(token: string, clusterId: number, routineId: number, body: PutRoutineBody): Promise<PutRoutineResponse> {
    return plannerRequest<PutRoutineResponse>(`/api/clusters/${clusterId}/routines/${routineId}`, token, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  /** POST /api/planner/week/generate */
  generateWeek(token: string, start?: string): Promise<GenerateWeekResponse> {
    return plannerRequest<GenerateWeekResponse>("/api/planner/week/generate", token, {
      method: "POST",
      body: JSON.stringify(start ? { start } : {}),
    });
  },

  /** POST /api/clusters/:id/publish — body JSON legacy (v1, videoUrl). */
  publishToCluster(token: string, id: number, body: PublishToClusterBody): Promise<PublishToClusterResponse> {
    return plannerRequest<PublishToClusterResponse>(`/api/clusters/${id}/publish`, token, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** POST /api/clusters/:id/publish — multipart/form-data con archivo (v3).
   *  NO se setea Content-Type: el boundary lo genera el browser para el FormData. */
  publishToClusterWithFile(token: string, id: number, body: PublishToClusterFileBody): Promise<PublishToClusterResponse> {
    const form = new FormData();
    form.append("video", body.file);
    form.append("title", body.title);
    if (body.scheduledFor) form.append("scheduledFor", body.scheduledFor);
    return plannerRequest<PublishToClusterResponse>(`/api/clusters/${id}/publish`, token, {
      method: "POST",
      body: form,
    });
  },

  /** PATCH /api/tasks/runs/:id/schedule — reagendar (endpoint existente). */
  rescheduleTask(token: string, taskId: number, scheduledFor: string): Promise<Record<string, unknown>> {
    return plannerRequest<Record<string, unknown>>(`/api/tasks/runs/${taskId}/schedule`, token, {
      method: "PATCH",
      body: JSON.stringify({ scheduled_for: scheduledFor }),
    });
  },

  /** POST /api/tasks/runs/:id/move/preview — plan de cascada SIN aplicar nada. */
  previewCascadeMove(token: string, taskId: number, scheduledFor: string): Promise<CascadePreviewResponse> {
    return plannerRequest<CascadePreviewResponse>(`/api/tasks/runs/${taskId}/move/preview`, token, {
      method: "POST",
      body: JSON.stringify({ scheduled_for: scheduledFor }),
    });
  },

  /** POST /api/tasks/runs/:id/move — aplica la cascada (todo o nada en backend). */
  applyCascadeMove(token: string, taskId: number, scheduledFor: string): Promise<CascadeApplyResponse> {
    return plannerRequest<CascadeApplyResponse>(`/api/tasks/runs/${taskId}/move`, token, {
      method: "POST",
      body: JSON.stringify({ scheduled_for: scheduledFor }),
    });
  },

  /** PATCH /api/tasks/runs/:id/stop — cancelar (endpoint existente). */
  stopTask(token: string, taskId: number): Promise<Record<string, unknown>> {
    return plannerRequest<Record<string, unknown>>(`/api/tasks/runs/${taskId}/stop`, token, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
  },

  /** GET /api/social-accounts?platform=all — todas las cuentas scaneadas del workspace. */
  getWorkspaceAccounts(token: string): Promise<{ accounts: WorkspaceAccount[] }> {
    return plannerRequest<{ accounts: WorkspaceAccount[] }>("/api/social-accounts?platform=all", token);
  },

  /** GET /api/devices — para resolver device_id → nombre/alias. */
  getDevices(token: string): Promise<{ devices: WorkspaceDevice[] }> {
    return plannerRequest<{ devices: WorkspaceDevice[] }>("/api/devices", token);
  },
};
