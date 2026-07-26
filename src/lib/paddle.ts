import crypto from "crypto";

// كل الاستدعاءات هنا بتستخدم fetch مباشرة (زي whatsapp.ts بالظبط) من غير
// أي SDK إضافي — الحساب المفعّل هو Live فاستخدمنا api.paddle.com مباشرة.
// لو حبيت تجرب على Sandbox قبل الإنتاج، غيّر الـ base URL لـ
// https://sandbox-api.paddle.com واستخدم مفتاح Sandbox API منفصل.
const PADDLE_API_BASE = "https://api.paddle.com";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`متغير البيئة ${name} مش متظبط — راجع .env`);
  return value;
}

/** بينشئ "معاملة" (transaction) في Paddle مربوطة بمعرض معين عن طريق
 * custom_data، ويرجع رابط الدفع (checkout.url) الجاهز نبعته في واتساب.
 * لازم يكون فيه "رابط دفع افتراضي" (Default Payment Link) متظبط ومعتمد في
 * Paddle > Checkout > Checkout settings قبل ما ده يشتغل، لأن checkout.url
 * بيتبنى على أساسه. */
export async function createPaddleCheckout(showroomId: string, customerEmail?: string) {
  const apiKey = requireEnv("PADDLE_API_KEY");
  const priceId = requireEnv("PADDLE_PRICE_ID");

  const res = await fetch(`${PADDLE_API_BASE}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      customer: customerEmail ? { email: customerEmail } : undefined,
      custom_data: { showroom_id: showroomId },
      billing_details: { enable_checkout: true },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`فشل إنشاء معاملة Paddle: ${res.status} — ${errText}`);
  }

  const data = await res.json();
  const checkoutUrl: string | undefined = data?.data?.checkout?.url;
  if (!checkoutUrl) {
    throw new Error("Paddle ماردش برابط checkout.url — تأكد إن الـ Default Payment Link متظبط ومعتمد.");
  }
  return checkoutUrl;
}

/** بيتحقق إن طلب الـwebhook فعلاً جاي من Paddle (مش حد بيحاول يزوّر إشعار
 * دفع) عن طريق الـHMAC signature اللي بيبعتها Paddle في هيدر Paddle-Signature.
 * https://developer.paddle.com/webhooks/signature-verification */
export function verifyPaddleWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return false;

  // الهيدر شكله: "ts=1234567890;h1=abcdef..."
  const parts = Object.fromEntries(
    signatureHeader.split(";").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    }),
  );
  const ts = parts["ts"];
  const h1 = parts["h1"];
  if (!ts || !h1) return false;

  const signedPayload = `${ts}:${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(h1));
  } catch {
    // لو الطولين مختلفين، timingSafeEqual بترمي استثناء بدل ما ترجع false
    return false;
  }
}
