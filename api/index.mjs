/* Vercel entry. One (req, res) handler serves everything, so this file only
   adapts it to the platform's rules:

   1. an instance is reused for the promise's lifetime, not the response's — so
      a generation that started here keeps running after the POST has answered,
      as long as we do not resolve;
   2. once we do resolve, the instance may freeze instantly, so pending writes
      to Redis go out first. That flush also runs before the response leaves,
      which is what keeps a note, an answer or a lesson from dying with the
      instance. */

import { handler, drainJobs } from "../app/server.mjs";
import { flushNow } from "../app/store.mjs";

const FLUSH_MS = 8000;
const HOLD_MS = Number(process.env.JOB_HOLD_MS || 280_000);

export default async function vercel(req, res) {
  let release;
  const settled = new Promise((resolve) => (release = resolve));
  const end = res.end.bind(res);
  let closing = false;

  res.end = (chunk, encoding, callback) => {
    if (closing) return end(chunk, encoding, callback);
    closing = true;
    flushNow()
      .catch(() => {})
      .finally(() => {
        end(chunk, encoding, callback);
        release();
      });
    return res;
  };

  await handler(req, res);
  await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, FLUSH_MS))]);

  /* Keep the instance alive while this request's generation is still writing. */
  await drainJobs(HOLD_MS);
}

/* A blueprint takes 15–40s and a lesson 30–60s. Fluid compute allows 300s on
   every plan, which leaves room for one generation per request even when the
   provider is slow. */
export const config = { maxDuration: 300 };
