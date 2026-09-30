"use client";

import { useState } from "react";
import type { DocumentUse, WorkspaceDocument } from "@/lib/types";
import { DOCUMENT_USES, useDocuments } from "@/lib/documents";
import { Button, FormGrid, Modal, Segmented, Select, TextArea, TextField, useToast } from "@/components/ui";

export function EditDocumentModal({ doc, folders, onClose }: { doc: WorkspaceDocument | null; folders: string[]; onClose: () => void }) {
  if (!doc) return null;
  return <EditForm key={doc.id} doc={doc} folders={folders} onClose={onClose} />;
}

function EditForm({ doc, folders, onClose }: { doc: WorkspaceDocument; folders: string[]; onClose: () => void }) {
  const docs = useDocuments();
  const toast = useToast();
  const [name, setName] = useState(doc.name);
  const [folder, setFolder] = useState(doc.folder ?? "");
  const [kind, setKind] = useState<WorkspaceDocument["kind"]>(doc.kind);
  const [useFor, setUseFor] = useState<DocumentUse>(doc.useFor ?? "general");
  const [description, setDescription] = useState(doc.description ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await docs.update(doc.id, { name: name.trim() || doc.name, folder: folder.trim() || undefined, kind, useFor: kind === "template" ? useFor : undefined, description: description.trim() || undefined });
      toast("Saved", "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="md" title="Edit document" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} loading={busy}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <FormGrid cols={2}>
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-text">Type</div>
            <Segmented value={kind} onChange={setKind} options={[{ value: "document", label: "Document" }, { value: "template", label: "Template" }]} />
          </div>
          {kind === "template" && <Select label="Offer it under" value={useFor} onChange={(e) => setUseFor(e.target.value as DocumentUse)} options={DOCUMENT_USES} />}
        </FormGrid>
        <TextField label="Folder" hint="(optional)" value={folder} onChange={(e) => setFolder(e.target.value)} list="document-folders-edit" />
        <datalist id="document-folders-edit">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <TextArea label="Description" hint="(optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>
    </Modal>
  );
}
