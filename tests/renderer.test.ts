import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ipc } from "../src/shared/ipc";
import { recommendationSchema } from "../src/shared/recommendation";
import { MoodSelector, moodOrder } from "../src/renderer/controls";
import { readCriteria } from "../src/renderer/criteria";
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

  it("valide et sérialise les filtres de préférence et les contraintes séparément", () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      preferredCountries: "fr, FR", requiredCountries: "es", preferredLanguages: "EN, ja",
      requiredLanguages: "FR", duration: "110", energy: "low", avoid: "tension",
    })) form.set(key, value);
    const parsed = readCriteria(form, "laugh");
    expect(parsed).toMatchObject({ success: true, data: {
      mood: "laugh", preferredCountries: ["FR"], requiredCountries: ["ES"],
      preferredLanguages: ["en", "ja"], requiredLanguages: ["fr"], maxMinutes: 110, energy: "low", avoid: "tension",
    } });
    expect(ipc.recommend.request.safeParse([parsed.data, false]).success).toBe(true);
    form.set("requiredCountries", "Espagne");
    expect(readCriteria(form, "laugh").success).toBe(false);
    expect(readCriteria(new FormData(), "surprise")).toMatchObject({ success: true, data: {
      requiredCountries: [], requiredLanguages: [], maxMinutes: undefined,
    } });
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
