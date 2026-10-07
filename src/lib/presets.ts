import { CriteriaSchema, type Criteria } from "./types";

const COMMON = {
  adults: 5,
  children: 0,
  currency: "TWD",
  availabilityVerifiedOnly: false,
  unknownRequiredPolicy: "review",
  sort: "best",
  reviews: { minRating10: 8, ratingLevel: "PREFERRED", minCount: 10, countLevel: "PREFERRED", establishedOnly: false },
  station: { maxWalkMinutes: 10, estimateFromDistance: true, level: "REQUIRED" },
} as const;

/** a) Kyoto, 5 nights, whole homes on Airbnb */
export const KYOTO_PRESET: Criteria = CriteriaSchema.parse({
  ...COMMON,
  name: "京都 2027/3/6–3/11 民宿・包棟・整間(Airbnb)",
  destination: "京都",
  checkIn: "2027-03-06",
  checkOut: "2027-03-11",
  rooms: 1,
  providers: ["airbnb"],
  budget: { min: 25000, max: 52500, basis: "total", level: "REQUIRED" },
  propertyTypes: ["Minshuku", "Guesthouse", "Machiya", "Entire House", "Townhouse", "Villa", "Vacation Home", "Apartment", "Serviced Apartment"],
  propertyTypeLevel: "REQUIRED",
  placeType: { entireOnly: true, privateRoomAllowed: false, sharedRoomAllowed: false, level: "REQUIRED" },
  bedrooms: { min: 2, max: 3, exact: null, level: "REQUIRED" },
  bathrooms: { min: 2, exact: null, minToilets: null, level: "REQUIRED" },
  // not in the brief: kept as soft preferences only (never reject)
  beds: { minWestern: null, types: [], westernOnly: false, coupleFriendly: false, level: "IGNORE" },
  sleeping: { couples: 2, allowTwoSinglesForCouple: true, coupleSeparateBedrooms: false, extraGuestBeds: ["single", "semi-double", "double", "queen", "king", "futon", "tatami", "sofa"], level: "PREFERRED" },
  bathtubs: { min: 1, requireVerified: false, level: "PREFERRED" },
  transit: {
    targets: ["Kyoto Station", "Toji", "Kujo", "Tofukuji", "Tambaguchi", "Umekoji-Kyotonishi", "Nijo", "Shichijo", "Shijo", "Karasuma", "Kawaramachi", "Gion-Shijo", "Sanjo", "Karasuma Oike", "Omiya"],
    maxMinutes: 15,
    mode: "any",
    level: "PREFERRED",
  },
});

/**
 * b) Osaka, hotels/ryokan only, two rooms: a 2-person room (1 double-size bed or 2 beds) and a
 * 3-person room (3 beds). 4 nights.
 */
export const OSAKA_PRESET: Criteria = CriteriaSchema.parse({
  ...COMMON,
  name: "大阪 2027/3/11–3/15 飯店・旅館(雙人房+三人房)",
  destination: "大阪",
  checkIn: "2027-03-11",
  checkOut: "2027-03-15",
  rooms: 2,
  roomPlan: [
    { guests: 2, minBeds: 2, coupleBedOk: true },
    { guests: 3, minBeds: 3, coupleBedOk: false },
  ],
  roomPlanLevel: "REQUIRED",
  providers: ["booking", "agoda", "trip"],
  budget: { min: 20000, max: 42000, basis: "total", level: "REQUIRED" },
  propertyTypes: ["Hotel", "Ryokan"],
  propertyTypeLevel: "REQUIRED",
  placeType: { entireOnly: false, privateRoomAllowed: true, sharedRoomAllowed: false, level: "IGNORE" },
  bedrooms: { min: null, max: null, exact: null, level: "IGNORE" },
  bathrooms: { min: null, exact: null, minToilets: null, level: "IGNORE" },
  beds: { minWestern: null, types: [], westernOnly: false, coupleFriendly: false, level: "IGNORE" },
  sleeping: { couples: 0, allowTwoSinglesForCouple: true, coupleSeparateBedrooms: false, extraGuestBeds: ["single", "semi-double", "double", "queen", "king"], level: "IGNORE" },
  bathtubs: { min: 1, requireVerified: false, level: "REQUIRED" },
  meals: { breakfast: "REQUIRED", dinner: "IGNORE" },
  station: { maxWalkMinutes: 7, estimateFromDistance: true, level: "REQUIRED" },
  transit: {
    targets: ["Namba", "Nipponbashi", "Shinsaibashi", "Umeda", "Osaka Station", "Shin-Osaka", "Honmachi", "Tennoji", "Kyobashi"],
    maxMinutes: 15,
    mode: "any",
    level: "PREFERRED",
  },
});

export const PRESETS: Criteria[] = [KYOTO_PRESET, OSAKA_PRESET];
