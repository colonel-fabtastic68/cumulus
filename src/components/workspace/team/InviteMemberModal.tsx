"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import type { Member, MemberRole } from "@/lib/types";
import { Button, FormGrid, Modal, Select, TextField, useToast } from "@/components/ui";
import { useCollection, useStore } from "@/lib/store/provider";
import { useAuth, useCurrentUser } from "@/lib/auth";
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
  const toast = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const duplicate = trimmedEmail.length > 0 && members.some((m) => m.email.trim().toLowerCase() === trimmedEmail);

  const nameError = !trimmedName ? "Enter a name" : undefined;
  const emailError = !trimmedEmail ? "Enter an email address" : !isValidEmail(trimmedEmail) ? "Enter a valid email address" : duplicate ? "Someone with this email is already on the team" : undefined;
  const valid = !nameError && !emailError;

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    try {
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
      toast(e instanceof Error ? e.message : "Could not send the invite", "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite teammate"
      subtitle={mode === "local" ? "In local mode the invite is recorded and the person appears in the demo user switcher." : "They will get access when they sign in with this email."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<UserPlus />} onClick={submit} loading={saving} disabled={touched && !valid}>
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
        <FormGrid cols={2}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" autoFocus error={touched ? nameError : undefined} />
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@company.com" error={touched ? emailError : undefined} />
        </FormGrid>
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)} options={ROLE_OPTIONS} help={ROLE_DESCRIPTIONS[role]} />
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}
