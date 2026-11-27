import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ipc } from "../src/shared/ipc";
import { recommendationSchema } from "../src/shared/recommendation";
import { CategorySelector, FilterPanel, selectionCategoryOrder } from "../src/renderer/controls";
import { defaultFilters, durations, readCriteria } from "../src/renderer/criteria";
import { FeedbackCollection, FilmActions, ViewingReminder } from "../src/renderer/feedback";
import { Discovery } from "../src/renderer/discovery";
import { Results } from "../src/renderer/results";
import { Tonight } from "../src/renderer/tonight";
import { AppShell } from "../src/renderer/shell";

describe("Interface Neon Underground", () => {
  it("préserve les huit radios natives et leur sélection", () => {
    const html = renderToStaticMarkup(createElement(CategorySelector, { value: "horror", onChange() {}, busy: false }));
    for (const category of selectionCategoryOrder) expect(html).toContain(`value="${category}"`);
    expect(html.match(/type="radio"/g)).toHaveLength(8);
    expect(html).toMatch(/checked="" value="horror"/);
  });

  it("ouvre la Sélection avec un seul bouton principal et les filtres repliés", () => {
    const html = renderToStaticMarkup(createElement(Tonight, { ready: true, onComplete() {}, filmActions: () => null }));
    expect(html).toContain("<h1>Sélection</h1>");
    expect(html).toMatch(/<header class="hero">.*Votre séance personnelle.*<h1>Sélection<\/h1>/);
    expect(html).toMatch(/checked="" value="personal"\/><span>Pour moi<\/span>/);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toMatch(/<fieldset class="mood-fieldset".*<\/fieldset><button[^>]*type="submit"[^>]*>.*Découvrir 10 films.*<details class="selection-refine"><summary>Affiner/);
    const shell = renderToStaticMarkup(createElement(AppShell, {
      page: "tonight", status: "Base locale prête", navigate() {}, children: null,
    }));
    expect(shell).toMatch(/aria-current="page"[^>]*>.*?Sélection<\/button>/);
    expect(shell).toMatch(/class="nav-icon" aria-hidden="true"><svg[^>]+focusable="false"[^>]*>.*?<\/svg><\/span>Sélection/);
    expect(shell).not.toMatch(/Découvertes|Ce soir/);
  });

  it("conserve l’affiche, son alternative et les états de recherche dans une sélection incomplète", () => {
    const result = recommendationSchema.parse({
      connection: "cached", personalized: true, status: "ready",
      films: [
        { id: 1, title: "La vedette", year: 1997, category: "safe", metadata: {}, reasons: [], warnings: [] },
        { id: 2, title: "Une alternative au titre très long", year: null, category: "gem", metadata: {}, reasons: [], warnings: [] },
      ],
    });
    const html = renderToStaticMarkup(createElement(Results, {
      category: "thriller", result, posters: { 1: "data:image/jpeg;base64,AA==" }, ready: true,
      loading: true, error: "Impossible de charger les propositions.", repeat() {}, filmActions: () => null,
    }));
    expect(html).toMatch(/class="featured".*<img class="poster" src="data:image\/jpeg;base64,AA==" alt=""\/?>/);
    expect(html).toMatch(/aria-label="Propositions suivantes".*Affiche indisponible.*Une alternative au titre très long/);
    expect(html).toContain("2 sur 10 proposés");
    expect(html).toContain('role="alert">Impossible de charger les propositions.');
    expect(html).toContain('role="status" class="live-status">Recherche en cours…');
  });

  it("expose les trois modes de découverte en radios natives et masque l’onglet inactif", () => {
    const props = { active: true, disabled: false, actions: () => null };
    const html = renderToStaticMarkup(createElement(Discovery, props));
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/checked="" value="gems"/);
    for (const label of ["Les pépites", "Vos affinités", "Hors piste"]) expect(html).toContain(label);
    const hidden = renderToStaticMarkup(createElement(Discovery, { ...props, active: false }));
    expect(hidden).toMatch(/^<section hidden=""/);
  });

  it.each(durations)("convertit la durée %i vers un plafond en minutes", (minutes, label) => {
    const html = renderToStaticMarkup(createElement(FilterPanel, { value: defaultFilters, busy: false, onChange() {} }));
    expect(html).toMatch(new RegExp(`type="radio"[^>]*value="${minutes}"[^>]*>[^<]*${label}`));
    expect(readCriteria({ ...defaultFilters, duration: String(minutes) }, "comedy").data?.maxMinutes).toBe(minutes);
  });

  it("laisse la séance sans restriction par défaut et ne transmet pas d’énergie", () => {
    expect(readCriteria(defaultFilters, "personal").data).toEqual({
      mood: "surprise", selectionCategory: "personal", maxMinutes: undefined, avoid: undefined,
      preferredCountries: [], requiredCountries: [], preferredLanguages: [], requiredLanguages: [],
    });
    expect(readCriteria({ ...defaultFilters, duration: "110" }, "personal").success).toBe(false);
  });

  it("sérialise plusieurs pays et langues dans leurs champs respectifs et garde les choix entre recherches", () => {
    const selection = { ...defaultFilters, countries: ["FR", "ES"], languages: ["en", "ja"], duration: "120", avoid: "tension" };
    const preferred = readCriteria(selection, "comedy");
    expect(preferred.data).toMatchObject({
      preferredCountries: ["FR", "ES"], requiredCountries: [],
      preferredLanguages: ["en", "ja"], requiredLanguages: [], maxMinutes: 120, avoid: "tension",
    });
    const required = readCriteria({ ...selection, countriesRequired: true, languagesRequired: true }, "comedy");
    expect(required.data).toMatchObject({
      preferredCountries: [], requiredCountries: ["FR", "ES"],
      preferredLanguages: [], requiredLanguages: ["en", "ja"],
    });
    expect(ipc.recommend.request.safeParse([required.data, false]).success).toBe(true);
    expect(readCriteria(selection, "comedy").data).toEqual(preferred.data);
  });

  it("rend les filtres multiples et les puces amovibles", () => {
    const html = renderToStaticMarkup(createElement(FilterPanel, {
      value: { ...defaultFilters, countries: ["FR", "ES"], countriesRequired: true, languages: ["ja", "es"] },
      busy: false, onChange() {},
    }));
    for (const name of ["France", "Espagne", "Japonais", "Espagnol"]) {
      expect(html).toContain(`aria-label="Retirer ${name}"`);
    }
    expect(html.match(/<input[^>]+type="checkbox"[^>]*checked=""[^>]*\/>/g)).toHaveLength(5);
    expect(html).not.toContain('type="submit"');
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
    for (const value of ["featured", "Cure", "Japon", "111 min", "Indice : mystère.", "Séance longue.", "Actions film", "Autres propositions", "Pas ce soir · Cure"]) {
      expect(html).toContain(value);
    }
    expect(html).not.toMatch(/Valeur sûre|Pépite|Wildcard|data-category/);
  });

  it("présente des explications fondées sur la fiche ou les raisons calculées", () => {
    const result = recommendationSchema.parse({
      connection: "cached", personalized: true, status: "ready",
      films: [
        { id: 1, title: "Signaux", year: null, category: "safe", metadata: {},
          reasons: ["Traits associés à vos appréciations positives : amitié."], warnings: [] },
        { id: 2, title: "Données contradictoires", year: null, category: "gem",
          metadata: { release: { source: "TMDB", keywords: [{ name: "psychological horror" }] } },
          reasons: ["Traits associés à vos appréciations positives : amitié."],
          warnings: ["Traits associés aussi à des appréciations négatives : Horreur."] },
        { id: 3, title: "Sans métadonnées", year: null, category: "wildcard", metadata: {}, reasons: [], warnings: [] },
      ],
    });
    const html = renderToStaticMarkup(createElement(Results, {
      result, ready: true, loading: false, error: "", repeat() {}, filmActions: () => null,
    }));
    const cards = html.match(/<article[\s\S]+?<\/article>/g)!;
    expect(cards[0]).toContain('class="film-reason">Des éléments associés à des films que tu as appréciés');
    expect(cards[1]).toContain('class="film-reason">Horreur psychologique');
    expect(cards[1]).not.toContain("Des éléments associés à des films que tu as appréciés");
    expect(cards[2]).not.toContain("film-reason");
    expect(html).not.toContain("%");
  });

  it("affiche les avertissements décisifs avant les actions et conserve le détail dans Informations", () => {
    const warnings = [
      "Traits associés aussi à des appréciations négatives : Horreur.",
      "Moins prioritaire : indices de l’ambiance que vous préférez éviter (horreur).",
      "Séance longue pour une soirée à faible énergie.",
      "Les métadonnées donnent peu d’indices sur le mood demandé.",
      "Autre avertissement du moteur.",
    ];
    const result = recommendationSchema.parse({
      connection: "cached", personalized: true, status: "ready",
      films: [{ id: 1, title: "Cure", year: 1997, category: "safe", metadata: { genres: ["Thriller"] },
        reasons: ["Traits associés à vos appréciations positives : Mystère."], warnings }],
    });
    const html = renderToStaticMarkup(createElement(Results, {
      result, ready: true, loading: false, error: "", repeat() {}, filmActions: () => "Actions film",
    }));
    const card = html.slice(0, html.indexOf("<details"));
    expect(card).toMatch(/Thriller.*À garder en tête.*ambiance que tu souhaites éviter.*appréciations négatives.*faible énergie.*ambiance demandée.*Actions film/);
    expect(card).not.toContain("des films que tu as appréciés");
    expect(card).not.toContain(warnings[4]);
    const details = html.slice(html.indexOf("<details"));
    for (const warning of warnings) expect(details).toContain(warning);
  });

  it("rend les intentions existantes lisibles dans Sélection et garde leurs états accessibles", () => {
    const html = renderToStaticMarkup(createElement(FilmActions, {
      selection: true, title: "Cure", movieId: 1, disabled: true,
      entry: { movieId: 1, title: "Cure", year: 1997, intention: "tonight", seenAt: null, score: null, appreciation: null }, save: async () => {},
    }));
    for (const label of ["Envie de voir", "Peut-être ce soir", "Pas pour moi", "Déjà vu", "Envisagé pour ce soir"]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/<button[^>]+disabled=""[^>]+aria-pressed="true"[^>]*>.*?Peut-être ce soir/);
    expect(html).not.toContain("À voir un jour");
  });

  it.each([false, true])("place les actions avant les détails avec ou sans franchise (%s)", (withFranchise) => {
    const film = { id: 1, title: "Cure", year: 1997, category: "safe", metadata: { synopsis: "Le synopsis.", minutes: 111 },
      reasons: ["Premier indice.", "Deuxième indice."], warnings: [] };
    const result = recommendationSchema.parse({ connection: "cached", personalized: true, status: "ready", films: [
      { ...film, ...(withFranchise ? { franchise: { key: "collection:123", name: "Une saga" } } : {}) },
      { ...film, id: 2, title: "Tesis" },
    ] });
    const html = renderToStaticMarkup(createElement(Results, {
      result, ready: true, loading: false, error: "", repeat() {},
      filmActions: () => createElement("button", { type: "button" }, "Pas pour moi"),
    }));
    const cards = html.match(/<article[\s\S]+?<\/article>/g)!;
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toMatch(/Pas pour moi.*Pas ce soir.*Informations.*Le synopsis.*Premier indice.*Deuxième indice/);
      expect(card).not.toMatch(/<details[^>]* open|Aucune franchise|Pays inconnu/);
    }
    expect(cards[0].includes("Franchise · Une saga")).toBe(withFranchise);
    expect(cards[0].includes("Vérifier la saga sur TMDB")).toBe(!withFranchise);
    expect(cards[1]).toMatch(/<details class="film-details">.*Vérifier la saga sur TMDB.*<\/details>/);
    expect(cards[1]).not.toContain("Impossible de vérifier");
    expect(cards[1]).not.toContain("Franchise");
    if (withFranchise) expect(cards[0]).toMatch(/Pas ce soir.*Franchise · Une saga/);
  });

  it.each([1, 2, 3, 4, 5, 10])("rend une vedette et les secondaires pour %i film(s), même sans affiche", (count) => {
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

  it("annonce une catégorie sans candidats et une sélection incomplète", () => {
    const common = { connection: "cached", personalized: true };
    const props = { category: "horror" as const, ready: true, loading: false, error: "", repeat() {}, filmActions: () => null };
    const empty = recommendationSchema.parse({ ...common, status: "no-match", films: [] });
    expect(renderToStaticMarkup(createElement(Results, { ...props, result: empty }))).toContain("Aucun film admissible pour « Horreur »");
    const partial = recommendationSchema.parse({ ...common, status: "ready", films: [{
      id: 1, title: "Cure", year: 1997, category: "safe", metadata: {}, reasons: [], warnings: [],
    }] });
    expect(renderToStaticMarkup(createElement(Results, { ...props, result: partial }))).toContain("sur 10 proposés pour « Horreur »");
  });

  it("rend les actions natives et annonce l’intention sélectionnée", () => {
    const html = renderToStaticMarkup(createElement(FilmActions, {
      movieId: 1, title: "Cure", entry: {
        movieId: 1, title: "Cure", year: 1997, intention: "watch_later", seenAt: null, score: null, appreciation: null,
      }, disabled: false, async save() {},
    }));
    expect(html).toContain('aria-label="Choix pour Cure"');
    expect(html).not.toContain("Pas ce soir");
    expect(html).toContain('aria-pressed="true"');
    for (const label of ["Je lance ce film", "Pour ce soir", "Pas pour moi", "Déjà vu", "À voir un jour", "Dans ma liste"]) expect(html).toContain(label);
  });

  it("distingue une séance en attente d’un film à noter", () => {
    const common = { year: null, intention: "none", score: null, appreciation: null } as const;
    const film = { ...common, movieId: 1, title: "Cure", seenAt: null, selectedAt: "2026-11-23" };
    const reminder = renderToStaticMarkup(createElement(ViewingReminder, { film, disabled: false, async save() {}, dismiss() {} }));
    for (const label of ["Oui, je l’ai vu", "Pas encore", "Finalement, non"]) expect(reminder).toContain(label);
    const entries = [film, { ...common, movieId: 2, title: "Tesis", seenAt: "2026-11-23T10:00:00.000Z", appreciation: "À revoir." }];
    const html = renderToStaticMarkup(createElement(FeedbackCollection, { entries, disabled: false, error: "", async save() {} }));
    expect(html).toMatch(/Films à noter.*Tesis.*À revoir.*Modifier mon retour.*Séances en attente.*Cure.*Film choisi/);
  });

  it("expose la navigation avec une page courante et des contrôles natifs", () => {
    const html = renderToStaticMarkup(createElement(AppShell, {
      page: "history", status: "Base locale prête", navigate() {}, children: "À venir",
    }));
    expect(html).toContain('aria-label="Navigation principale"');
    expect(html.match(/<button type="button"/g)).toHaveLength(5);
    expect(html).toContain("Laboratoire");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
