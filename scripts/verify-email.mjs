#!/usr/bin/env node
/**
 * Marks a Firebase account's email as verified, for addresses that cannot
 * receive the verification code (demo and test accounts on domains we do not
 * own). BILLING_EXEMPT_EMAILS and ADMIN_EMAILS only count for verified
 * addresses, so this is how such an account gets past the pay step.
 *
 *   node scripts/verify-email.mjs baker@admin.com
 *   node scripts/verify-email.mjs baker@admin.com path/to/service-account.json
 *
 * Without a path, the service account comes from FIREBASE_SERVICE_ACCOUNT_JSON
 * in the environment or in .env.local (the same value Vercel has). It makes the
 * call the server makes after a correct code: Identity Toolkit accounts:update.
 * The person then signs out and back in, so their ID token carries the flag.
 */
import { existsSync, readFileSync } from "node:fs";
import { cert } from "firebase-admin/app";

const [email, keyPath] = process.argv.slice(2);
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/verify-email.mjs <email> [path/to/service-account.json]");
  process.exit(2);
}

function serviceAccount() {
  if (keyPath) return JSON.parse(readFileSync(keyPath, "utf8"));
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw && existsSync(".env.local")) {
    const prefix = "FIREBASE_SERVICE_ACCOUNT_JSON=";
    const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith(prefix));
    raw = line?.slice(prefix.length).trim();
    if (raw && /^(['"]).*\1$/s.test(raw)) raw = raw.slice(1, -1);
  }
  if (!raw) {
    console.error("No service account found. Pass the JSON file's path, or put FIREBASE_SERVICE_ACCOUNT_JSON in .env.local.");
    process.exit(2);
  }
  return JSON.parse(raw);
}

const sa = serviceAccount();
let access_token;
try {
  ({ access_token } = await cert(sa).getAccessToken());
} catch (e) {
  console.error(`The service account could not be used: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
const base = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/accounts`;

async function call(method, body) {
  const res = await fetch(`${base}:${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`accounts:${method} failed (${res.status}): ${data.error?.message ?? "no details"}`);
    process.exit(1);
  }
  return data;
}

const target = email.trim().toLowerCase();
const { users = [] } = await call("lookup", { email: [target] });
const user = users[0];
if (!user) {
  console.error(`No account has the address ${target}.`);
  process.exit(1);
}
if (user.emailVerified) {
  console.log(`${target} is already verified.`);
  process.exit(0);
}
await call("update", { localId: user.localId, emailVerified: true });
console.log(`${target} is now verified. Sign out and back in so the app sees it.`);
