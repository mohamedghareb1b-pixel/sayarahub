"use server";

import { db } from "@/db";
import { vocabularyTerms, vocabularyReviewQueue } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function addVocabularyTerm(formData: FormData) {
  const category = String(formData.get("category") ?? "");
  const canonicalValue = String(formData.get("canonicalValue") ?? "").trim();
  const brandInput = String(formData.get("brand") ?? "").trim();

  if (!["trim", "color", "feature", "model_alias", "stopword", "brand_alias"].includes(category)) return;

  // للموديل/الماركة بنقبل خانتين (عربي + إنجليزي) وبنسجل كل واحدة فيهم لوحدها
  // لو موجودة، عشان أي حد يكتب أي صيغة من الاتنين يترجم لنفس القيمة الرسمية.
  const termAr = String(formData.get("term_ar") ?? formData.get("term") ?? "").trim();
  const termEn = String(formData.get("term_en") ?? "").trim();
  const terms = [termAr, termEn].filter(Boolean);

  if (terms.length === 0 || !canonicalValue) return;

  // للموديل: الماركة بتيجي من الفورم، والموديل الرسمي هو نفسه القيمة الرسمية.
  // للماركة المستقلة: مفيش موديل خالص، والماركة نفسها هي القيمة الرسمية.
  const brand = category === "model_alias" ? brandInput : category === "brand_alias" ? canonicalValue : null;
  const model = category === "model_alias" ? canonicalValue : null;

  for (const term of terms) {
    await db
      .insert(vocabularyTerms)
      .values({
        category: category as "trim" | "color" | "feature" | "model_alias" | "stopword" | "brand_alias",
        term,
        canonicalValue,
        brand,
        model,
      })
      .onConflictDoUpdate({
        target: [vocabularyTerms.term, vocabularyTerms.category],
        set: { canonicalValue, brand, model },
      });
  }

  revalidatePath("/admin/vocabulary");
}

export async function deleteVocabularyTerm(id: string) {
  await db.delete(vocabularyTerms).where(eq(vocabularyTerms.id, id));
  revalidatePath("/admin/vocabulary");
}

/** إضافة بالجملة: كل سطر بالصيغة type,term,canonicalValue[,brand,model]
 * مثال:
 *   trim,كمفرت,كمفورت
 *   color,لولوي,جملي
 *   model_alias,راف4,راف فور,تويوتا,راف فور
 * أسطر فاضية أو غلط الصيغة بيتم تجاهلها بصمت بدل ما توقف باقي الأسطر. */
export async function bulkAddVocabularyTerms(formData: FormData) {
  const raw = String(formData.get("bulkText") ?? "");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const validCategories = new Set(["trim", "color", "feature", "model_alias", "stopword", "brand_alias"]);

  for (const line of lines) {
    const parts = line.split(",").map((p) => p.trim());
    const [category, term, canonicalValue, brand, model] = parts;
    if (!category || !term || !canonicalValue) continue;
    if (!validCategories.has(category)) continue;

    await db
      .insert(vocabularyTerms)
      .values({
        category: category as "trim" | "color" | "feature" | "model_alias",
        term,
        canonicalValue,
        brand: category === "model_alias" ? brand || null : null,
        model: category === "model_alias" ? model || null : null,
      })
      .onConflictDoUpdate({
        target: [vocabularyTerms.term, vocabularyTerms.category],
        set: {
          canonicalValue,
          brand: category === "model_alias" ? brand || null : null,
          model: category === "model_alias" ? model || null : null,
        },
      });
  }

  revalidatePath("/admin/vocabulary");
}

/** يحسم كلمة معلّقة: يسجلها في المفردات الرسمية بالقيمة اللي حددها الأدمن،
 * ويشيلها من قايمة الانتظار. */
export async function resolveReviewedTerm(formData: FormData) {
  const queueId = String(formData.get("queueId") ?? "");
  const category = String(formData.get("category") ?? "") as
    | "trim"
    | "color"
    | "feature"
    | "model_alias"
    | "stopword"
    | "brand_alias";
  const term = String(formData.get("term") ?? "").trim();
  const canonicalValue = String(formData.get("resolvedValue") ?? "").trim();
  const brand = String(formData.get("brand") ?? "").trim() || null;

  if (!queueId || !term || !canonicalValue) return;

  await db
    .insert(vocabularyTerms)
    .values({
      category,
      term,
      canonicalValue,
      brand: category === "model_alias" ? brand : category === "brand_alias" ? canonicalValue : null,
      model: category === "model_alias" ? canonicalValue : null,
    })
    .onConflictDoUpdate({
      target: [vocabularyTerms.term, vocabularyTerms.category],
      set: { canonicalValue },
    });

  await db.delete(vocabularyReviewQueue).where(eq(vocabularyReviewQueue.id, queueId));
  revalidatePath("/admin/vocabulary");
}

/** يتجاهل كلمة معلّقة من غير ما يسجلها (لو كانت غلطة كتابة أو مش مهمة). */
export async function dismissReviewedTerm(queueId: string) {
  await db.delete(vocabularyReviewQueue).where(eq(vocabularyReviewQueue.id, queueId));
  revalidatePath("/admin/vocabulary");
}
