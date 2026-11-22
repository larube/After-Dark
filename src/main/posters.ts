import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Recommendation } from "../shared/recommendation";

const maxBytes = 300_000;

async function download(path: string) {
  const response = await fetch("https://image.tmdb.org/t/p/w185" + path, {
    signal: AbortSignal.timeout(2500), redirect: "error",
  });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/jpeg" || !response.body) return;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxBytes) return;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

export async function attachPosters(result: Recommendation, userData: string) {
  const directory = join(userData, "posters");
  const online = result.connection === "online" || result.connection === "cached";
  await Promise.all(result.films.map(async (film) => {
    const path = film.metadata.poster;
    if (!path || !/^\/[A-Za-z0-9_-]+\.jpg$/.test(path)) return;
    const filename = join(directory, basename(path));
    try {
      const saved = await stat(filename).catch(() => undefined);
      let image = saved?.isFile() && saved.size <= maxBytes ? await readFile(filename) : undefined;
      if (!image && online) {
        image = await download(path);
        if (image) {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          await writeFile(filename, image, { mode: 0o600 });
        }
      }
      if (image?.[0] === 0xff && image[1] === 0xd8) film.posterData = "data:image/jpeg;base64," + image.toString("base64");
    } catch {
      // Illustrations are optional. The text and recommendations remain available.
    }
  }));
}
