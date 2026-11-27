#!/usr/bin/env node
/**
 * Switches Firebase's reCAPTCHA protection for email and password accounts on
 * or off: sign-in, sign-up, password reset and emailed sign-in links. With it
 * on, Firebase scores each of those requests with reCAPTCHA Enterprise and,
 * when enforcing, refuses the ones that look automated. The browser side is
 * already in the app (the `recaptcha` feature): the Firebase SDK attaches the
 * token by itself.
 *
 *   node scripts/recaptcha.mjs status
 *   node scripts/recaptcha.mjs audit      score and log, block nothing (start here)
 *   node scripts/recaptcha.mjs enforce    block scores under 0.3
 *   node scripts/recaptcha.mjs off
 *   node scripts/recaptcha.mjs audit path/to/service-account.json
 *
 * Before the first run, enable the reCAPTCHA Enterprise API on the Google Cloud
 * project (console.cloud.google.com → APIs & Services → reCAPTCHA Enterprise
 * API → Enable). Firebase then creates and manages its own web key. Running
 * this agrees to the reCAPTCHA Enterprise terms for the project.
 *
 * Without a path, the service account comes from FIREBASE_SERVICE_ACCOUNT_JSON
 * in the environment or in .env.local (the same value Vercel has).
 */
import { existsSync, readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const MODES = { status: null, audit: "AUDIT", enforce: "ENFORCE", off: "OFF" };
/** Requests scoring below this are blocked while enforcing (0 = surely a bot, 1 = surely a person). */
const BLOCK_BELOW = 0.3;

const [mode, keyPath] = process.argv.slice(2);
if (!mode || !(mode in MODES)) {
  console.error("Usage: node scripts/recaptcha.mjs <status|audit|enforce|off> [path/to/service-account.json]");
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
const projects = getAuth(initializeApp({ credential: cert(sa), projectId: sa.project_id })).projectConfigManager();

function describe(config) {
  const rc = config.recaptchaConfig ?? {};
  const state = rc.emailPasswordEnforcementState ?? "OFF";
  const rule = (rc.managedRules ?? [])[0];
  const keys = (rc.recaptchaKeys ?? []).map((k) => `${k.type ?? "WEB"} ${k.key}`).join(", ") || "none yet";
  return `Email and password reCAPTCHA: ${state}${rule ? ` (blocks scores under ${rule.endScore})` : ""}. Keys: ${keys}.`;
}

try {
  if (MODES[mode] === null) {
    console.log(describe(await projects.getProjectConfig()));
    process.exit(0);
  }
  const updated = await projects.updateProjectConfig({
    recaptchaConfig: {
      emailPasswordEnforcementState: MODES[mode],
      managedRules: [{ endScore: BLOCK_BELOW, action: "BLOCK" }],
      useAccountDefender: false,
    },
  });
  console.log(describe(updated));
  if (mode === "audit") console.log("Nothing is blocked yet. Watch the scores in Google Cloud → Security → reCAPTCHA for a week, then run enforce.");
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`Firebase refused the change: ${message}`);
  if (/recaptcha|API has not been used|disabled/i.test(message)) console.error("Enable the reCAPTCHA Enterprise API on the Google Cloud project first, then run this again.");
  process.exit(1);
}
