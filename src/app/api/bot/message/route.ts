import { handleIncomingMessage } from "@/lib/botEngine";
import { processQueue } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/** Used by the in-browser WhatsApp simulator (/simulator). Mirrors exactly
 * what the real Meta webhook does, minus the Meta JSON envelope. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    phone: string;
    name?: string;
    text?: string;
    buttonId?: string;
  };

  if (!body.phone) {
    return Response.json({ ok: false, error: "phone required" }, { status: 400 });
  }

  await handleIncomingMessage({
    phone: body.phone,
    name: body.name,
    text: body.text,
    buttonId: body.buttonId,
  });

  // Immediately flush the outbound queue so the simulator feels real-time.
  await processQueue(50);

  return Response.json({ ok: true });
}
