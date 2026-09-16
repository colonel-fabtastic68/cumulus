import { HttpError, authenticateAccount, jsonError, readJson } from "@/lib/integrations/server";
import { newId, nowIso } from "@/lib/utils";

export const FEEDBACK_KINDS = ["feedback", "feature", "bug"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface FeedbackRecord {
  id: string;
  uid: string;
  email: string;
  kind: FeedbackKind;
  message: string;
  page?: string;
  workspaceId?: string;
  createdAt: string;
}

/** Files a note from the sidebar's Feedback chip. Read back on /admin; never by other accounts. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req);
    const body = await readJson<{ kind?: unknown; message?: unknown; page?: unknown; workspaceId?: unknown }>(req);
    const kind = FEEDBACK_KINDS.find((k) => k === body.kind) ?? "feedback";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
    if (message.length < 3) throw new HttpError(400, "Write a sentence or two first.");
    const record: FeedbackRecord = {
      id: newId("fb"),
      uid: ctx.uid,
      email: ctx.email,
      kind,
      message,
      ...(typeof body.page === "string" ? { page: body.page.slice(0, 200) } : {}),
      ...(typeof body.workspaceId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.workspaceId) ? { workspaceId: body.workspaceId } : {}),
      createdAt: nowIso(),
    };
    await ctx.db.doc(`feedback/${record.id}`).set(record);
    return Response.json({ ok: true, id: record.id });
  } catch (e) {
    return jsonError(e);
  }
}
