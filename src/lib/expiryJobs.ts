import { db } from "@/db";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { inventory, requests, users, showrooms, matches } from "@/db/schema";
import { enqueueMessage } from "./whatsapp";
import { declineMatch } from "./matchingEngine";

export async function expireOldRequests() {
  const result = await db
    .update(requests)
    .set({ status: "expired" })
    .where(and(eq(requests.status, "open"), lt(requests.expiresAt, new Date())))
    .returning({ id: requests.id });
  return result.length;
}

export async function expireOldInventory() {
  const result = await db
    .update(inventory)
    .set({ status: "expired" })
    .where(and(eq(inventory.status, "available"), lt(inventory.expiresAt, new Date())))
    .returning({ id: inventory.id });
  return result.length;
}

export async function resetDailyPresence() {
  await db.update(users).set({ isActiveToday: false });
}

export async function expireUnrespondedMatches() {
  const stale = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.status, "pending_confirmation"),
        lt(matches.confirmationSentAt, new Date(Date.now() - 30 * 60 * 1000)),
      ),
    );
  for (const m of stale) {
    await declineMatch(m.id, "no_response");
  }
  return stale.length;
}

/** Sends a renewal reminder 1 hour before a request expires (PRD 4.4). */
export async function sendRequestExpiryReminders() {
  const soon = await db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.status, "open"),
        eq(requests.reminderSent, false),
        lt(requests.expiresAt, new Date(Date.now() + 60 * 60 * 1000)),
        gt(requests.expiresAt, new Date()),
      ),
    );
  for (const r of soon) {
    if (!r.requestedBy) continue;
    const [u] = await db.select().from(users).where(eq(users.id, r.requestedBy));
    if (!u) continue;
    await enqueueMessage({
      toPhone: u.phone,
      toUserId: u.id,
      messageType: "utility",
      templateName: "request_expiry",
      body: `⏰ طلبك لـ ${r.brand} ${r.model} ${r.year} سينتهي خلال ساعة`,
      buttons: [
        { id: `renew_${r.id}`, title: "🔄 جدد" },
        { id: `cancel_${r.id}`, title: "❌ إلغاء" },
      ],
      isFree: u.isActiveToday,
    });
    await db.update(requests).set({ reminderSent: true }).where(eq(requests.id, r.id));
  }
  return soon.length;
}

/** Daily 9pm ping to owners who haven't checked in today (PRD 4.2). */
export async function sendDailyPing() {
  const owners = await db.select().from(users).where(eq(users.role, "owner"));
  let sent = 0;
  for (const owner of owners) {
    if (!owner.showroomId) continue;
    const [showroom] = await db.select().from(showrooms).where(eq(showrooms.id, owner.showroomId));
    const [invCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventory)
      .where(and(eq(inventory.showroomId, owner.showroomId), eq(inventory.status, "available")));
    await enqueueMessage({
      toPhone: owner.phone,
      toUserId: owner.id,
      messageType: "daily_ping",
      templateName: "daily_ping",
      body: `مساء الخير ${owner.name ?? ""} 👋\nملخص يومك: مطابقات مؤكدة هذا الشهر: ${showroom?.monthlyConfirmedMatches ?? 0}\nمخزونك الحالي: ${invCount?.count ?? 0} سيارة\nلا تنسَ تسجيل حضورك غداً ✅`,
      isFree: owner.isActiveToday,
    });
    sent += 1;
  }
  return sent;
}

export async function runAllExpiryJobs() {
  const [expiredRequests, expiredInventory, timedOutMatches, reminders] = await Promise.all([
    expireOldRequests(),
    expireOldInventory(),
    expireUnrespondedMatches(),
    sendRequestExpiryReminders(),
  ]);
  return { expiredRequests, expiredInventory, timedOutMatches, reminders };
}
