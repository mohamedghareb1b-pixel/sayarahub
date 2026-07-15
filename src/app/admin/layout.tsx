import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/admin", label: "لوحة التحكم" },
  { href: "/admin/raw-imports", label: "الرسائل الخام" },
  { href: "/admin/showrooms", label: "المعارض" },
  { href: "/admin/inventory", label: "المخزون" },
  { href: "/admin/requests", label: "الطلبات" },
  { href: "/admin/matches", label: "المطابقات" },
  { href: "/admin/queue", label: "طابور الرسائل" },
  { href: "/admin/jobs", label: "المهام المجدولة" },
  { href: "/admin/vocabulary", label: "مفردات البوت" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-bold text-emerald-700">
            🚗 SayaraHub <span className="text-slate-400 font-normal text-sm">/ لوحة الإدارة</span>
          </Link>
          <Link href="/simulator" className="text-sm font-medium text-emerald-700 hover:underline">
            محاكي واتساب ↗
          </Link>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6 pb-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
