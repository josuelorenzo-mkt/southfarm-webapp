import { AuthApiError, getActiveAccessToken, refreshStoredAccessToken } from "./auth-client";
import type { PublicationApiError, PublicationResponse } from "./publication-types";

interface UploadAttemptResult {
  status: number;
  payload: PublicationResponse | PublicationApiError;
}

export interface PublicationUploadOptions {
  apiBase: string;
  token?: string;
  body: FormData;
  signal?: AbortSignal;
  onProgress?: (percentage: number) => void;
  createRequest?: () => XMLHttpRequest;
  refreshAccessToken?: (apiBase: string) => Promise<string | null>;
}

function abortError(): DOMException {
  return new DOMException("La carga fue cancelada.", "AbortError");
}

function responseError(payload: PublicationResponse | PublicationApiError, status: number): AuthApiError {
  const message = "error" in payload && typeof payload.error === "string"
    ? payload.error
    : "No se pudo completar la solicitud";
  return new AuthApiError(message, status);
}

function sendAttempt(
  url: string,
  token: string | null,
  body: FormData,
  signal: AbortSignal | undefined,
  onProgress: ((percentage: number) => void) | undefined,
  createRequest: () => XMLHttpRequest,
): Promise<UploadAttemptResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const xhr = createRequest();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => xhr.abort();

    xhr.open("POST", url);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
    };
    xhr.onerror = () => finish(() => reject(new Error(
      "La conexión se interrumpió durante la carga. Tus campos se conservaron.",
    )));
    xhr.onabort = () => finish(() => reject(abortError()));
    xhr.onload = () => finish(() => {
      let payload: PublicationResponse | PublicationApiError = {};
      try {
        payload = JSON.parse(xhr.responseText) as PublicationResponse | PublicationApiError;
      } catch {}
      resolve({ status: xhr.status, payload });
    });
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}

export async function uploadPublication({
  apiBase,
  token,
  body,
  signal,
  onProgress,
  createRequest = () => new XMLHttpRequest(),
  refreshAccessToken = refreshStoredAccessToken,
}: PublicationUploadOptions): Promise<PublicationResponse> {
  const url = `${apiBase}/api/publications`;
  const activeToken = getActiveAccessToken(token);
  const first = await sendAttempt(url, activeToken, body, signal, onProgress, createRequest);

  if (first.status === 401 && activeToken && !signal?.aborted) {
    const refreshedToken = await refreshAccessToken(apiBase);
    if (refreshedToken && !signal?.aborted) {
      onProgress?.(0);
      const retry = await sendAttempt(url, refreshedToken, body, signal, onProgress, createRequest);
      if (retry.status >= 200 && retry.status < 300) return retry.payload as PublicationResponse;
      throw responseError(retry.payload, retry.status);
    }
  }

  if (first.status >= 200 && first.status < 300) return first.payload as PublicationResponse;
  throw responseError(first.payload, first.status);
}
