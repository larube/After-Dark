import { z } from "zod";

const origin = "https://www.allocine.fr";
const searchPath = "/rechercher/movie/";
export const allocineFilmSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  year: z.number().int().nullable(),
});

export function allocineSearch({ title, year }: z.infer<typeof allocineFilmSchema>) {
  const url = new URL(searchPath, origin);
  url.searchParams.set("q", year !== null && year >= 1888 && year <= 2100 ? `${title} ${year}` : title);
  return url.href;
}

export function isAllocineSearch(value: string) {
  const url = URL.parse(value);
  return !!url && url.protocol === "https:" && url.origin === origin && !url.username && !url.password && !url.hash &&
    url.pathname === searchPath && url.searchParams.size === 1 && !!url.searchParams.get("q")?.trim();
}
