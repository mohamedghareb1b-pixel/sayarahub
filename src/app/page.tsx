import Link from "next/link";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function scalar(query: ReturnType<typeof sql>) {
  const res = await db.execute<{ count: string }>(query);
  return Number(res.rows[0]?.count ?? 0);
}

const FEATURES = [
  {
    title: "بدون تسعير أو تفاوض",
    desc: "دور المنصة ينتهي عند توصيل معرض يطلب سيارة بمعرض عنده السيارة. لا دفع داخل المنصة ولا عمولة على الصفقة.",
  },
  {
    title: "بوت واتساب ذكي",
    desc: "المعارض والمناديب يتعاملون عبر واتساب بنص حر: 'مطلوب كامري 2025 ابيض' أو 'متوفر سوناتا 2024'.",
  },
  {
    title: "قراءة جروبات واتساب",
    desc: "استيراد آلي لرسائل الجروبات، تنظيف مجاني، ثم تصنيف بالذكاء الاصطناعي على دفعات لتقليل التكلفة.",
  },
  {
    title: "مطابقة فورية + توصيل",
    desc: "محرك مطابقة يبحث في مخزون كل المعارض، يؤكد التوفر مع المندوب المناوب (Round-Robin)، ثم يوصل الطرفين مباشرة.",
  },
  {
    title: "توفير تكلفة الرسائل",
    desc: "نظام حضور صباحي يفتح نافذة 24 ساعة مجانية بدل رسائل Utility المدفوعة في كل مرة.",
  },
  {
    title: "انضمام بدون أكواد",
    desc: "المندوب يبحث عن اسم معرضه بالذكاء الاصطناعي (تشابه نصي)، أو صاحب المعرض يضيفه مباشرة برقم الجوال.",
  },
];

export default async function HomePage() {
  const [showroomCount, carsCount, matchesCount] = await Promise.all([
    scalar(sql`select count(*) from showrooms`),
    scalar(sql`select count(*) from inventory where status = 'available'`),
    scalar(sql`select count(*) from matches where status = 'connected'`),
  ]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-white">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <header className="flex items-center justify-between">
          <p className="text-xl font-extrabold text-emerald-700">🚗 SayaraHub | سيارة هب</p>
          <nav className="flex gap-4 text-sm font-medium">
            <Link href="/simulator" className="rounded-full bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">
              جرّب البوت الآن
            </Link>
            <Link href="/admin" className="rounded-full border border-emerald-600 px-4 py-2 text-emerald-700 hover:bg-emerald-50">
              لوحة الإدارة
            </Link>
          </nav>
        </header>

        <section className="mt-16 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight text-slate-900 md:text-5xl">
            نظام توصيل ذكي بين معارض السيارات عبر واتساب
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
            2000+ رسالة يومياً في جروبات واتساب لمعارض السيارات — طلب يضيع، مخزون لا يُرى. سيارة هب تقرأ، تفهم،
            تطابق، وتوصّل — فقط Smart Intermediation، بدون تسعير أو عمولة.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link
              href="/simulator"
              className="rounded-full bg-emerald-600 px-6 py-3 font-semibold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700"
            >
              ابدأ محاكاة محادثة واتساب
            </Link>
            <Link
              href="/admin"
              className="rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 hover:bg-slate-50"
            >
              افتح لوحة الإدارة
            </Link>
          </div>
        </section>

        <section className="mt-16 grid grid-cols-3 gap-4">
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-3xl font-extrabold text-emerald-700">{showroomCount}</p>
            <p className="mt-1 text-sm text-slate-500">معرض مسجل</p>
          </div>
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-3xl font-extrabold text-emerald-700">{carsCount}</p>
            <p className="mt-1 text-sm text-slate-500">سيارة متاحة الآن</p>
          </div>
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-3xl font-extrabold text-emerald-700">{matchesCount}</p>
            <p className="mt-1 text-sm text-slate-500">صفقة تم توصيلها</p>
          </div>
        </section>

        <section className="mt-20 grid gap-6 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <h3 className="font-bold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.desc}</p>
            </div>
          ))}
        </section>

        <section className="mt-20 rounded-3xl bg-slate-900 p-10 text-white">
          <h2 className="text-2xl font-bold">كيف تعمل الرحلة؟</h2>
          <ol className="mt-6 grid gap-4 text-sm text-slate-200 md:grid-cols-4">
            <li className="rounded-xl bg-white/10 p-4">1. صاحب المعرض أو المندوب يراسل البوت بنص حر</li>
            <li className="rounded-xl bg-white/10 p-4">2. البوت يفهم الطلب أو العرض ويؤكد التفاصيل</li>
            <li className="rounded-xl bg-white/10 p-4">3. محرك المطابقة يبحث بين كل المعارض ويؤكد التوفر</li>
            <li className="rounded-xl bg-white/10 p-4">4. توصيل مباشر بين الطرفين عبر واتساب — تنتهي مهمتنا هنا</li>
          </ol>
        </section>

        <footer className="mt-16 text-center text-xs text-slate-400">
          SayaraHub V1.0 — Smart Intermediation فقط، لا تسعير، لا تفاوض، لا دفع داخل المنصة.
        </footer>
      </div>
    </main>
  );
}
