import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteFavorite, listFavorites, upsertFavorite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ favorites: listFavorites() });
}

const Body = z.object({ propertyId: z.string().min(1), name: z.string().default(""), note: z.string().max(2000).default(""), snapshot: z.unknown().optional() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid favorite" }, { status: 400 });
  upsertFavorite(parsed.data.propertyId, parsed.data.name, parsed.data.note, parsed.data.snapshot ?? null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteFavorite(id);
  return NextResponse.json({ ok: true });
}
