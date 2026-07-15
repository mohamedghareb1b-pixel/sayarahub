import { db } from "@/db";
import { inventory, showrooms } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  available: "متاح",
  processing: "قيد التأكيد",
  reserved: "محجوز/موصل",
  sold: "مباع",
  expired: "منتهي",
};

const STATUS_COLOR: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-700",
  processing: "bg-amber-100 text-amber-700",
  reserved: "bg-sky-100 text-sky-700",
  sold: "bg-slate-200 text-slate-600",
  expired: "bg-rose-100 text-rose-700",
};

export default async function InventoryPage() {
  const rows = await db
    .select({ inv: inventory, showroomName: showrooms.name })
    .from(inventory)
    .leftJoin(showrooms, eq(inventory.showroomId, showrooms.id))
    .orderBy(desc(inventory.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">المخزون</h1>
        <p className="mt-1 text-slate-600">جميع السيارات المضافة عبر البوت أو الرسائل الخام. صلاحية 30 يوم.</p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-slate-500">
            <tr>
              <th className="px-4 py-3">السيارة</th>
              <th className="px-4 py-3">المدينة</th>
              <th className="px-4 py-3">السعر</th>
              <th className="px-4 py-3">المعرض</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">تنتهي في</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ inv, showroomName }) => (
              <tr key={inv.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {[inv.brand, inv.model, inv.year, inv.trim, inv.color, inv.spec].filter(Boolean).join(" ")}
                </td>
                <td className="px-4 py-3 text-slate-500">{inv.city}</td>
                <td className="px-4 py-3 text-slate-500">{inv.price ? `${inv.price} ريال` : "—"}</td>
                <td className="px-4 py-3 text-slate-500">{showroomName ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_COLOR[inv.status]}`}>
                    {STATUS_LABEL[inv.status] ?? inv.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{inv.expiresAt.toLocaleDateString("ar-SA")}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  لا توجد سيارات بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
