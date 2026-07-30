import { db } from "@/db";
import { sql, eq, and, desc } from "drizzle-orm";
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
import { getSubscriptionStatus } from "./subscription";
import { createPaddleCheckout } from "./paddle";
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
    | "editing_profile_field"
    | "viewing_inventory"
    | "inventory_item_action"
    | "editing_inventory_safe_field"
    | "idle";
  pendingRepName?: string;
  pendingShowroomName?: string;
  pendingParsed?: ParsedCar;
  originalText?: string;
  missingFieldQueue?: string[];
  addSalesPhone?: string;
  editingField?: string;
  editingProfileField?: "name" | "showroom" | "city";
  pendingJoinShowroomId?: string;
  inventoryList?: string[];
  inventoryActionId?: string;
  invSafeField?: "price" | "extraFeatures" | "spec";
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

// المدينة أصبحت نص حر — الدالة دي متستخدمش تاني
// function cityButtons() removed

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

/** بيتحقق إن المعرض المرتبط بالمستخدم لسه مسموحله يستخدم النظام (تجربة +
 * سماح متجاوزتش)، ولو لأ بيبعت رسالة توضح انتهاء الفترة مع رابط دفع Paddle
 * حقيقي ويرجع false عشان الاستدعاء اللي بعده يوقف على طول. */
async function ensureSubscriptionAllowed(phone: string, userId: string, showroomId: string | null): Promise<boolean> {
  if (!showroomId) return true; // لسه معندوش معرض أصلاً، مفيش حاجة نمنعها
  const status = await getSubscriptionStatus(showroomId);
  if (status.allowed) return true;

  let checkoutLine = "";
  try {
    const checkoutUrl = await createPaddleCheckout(showroomId);
    checkoutLine = `\n\nفعّل اشتراكك (35 ريال شهرياً) من هنا:\n${checkoutUrl}`;
  } catch {
    checkoutLine = "\n\nتواصل معانا لتفعيل اشتراكك.";
  }
  await reply(
    phone,
    `⏸️ انتهت فترتك المجانية (14 يوم تجربة + يومين سماح). عشان تكمل تستخدم سيارة هب لازم تفعّل الاشتراك.${checkoutLine}`,
    undefined,
    userId,
  );
  return false;
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
    { id: "guided_supply", title: "🚗 عندي سيارة" },
    { id: "guided_demand", title: "🔍 عايز سيارة" },
    { id: "view_inventory", title: "📦 مخزوني" },
  ];
}

function idleMenuButtons2(): Button[] {
  return [
    { id: "excel_via_admin", title: "📤 أرسل مخزونك" },
    { id: "work_details", title: "📋 تفاصيل العمل" },
    { id: "edit_profile", title: "✏️ تعديل بياناتي" },
  ];
}

/** بعد التسجيل وبعد أي عملية — بتبعت رسالتين عشان تظهر كل الأزرار */
function fullActionButtons(): Button[] {
  return [
    { id: "guided_supply", title: "🚗 عندي سيارة" },
    { id: "guided_demand", title: "🔍 عايز سيارة" },
    { id: "view_inventory", title: "📦 مخزوني" },
  ];
}

function fullActionButtons2(): Button[] {
  return [
    { id: "excel_via_admin", title: "📤 أرسل مخزونك" },
    { id: "work_details", title: "📋 تفاصيل العمل" },
    { id: "edit_profile", title: "✏️ تعديل بياناتي" },
  ];
}

/** بيبعت رسالتين بالأزرار الكاملة بدل رسالة واحدة — عشان واتساب بيسمح 3 أزرار بس */
async function replyWithFullMenu(phone: string, msg: string, userId: string) {
  await reply(phone, msg, fullActionButtons(), userId);
  await reply(phone, "المزيد من الخيارات:", fullActionButtons2(), userId);
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

  await replyWithFullMenu(
    user.phone,
    `🎉 تمام يا ${repName ?? ""}! سجلناك بنجاح.\n📍 ${workLabel ?? ""} — ${city}`,
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
    await replyWithFullMenu(
      user.phone,
      `✅ تم إضافة السيارة لمخزونك: ${summarize(parsed)}\nستبقى متاحة 30 يوم أو حتى يتم توصيلها.`,
      user.id,
    );
    await runMatchingForInventory(invId);
  } else if (parsed.type === "demand") {
    const reqId = await createRequest(user.showroomId, user.id, parsed);
    await replyWithFullMenu(
      user.phone,
      `🔎 تم تسجيل طلبك: ${summarize(parsed)}\nسنبحث لك في مخزون بقية المعارض وسنعلمك فور توفر تطابق. الطلب صالح 3 ساعات.`,
      user.id,
    );
    await runMatchingForRequest(reqId);
  } else {
    await replyWithFullMenu(
      user.phone,
      "لم أفهم إن كان هذا طلب أم عرض، أرسل مثلاً: مطلوب أو متوفر ثم تفاصيل السيارة.",
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
    .values({ phone, name, conversationState: {} })
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
        `تمام! ابعت مخزونك على الرقم ده وهنرفعه لمخزونك بلا أي تعب يا غالي 🙏\n\nwa.me/${ADMIN_EXCEL_PHONE}`,
        undefined,
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

    if (btn === "view_inventory") {
      if (!user.showroomId) {
        await replyWithFullMenu(
      user.phone,
      "لسه معندكش مخزون مسجل. دوس \"🚗 عندي سيارة\" عشان تضيف أول عربية.",
      user.id,
    );
        return;
      }
      const items = await db
        .select()
        .from(inventoryTable)
        .where(and(eq(inventoryTable.showroomId, user.showroomId), eq(inventoryTable.status, "available")))
        .orderBy(desc(inventoryTable.createdAt))
        .limit(20);
      if (items.length === 0) {
        await replyWithFullMenu(
      user.phone,
      "📦 مخزونك فاضي دلوقتي. دوس \"🚗 عندي سيارة\" عشان تضيف أول عربية.",
      user.id,
    );
        return;
      }
      const lines = items.map((it, i) =>
        `${i + 1}. ${it.brand} ${it.model} ${it.trim ?? ""} ${it.year} ${it.color ?? ""}`.replace(/\s+/g, " ").trim(),
      );
      await setState(user.id, { step: "viewing_inventory", inventoryList: items.map((it) => it.id) });
      await reply(
        user.phone,