import { NextResponse } from "next/server";
import { deleteSearch, getSearch, setSaved } from "@/lib/db";
import { currentJob } from "@/lib/automation/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = getSearch(id);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(s);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { saved } = (await req.json().catch(() => ({}))) as { saved?: boolean };
  setSaved(id, !!saved);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = currentJob();
  if (job && job.id === id && ["RUNNING", "PAUSED", "WAITING_FOR_USER", "STOPPING"].includes(job.status)) {
    return NextResponse.json({ error: "Search is still running" }, { status: 409 });
  }
  deleteSearch(id);
  return NextResponse.json({ ok: true });
}
