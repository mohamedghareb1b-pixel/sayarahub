import { db } from "@/db";
import { vocabularyTerms } from "@/db/schema";
import { desc } from "drizzle-orm";
import { addVocabularyTerm, deleteVocabularyTerm, bulkAddVocabularyTerms } from "./actions";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  trim: "فئة/درجة",
  color: "لون",
  feature: "ملاحظة إضافية",
  model_alias: "موديل",
};

const CATEGORY_COLOR: Record<string, string> = {
  trim: "bg-sky-100 text-sky-700",
  color: "bg-purple-100 text-purple-700",
  feature: "bg-amber-100 text-amber-700",
  model_alias: "bg-emerald-100 text-emerald-700",
};

export default async function VocabularyPage() {
  const rows = await db.select().from(vocabularyTerms).orderBy(desc(vocabularyTerms.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">مفردات البوت</h1>
        <p className="mt-1 text-slate-600">
          علّم البوت كلمات وصيغ جديدة (أسماء موديلات بديلة، فئات، ألوان، ملاحظات) بدون تعديل الكود.
          التغييرات بتنعكس خلال دقيقة تقريباً.
        </p>
      </div>

      {/* إضافة موديل لماركة موجودة بالفعل */}
      <form action={addVocabularyTerm} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <input type="hidden" name="category" value="model_alias" />
        <h2 className="font-semibold text-slate-900">🚗 إضافة موديل</h2>
        <p className="text-xs text-slate-500">
          لموديل جديد لماركة عندنا بالفعل، أو صياغة/اختصار بديل لموديل موجود (زي &quot;راف4&quot;).
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-600">النص اللي المستخدم بيكتبه</label>
            <input name="term" placeholder="مثال: راف4" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">الماركة</label>
            <input name="brand" placeholder="تويوتا" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">اسم الموديل الرسمي</label>
            <input name="model" placeholder="راف فور" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">القيمة الرسمية (نفس اسم الموديل)</label>
            <input name="canonicalValue" placeholder="راف فور" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          إضافة الموديل
        </button>
      </form>

      {/* إضافة ماركة جديدة تماماً (مع أول موديل ليها) */}
      <form action={addVocabularyTerm} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <input type="hidden" name="category" value="model_alias" />
        <h2 className="font-semibold text-slate-900">🏷️ إضافة ماركة جديدة</h2>
        <p className="text-xs text-slate-500">
          ماركة مش موجودة عندنا خالص (زي بيجو، MG، إلخ). اكتب أول موديل ليها، وتقدر تضيف باقي موديلاتها بعدين من خانة
          &quot;إضافة موديل&quot; فوق.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-600">اسم الماركة الجديدة</label>
            <input name="brand" placeholder="بيجو" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">النص اللي المستخدم بيكتبه للموديل</label>
            <input name="term" placeholder="مثال: 3008" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">اسم الموديل الرسمي</label>
            <input name="model" placeholder="3008" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">القيمة الرسمية (نفس اسم الموديل)</label>
            <input name="canonicalValue" placeholder="3008" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          إضافة الماركة والموديل
        </button>
      </form>

      {/* إضافة فئة */}
      <form action={addVocabularyTerm} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <input type="hidden" name="category" value="trim" />
        <h2 className="font-semibold text-slate-900">⚙️ إضافة فئة</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-600">النص اللي المستخدم بيكتبه</label>
            <input name="term" placeholder="مثال: كمفرت" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">القيمة الرسمية</label>
            <input name="canonicalValue" placeholder="مثال: كمفورت" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          إضافة الفئة
        </button>
      </form>

      {/* إضافة لون */}
      <form action={addVocabularyTerm} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <input type="hidden" name="category" value="color" />
        <h2 className="font-semibold text-slate-900">🎨 إضافة لون</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-600">النص اللي المستخدم بيكتبه</label>
            <input name="term" placeholder="مثال: لولوي" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">القيمة الرسمية</label>
            <input name="canonicalValue" placeholder="مثال: جملي" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          إضافة اللون
        </button>
      </form>

      {/* إضافة ملاحظة */}
      <form action={addVocabularyTerm} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <input type="hidden" name="category" value="feature" />
        <h2 className="font-semibold text-slate-900">📝 إضافة ملاحظة</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-600">النص اللي المستخدم بيكتبه</label>
            <input name="term" placeholder="مثال: سقف اسود" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">القيمة الرسمية</label>
            <input name="canonicalValue" placeholder="مثال: سقف اسود" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          إضافة الملاحظة
        </button>
      </form>

      {/* إضافة بالجملة (لصق عدة مصطلحات دفعة واحدة) */}
      <form action={bulkAddVocabularyTerms} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold text-slate-900">إضافة بالجملة (Bulk Add)</h2>
        <p className="text-xs text-slate-500">
          سطر لكل مصطلح، بالصيغة: <code dir="ltr" className="rounded bg-slate-100 px-1">النوع,النص المكتوب,القيمة الرسمية[,الماركة,الموديل]</code>
          <br />
          النوع يكون واحد من: trim / color / feature / model_alias (النوع اللي اسمه في الواجهة &quot;موديل&quot;)
        </p>
        <textarea
          name="bulkText"
          rows={6}
          required
          placeholder={`trim,كمفرت,كمفورت\ncolor,لولوي,جملي\nfeature,سقف اسود,سقف اسود\nmodel_alias,راف4,راف فور,تويوتا,راف فور`}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
          dir="ltr"
        />
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          إضافة الكل
        </button>
      </form>

      {/* الجدول */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-slate-500">
            <tr>
              <th className="px-4 py-3">النوع</th>
              <th className="px-4 py-3">النص المكتوب</th>
              <th className="px-4 py-3">القيمة الرسمية</th>
              <th className="px-4 py-3">الماركة/الموديل</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${CATEGORY_COLOR[r.category]}`}>
                    {CATEGORY_LABEL[r.category] ?? r.category}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">{r.term}</td>
                <td className="px-4 py-3 text-slate-600">{r.canonicalValue}</td>
                <td className="px-4 py-3 text-slate-500">
                  {r.brand || r.model ? `${r.brand ?? ""} ${r.model ?? ""}`.trim() : "—"}
                </td>
                <td className="px-4 py-3">
                  <form action={deleteVocabularyTerm.bind(null, r.id)}>
                    <button type="submit" className="text-xs font-semibold text-rose-600 hover:underline">
                      حذف
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  لا توجد مصطلحات مضافة بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
