"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, FileImage, FileSpreadsheet, FileText, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { WorkspaceDocument } from "@/lib/types";
import { documentUseLabel, formatBytes, useDocuments } from "@/lib/documents";
import { useCollection } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatDateTime, formatRelative, pluralize } from "@/lib/format";
import { cn, matches } from "@/lib/utils";
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, Menu, Page, SearchField, Segmented, Table, useToast, type Column } from "@/components/ui";
import { EditDocumentModal, UploadDocumentModal } from "@/components/documents";

function FileIcon({ mime }: { mime: string }) {
  if (mime.startsWith("image/")) return <FileImage className="h-4 w-4 text-icon" />;
  if (/spreadsheet|excel|csv/.test(mime)) return <FileSpreadsheet className="h-4 w-4 text-icon" />;
  return <FileText className="h-4 w-4 text-icon" />;
}

export default function DocumentsPage() {
  const docs = useDocuments();
  const members = useCollection("members");
  const user = useCurrentUser();
  const writable = canWrite(user);
  const toast = useToast();
  const { setPageContext } = useAgent();
  const [folder, setFolder] = useState<string>("");
  const [kind, setKind] = useState<"all" | "document" | "template">("all");
  const [q, setQ] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceDocument | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceDocument | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPageContext({ page: "Documents" });
  }, [setPageContext]);

  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of docs.documents) counts.set(d.folder ?? "", (counts.get(d.folder ?? "") ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0])));
  }, [docs.documents]);
  const folderNames = useMemo(() => folders.map(([f]) => f).filter(Boolean), [folders]);

  const rows = useMemo(() => {
    let list = docs.documents;
    if (folder) list = list.filter((d) => (d.folder ?? "") === (folder === "__none" ? "" : folder));
    if (kind !== "all") list = list.filter((d) => d.kind === kind);
    if (q.trim()) list = list.filter((d) => matches(q, d.name, d.folder, d.description, documentUseLabel(d.useFor)));
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [docs.documents, folder, kind, q]);

  const open = useCallback((d: WorkspaceDocument) => docs.open(d).catch((e) => toast(e instanceof Error ? e.message : String(e), "critical")), [docs, toast]);
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await docs.remove(deleting);
      toast(`Deleted “${deleting.name}”`, "success");
      setDeleting(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo<Column<WorkspaceDocument>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        render: (d) => (
          <span className="flex min-w-0 items-center gap-2">
            <FileIcon mime={d.mime} />
            <span className="min-w-0">
              <span className="block truncate font-medium text-text">{d.name}</span>
              {d.description && <span className="block max-w-[360px] truncate text-[12px] text-text-secondary">{d.description}</span>}
            </span>
          </span>
        ),
        sortValue: (d) => d.name,
      },
      { key: "kind", header: "Type", render: (d) => (d.kind === "template" ? <Badge tone="info">Template · {documentUseLabel(d.useFor)}</Badge> : <Badge>Document</Badge>), sortValue: (d) => `${d.kind}${d.useFor ?? ""}`, hideBelow: "md" },
      { key: "folder", header: "Folder", render: (d) => d.folder ?? <span className="text-text-tertiary">—</span>, sortValue: (d) => d.folder ?? "", hideBelow: "md" },
      { key: "size", header: "Size", align: "right", render: (d) => <span className="tabular text-text-secondary">{formatBytes(d.size)}</span>, sortValue: (d) => d.size, hideBelow: "lg" },
      { key: "by", header: "Added", render: (d) => <span className="text-text-secondary" title={formatDateTime(d.createdAt)}>{formatRelative(d.createdAt)}{members.find((m) => m.id === d.uploadedBy)?.name ? ` by ${members.find((m) => m.id === d.uploadedBy)!.name}` : ""}</span>, sortValue: (d) => d.createdAt, hideBelow: "lg" },
      {
        key: "actions",
        header: "",
        width: "44px",
        align: "right",
        render: (d) => (
          <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
            <Menu
              trigger={<IconButton variant="plain" size="sm" aria-label={`Actions for ${d.name}`} className="text-text-secondary"><MoreHorizontal className="h-4 w-4" /></IconButton>}
              items={[
                { label: "Open", icon: <ExternalLink />, onSelect: () => void open(d) },
                ...(writable ? (["divider", { label: "Edit details", icon: <Pencil />, onSelect: () => setEditing(d) }, { label: "Delete", icon: <Trash2 />, destructive: true, onSelect: () => setDeleting(d) }] as const) : []),
              ]}
            />
          </div>
        ),
      },
    ],
    [members, writable, open],
  );

  let empty: ReactNode;
  if (q.trim() || folder || kind !== "all") empty = <EmptyState icon={<FolderOpen />} title="Nothing here" description="No documents match the filter." action={<Button size="sm" onClick={() => { setQ(""); setFolder(""); setKind("all"); }}>Clear filters</Button>} />;
  else empty = <EmptyState icon={<FolderOpen />} title="No documents yet" description="A shared drive for the workspace: purchase order and quote templates, supplier price lists, drawings, signed forms. Templates show up in the “From template” menus on the Orders pages." action={writable ? <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setUploadOpen(true)}>Add a document</Button> : undefined} />;

  return (
    <Page
      title="Documents"
      subtitle="Templates and files everyone in the workspace can reach"
      primaryAction={writable ? <Button variant="primary" icon={<Plus />} onClick={() => setUploadOpen(true)}>Add</Button> : undefined}
    >
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-1.5 px-2 text-[11.5px] font-semibold uppercase tracking-wide text-text-tertiary">Folders</div>
          <ul className="flex flex-col gap-0.5">
            <li>
              <button type="button" onClick={() => setFolder("")} className={cn("flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px]", folder === "" ? "bg-surface text-text shadow-[var(--shadow-100)]" : "text-text-secondary hover:bg-[rgba(0,0,0,0.04)]")}>
                <span>All documents</span>
                <span className="text-[11.5px] text-text-tertiary">{docs.documents.length}</span>
              </button>
            </li>
            {folders.map(([f, n]) => (
              <li key={f || "__none"}>
                <button type="button" onClick={() => setFolder(f || "__none")} className={cn("flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px]", folder === (f || "__none") ? "bg-surface text-text shadow-[var(--shadow-100)]" : "text-text-secondary hover:bg-[rgba(0,0,0,0.04)]")}>
                  <span className="truncate">{f || "Unfiled"}</span>
                  <span className="text-[11.5px] text-text-tertiary">{n}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="min-w-0">
          <Table
            rows={rows}
            columns={columns}
            rowKey={(d) => d.id}
            onRowClick={(d) => void open(d)}
            defaultSort={{ key: "by", dir: "desc" }}
            pageSize={50}
            emptyState={empty}
            toolbar={
              <div className="flex w-full flex-wrap items-center gap-2">
                <Segmented value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "document", label: "Documents" }, { value: "template", label: "Templates" }]} />
                <SearchField value={q} onChange={setQ} placeholder="Search names, folders, descriptions" className="w-full sm:ml-auto sm:w-72" />
              </div>
            }
            footer={`${pluralize(rows.length, "file")} · ${formatBytes(rows.reduce((s, d) => s + d.size, 0))}`}
          />
        </div>
      </div>
      <UploadDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} folders={folderNames} defaults={folder && folder !== "__none" ? { folder } : undefined} />
      <EditDocumentModal doc={editing} folders={folderNames} onClose={() => setEditing(null)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} loading={busy} destructive confirmLabel="Delete" title={`Delete “${deleting?.name}”?`} message={<>The file is removed for everyone in the workspace. This cannot be undone.</>} />
    </Page>
  );
}
