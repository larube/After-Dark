import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { z } from "zod";
import { openDatabase } from "../db/client";
import { getProfileSummary } from "../db/profile";
import { importProfile } from "../import/profile";
import { ipc, type DesktopApi } from "../shared/ipc";

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
let database: ReturnType<typeof openDatabase> | undefined;
let importing = false;

function trusted(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  return window?.webContents === event.sender && frame && frame === event.sender.mainFrame && frame.url === rendererUrl;
}

function register<T extends z.ZodType>(
  route: { channel: string; request: z.ZodType; response: T },
  run: (db: NonNullable<typeof database>["db"], owner: BrowserWindow) => z.input<NoInfer<T>> | Promise<z.input<NoInfer<T>>>,
) {
  ipcMain.handle(route.channel, async (event, ...args: unknown[]) => {
    if (!window || !trusted(event) || !route.request.safeParse(args).success) {
      return route.response.parse({ ok: false, error: "Requête refusée." });
    }
    if (!database) {
      return route.response.parse({ ok: false, error: "Base indisponible. Relancez After Dark après avoir vérifié le dossier de données." });
    }
    try {
      return route.response.parse(await run(database.db, window));
    } catch (error) {
      console.error(`Échec IPC ${route.channel}`, error instanceof Error ? error.name : "UnknownError");
      return route.response.parse({ ok: false, error: "L’opération a échoué. Vérifiez le fichier et réessayez." });
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

void app.whenReady().then(() => {
  try {
    const migrations = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "drizzle");
    database = openDatabase(join(app.getPath("userData"), "after-dark.sqlite"), migrations);
  } catch (error) {
    console.error("Ouverture ou migration SQLite impossible", error instanceof Error ? error.name : "UnknownError");
  }

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  register(ipc.summary, (db): Awaited<ReturnType<DesktopApi["summary"]>> => ({
    ok: true, data: getProfileSummary(db),
  }));
  register(ipc.importProfile, async (db, owner): ReturnType<DesktopApi["importProfile"]> => {
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
      const report = importProfile(db, input);
      return { ok: true, data: { status: "completed", report, summary: getProfileSummary(db) } };
    } finally {
      importing = false;
    }
  });
  createWindow();
  app.on("activate", () => { if (!window) createWindow(); });
});

app.on("before-quit", () => {
  database?.close();
  database = undefined;
});
