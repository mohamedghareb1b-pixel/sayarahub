import { cleanFreeText, classifyKeyword, normalizeForMatch } from "./textClean";
import { CAR_BRANDS, COLORS, SAUDI_CITIES, SPECS, findModelInText } from "./carData";
import { db } from "@/db";
import { parseCorrections } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { ensureVocabularyLoaded, findDynamicTerm, findDynamicModelAlias, findDynamicBrandAlias, getVocabCache } from "./vocabulary";

export type ParsedCar = {
  type: "demand" | "supply" | "unclear";
  brand: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  color: string | null;
  interiorColor: string | null;
  extraFeatures: string | null;
  engineSize: string | null;
  seats: number | null;
  fuelType: string | null;
  transmission: string | null;
  spec: string | null;
  city: string | null;
  quantity: number;
  price: number | null;
  confidence: number;
  missingFields: string[];
};

const REQUIRED_FIELDS: (keyof ParsedCar)[] = ["brand", "model", "year", "city", "trim"];

function extractYear(text: string): number | null {
  // 4-digit year 19xx/20xx
  const full = text.match(/\b(19|20)\d{2}\b/);
  if (full) return parseInt(full[0], 10);
  // 2-digit year like "٢٦" already converted to "26" -> 2026, "١٩٩٩" unlikely
  const short = text.match(/\b(\d{2})\b/);
  if (short) {
    const n = parseInt(short[1], 10);
    if (n >= 0 && n <= 35) return 2000 + n;
  }
  return null;
}

function extractCity(text: string): string | null {
  const norm = normalizeForMatch(text);
  for (const c of SAUDI_CITIES) {
    if (norm.includes(normalizeForMatch(c))) return c;
  }
  return null;
}

const INTERIOR_MARKERS = ["داخليه", "داخلي", "من الداخل", "الداخل"];

function splitExteriorInterior(text: string): { exteriorPart: string; interiorPart: string | null } {
  const norm = normalizeForMatch(text);
  for (const m of INTERIOR_MARKERS) {
    const idx = norm.indexOf(m);
    if (idx !== -1) {
      return {
        exteriorPart: norm.slice(0, idx),
        interiorPart: norm.slice(idx + m.length),
      };
    }
  }
  return { exteriorPart: norm, interiorPart: null };
}

function extractColor(text: string): string | null {
  // اللون الخارجي: نبحث فقط في الجزء اللي قبل كلمة "داخلي" (لو موجودة) عشان
  // منلخبطش مع اللون الداخلي المذكور بعدها في نفس الرسالة.
  const { exteriorPart } = splitExteriorInterior(text);
  const found: string[] = [];
  for (const c of COLORS) {
    if (exteriorPart.includes(normalizeForMatch(c)) && !found.includes(c)) found.push(c);
  }
  const dynamicColors = getVocabCache().colors;
  for (const entry of dynamicColors) {
    if (entry.term && exteriorPart.includes(entry.term) && !found.includes(entry.value)) found.push(entry.value);
  }
  // لو المستخدم كتب أكتر من لون سوا (زي "أبيض و أحمر" أو "أبيض/أحمر")، نسجلهم
  // كلهم مفصولين، عشان نطابق مع أي معرض عنده أي لون منهم.
  return found.length > 0 ? found.join("، ") : null;
}

function extractSpec(text: string): string | null {
  const norm = normalizeForMatch(text);
  for (const s of SPECS) {
    if (norm.includes(normalizeForMatch(s))) return s;
  }
  return null;
}

function extractPrice(text: string): number | null {
  // أرقام من 5 لـ 7 خانات مش ملهاش لبس مع السنة (السنة دايماً 4 أرقام)
  const long = text.match(/\b(\d{5,7})\b/);
  if (long) {
    const n = parseInt(long[1], 10);
    if (n >= 10000 && n <= 2000000) return n;
  }
  // رقم من 4 خانات بيتحسب سعر بس لو مكتوب معاه صراحة "ريال/رس/SAR"،
  // عشان منلخبطوش مع سنة الصنع (زي "2026") لو مفيش كلمة عملة جنبه
  const short = text.match(/\b(\d{4})\s*(ريال|رس|sar)\b/i);
  if (short) {
    const n = parseInt(short[1], 10);
    if (n >= 1000 && n <= 2000000) return n;
  }
  return null;
}

const KNOWN_TRIMS = [
  "standard", "ستاندر", "ستندر", "استاندر",
  "gl", "gle", "gls", "se", "sel", "limited",
  "لمتد", "ليمتد",
  "فل كامل", "فل كامله", "فل كامل بدون فتحة", "فل",
  "نص فل", "هاف",
  "توب لاين", "توبلاين",
  "كمفورت", "كمفرت", "comfort",
  "فليت", "fleet",
  "اكزيكتيف", "executive",
  "بريميوم", "premium",
  "سبورت", "sport",
];

function extractTrim(text: string): string | null {
  const found: string[] = [];
  for (const t of KNOWN_TRIMS) {
    if (text.includes(t) && !found.includes(t)) found.push(t);
  }
  for (const entry of getVocabCache().trims) {
    if (entry.term && text.includes(entry.term) && !found.includes(entry.value)) found.push(entry.value);
  }
  return found.length > 0 ? found.join("، ") : null;
}

function extractInteriorColor(text: string): string | null {
  // نبحث عن اللون اللي جاي بعد كلمة "داخلي" تحديداً، مش أي لون في الرسالة كلها
  const { interiorPart } = splitExteriorInterior(text);
  if (interiorPart === null) return null;
  for (const c of COLORS) {
    if (interiorPart.includes(normalizeForMatch(c))) return c;
  }
  return findDynamicTerm(getVocabCache().colors, interiorPart);
}

// كلمات وصفات إضافية شائعة في سوق السيارات السعودي، لا تدخل ضمن الحقول
// الأساسية لكنها مهمة كملاحظة جانبية (دبل، فتحة، كاميرا...الخ)
export const EXTRA_FEATURE_WORDS = [
  "دبل", "بدون دبل",
  "فتحة", "بدون فتحة", "فتحتين",
  "كاميرا خلفية", "كاميرا 360", "كاميرا",
  "شاشة", "بدون شاشة",
  "جلد", "قماش",
  "فورس", "دفع رباعي", "دفع خلفي",
  "بانوراما",
  "تحكم مقاعد", "مقاعد كهرباء",
  "حساسات", "بدون حساسات",
];

function extractExtraFeatures(text: string): string | null {
  const norm = normalizeForMatch(text);
  const found = EXTRA_FEATURE_WORDS.filter((w) => norm.includes(normalizeForMatch(w)));
  const dynamicMatches = getVocabCache()
    .features.filter((f) => norm.includes(f.term))
    .map((f) => f.value);
  const allFound = [...found, ...dynamicMatches];
  if (allFound.length === 0) return null;
  // أزل التكرارات المتداخلة (مثلاً لو لقينا "دبل" و"بدون دبل" سوا نفضل الأدق/الأطول)
  const deduped = allFound.filter(
    (w) => !allFound.some((other) => other !== w && other.includes(w) && other.length > w.length),
  );
  return deduped.join("، ");
}


function extractEngineSize(text: string): string | null {
  // نمسك أي صيغة زي "1600cc"، "1600 سي سي"، "موتور 1600"، "2.0L"
  const norm = normalizeForMatch(text);
  const patterns = [
    /(\d{3,4})\s*(?:cc|سي سي|سى سى)/,
    /موتور\s*(\d{3,4})/,
    /(\d(?:\.\d)?)\s*(?:l|لتر)/,
  ];
  for (const p of patterns) {
    const m = norm.match(p);
    if (m) return m[0].trim();
  }
  return null;
}

// كلمات وظيفية نتجاهلها عند التقاط "الباقي" لأنها مش معلومة عن السيارة
// نفسها (أدوات ربط، كلمات التصنيف، حروف الجر الشائعة)
const IGNORE_WORDS = new Set([
  "و", "في", "فى", "من", "الى", "إلى", "على", "مع", "او", "أو",
  "متوفر", "متوفره", "للبيع", "عرض", "يوجد", "عندنا", "لدينا",
  "مطلوب", "مطلوبه", "ابغى", "ابي", "نبغى", "نبي", "الباحث", "دورنا",
  "سياره", "سيارة", "عربيه", "عربية",
  "راكب", "ركاب", "مقعد", "مقاعد",
]);

/** أي كلمة في الرسالة معرفناهاش كماركة/موديل/فئة/لون/سنة/مواصفة/مدينة/موتور
 * ولا هي كلمة تصنيف أو أداة ربط، تتحول تلقائي لملاحظة إضافية — عشان أي
 * تفصيلة يكتبها المستخدم متضيعش حتى لو مش في قوائمنا المعروفة.
 *
 * ملحوظة مهمة: بنقارن هنا بكل الكلمات المعروفة (الخام اللي المستخدم ممكن
 * يكتبها + القيمة الرسمية) مش بس بالقيمة الرسمية النهائية — عشان لو حد كتب
 * "كمفرت" واتحولت لـ"كمفورت"، الكلمة الخام "كمفرت" نفسها تتعرف كمعروفة
 * ومتترصدش تاني كملاحظة مكررة. */
function extractLeftoverNotes(cleaned: string, recognizedValues: (string | null)[]): string | null {
  const cache = getVocabCache();
  const allKnownWords = [
    ...recognizedValues,
    ...KNOWN_TRIMS,
    ...COLORS,
    ...SPECS,
    ...EXTRA_FEATURE_WORDS,
    ...cache.trims.flatMap((e) => [e.term, e.value]),
    ...cache.colors.flatMap((e) => [e.term, e.value]),
    ...cache.features.flatMap((e) => [e.term, e.value]),
  ];
  const recognizedNorm = allKnownWords
    .filter((v): v is string => Boolean(v))
    .map((v) => normalizeForMatch(v))
    .join(" ");

  const tokens = normalizeForMatch(cleaned)
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const leftover = tokens.filter((t) => {
    if (IGNORE_WORDS.has(t)) return false;
    if (getVocabCache().stopwords.includes(t)) return false;
    if (/^\d+$/.test(t)) return false; // أرقام (سنة/سعر) اتلقطت بالفعل في حقولها
    return !recognizedNorm.includes(t);
  });

  if (leftover.length === 0) return null;
  return leftover.join(" ");
}

function extractSeats(text: string): number | null {
  const norm = normalizeForMatch(text);
  const m = norm.match(/(\d{1,2})\s*(?:راكب|ركاب|مقعد|مقاعد)/);
  return m ? parseInt(m[1], 10) : null;
}

const FUEL_TYPES = ["ديزل", "بنزين", "هايبرد", "كهرباء", "هجين"];
function extractFuelType(text: string): string | null {
  const norm = normalizeForMatch(text);
  for (const f of FUEL_TYPES) {
    if (norm.includes(normalizeForMatch(f))) return f;
  }
  return null;
}

const TRANSMISSION_TYPES: { words: string[]; value: string }[] = [
  { words: ["اتوماتيك", "أوتوماتيك", "أتوماتيك", "automatic"], value: "اتوماتيك" },
  { words: ["مانيوال", "عادي جير", "يدوي", "manual"], value: "مانيوال" },
];
function extractTransmission(text: string): string | null {
  const norm = normalizeForMatch(text);
  for (const t of TRANSMISSION_TYPES) {
    if (t.words.some((w) => norm.includes(normalizeForMatch(w)))) return t.value;
  }
  return null;
}

export function ruleBasedParse(rawText: string): ParsedCar {
  const cleaned = cleanFreeText(rawText);
  const normalized = normalizeForMatch(rawText);

  const type = classifyKeyword(rawText);
  // أولاً: هل النص فيه صيغة بديلة اتعلمها البوت من الأدمن (زي "راف4")؟
  // لو آه بنفضلها لأنها مقصودة بالظبط، وإلا نرجع للقواعد الثابتة العادية.
  const alias = findDynamicModelAlias(normalized) ?? findDynamicModelAlias(cleaned);
  const modelHit =
    alias ??
    findModelInText(normalized) ??
    findModelInText(cleaned) ??
    (() => {
      const brandOnly = findDynamicBrandAlias(normalized) ?? findDynamicBrandAlias(cleaned);
      return brandOnly ? { brand: brandOnly.brand, model: "" } : null;
    })();

  const year = extractYear(cleaned);
  const city = extractCity(cleaned);
  const interiorColor = extractInteriorColor(cleaned);
  const extraFeatures = extractExtraFeatures(cleaned);
  const engineSize = extractEngineSize(cleaned);
  const seats = extractSeats(cleaned);
  const fuelType = extractFuelType(cleaned);
  const transmission = extractTransmission(cleaned);
  const price = extractPrice(cleaned);
  let trim = extractTrim(normalized);

  // حالة الكلمة الملتبسة (زي "تيتانيوم" مسجلة كفئة ولون مع بعض): لو نفس
  // الكلمة اتلقطت في الفئة واللون، بنشوف اتكررت في الرسالة كام مرة —
  // مرة واحدة = نفترضها فئة بس (واللون هيتسأل عنه لو لازم)، مرتين = نسيبها
  // في الاتنين لأن المستخدم قصدهم فعلاً كحاجتين منفصلتين.
  let color = extractColor(cleaned);
  if (trim && color && normalizeForMatch(trim) === normalizeForMatch(color)) {
    const escaped = normalizeForMatch(trim).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const occurrences = (normalized.match(new RegExp(escaped, "g")) || []).length;
    if (occurrences < 2) {
      color = null;
    }
  }

  // لو المستخدم ماكتبش سعودي/خليجي/امريكي.. الخ، نفترض "سعودي" مباشرة
  // بدل ما نسأل عنها أو نسيبها فاضية — السوق المستهدف سعودي أصلاً.
  const spec = extractSpec(cleaned) ?? "سعودي";

  // أي كلمة تانية في الرسالة معرفناهاش في أي حقل رسمي، نلقطها كملاحظة
  // عامة عشان متضيعش، حتى لو مش من الكلمات المعروفة عندنا مسبقاً.
  const leftover = extractLeftoverNotes(cleaned, [
    modelHit?.brand ?? null,
    modelHit?.model ?? null,
    trim,
    color,
    interiorColor,
    engineSize,
    fuelType,
    transmission,
    extractSpec(cleaned), // لا نستخدم "سعودي" الافتراضية هنا عشان منعتبرهاش كلمة موجودة فعلاً بالرسالة
    city,
    extraFeatures,
  ]);
  const combinedExtras = [extraFeatures, leftover].filter(Boolean).join("، ") || null;

  const parsed: ParsedCar = {
    type: type === "unknown" ? "unclear" : type,
    brand: modelHit?.brand ?? null,
    model: modelHit?.model || null,
    year,
    trim,
    color,
    interiorColor,
    extraFeatures: combinedExtras,
    engineSize,
    seats,
    fuelType,
    transmission,
    spec,
    city,
    quantity: 1,
    price,
    confidence: 0,
    missingFields: [],
  };

  // إذا لم نجد كلمة "متوفر" أو "مطلوب" صريحة، لا نخمّن نوع الرسالة أبداً —
  // نتركها "unclear" ليقوم البوت بسؤال المستخدم مباشرة بدل تسجيل بيانات خاطئة.

  const missing: string[] = [];
  if (!parsed.brand) missing.push("brand");
  if (!parsed.model) missing.push("model");
  if (!parsed.year) missing.push("year");
  if (!parsed.city) missing.push("city");
  if (!parsed.trim) missing.push("trim");

  // اللون إجباري بس لو المعرض بيعرض سيارة (لازم يحدد الألوان المتوفرة عنده).
  // لو طلب عميل ماحددش لون، نفترض إنه مرن ونسجلها "أي لون متاح".
  if (!parsed.color) {
    if (parsed.type === "supply") {
      missing.push("color");
    } else {
      parsed.color = "أي لون متاح";
    }
  }
  parsed.missingFields = missing;

  const totalRequired = REQUIRED_FIELDS.length + (parsed.type === "supply" ? 1 : 0);
  const foundCount = totalRequired - missing.length;
  parsed.confidence = modelHit ? 0.5 + 0.125 * foundCount : 0.2;

  return parsed;
}

/** Used when the bot is asking the user for a single missing field — tries to
 * extract a clean value from the answer instead of storing the raw text. */
export function extractFieldAnswer(field: string, answerText: string): string | number | null {
  const cleaned = cleanFreeText(answerText);
  switch (field) {
    case "city":
      return extractCity(cleaned) ?? cleaned;
    case "color":
      return extractColor(cleaned) ?? cleaned;
    case "interiorColor":
      return extractColor(cleaned) ?? cleaned;
    case "spec":
      return extractSpec(cleaned) ?? cleaned;
    case "trim":
      return extractTrim(normalizeForMatch(answerText)) ?? cleaned;
    case "year": {
      const y = extractYear(cleaned);
      return y ?? null;
    }
    case "brand":
    case "model": {
      const hit = findModelInText(normalizeForMatch(answerText)) ?? findModelInText(cleaned);
      if (hit) return field === "brand" ? hit.brand : hit.model || cleaned;
      return cleaned;
    }
    default:
      return cleaned;
  }
}

/** Calls Gemini 2.0 Flash if GEMINI_API_KEY is configured, otherwise falls
 * back to the free rule-based parser so the product still fully works
 * without any external AI credentials. */
export async function parseFreeText(rawText: string): Promise<ParsedCar> {
  await ensureVocabularyLoaded();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return ruleBasedParse(rawText);
  }

  try {
    const prompt = `You are a car data extractor for the Saudi car market.
Extract a single JSON object with keys: type(demand/supply/unclear), brand(ar), model(ar), year(number, 2-digit like 26 becomes 2026), trim(ar, the exact spec/grade level like ستاندر/فل كامل/كمفورت — if not explicitly mentioned in the text, return null, NEVER guess or default to "ستاندر"), color(ar, exterior color), interior_color(ar, interior color only if the text explicitly mentions an interior/داخلي color, else null), extra_features(ar, short comma-separated string of any extra mentioned features like دبل/بدون دبل/فتحة/كاميرا/شاشة, PLUS any other word or detail in the text that doesn't fit brand/model/trim/color/year/city/spec/engine_size — never silently drop unrecognized details, put them here instead, else null), engine_size(the engine displacement if mentioned, like "1600cc" or "2.0L", else null), seats(number of passenger seats if mentioned, e.g. "11 راكب" => 11, else null), fuel_type(ديزل/بنزين/هايبرد if mentioned, else null), transmission(اتوماتيك/مانيوال if mentioned, else null), spec(سعودي/خليجي/امريكي), city(ar), quantity(default 1), price(number or null), confidence(0-1), missing_fields(array of any of brand/model/year/city/trim that are missing).
If the model is known, infer the brand (e.g. كامري => تويوتا).
Return ONLY raw JSON, no markdown fences.
Text: "${rawText}"`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      },
    );

    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");
    const json = JSON.parse(text) as Record<string, unknown>;

    const result: ParsedCar = {
      type: (json.type as ParsedCar["type"]) ?? "unclear",
      brand: (json.brand as string) ?? null,
      model: (json.model as string) ?? null,
      year: json.year ? Number(json.year) : null,
      trim: (json.trim as string) || null,
      color: (json.color as string) || null,
      interiorColor: (json.interior_color as string) || null,
      extraFeatures: (json.extra_features as string) || null,
      engineSize: (json.engine_size as string) || null,
      seats: json.seats ? Number(json.seats) : null,
      fuelType: (json.fuel_type as string) || null,
      transmission: (json.transmission as string) || null,
      spec: (json.spec as string) || "سعودي",
      city: (json.city as string) ?? null,
      quantity: json.quantity ? Number(json.quantity) : 1,
      price: json.price ? Number(json.price) : null,
      confidence: json.confidence ? Number(json.confidence) : 0.5,
      missingFields: [],
    };

    // اللون إجباري بس لو المعرض بيعرض سيارة؛ لو طلب عميل ماحددش لون نفترض
    // إنه مرن بدل ما نسأله أو نسيبها فاضية.
    if (!result.color) {
      if (result.type === "supply") {
        result.color = null;
      } else {
        result.color = "أي لون متاح";
      }
    }

    // نعيد حساب الحقول الناقصة بأنفسنا (بدل الاعتماد الكامل على تقدير Gemini)
    // عشان نضمن الاتساق مع REQUIRED_FIELDS في كل أنحاء الكود.
    const requiredNow: (keyof ParsedCar)[] =
      result.type === "supply" ? [...REQUIRED_FIELDS, "color"] : REQUIRED_FIELDS;
    result.missingFields = requiredNow.filter((f) => !result[f]) as string[];

    return result;
  } catch {
    // AI failed/unavailable — never break the flow, fall back to the free parser.
    return ruleBasedParse(rawText);
  }
}

/** ذاكرة التعلّم الذاتي — تبحث عن نص طبيعي مشابه سبق تصحيحه أو تأكيده من
 * قبل مستخدم حقيقي، وترجع نتيجته المحفوظة مباشرة بدل إعادة التحليل. */
export async function lookupCorrection(rawText: string): Promise<ParsedCar | null> {
  const key = normalizeForMatch(rawText);
  if (!key || key.length < 3) return null;

  const [hit] = await db
    .select()
    .from(parseCorrections)
    .where(eq(parseCorrections.normalizedText, key))
    .limit(1);

  if (!hit) return null;

  // نزود عداد الاستخدام (لأغراض المتابعة/الأدمن) بدون ما ننتظر النتيجة
  db.update(parseCorrections)
    .set({ hitCount: sql`${parseCorrections.hitCount} + 1`, updatedAt: new Date() })
    .where(eq(parseCorrections.id, hit.id))
    .catch(() => {});

  return hit.parsedResult as ParsedCar;
}

/** يحفظ نتيجة تحليل تمت الموافقة عليها (أو تصحيحها) من مستخدم حقيقي، عشان
 * أي نص طبيعي مشابه في المستقبل ياخد نفس النتيجة فورًا بدون إعادة تحليل. */
export async function saveCorrection(
  rawText: string,
  parsed: ParsedCar,
  source: "user_confirmed" | "user_edited" | "admin_manual" = "user_confirmed",
): Promise<void> {
  const key = normalizeForMatch(rawText);
  if (!key || key.length < 3) return;

  await db
    .insert(parseCorrections)
    .values({
      normalizedText: key,
      rawTextSample: rawText,
      parsedResult: parsed,
      source,
    })
    .onConflictDoUpdate({
      target: parseCorrections.normalizedText,
      set: {
        rawTextSample: rawText,
        parsedResult: parsed,
        source,
        updatedAt: new Date(),
      },
    });
}
