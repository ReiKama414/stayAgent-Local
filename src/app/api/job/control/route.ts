import { NextResponse } from "next/server";
import { currentJob } from "@/lib/automation/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const job = currentJob();
  if (!job) return NextResponse.json({ error: "No active search" }, { status: 404 });
  switch (action) {
    case "pause":
      job.pause();
      break;
    case "resume":
      job.resume();
      break;
    case "continue":
      job.continueAfterUser();
      break;
    case "skip":
      job.skipProvider();
      break;
    case "stop":
      await job.stop();
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, status: job.status });
}
