import { db } from "@/db";
import { sql, eq, and } from "drizzle-orm";
import {
  users,
  showrooms,
  salesInvites,
  dailyCheckins,
  requests as requestsTable,
  inventory as inventoryTable,
  vocabularyTerms,
  vocabularyReviewQueue,
} from "@/db/schema";
import { enqueueMessage, logInbound, type Button } from "./whatsapp";
import { parseFreeText, extractFieldAnswer, lookupCorrection, saveCorrection, EXTRA_FEATURE_WORDS, type ParsedCar } from "./parser";
import { buildFingerprint } from "./fingerprint";
import { runMatchingForRequest, runMatchingForInventory, confirmMatch, declineMatch } from "./matchingEngine";
import { classifyKeyword, normalizeForMatch } from "./textClean";
import { SAUDI_CITIES, CAR_BRANDS, COLORS, findModelInText } from "./carData";
import { findDynamicBrandAlias, findDynamicTerm, getVocabCache } from "./vocabulary";

type ConversationState = {
  step:
    | "ask_rep_name"
    | "ask_rep_label"
    | "ask_rep_city"
    | "awaiting_add_sales_phone"
    | "confirm_parsed"
    | "ask_missing_field"
    | "editing_field"
    | "idle";
  pendingRepName?: string;
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
  year: "ما هي سنة الصنع؟ (مثال: 2025) — لو طلب ومرن في أكتر من سنة، اكتبهم مفصولين بـ / مثال: 2024/2025",
  city: "في أي مدينة؟ (مثال: الرياض)",
  trim: "ما هي الفئة/الدرجة؟ ينفع تكتب أكتر من فئة مفصولين بـ / أو - (مثال: ستاندر/فل كامل)",
  color: "ما هي الألوان المتوفرة؟ ينفع تكتب أكتر من لون مفصولين بـ / أو - (مثال: أبيض/أحمر)",
  spec: "ما هي المواصفة/الوكيل؟ (مثال: سعودي، خليجي، أمريكي) — أو اكتب - للتخطي (هتبقى سعودي تلقائياً)",
  extraFeatures:
    "في ملاحظات تحب تضيفها؟ افصل بين كل ملاحظة والتانية بـ - (مثال: دبل - سقف اسود) — أو اكتب - للتخطي بدون ملاحظات",
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
    { id: "excel_via_admin", title: "📊 عندي ملف إكسل" },
  ];
}

// رقم واتساب الأدمن اللي بيستقبل ملفات الإكسل ويرفعها بنفسه من لوحة التحكم
// بدل ما نبني استقبال ملفات معقّد جوه واتساب مباشرة.
const ADMIN_EXCEL_PHONE = "201125472360";

/** لو المستخدم في وضع "الإدخال اليدوي خطوة بخطوة" كتب قيمة مش معرّفة عندنا
 * خالص (ماركة/موديل/فئة/لون جديد)، بنسجلها في "قايمة انتظار مراجعة" — الطلب
 * أو العرض نفسه بيكمل عادي بالنص الخام اللي كتبه، ومش بنسجلها في المفردات
 * الرسمية تلقائي. الأدمن بعدين يراجعها من /admin/vocabulary ويحدد القيمة
 * الرسمية بنفسه قبل ما تتفعّل فعلياً — عشان نضمن جودة المفردات المسجلة.
 */
async function flagUnknownTermForReview(field: string, rawAnswer: string, currentBrand: string | null) {
  const value = rawAnswer.trim();
  if (!value || value.length < 2) return;
  const norm = normalizeForMatch(value);

  const categoryMap: Record<string, "brand_alias" | "model_alias" | "trim" | "color" | "feature"> = {
    brand: "brand_alias",
    model: "model_alias",
    trim: "trim",
    color: "color",
    feature: "feature",
  };
  const category = categoryMap[field];
  if (!category) return;

  try {
    let known = false;
    if (field === "brand") {
      known = CAR_BRANDS.some((b) => normalizeForMatch(b.brand) === norm) || Boolean(findDynamicBrandAlias(norm));
    } else if (field === "model") {
      known = Boolean(findModelInText(norm)?.model);
    } else if (field === "trim") {
      known = Boolean(findDynamicTerm(getVocabCache().trims, norm));
    } else if (field === "color") {
      known = COLORS.some((c) => normalizeForMatch(c) === norm) || Boolean(findDynamicTerm(getVocabCache().colors, norm));
    } else if (field === "feature") {
      known =
        EXTRA_FEATURE_WORDS.some((w) => normalizeForMatch(w) === norm) ||
        Boolean(findDynamicTerm(getVocabCache().features, norm));
    }
    if (known) return;

    const [existing] = await db
      .select()
      .from(vocabularyReviewQueue)
      .where(and(eq(vocabularyReviewQueue.term, value), eq(vocabularyReviewQueue.category, category)));

    if (existing) {
      await db
        .update(vocabularyReviewQueue)
        .set({ occurrences: sql`${vocabularyReviewQueue.occurrences} + 1` })
        .where(eq(vocabularyReviewQueue.id, existing.id));
    } else {
      await db.insert(vocabularyReviewQueue).values({
        category,
        term: value,
        brand: field === "model" ? currentBrand : null,
      });
    }
  } catch {
    // لو فشل التسجيل لأي سبب، نتجاهله بهدوء — إدخال المستخدم الأساسي أهم
    // ومكملش عادي حتى لو ملحقناش نسجل الكلمة في قايمة المراجعة.
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

async function completeRepRegistration(
  user: typeof users.$inferSelect,
  repName: string | undefined,
  workLabel: string | undefined,
  city: string,
) {
  // كل مندوب مستقل تماماً بمخزونه الخاص — بننشئله "معرض شخصي" يمثل شغله
  // (مجرد اسم/تسمية، مش معرض بمعنى تنظيمي مرتبط بحد تاني).
  const [pool] = await db
    .insert(showrooms)
    .values({ name: workLabel ?? `مندوب ${user.phone}`, city, isPersonalPool: true })
    .returning();

  await db
    .update(users)
    .set({
      name: repName ?? user.name,
      showroomId: pool.id,
      role: "sales",
      onboardingComplete: true,
      conversationState: { step: "idle" },
    })
    .where(eq(users.id, user.id));
  await db.update(showrooms).set({ ownerUserId: user.id }).where(eq(showrooms.id, pool.id));

  await reply(
    user.phone,
    `🎉 تمام يا ${repName ?? ""}! سجلناك بنجاح.\n📍 ${workLabel ?? ""} — ${city}\n\nتقدر تعدّل بياناتك في أي وقت من زر "تعديل بياناتي" تحت.`,
    [
      { id: "excel_via_admin", title: "📤 أرسل مخزونك" },
      { id: "work_details", title: "📋 تفاصيل العمل" },
      { id: "edit_profile", title: "✏️ تعديل بياناتي" },
    ],
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
      idleMenuButtons(),
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
    .values({ phone, name, conversationState: { step: "ask_rep_name" } })
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

    if (btn === "checkin") return doCheckin(user);

    if (btn === "excel_via_admin") {
      await reply(
        user.phone,
        `📊 تمام! ابعت ملف الإكسل بتاعك مباشرة على الرقم ده وهنرفعه لمخزونك بأنفسنا:\n\nwa.me/${ADMIN_EXCEL_PHONE}\n\n(لازم يكون الملف بنفس قالبنا الرسمي عشان نقدر نرفعه صح)`,
        idleMenuButtons(),
        user.id,
      );
      return;
    }

    if (btn === "work_details") {
      await reply(
        user.phone,
        `📋 إزاي بنشتغل:\n\n1️⃣ تبعتلنا مخزونك (السيارات المتوفرة عندك) وإحنا برفعها لحسابك.\n2️⃣ أي حد يدور على ماركة/موديل/سنة موجودة في مخزونك، هتوصلك رسالة فيها الطلب كامل تلقائي.\n3️⃣ لو السيارة عندك، دوس "✅ متوفر" وهنوصّلك مباشرة بصاحب الطلب. لو مش عندك، دوس "❌ غير متوفر".\n4️⃣ لازم تسجل حضورك يومياً بكتابة "صباح الخير" عشان نعرف إنك شغال.\n\nأي سؤال، ابعته على wa.me/${ADMIN_EXCEL_PHONE}`,
        idleMenuButtons(),
        user.id,
      );
      return;
    }

    if (btn === "edit_profile") {
      await setState(user.id, { step: "ask_rep_name" });
      await reply(user.phone, "تمام، نبدأ نحدّث بياناتك. إيه اسمك؟", undefined, user.id);
      return;
    }

    if (btn === "guided_supply") {
      // نوري مخزونه الحالي الأول قبل ما نبدأ نسأله عن سيارة جديدة
      const existing = user.showroomId
        ? await db
            .select()
            .from(inventoryTable)
            .where(and(eq(inventoryTable.showroomId, user.showroomId), eq(inventoryTable.status, "available")))
            .limit(20)
        : [];

      if (existing.length > 0) {
        const list = existing
          .map((c, i) => `${i + 1}. ${[c.brand, c.model, c.trim, c.year, c.color].filter(Boolean).join(" ")}`)
          .join("\n");
        await reply(
          user.phone,
          `📦 مخزونك الحالي (${existing.length}):\n${list}\n\nعايز تعمل إيه؟`,
          [
            { id: "guided_supply_start", title: "➕ إضافة سيارة جديدة" },
            { id: "excel_via_admin", title: "📤 راسل الإدارة" },
          ],
          user.id,
        );
        return;
      }
      // مفيش مخزون قديم — كمّل على طول لفلو الإضافة
    }

    if (btn === "guided_supply" || btn === "guided_supply_start" || btn === "guided_demand") {
      const type: "supply" | "demand" = btn === "guided_demand" ? "demand" : "supply";
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
        // المدينة بتتاخد تلقائي من بروفايل المستخدم نفسه (مسجلها وقت
        // التسجيل)، فمش بنسأل عنها تاني كل مرة.
        city: user.city ?? null,
        quantity: 1,
        price: null,
        confidence: 1,
        missingFields: [],
      };
      // الترتيب: ماركة، موديل، فئة، سنة الصنع (ينفع أكتر من سنة بـ /)، لون،
      // الوكيل، ملاحظات. المدينة اتشالت من الأسئلة لأنها تلقائية من البروفايل.
      const queue = user.city
        ? ["brand", "model", "trim", "year", "color", "spec", "extraFeatures"]
        : ["brand", "model", "trim", "year", "color", "spec", "city", "extraFeatures"];
      await setState(user.id, { step: "ask_missing_field", pendingParsed: empty, missingFieldQueue: queue });
      await askNextMissingField(user, { step: "ask_missing_field", pendingParsed: empty, missingFieldQueue: queue });
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

      // حالة 1: اختيار المدينة أثناء التسجيل لأول مرة
      if (st.step === "ask_rep_city") {
        await completeRepRegistration(user, st.pendingRepName, st.pendingShowroomName, cityName);
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
      const result = await confirmMatch(matchId);
      if (result.ok) {
        await reply(user.phone, "✅ تم تأكيد التوفر، سيتم توصيلك بالطالب الآن.", undefined, user.id);
      } else {
        await reply(user.phone, "⏱️ للأسف حد تاني رد قبلك على نفس الطلب.", undefined, user.id);
      }
      return;
    }
    if (btn.startsWith("match_no_")) {
      const matchId = btn.replace("match_no_", "");
      await declineMatch(matchId);
      await reply(user.phone, "تمام، شكراً لردك.", undefined, user.id);
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
    if (st.step === "ask_rep_name" || !st.step) {
      if (st.step === "ask_rep_name" && text) {
        await setState(user.id, { step: "ask_rep_label", pendingRepName: text });
        await reply(user.phone, `تشرفنا يا ${text} 🙌\nإيه اسم المعرض/الجهة اللي بتشتغل بيها؟`, undefined, user.id);
        return;
      }
      await setState(user.id, { step: "ask_rep_name" });
      await reply(user.phone, "أهلاً بك في SayaraHub 🚗\nإيه اسمك؟", undefined, user.id);
      return;
    }

    if (st.step === "ask_rep_label") {
      await setState(user.id, { step: "ask_rep_city", pendingRepName: st.pendingRepName, pendingShowroomName: text });
      await reply(user.phone, "تمام. في أي مدينة بتشتغل؟", cityButtons(), user.id);
      return;
    }

    if (st.step === "ask_rep_city") {
      await completeRepRegistration(user, st.pendingRepName, st.pendingShowroomName, text);
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
    const isGuidedMode = st.pendingParsed.confidence === 1;
    const rawAnswer = text.trim();
    const wantsSkip = rawAnswer === "-" || rawAnswer === "" || rawAnswer === "تخطي" || rawAnswer === "لا";
    // اللون إجباري لو السيارة "متوفر" (عرض) — ميتخطاش بـ "-" زي باقي الحقول
    // الاختيارية (الوكيل والملاحظات)، عشان معرض ميقدرش يعرض سيارة من غير
    // ما يحدد لونها فعلياً.
    const isSkippableField = field === "spec" || field === "extraFeatures" || (field === "color" && parsed.type === "demand");
    const skipped = isGuidedMode && wantsSkip && isSkippableField;

    if (field && isGuidedMode && wantsSkip && !isSkippableField) {
      // حاول يتخطى حقل إجباري (زي اللون في حالة عرض) — نرفض ونوضحله السبب
      await reply(
        user.phone,
        "❌ الحقل ده إجباري ومينفعش تتخطاه. " + (FIELD_QUESTIONS[field] ?? ""),
        undefined,
        user.id,
      );
      await setState(user.id, { step: "ask_missing_field", pendingParsed: parsed, originalText: st.originalText, missingFieldQueue: [field, ...queue] });
      return;
    }

    if (field && skipped) {
      // سؤال اختياري اتخطى (زي الوكيل أو الملاحظات) — نسيب القيمة الحالية
      // زي ما هي (مثلاً الوكيل يفضل "سعودي" الافتراضي) وننتقل للسؤال اللي بعده.
    } else if (field === "year" && isGuidedMode && parsed.type === "demand" && /[\/\-]/.test(rawAnswer)) {
      // طلب عميل بس ممكن يقبل أكتر من سنة (زي "2024/2025") — نسجل أول سنة
      // كسنة أساسية للمطابقة، والباقي بيتحط في الملاحظات عشان المندوب يشوفه
      // ويقرر بنفسه، لأن عمود السنة في قاعدة البيانات رقم واحد بس.
      const years = rawAnswer
        .split(/[\/\-]/)
        .map((p) => parseInt(p.trim(), 10))
        .filter((n) => !isNaN(n));
      if (years.length > 0) {
        parsed.year = years[0] < 100 ? 2000 + years[0] : years[0];
        if (years.length > 1) {
          const extraYearsNote = `سنوات مقبولة كمان: ${years.slice(1).join("، ")}`;
          parsed.extraFeatures = [parsed.extraFeatures, extraYearsNote].filter(Boolean).join("، ");
        }
      }
    } else if (field && isGuidedMode && ["color", "trim", "extraFeatures"].includes(field)) {
      // الحقول اللي ممكن يكون فيها أكتر من قيمة مفصولة بـ / أو - (زي لونين
      // أو ملاحظتين): نقسمهم، نتحقق من كل واحدة لوحدها، ونسجل أي حاجة
      // مجهولة في قايمة المراجعة كل واحدة على حدة بدل ما تتحط كتلة واحدة.
      const parts = rawAnswer
        .split(/[\/\-]/)
        .map((p) => p.trim())
        .filter(Boolean);
      for (const part of parts) {
        await flagUnknownTermForReview(field === "extraFeatures" ? "feature" : field, part, parsed.brand);
      }
      (parsed as Record<string, unknown>)[field] = parts.length > 0 ? parts.join("، ") : null;
    } else if (field) {
      // استخرج القيمة الصح للحقل المطلوب من رد المستخدم (بدل تخزين النص الخام)
      const value = extractFieldAnswer(field, text);
      (parsed as Record<string, unknown>)[field] = value;

      // في وضع "الإدخال اليدوي خطوة بخطوة" (مش الكتابة الحرة العادية)، لو
      // القيمة دي مش معرّفة عندنا خالص، نسجلها في قايمة المراجعة.
      if (isGuidedMode && typeof value === "string") {
        await flagUnknownTermForReview(field, value, parsed.brand);
      }

      // إعادة فحص الرد كامل مفيدة بس في وضع الكتابة الحرة (مش الإدخال
      // اليدوي المُرتّب) — عشان منكسرش الترتيب الثابت اللي طلبناه.
      if (!isGuidedMode) {
        const rescan = await parseFreeText(text);
        const fieldsToFill: (keyof ParsedCar)[] = ["brand", "model", "year", "trim", "color", "spec", "city"];
        for (const f of fieldsToFill) {
          if (!parsed[f] && rescan[f]) {
            (parsed as Record<string, unknown>)[f] = rescan[f];
          }
        }
        const stillMissing = queue.filter((q) => !parsed[q as keyof ParsedCar]);
        queue.length = 0;
        queue.push(...stillMissing);
      }
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
