import { db } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { rawImports, inventory, requests } from "@/db/schema";
import { parseFreeText } from "./parser";
import { buildFingerprint } from "./fingerprint";
import { runMatchingForRequest, runMatchingForInventory } from "./matchingEngine";

/** Batch AI processor for raw_imports coming from WhatsApp groups / manual
 * admin ingestion (PRD "ai-processor" edge function, cron every 120s). Since
 * these messages have no linked showroom/user, parsed results are surfaced
 * to the admin as "unassigned market signal" (classification only) rather
 * than being auto-inserted into a specific showroom's inventory. */
export async function processPendingRawImports(limit = 50) {
  const pending = await db
    .select()
    .from(rawImports)
    .where(inArray(rawImports.status, ["pending", "pending_ai"]))
    .limit(limit);

  let processed = 0;
  for (const row of pending) {
    if (!row.rawText) {
      await db.update(rawImports).set({ status: "rejected" }).where(eq(rawImports.id, row.id));
      continue;
    }
    const parsed = await parseFreeText(row.rawText);
    const classification = parsed.type === "unclear" ? "unknown" : parsed.type;

    await db
      .update(rawImports)
      .set({
        classification,
        status: "parsed",
        parsedData: parsed,
      })
      .where(eq(rawImports.id, row.id));

    // If it's linked to a real showroom (e.g. submitted via a showroom's own
    // free-text chat rather than a public group) and fully resolved, auto
    // materialize it into inventory/requests + trigger matching.
    if (row.showroomId && parsed.brand && parsed.model && parsed.year && parsed.city) {
      const car = {
        brand: parsed.brand,
        model: parsed.model,
        year: parsed.year,
        trim: parsed.trim,
        color: parsed.color,
        city: parsed.city,
      };
      const fingerprint = buildFingerprint(car);
      if (classification === "supply") {
        const [inv] = await db
          .insert(inventory)
          .values({
            showroomId: row.showroomId,
            addedBy: row.userId,
            rawImportId: row.id,
            ...car,
            spec: parsed.spec,
            price: parsed.price != null ? String(parsed.price) : null,
            fingerprint,
          })
          .returning();
        await runMatchingForInventory(inv.id);
      } else if (classification === "demand") {
        const [req] = await db
          .insert(requests)
          .values({
            showroomId: row.showroomId,
            requestedBy: row.userId,
            ...car,
            spec: parsed.spec,
            fingerprint,
          })
          .returning();
        await runMatchingForRequest(req.id);
      }
    }

    processed += 1;
  }
  return { processed };
}
