"use client";

import { useState, useTransition } from "react";
import { sendSubscriptionLink } from "./actions";

export default function SendSubscriptionLinkButton({ showroomId }: { showroomId: string }) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const res = await sendSubscriptionLink(showroomId);
            setResult(res);
          });
        }}
        className="rounded-full border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
      >
        {isPending ? "بيتبعت..." : "💳 ابعت لينك دفع"}
      </button>
      {result && (
        <p className={`mt-1 max-w-[160px] text-[11px] ${result.ok ? "text-emerald-600" : "text-rose-600"}`}>{result.message}</p>
      )}
    </div>
  );
}
