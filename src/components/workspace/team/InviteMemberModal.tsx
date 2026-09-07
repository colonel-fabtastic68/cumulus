"use client";

import { useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import type { Member, MemberRole, WorkspaceInvite } from "@/lib/types";
import { Banner, Button, FormGrid, Modal, Select, TextField, useToast } from "@/components/ui";
import { useCollection, useStore } from "@/lib/store/provider";
import { useAuth, useCurrentUser } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { describeWorkspaceError, inviteLink } from "@/lib/workspaces";
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
  const [created, setCreated] = useState<WorkspaceInvite | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const duplicate = trimmedEmail.length > 0 && members.some((m) => m.email.trim().toLowerCase() === trimmedEmail);

  const nameError = !firestore && !trimmedName ? "Enter a name" : undefined;
  const emailError = !trimmedEmail ? (firestore ? undefined : "Enter an email address") : !isValidEmail(trimmedEmail) ? "Enter a valid email address" : duplicate ? "Someone with this email is already on the team" : undefined;
  const valid = !nameError && !emailError;

  const copyLink = async (inv: WorkspaceInvite) => {
    try {
      await navigator.clipboard.writeText(inviteLink(inv.id));
      toast("Invite link copied", "success");
    } catch {
      toast("Copy the link from the field", "default");
    }
  };

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      if (firestore) {
        const invite = await session.createInvite({ email: trimmedEmail || undefined, role });
        setCreated(invite);
        void copyLink(invite);
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
    const link = inviteLink(created.id);
    return (
      <Modal
        open
        onClose={onClose}
        title="Invite ready"
        subtitle={created.email ? `${created.email} will see it on their Workspaces page after signing in. The link works too.` : "Anyone who opens this link and signs in joins as " + roleLabel(created.role).toLowerCase() + "."}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <TextField label="Invite link" value={link} readOnly onFocus={(e) => e.currentTarget.select()} suffix={<button type="button" onClick={() => void copyLink(created)} className="text-[12px] font-medium text-accent hover:underline">Copy</button>} />
          <p className="text-[12.5px] text-text-secondary">
            Or share the code <code>{created.id}</code>. Pending invites can be revoked from the Team page.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite teammate"
      subtitle={firestore ? "Send the link, or add their email so the invite shows up when they sign in. Leave the email blank for a link anyone can use." : "In local mode the invite is recorded and the person appears in the demo user switcher."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={firestore ? <Copy /> : <UserPlus />} onClick={submit} loading={saving} disabled={touched && !valid}>
            {firestore ? "Create invite" : "Send invite"}
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
          <TextField label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@company.com" autoFocus error={touched ? emailError : undefined} />
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
