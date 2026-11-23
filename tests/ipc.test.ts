import { describe, expect, it } from "vitest";
import { ipc } from "../src/shared/ipc";

describe("contrats IPC", () => {
  it("n’accepte ni chemin depuis le renderer ni argument dans les deux canaux", () => {
    for (const route of [ipc.summary, ipc.importProfile, ipc.enrichment, ipc.collection]) {
      expect(route.request.safeParse([]).success).toBe(true);
      expect(route.request.safeParse([undefined]).success).toBe(false);
      expect(route.request.safeParse([{ path: "/tmp/file.json" }]).success).toBe(false);
    }
  });

  it("valide et borne les mutations de retours", () => {
    const request = { action: "seen", movieId: 2, score: 0, appreciation: "  Je me suis ennuyé.  " };
    expect(ipc.saveFeedback.request.parse([request])).toEqual([{ ...request, appreciation: "Je me suis ennuyé." }]);
    for (const override of [{ score: 8.5 }, { score: 11 }, { movieId: -1 }, { appreciation: " " }, { source: "import" }]) {
      expect(ipc.saveFeedback.request.safeParse([{ ...request, ...override }]).success).toBe(false);
    }
    expect(ipc.saveFeedback.request.safeParse([{ action: "intention", movieId: 2, intention: "invented" }]).success).toBe(false);
    expect(ipc.saveFeedback.request.safeParse([{ action: "undo_seen", movieId: 2 }]).success).toBe(true);
    expect(ipc.saveFeedback.request.safeParse([{ action: "undo_seen", movieId: 2, status: "unseen" }]).success).toBe(false);
    expect(ipc.saveFeedback.response.parse({ ok: false, error: "Requête refusée." })).toEqual({ ok: false, error: "Requête refusée." });
  });

  it("valide les réponses, y compris une annulation, et rejette les champs superflus", () => {
    const summary = { movies: 6, seen: 4, unseen: 1, evaluated: 4, favorites: [] };
    expect(ipc.summary.response.safeParse({ ok: true, data: summary }).success).toBe(true);
    expect(ipc.summary.response.safeParse({ ok: true, data: { ...summary, seen: -1 } }).success).toBe(false);
    expect(ipc.summary.response.safeParse({ ok: true, data: { ...summary, filename: "/tmp/test" } }).success).toBe(false);
    expect(ipc.importProfile.response.safeParse({ ok: true, data: { status: "cancelled" } }).success).toBe(true);
    expect(ipc.importProfile.response.safeParse({ ok: true, data: { status: "completed" } }).success).toBe(false);
    expect(ipc.importProfile.response.safeParse({ ok: false, error: "Import impossible" }).success).toBe(true);
  });
});
