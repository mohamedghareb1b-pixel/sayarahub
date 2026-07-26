import { db } from "@/db";
import { showrooms } from "@/db/schema";
import { eq } from "drizzle-orm";

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SubscriptionStatus = {
  allowed: boolean;
  isPro: boolean;
  /** null يعني: لسه معندهوش أول ماتش متأكد، فالعداد لسه مابدأش أصلاً. */
  daysLeft: number | null;
};

/** بيحسب هل المعرض ده لسه مسموحله يستخدم النظام (يضيف مخزون/يعمل طلب/يقفل
 * ماتش) ولا لأ:
 * - Pro (دافع): مسموح دايماً.
 * - لسه معندوش أول ماتش متأكد (trialStartedAt فاضية): مسموح — العداد لسه
 *   مابدأش، مينفعش نمنع حاجة لسه مابدأتش.
 * - غير كده: 14 يوم تجربة + يومين سماح (16 يوم إجمالي) من أول ماتش، وبعدين
 *   ممنوع لحد ما يشترك. */
export async function getSubscriptionStatus(showroomId: string): Promise<SubscriptionStatus> {
  const [sr] = await db.select().from(showrooms).where(eq(showrooms.id, showroomId));
  if (!sr) return { allowed: false, isPro: false, daysLeft: 0 };

  if (sr.subscriptionPlan === "pro") {
    return { allowed: true, isPro: true, daysLeft: null };
  }

  if (!sr.trialStartedAt) {
    return { allowed: true, isPro: false, daysLeft: null };
  }

  const daysElapsed = (Date.now() - sr.trialStartedAt.getTime()) / MS_PER_DAY;
  const totalAllowedDays = TRIAL_DAYS + GRACE_DAYS;
  const allowed = daysElapsed <= totalAllowedDays;
  const daysLeft = Math.max(0, Math.ceil(totalAllowedDays - daysElapsed));

  return { allowed, isPro: false, daysLeft };
}
