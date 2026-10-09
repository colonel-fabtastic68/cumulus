/**
 * Operator tool for bespoke instances (src/lib/instances.ts). Run from the repo
 * root with the service account and the instance's tenant id in .env.local:
 *
 *   npx tsx scripts/instance.ts init willoranch
 *   npx tsx scripts/instance.ts add-user willoranch --email jane@willoranch.com --name "Jane Leach" --role owner
 *   npx tsx scripts/instance.ts list-users willoranch
 *   npx tsx scripts/instance.ts remove-user willoranch --email jane@willoranch.com
 *
 * Everything is written to the instance's own Firestore database and Identity
 * Platform tenant; the shared product's data and accounts are never touched.
 * add-user prints a one-time link for the person to set their password (send
 * it to them yourself); no password is ever printed or stored here.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { adminApp, readServiceAccount } from "../src/lib/mcp/adminStore";
import { instanceById, instanceTenantId, type InstanceDef } from "../src/lib/instances";
import { freshWorkspace } from "../src/lib/seed";
import { avatarColor } from "../src/lib/colors";
import { COLLECTIONS, type Member, type MemberRole, type UserProfile, type WorkspaceSettings } from "../src/lib/types";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

function args(argv: string[]): { cmd: string; id: string; flags: Record<string, string> } {
  const [cmd = "", id = "", ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) flags[a.slice(2)] = rest[i + 1] && !rest[i + 1]!.startsWith("--") ? rest[++i]! : "true";
  }
  return { cmd, id, flags };
}

const now = () => new Date().toISOString();
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function init(db: Firestore, inst: InstanceDef) {
  const ws = inst.workspaceId;
  if ((await db.doc(`workspaces/${ws}/settings/default`).get()).exists) {
    console.log(`✓ ${inst.brand.name} workspace already set up (${inst.databaseId}/${ws}); nothing changed.`);
    return;
  }
  const snapshot = freshWorkspace({ companyName: inst.brand.name, currency: "USD" });
  // Only the connections the instance offers.
  snapshot.integrations = snapshot.integrations.filter((i) => (inst.integrations as string[]).includes(i.id));
  const iconPath = resolve("public", inst.brand.icon.replace(/^\//, "").replace(/icon\.png$/, "icon-128.png"));
  const logo = existsSync(iconPath) ? `data:image/png;base64,${readFileSync(iconPath).toString("base64")}` : undefined;
  const settings: WorkspaceSettings = { ...snapshot.settings[0]!, id: "default", companyName: inst.brand.name, currency: "USD", timezone: "America/Denver", ...(logo ? { logo } : {}), updatedAt: now() };
  const t = now();
  let batch = db.batch();
  let n = 0;
  for (const col of COLLECTIONS) {
    if (col === "members" || col === "settings") continue;
    for (const row of snapshot[col] as Array<{ id: string }>) {
      batch.set(db.doc(`workspaces/${ws}/${col}/${row.id}`), clean(row));
      if (++n % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
  }
  batch.set(db.doc(`workspaces/${ws}`), { id: ws, name: inst.brand.name, ownerId: "operator", createdAt: t });
  batch.set(db.doc(`workspaces/${ws}/settings/default`), clean(settings));
  batch.set(db.doc(`workspaces/${ws}/activity/act_init`), { id: "act_init", type: "settings.updated", message: `${inst.brand.product} was set up`, actorId: "operator", actorName: "cumulusOS", createdAt: t });
  await batch.commit();
  console.log(`✓ Set up ${inst.brand.name} in database "${inst.databaseId}", workspace "${ws}".`);
}

async function addUser(db: Firestore, inst: InstanceDef, tenantId: string, flags: Record<string, string>) {
  const email = (flags.email ?? "").trim().toLowerCase();
  const name = (flags.name ?? "").trim() || email.split("@")[0]!;
  const role = (flags.role ?? "member") as MemberRole;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Give --email for the person.");
  if (!["owner", "admin", "member", "viewer"].includes(role)) fail("--role is owner, admin, member or viewer.");
  if (!(await db.doc(`workspaces/${inst.workspaceId}/settings/default`).get()).exists) fail(`Run "init ${inst.id}" first.`);
  const auth = getAuth(adminApp(readServiceAccount()!)).tenantManager().authForTenant(tenantId);
  let user = await auth.getUserByEmail(email).catch(() => null);
  if (!user) {
    // A random password nobody sees; the person sets their own through the link below.
    user = await auth.createUser({ email, displayName: name, password: randomBytes(24).toString("base64url"), emailVerified: true });
    console.log(`✓ Created the ${inst.brand.name} account for ${email}.`);
  } else console.log(`• ${email} already has a ${inst.brand.name} account; updating access.`);
  const t = now();
  const member: Member = { id: user.uid, name, email, role, color: avatarColor(user.uid), status: "active", createdAt: t };
  const existing = await db.doc(`workspaces/${inst.workspaceId}/members/${user.uid}`).get();
  await db.doc(`workspaces/${inst.workspaceId}/members/${user.uid}`).set(clean(existing.exists ? { ...existing.data(), role, name } : member), { merge: true });
  const profile: Partial<UserProfile> = { id: user.uid, email, name, workspaces: { [inst.workspaceId]: { id: inst.workspaceId, name: inst.brand.name, role, joinedAt: t } }, lastWorkspaceId: inst.workspaceId, updatedAt: t };
  const profileRef = db.doc(`users/${user.uid}`);
  await profileRef.set(clean((await profileRef.get()).exists ? profile : { ...profile, createdAt: t }), { merge: true });
  console.log(`✓ ${email} is ${role === "owner" ? "an owner" : `a ${role}`} of ${inst.brand.product}.`);
  if (flags["no-link"] !== "true") {
    const host = inst.hosts[0]!;
    const link = await auth.generatePasswordResetLink(email, { url: `https://${host}/sign-in?email=${encodeURIComponent(email)}` });
    console.log(`\nSend this link to ${email} so they can choose a password (it works once):\n${link}\n`);
  }
}

async function listUsers(db: Firestore, inst: InstanceDef) {
  const snap = await db.collection(`workspaces/${inst.workspaceId}/members`).get();
  if (snap.empty) console.log("No one yet. Add people with add-user.");
  for (const d of snap.docs) {
    const m = d.data() as Member;
    console.log(`${m.role.padEnd(7)} ${m.email.padEnd(36)} ${m.name}`);
  }
}

async function removeUser(db: Firestore, inst: InstanceDef, tenantId: string, flags: Record<string, string>) {
  const email = (flags.email ?? "").trim().toLowerCase();
  if (!email) fail("Give --email.");
  const auth = getAuth(adminApp(readServiceAccount()!)).tenantManager().authForTenant(tenantId);
  const user = await auth.getUserByEmail(email).catch(() => null);
  if (!user) fail(`${email} has no ${inst.brand.name} account.`);
  await db.doc(`workspaces/${inst.workspaceId}/members/${user.uid}`).delete();
  await db.doc(`users/${user.uid}`).delete();
  await auth.deleteUser(user.uid);
  console.log(`✓ Removed ${email} from ${inst.brand.product} (account deleted; their history stays in the activity log).`);
}

async function main() {
  loadEnvFile(resolve(".env.local"));
  const { cmd, id, flags } = args(process.argv.slice(2));
  if (!cmd || !id) fail("Usage: npx tsx scripts/instance.ts <init|add-user|list-users|remove-user> <instance-id> [--email …] [--name …] [--role owner|admin|member|viewer]");
  const inst = instanceById(id);
  if (!inst) fail(`Unknown instance "${id}". Instances are defined in src/lib/instances.ts.`);
  const sa = readServiceAccount();
  if (!sa) fail("FIREBASE_SERVICE_ACCOUNT_JSON (or _B64) is not set in .env.local.");
  const db = getFirestore(adminApp(sa), inst.databaseId);
  const tenantId = instanceTenantId(inst);
  if (cmd === "init") return init(db, inst);
  if (cmd === "list-users") return listUsers(db, inst);
  if (!tenantId) fail(`${inst.tenantEnv} is not set: create the Identity Platform tenant first and put its id in .env.local and on Vercel.`);
  if (cmd === "add-user") return addUser(db, inst, tenantId, flags);
  if (cmd === "remove-user") return removeUser(db, inst, tenantId, flags);
  fail(`Unknown command "${cmd}".`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
