import { handleIncomingMessage } from "@/lib/botEngine";

export const dynamic = "force-dynamic";

// Meta WhatsApp Cloud API webhook verification handshake.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type MetaWebhookBody = {
  entry?: {
    changes?: {
      value?: {
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: {
          from: string;
          type: string;
          text?: { body?: string };
          interactive?: {
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string };
          };
          button?: { text?: string; payload?: string };
        }[];
      };
    }[];
  }[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as MetaWebhookBody;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const messages = value?.messages ?? [];
        for (const msg of messages) {
          const contact = value?.contacts?.find((c) => c.wa_id === msg.from);
          const name = contact?.profile?.name;

          if (msg.type === "text" && msg.text?.body) {
            await handleIncomingMessage({ phone: msg.from, name, text: msg.text.body });
          } else if (msg.type === "interactive" && msg.interactive?.button_reply) {
            await handleIncomingMessage({
              phone: msg.from,
              name,
              buttonId: msg.interactive.button_reply.id,
            });
          } else if (msg.type === "button" && msg.button?.payload) {
            await handleIncomingMessage({ phone: msg.from, name, buttonId: msg.button.payload });
          }
        }
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("whatsapp webhook error", err);
    return Response.json({ ok: false }, { status: 200 });
  }
}
