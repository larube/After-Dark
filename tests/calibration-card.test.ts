import { expect, it } from "vitest";
import { formatCalibrationCard } from "../src/diagnostics/calibration-card";

it("affiche les crédits et des extraits sourcés sans révéler le bras", () => {
  const synopsis = "Une enquêtrice cherche un témoin dans une ville isolée.";
  const fullSynopsis = synopsis + " Elle apprend que son équipe connaît déjà le témoin.";
  const card = { title: "À l’écart", year: 1993, directors: ["Lina Castel"], countries: ["FR", "BE"],
    genres: ["Thriller"], minutes: 92, synopsis, fullSynopsis };
  const output = formatCalibrationCard(card, 2, 4, true);
  for (const value of ["2/4", "À l’écart (1993)", "Lina Castel", "Thriller", "France, Belgique", "92 min", synopsis, fullSynopsis,
    "https://www.allocine.fr/rechercher/movie/?q=%C3%80+l%E2%80%99%C3%A9cart"]) expect(output).toContain(value);
  expect(formatCalibrationCard(card, 2, 4)).not.toContain(fullSynopsis);
  expect(output).not.toMatch(/affinité|score|modèle|rang/i);
});

it("signale le manque d’informations sans déduire un pitch du genre ou du titre", () => {
  const output = formatCalibrationCard({ title: "Ignoré\u001b[2J", year: null, synopsis: undefined, fullSynopsis: undefined,
    minutes: undefined, countries: [], genres: ["Horreur"], directors: [] }, 1, 4);
  expect(output).toContain("Pitch indisponible");
  expect(output).toContain("Synopsis complet indisponible");
  expect(output).toContain("Durée        Non renseignée");
  expect(output).not.toContain("\u001b");
});
