import { selectionSize } from "../shared/recommendation";

export const acquisitionPolicy = {
  discoveryRequests: 6,
  openingPages: 4,
  generalPages: 2,
  details: 18,
  firstDetails: 9,
  detailConcurrency: 3,
  pageSize: 20,
  pagesPerSource: 4,
  profilePageSize: 4,
  freshnessMs: 30 * 24 * 60 * 60 * 1000,
  poolTarget: 2 * selectionSize,
  minimumPositiveFilms: 2,
  minimumNetSupport: 1,
  maximumKeywordShare: 0.1,
  redundantKeywordOverlap: 0.75,
  genericKeywords: ["friend", "friends", "friendship", "love", "couple", "creature", "remake", "based on novel or book"],
} as const;

export type AcquisitionStrategy = "baseline" | "profile";
