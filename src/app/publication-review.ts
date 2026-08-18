import { authRequest } from "./auth-client";
import type { PublicationResponse } from "./publication-types";

export type ReviewAction = "confirm" | "dismiss";

export interface PublicationReviewOptions {
  apiBase: string;
  token?: string;
  id: number;
  action: ReviewAction;
  note?: string;
}

/**
 * Resuelve manualmente un job en review_required:
 * - "confirm" → el job pasa a completed (publicación verificada por el operador).
 * - "dismiss" → el job pasa a failed con error_code REVIEW_DISMISSED.
 * Devuelve el job view estándar, igual que el resto de los endpoints de publicaciones.
 */
export async function resolvePublicationReview({
  apiBase,
  token,
  id,
  action,
  note,
}: PublicationReviewOptions): Promise<PublicationResponse> {
  return authRequest<PublicationResponse>(apiBase, `/api/publications/${id}/review`, token, {
    method: "POST",
    body: JSON.stringify({ action, ...(note !== undefined ? { note } : {}) }),
  });
}
