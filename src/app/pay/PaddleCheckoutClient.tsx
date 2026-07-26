"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Script from "next/script";

// هذه هي صفحة "رابط الدفع الافتراضي" (Default Payment Link) اللي المفروض
// تتسجل في Paddle > Checkout > Checkout settings وتتعتمد كـ domain. أي رابط
// checkout.url بنولّده من الـAPI بيبقى شكله: <هذا الدومين>/pay?_ptxn=txn_...
// وPaddle.js هنا هو اللي فعلياً بيفتح صفحة الدفع لما يلاقي الـ_ptxn.

declare global {
  interface Window {
    Paddle?: {
      Initialize: (opts: { token: string }) => void;
      Checkout: { open: (opts: { transactionId: string }) => void };
    };
  }
}

export default function PaddleCheckoutClient() {
  const searchParams = useSearchParams();
  const txnId = searchParams.get("_ptxn");
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scriptReady) return;
    const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!clientToken) {
      setError("الصفحة مش مظبوطة لسه (NEXT_PUBLIC_PADDLE_CLIENT_TOKEN مفقود).");
      return;
    }
    if (!txnId) {
      setError("رابط دفع ناقص — مفيش معاملة محددة.");
      return;
    }
    if (!window.Paddle) return;
    window.Paddle.Initialize({ token: clientToken });
    window.Paddle.Checkout.open({ transactionId: txnId });
  }, [scriptReady, txnId]);

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
      <Script src="https://cdn.paddle.com/paddle/v2/paddle.js" onLoad={() => setScriptReady(true)} />
      {error ? (
        <p className="text-rose-600">{error}</p>
      ) : (
        <p className="text-slate-500">جاري فتح صفحة الدفع الآمنة من Paddle...</p>
      )}
    </div>
  );
}
