"use client";
import { AMENITIES, AMENITY_LABEL, BED_TYPES, PROPERTY_TYPES, type AmenityKey, type BedType, type Criteria, type Level } from "@/lib/types";
import { Check, LevelSelect, NumInput, Row, Section } from "./ui";
import { useT } from "@/lib/i18n";

type Upd = (fn: (c: Criteria) => void) => void;

const BED_LABEL: Record<BedType, string> = {
  single: "Single",
  "semi-double": "Semi-double",
  double: "Double",
  queen: "Queen",
  king: "King",
  bunk: "Bunk Bed",
  sofa: "Sofa Bed",
  futon: "Futon",
  tatami: "Tatami/Futon",
  unknown: "Unknown",
};

const AMENITY_FILTERS: AmenityKey[] = AMENITIES.filter((a) => !["non_smoking", "self_checkin", "wheelchair", "accessible_bathroom", "ground_floor", "cookware"].includes(a));

function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <textarea
      className="input h-16 py-1.5"
      placeholder={placeholder}
      value={value.join(", ")}
      onChange={(e) =>
        onChange(
          e.target.value
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
        )
      }
    />
  );
}

export default function FilterPanel({ c, upd }: { c: Criteria; upd: Upd }) {
  const t = useT();
  const amenityLevel = (k: AmenityKey): Level => c.amenities.find((a) => a.key === k)?.level ?? "IGNORE";
  const setAmenity = (k: AmenityKey, l: Level) =>
    upd((d) => {
      d.amenities = d.amenities.filter((a) => a.key !== k);
      if (l !== "IGNORE") d.amenities.push({ key: k, level: l });
    });
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="card px-4 py-1 text-sm">
      <Section title={t("Budget")}>
        <Row label={t("Total price range")} level={c.budget.level} onLevel={(l) => upd((d) => void (d.budget.level = l))}>
          <div className="flex items-center gap-2">
            <NumInput value={c.budget.min} onChange={(v) => upd((d) => void (d.budget.min = v))} placeholder="Min" />
            <span className="text-stone-400">–</span>
            <NumInput value={c.budget.max} onChange={(v) => upd((d) => void (d.budget.max = v))} placeholder="Max" />
          </div>
        </Row>
        <div className="flex gap-1 text-xs">
          {(["total", "night", "person"] as const).map((b) => (
            <button key={b} type="button" onClick={() => upd((d) => void (d.budget.basis = b))} className={`rounded border px-2 py-1 ${c.budget.basis === b ? "border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-700/30 dark:text-accent-100" : "border-stone-300 dark:border-stone-700"}`}>
              {t(b === "total" ? "Total stay" : b === "night" ? "Per night" : "Per person")}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("Property type")} defaultOpen={c.propertyTypes.length > 0} badge={c.propertyTypes.length ? <span className="chip bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300">{c.propertyTypes.length}</span> : null}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-stone-500">{t("Only these types")}</span>
          <LevelSelect value={c.propertyTypeLevel} onChange={(l) => upd((d) => void (d.propertyTypeLevel = l))} />
        </div>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {(
            [
              ["Homes / whole house", ["Minshuku", "Guesthouse", "Machiya", "Entire House", "Townhouse", "Villa", "Vacation Home", "Apartment", "Serviced Apartment"]],
              ["Hotels / ryokan", ["Hotel", "Ryokan"]],
              ["Apartments", ["Apartment", "Serviced Apartment"]],
            ] as const
          ).map(([label, list]) => (
            <button key={label} type="button" className="rounded border border-stone-300 px-1.5 py-0.5 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800" onClick={() => upd((d) => void (d.propertyTypes = [...list]))}>
              {t(label)}
            </button>
          ))}
          <button type="button" className="rounded px-1.5 py-0.5 text-stone-500 underline" onClick={() => upd((d) => void (d.propertyTypes = []))}>
            {t("any")}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {PROPERTY_TYPES.map((pt) => (
            <Check key={pt} checked={c.propertyTypes.includes(pt)} onChange={() => upd((d) => void (d.propertyTypes = toggle(d.propertyTypes, pt)))} label={t(pt)} />
          ))}
        </div>
        <Row label={t("Place type")} level={c.placeType.level} onLevel={(l) => upd((d) => void (d.placeType.level = l))}>
          <div className="space-y-1">
            <Check checked={c.placeType.entireOnly} onChange={(v) => upd((d) => void (d.placeType.entireOnly = v))} label={t("Entire place only")} />
            <Check checked={c.placeType.privateRoomAllowed} onChange={(v) => upd((d) => void (d.placeType.privateRoomAllowed = v))} label={t("Private room allowed")} />
            <Check checked={c.placeType.sharedRoomAllowed} onChange={(v) => upd((d) => void (d.placeType.sharedRoomAllowed = v))} label={t("Shared room allowed")} />
          </div>
        </Row>
        <Row label={t("Min floor area (m²)")} level={c.area.level} onLevel={(l) => upd((d) => void (d.area.level = l))}>
          <NumInput value={c.area.minM2} onChange={(v) => upd((d) => void (d.area.minM2 = v))} />
        </Row>
      </Section>

      <Section title={t("Bedrooms & beds")}>
        <Row label={t("Bedrooms (min / exact)")} level={c.bedrooms.level} onLevel={(l) => upd((d) => void (d.bedrooms.level = l))}>
          <div className="flex gap-2">
            <select className="input" value={c.bedrooms.min ?? ""} onChange={(e) => upd((d) => void (d.bedrooms.min = e.target.value ? Number(e.target.value) : null))}>
              <option value="">{t("Min any")}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  ≥ {n}
                  {n === 5 ? "+" : ""}
                </option>
              ))}
            </select>
            <NumInput value={c.bedrooms.max} onChange={(v) => upd((d) => void (d.bedrooms.max = v))} placeholder={t("Max bedrooms")} />
            <NumInput value={c.bedrooms.exact} onChange={(v) => upd((d) => void (d.bedrooms.exact = v))} placeholder="Exact" />
          </div>
        </Row>
        <Row label={t("Min western beds")} level={c.beds.level} onLevel={(l) => upd((d) => void (d.beds.level = l))}>
          <NumInput value={c.beds.minWestern} onChange={(v) => upd((d) => void (d.beds.minWestern = v))} />
        </Row>
        <div>
          <span className="label">{t("Bed types (must include one of)")}</span>
          <div className="grid grid-cols-2 gap-1.5">
            {BED_TYPES.filter((b) => b !== "unknown").map((b) => (
              <Check key={b} checked={c.beds.types.includes(b)} onChange={() => upd((d) => void (d.beds.types = toggle(d.beds.types, b)))} label={t(BED_LABEL[b])} />
            ))}
          </div>
        </div>
        <Check checked={c.beds.westernOnly} onChange={(v) => upd((d) => void (d.beds.westernOnly = v))} label={t("Western beds only")} />
        <Check checked={c.beds.coupleFriendly} onChange={(v) => upd((d) => void (d.beds.coupleFriendly = v))} label={t("Couple-friendly beds")} />
      </Section>

      <Section title={t("Rooms to book")} defaultOpen={c.roomPlan.length > 0} badge={c.roomPlan.length ? <span className="chip bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300">{c.roomPlan.length}</span> : null}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-stone-500">{t("Room plan")}</span>
          <LevelSelect value={c.roomPlanLevel} onChange={(l) => upd((d) => void (d.roomPlanLevel = l))} />
        </div>
        {c.roomPlan.map((r, i) => (
          <div key={i} className="rounded border border-stone-200 p-2 dark:border-stone-700">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <span className="label">{t("guests in this room")}</span>
                <NumInput value={r.guests} min={1} onChange={(v) => upd((d) => void (d.roomPlan[i].guests = Math.max(1, v ?? 1)))} />
              </div>
              <div className="flex-1">
                <span className="label">{t("min beds")}</span>
                <NumInput value={r.minBeds} min={1} onChange={(v) => upd((d) => void (d.roomPlan[i].minBeds = Math.max(1, v ?? 1)))} />
              </div>
              <button type="button" className="mt-4 text-stone-400 hover:text-rose-600" onClick={() => upd((d) => void ((d.roomPlan = d.roomPlan.filter((_, k) => k !== i)), (d.rooms = Math.max(1, d.roomPlan.length))))} aria-label={t("Delete")}>
                ✕
              </button>
            </div>
            <div className="mt-1">
              <Check checked={r.coupleBedOk} onChange={(v) => upd((d) => void (d.roomPlan[i].coupleBedOk = v))} label={t("1 double/queen/king also OK")} />
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn h-8 w-full text-xs"
          onClick={() =>
            upd((d) => {
              d.roomPlan = [...d.roomPlan, { guests: 2, minBeds: 2, coupleBedOk: true }];
              d.rooms = d.roomPlan.length;
            })
          }
        >
          + {t("Add room")}
        </button>
      </Section>

      <Section title={t("Couple sleeping")}>
        <Row label={t("Couples")} level={c.sleeping.level} onLevel={(l) => upd((d) => void (d.sleeping.level = l))}>
          <NumInput value={c.sleeping.couples} min={0} onChange={(v) => upd((d) => void (d.sleeping.couples = v ?? 0))} />
        </Row>
        <Check checked={c.sleeping.allowTwoSinglesForCouple} onChange={(v) => upd((d) => void (d.sleeping.allowTwoSinglesForCouple = v))} label={t("Allow 2 singles for a couple")} />
        <Check checked={c.sleeping.coupleSeparateBedrooms} onChange={(v) => upd((d) => void (d.sleeping.coupleSeparateBedrooms = v))} label={t("Each couple in its own bedroom")} />
        <div>
          <span className="label">{t("Other guests may sleep on")}</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(["single", "semi-double", "double", "queen", "king", "sofa", "futon", "tatami", "bunk"] as BedType[]).map((b) => (
              <Check key={b} checked={c.sleeping.extraGuestBeds.includes(b)} onChange={() => upd((d) => void (d.sleeping.extraGuestBeds = toggle(d.sleeping.extraGuestBeds, b)))} label={t(BED_LABEL[b])} />
            ))}
          </div>
        </div>
      </Section>

      <Section title={t("Bathrooms & bathtubs")}>
        <Row label={t("Bathrooms (min / exact)")} level={c.bathrooms.level} onLevel={(l) => upd((d) => void (d.bathrooms.level = l))}>
          <div className="flex gap-2">
            <NumInput value={c.bathrooms.min} onChange={(v) => upd((d) => void (d.bathrooms.min = v))} placeholder="Min" />
            <NumInput value={c.bathrooms.exact} onChange={(v) => upd((d) => void (d.bathrooms.exact = v))} placeholder="Exact" />
          </div>
        </Row>
        <Row label={t("Min toilets")}>
          <NumInput value={c.bathrooms.minToilets} onChange={(v) => upd((d) => void (d.bathrooms.minToilets = v))} />
        </Row>
        <Row label={t("Min bathtubs")} level={c.bathtubs.level} onLevel={(l) => upd((d) => void (d.bathtubs.level = l))}>
          <select className="input" value={c.bathtubs.min ?? 0} onChange={(e) => upd((d) => void (d.bathtubs.min = Number(e.target.value) || null))}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t("0 (any)") : n === 3 ? "3+" : n}
              </option>
            ))}
          </select>
        </Row>
        <Check checked={c.bathtubs.requireVerified} onChange={(v) => upd((d) => void (d.bathtubs.requireVerified = v))} label={t("Require verified bathtub count")} />
      </Section>

      <Section title={t("Location")}>
        <Row label={t("Max station walk (min)")} level={c.station.level} onLevel={(l) => upd((d) => void (d.station.level = l))}>
          <NumInput value={c.station.maxWalkMinutes} onChange={(v) => upd((d) => void (d.station.maxWalkMinutes = v))} />
        </Row>
        <Check
          checked={c.station.estimateFromDistance}
          onChange={(v) => upd((d) => void (d.station.estimateFromDistance = v))}
          label={t("Estimate walk from listed distance (80 m/min, marked estimated)")}
        />
        <Row label={t("Target areas / stations")} level={c.transit.level} onLevel={(l) => upd((d) => void (d.transit.level = l))}>
          <ListInput value={c.transit.targets} onChange={(v) => upd((d) => void (d.transit.targets = v))} placeholder="Kyoto Station, Shijo, …" />
        </Row>
        <div className="flex gap-2">
          <div className="flex-1">
            <span className="label">{t("Max transit (min)")}</span>
            <NumInput value={c.transit.maxMinutes} onChange={(v) => upd((d) => void (d.transit.maxMinutes = v))} />
          </div>
          <div className="flex-1">
            <span className="label">{t("Mode")}</span>
            <select className="input" aria-label={t("Mode")} value={c.transit.mode} onChange={(e) => upd((d) => void (d.transit.mode = e.target.value as Criteria["transit"]["mode"]))}>
              <option value="any">{t("Any transit")}</option>
              <option value="train">{t("Train")}</option>
              <option value="subway">{t("Subway")}</option>
              <option value="bus">{t("Bus")}</option>
            </select>
          </div>
        </div>
        <p className="text-[11px] text-stone-500">{t("Transit time only from listing text; no routing engine yet → UNKNOWN otherwise.")}</p>
        <Row label={t("Max city-center distance (km)")} level={c.distance.level} onLevel={(l) => upd((d) => void (d.distance.level = l))}>
          <NumInput value={c.distance.maxCenterKm} step={0.1} onChange={(v) => upd((d) => void (d.distance.maxCenterKm = v))} />
        </Row>
        <Row label={t("Attractions")}>
          <ListInput value={c.distance.attractions} onChange={(v) => upd((d) => void (d.distance.attractions = v))} placeholder="Fushimi Inari, Arashiyama" />
        </Row>
        <Row label={t("Max attraction distance (km)")}>
          <NumInput value={c.distance.maxAttractionKm} step={0.1} onChange={(v) => upd((d) => void (d.distance.maxAttractionKm = v))} />
        </Row>
      </Section>

      <Section title={t("Reviews & trust")}>
        <Row label={t("Min rating (0–10 scale; 4.5/5 = 9.0)")} level={c.reviews.ratingLevel} onLevel={(l) => upd((d) => void (d.reviews.ratingLevel = l))}>
          <NumInput value={c.reviews.minRating10} step={0.1} onChange={(v) => upd((d) => void (d.reviews.minRating10 = v))} />
        </Row>
        <Row label={t("Min review count")} level={c.reviews.countLevel} onLevel={(l) => upd((d) => void (d.reviews.countLevel = l))}>
          <select className="input" value={c.reviews.minCount ?? ""} onChange={(e) => upd((d) => void (d.reviews.minCount = e.target.value ? Number(e.target.value) : null))}>
            <option value="">{t("any")}</option>
            {[10, 20, 50, 100, 200, 500].map((n) => (
              <option key={n} value={n}>
                ≥ {n}
              </option>
            ))}
          </select>
        </Row>
        <Check checked={c.reviews.establishedOnly} onChange={(v) => upd((d) => void (d.reviews.establishedOnly = v))} label={t("Established property only (≥50 reviews)")} />
      </Section>

      <Section title={t("Amenities")} defaultOpen={false}>
        {AMENITY_FILTERS.map((k) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-xs">{t(AMENITY_LABEL[k])}</span>
            <LevelSelect value={amenityLevel(k)} onChange={(l) => setAmenity(k, l)} />
          </div>
        ))}
      </Section>

      <Section title={t("Laundry & kitchen")} defaultOpen={false}>
        <div className="flex items-center justify-between"><span className="text-xs">{t("Washing machine")}</span><LevelSelect value={c.laundry.washer} onChange={(l) => upd((d) => void (d.laundry.washer = l))} /></div>
        <div className="flex items-center justify-between"><span className="text-xs">{t("Dryer")}</span><LevelSelect value={c.laundry.dryer} onChange={(l) => upd((d) => void (d.laundry.dryer = l))} /></div>
        <Check checked={c.laundry.privateOnly} onChange={(v) => upd((d) => void (d.laundry.privateOnly = v))} label={t("Private washing machine only")} />
        <div className="flex items-center justify-between"><span className="text-xs">{t("Kitchen")}</span><LevelSelect value={c.kitchen.required} onChange={(l) => upd((d) => void (d.kitchen.required = l))} /></div>
        <Check checked={c.kitchen.kitchenetteOk} onChange={(v) => upd((d) => void (d.kitchen.kitchenetteOk = v))} label={t("Kitchenette acceptable")} />
        <div className="flex items-center justify-between"><span className="text-xs">{t("Cookware")}</span><LevelSelect value={c.kitchen.cookware} onChange={(l) => upd((d) => void (d.kitchen.cookware = l))} /></div>
      </Section>

      <Section title={t("Accessibility & rules")} defaultOpen={false}>
        {(
          [
            ["Elevator", c.accessibility.elevator, (l: Level) => upd((d) => void (d.accessibility.elevator = l))],
            ["Wheelchair accessible", c.accessibility.wheelchair, (l: Level) => upd((d) => void (d.accessibility.wheelchair = l))],
            ["Ground floor bedroom", c.accessibility.groundFloor, (l: Level) => upd((d) => void (d.accessibility.groundFloor = l))],
            ["Accessible bathroom", c.accessibility.accessibleBathroom, (l: Level) => upd((d) => void (d.accessibility.accessibleBathroom = l))],
            ["Non-smoking", c.nonSmoking, (l: Level) => upd((d) => void (d.nonSmoking = l))],
            ["Self check-in", c.selfCheckIn, (l: Level) => upd((d) => void (d.selfCheckIn = l))],
            ["Luggage storage", c.luggageStorage, (l: Level) => upd((d) => void (d.luggageStorage = l))],
          ] as const
        ).map(([label, v, set]) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-xs">{t(label)}</span>
            <LevelSelect value={v} onChange={set} />
          </div>
        ))}
        <Row label={t("Check-in / check-out window")} level={c.checkInOut.level} onLevel={(l) => upd((d) => void (d.checkInOut.level = l))}>
          <div className="grid grid-cols-2 gap-2">
            <input type="time" className="input" value={c.checkInOut.earliestCheckIn ?? ""} onChange={(e) => upd((d) => void (d.checkInOut.earliestCheckIn = e.target.value || null))} title={t("Earliest check-in")} />
            <input type="time" className="input" value={c.checkInOut.latestCheckOut ?? ""} onChange={(e) => upd((d) => void (d.checkInOut.latestCheckOut = e.target.value || null))} title={t("Latest check-out")} />
          </div>
        </Row>
      </Section>

      <Section title={t("Cancellation & meals")} defaultOpen={false}>
        {(
          [
            ["Free cancellation", c.cancellation.freeCancellation, (l: Level) => upd((d) => void (d.cancellation.freeCancellation = l))],
            ["Pay later", c.cancellation.payLater, (l: Level) => upd((d) => void (d.cancellation.payLater = l))],
            ["No prepayment", c.cancellation.noPrepayment, (l: Level) => upd((d) => void (d.cancellation.noPrepayment = l))],
            ["Refundable", c.cancellation.refundable, (l: Level) => upd((d) => void (d.cancellation.refundable = l))],
            ["Breakfast included", c.meals.breakfast, (l: Level) => upd((d) => void (d.meals.breakfast = l))],
            ["Dinner included", c.meals.dinner, (l: Level) => upd((d) => void (d.meals.dinner = l))],
          ] as const
        ).map(([label, v, set]) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-xs">{t(label)}</span>
            <LevelSelect value={v} onChange={set} />
          </div>
        ))}
      </Section>

      <Section title={t("Verification policy")}>
        <Check checked={c.availabilityVerifiedOnly} onChange={(v) => upd((d) => void (d.availabilityVerifiedOnly = v))} label={t("Only verified available (detail page)")} />
        <div>
          <span className="label">{t("REQUIRED filter with UNKNOWN value")}</span>
          <select className="input" aria-label={t("REQUIRED filter with UNKNOWN value")} value={c.unknownRequiredPolicy} onChange={(e) => upd((d) => void (d.unknownRequiredPolicy = e.target.value as "review" | "reject"))}>
            <option value="review">{t("Show under “Needs review”")}</option>
            <option value="reject">{t("Reject")}</option>
          </select>
        </div>
      </Section>

      <Section title={t("Ranking weights")} defaultOpen={false}>
        {(Object.keys(c.weights) as (keyof Criteria["weights"])[]).map((k) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-24 text-xs capitalize">{t(k === "hard" ? "Requirements" : k === "baths" ? "Bath/tubs" : k[0].toUpperCase() + k.slice(1))}</span>
            <input type="range" min={0} max={40} value={c.weights[k]} onChange={(e) => upd((d) => void (d.weights[k] = Number(e.target.value)))} className="flex-1 accent-[#23675f]" />
            <span className="w-6 text-right text-xs tabular-nums">{c.weights[k]}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}
