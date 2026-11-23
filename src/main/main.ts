import { currentDiscovery, discoveryDiagnostic, generateDiscovery, inspectDiscovery } from "../db/discovery";
import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { z } from "zod";
import { openDatabase } from "../db/client";
import { getCollection, saveFeedback } from "../db/feedback";
import { abandonLab, answerLab, currentLab, exportLab, finishLab, labResults, pauseLab, startLab, transferLabSeen } from "../db/lab";
import { getProfileSummary } from "../db/profile";
import { importProfile } from "../import/profile";
import { ipc, type DesktopApi } from "../shared/ipc";

import { cachedDiscoveryPosterPath, createDiscoveryPosters } from "./discovery-posters";
import { startEnrichment } from "./enrichment";
import { findTonight, localTmdb } from "./recommend";
import { attachPosters, posterCacheState, posterData } from "./posters";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

app.setName("After Dark");
const isolatedDataPath = process.env.AFTER_DARK_USER_DATA;
if (isolatedDataPath) {
  if (!isAbsolute(isolatedDataPath)) throw new Error("AFTER_DARK_USER_DATA doit être un chemin absolu.");
  mkdirSync(isolatedDataPath, { recursive: true, mode: 0o700 });
  app.setPath("userData", isolatedDataPath);
}

const developmentUrl = !app.isPackaged && MAIN_WINDOW_VITE_DEV_SERVER_URL
  ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).href : undefined;
const rendererPath = join(__dirname, "../renderer", MAIN_WINDOW_VITE_NAME, "index.html");
const rendererUrl = developmentUrl ?? pathToFileURL(rendererPath).href;
let window: BrowserWindow | undefined;
let database: Awaited<ReturnType<typeof openDatabase>> | undefined;
let importing = false;
let recommending = false;
let savingFeedback = false;
let enrichment: ReturnType<typeof startEnrichment> | undefined;

function trusted(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  return window?.webContents === event.sender && frame && frame === event.sender.mainFrame && frame.url === rendererUrl;
}

function register<T extends z.ZodType, A extends z.ZodType<unknown[]>>(
  route: { channel: string; request: A; response: T },
  run: (db: NonNullable<typeof database>["db"], owner: BrowserWindow, args: z.output<NoInfer<A>>) => z.input<NoInfer<T>> | Promise<z.input<NoInfer<T>>>,
) {
  ipcMain.handle(route.channel, async (event, ...args: unknown[]) => {
    const request = route.request.safeParse(args);
    if (!window || !trusted(event) || !request.success) {
      return route.response.parse({ ok: false, error: "Requête refusée." });
    }
    if (!database) {
      return route.response.parse({ ok: false, error: "Base indisponible. Relancez After Dark après avoir vérifié le dossier de données." });
    }
    try {
      return route.response.parse(await run(database.db, window, request.data));
    } catch (error) {
      console.error(`Échec IPC ${route.channel}`, error instanceof Error ? error.name : "UnknownError");
      return route.response.parse({ ok: false, error: "L’opération a échoué. Réessayez." });
    }
  });
}

function createWindow() {
  window = new BrowserWindow({
    title: "After Dark", width: 780, height: 650, minWidth: 410, minHeight: 470,
    backgroundColor: "#141316",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) => event.preventDefault());
  window.on("closed", () => { window = undefined; });
  const load = developmentUrl ? window.loadURL(developmentUrl) : window.loadFile(rendererPath);
  void load.catch(() => {
    dialog.showErrorBox("After Dark", "Impossible de charger l’interface locale.");
  });
}

const loadDiscoveryPoster = createDiscoveryPosters(localTmdb);
type Db = NonNullable<typeof database>["db"];

async function discoveryView(db: Db, row: Awaited<ReturnType<typeof currentDiscovery>>): ReturnType<DesktopApi["discoveryCurrent"]> {
  if (!row) return { ok: true, data: null };
  const directory = app.getPath("userData");
  const films = await Promise.all((await inspectDiscovery(db, row)).filter(({ admissible }) => admissible)
    .map(async ({ snapshot, local, poster, quality }) => {
      const { id, title, year, minutes, genres, synopsis, trace, reason } = snapshot;
      return {
        id, title, year, minutes, genres, synopsis, reason: trace ? reason : "Film proposé lors d’une exploration précédente.",
        format: quality.category === "tv_movie" ? "tv_movie" as const : undefined,
        posterData: await posterData(await cachedDiscoveryPosterPath(poster, local?.tmdbId, directory), directory),
      };
    }));
  const renewed = row.renewed === null ? null : row.renewed === 0 ? 0
    : films.filter(({ id }) => !row.rotation.previous[0]?.includes(id)).length;
  return { ok: true, data: { id: row.id, films, eligible: row.eligible, renewed } };
}

async function labView({ public: view, poster }: Awaited<ReturnType<typeof currentLab>>): ReturnType<DesktopApi["labCurrent"]> {
  if (view.status === "voting") view.film.posterData = await posterData(poster, app.getPath("userData"));
  return { ok: true, data: view };
}

const startup = new Date().toISOString();
const deferredViewings = new Set<number>();

void app.whenReady().then(async () => {
  try {
    const migrations = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "drizzle");
    database = await openDatabase(join(app.getPath("userData"), "after-dark.sqlite"), migrations);
  } catch (error) {
    console.error("Ouverture ou migration SQLite impossible", error instanceof Error ? error.name : "UnknownError");
  }

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (database) enrichment = startEnrichment(database.db, () => localTmdb(app.getPath("userData")),
    () => importing || recommending || savingFeedback);
  register(ipc.enrichment, async (): ReturnType<DesktopApi["enrichment"]> => enrichment
    ? { ok: true, data: await enrichment.progress() }
    : { ok: false, error: "Enrichissement indisponible." });
  register(ipc.summary, async (db): ReturnType<DesktopApi["summary"]> => ({
    ok: true, data: await getProfileSummary(db),
  }));
  register(ipc.collection, async (db): ReturnType<DesktopApi["collection"]> => ({
    ok: true, data: (await getCollection(db, startup)).map((entry) => deferredViewings.has(entry.movieId)
      ? { ...entry, needsConfirmation: false } : entry),
  }));
  register(ipc.deferViewing, (_db, _owner, [movieId]) => {
    deferredViewings.add(movieId);
    return { ok: true, data: null } as const;
  });
  register(ipc.saveFeedback, async (db, _owner, [request]): ReturnType<DesktopApi["saveFeedback"]> => {
    if (importing || recommending || savingFeedback) return { ok: false, error: "Une opération est déjà en cours." };
    savingFeedback = true;
    try {
      await enrichment?.settleWrite();
      return await saveFeedback(db, request, new Date(), startup);
    } finally {
      savingFeedback = false;
      enrichment?.wake();
    }
  });
  register(ipc.importProfile, async (db, owner): ReturnType<DesktopApi["importProfile"]> => {
    if (recommending || savingFeedback) return { ok: false, error: "Une opération est déjà en cours." };
    if (importing) return { ok: false, error: "Un import est déjà en cours." };
    importing = true;
    try {
      const result = await dialog.showOpenDialog(owner, {
        title: "Importer un profil cinéma",
        properties: ["openFile"],
        filters: [{ name: "Profil JSON", extensions: ["json"] }],
      });
      if (result.canceled || result.filePaths.length !== 1) return { ok: true, data: { status: "cancelled" } };
      let input: unknown;
      try {
        input = JSON.parse(await readFile(result.filePaths[0], "utf8"));
      } catch (error) {
        return { ok: false, error: error instanceof SyntaxError ? "Ce fichier ne contient pas un JSON valide." : "Impossible de lire le fichier." };
      }
      await enrichment?.settleWrite();
      const report = await importProfile(db, input);
      return { ok: true, data: { status: "completed", report, summary: await getProfileSummary(db) } };
    } finally {
      importing = false;
      enrichment?.wake();
    }
  });
  register(ipc.recommend, async (db, _owner, [criteria, allowRecent]): ReturnType<DesktopApi["recommend"]> => {
    if (importing || recommending || savingFeedback) return { ok: false, error: "Une opération est déjà en cours." };
    recommending = true;
    try {
      await enrichment?.settleWrite();
      const directory = app.getPath("userData");
      const result = await findTonight(db, criteria, () => localTmdb(directory), new Date(), allowRecent);
      await attachPosters(result, directory);
      return { ok: true, data: result };
    } finally {
      recommending = false;
    }
  });
  register(ipc.discoveryCurrent, async (db, _owner, [mode]) => discoveryView(db, await currentDiscovery(db, mode)));
  register(ipc.discoveryGenerate, async (db, _owner, [mode, previous]) => discoveryView(db, await generateDiscovery(db, mode, previous)));
  register(ipc.discoveryPosters, async (db, _owner, [mode, id, ids]): ReturnType<DesktopApi["discoveryPosters"]> => {
    const row = await currentDiscovery(db, mode);
    if (!row || row.id !== id) return { ok: true, data: [] };
    const requested = { ...row, films: row.films.filter((film) => ids.includes(film.id)) };
    const directory = app.getPath("userData");
    const posters = await Promise.all((await inspectDiscovery(db, requested)).filter(({ admissible }) => admissible)
      .map(async ({ snapshot, local, poster }) => {
        const data = await loadDiscoveryPoster(poster, local?.tmdbId, directory);
        return data ? [{ id: snapshot.id, data }] : [];
      }));
    return { ok: true, data: posters.flat() } as const;
  });
  register(ipc.discoveryExport, async (db, owner, [mode, id]): ReturnType<DesktopApi["discoveryExport"]> => {
    const row = await currentDiscovery(db, mode);
    if (!row || row.id !== id) return { ok: false, error: "Cette exploration n’est plus active." };
    const result = await dialog.showSaveDialog(owner, {
      title: "Exporter le diagnostic de Découvertes", defaultPath: "after-dark-decouvertes.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, data: "cancelled" };
    const directory = app.getPath("userData");
    const report = await discoveryDiagnostic(db, row, async (poster, tmdbId) =>
      posterCacheState(await cachedDiscoveryPosterPath(poster, tmdbId, directory), directory));
    await writeFile(result.filePath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    return { ok: true, data: "saved" };
  });
  register(ipc.labCurrent, async (db) => labView(await currentLab(db)));
  register(ipc.labStart, async (db, _owner, [criteria, repeats]) => labView(await startLab(db, criteria, repeats)));
  register(ipc.labPause, async (db, _owner, [id, paused]) => labView(await pauseLab(db, id, paused)));
  register(ipc.labAbandon, async (db, _owner, [id]) => labView(await abandonLab(db, id)));
  register(ipc.labAnswer, async (db, _owner, [id, position, answer]) => labView(await answerLab(db, id, position, answer)));
  register(ipc.labFinish, async (db, _owner, [id]): ReturnType<DesktopApi["labFinish"]> => await finishLab(db, id)
    ? { ok: true, data: null } : { ok: false, error: "Répondez à toutes les propositions avant de terminer." });
  register(ipc.labResults, async (db): ReturnType<DesktopApi["labResults"]> => ({ ok: true, data: await labResults(db) }));
  register(ipc.labTransferSeen, async (db, _owner, [id, position]): ReturnType<DesktopApi["labTransferSeen"]> => {
    if (importing || recommending || savingFeedback) return { ok: false, error: "Une opération est déjà en cours." };
    savingFeedback = true;
    try {
      await enrichment?.settleWrite();
      const reply = await transferLabSeen(db, id, position);
      return reply.ok ? { ok: true, data: null } : reply;
    } finally {
      savingFeedback = false;
      enrichment?.wake();
    }
  });
  register(ipc.labExport, async (db, owner): ReturnType<DesktopApi["labExport"]> => {
    const result = await dialog.showSaveDialog(owner, {
      title: "Exporter le Laboratoire", defaultPath: "after-dark-laboratoire.json", filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, data: "cancelled" };
    await writeFile(result.filePath, JSON.stringify(await exportLab(db), null, 2) + "\n", { mode: 0o600 });
    return { ok: true, data: "saved" };
  });
  createWindow();
  app.on("activate", () => { if (!window) createWindow(); });
});

app.on("before-quit", () => {
  enrichment?.stop();
  database?.close();
  database = undefined;
});
