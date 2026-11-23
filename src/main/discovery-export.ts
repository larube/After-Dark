import { writeFile } from "node:fs/promises";

export async function exportDiscoveryDiagnostic(
  chooseFile: () => Promise<{ canceled: boolean; filePath?: string }>,
  generate: () => Promise<unknown>,
) {
  let destination;
  try {
    destination = await chooseFile();
  } catch {
    return "dialog_failed";
  }
  if (destination.canceled) return "cancelled";
  if (!destination.filePath) return "dialog_failed";

  let json;
  try {
    json = JSON.stringify(await generate(), null, 2) + "\n";
  } catch {
    return "generation_failed";
  }

  try {
    await writeFile(destination.filePath, json, { mode: 0o600 });
    return "saved";
  } catch {
    return "write_failed";
  }
}
