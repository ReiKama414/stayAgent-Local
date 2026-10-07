import { NextResponse } from "next/server";
import { closeBrowser, openLoginTabs } from "@/lib/automation/browser";
import { currentJob } from "@/lib/automation/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const job = currentJob();
  const busy = job && ["RUNNING", "PAUSED", "WAITING_FOR_USER", "STOPPING"].includes(job.status);
  try {
    if (action === "login") {
      await openLoginTabs();
      return NextResponse.json({ ok: true });
    }
    if (action === "close") {
      if (busy) return NextResponse.json({ error: "Stop the running search first" }, { status: 409 });
      await closeBrowser();
      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
