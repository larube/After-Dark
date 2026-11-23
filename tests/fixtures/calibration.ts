import type { Film, Signal } from "../../src/domain/recommendation";
import { discoveryDate, discoveryFixture } from "./discovery";

const generic = ["love", "couple", "friendship", "home", "family", "city"];
const catalogue: Film[] = [
  ...discoveryFixture.catalogue,
  ...Array.from({ length: 32 }, (_, i): Film => ({
    id: 100 + i, title: `Les Reflets ${i + 1}`, year: i % 8 < 4 ? 1968 + i % 8 : 2001 + i,
    status: i < 16 ? "seen" : "unknown",
    metadata: {
      countries: i % 4 === 0 ? ["IN"] : i % 4 === 1 ? ["JP"] : i % 4 === 2 ? ["IN", "FR"] : ["US"],
      directors: [i % 8 < 4 ? "Ariane Or" : "Camille Rose"],
      genres: ["Thriller", "Drama"], keywords: [...generic, i % 4 === 1 ? "film noir" : "relocation"],
      minutes: 100, popularity: 5 + i,
    },
  })),
  ...Array.from({ length: 12 }, (_, i): Film => ({
    id: 200 + i, title: `Les Marées ${i + 1}`, year: 1982 + i,
    status: i < 4 ? "seen" : "unknown",
    metadata: { countries: ["NZ"], directors: ["Léon Écume"], genres: ["Drama"],
      keywords: i < 8 ? ["desert survival"] : [], minutes: 100, popularity: 9 + i },
  })),
];
const signals: Signal[] = [
  ...discoveryFixture.signals,
  ...catalogue.filter(({ id, status }) => id >= 100 && status === "seen").map((film): Signal => ({
    film, ratings: [{ numeric: film.id < 112 ? 8.5 : film.id < 200 ? 5 : 1 }],
    spontaneous: film.id < 112, memorable: false, rewatch: false,
  })),
];

export const calibrationFixture = {
  catalogue, signals, excluded: discoveryFixture.excluded, date: discoveryDate,
  rotations: {
    affinities: { previous: [[2, 19, 119]], adjacent: [12, 126] },
    gems: { previous: [[12, 126]], adjacent: [2, 19, 119] },
    offbeat: { previous: [[28, 31]], adjacent: [2, 12, 19, 119, 126] },
  },
};
