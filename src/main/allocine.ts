import { allocineSearch, isAllocineSearch, type allocineFilmSchema } from "../shared/allocine";
import type { z } from "zod";

export async function openAllocine(film: z.infer<typeof allocineFilmSchema>, openExternal: (url: string) => Promise<void>) {
  const url = allocineSearch(film);
  if (!isAllocineSearch(url)) throw new Error("Recherche Allociné invalide.");
  await openExternal(url);
}
