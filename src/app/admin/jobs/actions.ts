"use server";

import { processQueue } from "@/lib/whatsapp";
import { processPendingRawImports } from "@/lib/aiProcessor";
import { runAllExpiryJobs, resetDailyPresence, sendDailyPing } from "@/lib/expiryJobs";

/** ينفذ نفس منطق /api/cron/[job] لكن مباشرة من السيرفر — عشان زرارات لوحة
 * الإدارة تفضل شغالة حتى بعد ما نحمي endpoint الـ cron العام بمفتاح سري
 * (CRON_SECRET) مخصص للخدمات الخارجية زي cron-job.org. */
export async function runJob(job: string) {
  switch (job) {
    case "queue-processor":
      return { ok: true, job, result: await processQueue(50) };
    case "ai-processor":
      return { ok: true, job, result: await processPendingRawImports(50) };
    case "expiry-jobs":
      return { ok: true, job, result: await runAllExpiryJobs() };
    case "daily-ping":
      return { ok: true, job, result: { sent: await sendDailyPing() } };
    case "reset-presence":
      await resetDailyPresence();
      return { ok: true, job };
    case "run-all": {
      const ai = await processPendingRawImports(50);
      const expiry = await runAllExpiryJobs();
      const queue = await processQueue(50);
      return { ok: true, job, result: { ai, expiry, queue } };
    }
    default:
      return { ok: false, error: "unknown job" };
  }
}
