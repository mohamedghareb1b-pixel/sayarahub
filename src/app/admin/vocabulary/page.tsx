import { db } from "@/db";
import { vocabularyTerms } from "@/db/schema";
import { desc } from "drizzle-orm";
import { addVocabularyTerm, deleteVocabularyTerm, bulkAddVocabularyTerms } from "./actions";
import VocabularyTable from "./VocabularyTable";

export const dynamic = "force-dynamic";

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
            <label className="mb-1 block text-sm text-slate-600">النص بالعربي</label>
            <input name="term_ar" placeholder="مثال: راف فور" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">النص بالإنجليزي (اختياري)</label>
            <input name="term_en" placeholder="مثال: RAV4" dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">الماركة</label>
            <input name="brand" placeholder="تويوتا" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">القيمة الرسمية للموديل</label>
            <input name="canonicalValue" placeholder="راف فور" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          إضافة الموديل
        </button>
      </form>

      {/* إضافة ماركة (مستقلة، من غير حاجة لموديل) */}
      <form action={addVocabularyTerm} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <input type="hidden" name="category" value="brand_alias" />
        <h2 className="font-semibold text-slate-900">🏷️ إضافة ماركة</h2>
        <p className="text-xs text-slate-500">
          تسجيل اسم ماركة (عربي/إنجليزي) لوحده، من غير ما تحتاج تحدد موديل معين. مفيد لو عايز النظام يتعرف على
          الماركة نفسها حتى لو الموديل مش مسجل عندنا.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-600">اسم الماركة بالعربي</label>
            <input name="term_ar" placeholder="مثال: ام جي" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">اسم الماركة بالإنجليزي (اختياري)</label>
            <input name="term_en" placeholder="مثال: MG" dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-slate-600">القيمة الرسمية للماركة</label>
            <input name="canonicalValue" placeholder="ام جي" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          إضافة الماركة
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

      {/* إضافة كلمة ممنوعة (متتسجلش في الملاحظات خالص حتى لو معرفناهاش) */}
      <form action={addVocabularyTerm} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <input type="hidden" name="category" value="stopword" />
        <h2 className="font-semibold text-slate-900">🚫 كلمة ممنوعة (Stopword)</h2>
        <p className="text-xs text-slate-500">
          كلمات زي &quot;اللون&quot; أو &quot;موديل&quot; بيكتبها الناس أحياناً بدون فايدة حقيقية — أضفها هنا عشان متظهرش في الملاحظات أبداً.
        </p>
        <div className="flex gap-3">
          <input
            name="term"
            placeholder="مثال: اللون"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
          {/* القيمة الرسمية مش لها معنى هنا، بس محتاجينها تقنياً — بنملاها تلقائي بنفس الكلمة */}
          <input type="hidden" name="canonicalValue" value="-" />
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            إضافة كممنوعة
          </button>
        </div>
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

      {/* الجدول (بحث + أقسام) */}
      <VocabularyTable rows={rows} onDelete={deleteVocabularyTerm} />
    </div>
  );
}
