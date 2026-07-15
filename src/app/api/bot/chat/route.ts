import { db } from "@/db";
import { chatLog } from "@/db/schema";
import { eq, asc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone");

  if (phone) {
    const rows = await db
      .select()
      .from(chatLog)
      .where(eq(chatLog.phone, phone))
      .orderBy(asc(chatLog.createdAt))
      .limit(200);
    return Response.json({ messages: rows });
  }

  const phones = await db
    .select({ phone: chatLog.phone, last: sql<string>`max(created_at)` })
    .from(chatLog)
    .groupBy(chatLog.phone)
    .orderBy(sql`max(created_at) desc`)
    .limit(50);

  return Response.json({ phones });
}
