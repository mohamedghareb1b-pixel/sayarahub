import { db } from "@/db";
import { rawImports, showrooms } from "@/db/schema";
import { desc } from "drizzle-orm";
import { createManualRawImport, runAiProcessor, rejectRawImport } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "بانتظار المعالجة",
  pending_ai: "بانتظار الذكاء الاصطناعي",
  parsed: "تمت المعالجة",
  rejected: "مرفوض",
};

const CLASS_LABEL: Record<string, string> = {
  supply: "عرض (متوفر)",
  demand: "طلب (مطلوب)",
  unknown: "غير معروف",
  ignore: "تجاهل",
};

export default async function RawImportsPage() {
  const rows = await db.select().from(rawImports).orderBy(desc(rawImports.createdAt)).limit(100);
  const showroomList = await db
    .select({ id: showrooms.id, name: showrooms.name, city: showrooms.city })
    .from(showrooms)
    .orderBy(showrooms.name);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">الرسائل الخام (raw_imports)</h1>
        <p className="mt-1 text-slate-600">
          هذا هو المسار الذي تدخل منه رسائل جروبات واتساب. أضف رسالة تجريبية لمحاكاة قارئ الجروبات، ثم شغّل
          معالج الذكاء الاصطناعي لتصنيفها.
        </p>
      </div>

      <form action={createManualRawImport} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 md:flex-row md:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-slate-700">نص الرسالة</label>
          <input
            name="rawText"
            required
            placeholder="مثال: مطلوووب كامري 2025 ابيض الرياض"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="w-full md:w-64">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            سجّلها باسم معرض (اختياري — لو مفعّلة هتدخل مخزون المعرض ده فعلياً)
          </label>
          <select name="showroomId" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">بدون معرض (تصنيف فقط)</option>
            {showroomList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.city}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full md:w-56">
          <label className="mb-1 block text-sm font-medium text-slate-700">اسم الجروب (اختياري)</label>
          <input
            name="sourceGroupName"
            placeholder="جروب سيارات الرياض"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          إضافة رسالة تجريبية
        </button>
      </form>

      <form action={runAiProcessor}>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          ⚡ تشغيل معالج الذكاء الاصطناعي الآن (ai-processor)
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-slate-500">
            <tr>
              <th className="px-4 py-3">النص</th>
              <th className="px-4 py-3">المصدر</th>
              <th className="px-4 py-3">التصنيف</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">البيانات المستخرجة</th>
              <th className="px-4 py-3">تاريخ</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="max-w-xs px-4 py-3">{r.rawText}</td>
                <td className="px-4 py-3 text-slate-500">
                  {r.sourceGroupName ?? r.sourceType}
                </td>
                <td className="px-4 py-3">{CLASS_LABEL[r.classification] ?? r.classification}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td className="max-w-xs px-4 py-3 text-xs text-slate-500">
                  {r.parsedData ? JSON.stringify(r.parsedData) : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {r.createdAt.toLocaleString("ar-SA")}
                </td>
                <td className="px-4 py-3">
                  {r.status !== "rejected" && (
                    <form
                      action={async () => {
                        "use server";
                        await rejectRawImport(r.id);
                      }}
                    >
                      <button className="text-xs text-rose-600 hover:underline">رفض</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  لا توجد رسائل بعد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
