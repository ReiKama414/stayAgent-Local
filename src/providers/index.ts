import type { ProviderId } from "@/lib/types";
import type { AccommodationProvider } from "./types";
import { BookingProvider } from "./booking";
import { AgodaProvider } from "./agoda";
import { AirbnbProvider } from "./airbnb";
import { TripProvider } from "./trip";

export const PROVIDER_IMPLS: Record<ProviderId, AccommodationProvider> = {
  booking: BookingProvider,
  agoda: AgodaProvider,
  airbnb: AirbnbProvider,
  trip: TripProvider,
};
