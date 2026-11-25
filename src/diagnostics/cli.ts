import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/sqlite3";
import { drizzle } from "drizzle-orm/libsql/sqlite3";
import { affinityModels } from "../domain/affinity";
import { readCatalogue, readHistory } from "../db/recommendations";
import type { CinemaDatabase } from "../db/client";
import * as schema from "../db/schema";
import { renderReport } from "./html";
import { compareAffinityModels, compareReports, createReport, type Input, type Report } from "./report";

async function signature(path: string, optional = false) {
  try {
    const info = await stat(path, { bigint: true });
    if (!info.isFile()) throw new Error("La source SQLite doit être un fichier ordinaire.");
    return [info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function withSnapshotFile<T>(filename: string, use: (path: string) => Promise<T>): Promise<T> {
  const source = await realpath(filename);
  const snapshot = await mkdtemp(join(tmpdir(), "after-dark-diagnostic-"));
  try {
    const dbPath = join(snapshot, "snapshot.sqlite");
    const files = [source, source + "-wal"];
    const before = await Promise.all(files.map((file, index) => signature(file, index > 0)));
    await copyFile(source, dbPath);
    if (before[1] !== null) await copyFile(files[1], dbPath + "-wal");
    const after = await Promise.all(files.map((file, index) => signature(file, index > 0)));
    if (before.some((value, index) => value !== after[index])) {
      throw new Error("SQLite a changé pendant la copie. Quittez After Dark et relancez le diagnostic.");
    }
    return await use(dbPath);
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}

export async function withLocalSnapshot<T>(filename: string, read: (db: CinemaDatabase) => Promise<T>): Promise<T> {
  return withSnapshotFile(filename, async (dbPath) => {
    const client = createClient({ url: pathToFileURL(dbPath).href });
    try {
      await client.execute("PRAGMA query_only = ON");
      return await read(drizzle(client, { schema }));
    } finally {
      client.close();
    }
  });
}

export function readLocalDatabase(filename: string): Promise<Input> {
  return withLocalSnapshot(filename, async (db) => {
    const { catalogue, signals } = await readCatalogue(db);
    const { recent } = await readHistory(db);
    return { catalogue, signals: signals.map(({ film, ...signal }) => ({ id: film.id, ...signal })), recent: [...recent] };
  });
}
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"));
};

export async function reportDirectory(destination: string, privateReport: boolean) {
  const output = resolve(destination);
  const root = await realpath(process.cwd());
  if (privateReport && within(root, output)) throw new Error("Placez les rapports du profil SQLite hors de ce dépôt.");
  // Resolve the existing ancestor before creating anything, including when part of the output path is a symlink.
  let ancestor = output;
  while (true) {
    try {
      const resolved = await realpath(ancestor);
      if (privateReport && within(root, resolve(resolved, relative(ancestor, output)))) {
        throw new Error("Placez les rapports du profil SQLite hors de ce dépôt.");
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ancestor = resolve(ancestor, "..");
    }
  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  const directory = await realpath(output);
  if (privateReport && within(root, directory)) throw new Error("Placez les rapports du profil SQLite hors de ce dépôt.");
  return directory;
}

export async function diagnose(options: { input?: string; sqlite?: string; output: string; baseline?: string; referenceDate?: string; comparePolicy?: boolean; compareRanking?: boolean; comparePr21?: boolean; compareAffinity?: boolean; affinity?: string }) {
  if ([options.baseline, options.comparePolicy, options.compareRanking, options.comparePr21].filter(Boolean).length > 1) {
    throw new Error("Choisissez une seule comparaison : --baseline, --compare-policy --compare-ranking ou --compare-pr21.");
  }
  const affinityModel = affinityModels.find((model) => model === (options.affinity ?? "current"));
  if (!affinityModel) throw new Error("Modèle inconnu : " + options.affinity);
  const input = options.sqlite ? await readLocalDatabase(options.sqlite) : await readJson(options.input!);
  const report = createReport(input, { referenceDate: options.referenceDate, affinityModel, ranking: options.comparePolicy ? "legacy" : "relevance" });
  const baseline = options.baseline ? await readJson(options.baseline) as Report
    : options.comparePolicy || options.compareRanking || options.comparePr21 ? createReport(input, {
      referenceDate: report.policy.referenceDate, mode: options.comparePolicy ? "legacy" : "classic",
      affinityModel, ranking: options.comparePr21 ? "relevance-initial" : "legacy",
    }) : undefined;
  const comparison = baseline ? compareReports(baseline, report) : undefined;
  const directory = await reportDirectory(options.output, !!options.sqlite);
  const write = (name: string, data: string) => writeFile(join(directory, name), data, { mode: 0o600, flag: "wx" });
  await write("report.json", JSON.stringify(report, null, 2) + "\n");
  await write("report.html", renderReport(report, comparison));
  if (baseline && (options.comparePolicy || options.compareRanking || options.comparePr21)) await write("legacy.json", JSON.stringify(baseline, null, 2) + "\n");
  if (options.compareAffinity) await write("affinity-comparison.json", JSON.stringify(compareAffinityModels(input, report.policy.referenceDate), null, 2) + "\n");
  if (comparison) await write("comparison.json", JSON.stringify(comparison, null, 2) + "\n");
}
