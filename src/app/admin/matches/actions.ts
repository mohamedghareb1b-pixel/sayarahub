"use server";

import { db } from "@/db";
import { inventory, showrooms, users } from "@/db/schema";
import { and, eq, ilike, inArray } from "drizzle-orm";

export type CarAvailabilityResult = {
  showroomId: string;
  showroomName: string;
  showroomCity: string;
  brand: string;
  model: string;
  trim: string | null;
  year: number;
  color: string | null;
  price: string | null;
  quantity: number;
  contacts: {
    name: string | null;
    phone: string;
    role: string;
  }[];
};

export async function searchCarAvailability(
  formData: FormData
): Promise<CarAvailabilityResult[]> {
  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const trim = String(formData.get("trim") ?? "").trim();
  const yearStr = String(formData.get("year") ?? "").trim();
  const year = yearStr ? parseInt(yearStr, 10) : null;

  if (!brand && !model) {
    return [];
  }

  const conditions = [eq(inventory.status, "available")];

  if (brand) {
    conditions.push(ilike(inventory.brand, `%${brand}%`));
  }

  if (model) {
    conditions.push(ilike(inventory.model, `%${model}%`));
  }

  if (trim) {
    conditions.push(ilike(inventory.trim, `%${trim}%`));
  }

  if (year) {
    conditions.push(eq(inventory.year, year));
  }

  const rows = await db
    .select({
      showroomId: inventory.showroomId,
      showroomName: showrooms.name,
      showroomCity: showrooms.city,
      brand: inventory.brand,
      model: inventory.model,
      trim: inventory.trim,
      year: inventory.year,
      color: inventory.color,
      price: inventory.price,
      quantity: inventory.quantity,
    })
    .from(inventory)
    .innerJoin(showrooms, eq(inventory.showroomId, showrooms.id))
    .where(and(...conditions))
    .limit(200);

  if (rows.length === 0) {
    return [];
  }

  const showroomIds = [...new Set(rows.map((r) => r.showroomId))];

  const contacts = await db
    .select({
      showroomId: users.showroomId,
      name: users.name,
      phone: users.phone,
      role: users.role,
    })
    .from(users)
    .where(inArray(users.showroomId, showroomIds));

  const contactsByShowroom = new Map<
    string,
    CarAvailabilityResult["contacts"]
  >();

  for (const contact of contacts) {
    if (!contact.showroomId) continue;

    const list = contactsByShowroom.get(contact.showroomId) ?? [];

    list.push({
      name: contact.name,
      phone: contact.phone,
      role: contact.role,
    });

    contactsByShowroom.set(contact.showroomId, list);
  }

  return rows.map((row) => ({
    ...row,
    contacts: contactsByShowroom.get(row.showroomId) ?? [],
  }));
}