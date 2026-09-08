"use client";

import { useState } from "react";
import { Copy, Send, UserPlus } from "lucide-react";
import type { Member, MemberRole, WorkspaceInvite } from "@/lib/types";
import { Banner, Button, FormGrid, Modal, Select, TextField, useToast } from "@/components/ui";
import { useCollection, useStore } from "@/lib/store/provider";
import { describeAuthError, useAuth, useCurrentUser } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { describeWorkspaceError, inviteLink, sendInviteEmail } from "@/lib/workspaces";
import { activityOp } from "@/lib/inventory";
import { newId, nowIso } from "@/lib/utils";
import { ROLE_DESCRIPTIONS, ROLE_OPTIONS, isValidEmail, pickMemberColor, roleLabel } from "./teamUtils";

/**
 * Gate: mounts the form only while open so every invite starts blank.
 */
export function InviteMemberModal({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited?: (member: Member) => void }) {
  if (!open) return null;
  return <InviteForm onClose={onClose} onInvited={onInvited} />;
}

function InviteForm({ onClose, onInvited }: { onClose: () => void; onInvited?: (member: Member) => void }) {
  const store = useStore();
  const members = useCollection("members");
  const user = useCurrentUser();
  const { mode } = useAuth();
  const session = useSession();
  const toast = useToast();
  const firestore = mode === "firestore";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ invite: WorkspaceInvite; mailed: boolean; mailError?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const duplicate = trimmedEmail.length > 0 && members.some((m) => m.email.trim().toLowerCase() === trimmedEmail);

  const nameError = !firestore && !trimmedName ? "Enter a name" : undefined;
  const emailError = !trimmedEmail ? "Enter an email address" : !isValidEmail(trimmedEmail) ? "Enter a valid email address" : duplicate ? "Someone with this email is already on the team" : undefined;
  const valid = !nameError && !emailError;

  const copyLink = async (inv: WorkspaceInvite) => {
    try {
      await navigator.clipboard.writeText(inviteLink(inv.id));
      toast("Invite link copied", "success");
    } catch {
      toast("Copy the link from the field", "default");
    }
  };

  const mail = async (inv: WorkspaceInvite) => {
    if (!session.app) return;
    try {
      await sendInviteEmail(session.app, inv);
      setCreated({ invite: inv, mailed: true });
      toast(`Invite emailed to ${inv.email}`, "success");
    } catch (e) {
      setCreated({ invite: inv, mailed: false, mailError: describeAuthError(e) });
    }
  };

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      if (firestore) {
        const invite = await session.createInvite({ email: trimmedEmail, role });
        setCreated({ invite, mailed: false });
        await mail(invite);
        return;
      }
      const member: Member = {
        id: newId("u"),
        name: trimmedName,
        email: trimmedEmail,
        role,
        color: pickMemberColor(members),
        status: "invited",
        createdAt: nowIso(),
      };
      await store.batch([
        { op: "put", collection: "members", doc: member },
        activityOp({ id: user.id, name: user.name }, "member.joined", `${user.name} invited ${member.name} as ${roleLabel(role).toLowerCase()}`, {
          entityType: "member",
          entityId: member.id,
          meta: { role },
        }),
      ]);
      toast(`Invited ${member.name} as ${roleLabel(role).toLowerCase()}`, "success");
      onInvited?.(member);
      onClose();
    } catch (e) {
      setError(describeWorkspaceError(e));
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    const { invite, mailed, mailError } = created;
    const link = inviteLink(invite.id);
    return (
      <Modal
        open
        onClose={onClose}
        title={mailed ? "Invite sent" : "Invite created"}
        subtitle={
          mailed
            ? `${invite.email} will get an email from Cumulus. Opening the link signs them in, creates their account if they are new, and lands them in the workspace as ${roleLabel(invite.role).toLowerCase()}.`
            : "The invite is saved. Share the link below, or fix the email setup and resend."
        }
        footer={
          <>
            {!mailed && (
              <Button icon={<Send />} onClick={() => void mail(invite)}>
                Try sending again
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {mailError && (
            <Banner tone="warning" title="The email could not be sent">
              {mailError}
            </Banner>
          )}
          <TextField
            label="Invite link"
            value={link}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            help="The same link the email carries. Anyone who opens it must sign in as the invited address."
            suffix={
              <button type="button" onClick={() => void copyLink(invite)} className="flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
            }
          />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite teammate"
      subtitle={firestore ? "They get an email with a sign-in link. Existing accounts sign in; new ones are created on the spot." : "In local mode the invite is recorded and the person appears in the demo user switcher."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={firestore ? <Send /> : <UserPlus />} onClick={submit} loading={saving} disabled={touched && !valid}>
            Send invite
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {firestore ? (
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@company.com" autoFocus error={touched ? emailError : undefined} />
        ) : (
          <FormGrid cols={2}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" autoFocus error={touched ? nameError : undefined} />
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@company.com" error={touched ? emailError : undefined} />
          </FormGrid>
        )}
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)} options={ROLE_OPTIONS} help={ROLE_DESCRIPTIONS[role]} />
        {error && <Banner tone="critical">{error}</Banner>}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}
