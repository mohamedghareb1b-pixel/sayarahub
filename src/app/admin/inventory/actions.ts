"use server";

import { db } from "@/db";
import { inventory, showrooms } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { buildFingerprint } from "@/lib/fingerprint";

export async function createManualInventoryItem(formData: FormData) {
  const showroomId = String(formData.get("showroomId") ?? "").trim();
  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const trim = String(formData.get("trim") ?? "").trim() || null;
  const yearStr = String(formData.get("year") ?? "").trim();
  const year = parseInt(yearStr, 10);
  const color = String(formData.get("color") ?? "").trim() || null;
  const interiorColor = String(formData.get("interiorColor") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim();
  // الوكيل/المواصفة: لو المستخدم سابها فاضية نفترض "سعودي" افتراضياً، ولو
  // كتب حاجة نستخدم اللي كتبه بالظبط زي ما هو.
  const specInput = String(formData.get("spec") ?? "").trim();
  const spec = specInput || "سعودي";
  const extraFeatures = String(formData.get("extraFeatures") ?? "").trim() || null;
  const price = String(formData.get("price") ?? "").trim();
  const quantityStr = String(formData.get("quantity") ?? "1").trim();
  const quantity = parseInt(quantityStr, 10) || 1;

  if (!showroomId || !brand || !model || !year || !city) return;

  const fingerprint = buildFingerprint({ brand, model, year, trim, color, city });

  const [existing] = await db
    .select()
    .from(inventory)
    .where(
      and(eq(inventory.showroomId, showroomId), eq(inventory.fingerprint, fingerprint), eq(inventory.status, "available")),
    );

  if (existing) {
    await db
      .update(inventory)
      .set({
        quantity: existing.quantity + quantity,
        interiorColor: interiorColor ?? existing.interiorColor,
        extraFeatures: extraFeatures ?? existing.extraFeatures,
        spec,
        price: price || existing.price,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .where(eq(inventory.id, existing.id));
  } else {
    await db.insert(inventory).values({
      showroomId,
      brand,
      model,
      year,
      trim,
      color,
      interiorColor,
      extraFeatures,
      spec,
      city,
      price: price || null,
      quantity,
      fingerprint,
      status: "available",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  }

  revalidatePath("/admin/inventory");
}
