"use client";

import { useState, useTransition } from "react";
import { uploadInventorySheet } from "./actions";

type Rep = { id: string; name: string | null; phone: string; showroomId: string | null };

export default function ExcelUploadForm({
  showroomList,
  repList,
  showroomNameById,
}: {
  showroomList: { id: string; name: string; city: string }[];
  repList: Rep[];
  showroomNameById: Record<string, string>;
}) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setResult(null);
        startTransition(async () => {
          const res = await uploadInventorySheet(formData);
          setResult(res);
        });
      }}
      className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3"
    >
      <h2 className="font-semibold text-slate-900">📊 رفع ملف إكسل (لازم يكون بنفس قالبنا)</h2>
      <p className="text-xs text-slate-500">
        حمّل قالب &quot;مخزون_قالب.xlsx&quot; واملأه، وارفعه هنا. الأعمدة لازم تكون بنفس الترتيب والأسماء بالظبط:
        الماركة، الموديل، الفئة، سنة الصنع، اللون، الوكيل، المدينة، السعر، الكمية، ملاحظات.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select name="target" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">هتتسجل باسم مين؟</option>
          <optgroup label="المعارض">
            {showroomList.map((s) => (
              <option key={s.id} value={`showroom:${s.id}`}>
                {s.name} — {s.city}
              </option>
            ))}
          </optgroup>
          <optgroup label="مناديب">
            {repList.map((r) => (
              <option key={r.id} value={`rep:${r.id}:${r.showroomId}`}>
                {r.name ?? r.phone} — {showroomNameById[r.showroomId ?? ""] ?? ""}
              </option>
            ))}
          </optgroup>
        </select>
        <input
          name="file"
          type="file"
          accept=".xlsx,.xls"
          required
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {isPending ? "جاري الرفع..." : "رفع ومعالجة الملف"}
      </button>
      {result && (
        <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-rose-600"}`}>{result.message}</p>
      )}
    </form>
  );
}
