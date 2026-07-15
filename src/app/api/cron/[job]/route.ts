import { processQueue } from "@/lib/whatsapp";
import { processPendingRawImports } from "@/lib/aiProcessor";
import { runAllExpiryJobs, resetDailyPresence, sendDailyPing } from "@/lib/expiryJobs";

export const dynamic = "force-dynamic";

// Since there is no pg_cron / external scheduler wired into this sandbox,
// each of these mirrors one Supabase Edge Function from the PRD (section 8)
// and can be triggered manually from /admin/jobs or wired to an external
// cron service (e.g. GitHub Actions, cron-job.org) hitting this URL.
export async function POST(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const { job } = await ctx.params;

  switch (job) {
    case "queue-processor": {
      const result = await processQueue(50);
      return Response.json({ ok: true, job, result });
    }
    case "ai-processor": {
      const result = await processPendingRawImports(50);
      return Response.json({ ok: true, job, result });
    }
    case "expiry-jobs": {
      const result = await runAllExpiryJobs();
      return Response.json({ ok: true, job, result });
    }
    case "daily-ping": {
      const sent = await sendDailyPing();
      return Response.json({ ok: true, job, result: { sent } });
    }
    case "reset-presence": {
      await resetDailyPresence();
      return Response.json({ ok: true, job });
    }
    case "run-all": {
      const ai = await processPendingRawImports(50);
      const expiry = await runAllExpiryJobs();
      const queue = await processQueue(50);
      return Response.json({ ok: true, job, result: { ai, expiry, queue } });
    }
    default:
      return Response.json({ ok: false, error: "unknown job" }, { status: 404 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  return POST(req, ctx);
}
