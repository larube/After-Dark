import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const filename = "horror-acquisition.json";

export async function readHorrorAcquisition(directory: string): Promise<boolean> {
  try {
    return (await readFile(join(directory, filename), "utf8")).trim() === "true";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function saveHorrorAcquisition(directory: string, enabled: boolean) {
  const temporary = join(directory, `.${filename}.${randomUUID()}`);
  try {
    await writeFile(temporary, JSON.stringify(enabled) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, join(directory, filename));
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return enabled;
}
