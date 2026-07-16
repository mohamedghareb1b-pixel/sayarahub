"use client";

import { useMemo, useState } from "react";

type Row = {
  id: string;
  category: string;
  term: string;
  canonicalValue: string;
  brand: string | null;
  model: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  trim: "فئة/درجة",
  color: "لون",
  feature: "ملاحظة إضافية",
  model_alias: "موديل",
  stopword: "كلمة ممنوعة",
  brand_alias: "ماركة",
};

const CATEGORY_COLOR: Record<string, string> = {
  trim: "bg-sky-100 text-sky-700",
  color: "bg-purple-100 text-purple-700",
  feature: "bg-amber-100 text-amber-700",
  model_alias: "bg-emerald-100 text-emerald-700",
  stopword: "bg-rose-100 text-rose-700",
  brand_alias: "bg-teal-100 text-teal-700",
};

const CATEGORY_ORDER = ["brand_alias", "model_alias", "trim", "color", "feature", "stopword"];

export default function VocabularyTable({
  rows,
  onDelete,
}: {
  rows: Row[];
  onDelete: (id: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeCategory !== "all" && r.category !== activeCategory) return false;
      if (!q) return true;
      return (
        r.term.toLowerCase().includes(q) ||
        r.canonicalValue.toLowerCase().includes(q) ||
        (r.brand ?? "").toLowerCase().includes(q) ||
        (r.model ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, activeCategory]);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    return map;
  }, [filtered]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(r.category, (c.get(r.category) ?? 0) + 1);
    return c;
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* شريط البحث والفلاتر */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 ابحث في المفردات (النص، القيمة الرسمية، الماركة...)"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCategory("all")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              activeCategory === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            الكل ({rows.length})
          </button>
          {CATEGORY_ORDER.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                activeCategory === cat ? "bg-slate-900 text-white" : CATEGORY_COLOR[cat]
              }`}
            >
              {CATEGORY_LABEL[cat]} ({counts.get(cat) ?? 0})
            </button>
          ))}
        </div>
      </div>

      {/* الأقسام */}
      {filtered.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">
          لا توجد نتائج مطابقة.
        </p>
      )}

      {(activeCategory === "all" ? CATEGORY_ORDER : [activeCategory]).map((cat) => {
        const items = grouped.get(cat);
        if (!items || items.length === 0) return null;
        return (
          <div key={cat} className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-2">
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${CATEGORY_COLOR[cat]}`}>
                {CATEGORY_LABEL[cat]} — {items.length}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-right text-slate-500">
                <tr>
                  <th className="px-4 py-2">النص المكتوب</th>
                  <th className="px-4 py-2">القيمة الرسمية</th>
                  {(cat === "model_alias" || cat === "brand_alias") && <th className="px-4 py-2">الماركة/الموديل</th>}
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-900">{r.term}</td>
                    <td className="px-4 py-2 text-slate-600">{cat === "stopword" ? "—" : r.canonicalValue}</td>
                    {(cat === "model_alias" || cat === "brand_alias") && (
                      <td className="px-4 py-2 text-slate-500">
                        {r.brand || r.model ? `${r.brand ?? ""} ${r.model ?? ""}`.trim() : "—"}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <button
                        onClick={() => onDelete(r.id)}
                        className="text-xs font-semibold text-rose-600 hover:underline"
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
