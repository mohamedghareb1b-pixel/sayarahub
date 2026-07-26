"use server";

import { db } from "@/db";
import { users, showrooms, requests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { buildFingerprint } from "@/lib/fingerprint";
import { runMatchingForRequest } from "@/lib/matchingEngine";

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "").trim();
}

/** يدوّر على مستخدم برقمه، ولو مش موجود بيعمله "معرض شخصي" فوراً (زي مندوب
 * حر) عشان يكون عنده showroomId يقدر نربط بيه الطلب على طول — من غير ما
 * ننتظره يسجل بنفسه. onboardingComplete بتتحط true مباشرة عشان مايتحطش في
 * فلو تسجيل إجباري؛ اسمه ومدينته الحقيقية يقدر يعدّلهم بعدين بنفسه من
 * "✏️ تعديل بياناتي". */
async function findOrCreateRepByPhone(phone: string, cityGuess: string) {
  const [existing] = await db.select().from(users).where(eq(users.phone, phone));
  if (existing) return existing;

  const [pool] = await db
    .insert(showrooms)
    .values({ name: `مندوب ${phone}`, city: cityGuess || "غير محدد", isPersonalPool: true })
    .returning();

  const [created] = await db
    .insert(users)
    .values({
      phone,
      name: null,
      city: cityGuess || null,
      role: "sales",
      showroomId: pool.id,
      onboardingComplete: true,
      conversationState: { step: "idle" },
    })
    .returning();

  await db.update(showrooms).set({ ownerUserId: created.id }).where(eq(showrooms.id, pool.id));
  return created;
}

/** طلب "نص عادي ونص أوتوماتيك": الأدمن بيدخل بس رقم المندوب الطالب وتفاصيل
 * السيارة (المدينة اختيارية ومش شرط للمطابقة)، وبعدين محرك المطابقة العادي
 * (runMatchingForRequest) هو اللي بيدوّر تلقائي على أي مخزون متاح مطابق
 * (بالماركة/الموديل/الفئة/السنة بس) ويبعت رسالة البث العادية لكل مندوب عنده
 * تطابق — مفيش تحديد يدوي لمين "عنده" السيارة. */
export async function createMarketingRequest(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const requesterPhone = normalizePhone(String(formData.get("requesterPhone") ?? ""));
  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const trim = String(formData.get("trim") ?? "").trim() || null;
  const year = parseInt(String(formData.get("year") ?? "").trim(), 10);
  const color = String(formData.get("color") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || "غير محدد";
  const specInput = String(formData.get("spec") ?? "").trim() || "سعودي";
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!requesterPhone) {
    return { ok: false, message: "رقم المندوب الطالب إجباري." };
  }
  if (!brand || !model || !year) {
    return { ok: false, message: "الماركة والموديل وسنة الصنع إجبارية." };
  }

  const requesterUser = await findOrCreateRepByPhone(requesterPhone, city);
  if (!requesterUser.showroomId) {
    return { ok: false, message: "حصل خطأ في إنشاء المعرض التلقائي، جرب تاني." };
  }

  const fingerprint = buildFingerprint({ brand, model, year, trim, color, city });

  const [req] = await db
    .insert(requests)
    .values({
      showroomId: requesterUser.showroomId,
      requestedBy: requesterUser.id,
      brand,
      model,
      year,
      trim,
      color,
      city,
      spec: specInput,
      extraFeatures: note,
      fingerprint,
      status: "open",
    })
    .returning();

  const createdMatches = await runMatchingForRequest(req.id);

  revalidatePath("/admin/marketing");
  revalidatePath("/admin/matches");

  if (createdMatches.length === 0) {
    return {
      ok: true,
      message: "تم تسجيل الطلب، بس مفيش حد عنده مخزون مطابق دلوقتي — هيتماتش تلقائي أول ما حد يضيف سيارة مطابقة.",
    };
  }
  return {
    ok: true,
    message: `تم تسجيل الطلب وبعتنا رسالة تلقائي لـ${createdMatches.length} مندوب عندهم مخزون مطابق. تابع الردود من صفحة "المطابقات".`,
  };
}
