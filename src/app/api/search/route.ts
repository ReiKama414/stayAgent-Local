import { NextResponse } from "next/server";
import { CriteriaSchema } from "@/lib/types";
import { startJob } from "@/lib/automation/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CriteriaSchema.safeParse(body?.criteria ?? body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid criteria", issues: parsed.error.issues }, { status: 400 });
  const c = parsed.data;
  if (c.checkOut <= c.checkIn) return NextResponse.json({ error: "Check-out must be after check-in" }, { status: 400 });
  if (!c.providers.length) return NextResponse.json({ error: "Select at least one platform" }, { status: 400 });
  try {
    const job = startJob(c);
    return NextResponse.json({ id: job.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
