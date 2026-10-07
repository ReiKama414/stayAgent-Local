import { NextResponse } from "next/server";
import { currentJob } from "@/lib/automation/job";
import { browserChannel, browserOpen } from "@/lib/automation/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const job = currentJob();
  const since = Number(new URL(req.url).searchParams.get("results") ?? "1");
  const snap = job?.snapshot() ?? null;
  if (snap && !since) snap.results = [];
  return NextResponse.json({ job: snap, browser: { open: browserOpen(), channel: browserChannel() } });
}
