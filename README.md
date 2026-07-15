# SayaraHub — منصة مطابقة السيارات بين المعارض (B2B عبر واتساب)

مشروع Next.js + Postgres (Drizzle ORM) بيستقبل طلبات/عروض سيارات من معارض عن طريق
واتساب، يحللها بالذكاء الاصطناعي (Gemini) أو بمحرك قواعد بديل، ويطابق بين الطلب والعرض.

---

## 1) المتطلبات قبل التشغيل

- Node.js 20 أو أحدث
- قاعدة بيانات Postgres (محلية أو Supabase)
- حساب Meta Developer لتفعيل WhatsApp Cloud API
- (اختياري) مفتاح Gemini API للتحليل بالذكاء الاصطناعي

---

## 2) خطوات التشغيل المحلي

```bash
# 1. تثبيت الحزم
npm install

# 2. انسخ ملف البيئة واملأ القيم
cp .env.example .env

# 3. ولّد جداول قاعدة البيانات من الـ schema
npx drizzle-kit push

# 4. شغّل المشروع
npm run dev
```

المشروع هيشتغل على http://localhost:3000
- `/admin` لوحة التحكم
- `/simulator` محاكي محادثة واتساب (يشتغل من غير أي إعداد خارجي)

---

## 3) إزاي تجهز Supabase (بديل تشغيل Postgres محلي)

Supabase هو الأسهل لأنه بيدّيك قاعدة Postgres مُدارة مجاناً + رابط اتصال جاهز.

1. روح على https://supabase.com وسجل حساب، وأنشئ **New Project**.
2. اختار باسورد لقاعدة البيانات واحفظه.
3. من القائمة الجانبية: **Project Settings → Database → Connection string**.
4. اختار تبويب **URI**، وانسخ الرابط. هيكون شكله كده:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
   ```
5. لو هتستضيف المشروع على منصة serverless (Vercel مثلاً) استخدم بدل كده
   **Connection pooling** (Transaction mode) عشان تتجنب مشاكل عدد الاتصالات.
6. حط الرابط في `.env` تحت `DATABASE_URL`.
7. شغّل `npx drizzle-kit push` عشان ينشئ الجداول من `src/db/schema.ts` مباشرة على Supabase.

> ملاحظة: المشروع مش مستخدم أي مكتبة Supabase SDK، هو بيتعامل معاها كـ Postgres عادي
> عن طريق `pg` + `drizzle-orm`، فمفيش أي كود إضافي لازم غير رابط الاتصال.

---

## 4) إزاي تجهز Meta / WhatsApp Cloud API

1. روح https://developers.facebook.com/apps وسجل دخول بحساب فيسبوك.
2. **Create App → نوع "Business"**.
3. من صفحة الـ App، ضيف منتج **WhatsApp**.
4. هتلاقي تحت **API Setup**:
   - **Temporary access token** (صالح 24 ساعة، كويس للتجربة).
   - **Phone number ID** — ده اللي تحطه في `WHATSAPP_PHONE_ID`.
5. عشان تاخد **Permanent token** (للإنتاج):
   - روح **Business Settings → Users → System Users** → أنشئ System User.
   - اديله صلاحية على الـ App بصلاحية `whatsapp_business_messaging`.
   - ولّد Token دائم من هناك واحفظه في `WHATSAPP_ACCESS_TOKEN`.
6. اضبط الـ **Webhook**:
   - في نفس صفحة WhatsApp → **Configuration → Webhook → Edit**.
   - **Callback URL**: `https://YOUR-DOMAIN.com/api/webhook/whatsapp`
     (لازم يكون HTTPS، فلو بتجرب محلي استخدم أداة زي `ngrok` أو `cloudflared tunnel`
     عشان تاخد رابط عام مؤقت بيوجه لـ localhost بتاعك).
   - **Verify Token**: اكتب أي نص عشوائي أنت اخترعته، وحطه بنفس القيمة في
     `.env` تحت `WHATSAPP_VERIFY_TOKEN`.
   - اضغط **Verify and Save** — لو ظبط صح هيتحقق تلقائي عن طريق GET request
     بيرجع منه الكود في `src/app/api/webhook/whatsapp/route.ts`.
   - بعد التفعيل، اشترك (Subscribe) في حقل `messages` عشان يوصلك أي رسالة واردة.
7. لو عايز ترسل لأرقام حقيقية غير رقم التست الافتراضي، لازم تضيف الرقم في
   **WhatsApp → API Setup → To** أثناء وضع التطوير (Development mode)،
   أو تعمل **App Review** عشان تطلع للإنتاج (Live mode) وترسل لأي حد.

> المشروع مصمم إنه لو `WHATSAPP_ACCESS_TOKEN` و`WHATSAPP_PHONE_ID` فاضيين،
> الرسائل هتتسجل في قاعدة البيانات كأنها اترسلت (محاكاة) من غير إرسال فعلي،
> عشان تقدر تجرب كل حاجة من `/simulator` من غير أي إعداد خارجي.

---

## 5) إزاي تجهز Gemini (اختياري، لتحليل الرسائل بالذكاء الاصطناعي)

1. روح https://aistudio.google.com/app/apikey
2. اعمل **Create API key** (محتاج حساب Google عادي).
3. حط المفتاح في `.env` تحت `GEMINI_API_KEY`.

لو سبته فاضي، الكود بيرجع تلقائي لمحرك تحليل بديل بقواعد ثابتة (`ruleBasedParse`
في `src/lib/parser.ts`) وهيفضل يشتغل، بس أقل دقة في استخراج بيانات السيارة.

---

## 6) الـ Cron Jobs (المهام المجدولة)

الجداول دي لازم تتشغل بشكل دوري:

| Endpoint | الوظيفة |
|---|---|
| `POST /api/cron/queue-processor` | إرسال الرسائل اللي في الطابور |
| `POST /api/cron/ai-processor` | تحليل الرسائل الخام الجديدة |
| `POST /api/cron/expiry-jobs` | إنهاء الطلبات/العروض المنتهية |
| `POST /api/cron/daily-ping` | رسالة تفقد يومية |
| `POST /api/cron/reset-presence` | إعادة تعيين حالة الحضور اليومي |
| `POST /api/cron/run-all` | يشغل كل اللي فوق مرة واحدة |

⚠️ **دلوقتي مفيش أي حماية على الـ routes دي** — أي حد عنده الرابط يقدر يشغلها.
لازم تضيف تحقق من `CRON_SECRET` (موجود شرحه تحت في "التوصيات الأمنية").

تقدر تجدولها مجاناً عن طريق:
- **cron-job.org** (مجاني وبسيط، بس دايماً حط secret في الـ header)
- **GitHub Actions** (scheduled workflow بيعمل `curl`)
- **Vercel Cron** لو مستضيف المشروع على Vercel (`vercel.json` → `crons`)

---

## 7) الاستضافة (Deployment)

أسهل طريقة: **Vercel** (بيدعم Next.js من غير إعداد إضافي).

1. ادفع الكود على GitHub.
2. من Vercel: **New Project → Import** من الـ repo.
3. في **Environment Variables** ضيف كل المتغيرات اللي في `.env.example`.
4. بعد أول Deploy، خد رابط المشروع (`https://your-app.vercel.app`) وحطه كـ
   Callback URL في إعدادات Meta Webhook (خطوة 4 فوق).

---

## 8) نواقص وتوصيات أمنية مهمة (لازم تتعالج قبل الإنتاج)

- 🔴 **`/admin` من غير أي تسجيل دخول** — أي حد عنده الرابط يشوف كل بيانات
  المعارض والطلبات ويتحكم فيها. لازم تتحمي بـ middleware (Basic Auth بسيط
  أو نظام تسجيل دخول حقيقي).
- 🔴 **`/api/cron/[job]` من غير أي مفتاح سري** — أي حد يقدر يستدعيها ويشغل
  المهام أو يستهلك الـ Gemini quota. لازم تتحقق من هيدر
  `Authorization: Bearer <CRON_SECRET>` قبل التنفيذ.
- 🟡 **Webhook واتساب من غير تحقق من التوقيع (`X-Hub-Signature-256`)** —
  حالياً بيتحقق بس من `hub.verify_token` في الـ GET (وده كافي فقط لأول ربط)،
  لكن POST requests (الرسائل الفعلية) مفيهاش تحقق إن الطلب فعلاً جاي من Meta.
- 🟢 مفيش lockfile (`package-lock.json`) — شغّل `npm install` مرة واحدة
  محلياً وارفعه مع المشروع عشان تثبيت نسخ متطابقة في كل بيئة.

---

## 9) بنية المشروع باختصار

```
src/
  app/
    admin/          لوحة التحكم (بدون حماية حالياً)
    api/
      bot/           استقبال رسائل من المحاكي
      cron/[job]/    المهام المجدولة
      webhook/whatsapp/  استقبال رسائل واتساب الحقيقية
    simulator/       محاكي محادثة واتساب للتجربة بدون حساب Meta
  db/
    schema.ts        تعريف جداول قاعدة البيانات (Drizzle)
    index.ts          اتصال قاعدة البيانات
  lib/
    parser.ts          تحليل النصوص (Gemini أو rule-based)
    matchingEngine.ts   منطق مطابقة الطلب بالعرض
    botEngine.ts         منطق محادثة البوت
    whatsapp.ts           إرسال/طابور رسائل واتساب
    expiryJobs.ts          مهام انتهاء الصلاحية
```
