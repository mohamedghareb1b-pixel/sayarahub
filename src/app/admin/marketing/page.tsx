import MarketingRequestForm from "./MarketingRequestForm";

export const dynamic = "force-dynamic";

export default function MarketingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">🎯 رسالة تسويقية</h1>
        <p className="mt-1 text-slate-600">
          نص عادي ونص أوتوماتيك: بتدخل رقم المندوب الطالب وتفاصيل السيارة بس، ومحرك المطابقة بيدوّر تلقائي على أي
          مخزون متاح مطابق ويبعت له رسالة البث.
        </p>
      </div>
      <MarketingRequestForm />
      <p className="text-sm text-slate-500">
        تقدر تتابع حالة كل رسالة تسويقية بعتها (بانتظار رد، تم التأكيد، رُفضت...) من صفحة{" "}
        <a href="/admin/matches" className="font-medium text-emerald-700 hover:underline">
          المطابقات
        </a>
        .
      </p>
    </div>
  );
}
