import { db } from "@/db";
import { inventory, matches, requests, showrooms, users } from "@/db/schema";
import { and, desc, eq, gt, inArray, ne, notInArray, sql } from "drizzle-orm";
import { enqueueMessage } from "./whatsapp";

/** Round-robin salesperson picker per PRD 4.5. Falls back to the owner if the
 * showroom has no registered salespeople yet. */
export async function pickNextSalesperson(showroomId: string) {
  const [showroom] = await db.select().from(showrooms).where(eq(showrooms.id, showroomId));
  if (!showroom) return null;

  const staff = await db
    .select()
    .from(users)
    .where(and(eq(users.showroomId, showroomId), eq(users.isActive, true)))
    .orderBy(users.createdAt);

  if (staff.length === 0) return null;

  let idx = showroom.nextSalespersonIndex;
  if (idx >= staff.length) idx = 0;

  let chosen = staff[idx];
  if (!chosen.isActiveToday) {
    const activeToday = staff.find((s) => s.isActiveToday);
    if (activeToday) chosen = activeToday;
  }

  const nextIndex = (idx + 1) % staff.length;
  await db
    .update(showrooms)
    .set({ nextSalespersonIndex: nextIndex })
    .where(eq(showrooms.id, showroomId));

  return chosen;
}

function fullCarLabel(car: {
  brand: string;
  model: string;
  year: number;
  trim: string | null;
  color: string | null;
  interiorColor: string | null;
  spec: string | null;
  city: string;
  extraFeatures: string | null;
}) {
  const main = [car.brand, car.model, car.year, car.trim, car.color, car.spec, car.city].filter(Boolean).join(" ");
  const notes: string[] = [];
  if (car.interiorColor) notes.push(`داخلي ${car.interiorColor}`);
  if (car.extraFeatures) notes.push(car.extraFeatures);
  return notes.length > 0 ? `${main}\n📝 ${notes.join("، ")}` : main;
}

/** يقسّم قيمة ممكن تكون فيها أكتر من خيار (زي "أبيض، أحمر") لقائمة مفصولة،
 * عشان نقدر نطابق لو أي واحدة من القيم دي اتوفرت، مش قيمة واحدة بس. */
function splitMultiValue(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[،,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** true لو فيه أي تداخل بين قائمتين (قيمة واحدة أو أكتر من كل جانب). */
function hasOverlap(a: string | null, b: string | null): boolean {
  const listA = splitMultiValue(a);
  const listB = splitMultiValue(b);
  if (listA.length === 0 || listB.length === 0) return false;
  return listA.some((x) => listB.includes(x));
}

/** يبني شرط SQL للمطابقة الإجبارية (برand/موديل/فئة..): لو القيمة فيها أكتر
 * من خيار مفصول بفاصلة، بيطابق لو العمود ساوى أي واحدة منهم. */
function multiValueCondition(col: Parameters<typeof eq>[0], value: string | null) {
  const parts = splitMultiValue(value);
  if (parts.length === 0) return undefined;
  return parts.length > 1 ? inArray(col, parts) : eq(col, parts[0]);
}

function scoreMatch(
  req: { color: string | null; trim: string | null; city: string; spec: string | null },
  inv: { color: string | null; trim: string | null; city: string; spec: string | null },
) {
  let score = 0;
  if (hasOverlap(req.color, inv.color)) score += 1;
  if (hasOverlap(req.trim, inv.trim)) score += 1;
  if (req.city && inv.city && req.city === inv.city) score += 1;
  if (req.spec && inv.spec && req.spec === inv.spec) score += 1;
  return score;
}

async function getContactPhone(showroomId: string) {
  const [showroom] = await db.select().from(showrooms).where(eq(showrooms.id, showroomId));
  if (showroom?.ownerUserId) {
    const [owner] = await db.select().from(users).where(eq(users.id, showroom.ownerUserId));
    if (owner) return owner.phone;
  }
  const [anyStaff] = await db
    .select()
    .from(users)
    .where(eq(users.showroomId, showroomId))
    .orderBy(users.createdAt)
    .limit(1);
  return anyStaff?.phone ?? null;
}

async function alreadyTriedShowroomIds(requestId: string) {
  const rows = await db
    .select({ showroomId: matches.inventoryShowroomId })
    .from(matches)
    .where(eq(matches.requestId, requestId));
  return rows.map((r) => r.showroomId).filter((v): v is string => Boolean(v));
}

/** Finds the best available inventory match for an open request and sends a
 * match_confirmation message to the supplying showroom's next-in-line rep. */
export async function runMatchingForRequest(requestId: string, excludeShowroomIds: string[] = []) {
  const [req] = await db.select().from(requests).where(eq(requests.id, requestId));
  if (!req || req.status !== "open") return null;

  const tried = await alreadyTriedShowroomIds(requestId);
  const excluded = Array.from(new Set([...tried, ...excludeShowroomIds, req.showroomId]));

  const candidates = await db
    .select()
    .from(inventory)
    .where(
      and(
        eq(inventory.brand, req.brand),
        eq(inventory.model, req.model),
        eq(inventory.year, req.year),
        req.trim ? multiValueCondition(inventory.trim, req.trim) : undefined,
        eq(inventory.status, "available"),
        gt(inventory.expiresAt, new Date()),
        excluded.length ? notInArray(inventory.showroomId, excluded) : undefined,
      ),
    );

  if (candidates.length === 0) return null;

  const scored = candidates
    .map((inv) => ({ inv, score: scoreMatch(req, inv) }))
    .sort((a, b) => b.score - a.score || b.inv.updatedAt.getTime() - a.inv.updatedAt.getTime());

  const best = scored[0].inv;

  // Lock the inventory row while we wait for supplier confirmation.
  await db.update(inventory).set({ status: "processing" }).where(eq(inventory.id, best.id));
  await db.update(requests).set({ status: "matched" }).where(eq(requests.id, requestId));

  const [match] = await db
    .insert(matches)
    .values({
      requestId: req.id,
      inventoryId: best.id,
      requestShowroomId: req.showroomId,
      inventoryShowroomId: best.showroomId,
      matchScore: scored[0].score,
      status: "pending_confirmation",
      confirmationSentAt: new Date(),
    })
    .returning();

  const rep = await pickNextSalesperson(best.showroomId);
  if (rep) {
    const label = fullCarLabel(best);
    await enqueueMessage({
      toPhone: rep.phone,
      toUserId: rep.id,
      messageType: "utility",
      templateName: "match_confirmation",
      templateParams: { brand: best.brand, model: best.model, year: best.year, color: best.color },
      body: `🔔 يوجد طلب مطابق لمخزونك: ${label}\nهل السيارة ما زالت متوفرة؟`,
      buttons: [
        { id: `match_yes_${match.id}`, title: "✅ نعم" },
        { id: `match_no_${match.id}`, title: "❌ تم البيع" },
      ],
      isFree: rep.isActiveToday,
    });
  }

  return match;
}

/** Reverse direction: when new inventory is added, look for an already-open
 * request waiting for that exact car. */
export async function runMatchingForInventory(inventoryId: string) {
  const [inv] = await db.select().from(inventory).where(eq(inventory.id, inventoryId));
  if (!inv || inv.status !== "available") return null;

  const openRequests = await db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.brand, inv.brand),
        eq(requests.model, inv.model),
        eq(requests.year, inv.year),
        // inv.trim قيمة واحدة (عربية بعينها)، لكن requests.trim ممكن يكون فيه
        // أكتر من خيار مفصول بفاصلة (زي "فل كامل، ستاندر") — بنستخدم تحقق
        // احتواء بدل تطابق حرفي كامل عشان نلاقي الطلب حتى لو مطلوب فيه خيارات تانية.
        inv.trim ? sql`${requests.trim} like ${"%" + inv.trim + "%"}` : undefined,
        eq(requests.status, "open"),
        gt(requests.expiresAt, new Date()),
        ne(requests.showroomId, inv.showroomId),
      ),
    )
    .orderBy(desc(requests.createdAt));

  if (openRequests.length === 0) return null;

  // Pick the oldest / first matching open request that hasn't already tried this showroom.
  for (const req of openRequests) {
    const tried = await alreadyTriedShowroomIds(req.id);
    if (!tried.includes(inv.showroomId)) {
      return runMatchingForRequest(req.id);
    }
  }
  return null;
}

/** Handles a supplier confirming their car is still available. */
export async function confirmMatch(matchId: string) {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return null;

  await db
    .update(matches)
    .set({ status: "connected", confirmedAt: new Date(), connectedAt: new Date() })
    .where(eq(matches.id, matchId));

  await db.update(inventory).set({ status: "reserved" }).where(eq(inventory.id, match.inventoryId));
  await db.update(requests).set({ status: "fulfilled" }).where(eq(requests.id, match.requestId));

  const [inv] = await db.select().from(inventory).where(eq(inventory.id, match.inventoryId));
  const [req] = await db.select().from(requests).where(eq(requests.id, match.requestId));
  if (!inv || !req) return match;

  const [supplierShowroom] = await db
    .select()
    .from(showrooms)
    .where(eq(showrooms.id, inv.showroomId));
  const [requesterShowroom] = await db
    .select()
    .from(showrooms)
    .where(eq(showrooms.id, req.showroomId));

  const supplierPhone = await getContactPhone(inv.showroomId);
  const requesterPhone = await getContactPhone(req.showroomId);

  const label = fullCarLabel(inv);

  if (req.requestedBy) {
    const [requesterUser] = await db.select().from(users).where(eq(users.id, req.requestedBy));
    if (requesterUser && supplierPhone) {
      await enqueueMessage({
        toPhone: requesterUser.phone,
        toUserId: requesterUser.id,
        messageType: "utility",
        templateName: "connection_requester",
        body: `✅ سيارة مطابقة مؤكدة! ${label}\n💰 السعر: ${inv.price ? `${inv.price} ريال` : "غير محدد"}\nالمعرض: ${supplierShowroom?.name ?? ""} - ${supplierShowroom?.city ?? ""}\nالتواصل: ${supplierPhone}`,
        buttons: [{ id: `wa_${supplierPhone}`, title: "💬 واتساب" }],
        isFree: requesterUser.isActiveToday,
      });
    }
  }

  const supplierRep = await db
    .select()
    .from(users)
    .where(eq(users.showroomId, inv.showroomId))
    .limit(1);
  if (supplierRep[0] && requesterPhone) {
    await enqueueMessage({
      toPhone: supplierRep[0].phone,
      toUserId: supplierRep[0].id,
      messageType: "utility",
      templateName: "connection_supplier",
      body: `✅ تم توصيلك مع معرض يبحث عن سيارتك: ${label}\nالمعرض الطالب: ${requesterShowroom?.name ?? ""}\nالتواصل: ${requesterPhone}`,
      buttons: [{ id: `wa_${requesterPhone}`, title: "💬 واتساب" }],
      isFree: true,
    });
  }

  await db
    .update(showrooms)
    .set({ monthlyConfirmedMatches: (supplierShowroom?.monthlyConfirmedMatches ?? 0) + 1 })
    .where(eq(showrooms.id, inv.showroomId));
  await db
    .update(showrooms)
    .set({ monthlyConfirmedMatches: (requesterShowroom?.monthlyConfirmedMatches ?? 0) + 1 })
    .where(eq(showrooms.id, req.showroomId));

  return match;
}

/** Handles a supplier declining ("تم البيع") or an expired 30-min timeout —
 * releases the inventory and tries the next best showroom. */
export async function declineMatch(matchId: string, reason: "declined" | "no_response" = "declined") {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return null;

  await db.update(matches).set({ status: reason }).where(eq(matches.id, matchId));
  await db
    .update(inventory)
    .set({ status: match.inventoryShowroomId ? "expired" : "available" })
    .where(eq(inventory.id, match.inventoryId));
  // "تم البيع" really means sold — mark expired instead of available again.
  if (reason === "no_response") {
    await db.update(inventory).set({ status: "available" }).where(eq(inventory.id, match.inventoryId));
  }
  await db.update(requests).set({ status: "open" }).where(eq(requests.id, match.requestId));

  return runMatchingForRequest(match.requestId);
}
