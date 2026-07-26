import Link from "next/link";

export default function LegalFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 pt-6 text-center text-xs text-slate-400">
      <nav className="mb-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        <Link href="/terms" className="hover:text-slate-600 hover:underline">
          الشروط والأحكام
        </Link>
        <Link href="/refund-policy" className="hover:text-slate-600 hover:underline">
          سياسة الاسترجاع
        </Link>
        <Link href="/privacy" className="hover:text-slate-600 hover:underline">
          سياسة الخصوصية
        </Link>
      </nav>
      <p>SayaraHub V1.0 — Smart Intermediation فقط، لا تسعير، لا تفاوض، لا دفع داخل المنصة على صفقات السيارات.</p>
    </footer>
  );
}
