import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ipc } from "../src/shared/ipc";
import { recommendationSchema } from "../src/shared/recommendation";
import { FilterPanel, MoodSelector, moodOrder } from "../src/renderer/controls";
import { defaultFilters, durations, readCriteria } from "../src/renderer/criteria";
import { FilmActions } from "../src/renderer/feedback";
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
    expect(html).toContain(`value="${minutes}">${label}`);
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

  it("intègre France et Espagne à la sélection unique et affiche le résumé des critères", () => {
    const html = renderToStaticMarkup(createElement(FilterPanel, {
      value: { ...defaultFilters, countries: ["FR", "ES"], countriesRequired: true }, busy: false, onChange() {},
    }));
    expect(html).toContain("1 critère actif");
    expect(html).toContain("Pays obligatoires · France, Espagne");
    expect(html.match(/<input[^>]+checked=""\/>/g)).toHaveLength(3);
    expect(html.match(/>France<\/label>/g)).toHaveLength(1);
    expect(html.match(/>Espagne<\/label>/g)).toHaveLength(1);
    expect(html).toContain("Réinitialiser les critères");
    expect(html).not.toContain("Énergie disponible");
  });

  it("indique que choisir l’Argentine comme préférence laisse les autres pays possibles", () => {
    const html = renderToStaticMarkup(createElement(FilterPanel, {
      value: { ...defaultFilters, countries: ["AR"] }, busy: false, onChange() {},
    }));
    expect(html).toContain("Pays préférés · Argentine");
    expect(html).toContain("Uniquement les pays sélectionnés");
    expect(html).toContain("D’autres pays restent possibles.");
    expect(readCriteria({ ...defaultFilters, countries: ["AR"] }, "laugh").data).toMatchObject({
      preferredCountries: ["AR"], requiredCountries: [],
    });
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
    expect(html).toContain('aria-label="Actions pour Cure · À voir un jour"');
    expect(html).toContain('aria-pressed="true">À voir un jour');
    for (const label of ["Pour ce soir", "Pas intéressé", "Déjà vu", "Retirer l’intention"]) expect(html).toContain(label);
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
