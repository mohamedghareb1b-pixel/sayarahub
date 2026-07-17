"use server";

import { db } from "@/db";
import { inventory, showrooms } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { buildFingerprint } from "@/lib/fingerprint";
import * as XLSX from "xlsx";

type ManualCarInput = {
  showroomId: string;
  brand: string;
  model: string;
  trim: string | null;
  year: number;
  color: string | null;
  interiorColor: string | null;
  city: string;
  spec: string;
  extraFeatures: string | null;
  price: string | null;
  quantity: number;
};

async function saveOneInventoryItem(car: ManualCarInput) {
  if (!car.showroomId || !car.brand || !car.model || !car.year || !car.city) return false;

  const fingerprint = buildFingerprint({
    brand: car.brand,
    model: car.model,
    year: car.year,
    trim: car.trim,
    color: car.color,
    city: car.city,
  });

  const [existing] = await db
    .select()
    .from(inventory)
    .where(
      and(eq(inventory.showroomId, car.showroomId), eq(inventory.fingerprint, fingerprint), eq(inventory.status, "available")),
    );

  if (existing) {
    await db
      .update(inventory)
      .set({
        quantity: existing.quantity + car.quantity,
        interiorColor: car.interiorColor ?? existing.interiorColor,
        extraFeatures: car.extraFeatures ?? existing.extraFeatures,
        spec: car.spec,
        price: car.price || existing.price,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .where(eq(inventory.id, existing.id));
  } else {
    await db.insert(inventory).values({
      showroomId: car.showroomId,
      brand: car.brand,
      model: car.model,
      year: car.year,
      trim: car.trim,
      color: car.color,
      interiorColor: car.interiorColor,
      extraFeatures: car.extraFeatures,
      spec: car.spec,
      city: car.city,
      price: car.price,
      quantity: car.quantity,
      fingerprint,
      status: "available",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  }
  return true;
}

export async function createManualInventoryItem(formData: FormData) {
  const showroomId = String(formData.get("showroomId") ?? "").trim();
  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const trim = String(formData.get("trim") ?? "").trim() || null;
  const year = parseInt(String(formData.get("year") ?? "").trim(), 10);
  const color = String(formData.get("color") ?? "").trim() || null;
  const interiorColor = String(formData.get("interiorColor") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim();
  const specInput = String(formData.get("spec") ?? "").trim();
  const extraFeatures = String(formData.get("extraFeatures") ?? "").trim() || null;
  const price = String(formData.get("price") ?? "").trim() || null;
  const quantity = parseInt(String(formData.get("quantity") ?? "1").trim(), 10) || 1;

  await saveOneInventoryItem({
    showroomId,
    brand,
    model,
    trim,
    year,
    color,
    interiorColor,
    city,
    spec: specInput || "سعودي",
    extraFeatures,
    price,
    quantity,
  });

  revalidatePath("/admin/inventory");
}

// نفس ترتيب أعمدة قالب "مخزون_قالب.xlsx" بالظبط — أي ملف مرفوع لازم يبدأ
// بنفس العناوين دي بالترتيب ده، وإلا هنرفض الملف ونوضح السبب.
const TEMPLATE_HEADERS = [
  "الماركة",
  "الموديل",
  "الفئة",
  "سنة الصنع",
  "اللون",
  "الوكيل",
  "المدينة",
  "السعر",
  "الكمية",
  "ملاحظات",
];

export async function uploadInventorySheet(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const showroomId = String(formData.get("showroomId") ?? "").trim();
  const file = formData.get("file") as File | null;

  if (!showroomId) return { ok: false, message: "اختر المعرض الأول." };
  if (!file || file.size === 0) return { ok: false, message: "اختر ملف إكسل." };

  const [showroom] = await db.select().from(showrooms).where(eq(showrooms.id, showroomId));
  if (!showroom) return { ok: false, message: "المعرض غير موجود." };

  const buffer = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "الملف مش ملف إكسل صحيح." };
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (rows.length === 0) {
    return { ok: false, message: "الملف فاضي أو مفيهوش صفوف بيانات." };
  }

  // تحقق إن رؤوس الأعمدة مطابقة لقالبنا بالظبط — لو مش مطابقة، نرفض الملف
  // كله بدل ما نخمن ونسجل بيانات غلط في العمود الغلط.
  const actualHeaders = Object.keys(rows[0]);
  const missing = TEMPLATE_HEADERS.filter((h) => !actualHeaders.includes(h));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `الملف مش مطابق لقالبنا. الأعمدة الناقصة: ${missing.join("، ")}. حمّل قالب "مخزون_قالب.xlsx" واستخدمه.`,
    };
  }

  let saved = 0;
  let skipped = 0;

  for (const row of rows) {
    const brand = String(row["الماركة"] ?? "").trim();
    const model = String(row["الموديل"] ?? "").trim();
    const trim = String(row["الفئة"] ?? "").trim() || null;
    const yearRaw = row["سنة الصنع"];
    const year = typeof yearRaw === "number" ? yearRaw : parseInt(String(yearRaw ?? "").trim(), 10);
    const color = String(row["اللون"] ?? "").trim() || null;
    const specInput = String(row["الوكيل"] ?? "").trim();
    const city = String(row["المدينة"] ?? "").trim();
    const priceRaw = row["السعر"];
    const price = priceRaw ? String(priceRaw).trim() : null;
    const quantityRaw = row["الكمية"];
    const quantity = (typeof quantityRaw === "number" ? quantityRaw : parseInt(String(quantityRaw ?? "").trim(), 10)) || 1;
    const extraFeatures = String(row["ملاحظات"] ?? "").trim() || null;

    if (!brand || !model || !year || !city) {
      skipped++;
      continue;
    }

    const success = await saveOneInventoryItem({
      showroomId,
      brand,
      model,
      trim,
      year,
      color,
      interiorColor: null,
      city,
      spec: specInput || "سعودي",
      extraFeatures,
      price,
      quantity,
    });
    if (success) saved++;
    else skipped++;
  }

  revalidatePath("/admin/inventory");
  return { ok: true, message: `تم حفظ ${saved} سيارة${skipped > 0 ? ` (وتخطينا ${skipped} صف ناقص بيانات إجبارية)` : ""}.` };
}
