import type { Page } from "playwright";
import type { Criteria, LogEntry, Offer, ProviderId } from "@/lib/types";

export class StopError extends Error {
  constructor() {
    super("stopped by user");
  }
}

export class ManualInteractionError extends Error {}

export interface ProviderRunContext {
  provider: ProviderId;
  criteria: Criteria;
  log(msg: string, level?: LogEntry["level"]): void;
  stage(text: string): void;
  progress(current: number, total: number): void;
  /** Pause / stop / CAPTCHA gate. Waits for the user when the page needs manual interaction. */
  checkpoint(page: Page, label?: string): Promise<void>;
  /** Hand control to the user for a provider-specific reason; resolves when they press Continue. */
  requestUser(page: Page, reason: string): Promise<void>;
  /** Polite, interruptible delay with jitter */
  sleep(ms: number): Promise<void>;
  newPage(): Promise<Page>;
  screenshot(page: Page): Promise<void>;
  isStopped(): boolean;
}

export interface AccommodationProvider {
  id: ProviderId;
  label: string;
  /** Open the site, enter destination/dates/guests and land on a result list. */
  search(ctx: ProviderRunContext, page: Page): Promise<void>;
  /** Scroll and read result cards (max N). Returns partially filled offers (stage "search_card"). */
  parseSearchResults(ctx: ProviderRunContext, page: Page, max: number): Promise<Offer[]>;
  openProperty(ctx: ProviderRunContext, page: Page, offer: Offer): Promise<void>;
  parsePropertyDetails(ctx: ProviderRunContext, page: Page, offer: Offer): Promise<void>;
  verifyAvailability(ctx: ProviderRunContext, page: Page, offer: Offer): Promise<void>;
  verifyPrice(ctx: ProviderRunContext, page: Page, offer: Offer): Promise<void>;
}
