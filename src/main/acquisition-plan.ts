import { acquisitionPolicy as policy } from "../domain/acquisition-policy";
import type { AcquisitionProfile } from "../domain/acquisition-profile";
import type { Criteria } from "../shared/recommendation";
import { discoveryQueries } from "./tmdb";

export type AcquisitionQuery = {
  kind: "general" | "geography" | "director" | "keyword";
  parameters: Record<string, string>;
  limit?: number;
};

export function acquisitionPlan(criteria: Criteria, profile: AcquisitionProfile, round: number, year: number) {
  const editorial = criteria.selectionCategory === "classics" || criteria.selectionCategory === "gems";
  const general = (offset: number): AcquisitionQuery[] => discoveryQueries(criteria, offset, year)
    .map((parameters, index) => ({ kind: "general", parameters, ...(index === 3 ? { limit: 2 } : {}) }));
  const base = general(round);
  const alternate = general(round + 1);
  const regions = criteria.requiredCountries.length ? criteria.requiredCountries : criteria.preferredCountries;
  const languages = criteria.requiredLanguages.length ? criteria.requiredLanguages : criteria.preferredLanguages;
  const geography = (offset: number): AcquisitionQuery[] => {
    if (!regions.length && !languages.length) return [];
    return [{
      kind: "geography",
      parameters: {
        ...(editorial ? general(offset)[1] ?? general(offset)[0] : general(offset)[2]).parameters,
        ...(regions.length ? { with_origin_country: regions[offset % regions.length] } : {}),
        ...(languages.length ? { with_original_language: languages[Math.floor(offset / Math.max(1, regions.length)) % languages.length] } : {}),
      },
    }];
  };
  const regional = geography(round);
  const alternateProfile = regional.length > 0 && profile.directors.length > 0 && profile.keywords.length > 0;
  const profileRound = alternateProfile ? Math.floor(round / 2) : round;
  const targeted = (kind: "director" | "keyword", ids: number[]): AcquisitionQuery[] => ids.length ? [{
    kind,
    parameters: {
      // Reuse the category's documented acquisition constraints without a rotating decade.
      ...(editorial ? base[0] : base[1]).parameters,
      "primary_release_date.lte": criteria.selectionCategory === "classics"
        ? base[0].parameters["primary_release_date.lte"] : year + "-12-31",
      ...(criteria.selectionCategory !== "classics" ? { "primary_release_date.gte": "1900-01-01" } : {}),
      page: String(1 + Math.floor(profileRound / ids.length) % policy.pagesPerSource),
      [kind === "director" ? "with_crew" : "with_keywords"]: String(ids[profileRound % ids.length]),
    },
    limit: policy.profilePageSize,
  }] : [];
  const profileQueries = [...targeted("director", profile.directors), ...targeted("keyword", profile.keywords)];
  if (alternateProfile && round % 2) profileQueries.reverse();
  const first = [...base.slice(0, policy.generalPages), ...regional, ...profileQueries, ...base.slice(policy.generalPages)];
  const rescue = [...geography(round + 1), ...alternate.slice(1), ...alternate.slice(0, 1)];
  const seen = new Set<string>();
  const distinct = [...first, ...rescue].filter(({ parameters }) => {
    const key = JSON.stringify(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { initial: distinct.slice(0, Math.min(policy.openingPages, first.length)), reserve: distinct.slice(Math.min(policy.openingPages, first.length)) };
}
