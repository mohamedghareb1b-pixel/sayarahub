import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-cairo" });

export const metadata: Metadata = {
  title: "سيارة هب | SayaraHub",
  description: "منصة توصيل ذكية بين معارض السيارات عبر واتساب — بدون تسعير، بدون عمولة.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body className="bg-slate-100 text-slate-900 antialiased font-[var(--font-cairo)]">
        {children}
      </body>
    </html>
  );
}
