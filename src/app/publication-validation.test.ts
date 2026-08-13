import { describe, expect, it } from "vitest";
import {
  accountsForSelection,
  countWords,
  toBuenosAiresIso,
  validateCaption,
  validateVideoFile,
} from "./publication-validation";

describe("publication validation", () => {
  it("counts whitespace-delimited words after normalizing whitespace", () => {
    expect(countWords("  uno\n dos   tres ")).toBe(3);
  });

  it("requires between one and ten caption words", () => {
    expect(validateCaption("", "instagram")).toContain("1 y 10 palabras");
    expect(validateCaption("uno dos tres cuatro cinco seis siete ocho nueve diez once", "tiktok")).toContain("1 y 10 palabras");
    expect(validateCaption("uno dos tres", "instagram")).toBeNull();
  });

  it("enforces YouTube's 100-character mobile caption limit", () => {
    expect(validateCaption(`${"a".repeat(93)} uno dos`, "youtube")).toContain("100 caracteres");
    expect(validateCaption(`${"a".repeat(93)} uno dos`, "instagram")).toBeNull();
  });

  it("accepts MP4, MOV, and WebM up to exactly 200 MiB", () => {
    expect(validateVideoFile({ name: "clip.mp4", type: "video/mp4", size: 200 * 1024 * 1024 })).toBeNull();
    expect(validateVideoFile({ name: "clip.mov", type: "video/quicktime", size: 1 })).toBeNull();
    expect(validateVideoFile({ name: "clip.webm", type: "video/webm", size: 1 })).toBeNull();
  });

  it("rejects oversized, empty, or unsupported videos", () => {
    expect(validateVideoFile({ name: "clip.mp4", type: "video/mp4", size: 200 * 1024 * 1024 + 1 })).toContain("200 MiB");
    expect(validateVideoFile({ name: "clip.mp4", type: "video/mp4", size: 0 })).toContain("vacío");
    expect(validateVideoFile({ name: "clip.avi", type: "video/x-msvideo", size: 100 })).toContain("MP4, MOV o WebM");
  });

  it("filters accounts by the exact selected device and platform", () => {
    const accounts = [
      { id: 1, device_id: 7, platform: "instagram" as const, username: "exacta" },
      { id: 2, device_id: 8, platform: "instagram" as const, username: "otro-telefono" },
      { id: 3, device_id: 7, platform: "tiktok" as const, username: "otra-plataforma" },
    ];
    expect(accountsForSelection(accounts, 7, "instagram").map((account) => account.id)).toEqual([1]);
  });

  it("converts a Buenos Aires wall-clock schedule to RFC3339 and rejects non-future times", () => {
    expect(toBuenosAiresIso("2026-08-14", "09:30", new Date("2026-08-13T12:00:00.000Z"))).toBe("2026-08-14T12:30:00.000Z");
    expect(() => toBuenosAiresIso("2026-08-13", "08:00", new Date("2026-08-13T12:00:00.000Z"))).toThrow(/futuro/);
  });

  it("rejects calendar dates that JavaScript would otherwise roll forward", () => {
    expect(() => toBuenosAiresIso("2026-02-31", "09:30", new Date("2026-01-01T00:00:00.000Z"))).toThrow(/válidas/);
  });
});
