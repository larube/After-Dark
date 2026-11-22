import { describe, expect, it } from "vitest";
import { ipc } from "../src/shared/ipc";

describe("contrats IPC", () => {
  it("n’accepte ni chemin depuis le renderer ni argument dans les deux canaux", () => {
    for (const route of Object.values(ipc)) {
      expect(route.request.safeParse([]).success).toBe(true);
      expect(route.request.safeParse([undefined]).success).toBe(false);
      expect(route.request.safeParse([{ path: "/tmp/file.json" }]).success).toBe(false);
    }
  });

  it("valide les réponses, y compris une annulation, et rejette les champs superflus", () => {
    const summary = { movies: 6, seen: 1, unseen: 1, evaluated: 4, favorites: [] };
    expect(ipc.summary.response.safeParse({ ok: true, data: summary }).success).toBe(true);
    expect(ipc.summary.response.safeParse({ ok: true, data: { ...summary, seen: -1 } }).success).toBe(false);
    expect(ipc.summary.response.safeParse({ ok: true, data: { ...summary, filename: "/tmp/test" } }).success).toBe(false);
    expect(ipc.importProfile.response.safeParse({ ok: true, data: { status: "cancelled" } }).success).toBe(true);
    expect(ipc.importProfile.response.safeParse({ ok: true, data: { status: "completed" } }).success).toBe(false);
    expect(ipc.importProfile.response.safeParse({ ok: false, error: "Import impossible" }).success).toBe(true);
  });
});
