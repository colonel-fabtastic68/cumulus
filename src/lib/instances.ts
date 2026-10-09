/**
 * Bespoke instances: a client gets its own branded cumulusOS at a hostname
 * (willoranch.cumulusos.com), air-gapped from the shared product.
 *
 * Today an instance runs in the shared deployment but keeps nothing in common
 * with it except code:
 * - its data lives in its own named Firestore database (`databaseId`), not in
 *   the default one that holds every other workspace;
 * - its people sign in to their own Identity Platform tenant (`tenantEnv`), so
 *   accounts on cumulusos.com cannot sign in here and vice versa, and the
 *   server rejects a token from the wrong pool;
 * - it has exactly one workspace (`workspaceId`), no sign-up, no invites, no
 *   billing and no marketing pages (src/proxy.ts closes those routes);
 * - accounts are created by the operator (scripts/instance.ts), never by visitors.
 *
 * The same definition is meant to move to a dedicated deployment later
 * (own Vercel + Firebase project): set CUMULUS_INSTANCE to the id there and the
 * hostname check is skipped. Nothing in this file is secret: the browser gets a
 * copy of the matching instance through the runtime config.
 */

export type InstanceFeature = "ranch";

export interface InstanceBrand {
  /** Full name, e.g. "Willo Ranch". */
  name: string;
  /** What the product is called inside the instance, e.g. "Willo Ranch Inventory". */
  product: string;
  /** One line under the sign-in title. */
  tagline: string;
  /** Logo for light surfaces. */
  logo: string;
  /** Logo for the dark/brand panel. */
  logoOnDark: string;
  /** Square app icon (browser tab, workspace mark). */
  icon: string;
  /** Photo behind the sign-in panel. */
  signInImage?: string;
  /** Brand colors applied over the cumulusOS tokens. */
  colors: { primary: string; primaryHover: string; primaryText: string; panel: string; panelText: string; highlight: string };
}

export interface InstanceDef {
  id: string;
  /** Exact hostnames that open this instance (no port). `<id>.localhost` always works in development. */
  hosts: string[];
  /** Named Firestore database holding all of the instance's documents. */
  databaseId: string;
  /** The one workspace inside that database. */
  workspaceId: string;
  /** Env var holding the Identity Platform tenant id (not secret, but only known once the tenant exists). */
  tenantEnv: string;
  brand: InstanceBrand;
  features: InstanceFeature[];
  /** Connections the instance may use; the rest of the catalog is hidden and refused. */
  integrations: Array<"square" | "woocommerce">;
}

export const INSTANCES: readonly InstanceDef[] = [
  {
    id: "willoranch",
    hosts: ["willoranch.cumulusos.com"],
    databaseId: "willoranch",
    workspaceId: "willoranch",
    tenantEnv: "WILLORANCH_AUTH_TENANT",
    brand: {
      name: "Willo Ranch",
      product: "Willo Ranch Inventory",
      tagline: "Wagyu by the animal, sold by the pack.",
      logo: "/instances/willoranch/logo-teal.png",
      logoOnDark: "/instances/willoranch/logo-tan.png",
      icon: "/instances/willoranch/icon.png",
      signInImage: "/instances/willoranch/signin.jpg",
      colors: { primary: "#518090", primaryHover: "#3f6877", primaryText: "#ffffff", panel: "#3f6877", panelText: "#f5f1eb", highlight: "#f3c991" },
    },
    features: ["ranch"],
    integrations: ["square", "woocommerce"],
  },
];

/** What the browser is told about the instance it is on. */
export interface InstanceRuntime {
  id: string;
  databaseId: string;
  workspaceId: string;
  /** Null until the operator sets the tenant env var: sign-in stays closed. */
  tenantId: string | null;
  brand: InstanceBrand;
  features: InstanceFeature[];
  integrations: InstanceDef["integrations"];
}

export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

export function instanceById(id: string | null | undefined): InstanceDef | null {
  return INSTANCES.find((i) => i.id === id) ?? null;
}

/**
 * The instance a request belongs to. CUMULUS_INSTANCE pins one for a dedicated
 * deployment; otherwise the hostname decides, and anything unknown is the
 * shared product.
 */
export function instanceForHost(host: string | null | undefined, pinned: string | undefined = typeof process !== "undefined" ? process.env.CUMULUS_INSTANCE : undefined): InstanceDef | null {
  const fixed = pinned?.trim();
  if (fixed) return instanceById(fixed);
  const h = normalizeHost(host);
  if (!h) return null;
  return INSTANCES.find((i) => i.hosts.includes(h) || h === `${i.id}.localhost`) ?? null;
}

export function instanceTenantId(inst: InstanceDef): string | null {
  if (typeof process === "undefined") return null;
  const v = process.env[inst.tenantEnv]?.trim().replace(/^["']+|["']+$/g, "");
  return v || null;
}

export function instanceRuntime(inst: InstanceDef): InstanceRuntime {
  return { id: inst.id, databaseId: inst.databaseId, workspaceId: inst.workspaceId, tenantId: instanceTenantId(inst), brand: inst.brand, features: inst.features, integrations: inst.integrations };
}

export function hasFeature(inst: Pick<InstanceDef, "features"> | null | undefined, feature: InstanceFeature): boolean {
  return !!inst?.features.includes(feature);
}

/**
 * Pages and API routes that belong to the shared product only. On an instance
 * host they answer 404: no marketing, sign-up, workspace creation, billing,
 * invites, demo, admin console, MCP endpoint or OAuth hand-offs (those keep
 * their state in the shared database).
 */
export const SHARED_ONLY_PREFIXES = [
  "/book",
  "/demo",
  "/dpa",
  "/e/",
  "/eula",
  "/privacy",
  "/terms",
  "/checkout",
  "/sign-up",
  "/join",
  "/welcome",
  "/verify-email",
  "/workspaces",
  "/account",
  "/admin",
  "/nimbus",
  "/api/admin",
  "/api/auth",
  "/api/billing",
  "/api/chat",
  "/api/events",
  "/api/feedback",
  "/api/mailing-list",
  "/api/mcp",
  "/api/waitlist",
  "/api/workspaces",
  "/api/integrations/cron",
  "/api/integrations/shopify",
  "/api/integrations/clover",
  "/api/integrations/quickbooks",
  "/api/integrations/shippo",
  "/api/integrations/square/authorize",
  "/api/integrations/square/callback",
] as const;

/** Instance-only routes: 404 on the shared product. */
export const INSTANCE_ONLY_PREFIXES = ["/ranch", "/api/ranch", "/api/integrations/square/webhook"] as const;

export function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}
