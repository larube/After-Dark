import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cachedDiscoveryPosterPath, createDiscoveryPosters } from "../src/main/discovery-posters";
import { createPosterLoader, posterCacheState } from "../src/main/posters";
import { TmdbClient } from "../src/main/tmdb";

const jpeg = () => new Response(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), {
  headers: { "content-type": "image/jpeg" },
});

describe("affiches de Découvertes", () => {
  it("sert le disque hors ligne, déduplique les tentatives et limite le réseau à deux images", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-posters-"));
    try {
      let active = 0;
      let max = 0;
      const fetcher = vi.fn<typeof fetch>(async () => {
        max = Math.max(++active, max);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active--;
        return jpeg();
      });
      const load = createPosterLoader(fetcher);
      expect(await load("/a.jpg", directory)).toBeUndefined();
      expect(await load("/../any.jpg", directory, true)).toBeUndefined();
      expect(fetcher).not.toHaveBeenCalled();
      const responses = await Promise.all(["a", "b", "a", "c", "d"].map((key) => load("/" + key + ".jpg", directory, true)));
      expect(responses.every((response) => response?.startsWith("data:image/jpeg;base64,"))).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(max).toBe(2);
      expect(await load("/a.jpg", directory)).toBe(responses[0]);
      expect(await posterCacheState("/a.jpg", directory)).toBe("cached");
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("temporise les erreurs, les fichiers invalides et les limites de débit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-posters-limits-"));
    try {
      let now = 1_000;
      const fetcher = vi.fn<typeof fetch>()
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "90" } }))
        .mockResolvedValueOnce(new Response("pas une image", { headers: { "content-type": "image/jpeg" } }))
        .mockImplementation(async () => jpeg());
      const load = createPosterLoader(fetcher, () => now);
      for (const key of ["offline", "offline", "limited", "cooldown"]) expect(await load("/" + key + ".jpg", directory, true)).toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(2);
      now += 90_100;
      expect(await load("/bad.jpg", directory, true)).toBeUndefined();
      expect(await posterCacheState("/bad.jpg", directory)).toBe("missing_file");
      expect(await load("/bad.jpg", directory, true)).toBeUndefined();
      expect(await load("/offline.jpg", directory, true)).toMatch(/^data:image/);
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("résout une affiche par identifiant vérifié, conserve le chemin et évite les recherches répétées", async () => {
    const directory = await mkdtemp(join(tmpdir(), "after-dark-posters-path-"));
    const imageFetch = vi.fn(async () => jpeg());
    try {
      const details = vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const id = Number(new URL(String(input)).pathname.split("/").at(-1));
        return Response.json({ id, poster_path: id === 123 ? "/cover.jpg" : null });
      });
      const client = new TmdbClient("test-token", details);
      // Inject the poster transport through the shared loader so this test never uses the network.
      const load = createDiscoveryPosters(async () => client, createPosterLoader(imageFetch));
      await Promise.all([load(undefined, 123, directory), load(undefined, 123, directory)]);
      expect(await cachedDiscoveryPosterPath(undefined, 123, directory)).toBe("/cover.jpg");
      expect(await load(undefined, 124, directory)).toBeUndefined();
      expect(await load(undefined, 124, directory)).toBeUndefined();
      expect(details).toHaveBeenCalledTimes(2);
      const offline = createDiscoveryPosters(async () => undefined, createPosterLoader(imageFetch));
      expect(await offline(undefined, 123, directory)).toMatch(/^data:image/);
      expect(imageFetch).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
