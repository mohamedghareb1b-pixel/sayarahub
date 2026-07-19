import { db } from "@/db";
import { showrooms, users, inventory } from "@/db/schema";
import { asc, eq, and, sql, ilike } from "drizzle-orm";
import {
  toggleShowroomActive,
  setSubscriptionPlan,
  updateUserName,
  removeUserFromShowroom,
  deleteUserAccount,
  deleteShowroom,
} from "./actions";
import RegistrationToggle from "./RegistrationToggle";
import AddRepInline from "./AddRepInline";

export const dynamic = "force-dynamic";

export default async function ShowroomsPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; name?: string }>;
}) {
  const { phone: phoneQuery, name: nameQuery } = await searchParams;

  const phoneResults = phoneQuery
    ? await db
        .select({
          id: users.id,
          name: users.name,
          phone: users.phone,
          role: users.role,
          showroomId: users.showroomId,
          showroomName: showrooms.name,
          showroomCity: showrooms.city,
        })
        .from(users)
        .leftJoin(showrooms, eq(users.showroomId, showrooms.id))
        .where(sql`${users.phone} ilike ${"%" + phoneQuery.replace(/[^\d+]/g, "") + "%"}`)
    : [];

  // ترتيب أبجدي بالاسم بدل الأحدث أولاً
  const rows = await db
    .select()
    .from(showrooms)
    .where(nameQuery ? ilike(showrooms.name, `%${nameQuery}%`) : undefined)
    .orderBy(asc(showrooms.name));

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

      {/* تسجيل معرض جديد أو مندوب حر — فوق عشان يكون أول حاجة تتعمل */}
      <RegistrationToggle />

      {/* بحث برقم الهاتف */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold text-slate-900">🔍 بحث برقم الهاتف</h2>
        <form method="GET" className="flex gap-2">
          <input
            name="phone"
            defaultValue={phoneQuery ?? ""}
            placeholder="مثال: 9665..."
            dir="ltr"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            بحث
          </button>
        </form>
        {phoneQuery && (
          <div className="space-y-2">
            {phoneResults.length === 0 && (
              <p className="text-sm text-slate-400">مفيش أي حساب برقم يحتوي على &quot;{phoneQuery}&quot;.</p>
            )}
            {phoneResults.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-medium text-slate-900">{r.phone}</span>
                  <span className="text-slate-500">{r.name ?? "بدون اسم"}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {r.role === "owner" ? "صاحب معرض" : r.role === "sales" ? "مندوب" : r.role}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">
                  {r.showroomName ? (
                    <>
                      تابع لمعرض: <strong>{r.showroomName}</strong> — {r.showroomCity}
                    </>
                  ) : (
                    "مش تابع لأي معرض حالياً"
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* بحث باسم المعرض */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold text-slate-900">🔍 بحث باسم المعرض</h2>
        <form method="GET" className="flex gap-2">
          <input
            name="name"
            defaultValue={nameQuery ?? ""}
            placeholder="مثال: معرض السلطان"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            بحث
          </button>
          {nameQuery && (
            <a href="/admin/showrooms" className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
              مسح
            </a>
          )}
        </form>
      </div>

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
                <td className="px-4 py-3 font-medium text-slate-900">
                  {s.name}
                  {s.isPersonalPool && (
                    <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      مجمّع مندوب
                    </span>
                  )}
                </td>
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
                      <AddRepInline showroomId={s.id} />
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
                  لا توجد معارض مطابقة.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
