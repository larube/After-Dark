import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/sqlite3";
import { drizzle } from "drizzle-orm/libsql/sqlite3";
import { readCatalogue, readHistory } from "../db/recommendations";
import * as schema from "../db/schema";
import { renderReport } from "./html";
import { compareReports, createReport, type Input, type Report } from "./report";

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

export async function readLocalDatabase(filename: string): Promise<Input> {
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
    const client = createClient({ url: pathToFileURL(dbPath).href });
    try {
      await client.execute("PRAGMA query_only = ON");
      const db = drizzle(client, { schema });
      const { catalogue, signals } = await readCatalogue(db);
      const { recent } = await readHistory(db);
      return {
        catalogue, signals: signals.map(({ film, ...signal }) => ({ id: film.id, ...signal })), recent: [...recent],
      };
    } finally {
      client.close();
    }
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"));
};

export async function diagnose(options: { input?: string; sqlite?: string; output: string; baseline?: string; referenceDate?: string; comparePolicy?: boolean }) {
  if (options.baseline && options.comparePolicy) throw new Error("Choisissez soit --baseline, soit --compare-policy.");
  const input = options.sqlite ? await readLocalDatabase(options.sqlite) : await readJson(options.input!);
  const report = createReport(input, { referenceDate: options.referenceDate });
  const baseline = options.baseline ? await readJson(options.baseline) as Report
    : options.comparePolicy ? createReport(input, { referenceDate: report.policy.referenceDate, mode: "legacy" }) : undefined;
  const comparison = baseline ? compareReports(baseline, report) : undefined;
  const output = resolve(options.output);
  const root = await realpath(process.cwd());
  if (options.sqlite && within(root, output)) throw new Error("Placez les rapports du profil SQLite hors de ce dépôt.");
  // Resolve the existing ancestor before creating anything, including when part of the output path is a symlink.
  let ancestor = output;
  while (true) {
    try {
      const resolved = await realpath(ancestor);
      if (options.sqlite && within(root, resolve(resolved, relative(ancestor, output)))) {
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
  if (options.sqlite && within(root, directory)) throw new Error("Placez les rapports du profil SQLite hors de ce dépôt.");
  const write = (name: string, data: string) => writeFile(join(directory, name), data, { mode: 0o600, flag: "wx" });
  await write("report.json", JSON.stringify(report, null, 2) + "\n");
  await write("report.html", renderReport(report, comparison));
  if (baseline && options.comparePolicy) await write("legacy.json", JSON.stringify(baseline, null, 2) + "\n");
  if (comparison) await write("comparison.json", JSON.stringify(comparison, null, 2) + "\n");
}
