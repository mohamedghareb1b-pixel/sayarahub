import { db } from "@/db";
import { vocabularyTerms } from "@/db/schema";
import { normalizeForMatch } from "./textClean";

type VocabEntry = { term: string; value: string };
type ModelAliasEntry = { term: string; brand: string; model: string };

type VocabCache = {
  trims: VocabEntry[];
  colors: VocabEntry[];
  features: VocabEntry[];
  modelAliases: ModelAliasEntry[];
  stopwords: string[];
  loadedAt: number;
};

let cache: VocabCache = { trims: [], colors: [], features: [], modelAliases: [], stopwords: [], loadedAt: 0 };

// نعيد تحميل المفردات من قاعدة البيانات كل دقيقة كحد أقصى، عشان أي إضافة
// جديدة من الأدمن تنعكس بسرعة معقولة بدون ما نضرب قاعدة البيانات في كل رسالة.
const TTL_MS = 60_000;

export async function ensureVocabularyLoaded(): Promise<void> {
  if (Date.now() - cache.loadedAt < TTL_MS) return;
  try {
    const rows = await db.select().from(vocabularyTerms);
    cache = {
      trims: rows
        .filter((r) => r.category === "trim")
        .map((r) => ({ term: normalizeForMatch(r.term), value: r.canonicalValue })),
      colors: rows
        .filter((r) => r.category === "color")
        .map((r) => ({ term: normalizeForMatch(r.term), value: r.canonicalValue })),
      features: rows
        .filter((r) => r.category === "feature")
        .map((r) => ({ term: normalizeForMatch(r.term), value: r.canonicalValue })),
      modelAliases: rows
        .filter((r) => r.category === "model_alias" && r.brand && r.model)
        .map((r) => ({ term: normalizeForMatch(r.term), brand: r.brand!, model: r.model! })),
      stopwords: rows.filter((r) => r.category === "stopword").map((r) => normalizeForMatch(r.term)),
      loadedAt: Date.now(),
    };
  } catch {
    // لو فشل التحميل (مشكلة اتصال مؤقتة) نفضل نستخدم آخر نسخة محفوظة في
    // الذاكرة، أو نعتمد فقط على القواعد الثابتة لو كانت الذاكرة فاضية.
  }
}

export function findDynamicTerm(list: VocabEntry[], text: string): string | null {
  for (const entry of list) {
    if (entry.term && text.includes(entry.term)) return entry.value;
  }
  return null;
}

export function findDynamicModelAlias(text: string): { brand: string; model: string } | null {
  for (const entry of cache.modelAliases) {
    if (entry.term && text.includes(entry.term)) return { brand: entry.brand, model: entry.model };
  }
  return null;
}

export function getVocabCache() {
  return cache;
}
