import { db } from "@/db";
import { inventory, showrooms } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { createManualInventoryItem } from "./actions";
import ExcelUploadForm from "./ExcelUploadForm";

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

  const showroomList = await db
    .select({ id: showrooms.id, name: showrooms.name, city: showrooms.city })
    .from(showrooms)
    .orderBy(showrooms.name);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">المخزون</h1>
        <p className="mt-1 text-slate-600">جميع السيارات المضافة عبر البوت أو الرسائل الخام. صلاحية 30 يوم.</p>
      </div>

      {/* إضافة سيارة يدوياً بخانات منفصلة */}
      <form action={createManualInventoryItem} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="font-semibold text-slate-900">➕ إضافة سيارة يدوياً</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm text-slate-600">المعرض</label>
            <select name="showroomId" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">اختر المعرض</option>
              {showroomList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.city}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">الماركة</label>
            <input name="brand" required placeholder="تويوتا" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">الموديل</label>
            <input name="model" required placeholder="كامري" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">الفئة (اختياري)</label>
            <input name="trim" placeholder="ستاندر" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">سنة الصنع</label>
            <input name="year" type="number" required placeholder="2026" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">اللون (اختياري)</label>
            <input name="color" placeholder="أبيض" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">اللون الداخلي (اختياري)</label>
            <input name="interiorColor" placeholder="أسود" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">المدينة</label>
            <input name="city" required placeholder="الرياض" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">الوكيل (اختياري — سعودي افتراضياً)</label>
            <input name="spec" placeholder="سعودي" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">السعر (اختياري)</label>
            <input name="price" type="number" placeholder="120000" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">كم قطعة متوفرة</label>
            <input name="quantity" type="number" defaultValue={1} min={1} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-3">
            <label className="mb-1 block text-sm text-slate-600">ملاحظات (اختياري)</label>
            <input name="extraFeatures" placeholder="دبل، سقف اسود..." className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          إضافة للمخزون
        </button>
      </form>

      <ExcelUploadForm showroomList={showroomList} />

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
