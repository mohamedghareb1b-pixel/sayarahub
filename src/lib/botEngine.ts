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
      const inventoryLines = items.map((it, i) =>
        `${i + 1}. ${it.brand} ${it.model} ${it.trim ?? ""} ${it.year} ${it.color ?? ""}`.replace(/\s+/g, " ").trim(),
      );
      await setState(user.id, { step: "viewing_inventory", inventoryList: items.map((it) => it.id) });
      await reply(
        user.phone,
        `📦 مخزونك الحالي (${items.length}):\n\n${inventoryLines.join("\n")}\n\nاكتب رقم العربية اللي عايز تتصرف فيها (تشيلها أو تعدّل بيانات فيها)، أو اكتب 0 للرجوع.`,
        undefined,
        user.id,
      );
      return;
    }

    if (btn === "inv_remove" && st.step === "inventory_item_action" && st.inventoryActionId && user.showroomId) {
      await db
        .update(inventoryTable)
        .set({ status: "sold" })
        .where(and(eq(inventoryTable.id, st.inventoryActionId), eq(inventoryTable.showroomId, user.showroomId)));
      await setState(user.id, { step: "idle" });
      await replyWithFullMenu(
        user.phone,
        "✅ تمام، شلناها من مخزونك. لو مسجلة غلط وحابب تضيفها تاني صح، دوس \"🚗 عندي سيارة\".",
        user.id,
      );
      return;
    }

    if (btn === "inv_edit_safe" && st.step === "inventory_item_action" && st.inventoryActionId) {
      await reply(
        user.phone,
        "تمام، إيه اللي عايز تعدّله؟\n(لو الغلط في الماركة/الموديل/السنة/اللون/المدينة، الأسهل إنك تشيل العربية دي وتضيفها تاني صح من \"🚗 عندي سيارة\")",
        [
          { id: "invsafefield:price", title: "💰 السعر" },
          { id: "invsafefield:spec", title: "🏷️ الوكيل" },
          { id: "invsafefield:extraFeatures", title: "📝 ملاحظات" },
        ],
        user.id,
      );
      return;
    }

    if (btn.startsWith("invsafefield:") && st.step === "inventory_item_action" && st.inventoryActionId) {
      const field = btn.replace("invsafefield:", "") as "price" | "extraFeatures" | "spec";
      await setState(user.id, {
        step: "editing_inventory_safe_field",
        inventoryActionId: st.inventoryActionId,
        invSafeField: field,
      });
      const question =
        field === "price" ? "اكتب السعر الجديد (أرقام بس):" : field === "spec" ? "اكتب الوكيل الجديد:" : "اكتب الملاحظات الجديدة:";
      await reply(user.phone, question, undefined, user.id);
      return;
    }

    if (btn === "inv_back" && st.step === "inventory_item_action") {
      await setState(user.id, { step: "idle" });
      await replyWithFullMenu(
      user.phone,
      "تمام، رجعناك للقائمة الأساسية.",
      user.id,
    );
      return;
    }

    if (btn === "edit_profile") {
      await reply(
        user.phone,
        "تمام، إيه اللي عايز تعدّله؟",
        [
          { id: "editprofile:name", title: "👤 اسمي" },
          { id: "editprofile:showroom", title: "🏢 اسم المعرض" },
          { id: "editprofile:city", title: "📍 المدينة" },
        ],
        user.id,
      );
      return;
    }

    if (btn.startsWith("editprofile:")) {
      const field = btn.replace("editprofile:", "") as "name" | "showroom" | "city";
      await setState(user.id, { step: "editing_profile_field", editingProfileField: field });
      if (field === "name") {
        await reply(user.phone, "تمام، اكتب اسمك الجديد:", undefined, user.id);
      } else if (field === "showroom") {
        await reply(user.phone, "تمام، اكتب اسم المعرض/الجهة الجديد:", undefined, user.id);
      } else {
        await reply(user.phone, "اكتب اسم المدينة الجديدة (مثال: جدة):", undefined, user.id);
      }
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
      if (!(await ensureSubscriptionAllowed(user.phone, user.id, user.showroomId))) return;
      const type: "supply" | "demand" = btn === "guided_demand" ? "demand" : "supply";
      // المدينة بتتاخد تلقائي من بروفايل المستخدم — لكل مندوب "معرض شخصي"
      // اتسجلت مدينته وقت التسجيل في showrooms.city (مش في users.city، اللي
      // بيفضل دايماً فاضي في المنطق الجديد لأننا بقينا بننشئ معرض شخصي لكل
      // مندوب بدل ما نخزّن المدينة على حسابه مباشرة). القراءة القديمة من
      // user.city كانت بترجع null دايماً تقريباً، فالمدينة كانت بترجع تتسأل
      // تاني كل مرة رغم إنها مفروض تتشال من الأسئلة.
      let profileCity: string | null = user.city ?? null;
      if (!profileCity && user.showroomId) {
        const [ownShowroom] = await db.select().from(showrooms).where(eq(showrooms.id, user.showroomId));
        profileCity = ownShowroom?.city ?? null;
      }
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
        city: profileCity,
        quantity: 1,
        price: null,
        confidence: 1,
        missingFields: [],
      };
      // الترتيب: ماركة، موديل، فئة، سنة الصنع (ينفع أكتر من سنة بـ /)، لون،
      // الوكيل، ملاحظات. المدينة اتشالت من الأسئلة لأنها تلقائية من البروفايل.
      const queue = profileCity
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
        await reply(user.phone, "اكتب اسم المدينة الجديدة (مثال: جدة):", undefined, user.id);
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

      // حالة 2: اختيار المدينة الجديدة أثناء تعديل بروفايل المستخدم نفسه
      // (مش طلب/عرض) — بتتحدث في showrooms.city مباشرة لأن دي المصدر
      // الحقيقي لمدينة المندوب اللي بيتاخد منها تلقائي في أي طلب/عرض جديد.
      if (st.step === "editing_profile_field" && st.editingProfileField === "city") {
        if (user.showroomId) {
          await db.update(showrooms).set({ city: cityName }).where(eq(showrooms.id, user.showroomId));
        }
        await setState(user.id, { step: "idle" });
        await replyWithFullMenu(
      user.phone,
      `✅ تم تحديث مدينتك إلى ${cityName}.`,
      user.id,
    );
        return;
      }

      // حالة 3: اختيار المدينة أثناء تعديل حقل "المكان" في طلب/عرض قائم
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
      if (!(await ensureSubscriptionAllowed(user.phone, user.id, user.showroomId))) return;
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
        [
          { id: "editfield:brand", title: "الماركة" },
          { id: "editfield:model", title: "الموديل" },
          { id: "editfield:trim", title: "الفئة" },
        ],
        user.id,
      );
      await reply(
        user.phone,
        "أو:",
        [
          { id: "editfield:year", title: "السنة" },
          { id: "editfield:color", title: "اللون" },
          { id: "editfield:city", title: "المدينة" },
        ],
        user.id,
      );
      await reply(
        user.phone,
        "أو:",
        [
          { id: "editfield:spec", title: "الوكيل" },
          { id: "editfield:extraFeatures", title: "ملاحظات" },
        ],
        user.id,
      );
      return;
    }

    if (btn.startsWith("match_yes_")) {
      if (!(await ensureSubscriptionAllowed(user.phone, user.id, user.showroomId))) return;
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
        .set({ expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000), reminderSent: false, renewedCount: sql`${requestsTable.renewedCount} + 1` })
        .where(eq(requestsTable.id, reqId));
      await reply(user.phone, "🔄 تم تجديد الطلب لمدة 3 ساعات إضافية.", undefined, user.id);
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
      await reply(user.phone, "مرحباً بك في سيارة هب 🚗\nاكتب اسمك:", undefined, user.id);
      return;
    }

    if (st.step === "ask_rep_label") {
      await setState(user.id, { step: "ask_rep_city", pendingRepName: st.pendingRepName, pendingShowroomName: text });
      await reply(user.phone, "تمام. في أي مدينة بتشتغل؟ (اكتب اسم المدينة مثال: الرياض)", undefined, user.id);
      return;
    }

    if (st.step === "ask_rep_city") {
      await completeRepRegistration(user, st.pendingRepName, st.pendingShowroomName, text);
      return;
    }
  }

  // ── تعديل حقل واحد من بروفايل مستخدم مسجل بالفعل ────────────────────
  // لازم يعيش هنا برّه بوابة "!user.onboardingComplete" فوق، لأن المستخدم
  // اللي بيدوس "تعديل بياناتي" onboardingComplete بتاعه true بالفعل، وأي
  // كود جوا البوابة دي كان هيتجاهل رده وتتفهم رسالته غلط كأنها وصف سيارة.
  if (st.step === "editing_profile_field" && st.editingProfileField === "name" && text) {
    await db.update(users).set({ name: text }).where(eq(users.id, user.id));
    await setState(user.id, { step: "idle" });
    await replyWithFullMenu(
      user.phone,
      `✅ تم تحديث اسمك إلى ${text}.`,
      user.id,
    );
    return;
  }
  if (st.step === "editing_profile_field" && st.editingProfileField === "showroom" && text) {
    if (user.showroomId) {
      await db.update(showrooms).set({ name: text }).where(eq(showrooms.id, user.showroomId));
    }
    await setState(user.id, { step: "idle" });
    await replyWithFullMenu(
      user.phone,
      `✅ تم تحديث اسم المعرض إلى ${text}.`,
      user.id,
    );
    return;
  }

  // ── اختيار رقم عربية من ليستة "📦 مخزوني" ────────────────────────────
  if (st.step === "viewing_inventory" && text) {
    const num = parseInt(text.trim(), 10);
    if (text.trim() === "0") {
      await setState(user.id, { step: "idle" });
      await replyWithFullMenu(
      user.phone,
      "تمام، رجعناك للقائمة الأساسية.",
      user.id,
    );
      return;
    }
    const list = st.inventoryList ?? [];
    if (!Number.isFinite(num) || num < 1 || num > list.length) {
      await reply(user.phone, `اكتب رقم من 1 إلى ${list.length}، أو 0 للرجوع.`, undefined, user.id);
      return;
    }
    const chosenId = list[num - 1];
    await setState(user.id, { step: "inventory_item_action", inventoryActionId: chosenId, inventoryList: list });
    await reply(
      user.phone,
      "تمام، عايز تعمل إيه في العربية دي؟",
      [
        { id: "inv_remove", title: "🗑️ اتباعت / شيلها" },
        { id: "inv_edit_safe", title: "✏️ تعديل بيانات" },
        { id: "inv_back", title: "🔙 رجوع" },
      ],
      user.id,
    );
    return;
  }

  // ── تعديل حقل آمن (السعر/الوكيل/الملاحظات) في عربية متسجلة بالفعل ────
  // مقصورة على الحقول اللي مش داخلة في حساب الـ fingerprint (ماركة/موديل/
  // سنة/فئة/لون/مدينة)، عشان مانحتاجش نعيد حساب البصمة أو نتحقق من تعارضها
  // مع عربية تانية. أي تعديل في الحقول دي الأسلم إنه يشيل ويضيف تاني.
  if (st.step === "editing_inventory_safe_field" && st.inventoryActionId && st.invSafeField && text) {
    const field = st.invSafeField;
    if (field === "price") {
      const priceNum = Number(text.replace(/[^\d.]/g, ""));
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        await reply(user.phone, "اكتب السعر أرقام بس (مثال: 85000).", undefined, user.id);
        return;
      }
      await db.update(inventoryTable).set({ price: String(priceNum) }).where(eq(inventoryTable.id, st.inventoryActionId));
    } else if (field === "spec") {
      await db.update(inventoryTable).set({ spec: text }).where(eq(inventoryTable.id, st.inventoryActionId));
    } else {
      await db.update(inventoryTable).set({ extraFeatures: text }).where(eq(inventoryTable.id, st.inventoryActionId));
    }
    await setState(user.id, { step: "idle" });
    await replyWithFullMenu(
      user.phone,
      "✅ تم تحديث بيانات العربية.",
      user.id,
    );
    return;
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
