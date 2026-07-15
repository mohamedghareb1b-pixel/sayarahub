import { db } from "@/db";
import { messageQueue } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  sending: "bg-sky-100 text-sky-700",
  sent: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  retry: "bg-orange-100 text-orange-700",
};

export default async function QueuePage() {
  const rows = await db.select().from(messageQueue).orderBy(desc(messageQueue.createdAt)).limit(200);
  const freeCount = rows.filter((r) => r.isFree).length;
  const paidCount = rows.length - freeCount;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">طابور الرسائل</h1>
        <p className="mt-1 text-slate-600">
          كل رسالة تُرسل عبر واتساب تمر من هنا أولاً — رسائل Service Reply مجانية (نافذة 24 ساعة) مقابل رسائل
          Utility المدفوعة.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">إجمالي الرسائل</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-4 shadow-sm">
          <p className="text-sm text-emerald-700">مجانية (Service Reply)</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{freeCount}</p>
        </div>
        <div className="rounded-2xl bg-rose-50 p-4 shadow-sm">
          <p className="text-sm text-rose-700">مدفوعة (Utility)</p>
          <p className="mt-1 text-2xl font-bold text-rose-700">{paidCount}</p>
        </div>
        <div className="rounded-2xl bg-slate-100 p-4 shadow-sm">
          <p className="text-sm text-slate-600">تكلفة تقديرية</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{(paidCount * 0.09).toFixed(2)} ريال</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-slate-500">
            <tr>
              <th className="px-4 py-3">إلى</th>
              <th className="px-4 py-3">النوع</th>
              <th className="px-4 py-3">النص</th>
              <th className="px-4 py-3">مجانية؟</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">تاريخ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{r.toPhone}</td>
                <td className="px-4 py-3 text-slate-500">{r.templateName ?? r.messageType}</td>
                <td className="max-w-md px-4 py-3 text-slate-700">{r.body}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      r.isFree ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {r.isFree ? "مجانية" : "مدفوعة"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_COLOR[r.status]}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{r.createdAt.toLocaleString("ar-SA")}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  الطابور فارغ.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
