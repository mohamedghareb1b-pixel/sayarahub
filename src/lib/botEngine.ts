import { db } from "@/db";
import { sql, eq, and } from "drizzle-orm";
import {
  users,
  showrooms,
  joinRequests,
  salesInvites,
  dailyCheckins,
  requests as requestsTable,
  inventory as inventoryTable,
  vocabularyTerms,
} from "@/db/schema";
import { enqueueMessage, logInbound, type Button } from "./whatsapp";
import { parseFreeText, extractFieldAnswer, lookupCorrection, saveCorrection, type ParsedCar } from "./parser";
import { buildFingerprint } from "./fingerprint";
import { runMatchingForRequest, runMatchingForInventory, confirmMatch, declineMatch } from "./matchingEngine";
import { classifyKeyword, normalizeForMatch } from "./textClean";
import { SAUDI_CITIES, CAR_BRANDS, COLORS, findModelInText } from "./carData";
import { findDynamicBrandAlias, findDynamicTerm, getVocabCache } from "./vocabulary";

type ConversationState = {
  step:
    | "ask_role"
    | "ask_showroom_name"
    | "ask_showroom_city"
    | "ask_showroom_search"
    | "awaiting_join_approval"
    | "awaiting_add_sales_phone"
    | "confirm_parsed"
    | "ask_missing_field"
    | "editing_field"
    | "idle";
  pendingShowroomName?: string;
  pendingParsed?: ParsedCar;
  originalText?: string;
  missingFieldQueue?: string[];
  addSalesPhone?: string;
  editingField?: string;
  pendingJoinShowroomId?: string;
};

const FIELD_QUESTIONS: Record<string, string> = {
  brand: "ما هي ماركة السيارة؟ (مثال: تويوتا)",
  model: "ما هو موديل السيارة؟ (مثال: كامري)",
  year: "ما هي سنة الصنع؟ (مثال: 2025)",
  city: "في أي مدينة؟ (مثال: الرياض)",
  trim: "ما هي الفئة/الدرجة؟ (مثال: ستاندر، فل كامل، كمفورت)",
  color: "ما هي الألوان المتوفرة لديك؟ (لازم تحدد اللون عشان تعرضها للمعارض الأخرى)",
  spec: "ما هي المواصفة/الوكيل؟ (مثال: سعودي، خليجي، أمريكي)",
  extraFeatures: "اكتب الملاحظات الجديدة (مثال: دبل، سقف اسود، داخلي بيج):",
};

const EDITABLE_FIELD_LABELS: { field: string; label: string }[] = [
  { field: "brand", label: "الماركة" },
  { field: "model", label: "الموديل" },
  { field: "trim", label: "الفئة" },
  { field: "year", label: "السنة" },
  { field: "color", label: "اللون" },
  { field: "spec", label: "الوكيل" },
  { field: "city", label: "المكان" },
  { field: "extraFeatures", label: "ملاحظات" },
];

function cityButtons(): Button[] {
  return SAUDI_CITIES.map((c) => ({ id: `city:${c}`, title: c }));
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "").trim();
}

function state(user: typeof users.$inferSelect): ConversationState {
  return (user.conversationState as ConversationState) ?? { step: "idle" };
}

async function setState(userId: string, next: ConversationState) {
  await db.update(users).set({ conversationState: next }).where(eq(users.id, userId));
}

async function reply(phone: string, body: string, buttons?: Button[], toUserId?: string) {
  await enqueueMessage({ toPhone: phone, body, buttons, toUserId, isFree: true });
}

async function findShowroomBySimilarName(name: string) {
  try {
    const result = await db.execute<{ id: string; name: string; city: string; sim: number }>(
      sql`select id, name, city, similarity(name, ${name}) as sim
          from showrooms
          where is_active = true and similarity(name, ${name}) > 0.55
          order by sim desc
          limit 1`,
    );
    return result.rows[0] ?? null;
  } catch {
    // fallback لو إضافة pg_trgm مش مفعّلة في قاعدة البيانات: بحث بسيط بالاسم
    // بدل ما الطلب كله يفشل بصمت (رسالة المستخدم متضيعش من غير رد).
    const result = await db.execute<{ id: string; name: string; city: string }>(
      sql`select id, name, city from showrooms where is_active = true and name ilike ${"%" + name + "%"} limit 1`,
    );
    return result.rows[0] ?? null;
  }
}

/** الأزرار الثابتة اللي المفروض تظهر مع أي رسالة بترجع المستخدم لوضع
 * "خمول" (يعني مفيش طلب شغال دلوقتي) — عشان يكون قدامه دايماً طريقة سريعة
 * يبدأ بيها إدخال سيارة جديدة بدل ما يعتمد بس على الكتابة الحرة. */
function idleMenuButtons(): Button[] {
  return [
    { id: "guided_supply", title: "🚗 عندي سيارة (متوفر)" },
    { id: "guided_demand", title: "🔍 عايز سيارة (مطلوب)" },
  ];
}

/** لو المستخدم في وضع "الإدخال اليدوي خطوة بخطوة" كتب قيمة مش معرّفة عندنا
 * خالص (ماركة/موديل/فئة/لون جديد)، نسجلها تلقائياً في جدول المفردات —
 * بكده النظام بيتعلم من الاستخدام الفعلي بدل ما يستنى حد يضيفها يدوي من
 * /admin/vocabulary. الشرط: بنعمل ده بس في وضع الإدخال اليدوي (مش الكتابة
 * الحرة العادية) عشان منعلمش النظام على حاجات غلط من رسائل مبهمة.
 */
async function autoLearnIfUnknown(field: string, rawAnswer: string, currentBrand: string | null) {
  const value = rawAnswer.trim();
  if (!value || value.length < 2) return;
  const norm = normalizeForMatch(value);

  try {
    if (field === "brand") {
      const known = CAR_BRANDS.some((b) => normalizeForMatch(b.brand) === norm) || findDynamicBrandAlias(norm);
      if (known) return;
      await db
        .insert(vocabularyTerms)
        .values({ category: "brand_alias", term: value, canonicalValue: value, brand: value })
        .onConflictDoNothing();
    } else if (field === "model" && currentBrand) {
      const known = findModelInText(norm)?.model || findDynamicTerm(getVocabCache().trims, norm);
      if (known) return;
      await db
        .insert(vocabularyTerms)
        .values({ category: "model_alias", term: value, canonicalValue: value, brand: currentBrand, model: value })
        .onConflictDoNothing();
    } else if (field === "trim") {
      const known = findDynamicTerm(getVocabCache().trims, norm);
      if (known) return;
      await db
        .insert(vocabularyTerms)
        .values({ category: "trim", term: value, canonicalValue: value })
        .onConflictDoNothing();
    } else if (field === "color") {
      const knownStatic = COLORS.some((c) => normalizeForMatch(c) === norm);
      const knownDynamic = findDynamicTerm(getVocabCache().colors, norm);
      if (knownStatic || knownDynamic) return;
      await db
        .insert(vocabularyTerms)
        .values({ category: "color", term: value, canonicalValue: value })
        .onConflictDoNothing();
    }
  } catch {
    // لو فشل التسجيل (مثلاً تعارض فريد)، نتجاهله بهدوء — الأولوية إن
    // إدخال المستخدم نفسه يكمل عادي.
  }
}

async function doCheckin(user: typeof users.$inferSelect) {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .insert(dailyCheckins)
    .values({ userId: user.id, checkinDate: today })
    .onConflictDoNothing();
  await db
    .update(users)
    .set({
      isActiveToday: true,
      lastCheckinAt: new Date(),
      freeWindowUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .where(eq(users.id, user.id));
  await reply(user.phone, "✅ تم تسجيل حضورك اليوم. بالتوفيق!", idleMenuButtons(), user.id);
}

function notesForStorage(parsed: ParsedCar): string | null {
  const parts = [parsed.extraFeatures];
  if (parsed.seats) parts.push(`${parsed.seats} راكب`);
  if (parsed.fuelType) parts.push(parsed.fuelType);
  if (parsed.transmission) parts.push(parsed.transmission);
  const joined = parts.filter(Boolean).join("، ");
  return joined || null;
}

function summarize(parsed: ParsedCar) {
  const main = [parsed.brand, parsed.model, parsed.year, parsed.trim, parsed.color, parsed.spec, parsed.city]
    .filter(Boolean)
    .join(" ");
  const extras: string[] = [];
  if (parsed.interiorColor) extras.push(`داخلي ${parsed.interiorColor}`);
  if (parsed.extraFeatures) extras.push(parsed.extraFeatures);
  if (parsed.engineSize) extras.push(`موتور ${parsed.engineSize}`);
  if (parsed.seats) extras.push(`${parsed.seats} راكب`);
  if (parsed.fuelType) extras.push(parsed.fuelType);
  if (parsed.transmission) extras.push(parsed.transmission);
  return extras.length > 0 ? `${main}\n📝 ملاحظات: ${extras.join("، ")}` : main;
}

async function registerShowroom(user: typeof users.$inferSelect, pendingName: string | undefined, city: string) {
  const [showroom] = await db
    .insert(showrooms)
    .values({ name: pendingName ?? "معرض بدون اسم", city, ownerUserId: user.id })
    .returning();
  await db
    .update(users)
    .set({ showroomId: showroom.id, role: "owner", onboardingComplete: true, conversationState: { step: "idle" } })
    .where(eq(users.id, user.id));
  await reply(
    user.phone,
    `🎉 تم تسجيل معرض "${showroom.name}" في ${showroom.city}!\nأنت الآن مالك المعرض. اضغط زر "متوفر" أو "مطلوب" تحت عشان تبدأ تضيف أول سيارة:`,
    idleMenuButtons(),
    user.id,
  );
}

async function upsertInventory(showroomId: string, addedBy: string, parsed: ParsedCar) {
  const car = {
    brand: parsed.brand!,
    model: parsed.model!,
    year: parsed.year!,
    trim: parsed.trim,
    color: parsed.color,
    city: parsed.city!,
  };
  const fingerprint = buildFingerprint(car);

  const [existing] = await db
    .select()
    .from(inventoryTable)
    .where(
      and(
        eq(inventoryTable.showroomId, showroomId),
        eq(inventoryTable.fingerprint, fingerprint),
        eq(inventoryTable.status, "available"),
      ),
    );

  if (existing) {
    await db
      .update(inventoryTable)
      .set({
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        price: parsed.price != null ? String(parsed.price) : existing.price,
      })
      .where(eq(inventoryTable.id, existing.id));
    return existing.id;
  }

  const [row] = await db
    .insert(inventoryTable)
    .values({
      showroomId,
      addedBy,
      brand: car.brand,
      model: car.model,
      year: car.year,
      trim: car.trim,
      color: car.color,
      interiorColor: parsed.interiorColor,
      extraFeatures: notesForStorage(parsed),
      engineSize: parsed.engineSize,
      spec: parsed.spec,
      city: car.city,
      price: parsed.price != null ? String(parsed.price) : null,
      quantity: parsed.quantity || 1,
      fingerprint,
    })
    .returning();
  return row.id;
}

async function createRequest(showroomId: string, requestedBy: string, parsed: ParsedCar) {
  const car = {
    brand: parsed.brand!,
    model: parsed.model!,
    year: parsed.year!,
    trim: parsed.trim,
    color: parsed.color,
    city: parsed.city!,
  };
  const fingerprint = buildFingerprint(car);
  const [row] = await db
    .insert(requestsTable)
    .values({
      showroomId,
      requestedBy,
      brand: car.brand,
      model: car.model,
      year: car.year,
      trim: car.trim,
      color: car.color,
      interiorColor: parsed.interiorColor,
      extraFeatures: notesForStorage(parsed),
      engineSize: parsed.engineSize,
      spec: parsed.spec,
      city: car.city,
      fingerprint,
    })
    .returning();
  return row.id;
}

async function finalizeParsed(user: typeof users.$inferSelect, parsed: ParsedCar) {
  if (!user.showroomId) {
    await reply(user.phone, "حسابك غير مرتبط بمعرض بعد.", undefined, user.id);
    return;
  }
  if (parsed.type === "supply") {
    const invId = await upsertInventory(user.showroomId, user.id, parsed);
    await reply(
      user.phone,
      `✅ تم إضافة السيارة لمخزونك: ${summarize(parsed)}\nستبقى متاحة 30 يوم أو حتى يتم توصيلها.`,
      idleMenuButtons(),
      user.id,
    );
    await runMatchingForInventory(invId);
  } else if (parsed.type === "demand") {
    const reqId = await createRequest(user.showroomId, user.id, parsed);
    await reply(
      user.phone,
      `🔎 تم تسجيل طلبك: ${summarize(parsed)}\nسنبحث لك في مخزون بقية المعارض وسنعلمك فور توفر تطابق. الطلب صالح 12 ساعة.`,
      idleMenuButtons(),
      user.id,
    );
    await runMatchingForRequest(reqId);
  } else {
    await reply(
      user.phone,
      "لم أفهم إن كان هذا طلب أم عرض، أرسل مثلاً: مطلوب أو متوفر ثم تفاصيل السيارة.",
      idleMenuButtons(),
      user.id,
    );
  }
}

async function askNextMissingField(user: typeof users.$inferSelect, st: ConversationState) {
  const queue = st.missingFieldQueue ?? [];
  if (queue.length === 0) {
    await setState(user.id, { step: "confirm_parsed", pendingParsed: st.pendingParsed, originalText: st.originalText });
    await reply(
      user.phone,
      `✅ فهمت طلبك: ${summarize(st.pendingParsed!)}\nهل هذا صحيح؟`,
      [
        { id: "confirm_yes", title: "✅ صحيح" },
        { id: "confirm_edit", title: "✏️ تعديل" },
      ],
      user.id,
    );
    return;
  }
  const field = queue[0];
  await setState(user.id, { ...st, step: "ask_missing_field", missingFieldQueue: queue });
  await reply(user.phone, FIELD_QUESTIONS[field] ?? `يرجى تزويدي بـ ${field}`, undefined, user.id);
}

async function handleFreeText(user: typeof users.$inferSelect, text: string) {
  // أولاً: هل سبق تصحيح/تأكيد نص طبيعي مشابه من قبل؟ لو آه نستخدم النتيجة
  // المحفوظة فورًا (أسرع + مجاني)، وإلا نحلل من جديد بالقواعد أو Gemini.
  const cached = await lookupCorrection(text);
  const parsed = cached ?? (await parseFreeText(text));

  if (parsed.type === "unclear" && parsed.missingFields.length >= 3) {
    await reply(
      user.phone,
      "لم أفهم طلبك 🤔 تقدر تجرب توصف السيارة تاني، أو ندخل بياناتها خطوة بخطوة:",
      [
        { id: "guided_supply", title: "🚗 عندي سيارة (متوفر)" },
        { id: "guided_demand", title: "🔍 عايز سيارة (مطلوب)" },
      ],
      user.id,
    );
    return;
  }

  if (parsed.missingFields.length > 0) {
    await setState(user.id, {
      step: "ask_missing_field",
      pendingParsed: parsed,
      originalText: text,
      missingFieldQueue: parsed.missingFields,
    });
    await askNextMissingField(user, { step: "ask_missing_field", pendingParsed: parsed, missingFieldQueue: parsed.missingFields });
    return;
  }

  if (parsed.confidence >= 0.75) {
    await setState(user.id, { step: "confirm_parsed", pendingParsed: parsed, originalText: text });
    await reply(
      user.phone,
      `✅ فهمت طلبك: ${summarize(parsed)}\nهل هذا صحيح؟`,
      [
        { id: "confirm_yes", title: "✅ صحيح" },
        { id: "confirm_edit", title: "✏️ تعديل" },
      ],
      user.id,
    );
    return;
  }

  await finalizeParsed(user, parsed);
}

async function getOrCreateUser(phone: string, name?: string | null) {
  const [existing] = await db.select().from(users).where(eq(users.phone, phone));
  if (existing) {
    if (name && !existing.name) {
      await db.update(users).set({ name }).where(eq(users.id, existing.id));
      return { ...existing, name };
    }
    return existing;
  }
  const [created] = await db
    .insert(users)
    .values({ phone, name, conversationState: { step: "ask_role" } })
    .returning();
  return created;
}

export async function handleIncomingMessage(input: {
  phone: string;
  name?: string | null;
  text?: string;
  buttonId?: string;
}) {
  const phone = normalizePhone(input.phone);
  const text = (input.text ?? "").trim();
  await logInbound(phone, input.buttonId ? `[زر] ${input.buttonId}` : text);

  const user = await getOrCreateUser(phone, input.name);
  const st = state(user);

  // ── Global buttons (work regardless of onboarding step) ────────────────
  if (input.buttonId) {
    const btn = input.buttonId;

    if (btn === "role_owner" || btn === "role_sales") {
      if (btn === "role_owner") {
        await setState(user.id, { step: "ask_showroom_name" });
        await reply(user.phone, "تمام 👍 ما اسم معرضك؟", undefined, user.id);
      } else {
        await setState(user.id, { step: "ask_showroom_search" });
        await reply(user.phone, "ما اسم المعرض الذي تعمل به؟", undefined, user.id);
      }
      return;
    }

    if (btn === "checkin") return doCheckin(user);

    if (btn === "guided_supply" || btn === "guided_demand") {
      const type: "supply" | "demand" = btn === "guided_supply" ? "supply" : "demand";
      const empty: ParsedCar = {
        type,
        brand: null,
        model: null,
        year: null,
        trim: null,
        color: null,
        interiorColor: null,
        extraFeatures: null,
        engineSize: null,
        seats: null,
        fuelType: null,
        transmission: null,
        spec: "سعودي",
        city: null,
        quantity: 1,
        price: null,
        confidence: 1,
        missingFields: [],
      };
      // نبني قائمة الأسئلة بالترتيب: الحقول الأساسية دايماً، واللون كمان لو
      // ده عرض سيارة (لازم يحدد الألوان المتوفرة عنده تحديداً).
      const queue = ["brand", "model", "trim", "year", "city"];
      if (type === "supply") queue.push("color");
      await setState(user.id, { step: "ask_missing_field", pendingParsed: empty, missingFieldQueue: queue });
      await askNextMissingField(user, { step: "ask_missing_field", pendingParsed: empty, missingFieldQueue: queue });
      return;
    }

    if (btn === "retry_showroom_search") {
      await setState(user.id, { step: "ask_showroom_search" });
      await reply(user.phone, "اكتب اسم المعرض:", undefined, user.id);
      return;
    }

    if (btn === "register_as_owner") {
      await setState(user.id, { step: "ask_showroom_city", pendingShowroomName: st.pendingShowroomName });
      await reply(user.phone, "تمام! وفي أي مدينة يقع المعرض؟", cityButtons(), user.id);
      return;
    }

    if (btn === "joinconfirm_no") {
      await setState(user.id, { step: "ask_showroom_search" });
      await reply(user.phone, "تمام، اكتب اسم المعرض الصحيح:", undefined, user.id);
      return;
    }

    if (btn === "joinconfirm_yes" && st.pendingJoinShowroomId) {
      const showroomId = st.pendingJoinShowroomId;
      const [found] = await db.select().from(showrooms).where(eq(showrooms.id, showroomId));
      if (!found) {
        await setState(user.id, { step: "ask_showroom_search" });
        await reply(user.phone, "حصل خطأ، اكتب اسم المعرض تاني:", undefined, user.id);
        return;
      }
      const [jr] = await db.insert(joinRequests).values({ userId: user.id, showroomId }).returning();
      await setState(user.id, { step: "awaiting_join_approval" });
      await reply(user.phone, `تم إرسال طلب انضمامك لمعرض "${found.name}"، بانتظار موافقة صاحب المعرض.`, undefined, user.id);
      if (found.ownerUserId) {
        const [owner] = await db.select().from(users).where(eq(users.id, found.ownerUserId));
        if (owner) {
          await reply(
            owner.phone,
            `👋 ${user.name ?? phone} يطلب الانضمام كمندوب في معرضك "${found.name}"`,
            [
              { id: `join_approve_${jr.id}`, title: "✅ موافق" },
              { id: `join_reject_${jr.id}`, title: "❌ رفض" },
            ],
            owner.id,
          );
        }
      }
      return;
    }

    if (btn.startsWith("editfield:") && st.pendingParsed) {
      const field = btn.replace("editfield:", "");
      await setState(user.id, {
        step: "editing_field",
        pendingParsed: st.pendingParsed,
        originalText: st.originalText,
        editingField: field,
      });
      if (field === "city") {
        await reply(user.phone, "اختر المدينة:", cityButtons(), user.id);
      } else {
        await reply(user.phone, FIELD_QUESTIONS[field] ?? `اكتب القيمة الجديدة لـ ${field}`, undefined, user.id);
      }
      return;
    }

    if (btn.startsWith("city:")) {
      const cityName = btn.replace("city:", "");

      // حالة 1: اختيار المدينة أثناء تسجيل معرض جديد لأول مرة
      if (st.step === "ask_showroom_city") {
        await registerShowroom(user, st.pendingShowroomName, cityName);
        return;
      }

      // حالة 2: اختيار المدينة أثناء تعديل حقل "المكان" في طلب/عرض قائم
      if (st.step === "editing_field" && st.editingField === "city" && st.pendingParsed) {
        const updated: ParsedCar = { ...st.pendingParsed, city: cityName };
        updated.missingFields = updated.missingFields.filter((f) => f !== "city");
        await setState(user.id, { step: "confirm_parsed", pendingParsed: updated, originalText: st.originalText });
        await reply(
          user.phone,
          `✅ تحديث: ${summarize(updated)}\nهل هذا صحيح؟`,
          [
            { id: "confirm_yes", title: "✅ صحيح" },
            { id: "confirm_edit", title: "✏️ تعديل حقل تاني" },
          ],
          user.id,
        );
        return;
      }
      return;
    }

    if (btn.startsWith("join_approve_") || btn.startsWith("join_reject_")) {
      const id = btn.replace("join_approve_", "").replace("join_reject_", "");
      const [jr] = await db.select().from(joinRequests).where(eq(joinRequests.id, id));
      if (!jr) return;
      const approved = btn.startsWith("join_approve_");
      await db
        .update(joinRequests)
        .set({ status: approved ? "approved" : "rejected", respondedAt: new Date() })
        .where(eq(joinRequests.id, id));
      if (jr.userId) {
        const [salesUser] = await db.select().from(users).where(eq(users.id, jr.userId));
        if (salesUser) {
          if (approved && jr.showroomId) {
            await db
              .update(users)
              .set({ showroomId: jr.showroomId, role: "sales", onboardingComplete: true, conversationState: { step: "idle" } })
              .where(eq(users.id, salesUser.id));
            await reply(salesUser.phone, "🎉 تم قبولك كمندوب في المعرض! يمكنك الآن إرسال طلبات أو سيارات متوفرة بحرية.", undefined, salesUser.id);
          } else {
            await reply(salesUser.phone, "❌ للأسف تم رفض طلب انضمامك من صاحب المعرض.", undefined, salesUser.id);
          }
        }
      }
      await reply(user.phone, approved ? "تم القبول ✅" : "تم الرفض ❌", undefined, user.id);
      return;
    }

    if (btn.startsWith("invite_accept_") || btn.startsWith("invite_reject_")) {
      const id = btn.replace("invite_accept_", "").replace("invite_reject_", "");
      const [invite] = await db.select().from(salesInvites).where(eq(salesInvites.id, id));
      if (!invite) return;
      const accepted = btn.startsWith("invite_accept_");
      await db.update(salesInvites).set({ status: accepted ? "accepted" : "rejected" }).where(eq(salesInvites.id, id));
      if (accepted) {
        await db
          .update(users)
          .set({ showroomId: invite.showroomId, role: "sales", onboardingComplete: true, conversationState: { step: "idle" } })
          .where(eq(users.id, user.id));
        await reply(user.phone, "🎉 تم تسجيلك كمندوب في المعرض بنجاح!", undefined, user.id);
      } else {
        await reply(user.phone, "تم إلغاء الدعوة.", undefined, user.id);
      }
      return;
    }

    if (btn === "confirm_yes" && st.pendingParsed) {
      await setState(user.id, { step: "idle" });
      if (st.originalText) {
        saveCorrection(st.originalText, st.pendingParsed, "user_confirmed").catch(() => {});
      }
      await finalizeParsed(user, st.pendingParsed);
      return;
    }
    if (btn === "confirm_edit" && st.pendingParsed) {
      await setState(user.id, { step: "confirm_parsed", pendingParsed: st.pendingParsed, originalText: st.originalText });
      await reply(
        user.phone,
        "أي حقل عايز تعدّله؟",
        EDITABLE_FIELD_LABELS.map((f) => ({ id: `editfield:${f.field}`, title: f.label })),
        user.id,
      );
      return;
    }

    if (btn.startsWith("match_yes_")) {
      const matchId = btn.replace("match_yes_", "");
      await confirmMatch(matchId);
      await reply(user.phone, "✅ تم تأكيد التوفر، سيتم توصيلك بالمعرض الطالب الآن.", undefined, user.id);
      return;
    }
    if (btn.startsWith("match_no_")) {
      const matchId = btn.replace("match_no_", "");
      await declineMatch(matchId, "declined");
      await reply(user.phone, "تم تحديث الحالة، شكراً لك.", undefined, user.id);
      return;
    }

    if (btn.startsWith("renew_")) {
      const reqId = btn.replace("renew_", "");
      await db
        .update(requestsTable)
        .set({ expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), reminderSent: false, renewedCount: sql`${requestsTable.renewedCount} + 1` })
        .where(eq(requestsTable.id, reqId));
      await reply(user.phone, "🔄 تم تجديد الطلب لمدة 12 ساعة إضافية.", undefined, user.id);
      return;
    }
    if (btn.startsWith("cancel_")) {
      const reqId = btn.replace("cancel_", "");
      await db.update(requestsTable).set({ status: "cancelled" }).where(eq(requestsTable.id, reqId));
      await reply(user.phone, "تم إلغاء الطلب.", undefined, user.id);
      return;
    }
  }

  // ── Onboarding ───────────────────────────────────────────────────────
  if (!user.onboardingComplete) {
    if (st.step === "ask_role" || !st.step) {
      if (text.includes("صاحب")) {
        await setState(user.id, { step: "ask_showroom_name" });
        await reply(user.phone, "تمام 👍 ما اسم معرضك؟", undefined, user.id);
        return;
      }
      if (text.includes("مندوب")) {
        await setState(user.id, { step: "ask_showroom_search" });
        await reply(user.phone, "ما اسم المعرض الذي تعمل به؟", undefined, user.id);
        return;
      }
      await reply(
        user.phone,
        "أهلاً بك في SayaraHub 🚗\nهل أنت صاحب معرض أم مندوب مبيعات؟",
        [
          { id: "role_owner", title: "صاحب معرض" },
          { id: "role_sales", title: "مندوب" },
        ],
        user.id,
      );
      return;
    }

    if (st.step === "ask_showroom_name") {
      await setState(user.id, { step: "ask_showroom_city", pendingShowroomName: text });
      await reply(user.phone, "وفي أي مدينة يقع المعرض؟", cityButtons(), user.id);
      return;
    }

    if (st.step === "ask_showroom_city") {
      await registerShowroom(user, st.pendingShowroomName, text);
      return;
    }

    if (st.step === "ask_showroom_search") {
      const found = await findShowroomBySimilarName(text);
      if (found) {
        // منبعتش طلب الانضمام مباشرة — لازم تأكيد صريح من المستخدم الأول،
        // عشان تشابه الأسماء (زي "معرض الغريب" و"معرض السلطان") كان بيسبب
        // ربط المندوب بمعرض غلط تماماً من غير ما حد يلاحظ.
        await setState(user.id, { step: "ask_showroom_search", pendingJoinShowroomId: found.id });
        await reply(
          user.phone,
          `هل تقصد معرض "${found.name}" في ${found.city}؟`,
          [
            { id: `joinconfirm_yes`, title: "✅ نعم" },
            { id: `joinconfirm_no`, title: "❌ لا، اسم تاني" },
          ],
          user.id,
        );
      } else {
        await setState(user.id, { step: "ask_showroom_search", pendingShowroomName: text });
        await reply(
          user.phone,
          `لم أجد معرض بهذا الاسم "${text}".\nممكن يكون المعرض ده لسه مسجل عندنا، وإنت أول واحد بيدخل منه — تقدر تسجله بنفسك كصاحب معرض.`,
          [
            { id: "register_as_owner", title: "🏢 سجّل المعرض ده" },
            { id: "retry_showroom_search", title: "✏️ اكتب اسم تاني" },
          ],
          user.id,
        );
      }
      return;
    }

    if (st.step === "awaiting_join_approval") {
      await reply(user.phone, "طلبك قيد المراجعة من صاحب المعرض، سيتم إشعارك فور الموافقة.", undefined, user.id);
      return;
    }
  }

  // ── Onboarded user flows ─────────────────────────────────────────────
  // لو الرسالة الجديدة فيها كلمة صريحة "متوفر" أو "مطلوب"، فهي غالباً طلب
  // جديد كامل من المستخدم، مش رد على سؤال قديم معلّق (فئة ناقصة/تأكيد).
  // في الحالة دي نقفل أي محادثة معلقة ونبدأ من جديد بدل دمج بيانات قديمة
  // مع الرسالة الجديدة، وده كان بيسبب خلط بيانات من طلب سابق مع طلب حالي.
  const looksLikeFreshRequest =
    (st.step === "confirm_parsed" || st.step === "ask_missing_field") &&
    classifyKeyword(text) !== "unknown";

  if (looksLikeFreshRequest) {
    await setState(user.id, { step: "idle" });
    await handleFreeText(user, text);
    return;
  }

  if (st.step === "confirm_parsed" && st.pendingParsed) {
    if (text.includes("صحيح") || text === "نعم") {
      await setState(user.id, { step: "idle" });
      if (st.originalText) {
        saveCorrection(st.originalText, st.pendingParsed, "user_confirmed").catch(() => {});
      }
      await finalizeParsed(user, st.pendingParsed);
      return;
    }
    if (text.includes("تعديل")) {
      await setState(user.id, { step: "idle" });
      await reply(user.phone, "تمام، أرسل تفاصيل السيارة الصحيحة من جديد.", undefined, user.id);
      return;
    }
    await reply(
      user.phone,
      `هل هذا صحيح: ${summarize(st.pendingParsed)}؟`,
      [
        { id: "confirm_yes", title: "✅ صحيح" },
        { id: "confirm_edit", title: "✏️ تعديل" },
      ],
      user.id,
    );
    return;
  }

  if (st.step === "editing_field" && st.pendingParsed && st.editingField) {
    const field = st.editingField;
    const value = extractFieldAnswer(field, text);
    const updated = { ...st.pendingParsed, [field]: value } as ParsedCar;
    updated.missingFields = updated.missingFields.filter((f) => f !== field);

    await setState(user.id, { step: "confirm_parsed", pendingParsed: updated, originalText: st.originalText });
    await reply(
      user.phone,
      `✅ تحديث: ${summarize(updated)}\nهل هذا صحيح؟`,
      [
        { id: "confirm_yes", title: "✅ صحيح" },
        { id: "confirm_edit", title: "✏️ تعديل حقل تاني" },
      ],
      user.id,
    );
    return;
  }

  if (st.step === "ask_missing_field" && st.pendingParsed) {
    const queue = [...(st.missingFieldQueue ?? [])];
    const field = queue.shift();
    const parsed = { ...st.pendingParsed } as ParsedCar & Record<string, unknown>;

    if (field) {
      // استخرج القيمة الصح للحقل المطلوب من رد المستخدم (بدل تخزين النص الخام)
      const value = extractFieldAnswer(field, text);
      (parsed as Record<string, unknown>)[field] = value;

      // في وضع "الإدخال اليدوي خطوة بخطوة" (مش الكتابة الحرة العادية)، لو
      // القيمة دي مش معرّفة عندنا خالص، سجّلها تلقائياً كمفردة جديدة —
      // بكده النظام "يتعلم" من كل إدخال يدوي بدون ما يحتاج تدخل يدوي منك.
      if (st.pendingParsed.confidence === 1 && typeof value === "string") {
        await autoLearnIfUnknown(field, value, parsed.brand);
      }

      // كمان: أعد فحص الرد كامل، لأن المستخدم غالباً بيبعت كل التفاصيل مرة واحدة
      // (زي "تويوتا كامري ستاندر ابيض 2026 سعودي بالرياض") مش بس الحقل المطلوب
      const rescan = await parseFreeText(text);
      const fieldsToFill: (keyof ParsedCar)[] = ["brand", "model", "year", "trim", "color", "spec", "city"];
      for (const f of fieldsToFill) {
        if (!parsed[f] && rescan[f]) {
          (parsed as Record<string, unknown>)[f] = rescan[f];
        }
      }

      // شيل من قايمة الأسئلة أي حقل اتملى فعلاً من إعادة الفحص
      const stillMissing = queue.filter((q) => !parsed[q as keyof ParsedCar]);
      queue.length = 0;
      queue.push(...stillMissing);
    }

    await askNextMissingField(user, { step: "ask_missing_field", pendingParsed: parsed, originalText: st.originalText, missingFieldQueue: queue });
    return;
  }

  if (st.step === "awaiting_add_sales_phone") {
    const targetPhone = normalizePhone(text);
    if (!user.showroomId) return;
    const [showroom] = await db.select().from(showrooms).where(eq(showrooms.id, user.showroomId));
    const [invite] = await db
      .insert(salesInvites)
      .values({ showroomId: user.showroomId, phone: targetPhone, invitedBy: user.id })
      .returning();
    await reply(
      targetPhone,
      `👋 معرض "${showroom?.name}" أضافك كمندوب. هل أنت مندوب في هذا المعرض؟`,
      [
        { id: `invite_accept_${invite.id}`, title: "✅ نعم" },
        { id: `invite_reject_${invite.id}`, title: "❌ لا" },
      ],
    );
    await setState(user.id, { step: "idle" });
    await reply(user.phone, "تم إرسال الدعوة ✅", undefined, user.id);
    return;
  }

  // Default idle-state commands
  if (text.includes("اضف مندوب") || text.includes("أضف مندوب")) {
    if (user.role !== "owner") {
      await reply(user.phone, "هذا الأمر متاح فقط لصاحب المعرض.", undefined, user.id);
      return;
    }
    await setState(user.id, { step: "awaiting_add_sales_phone" });
    await reply(user.phone, "أرسل رقم جوال المندوب (مثال: 0512345678)", undefined, user.id);
    return;
  }

  if (text.includes("صباح الخير") || text.includes("موجود اليوم") || text === "حاضر") {
    await doCheckin(user);
    return;
  }

  if (text.length === 0) {
    await reply(
      user.phone,
      "أرسل وصف السيارة (مطلوبة أو متوفرة)، أو دوس على أحد الزرارين تحت، أو اكتب 'صباح الخير' لتسجيل حضورك.",
      idleMenuButtons(),
      user.id,
    );
    return;
  }

  await handleFreeText(user, text);
}
