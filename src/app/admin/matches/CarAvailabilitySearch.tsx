"use client";

import { useState, useTransition } from "react";
import { searchCarAvailability, type CarAvailabilityResult } from "./actions";

export default function CarAvailabilitySearch() {
  const [results, setResults] = useState<CarAvailabilityResult[] | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-emerald-900">🔍 مين عنده السيارة دي؟</h2>
        <p className="text-xs text-emerald-700">
          ادخل مواصفات السيارة، وهنوريك كل المعارض/المناديب اللي عندهم نفس السيارة متاحة دلوقتي مع أرقامهم — مفيدة
          عشان تاخد الأرقام وتبعتلهم أول رسايل تفعيل للبوت.
        </p>
      </div>
      <form
        action={(formData) => {
          startTransition(async () => {
            const res = await searchCarAvailability(formData);
            setResults(res);
          });
        }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-4"
      >
        <input name="brand" placeholder="الماركة" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input name="model" placeholder="الموديل" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input name="trim" placeholder="الفئة (اختياري)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input name="year" type="number" placeholder="السنة (اختياري)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button
          type="submit"
          disabled={isPending}
          className="sm:col-span-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending ? "جاري البحث..." : "بحث"}
        </button>
      </form>

      {results !== null && (
        <div className="space-y-2">
          {results.length === 0 && <p className="text-sm text-emerald-700">مفيش أي معرض عنده السيارة دي متاحة دلوقتي.</p>}
          {results.map((r, i) => (
            <div key={i} className="rounded-lg border border-emerald-200 bg-white p-3 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <strong className="text-slate-900">{r.showroomName}</strong>
                <span className="text-slate-500">— {r.showroomCity}</span>
                <span className="text-xs text-slate-400">
                  {r.brand} {r.model} {r.trim} {r.year} {r.color} {r.price ? `— ${r.price} ريال` : ""} (الكمية: {r.quantity})
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {r.contacts.map((c, j) => (
                  <span
                    key={j}
                    dir="ltr"
                    className="cursor-pointer rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                    onClick={() => navigator.clipboard?.writeText(c.phone)}
                    title="دوس تنسخ الرقم"
                  >
                    {c.phone} {c.name ? `(${c.name})` : ""} — {c.role === "owner" ? "صاحب" : "مندوب"}
                  </span>
                ))}
                {r.contacts.length === 0 && <span className="text-xs text-slate-400">مفيش أرقام تواصل مسجلة.</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
