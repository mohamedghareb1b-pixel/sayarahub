"use server";

import { db } from "@/db";
import { showrooms, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "").trim();
}

/** يسجّل معرض + صاحبه مسبقاً قبل ما يتواصل هو نفسه مع البوت خالص. أول ما
 * يبعت أي رسالة من رقمه الحقيقي، النظام هيلاقي حسابه جاهز ويكمل عادي من
 * غير أي خطوات تسجيل (onboarding) — عشان نقدر نجهز بيئة العمل بالكامل
 * (المعرض + مخزونه) قبل ما صاحبه يعرف أصلاً إن عنده حساب. */
export async function createPresetShowroom(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const ownerPhone = normalizePhone(String(formData.get("ownerPhone") ?? ""));
  const ownerName = String(formData.get("ownerName") ?? "").trim() || null;
  if (!name || !city || !ownerPhone) return;

  const [existingUser] = await db.select().from(users).where(eq(users.phone, ownerPhone));
  if (existingUser?.showroomId) return; // عنده معرض بالفعل، منعملش تكرار

  const [showroom] = await db.insert(showrooms).values({ name, city }).returning();

  if (existingUser) {
    await db
      .update(users)
      .set({
        showroomId: showroom.id,
        role: "owner",
        onboardingComplete: true,
        name: existingUser.name ?? ownerName,
        conversationState: { step: "idle" },
      })
      .where(eq(users.id, existingUser.id));
  } else {
    await db.insert(users).values({
      phone: ownerPhone,
      name: ownerName,
      showroomId: showroom.id,
      role: "owner",
      onboardingComplete: true,
      conversationState: { step: "idle" },
    });
  }

  await db.update(showrooms).set({ ownerUserId: existingUser?.id }).where(eq(showrooms.id, showroom.id));

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
