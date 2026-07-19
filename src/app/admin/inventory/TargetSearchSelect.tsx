"use client";

import { useMemo, useState } from "react";

type Showroom = { id: string; name: string; city: string };
type Rep = { id: string; name: string | null; phone: string; showroomId: string | null };

export default function TargetSearchSelect({
  showroomList,
  repList,
  showroomNameById,
}: {
  showroomList: Showroom[];
  repList: Rep[];
  showroomNameById: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ value: string; label: string } | null>(null);
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const showroomMatches = showroomList
      .filter((s) => s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q))
      .map((s) => ({ value: `showroom:${s.id}`, label: `🏢 ${s.name} — ${s.city}` }));
    const repMatches = repList
      .filter((r) => (r.name ?? "").toLowerCase().includes(q) || r.phone.includes(q))
      .map((r) => ({
        value: `rep:${r.id}:${r.showroomId}`,
        label: `🧑‍💼 ${r.name ?? r.phone} — ${showroomNameById[r.showroomId ?? ""] ?? ""}`,
      }));
    return [...showroomMatches, ...repMatches].slice(0, 15);
  }, [query, showroomList, repList, showroomNameById]);

  return (
    <div className="relative">
      <label className="mb-1 block text-sm text-slate-600">هتتسجل باسم مين؟</label>
      <input
        value={selected ? selected.label : query}
        onChange={(e) => {
          setSelected(null);
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="اكتب اسم المعرض أو المندوب..."
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <input type="hidden" name="target" value={selected?.value ?? ""} required />
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => {
                setSelected(r);
                setQuery("");
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-right text-sm hover:bg-slate-50"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
