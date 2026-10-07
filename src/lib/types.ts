import { z } from "zod";

export const PROVIDERS = ["booking", "agoda", "airbnb", "trip"] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<ProviderId, string> = {
  booking: "Booking",
  agoda: "Agoda",
  airbnb: "Airbnb",
  trip: "Trip.com",
};

export const LEVELS = ["REQUIRED", "PREFERRED", "IGNORE"] as const;
export type Level = (typeof LEVELS)[number];
const level = z.enum(LEVELS);

export const PROPERTY_TYPES = [
  "Hotel",
  "Apartment",
  "Serviced Apartment",
  "Villa",
  "Entire House",
  "Townhouse",
  "Machiya",
  "Ryokan",
  "Guesthouse",
  "Hostel",
  "Resort",
  "Vacation Home",
  "Minshuku",
  "Homestay",
] as const;

export const BED_TYPES = [
  "single",
  "semi-double",
  "double",
  "queen",
  "king",
  "bunk",
  "sofa",
  "futon",
  "tatami",
  "unknown",
] as const;
export type BedType = (typeof BED_TYPES)[number];
export const WESTERN_BEDS: BedType[] = ["single", "semi-double", "double", "queen", "king"];
export const COUPLE_BEDS: BedType[] = ["double", "queen", "king"];

export const AMENITIES = [
  "wifi",
  "kitchen",
  "washer",
  "dryer",
  "balcony",
  "private_bath",
  "hot_tub",
  "onsen",
  "air_conditioning",
  "heating",
  "elevator",
  "parking",
  "luggage_storage",
  "front_desk_24h",
  "kitchenette",
  "refrigerator",
  "microwave",
  "cookware",
  "non_smoking",
  "self_checkin",
  "wheelchair",
  "accessible_bathroom",
  "ground_floor",
  "pets_allowed",
  "private_entrance",
  "separate_toilet",
  "japanese_room",
  "free_parking",
  "bidet",
] as const;
export type AmenityKey = (typeof AMENITIES)[number];
export const AMENITY_LABEL: Record<AmenityKey, string> = {
  wifi: "Wi-Fi",
  kitchen: "Kitchen",
  washer: "Washing Machine",
  dryer: "Dryer",
  balcony: "Balcony",
  private_bath: "Private Bath",
  hot_tub: "Hot Tub",
  onsen: "Onsen",
  air_conditioning: "Air Conditioning",
  heating: "Heating",
  elevator: "Elevator",
  parking: "Parking",
  luggage_storage: "Luggage Storage",
  front_desk_24h: "24h Front Desk",
  kitchenette: "Kitchenette",
  refrigerator: "Refrigerator",
  microwave: "Microwave",
  cookware: "Cookware",
  non_smoking: "Non-smoking",
  self_checkin: "Self check-in",
  wheelchair: "Wheelchair accessible",
  accessible_bathroom: "Accessible bathroom",
  ground_floor: "Ground floor unit",
  pets_allowed: "Pets allowed",
  private_entrance: "Private entrance",
  separate_toilet: "Separate toilet & bath",
  japanese_room: "Japanese-style room",
  free_parking: "Free parking",
  bidet: "Bidet toilet",
};

const num = z.number().nullable().default(null);

export const CriteriaSchema = z.object({
  name: z.string().default(""),
  destination: z.string().min(1),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(30),
  children: z.number().int().min(0).max(10).default(0),
  childrenAges: z.array(z.number().int().min(0).max(17)).default([]),
  rooms: z.number().int().min(1).max(10).default(1),
  currency: z.string().default("TWD"),
  providers: z.array(z.enum(PROVIDERS)).default(["booking", "agoda", "airbnb", "trip"]),

  budget: z
    .object({
      min: num,
      max: num,
      basis: z.enum(["total", "night", "person"]).default("total"),
      level: level.default("REQUIRED"),
    })
    .default({ min: null, max: null, basis: "total", level: "REQUIRED" }),

  propertyTypes: z.array(z.string()).default([]),
  propertyTypeLevel: level.default("REQUIRED"),
  area: z.object({ minM2: num, level: level.default("PREFERRED") }).default({ minM2: null, level: "PREFERRED" }),
  placeType: z
    .object({
      entireOnly: z.boolean().default(false),
      privateRoomAllowed: z.boolean().default(true),
      sharedRoomAllowed: z.boolean().default(false),
      level: level.default("PREFERRED"),
    })
    .default({ entireOnly: false, privateRoomAllowed: true, sharedRoomAllowed: false, level: "PREFERRED" }),

  bedrooms: z
    .object({ min: num, max: num, exact: num, level: level.default("REQUIRED") })
    .default({ min: null, max: null, exact: null, level: "REQUIRED" }),

  beds: z
    .object({
      minWestern: num,
      types: z.array(z.enum(BED_TYPES)).default([]),
      westernOnly: z.boolean().default(false),
      coupleFriendly: z.boolean().default(false),
      level: level.default("PREFERRED"),
    })
    .default({ minWestern: null, types: [], westernOnly: false, coupleFriendly: false, level: "PREFERRED" }),

  sleeping: z
    .object({
      couples: z.number().int().min(0).default(0),
      allowTwoSinglesForCouple: z.boolean().default(true),
      /** each couple sleeps in a different bedroom */
      coupleSeparateBedrooms: z.boolean().default(false),
      extraGuestBeds: z.array(z.enum(BED_TYPES)).default(["single", "semi-double", "double", "queen", "king", "futon", "tatami", "sofa"]),
      level: level.default("REQUIRED"),
    })
    .default({
      couples: 0,
      allowTwoSinglesForCouple: true,
      coupleSeparateBedrooms: false,
      extraGuestBeds: ["single", "semi-double", "double", "queen", "king", "futon", "tatami", "sofa"],
      level: "REQUIRED",
    }),

  /**
   * Optional per-room plan when several rooms are booked, e.g. [{guests:2,minBeds:2,coupleBedOk:true},{guests:3,minBeds:3}]:
   * a 2-person room with 1 double/queen/king or 2 beds, and a 3-person room with 3 beds.
   */
  roomPlan: z
    .array(z.object({ guests: z.number().int().min(1), minBeds: z.number().int().min(1), coupleBedOk: z.boolean().default(false) }))
    .default([]),
  roomPlanLevel: level.default("REQUIRED"),

  bathrooms: z
    .object({ min: num, exact: num, minToilets: num, level: level.default("REQUIRED") })
    .default({ min: null, exact: null, minToilets: null, level: "REQUIRED" }),

  bathtubs: z
    .object({ min: num, requireVerified: z.boolean().default(false), level: level.default("REQUIRED") })
    .default({ min: null, requireVerified: false, level: "REQUIRED" }),

  station: z
    .object({
      maxWalkMinutes: num,
      estimateFromDistance: z.boolean().default(false),
      level: level.default("REQUIRED"),
    })
    .default({ maxWalkMinutes: null, estimateFromDistance: false, level: "REQUIRED" }),

  transit: z
    .object({
      targets: z.array(z.string()).default([]),
      maxMinutes: num,
      mode: z.enum(["train", "subway", "bus", "any"]).default("any"),
      level: level.default("PREFERRED"),
    })
    .default({ targets: [], maxMinutes: null, mode: "any", level: "PREFERRED" }),

  distance: z
    .object({
      maxCenterKm: num,
      attractions: z.array(z.string()).default([]),
      maxAttractionKm: num,
      level: level.default("IGNORE"),
    })
    .default({ maxCenterKm: null, attractions: [], maxAttractionKm: null, level: "IGNORE" }),

  reviews: z
    .object({
      minRating10: num,
      ratingLevel: level.default("REQUIRED"),
      minCount: num,
      countLevel: level.default("PREFERRED"),
      establishedOnly: z.boolean().default(false),
    })
    .default({ minRating10: null, ratingLevel: "REQUIRED", minCount: null, countLevel: "PREFERRED", establishedOnly: false }),

  amenities: z
    .array(z.object({ key: z.enum(AMENITIES), level }))
    .default([]),

  cancellation: z
    .object({
      freeCancellation: level.default("IGNORE"),
      payLater: level.default("IGNORE"),
      noPrepayment: level.default("IGNORE"),
      refundable: level.default("IGNORE"),
    })
    .default({ freeCancellation: "IGNORE", payLater: "IGNORE", noPrepayment: "IGNORE", refundable: "IGNORE" }),

  meals: z
    .object({ breakfast: level.default("IGNORE"), dinner: level.default("IGNORE") })
    .default({ breakfast: "IGNORE", dinner: "IGNORE" }),

  checkInOut: z
    .object({
      earliestCheckIn: z.string().nullable().default(null),
      latestCheckIn: z.string().nullable().default(null),
      latestCheckOut: z.string().nullable().default(null),
      level: level.default("IGNORE"),
    })
    .default({ earliestCheckIn: null, latestCheckIn: null, latestCheckOut: null, level: "IGNORE" }),

  laundry: z
    .object({
      washer: level.default("IGNORE"),
      dryer: level.default("IGNORE"),
      privateOnly: z.boolean().default(false),
    })
    .default({ washer: "IGNORE", dryer: "IGNORE", privateOnly: false }),

  kitchen: z
    .object({
      required: level.default("IGNORE"),
      kitchenetteOk: z.boolean().default(true),
      cookware: level.default("IGNORE"),
    })
    .default({ required: "IGNORE", kitchenetteOk: true, cookware: "IGNORE" }),

  accessibility: z
    .object({
      elevator: level.default("IGNORE"),
      wheelchair: level.default("IGNORE"),
      groundFloor: level.default("IGNORE"),
      accessibleBathroom: level.default("IGNORE"),
    })
    .default({ elevator: "IGNORE", wheelchair: "IGNORE", groundFloor: "IGNORE", accessibleBathroom: "IGNORE" }),

  nonSmoking: level.default("IGNORE"),
  selfCheckIn: level.default("IGNORE"),
  luggageStorage: level.default("IGNORE"),

  availabilityVerifiedOnly: z.boolean().default(true),
  unknownRequiredPolicy: z.enum(["review", "reject"]).default("review"),

  weights: z
    .object({
      hard: z.number().default(30),
      price: z.number().default(20),
      location: z.number().default(15),
      beds: z.number().default(10),
      baths: z.number().default(10),
      rating: z.number().default(5),
      reviews: z.number().default(5),
      cancellation: z.number().default(5),
    })
    .default({ hard: 30, price: 20, location: 15, beds: 10, baths: 10, rating: 5, reviews: 5, cancellation: 5 }),

  settings: z
    .object({
      headless: z.boolean().default(false),
      mode: z.enum(["FAST", "BALANCED", "DEEP"]).default("BALANCED"),
      concurrency: z.number().int().min(1).max(4).default(2),
      forceRefresh: z.boolean().default(false),
      exchangeRates: z.record(z.string(), z.number()).default({ JPY: 0.21, USD: 32.5, EUR: 35, HKD: 4.15, CNY: 4.5 }),
      screenshots: z.boolean().default(true),
    })
    .default({
      headless: false,
      mode: "BALANCED",
      concurrency: 2,
      forceRefresh: false,
      exchangeRates: { JPY: 0.21, USD: 32.5, EUR: 35, HKD: 4.15, CNY: 4.5 },
      screenshots: true,
    }),

  sort: z.string().default("best"),
});
export type Criteria = z.infer<typeof CriteriaSchema>;

// ---------- Evidence / facts ----------
export type Confidence = "VERIFIED" | "LIKELY" | "UNKNOWN" | "CONFLICT";
export type EvidenceSource =
  | "search_card"
  | "room_detail"
  | "property_detail"
  | "facility"
  | "description"
  | "structured_data"
  | "accessible_metadata"
  | "booking_panel"
  | "surroundings"
  | "reviews"
  | "derived";

export interface Evidence {
  field: string;
  provider: ProviderId;
  source: EvidenceSource;
  rawText: string;
  parsed?: string;
  url: string;
  checkedAt: string;
  confidence: "high" | "medium" | "low";
}

export interface Fact<T> {
  value: T | null;
  confidence: Confidence;
  evidence: Evidence[];
  /** for counts: "exact" vs proven lower bound */
  qualifier?: "exact" | "atLeast";
  note?: string;
}

export const unknownFact = <T>(note?: string): Fact<T> => ({ value: null, confidence: "UNKNOWN", evidence: [], note });

export interface Bed {
  type: BedType;
  count: number;
  raw: string;
}
export interface RoomLayout {
  name: string;
  beds: Bed[];
}

export type AvailabilityStatus = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
export interface AvailabilityEvidence {
  provider: ProviderId;
  checkedAt: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  status: AvailabilityStatus;
  evidence: string;
  url: string;
}

export type PriceCompleteness = "FULL" | "PARTIAL" | "UNKNOWN";
export interface PriceInfo {
  currency: string; // display currency (TWD)
  originalCurrency: string | null;
  originalTotal: number | null;
  basePrice: number | null;
  tax: number | null;
  cleaningFee: number | null;
  serviceFee: number | null;
  otherFee: number | null;
  totalPrice: number | null;
  nights: number;
  pricePerNight: number | null;
  pricePerPerson: number | null;
  includesTaxes: boolean | null;
  completeness: PriceCompleteness;
  estimatedConversion: boolean; // ESTIMATED_TWD
  verifiedAt: string | null;
  confidence: Confidence;
  boundTo: { checkIn: string; checkOut: string; adults: number; children: number; rooms: number } | null;
  evidence: Evidence[];
}

export interface Cancellation {
  freeCancellation: boolean | null;
  deadline: string | null;
  payLater: boolean | null;
  noPrepayment: boolean | null;
  refundable: boolean | null;
  text: string | null;
}

export interface Station {
  name: string;
  walkMinutes: number | null;
  distanceM: number | null;
  estimated: boolean;
}

export interface Rating {
  raw: number;
  scale: number;
  normalized: number; // 0-10
}

export interface Offer {
  provider: ProviderId;
  providerPropertyId: string;
  url: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  propertyType: string | null;
  entirePlace: Fact<boolean>;
  /** property types the platform's own type filter restricted the search to */
  platformTypes: string[] | null;
  /** features guaranteed by the site's own search filter (e.g. "bathtub", "breakfast") */
  platformFeatures: string[];
  areaM2: Fact<number>;
  roomName: string | null;
  /** booked units (rooms > 1 may combine several room types) */
  units: { name: string; count: number; maxPeople: number | null; price: number | null; beds?: Bed[] | null }[];
  maxGuests: Fact<number>;
  availability: Fact<AvailabilityStatus>;
  availabilityEvidence: AvailabilityEvidence | null;
  price: PriceInfo;
  cancellation: Cancellation;
  breakfast: boolean | null;
  dinner: boolean | null;
  bedrooms: Fact<number>;
  beds: Fact<Bed[]>;
  rooms: RoomLayout[];
  bathrooms: Fact<number>;
  toilets: Fact<number>;
  bathtubs: Fact<number>;
  amenities: Partial<Record<AmenityKey, Fact<boolean>>>;
  amenitiesParsed: boolean;
  station: Fact<Station>;
  landmarks: { name: string; distanceM: number; raw: string }[];
  centerDistanceM: number | null;
  transitHits: { target: string; minutes: number; mode: string; raw: string }[];
  rating: Fact<Rating>;
  reviewCount: Fact<number>;
  trustSignals: { label: string; weight: number }[];
  checkInTime: string | null;
  checkOutTime: string | null;
  detailVerified: boolean;
  detailCheckedAt: string | null;
  fromCache: boolean;
  errors: string[];
}

/** WARN = passes, but the evidence is indirect (shown yellow) */
export type FilterStatus = "PASS" | "WARN" | "FAIL" | "UNKNOWN";
export interface FilterResult {
  id: string;
  label: string;
  level: Level;
  status: FilterStatus;
  text: string;
}

export interface Trust {
  level: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  reasons: string[];
}

export interface SleepingResult {
  supported: boolean | null;
  westernSlots: number;
  explanation: string[];
}

export type ResultStatus = "MATCHED" | "REVIEW" | "REJECTED";
export interface PropertyResult {
  id: string;
  name: string;
  normalizedName: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string | null;
  offers: Offer[];
  primary: number; // index into offers
  status: ResultStatus;
  stage: "cheap" | "detail";
  filters: FilterResult[];
  matchCount: number;
  matchTotal: number;
  score: number;
  scoreBreakdown: Record<string, number>;
  trust: Trust;
  sleeping: SleepingResult;
  rejectReasons: string[];
}

export type ProviderState = "PENDING" | "RUNNING" | "WAITING" | "DONE" | "PARTIAL" | "FAILED" | "SKIPPED" | "STOPPED";

export interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "success";
  provider?: ProviderId;
  msg: string;
}

export type JobStatus = "RUNNING" | "PAUSED" | "WAITING_FOR_USER" | "STOPPING" | "STOPPED" | "COMPLETED" | "FAILED";

export interface JobStats {
  searched: number;
  available: number;
  detailVerified: number;
  matched: number;
  review: number;
  rejected: number;
  rejectedBy: Record<string, number>;
}

export interface JobSnapshot {
  id: string;
  searchId: string;
  status: JobStatus;
  waitingReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  providers: Record<ProviderId, { state: ProviderState; found: number; detailed: number; error?: string }>;
  currentProvider: ProviderId | null;
  currentUrl: string | null;
  stage: string;
  progress: { current: number; total: number } | null;
  screenshot: string | null;
  logs: LogEntry[];
  stats: JobStats;
  results: PropertyResult[];
  criteria: Criteria;
}
