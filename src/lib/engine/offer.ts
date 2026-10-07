import type { Criteria, Evidence, Offer, PriceInfo, ProviderId } from "../types";
import { unknownFact } from "../types";
import { nightsBetween, type Money } from "../parsing/text";

export function emptyPrice(nights: number): PriceInfo {
  return {
    currency: "TWD",
    originalCurrency: null,
    originalTotal: null,
    basePrice: null,
    tax: null,
    cleaningFee: null,
    serviceFee: null,
    otherFee: null,
    totalPrice: null,
    nights,
    pricePerNight: null,
    pricePerPerson: null,
    includesTaxes: null,
    completeness: "UNKNOWN",
    estimatedConversion: false,
    verifiedAt: null,
    confidence: "UNKNOWN",
    boundTo: null,
    evidence: [],
  };
}

export function createOffer(provider: ProviderId, id: string, url: string, name: string, c: Criteria): Offer {
  return {
    provider,
    providerPropertyId: id,
    url,
    name,
    address: null,
    latitude: null,
    longitude: null,
    phone: null,
    propertyType: null,
    entirePlace: unknownFact(),
    platformTypes: null,
    platformFeatures: [],
    areaM2: unknownFact(),
    roomName: null,
    units: [],
    maxGuests: unknownFact(),
    availability: { value: "UNKNOWN", confidence: "UNKNOWN", evidence: [] },
    availabilityEvidence: null,
    price: emptyPrice(nightsBetween(c.checkIn, c.checkOut)),
    cancellation: { freeCancellation: null, deadline: null, payLater: null, noPrepayment: null, refundable: null, text: null },
    breakfast: null,
    dinner: null,
    bedrooms: unknownFact(),
    beds: unknownFact(),
    rooms: [],
    bathrooms: unknownFact(),
    toilets: unknownFact(),
    bathtubs: unknownFact(),
    amenities: {},
    amenitiesParsed: false,
    station: unknownFact(),
    landmarks: [],
    centerDistanceM: null,
    transitHits: [],
    rating: unknownFact(),
    reviewCount: unknownFact(),
    trustSignals: [],
    checkInTime: null,
    checkOutTime: null,
    detailVerified: false,
    detailCheckedAt: null,
    fromCache: false,
    errors: [],
  };
}

function convert(m: Money | null | undefined, c: Criteria): { amount: number | null; estimated: boolean } {
  if (!m) return { amount: null, estimated: false };
  if (m.currency === c.currency) return { amount: m.amount, estimated: false };
  const rates = c.settings.exchangeRates;
  // rates are "1 unit of X = n TWD"; only TWD target conversions are configured
  if (c.currency === "TWD" && rates[m.currency]) return { amount: Math.round(m.amount * rates[m.currency]), estimated: true };
  return { amount: null, estimated: false };
}

export interface PriceInput {
  total?: Money | null;
  base?: Money | null;
  tax?: Money | null;
  cleaning?: Money | null;
  service?: Money | null;
  other?: Money | null;
  includesTaxes: boolean | null;
  fromDetail: boolean;
  evidence: Evidence[];
}

/** Build a price bound to dates/guests. Never invents fee components the page did not show. */
export function buildPrice(input: PriceInput, c: Criteria, checkedAt: string): PriceInfo {
  const nights = nightsBetween(c.checkIn, c.checkOut);
  const p = emptyPrice(nights);
  p.currency = c.currency;
  p.evidence = input.evidence;
  const base = convert(input.base, c);
  const tax = convert(input.tax, c);
  const cleaning = convert(input.cleaning, c);
  const service = convert(input.service, c);
  const other = convert(input.other, c);
  let total = convert(input.total, c);
  let includes = input.includesTaxes;

  if (total.amount == null && base.amount != null && tax.amount != null) {
    total = { amount: base.amount + tax.amount + (cleaning.amount ?? 0) + (service.amount ?? 0) + (other.amount ?? 0), estimated: base.estimated || tax.estimated };
    includes = true;
  }
  p.basePrice = base.amount;
  p.tax = tax.amount;
  p.cleaningFee = cleaning.amount;
  p.serviceFee = service.amount;
  p.otherFee = other.amount;
  p.totalPrice = total.amount;
  p.includesTaxes = includes;
  const src = input.total ?? input.base;
  if (src && src.currency !== c.currency) {
    p.originalCurrency = src.currency;
    p.originalTotal = input.total?.amount ?? (input.base && input.tax ? input.base.amount + input.tax.amount : null);
  }
  p.estimatedConversion = [total, base, tax].some((x) => x.estimated);
  if (p.totalPrice == null && p.basePrice != null) {
    // only a pre-tax room price is known: keep it as base, never invent the total
    p.pricePerNight = Math.round(p.basePrice / nights);
    p.completeness = "PARTIAL";
    p.includesTaxes = false;
    p.verifiedAt = checkedAt;
    p.confidence = "LIKELY";
    p.boundTo = { checkIn: c.checkIn, checkOut: c.checkOut, adults: c.adults, children: c.children, rooms: c.rooms };
  }
  if (p.totalPrice != null) {
    p.pricePerNight = Math.round(p.totalPrice / nights);
    p.pricePerPerson = Math.round(p.totalPrice / Math.max(1, c.adults + c.children));
    p.completeness = includes === true ? "FULL" : "PARTIAL";
    p.verifiedAt = checkedAt;
    p.confidence = input.fromDetail && includes === true ? "VERIFIED" : "LIKELY";
    p.boundTo = { checkIn: c.checkIn, checkOut: c.checkOut, adults: c.adults, children: c.children, rooms: c.rooms };
  }
  return p;
}
