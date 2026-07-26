"use client";

import { useState, useTransition } from "react";
import { createMarketingRequest } from "./actions";

export default function MarketingRequestForm() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setResult(null);
        startTransition(async () => {
          const res = await createMarketingRequest(formData);
          setResult(res);
        });
      }}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
    >
      <div>
        <h2 className="font-semibold text-slate-900">🎯 طلب لمندوب مش مسجل (وسيلة تسويقية)</h2>
        <p className="mt-1 text-xs text-slate-500">
          ادخل رقم المندوب الطالب وتفاصيل السيارة بس — لو مسجلش معانا قبل كده هنعمله حساب تلقائي. بعد كده النظام
          بيدوّر تلقائي على أي مخزون متاح مطابق (بالماركة/الموديل/الفئة/السنة) ويبعت رسالة البث العادية لكل مندوب
          عنده تطابق. المدينة اختيارية ومش شرط للمطابقة.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm text-slate-600">رقم المندوب الطالب (اللي عايز السيارة)</label>
        <input
          name="requesterPhone"
          required
          placeholder="0512345678"
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm text-slate-600">الماركة</label>
          <input name="brand" required placeholder="تويوتا" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600">الموديل</label>
          <input name="model" required placeholder="كامري" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600">الفئة (اختياري)</label>
          <input name="trim" placeholder="فل كامل" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600">سنة الصنع</label>
          <input name="year" type="number" required placeholder="2024" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600">اللون (اختياري)</label>
          <input name="color" placeholder="أبيض" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600">المدينة (اختياري)</label>
          <input name="city" placeholder="الرياض" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600">الوكيل (اختياري)</label>
          <input name="spec" placeholder="سعودي" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm text-slate-600">ملاحظة (اختياري، هتظهر كملاحظات في رسالة المطابقة)</label>
          <input name="note" placeholder="مثال: عميل من الرياض جاد ومستعجل" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {isPending ? "جاري الإرسال..." : "📤 سجّل الطلب وابعت المطابقة تلقائي"}
      </button>

      {result && (
        <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-rose-600"}`}>{result.message}</p>
      )}
    </form>
  );
}
