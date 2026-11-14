/* Passwords and sessions, using nothing but `node:crypto`.

   Two decisions worth naming.

   Sessions are stateless: the cookie carries `uid | ver | expiry` and an
   HMAC-SHA256 signature over it. A serverless host freezes instances and
   spreads requests across them, so anything kept in server memory is lost
   within minutes — a signature is the one form of session that survives that
   without a round trip to Redis on every request.

   The cost is that a session cannot be revoked individually. `ver` in the
   cookie is the escape hatch: it is stored on the user record, compared on
   every request, and bumped whenever the password changes, which invalidates
   every cookie issued before it. Rotating SESSION_SECRET signs everyone out. */

import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

export const COOKIE = "fb_session";
const DAY = 86400_000;

/* 30 days: long enough that a learner does not re-type a password every week,
   short enough that a stolen laptop stops being a session eventually. */
export const SESSION_MS = 30 * DAY;

const SECRET = (() => {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (process.env.VERCEL) {
    /* Deployed without a secret: every instance would otherwise invent its own
       and log everybody out at random. Loud, but it keeps the site usable. */
    console.warn("[auth ] SESSION_SECRET missing — set it, or sessions die on redeploy");
  }
  return "dev-only-secret-do-not-deploy";
})();

/* -------------------------------- passwords ------------------------------- */

const KEYLEN = 32;
const N = 16384;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(String(password), salt, KEYLEN, { N });
  return { salt, hash: key.toString("hex") };
}

export async function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const key = await scrypt(String(password), salt, KEYLEN, { N });
  const a = Buffer.from(key.toString("hex"), "hex");
  const b = Buffer.from(String(hash), "hex");
  /* Different lengths make timingSafeEqual throw, so compare only when equal. */
  return a.length === b.length && timingSafeEqual(a, b);
}

/* --------------------------------- session -------------------------------- */

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (body) => createHmac("sha256", SECRET).update(body).digest("base64url");

export function issueSession({ uid, ver }) {
  const body = b64(JSON.stringify({ u: uid, v: Number(ver) || 1, e: Date.now() + SESSION_MS }));
  return `${body}.${sign(body)}`;
}

export function readSession(token) {
  if (!token || typeof token !== "string") return null;
  const at = token.lastIndexOf(".");
  if (at < 1) return null;
  const body = token.slice(0, at);
  const given = Buffer.from(token.slice(at + 1));
  const want = Buffer.from(sign(body));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p?.u || Date.now() > Number(p.e)) return null;
    return { uid: String(p.u), ver: Number(p.v) || 1, exp: Number(p.e) };
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

export const sessionCookie = (value, maxAgeMs = SESSION_MS) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`
  + (process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "");

export const clearCookie = () =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  + (process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "");
