import { db } from "@/db";
import { inventory, showrooms, users } from "@/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { createManualInventoryItem, updateInventoryItem, removeInventoryItem } from "./actions";
import ExcelUploadForm from "./ExcelUploadForm";
import TargetSearchSelect from "./TargetSearchSelect";

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

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>;
}) {
  const { phone: phoneQuery } = await searchParams;
  const normalizedPhone = phoneQuery?.replace(/[^\d+]/g, "").trim() || null;

  // بحث يدوي سريع: اكتب رقم مندوب، يظهر كل مخزونه هو بس — أسرع بكتير من
  // تصفح 200 صف عشان تعدّل عربية واحدة بتاعته.
  let targetShowroomId: string | null = null;
  let matchedRepName: string | null = null;
  if (normalizedPhone) {
    const [rep] = await db.select().from(users).where(eq(users.phone, normalizedPhone));
    if (rep?.showroomId) {
      targetShowroomId = rep.showroomId;
      matchedRepName = rep.name;
    }
  }

  const rows = await db
    .select({ inv: inventory, showroomName: showrooms.name })
    .from(inventory)
    .leftJoin(showrooms, eq(inventory.showroomId, showrooms.id))
    .where(targetShowroomId ? eq(inventory.showroomId, targetShowroomId) : undefined)
    .orderBy(desc(inventory.createdAt))
    .limit(200);

  const showroomList = await db
    .select({ id: showrooms.id, name: showrooms.name, city: showrooms.city })
    .from(showrooms)
    .orderBy(showrooms.name);

  // مناديب تابعين لمعارض بس (المندوب الحر مش هيظهر هنا لحد ما يترط بمعرض،
  // لأن أي سيارة لازم تتسجل تحت معرض في النهاية)
  const repList = await db
    .select({ id: users.id, name: users.name, phone: users.phone, showroomId: users.showroomId })
    .from(users)
    .where(and(eq(users.role, "sales"), sql`${users.showroomId} is not null`))
    .orderBy(users.name);
  const showroomNameById = new Map(showroomList.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">المخزون</h1>
        <p className="mt-1 text-slate-600">جميع السيارات المضافة عبر البوت أو الرسائل الخام. صلاحية 30 يوم.</p>
      </div>

      {/* بحث سريع برقم المندوب — يظهر مخزونه هو بس عشان تعديل أسرع */}
      <form method="GET" className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        <input
          name="phone"
          defaultValue={phoneQuery ?? ""}
          placeholder="🔍 ابحث برقم المندوب (مثال: 0512345678)"
          dir="ltr"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          بحث
        </button>
        {phoneQuery && (
          <a href="/admin/inventory" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            مسح البحث
          </a>
        )}
      </form>
      {normalizedPhone && !targetShowroomId && (
        <p className="text-sm text-rose-600">مفيش مندوب مسجل بالرقم ده.</p>
      )}
      {targetShowroomId && (
        <p className="text-sm text-slate-500">
          بيتعرض مخزون: <span className="font-semibold text-slate-700">{matchedRepName ?? normalizedPhone}</span> ({rows.length}{" "}
          سيارة)
        </p>
      )}

      {/* إضافة سيارة يدوياً بخانات منفصلة */}
      <form action={createManualInventoryItem} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="font-semibold text-slate-900">➕ إضافة سيارة يدوياً</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <TargetSearchSelect
              showroomList={showroomList}
              repList={repList}
              showroomNameById={Object.fromEntries(showroomNameById)}
            />
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

      <ExcelUploadForm showroomList={showroomList} repList={repList} showroomNameById={Object.fromEntries(showroomNameById)} />

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
              <th className="px-4 py-3">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ inv, showroomName }) => (
              <tr key={inv.id} className="border-t border-slate-100 align-top">
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
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <details className="relative">
                      <summary className="cursor-pointer list-none rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        ✏️ تعديل
                      </summary>
                      <form
                        action={async (formData: FormData) => {
                          "use server";
                          await updateInventoryItem(formData);
                        }}
                        className="absolute left-0 z-10 mt-2 w-72 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
                      >
                        <input type="hidden" name="id" value={inv.id} />
                        <div className="grid grid-cols-2 gap-2">
                          <input name="brand" defaultValue={inv.brand} placeholder="الماركة" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <input name="model" defaultValue={inv.model} placeholder="الموديل" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <input name="trim" defaultValue={inv.trim ?? ""} placeholder="الفئة" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <input name="year" type="number" defaultValue={inv.year} placeholder="السنة" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <input name="color" defaultValue={inv.color ?? ""} placeholder="اللون" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <input name="interiorColor" defaultValue={inv.interiorColor ?? ""} placeholder="اللون الداخلي" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <input name="city" defaultValue={inv.city} placeholder="المدينة" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <input name="spec" defaultValue={inv.spec ?? ""} placeholder="الوكيل" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <input name="price" defaultValue={inv.price ?? ""} placeholder="السعر" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <input name="quantity" type="number" min={1} defaultValue={inv.quantity} placeholder="الكمية" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                        </div>
                        <input
                          name="extraFeatures"
                          defaultValue={inv.extraFeatures ?? ""}
                          placeholder="ملاحظات"
                          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
                        />
                        <button type="submit" className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                          حفظ التعديلات
                        </button>
                      </form>
                    </details>
                    {inv.status !== "sold" && (
                      <form action={removeInventoryItem}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                        >
                          🗑️ إزالة
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
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
