import type { Film, Signal } from "../../src/domain/recommendation";

const families = [
  { label: "Archives de brume", genre: "Thriller", director: "Ariane Or", country: "FR", period: 2010, popularity: 20 },
  { label: "Les phares du nord", genre: "Mystery", director: "Jules Nuit", country: "CA", period: 1990, popularity: 3 },
  { label: "Jardins de sel", genre: "Documentary", director: "Saki Aube", country: "JP", period: 1960, popularity: 7 },
  { label: "Les cartes sans bord", genre: "Animation", director: "Luz Mer", country: "CL", period: 1980, popularity: 4 },
];
const base = { countries: [], genres: [], directors: [], keywords: [] };
const generic = ["love", "friendship", "family", "travel", "city", "night", "home", "river"];

export const discoveryDate = "2026-11-23";
export const discoveryFixture: { catalogue: Film[]; signals: Signal[]; excluded: Set<number> } = {
  catalogue: [
    ...families.flatMap(({ label, genre, director, country, period, popularity }, group) =>
      Array.from({ length: 9 }, (_, n): Film => ({
        id: 1 + group * 9 + n, title: `${label} ${n + 1}`, year: period + n, status: "unknown",
        metadata: { ...base, genres: [genre], directors: n % 3 ? [director] : [`${director} II`],
          countries: [country], minutes: 95 + n, keywords: group === 0 ? generic : group === 1 ? generic.slice(0, 2) : [],
          popularity: popularity + n },
      }))),
    { id: 37, title: "Les Lignes", year: null, status: "unknown", metadata: base },
    { id: 38, title: "La répétition publique", year: 2002, status: "unknown", metadata: { ...base, minutes: 112, keywords: ["concert film"] } },
    { id: 39, title: "Trois minutes d’orage", year: 2017, status: "unknown", metadata: { ...base, minutes: 8 } },
    { id: 40, title: "Le prochain été", year: 2030, status: "unknown",
      metadata: { ...base, minutes: 94, release: { source: "TMDB", primaryDate: "2030-01-01" } } },
    { id: 41, title: "Les Heures d’encre", year: 2015, status: "seen",
      metadata: { ...base, minutes: 98, countries: ["FR"], genres: ["Thriller"], directors: ["Ariane Or"], keywords: generic } },
    { id: 42, title: "Où la glace fond", year: 1991, status: "seen",
      metadata: { ...base, minutes: 108, countries: ["CA"], genres: ["Mystery"], directors: ["Jules Nuit"] } },
  ],
  signals: [],
  excluded: new Set([3]),
};
discoveryFixture.signals = discoveryFixture.catalogue.filter(({ status }) => status === "seen").map((film, n) => ({
  film, ratings: [{ numeric: n ? 7.5 : 8.5 }], spontaneous: n === 0, memorable: false, rewatch: false,
}));
