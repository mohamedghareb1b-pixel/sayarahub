"use client";

import { useState } from "react";
import { addPresetSalesRep } from "./actions";

export default function AddRepInline({ showroomId }: { showroomId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
      >
        + إضافة مندوب
      </button>
    );
  }

  return (
    <form action={addPresetSalesRep} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="showroomId" value={showroomId} />
      <input name="salesName" placeholder="الاسم" className="w-24 rounded border border-slate-300 px-2 py-1 text-xs" />
      <input name="salesPhone" required placeholder="الرقم" className="w-28 rounded border border-slate-300 px-2 py-1 text-xs" />
      <button type="submit" className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
        حفظ
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400">
        إلغاء
      </button>
    </form>
  );
}
