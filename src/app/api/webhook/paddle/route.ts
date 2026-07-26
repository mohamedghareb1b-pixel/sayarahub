import { db } from "@/db";
import { showrooms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyPaddleWebhookSignature } from "@/lib/paddle";

export const dynamic = "force-dynamic";

type PaddleWebhookBody = {
  event_type?: string;
  data?: {
    id?: string;
    customer_id?: string;
    status?: string;
    custom_data?: { showroom_id?: string } | null;
    current_billing_period?: { ends_at?: string };
    // transaction.completed events بيبقى فيهم subscription_id لو الـtransaction
    // ده جزء من اشتراك، أو details.line_items لو transaction لوحده.
    subscription_id?: string;
  };
};

export async function POST(req: Request) {
  // لازم نقرأ الـbody كنص خام أول قبل أي parsing عشان التحقق من التوقيع
  // (HMAC) بيتم على النص الخام بالظبط زي ما وصل، مش على نسخة معاد تكوينها.
  const rawBody = await req.text();
  const signature = req.headers.get("paddle-signature");

  if (!verifyPaddleWebhookSignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: PaddleWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const eventType = body.event_type;
  const showroomId = body.data?.custom_data?.showroom_id;

  try {
    if (eventType === "subscription.created" || eventType === "subscription.activated" || eventType === "subscription.updated") {
      if (showroomId && body.data?.status === "active") {
        const expiresAt = body.data.current_billing_period?.ends_at
          ? new Date(body.data.current_billing_period.ends_at)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await db
          .update(showrooms)
          .set({
            subscriptionPlan: "pro",
            subscriptionExpiresAt: expiresAt,
            maxConfirmedMatches: 999999,
            paddleCustomerId: body.data.customer_id ?? undefined,
            paddleSubscriptionId: body.data.id ?? undefined,
          })
          .where(eq(showrooms.id, showroomId));
      }
    } else if (eventType === "subscription.canceled" || eventType === "subscription.paused") {
      if (showroomId) {
        await db
          .update(showrooms)
          .set({ subscriptionPlan: "free" })
          .where(eq(showrooms.id, showroomId));
      }
    }
    // event_type التاني (transaction.completed, transaction.payment_failed...)
    // مش لازمين ليه حاجة دلوقتي — الاعتماد الأساسي على أحداث subscription.*
    // لأنها اللي فيها حالة الاشتراك النهائية.
  } catch (err) {
    console.error("Paddle webhook processing error:", err);
    // نرجع 200 برضه عشان Paddle مايعيدش يبعت نفس الحدث تكرار — الخطأ بيتسجل
    // في اللوج بس عشان نراجعه، مش هيسبب retry storm.
  }

  return new Response("ok", { status: 200 });
}
