"use server";

import { db } from "@/db";
import { rawImports } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { processPendingRawImports } from "@/lib/aiProcessor";

export async function createManualRawImport(formData: FormData) {
  const rawText = String(formData.get("rawText") ?? "").trim();
  const sourceGroupName = String(formData.get("sourceGroupName") ?? "").trim() || null;
  const showroomId = String(formData.get("showroomId") ?? "").trim() || null;
  if (!rawText) return;

  await db.insert(rawImports).values({
    rawText,
    sourceType: sourceGroupName ? "whatsapp_group" : "admin_manual",
    sourceGroupName,
    showroomId,
    status: "pending",
  });
  revalidatePath("/admin/raw-imports");
}

export async function runAiProcessor() {
  await processPendingRawImports(50);
  revalidatePath("/admin/raw-imports");
}

export async function rejectRawImport(id: string) {
  await db.update(rawImports).set({ status: "rejected" }).where(eq(rawImports.id, id));
  revalidatePath("/admin/raw-imports");
}
