import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
  showrooms,
  users,
  inventory,
  requests,
  matches,
  messageQueue,
  rawImports,
} from "@/db/schema";

export const dynamic = "force-dynamic";

async function scalar(query: ReturnType<typeof sql>) {
  const res = await db.execute<{ count: string }>(query);
  return Number(res.rows[0]?.count ?? 0);
}

export default async function AdminDashboard() {
  const [
    showroomCount,
    activeToday,
    openRequests,
    availableCars,
    connectedMatches,
    pendingQueue,
    pendingRawImports,
    totalSalespeople,
  ] = await Promise.all([
    scalar(sql`select count(*) from ${showrooms}`),
    scalar(sql`select count(*) from ${users} where is_active_today = true`),
    scalar(sql`select count(*) from ${requests} where status = 'open'`),
    scalar(sql`select count(*) from ${inventory} where status = 'available'`),
    scalar(sql`select count(*) from ${matches} where status = 'connected'`),
    scalar(sql`select count(*) from ${messageQueue} where status in ('pending','retry')`),
    scalar(sql`select count(*) from ${rawImports} where status in ('pending','pending_ai')`),
    scalar(sql`select count(*) from ${users} where role = 'sales'`),
  ]);

  const cards = [
    { label: "المعارض المسجلة", value: showroomCount, color: "bg-emerald-50 text-emerald-700" },
    { label: "نشطون اليوم (نافذة مجانية)", value: activeToday, color: "bg-sky-50 text-sky-700" },
    { label: "طلبات مفتوحة", value: openRequests, color: "bg-amber-50 text-amber-700" },
    { label: "سيارات متاحة", value: availableCars, color: "bg-indigo-50 text-indigo-700" },
    { label: "مطابقات مؤكدة", value: connectedMatches, color: "bg-emerald-50 text-emerald-700" },
    { label: "رسائل بالطابور", value: pendingQueue, color: "bg-rose-50 text-rose-700" },
    { label: "رسائل خام بانتظار المعالجة", value: pendingRawImports, color: "bg-orange-50 text-orange-700" },
    { label: "إجمالي المناديب", value: totalSalespeople, color: "bg-slate-100 text-slate-700" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">لوحة التحكم</h1>
        <p className="mt-1 text-slate-600">
          دور المنصة ينتهي عند توصيل معرض يطلب سيارة بمعرض عنده السيارة. لا تسعير، لا تفاوض، لا عمولة.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-2xl p-5 shadow-sm ${c.color}`}>
            <p className="text-sm font-medium opacity-80">{c.label}</p>
            <p className="mt-2 text-3xl font-bold">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">التكلفة التقديرية الشهرية</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 text-sm text-slate-600 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="font-medium text-slate-900">قاعدة البيانات + الاستضافة</p>
            <p className="mt-1">~94 ريال / شهر</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="font-medium text-slate-900">قارئ الجروبات (VPS)</p>
            <p className="mt-1">~19 ريال / شهر</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="font-medium text-slate-900">Gemini 2.0 Flash + واتساب</p>
            <p className="mt-1">~55 ريال / شهر</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          هامش ربح متوقع ~98% عند 100 معرض مشترك بخطة Pro (50 ريال/رقم/شهر).
        </p>
      </div>
    </div>
  );
}