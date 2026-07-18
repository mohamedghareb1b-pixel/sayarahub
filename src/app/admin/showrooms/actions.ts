"use server";

import { db } from "@/db";
import { showrooms, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "").trim();
}

/** يسجّل معرض بس (الاسم والمدينة)، من غير ما يحدد صاحبه دلوقتي — صاحبه
 * هيربط نفسه بيه لما يبدأ يتواصل مع البوت (أو الأدمن يضيفه بعدين يدوياً
 * لو حابب من نفس الشاشة). */
export async function createPresetShowroom(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  if (!name || !city) return;

  await db.insert(showrooms).values({ name, city });
  revalidatePath("/admin/showrooms");
}

/** يسجّل مندوب "حر" (مش تابع لأي معرض لسه) — بيانات أساسية بس: اسمه،
 * رقمه، مدينته. تقدر تربطه بمعرض لاحقاً بمجرد ما يتأكد فين هيشتغل. */
export async function createFreeSalesRep(formData: FormData) {
  const name = String(formData.get("repName") ?? "").trim() || null;
  const phone = normalizePhone(String(formData.get("repPhone") ?? ""));
  const city = String(formData.get("repCity") ?? "").trim() || null;
  if (!phone) return;

  const [existing] = await db.select().from(users).where(eq(users.phone, phone));
  if (existing) {
    await db.update(users).set({ name: existing.name ?? name, city: existing.city ?? city }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({
      phone,
      name,
      city,
      role: "sales",
      showroomId: null,
      onboardingComplete: false,
      conversationState: { step: "ask_role" },
    });
  }
  revalidatePath("/admin/showrooms");
}

/** يسجّل مندوب مسبقاً تحت معرض موجود، بنفس منطق التسجيل المسبق للمعارض. */
export async function addPresetSalesRep(formData: FormData) {
  const showroomId = String(formData.get("showroomId") ?? "").trim();
  const phone = normalizePhone(String(formData.get("salesPhone") ?? ""));
  const name = String(formData.get("salesName") ?? "").trim() || null;
  if (!showroomId || !phone) return;

  const [existingUser] = await db.select().from(users).where(eq(users.phone, phone));

  if (existingUser) {
    await db
      .update(users)
      .set({
        showroomId,
        role: "sales",
        onboardingComplete: true,
        name: existingUser.name ?? name,
        conversationState: { step: "idle" },
      })
      .where(eq(users.id, existingUser.id));
  } else {
    await db.insert(users).values({
      phone,
      name,
      showroomId,
      role: "sales",
      onboardingComplete: true,
      conversationState: { step: "idle" },
    });
  }

  revalidatePath("/admin/showrooms");
}

export async function toggleShowroomActive(id: string, isActive: boolean) {
  await db.update(showrooms).set({ isActive: !isActive }).where(eq(showrooms.id, id));
  revalidatePath("/admin/showrooms");
}

export async function updateUserName(userId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  await db.update(users).set({ name: name || null }).where(eq(users.id, userId));
  revalidatePath("/admin/showrooms");
}

/** يفصل المندوب عن المعرض (بدون حذف حسابه بالكامل) — لو غلط انضم لمعرض غلط
 * أو سابه فعلياً، ده بيرجعه لحالة "بدون معرض" بدل حذفه نهائياً. */
export async function removeUserFromShowroom(userId: string) {
  await db
    .update(users)
    .set({ showroomId: null, role: "sales", onboardingComplete: false, conversationState: { step: "ask_role" } })
    .where(eq(users.id, userId));
  revalidatePath("/admin/showrooms");
}

/** حذف نهائي لحساب المستخدم بالكامل (لو رقم غلط تماماً أو حساب تجربة). */
export async function deleteUserAccount(userId: string) {
  await db.delete(users).where(eq(users.id, userId));
  revalidatePath("/admin/showrooms");
}

/** حذف المعرض نهائياً (المخزون والطلبات المرتبطة بيه بتتأثر حسب علاقات
 * قاعدة البيانات — استخدمها بحذر، الأفضل "حظر" المعرض بدل حذفه لو ممكن). */
export async function deleteShowroom(showroomId: string) {
  await db.update(users).set({ showroomId: null }).where(eq(users.showroomId, showroomId));
  await db.delete(showrooms).where(eq(showrooms.id, showroomId));
  revalidatePath("/admin/showrooms");
}
export async function setSubscriptionPlan(id: string, plan: "free" | "pro") {
  await db
    .update(showrooms)
    .set({
      subscriptionPlan: plan,
      maxConfirmedMatches: plan === "pro" ? 999999 : 10,
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .where(eq(showrooms.id, id));
  revalidatePath("/admin/showrooms");
}
