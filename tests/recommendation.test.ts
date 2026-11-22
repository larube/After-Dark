import { describe, expect, it } from "vitest";
import { eligible, evaluateHoldout, recommend, type Film, type Signal } from "../src/domain/recommendation";
import { metadataSchema, type Criteria, type Metadata } from "../src/shared/recommendation";
import { ipc } from "../src/shared/ipc";

const filters = { preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [] };
const criteria = (overrides: Partial<Criteria> = {}): Criteria => ({ mood: "surprise", ...filters, ...overrides });
const movie = (id: number, title: string, metadata: Partial<Metadata>, status?: Film["status"]): Film => ({
  id, title, year: null, status, metadata: metadataSchema.parse(metadata),
});
const spain = movie(1, "Tesis", { countries: ["ES"], language: "es", minutes: 125, genres: ["Thriller"], directors: ["Alejandro Amenábar"] }, "unseen");
const argentina = movie(2, "Relatos salvajes", { countries: ["AR"], language: "es", minutes: 122, genres: ["Comédie", "Thriller"], keywords: ["dark comedy"] });
const usa = movie(3, "The Others", { countries: ["US", "ES"], language: "en", minutes: 104, genres: ["Horreur"], directors: ["Alejandro Amenábar"] });
const seen = movie(4, "Abre los ojos", { countries: ["ES"], language: "es", directors: ["Alejandro Amenábar"], genres: ["Thriller"] }, "seen");
const favorite: Signal = { film: seen, ratings: [{ qualitative: "Adoré" }], spontaneous: true, memorable: true, rewatch: true };
const catalogue = [spain, argentina, usa, seen];
const run = (input: Partial<Criteria> = {}, signals: Signal[] = [], recent: number[] = []) =>
  recommend(catalogue, signals, criteria(input), new Set(recent));
const ids = (result: ReturnType<typeof run>) => result.films.map(({ id }) => id);

describe("moteur de recommandation", () => {
  it("exclut les films vus et conserve les statuts non vu et inconnu", () => {
    expect(ids(run()).sort()).toEqual([1, 2, 3]);
  });

  it("distingue pays, coproduction, langue et préférence souple", () => {
    expect(ids(run({ requiredCountries: ["ES"] })).sort()).toEqual([1, 3]);
    expect(ids(run({ requiredLanguages: ["es"] })).sort()).toEqual([1, 2]);
    expect(ids(run({ requiredCountries: ["ES"], requiredLanguages: ["es"] }))).toEqual([1]);
    const preferred = ids(run({ preferredCountries: ["AR"] }));
    expect(preferred[0]).toBe(2);
    expect(preferred.slice(1).sort()).toEqual([1, 3]);
  });

  it("applique les bornes et refuse les données inconnues pour un filtre obligatoire", () => {
    const incomplete = movie(5, "Cure", {});
    expect(eligible(incomplete, criteria({ maxMinutes: 120 }))).toBe(false);
    expect(eligible(incomplete, criteria({ requiredCountries: ["ES"] }))).toBe(false);
    expect(eligible(incomplete, criteria({ requiredLanguages: ["es"] }))).toBe(false);
    expect(eligible(incomplete, criteria())).toBe(true);
    expect(ids(run({ maxMinutes: 122 }))).toContain(2);
    expect(ids(run({ maxMinutes: 120 }))).toEqual([3]);
    expect(run({ requiredCountries: ["JP"] }).status).toBe("no-match");
    expect(recommend([], [], criteria(), new Set()).status).toBe("empty");
  });

  it("combine indices du mood, affinité et explications fondées sur les données", () => {
    expect(ids(run({ mood: "laugh" }))[0]).toBe(2);
    expect(run({ mood: "laugh" }).films[0].reasons.join(" ")).toContain("dark comedy");
    expect(ids(run({ mood: "tension" }, [favorite]))[0]).toBe(1);
    expect(run({ mood: "tension" }, [favorite]).films[0].reasons.join(" ")).toContain("Alejandro Amenábar");
    expect(run({}, [favorite]).personalized).toBe(true);
    expect(run().personalized).toBe(false);
    expect(ids(run({ avoid: "laugh" }))).not.toContain(2);
    expect(run({ mood: "laugh", requiredCountries: ["US"] }).films[0].warnings).toHaveLength(1);
  });

  it("utilise les déceptions comme signal négatif et ne déduit rien d’une appréciation inconnue", () => {
    const disappointed = { ...favorite, spontaneous: false, memorable: false, rewatch: false, ratings: [{ numeric: 1 }] };
    expect(ids(run({}, [disappointed]))[0]).toBe(2);
    expect(run({}, [{ ...disappointed, ratings: [{ qualitative: "?" }] }]).personalized).toBe(false);
  });

  it("privilégie une sélection diversifiée et réserve les propositions récentes", () => {
    const lookalike = movie(5, "Los sin nombre", spain.metadata);
    const slate = recommend([...catalogue, lookalike], [], criteria(), new Set());
    expect(slate.films.slice(0, 3).map(({ id }) => id)).not.toContain(5);
    expect(slate.films.slice(0, 3).map(({ category }) => category)).toEqual(["safe", "gem", "wildcard"]);
    expect(ids(run({}, [], [1, 2]))).toEqual([3]);
    expect(run({}, [], [1, 2, 3]).status).toBe("exhausted");
  });

  it("produit une comparaison de masquage sans entraîner le profil sur le film masqué", () => {
    const results = evaluateHoldout(catalogue, [favorite], criteria(), new Set([seen.id]));
    expect(results).toEqual([{ id: 4, title: seen.title, rank: 4, ratings: favorite.ratings }]);
    expect(seen.status).toBe("seen");
  });

  it("valide les limites et champs IPC", () => {
    expect(ipc.recommend.request.safeParse([criteria(), false]).success).toBe(true);
    expect(ipc.recommend.request.safeParse([criteria({ requiredCountries: ["es"] }), false]).success).toBe(false);
    expect(ipc.recommend.request.safeParse([{ ...criteria(), token: "secret" }, false]).success).toBe(false);
    expect(ipc.recommend.request.safeParse([criteria({ maxMinutes: 601 }), false]).success).toBe(false);
  });
});
