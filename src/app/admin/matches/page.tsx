import { db } from "@/db";
import { matches, inventory, requests, showrooms } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: "بانتظار تأكيد المعرض",
  confirmed_available: "تم التأكيد",
  connected: "تم التوصيل ✅",
  declined: "تم البيع (رفض)",
  expired: "منتهي",
  no_response: "لا رد",
};

const STATUS_COLOR: Record<string, string> = {
  pending_confirmation: "bg-amber-100 text-amber-700",
  confirmed_available: "bg-sky-100 text-sky-700",
  connected: "bg-emerald-100 text-emerald-700",
  declined: "bg-rose-100 text-rose-700",
  expired: "bg-slate-200 text-slate-600",
  no_response: "bg-slate-200 text-slate-600",
};

export default async function MatchesPage() {
  const requesterShowroom = alias(showrooms, "requester_showroom");
  const supplierShowroom = alias(showrooms, "supplier_showroom");

  const rows = await db
    .select({
      match: matches,
      inv: inventory,
      req: requests,
      requesterName: requesterShowroom.name,
      supplierName: supplierShowroom.name,
    })
    .from(matches)
    .leftJoin(inventory, eq(matches.inventoryId, inventory.id))
    .leftJoin(requests, eq(matches.requestId, requests.id))
    .leftJoin(requesterShowroom, eq(matches.requestShowroomId, requesterShowroom.id))
    .leftJoin(supplierShowroom, eq(matches.inventoryShowroomId, supplierShowroom.id))
    .orderBy(desc(matches.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">المطابقات</h1>
        <p className="mt-1 text-slate-600">دورة حياة كل مطابقة من الاقتراح حتى التوصيل النهائي.</p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-slate-500">
            <tr>
              <th className="px-4 py-3">السيارة</th>
              <th className="px-4 py-3">المعرض الطالب</th>
              <th className="px-4 py-3">المعرض المورد</th>
              <th className="px-4 py-3">النقاط</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">تاريخ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ match, inv, requesterName, supplierName }) => (
              <tr key={match.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {inv ? [inv.brand, inv.model, inv.year, inv.color].filter(Boolean).join(" ") : "—"}
                </td>
                <td className="px-4 py-3 text-slate-500">{requesterName ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{supplierName ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{match.matchScore}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_COLOR[match.status]}`}>
                    {STATUS_LABEL[match.status] ?? match.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{match.createdAt.toLocaleString("ar-SA")}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  لا توجد مطابقات بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
