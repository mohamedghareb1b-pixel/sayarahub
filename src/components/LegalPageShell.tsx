import Link from "next/link";
import type { ReactNode } from "react";

export default function LegalPageShell({ title, updatedAt, children }: { title: string; updatedAt: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-emerald-700 hover:underline">
          ← الرئيسية
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-400">آخر تحديث: {updatedAt}</p>
        <article className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_p]:mt-3 [&_p]:text-slate-700 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pr-6 [&_li]:mt-1 [&_li]:text-slate-700">
          {children}
        </article>
      </div>
    </main>
  );
}
