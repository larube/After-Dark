import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Recommendation } from "../shared/recommendation";

const maxBytes = 300_000;
export const validPoster = (path?: string | null): path is string => !!path && /^\/[A-Za-z0-9_-]+\.jpg$/.test(path);
const isJpeg = (image?: Buffer): image is Buffer => image?.[0] === 0xff && image[1] === 0xd8;
const imageData = (image: Buffer) => "data:image/jpeg;base64," + image.toString("base64");
const directoryFor = (userData: string) => join(userData, "posters");

async function cached(filename: string) {
  try {
    const saved = await stat(filename);
    if (!saved.isFile() || saved.size > maxBytes) return;
    const image = await readFile(filename);
    if (isJpeg(image)) return image;
  } catch {
    // Missing or unreadable cache entries can use the normal fallback.
  }
}

export async function posterCacheState(path: string | undefined, userData: string) {
  if (!validPoster(path)) return "missing_path";
  return await cached(join(directoryFor(userData), basename(path))) ? "cached" : "missing_file";
}

async function readImage(response: Response) {
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

export function createPosterLoader(fetcher = fetch, now = Date.now) {
  const inFlight = new Map<string, Promise<string | undefined>>();
  const failed = new Map<string, number>();
  let cooldown = 0;
  const workers = [Promise.resolve(), Promise.resolve()];
  let nextWorker = 0;

  return async function load(path: string | undefined, userData: string, online = false) {
    if (!validPoster(path)) return;
    const directory = directoryFor(userData);
    const filename = join(directory, basename(path));
    const image = await cached(filename);
    if (image) return imageData(image);
    if (!online) return;
    const current = inFlight.get(filename);
    if (current) return current;
    if ((failed.get(filename) ?? 0) > now() || cooldown > now()) return;

    const worker = nextWorker++ % workers.length;
    const job = workers[worker].then(async () => {
      if (cooldown > now()) return;
      try {
        const response = await fetcher("https://image.tmdb.org/t/p/w185" + path, {
          signal: AbortSignal.timeout(2500), redirect: "error",
        });
        if (response.status === 429) {
          const header = response.headers.get("retry-after") ?? "";
          const retry = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now();
          cooldown = Math.max(cooldown, now() + Math.max(1000, Number.isFinite(retry) ? retry : 60_000));
        }
        const data = await readImage(response);
        if (isJpeg(data)) {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          await writeFile(filename, data, { mode: 0o600 });
          return imageData(data);
        }
        if (response.status !== 429) failed.set(filename, now() + (response.status === 404 ? 24 * 3600_000 : 60_000));
      } catch {
        failed.set(filename, now() + 60_000);
      }
    }).finally(() => { inFlight.delete(filename); });
    for (const [key, expiry] of failed) if (expiry <= now()) failed.delete(key);
    workers[worker] = job.then(() => undefined);
    inFlight.set(filename, job);
    return job;
  };
}

export const posterData = createPosterLoader();

export async function attachPosters(result: Recommendation, userData: string) {
  const online = result.connection === "online" || result.connection === "cached";
  await Promise.all(result.films.map(async (film) => {
    const data = await posterData(film.metadata.poster, userData, online);
    if (data) film.posterData = data;
  }));
}
