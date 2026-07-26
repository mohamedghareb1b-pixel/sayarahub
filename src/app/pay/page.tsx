import { Suspense } from "react";
import PaddleCheckoutClient from "./PaddleCheckoutClient";

export const dynamic = "force-dynamic";

export default function PayPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">جاري التحميل...</div>}>
      <PaddleCheckoutClient />
    </Suspense>
  );
}
