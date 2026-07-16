import { db } from "@/db";
import { showrooms, users, inventory } from "@/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import {
  toggleShowroomActive,
  setSubscriptionPlan,
  createPresetShowroom,
  addPresetSalesRep,
  updateUserName,
  removeUserFromShowroom,
  deleteUserAccount,
  deleteShowroom,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function ShowroomsPage() {
  const rows = await db.select().from(showrooms).orderBy(desc(showrooms.createdAt));

  const allStaff = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      role: users.role,
      showroomId: users.showroomId,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.role, "sales"), sql`${users.showroomId} is not null`))
    .orderBy(users.createdAt);
  const staffByShowroom = new Map<string, typeof allStaff>();
  for (const s of allStaff) {
    if (!s.showroomId) continue;
    const list = staffByShowroom.get(s.showroomId) ?? [];
    list.push(s);
    staffByShowroom.set(s.showroomId, list);
  }

  const staffCounts = await db
    .select({ showroomId: users.showroomId, count: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.role, "sales"))
    .groupBy(users.showroomId);
  const staffMap = new Map(staffCounts.map((s) => [s.showroomId, s.count]));

  const invCounts = await db
    .select({ showroomId: inventory.showroomId, count: sql<number>`count(*)::int` })
    .from(inventory)
    .where(eq(inventory.status, "available"))
    .groupBy(inventory.showroomId);
  const invMap = new Map(invCounts.map((s) => [s.showroomId, s.count]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">المعارض</h1>
        <p className="mt-1 text-slate-600">إدارة المعارض المسجلة، حالة الاشتراك، والتفعيل/الحظر.</p>
      </div>

      {/* تسجيل مسبق لمعرض قبل ما صاحبه يتواصل مع البوت خالص */}
      <form action={createPresetShowroom} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold text-slate-900">تسجيل معرض مسبقاً (قبل ما صاحبه يبدأ)</h2>
        <p className="text-xs text-slate-500">
          أول ما يبعت صاحب المعرض أي رسالة من نفس الرقم ده، هيدخل مباشرة كأنه سجّل بنفسه — بدون أي خطوات تسجيل.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input name="name" required placeholder="اسم المعرض" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="city" required placeholder="المدينة" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="ownerPhone" required placeholder="رقم صاحب المعرض (966...)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="ownerName" placeholder="اسم صاحب المعرض (اختياري)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          تسجيل المعرض
        </button>
      </form>

      {/* تسجيل مسبق لمندوب تحت معرض موجود */}
      <form action={addPresetSalesRep} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold text-slate-900">تسجيل مندوب مسبقاً تحت معرض موجود</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select name="showroomId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">اختر المعرض</option>
            {rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.city}
              </option>
            ))}
          </select>
          <input name="salesPhone" required placeholder="رقم المندوب (966...)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="salesName" placeholder="اسم المندوب (اختياري)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          إضافة المندوب
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-slate-500">
            <tr>
              <th className="px-4 py-3">المعرض</th>
              <th className="px-4 py-3">المدينة</th>
              <th className="px-4 py-3">المناديب</th>
              <th className="px-4 py-3">المخزون المتاح</th>
              <th className="px-4 py-3">المطابقات المؤكدة</th>
              <th className="px-4 py-3">الخطة</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                <td className="px-4 py-3 text-slate-500">{s.city}</td>
                <td className="px-4 py-3">
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">
                      {staffByShowroom.get(s.id)?.length ?? 0} مندوب
                    </summary>
                    <div className="mt-2 space-y-2">
                      {(staffByShowroom.get(s.id) ?? []).map((rep) => (
                        <div key={rep.id} className="rounded-lg border border-slate-200 p-2 text-xs">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span dir="ltr" className="text-slate-500">{rep.phone}</span>
                            <form action={removeUserFromShowroom.bind(null, rep.id)}>
                              <button type="submit" className="text-rose-600 hover:underline">فصل عن المعرض</button>
                            </form>
                          </div>
                          <form action={updateUserName.bind(null, rep.id)} className="flex gap-1">
                            <input
                              name="name"
                              defaultValue={rep.name ?? ""}
                              placeholder="اسم المندوب"
                              className="w-full rounded border border-slate-300 px-2 py-1"
                            />
                            <button type="submit" className="rounded bg-slate-800 px-2 py-1 text-white">حفظ</button>
                          </form>
                          <form action={deleteUserAccount.bind(null, rep.id)} className="mt-1">
                            <button type="submit" className="text-rose-500 hover:underline">حذف الحساب نهائياً</button>
                          </form>
                        </div>
                      ))}
                      {(staffByShowroom.get(s.id) ?? []).length === 0 && (
                        <p className="text-slate-400">لا يوجد مناديب مسجلين.</p>
                      )}
                    </div>
                  </details>
                </td>
                <td className="px-4 py-3">{invMap.get(s.id) ?? 0}</td>
                <td className="px-4 py-3">
                  {s.monthlyConfirmedMatches} / {s.maxConfirmedMatches >= 999999 ? "∞" : s.maxConfirmedMatches}
                </td>
                <td className="px-4 py-3">
                  <form
                    action={async () => {
                      "use server";
                      await setSubscriptionPlan(s.id, s.subscriptionPlan === "pro" ? "free" : "pro");
                    }}
                  >
                    <button
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        s.subscriptionPlan === "pro"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {s.subscriptionPlan === "pro" ? "Pro" : "Free"}
                    </button>
                  </form>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      s.isActive ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {s.isActive ? "نشط" : "محظور"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <form
                    action={async () => {
                      "use server";
                      await toggleShowroomActive(s.id, s.isActive);
                    }}
                  >
                    <button className="text-xs text-slate-600 hover:underline">
                      {s.isActive ? "حظر" : "تفعيل"}
                    </button>
                  </form>
                  <form action={deleteShowroom.bind(null, s.id)} className="mt-1">
                    <button className="text-xs text-rose-600 hover:underline">حذف نهائي</button>
                  </form>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  لا توجد معارض مسجلة بعد. جرّب محاكي واتساب لتسجيل أول معرض.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
