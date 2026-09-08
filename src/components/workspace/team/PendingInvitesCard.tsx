"use client";

import { useEffect, useState } from "react";
import { Copy, Mail, Send, X } from "lucide-react";
import type { WorkspaceInvite } from "@/lib/types";
import { Card, CardHeader, IconButton, useToast } from "@/components/ui";
import { describeAuthError } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { useSession } from "@/lib/session";
import { inviteLink, sendInviteEmail } from "@/lib/workspaces";
import { roleLabel } from "./teamUtils";

/** Firestore mode: invites for this workspace that nobody has redeemed yet. */
export function PendingInvitesCard() {
  const session = useSession();
  const toast = useToast();
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const subscribe = session.subscribeWorkspaceInvites;

  useEffect(() => subscribe(setInvites), [subscribe]);

  const copy = async (inv: WorkspaceInvite) => {
    try {
      await navigator.clipboard.writeText(inviteLink(inv.id));
      toast("Invite link copied", "success");
    } catch {
      toast(inviteLink(inv.id), "default");
    }
  };

  const resend = async (inv: WorkspaceInvite) => {
    if (!session.app) return;
    try {
      await sendInviteEmail(session.app, inv);
      toast(`Invite emailed again to ${inv.email}`, "success");
    } catch (e) {
      toast(describeAuthError(e), "critical");
    }
  };

  const revoke = async (inv: WorkspaceInvite) => {
    try {
      await session.revokeInvite(inv.id);
      toast(`Revoked the invite for ${inv.email}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not revoke the invite", "critical");
    }
  };

  return (
    <Card>
      <CardHeader title="Pending invites" subtitle={invites.length ? `${invites.length} waiting to be opened` : "Nobody is waiting to join"} />
      {invites.length > 0 && (
        <ul className="-mx-4 -mb-4 border-t border-border">
          {invites.map((inv) => (
            <li key={inv.id} className="flex items-center gap-1.5 border-t border-border px-4 py-2.5 first:border-t-0">
              <Mail className="mr-1 h-4 w-4 shrink-0 text-icon" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-text">{inv.email}</div>
                <div className="text-[12px] text-text-secondary">
                  {roleLabel(inv.role)} · {formatRelative(inv.createdAt)}
                </div>
              </div>
              <IconButton size="sm" variant="plain" aria-label="Email the invite again" icon={<Send />} onClick={() => void resend(inv)} />
              <IconButton size="sm" variant="plain" aria-label="Copy invite link" icon={<Copy />} onClick={() => void copy(inv)} />
              <IconButton size="sm" variant="plain" aria-label="Revoke invite" icon={<X />} onClick={() => void revoke(inv)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
