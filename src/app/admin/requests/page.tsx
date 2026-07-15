import { db } from "@/db";
import { requests, showrooms } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  open: "مفتوح",
  matched: "تمت المطابقة",
  fulfilled: "تم التوصيل",
  expired: "منتهي",
  cancelled: "ملغى",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-amber-100 text-amber-700",
  matched: "bg-sky-100 text-sky-700",
  fulfilled: "bg-emerald-100 text-emerald-700",
  expired: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-200 text-slate-600",
};

export default async function RequestsPage() {
  const rows = await db
    .select({ req: requests, showroomName: showrooms.name })
    .from(requests)
    .leftJoin(showrooms, eq(requests.showroomId, showrooms.id))
    .orderBy(desc(requests.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">الطلبات</h1>
        <p className="mt-1 text-slate-600">جميع طلبات المعارض. صلاحية 12 ساعة فقط ثم تنتهي تلقائياً.</p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-slate-500">
            <tr>
              <th className="px-4 py-3">السيارة المطلوبة</th>
              <th className="px-4 py-3">المدينة</th>
              <th className="px-4 py-3">المعرض الطالب</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">تجديدات</th>
              <th className="px-4 py-3">تنتهي في</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ req, showroomName }) => (
              <tr key={req.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {[req.brand, req.model, req.year, req.trim, req.color, req.spec].filter(Boolean).join(" ")}
                </td>
                <td className="px-4 py-3 text-slate-500">{req.city}</td>
                <td className="px-4 py-3 text-slate-500">{showroomName ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_COLOR[req.status]}`}>
                    {STATUS_LABEL[req.status] ?? req.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{req.renewedCount}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{req.expiresAt.toLocaleString("ar-SA")}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  لا توجد طلبات بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
