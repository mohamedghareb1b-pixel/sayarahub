"use client";

import { useState } from "react";
import { runJob } from "./actions";

const JOBS = [
  {
    id: "queue-processor",
    title: "معالج الطابور (queue-processor)",
    desc: "يرسل الرسائل المعلقة في message_queue. في الإنتاج: كل 2 ثانية.",
  },
  {
    id: "ai-processor",
    title: "معالج الذكاء الاصطناعي (ai-processor)",
    desc: "يعالج raw_imports دفعة دفعة عبر Gemini أو المحلل القاعدي. في الإنتاج: كل 120 ثانية.",
  },
  {
    id: "expiry-jobs",
    title: "مهام الانتهاء (expiry-jobs)",
    desc: "ينهي الطلبات (12 ساعة) والمخزون (30 يوم) والمطابقات بدون رد (30 دقيقة) + تذكيرات التجديد. في الإنتاج: كل ساعة.",
  },
  {
    id: "daily-ping",
    title: "تذكير يومي لأصحاب المعارض (daily-ping)",
    desc: "يرسل ملخص اليوم لكل Owner. في الإنتاج: يومياً 9 مساءً بتوقيت الرياض.",
  },
  {
    id: "reset-presence",
    title: "إعادة تعيين الحضور اليومي (reset_daily_presence)",
    desc: "يصفّر is_active_today لجميع المستخدمين. في الإنتاج: يومياً منتصف الليل بتوقيت الرياض.",
  },
  {
    id: "run-all",
    title: "▶️ تشغيل كل المهام دفعة واحدة",
    desc: "مفيد للتجربة السريعة أثناء العرض التوضيحي.",
  },
];

export default function JobsPage() {
  const [results, setResults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  async function run(id: string) {
    setLoading(id);
    try {
      const data = await runJob(id);
      setResults((prev) => ({ ...prev, [id]: JSON.stringify(data.result ?? data) }));
    } catch {
      setResults((prev) => ({ ...prev, [id]: "فشل التشغيل" }));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">المهام المجدولة</h1>
        <p className="mt-1 text-slate-600">
          في الإنتاج تعمل هذه كـ pg_cron / Edge Functions تلقائياً. هنا يمكنك تشغيلها يدوياً للتجربة، أو ربطها
          بخدمة جدولة خارجية عبر <code className="rounded bg-slate-100 px-1">POST /api/cron/[job]</code>.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {JOBS.map((job) => (
          <div key={job.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900">{job.title}</h3>
            <p className="mt-1 text-sm text-slate-500">{job.desc}</p>
            <button
              onClick={() => run(job.id)}
              disabled={loading === job.id}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading === job.id ? "جاري التشغيل..." : "تشغيل الآن"}
            </button>
            {results[job.id] && (
              <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-300">
                {results[job.id]}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
