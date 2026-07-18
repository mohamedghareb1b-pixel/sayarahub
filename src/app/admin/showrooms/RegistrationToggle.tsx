"use client";

import { useState } from "react";
import { createPresetShowroom, createFreeSalesRep } from "./actions";

export default function RegistrationToggle() {
  const [mode, setMode] = useState<"showroom" | "rep">("showroom");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("showroom")}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
            mode === "showroom" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          🏢 معرض جديد
        </button>
        <button
          type="button"
          onClick={() => setMode("rep")}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
            mode === "rep" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          🧑‍💼 مندوب حر (مش تابع لمعرض)
        </button>
      </div>

      {mode === "showroom" ? (
        <form action={createPresetShowroom} className="space-y-3">
          <p className="text-xs text-slate-500">
            بس الاسم والمدينة. صاحب المعرض هيربط نفسه بالمعرض ده لما يبدأ يتواصل مع البوت، أو تقدر تضيفه لاحقاً.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input name="name" required placeholder="اسم المعرض" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input name="city" required placeholder="المدينة" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            تسجيل المعرض
          </button>
        </form>
      ) : (
        <form action={createFreeSalesRep} className="space-y-3">
          <p className="text-xs text-slate-500">
            لمندوب لسه مش متأكد شغال في أي معرض. تقدر تربطه بمعرض لاحقاً بضغطة &quot;+&quot; تحت اسم المعرض.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input name="repName" placeholder="اسم المندوب" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input name="repPhone" required placeholder="رقم الهاتف (966...)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input name="repCity" placeholder="المدينة" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            تسجيل المندوب
          </button>
        </form>
      )}
    </div>
  );
}
