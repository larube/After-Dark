import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client";
import { currentDiscovery, discoveryDiagnostic } from "../src/db/discovery";
import { discoveryExplorations, movies } from "../src/db/schema";
import { exportDiscoveryDiagnostic } from "../src/main/discovery-export";
import { discoveryExportNotice } from "../src/renderer/discovery-export";
import { ipc } from "../src/shared/ipc";

it.each(["discovery-v1", "discovery-v2"])("exports a persisted %s exploration after reopening SQLite", async (protocol) => {
  const directory = await mkdtemp(join(tmpdir(), "after-dark-export-"));
  const database = join(directory, "catalogue.sqlite");
  const filePath = join(directory, "report.json");
  try {
    const original = await openDatabase(database, "drizzle");
    try {
      await original.db.insert(movies).values({ id: 1, displayTitle: "Le film de test" });
      await original.db.insert(discoveryExplorations).values({
        mode: "gems", protocol, createdAt: "2025-10-01T00:00:00.000Z", engine: "1.2.0", seed: "test", fingerprint: "fixture",
        films: [{ id: 1, title: "Le film de test", year: null, genres: [], reason: "Raison ancienne" }],
        eligible: 1, renewed: null, rotation: { previous: [], adjacent: [] },
      });
    } finally {
      original.close();
    }
    const { db, close } = await openDatabase(database, "drizzle");
    try {
      const row = (await currentDiscovery(db, "gems"))!;
      const result = await exportDiscoveryDiagnostic(async () => ({ canceled: false, filePath }),
        () => discoveryDiagnostic(db, row, async () => "missing_path", "2026-11-23"));
      expect(ipc.discoveryExport.response.parse({ ok: true, data: result })).toEqual({ ok: true, data: "saved" });
      const report = JSON.parse(await readFile(filePath, "utf8"));
      expect(report).toMatchObject({ protocol, films: [{ title: "Le film de test", reason: null, rankingAtGeneration: null }] });
      expect(await currentDiscovery(db, "gems")).toEqual(row);
    } finally {
      close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("keeps cancellation, dialog, generation and write failures distinct", async () => {
  const directory = await mkdtemp(join(tmpdir(), "after-dark-export-"));
  const sensitiveError = async () => { throw new Error("private path or token"); };
  const generate = vi.fn(async () => ({ report: true }));
  try {
    const choose = async () => ({ canceled: false, filePath: directory });
    expect(await exportDiscoveryDiagnostic(async () => ({ canceled: true }), generate)).toBe("cancelled");
    expect(await exportDiscoveryDiagnostic(sensitiveError, generate)).toBe("dialog_failed");
    expect(await exportDiscoveryDiagnostic(async () => ({ canceled: false }), generate)).toBe("dialog_failed");
    expect(generate).not.toHaveBeenCalled();
    expect(await exportDiscoveryDiagnostic(choose, sensitiveError)).toBe("generation_failed");
    expect(await exportDiscoveryDiagnostic(choose, generate)).toBe("write_failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("reports a missing preload method and IPC contract failures without exposing error details", async () => {
  expect(await discoveryExportNotice({}, "gems", 1)).toContain("indisponible dans cette fenêtre");
  const rejected = vi.fn(async () => ipc.discoveryExport.response.parse({ secret: "/private/test" }));
  const notice = await discoveryExportNotice({ discoveryExport: rejected }, "gems", 1);
  expect(notice).toContain("Impossible de communiquer");
  expect(notice).not.toMatch(/secret|private|Zod/);
  const missingHandler = async () => { throw new Error("No handler registered for 'discovery:export'"); };
  expect(await discoveryExportNotice({ discoveryExport: missingHandler }, "gems", 1)).toBe(notice);
  expect(await discoveryExportNotice({ discoveryExport: async () => ({ ok: false, error: "private" }) }, "gems", 1)).toBe(notice);
  expect(await discoveryExportNotice({ discoveryExport: async () => ({ ok: true, data: "cancelled" }) }, "gems", 1)).toBe("Export annulé.");
});
