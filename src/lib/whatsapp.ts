import { db } from "@/db";
import { chatLog, messageQueue } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export type Button = { id: string; title: string };

export type EnqueueInput = {
  toPhone: string;
  toUserId?: string | null;
  messageType?: "service_reply" | "utility" | "daily_ping";
  templateName?: string | null;
  templateParams?: Record<string, unknown> | null;
  body: string;
  buttons?: Button[];
  isFree?: boolean;
};

/** Queues an outbound WhatsApp message (PRD message_queue table). */
export async function enqueueMessage(input: EnqueueInput) {
  const [row] = await db
    .insert(messageQueue)
    .values({
      toPhone: input.toPhone,
      toUserId: input.toUserId ?? null,
      messageType: input.messageType ?? "service_reply",
      templateName: input.templateName ?? null,
      templateParams: input.templateParams ?? null,
      body: input.body,
      buttons: input.buttons ?? null,
      isFree: input.isFree ?? true,
      status: "pending",
    })
    .returning();
  return row;
}

/** Attempts a real WhatsApp Cloud API send when credentials are configured.
 * Returns true if a real network call was attempted successfully, false if
 * simulated (no credentials) — either way the caller marks the queue row as sent
 * so the in-app simulator / admin console keep working without live credentials. */
async function trySendViaCloudApi(toPhone: string, body: string, buttons?: Button[] | null) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return false;

  try {
    const payload = buttons?.length
      ? {
          messaging_product: "whatsapp",
          to: toPhone,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: body },
            action: {
              buttons: buttons.slice(0, 3).map((b) => ({
                type: "reply",
                reply: { id: b.id, title: b.title.slice(0, 20) },
              })),
            },
          },
        }
      : {
          messaging_product: "whatsapp",
          to: toPhone,
          type: "text",
          text: { body },
        };

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Processes N pending queue rows: sends (or simulates) and writes to chat_log
 * so the admin "queue" view and the bot simulator can render the conversation. */
export async function processQueue(limit = 20) {
  const pending = await db
    .select()
    .from(messageQueue)
    .where(inArray(messageQueue.status, ["pending", "retry"]))
    .orderBy(messageQueue.createdAt)
    .limit(limit);

  let sent = 0;
  for (const row of pending) {
    await db.update(messageQueue).set({ status: "sending" }).where(eq(messageQueue.id, row.id));

    await trySendViaCloudApi(
      row.toPhone,
      row.body ?? "",
      (row.buttons as Button[] | null) ?? undefined,
    );

    await db
      .update(messageQueue)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(messageQueue.id, row.id));

    await db.insert(chatLog).values({
      phone: row.toPhone,
      direction: "out",
      body: row.body ?? "",
      buttons: row.buttons ?? null,
    });
    sent += 1;
  }
  return { processed: sent };
}

export async function logInbound(phone: string, body: string) {
  await db.insert(chatLog).values({ phone, direction: "in", body });
}
