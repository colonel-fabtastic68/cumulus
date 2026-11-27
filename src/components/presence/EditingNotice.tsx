"use client";

import { Banner } from "@/components/ui";
import { useCollection } from "@/lib/store/provider";
import { useEditingPresence } from "./PresenceProvider";

/**
 * Inside an edit form: says so while this tab has the record open for editing,
 * and warns when another teammate has the same record's form open too.
 * `recordKey` is null while creating a new record (nothing to clash with).
 */
export function EditingNotice({ recordKey, noun }: { recordKey: string | null; noun: string }) {
  const ids = useEditingPresence(recordKey);
  const members = useCollection("members");
  const names = members.filter((m) => ids.includes(m.id)).map((m) => m.name);
  if (names.length === 0) return null;
  const who = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return (
    <Banner tone="warning" title={`${who} ${names.length === 1 ? "is" : "are"} editing this ${noun} too`}>
      Whoever saves last replaces the other&apos;s changes. Agree who goes first, or close this and open it again once they have saved.
    </Banner>
  );
}
