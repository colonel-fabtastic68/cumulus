import { HttpError, authenticate, jsonError, readJson } from "@/lib/integrations/server";
import { scanSite } from "@/lib/server/siteScan";

export const maxDuration = 120;

/** Reads the caller's own website for its catalog and returns import rows for review. Nothing is written here. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const { url } = await readJson<{ url?: unknown }>(req);
    if (typeof url !== "string") throw new HttpError(400, "Enter your website address.");
    const result = await scanSite(url);
    console.log("[website-import]", ctx.workspaceId, result.platform, result.site, result.rows.length, "rows", result.pagesScanned, "pages");
    return Response.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
