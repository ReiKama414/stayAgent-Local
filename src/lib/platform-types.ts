import type { Criteria } from "./types";

/** Property-type filter codes read from each site's own filter UI (Booking `ht_id`, Agoda `hotelAccom`). */
const MAP: Record<string, { booking: number[]; agoda: number[] }> = {
  Hotel: { booking: [204], agoda: [34] },
  Ryokan: { booking: [209], agoda: [38] },
  Apartment: { booking: [201], agoda: [29] },
  "Serviced Apartment": { booking: [201], agoda: [120] },
  Villa: { booking: [213], agoda: [28] },
  "Entire House": { booking: [220], agoda: [131] },
  Townhouse: { booking: [220], agoda: [131] },
  Machiya: { booking: [220, 216], agoda: [131] },
  "Vacation Home": { booking: [220], agoda: [131] },
  Guesthouse: { booking: [216, 208], agoda: [32] },
  Minshuku: { booking: [216, 222], agoda: [32, 108] },
  Homestay: { booking: [222], agoda: [108] },
  Hostel: { booking: [203], agoda: [33] },
  Resort: { booking: [212], agoda: [] },
};

/** Only REQUIRED types narrow the platform search; every type is still re-checked on the page. */
export function platformTypeCodes(c: Criteria, site: "booking" | "agoda"): number[] {
  if (!c.propertyTypes.length || c.propertyTypeLevel !== "REQUIRED") return [];
  const codes = new Set<number>();
  for (const t of c.propertyTypes) for (const n of MAP[t]?.[site] ?? []) codes.add(n);
  // a type without a code on this site would be excluded by the filter -> do not filter at all
  if (c.propertyTypes.some((t) => !(MAP[t]?.[site] ?? []).length)) return [];
  return [...codes];
}
