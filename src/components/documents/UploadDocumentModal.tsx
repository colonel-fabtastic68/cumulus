"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import type { DocumentUse, WorkspaceDocument } from "@/lib/types";
import { DOCUMENT_USES, formatBytes, useDocuments } from "@/lib/documents";
import { Button, FormGrid, Modal, Segmented, Select, TextArea, TextField, useToast } from "@/components/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  folders: string[];
  /** Pre-select a folder or template use, e.g. when opened from the purchase orders page. */
  defaults?: { folder?: string; kind?: WorkspaceDocument["kind"]; useFor?: DocumentUse };
  onUploaded?: (doc: WorkspaceDocument) => void;
}

export function UploadDocumentModal(props: Props) {
  if (!props.open) return null;
  return <UploadForm {...props} />;
}

function UploadForm({ open, onClose, folders, defaults, onUploaded }: Props) {
  const docs = useDocuments();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(defaults?.folder ?? "");
  const [kind, setKind] = useState<WorkspaceDocument["kind"]>(defaults?.kind ?? "document");
  const [useFor, setUseFor] = useState<DocumentUse>(defaults?.useFor ?? "general");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (list: FileList | null) => {
    const next = Array.from(list ?? []);
    if (!next.length) return;
    setFiles(next);
    if (next.length === 1 && !name) setName(next[0]!.name.replace(/\.[a-z0-9]+$/i, ""));
  };

  const submit = async () => {
    if (files.length === 0) return setError("Choose a file first.");
    setBusy(true);
    setError(null);
    try {
      let last: WorkspaceDocument | undefined;
      for (const file of files) {
        last = await docs.upload({ file, name: files.length === 1 ? name.trim() || undefined : undefined, folder, kind, useFor: kind === "template" ? useFor : undefined, description });
      }
      toast(files.length === 1 ? `Added “${last!.name}”` : `Added ${files.length} files`, "success");
      if (last) onUploaded?.(last);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Add to Documents"
      subtitle={docs.where === "server" ? "Files up to 25 MB, shared with everyone in the workspace." : "Local mode keeps files up to 3 MB in this browser."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={files.length === 0}>
            {files.length > 1 ? `Add ${files.length} files` : "Add"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-border px-6 py-8 text-center hover:bg-surface-subdued"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files);
          }}
        >
          <FileUp className="h-5 w-5 text-icon" />
          {files.length ? (
            <div className="text-[13px] text-text">
              {files.length === 1 ? `${files[0]!.name} · ${formatBytes(files[0]!.size)}` : `${files.length} files · ${formatBytes(files.reduce((s, f) => s + f.size, 0))}`}
            </div>
          ) : (
            <div className="text-[13px] font-medium text-text">Drop files here, or click to choose</div>
          )}
          <div className="text-[12px] text-text-secondary">PDF, spreadsheets, Word documents, images, drawings: anything the team needs at hand.</div>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
        </div>
        {files.length === 1 && <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={files[0]!.name} />}
        <FormGrid cols={2}>
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-text">Type</div>
            <Segmented value={kind} onChange={setKind} options={[{ value: "document", label: "Document" }, { value: "template", label: "Template" }]} />
          </div>
          {kind === "template" && <Select label="Offer it under" value={useFor} onChange={(e) => setUseFor(e.target.value as DocumentUse)} options={DOCUMENT_USES} help="Templates show in that page's “From template” menu." />}
        </FormGrid>
        <TextField label="Folder" hint="(optional)" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={folders[0] ?? "Supplier price lists"} list="document-folders" />
        <datalist id="document-folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <TextArea label="Description" hint="(optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What it is and when to use it" />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
