// Free "cleaning layer" run before we ever call an AI model, per PRD 4.6 / 4.7.
// Strips emoji, collapses elongated Arabic letters (مطلووووب -> مطلوب),
// converts Arabic-Indic digits to Latin digits, and removes noisy punctuation.

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const NORMALIZE_MAP: [RegExp, string][] = [
  [/كامرى/g, "كامري"],
  [/سيارص/g, "سيارة"],
  [/[إأآا]/g, "ا"],
  [/ى/g, "ي"],
  [/ة/g, "ه"],
  [/ؤ/g, "و"],
  [/ئ/g, "ي"],
];

export function cleanFreeText(input: string): string {
  let text = input;

  // Convert Arabic-Indic digits -> Latin digits
  text = text.replace(/[٠-٩]/g, (d) => ARABIC_INDIC_DIGITS[d] ?? d);

  // Strip emoji / pictographs
  text = text.replace(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
    " ",
  );

  // Collapse elongated repeated letters (3+) -> single letter e.g. مطلووووب -> مطلوب
  text = text.replace(/(.)\1{2,}/gu, "$1");

  // Strip noisy punctuation (؟!.,) that adds no meaning to car details
  text = text.replace(/[؟?!.,؛;]/g, " ");

  // Remove tashkeel (diacritics)
  text = text.replace(/[\u0617-\u061A\u064B-\u0652]/g, "");

  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/** A normalized version used purely for keyword/alias matching (not shown to users). */
export function normalizeForMatch(input: string): string {
  let text = cleanFreeText(input).toLowerCase();
  for (const [re, rep] of NORMALIZE_MAP) {
    text = text.replace(re, rep);
  }
  return text;
}

const IGNORE_WORDS = [
  "السلام عليكم",
  "صباح الخير",
  "مساء الخير",
  "حياكم",
  "الله يعطيك العافيه",
  "شكرا",
];

/** Cheap free filter used on group traffic before it ever reaches the AI batcher. */
export function shouldIgnoreGroupMessage(raw: string): boolean {
  const cleaned = cleanFreeText(raw);
  if (cleaned.length < 5) return true;
  const lower = cleaned.toLowerCase();
  if (IGNORE_WORDS.some((w) => lower === w.toLowerCase())) return true;
  return false;
}

function containsWholeWord(text: string, word: string): boolean {
  // نبني حدود كلمة يدوياً بدل \b لأن \b في JS لا يتعرف على حروف عربية كحدود كلمة
  // فبتنفع مع الإنجليزي بس، فبنتأكد يدوياً إن الحرف قبل/بعد الكلمة مش حرف عربي/لاتيني ملتصق
  const idx = text.indexOf(word);
  if (idx === -1) return false;
  const before = idx === 0 ? "" : text[idx - 1];
  const after = idx + word.length >= text.length ? "" : text[idx + word.length];
  const isLetter = (ch: string) => /[a-zA-Z\u0600-\u06FF]/.test(ch);
  if (before && isLetter(before)) return false;
  if (after && isLetter(after)) return false;
  return true;
}

export function classifyKeyword(raw: string): "supply" | "demand" | "unknown" {
  const t = normalizeForMatch(raw);
  const demandWords = ["مطلوب", "ابغى", "ابي", "نبغى", "نبي", "الباحث", "مطلوبه", "دورنا"];
  const supplyWords = ["متوفر", "للبيع", "عرض", "يوجد", "متوفره", "عندنا", "لدينا"];
  if (demandWords.some((w) => containsWholeWord(t, w))) return "demand";
  if (supplyWords.some((w) => containsWholeWord(t, w))) return "supply";
  return "unknown";
}
