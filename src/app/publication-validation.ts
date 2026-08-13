import type { PublicationAccount, PublicationPlatform } from "./publication-types";

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export function countWords(value: string): number {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.split(" ").length : 0;
}

export function validateCaption(value: string, platform: PublicationPlatform): string | null {
  const wordCount = countWords(value);
  if (wordCount < 1 || wordCount > 10) return "El caption debe contener entre 1 y 10 palabras.";
  if (platform === "youtube" && value.trim().length > 100) return "YouTube admite hasta 100 caracteres en este caption.";
  return null;
}

export function validateVideoFile(file: Pick<File, "name" | "type" | "size">): string | null {
  if (file.size <= 0) return "El archivo de video está vacío.";
  if (!VIDEO_MIME_TYPES.has(file.type)) return "Elegí un video MP4, MOV o WebM válido.";
  if (file.size > MAX_VIDEO_BYTES) return "El video supera el límite de 200 MiB.";
  return null;
}

export function accountsForSelection<T extends PublicationAccount>(accounts: readonly T[], deviceId: number | null, platform: PublicationPlatform): T[] {
  if (!deviceId) return [];
  return accounts.filter((account) => account.device_id === deviceId && account.platform === platform);
}

export function toBuenosAiresIso(date: string, time: string, now = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Elegí una fecha y hora válidas.");
  const parsed = new Date(`${date}T${time}:00-03:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Elegí una fecha y hora válidas.");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59
    || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw new Error("Elegí una fecha y hora válidas.");
  if (parsed.getTime() <= now.getTime()) throw new Error("La fecha programada debe estar en el futuro.");
  return parsed.toISOString();
}
