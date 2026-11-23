import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ipc } from "../src/shared/ipc";
import { recommendationSchema } from "../src/shared/recommendation";
import { FilterPanel, MoodSelector, moodOrder } from "../src/renderer/controls";
import { defaultFilters, durations, readCriteria } from "../src/renderer/criteria";
import { FeedbackCollection, FilmActions, ViewingReminder } from "../src/renderer/feedback";
import { Results } from "../src/renderer/results";
import { AppShell } from "../src/renderer/shell";

describe("Interface Neon Underground", () => {
  it("préserve les six radios natives et leur sélection", () => {
    const html = renderToStaticMarkup(createElement(MoodSelector, { value: "strange", onChange() {}, busy: false }));
    for (const mood of moodOrder) expect(html).toContain(`value="${mood}"`);
    expect(html.match(/type="radio"/g)).toHaveLength(6);
    expect(html).toMatch(/checked="" value="strange"/);
  });

  it.each(durations)("convertit la durée %i vers un plafond en minutes", (minutes, label) => {
    const html = renderToStaticMarkup(createElement(FilterPanel, { value: defaultFilters, busy: false, onChange() {} }));
    expect(html).toMatch(new RegExp(`type="radio"[^>]*value="${minutes}"[^>]*>[^<]*${label}`));
    expect(readCriteria({ ...defaultFilters, duration: String(minutes) }, "laugh").data?.maxMinutes).toBe(minutes);
  });

  it("laisse la séance sans restriction par défaut et ne transmet pas d’énergie", () => {
    expect(readCriteria(defaultFilters, "surprise").data).toEqual({
      mood: "surprise", maxMinutes: undefined, avoid: undefined,
      preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [],
    });
    expect(readCriteria({ ...defaultFilters, duration: "110" }, "surprise").success).toBe(false);
  });

  it("sérialise plusieurs pays et langues dans leurs champs respectifs et garde les choix entre recherches", () => {
    const selection = { ...defaultFilters, countries: ["FR", "ES"], languages: ["en", "ja"], duration: "120", avoid: "tension" };
    const preferred = readCriteria(selection, "laugh");
    expect(preferred.data).toMatchObject({
      preferredCountries: ["FR", "ES"], requiredCountries: [],
      preferredLanguages: ["en", "ja"], requiredLanguages: [], maxMinutes: 120, avoid: "tension",
    });
    const required = readCriteria({ ...selection, countriesRequired: true, languagesRequired: true }, "laugh");
    expect(required.data).toMatchObject({
      preferredCountries: [], requiredCountries: ["FR", "ES"],
      preferredLanguages: [], requiredLanguages: ["en", "ja"],
    });
    expect(ipc.recommend.request.safeParse([required.data, false]).success).toBe(true);
    expect(readCriteria(selection, "laugh").data).toEqual(preferred.data);
  });

  it("rend les filtres multiples, les puces amovibles et un seul bouton de recherche", () => {
    const action = createElement("button", { type: "submit" }, "Trouve-moi un film");
    const html = renderToStaticMarkup(createElement(FilterPanel, {
      value: { ...defaultFilters, countries: ["FR", "ES"], countriesRequired: true, languages: ["ja", "es"] },
      busy: false, onChange() {}, action,
    }));
    for (const name of ["France", "Espagne", "Japonais", "Espagnol"]) {
      expect(html).toContain(`aria-label="Retirer ${name}"`);
    }
    expect(html.match(/<input[^>]+type="checkbox"[^>]*checked=""[^>]*\/>/g)).toHaveLength(5);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html.match(/type="search"/g)).toHaveLength(2);
    expect(html).toContain("Uniquement ces pays de production");
    expect(html).toContain("Uniquement ces langues originales");
    expect(html).toContain("Réinitialiser les critères");
    expect(html).not.toContain("Énergie disponible");
  });

  it("affiche les résultats avec les raisons et avertissements du moteur", () => {
    const data = recommendationSchema.parse({
      connection: "cached", personalized: true, status: "ready",
      films: [{
        id: 1, title: "Cure", year: 1997, category: "gem",
        metadata: { minutes: 111, countries: ["JP"] }, reasons: ["Indice : mystère."], warnings: ["Séance longue."],
      }],
    });
    const html = renderToStaticMarkup(createElement(Results, { result: data, ready: true, loading: false, error: "", repeat() {}, filmActions: () => "Actions film" }));
    for (const value of ["featured", "Cure", "Pépite", "Japon", "111 min", "Indice : mystère.", "Séance longue.", "Actions film", "Autres propositions"]) {
      expect(html).toContain(value);
    }
  });

  it.each([1, 2, 3, 4, 5])("rend une vedette et les secondaires pour %i film(s), même sans affiche", (count) => {
    const result = recommendationSchema.parse({
      connection: "cached", personalized: true, status: "ready",
      films: Array.from({ length: count }, (_, index) => ({
        id: index + 1, title: index === 0 ? "Cure" : "Tesis", year: 1997,
        category: index === 0 ? "safe" : "gem", metadata: {}, reasons: [], warnings: [],
      })),
    });
    const html = renderToStaticMarkup(createElement(Results, {
      result, ready: true, loading: false, error: "", repeat() {}, filmActions: () => null,
    }));
    expect(html.match(/class="featured"/g)).toHaveLength(1);
    expect(html.match(/class="film-card"/g)).toHaveLength(count);
    expect(html.match(/Affiche indisponible/g)).toHaveLength(count);
    expect(html.includes('class="alternatives"')).toBe(count > 1);
  });

  it("annonce chargement, erreurs, absence de résultat et mode dégradé", () => {
    const props = { ready: true, loading: true, error: "Requête refusée.", repeat() {}, filmActions: () => null };
    expect(renderToStaticMarkup(createElement(Results, props))).toContain('role="alert"');
    expect(renderToStaticMarkup(createElement(Results, props))).toContain("Recherche en cours");
    const result = recommendationSchema.parse({ connection: "offline", personalized: false, status: "exhausted", films: [] });
    const html = renderToStaticMarkup(createElement(Results, { ...props, loading: false, result }));
    for (const value of ["TMDB est inaccessible", "Propositions récentes épuisées", "Revoir des propositions récentes"]) {
      expect(html).toContain(value);
    }
  });

  it("rend les actions natives et annonce l’intention sélectionnée", () => {
    const html = renderToStaticMarkup(createElement(FilmActions, {
      movieId: 1, title: "Cure", entry: {
        movieId: 1, title: "Cure", year: 1997, intention: "watch_later", seenAt: null, score: null, appreciation: null,
      }, disabled: false, async save() {},
    }));
    expect(html).toContain('aria-label="Choix pour Cure"');
    expect(html).toContain('aria-pressed="true"');
    for (const label of ["Je lance ce film", "Pour ce soir", "Pas pour moi", "Déjà vu", "À voir un jour", "Dans ma liste"]) expect(html).toContain(label);
  });

  it("distingue une séance en attente d’un film à noter", () => {
    const common = { year: null, intention: "none", score: null, appreciation: null } as const;
    const film = { ...common, movieId: 1, title: "Cure", seenAt: null, selectedAt: "2026-11-23" };
    const reminder = renderToStaticMarkup(createElement(ViewingReminder, { film, disabled: false, async save() {}, dismiss() {} }));
    for (const label of ["Oui, je l’ai vu", "Pas encore", "Finalement, non"]) expect(reminder).toContain(label);
    const entries = [film, { ...common, movieId: 2, title: "Tesis", seenAt: "2026-11-23T10:00:00.000Z" }];
    const html = renderToStaticMarkup(createElement(FeedbackCollection, { entries, disabled: false, error: "", async save() {} }));
    expect(html).toMatch(/Films à noter.*Tesis.*Noter ce film.*Séances en attente.*Cure.*Film choisi/);
  });

  it("expose la navigation avec une page courante et des contrôles natifs", () => {
    const html = renderToStaticMarkup(createElement(AppShell, {
      page: "history", status: "Base locale prête", navigate() {}, children: "À venir",
    }));
    expect(html).toContain('aria-label="Navigation principale"');
    expect(html.match(/<button type="button"/g)).toHaveLength(5);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
