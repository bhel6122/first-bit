/* One tiny Redis REST client. No dependency: Upstash (and the Vercel KV
   integration, which is Upstash underneath) speaks plain HTTP with a bearer
   token, so `fetch` is the whole client.

   Absent env vars → `kvReady` stays false and everything falls back to the
   single JSON file. That keeps `npm start` on a laptop exactly as before. */

const BASE = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

export const kvReady = Boolean(BASE && TOKEN);
export const kvPrefix = process.env.KV_PREFIX || "first-bit";

async function call(path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "text/plain; charset=utf-8",
    },
    body,
  });
  if (!res.ok) throw new Error(`kv ${path.split("/")[0]} http ${res.status}`);
  const data = await res.json();
  return data?.result ?? null;
}

export const kvGet = (key) => call(`get/${encodeURIComponent(key)}`);

/** `ttl` in seconds; omit for a value that stays until overwritten. */
export function kvSet(key, value, ttl) {
  const path = ttl ? `setex/${encodeURIComponent(key)}/${Math.max(1, Math.round(ttl))}` : `set/${encodeURIComponent(key)}`;
  return call(path, value);
}
