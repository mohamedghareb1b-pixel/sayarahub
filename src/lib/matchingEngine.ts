import { db } from "@/db";
import { inventory, matches, requests, showrooms, users } from "@/db/schema";
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { enqueueMessage } from "./whatsapp";

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

function splitMultiValue(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[،,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function multiValueCondition(col: Parameters<typeof eq>[0], value: string | null) {
  const parts = splitMultiValue(value);
  if (parts.length === 0) return undefined;
  return parts.length > 1 ? inArray(col, parts) : eq(col, parts[0]);
}

async function getRepForShowroom(showroomId: string) {
  const [showroom] = await db.select().from(showrooms).where(eq(showrooms.id, showroomId));
  if (showroom?.ownerUserId) {
    const [owner] = await db.select().from(users).where(eq(users.id, showroom.ownerUserId));
    if (owner) return owner;
  }
  const [anyStaff] = await db.select().from(users).where(eq(users.showroomId, showroomId)).orderBy(users.createdAt).limit(1);
  return anyStaff ?? null;
}

/**
 * الموديل الجديد: بث الطلب لكل الأشخاص اللي عندهم سيارة مطابقة في مخزونهم
 * (مش بس أفضل تطابق واحد)، وكل واحد فيهم بيرد بـ"✅ متوفر" أو "❌ غير متوفر".
 * أول واحد يدوس "✅ متوفر" هو اللي ياخد الطلب — والباقي بيتقفلوا تلقائي.
 */
export async function runMatchingForRequest(requestId: string) {
  const [req] = await db.select().from(requests).where(eq(requests.id, requestId));
  if (!req || req.status !== "open") return [];

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
        ne(inventory.showroomId, req.showroomId),
      ),
    );

  if (candidates.length === 0) return [];

  const label = [req.brand, req.model, req.year, req.trim, req.color, req.spec, req.city].filter(Boolean).join(" ");
  const notes: string[] = [];
  if (req.interiorColor) notes.push(`داخلي ${req.interiorColor}`);
  if (req.extraFeatures) notes.push(req.extraFeatures);
  const fullLabel = notes.length > 0 ? `${label}\n📝 ${notes.join("، ")}` : label;

  const createdMatches = [];
  for (const inv of candidates) {
    const [match] = await db
      .insert(matches)
      .values({
        requestId: req.id,
        inventoryId: inv.id,
        requestShowroomId: req.showroomId,
        inventoryShowroomId: inv.showroomId,
        matchScore: 0,
        status: "pending_confirmation",
        confirmationSentAt: new Date(),
      })
      .returning();
    createdMatches.push(match);

    const rep = await getRepForShowroom(inv.showroomId);
    if (rep) {
      await enqueueMessage({
        toPhone: rep.phone,
        toUserId: rep.id,
        messageType: "utility",
        templateName: "match_broadcast",
        templateParams: { brand: req.brand, model: req.model, year: req.year },
        body: `🔔 في حد بيدور على سيارة زي اللي عندك:\n${fullLabel}\n\nمتوفرة عندك دلوقتي؟`,
        buttons: [
          { id: `match_yes_${match.id}`, title: "✅ متوفر" },
          { id: `match_no_${match.id}`, title: "❌ غير متوفر" },
        ],
        isFree: rep.isActiveToday,
      });
    }
  }

  return createdMatches;
}

/** الاتجاه العكسي: لما مخزون جديد يتضاف، ندور على أي طلبات مفتوحة تستناه،
 * ونبعتلهم إشعار (نفس منطق البث). */
export async function runMatchingForInventory(inventoryId: string) {
  const [inv] = await db.select().from(inventory).where(eq(inventory.id, inventoryId));
  if (!inv || inv.status !== "available") return;

  const openRequests = await db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.brand, inv.brand),
        eq(requests.model, inv.model),
        eq(requests.year, inv.year),
        inv.trim ? sql`${requests.trim} like ${"%" + inv.trim + "%"}` : undefined,
        eq(requests.status, "open"),
        gt(requests.expiresAt, new Date()),
        ne(requests.showroomId, inv.showroomId),
      ),
    );

  for (const req of openRequests) {
    await runMatchingForRequest(req.id);
  }
}

/** لما حد يدوس "✅ متوفر" — أول واحد ياخد الطلب، والباقي بيتقفلوا. */
const MAX_WINNERS = 3;

/** لما حد يدوس "✅ متوفر" — أول 3 مناديب بس هم اللي بياخدوا الطلب (مش واحد
 * بس)، عشان الطالب يكون عنده أكتر من خيار يتواصل معاه. بعد ما يكتمل العدد،
 * الباقي بيتقفلوا تلقائي. */
export async function confirmMatch(matchId: string) {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return { ok: false as const, reason: "not_found" as const };

  const [req] = await db.select().from(requests).where(eq(requests.id, match.requestId));
  if (!req) return { ok: false as const, reason: "not_found" as const };

  if (req.status !== "open") {
    await db.update(matches).set({ status: "expired" }).where(eq(matches.id, matchId));
    return { ok: false as const, reason: "already_taken" as const };
  }

  const alreadyConnected = await db
    .select()
    .from(matches)
    .where(and(eq(matches.requestId, req.id), eq(matches.status, "connected")));

  if (alreadyConnected.length >= MAX_WINNERS) {
    await db.update(matches).set({ status: "expired" }).where(eq(matches.id, matchId));
    return { ok: false as const, reason: "already_taken" as const };
  }

  await db
    .update(matches)
    .set({ status: "connected", confirmedAt: new Date(), connectedAt: new Date() })
    .where(eq(matches.id, matchId));
  await db.update(inventory).set({ status: "reserved" }).where(eq(inventory.id, match.inventoryId));

  const newConnectedCount = alreadyConnected.length + 1;
  const isLastSlot = newConnectedCount >= MAX_WINNERS;

  if (isLastSlot) {
    // اكتمل العدد (3) — نقفل الطلب ونبلغ أي مناديب لسه مستنيين إنها اتاخدت.
    await db.update(requests).set({ status: "fulfilled" }).where(eq(requests.id, req.id));

    const otherPending = await db
      .select()
      .from(matches)
      .where(and(eq(matches.requestId, req.id), eq(matches.status, "pending_confirmation")));

    for (const other of otherPending) {
      if (other.id === matchId) continue;
      await db.update(matches).set({ status: "expired" }).where(eq(matches.id, other.id));
      if (other.inventoryShowroomId) {
        const otherRep = await getRepForShowroom(other.inventoryShowroomId);
        if (otherRep) {
          await enqueueMessage({
            toPhone: otherRep.phone,
            toUserId: otherRep.id,
            messageType: "utility",
            templateName: "match_taken",
            body: "⏱️ شكراً على ردك — اكتمل العدد المطلوب من المعارض لنفس الطلب.",
            isFree: true,
          });
        }
      }
    }
  }

  const [inv] = await db.select().from(inventory).where(eq(inventory.id, match.inventoryId));
  if (!inv) return { ok: true as const };

  const [supplierShowroom] = await db.select().from(showrooms).where(eq(showrooms.id, inv.showroomId));
  const supplierRep = await getRepForShowroom(inv.showroomId);
  const label = fullCarLabel(inv);

  if (req.requestedBy) {
    const [requesterUser] = await db.select().from(users).where(eq(users.id, req.requestedBy));
    if (requesterUser && supplierRep) {
      await enqueueMessage({
        toPhone: requesterUser.phone,
        toUserId: requesterUser.id,
        messageType: "utility",
        templateName: "connection_requester",
        body: `✅ لقينالك السيارة (خيار ${newConnectedCount} من ${MAX_WINNERS})! ${label}\n💰 السعر: ${inv.price ? `${inv.price} ريال` : "غير محدد"}\nمن: ${supplierShowroom?.name ?? ""} — ${supplierShowroom?.city ?? ""}\nالتواصل: ${supplierRep.phone}`,
        buttons: [{ id: `wa_${supplierRep.phone}`, title: "💬 واتساب" }],
        isFree: requesterUser.isActiveToday,
      });

      await enqueueMessage({
        toPhone: supplierRep.phone,
        toUserId: supplierRep.id,
        messageType: "utility",
        templateName: "connection_supplier",
        body: `✅ تم توصيلك بالطالب: ${label}\nالتواصل: ${requesterUser.phone}`,
        buttons: [{ id: `wa_${requesterUser.phone}`, title: "💬 واتساب" }],
        isFree: true,
      });
    }
  }

  await db
    .update(showrooms)
    .set({ monthlyConfirmedMatches: (supplierShowroom?.monthlyConfirmedMatches ?? 0) + 1 })
    .where(eq(showrooms.id, inv.showroomId));

  return { ok: true as const };
}

/** لما حد يدوس "❌ غير متوفر" (أو مايردش خلال المهلة) — بس مطابقته هو اللي
 * بتتقفل، الطلب يفضل مفتوح لباقي المرشحين، ومفيش تأثير على حد تاني. */
export async function declineMatch(matchId: string, reason: "declined" | "no_response" = "declined") {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return;
  await db.update(matches).set({ status: reason }).where(eq(matches.id, matchId));
}
