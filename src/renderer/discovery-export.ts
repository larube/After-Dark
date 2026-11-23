import type { DesktopApi } from "../shared/ipc";

type Reply = Awaited<ReturnType<DesktopApi["discoveryExport"]>>;
type ExportResult = Extract<Reply, { ok: true }>["data"];

const notices: Record<ExportResult, string> = {
  saved: "Diagnostic enregistré.",
  cancelled: "Export annulé.",
  inactive: "Cette exploration n’est plus active.",
  dialog_failed: "Impossible d’ouvrir la fenêtre de sauvegarde du diagnostic.",
  generation_failed: "Impossible de générer le diagnostic de cette exploration.",
  write_failed: "Impossible d’écrire le fichier du diagnostic. Choisissez un autre emplacement.",
};

export async function discoveryExportNotice(
  api: Partial<Pick<DesktopApi, "discoveryExport">> | undefined,
  ...args: Parameters<DesktopApi["discoveryExport"]>
): Promise<string> {
  if (typeof api?.discoveryExport !== "function") return "L’export est indisponible dans cette fenêtre. Quittez et relancez After Dark.";
  try {
    const reply = await api.discoveryExport(...args);
    if (reply.ok) return notices[reply.data];
  } catch {
    // The preload rejects malformed requests and responses, and Electron can reject the invocation.
  }
  return "Impossible de communiquer avec After Dark pour exporter le diagnostic. Quittez et relancez l’application.";
}
