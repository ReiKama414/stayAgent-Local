import { NextResponse } from "next/server";
import { z } from "zod";
import { CriteriaSchema } from "@/lib/types";
import { deletePreset, listPresets, savePreset } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const presets = listPresets()
    .map((p) => ({ ...p, criteria: CriteriaSchema.safeParse(p.criteria) }))
    .filter((p) => p.criteria.success)
    .map((p) => ({ name: p.name, updatedAt: p.updatedAt, criteria: p.criteria.data }));
  return NextResponse.json({ presets });
}

const Body = z.object({ name: z.string().trim().min(1).max(80), criteria: CriteriaSchema });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preset" }, { status: 400 });
  savePreset(parsed.data.name, parsed.data.criteria);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  deletePreset(name);
  return NextResponse.json({ ok: true });
}
