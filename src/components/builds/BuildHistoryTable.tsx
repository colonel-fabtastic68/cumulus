"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Hammer } from "lucide-react";
import type { Build } from "@/lib/types";
import { useCollection, useItemsById } from "@/lib/store/provider";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { matches } from "@/lib/utils";
import { Badge, Button, EmptyState, SearchField, StatusBadge, Table, type Column } from "@/components/ui";
import { buildDate, isBackDatedBuild } from "./buildUtils";

interface BuildHistoryTableProps {
  builds: Build[];
  onSelect: (build: Build) => void;
  onNew?: () => void;
}

export function BuildHistoryTable({ builds, onSelect, onNew }: BuildHistoryTableProps) {
  const itemsById = useItemsById();
  const members = useCollection("members");
  const [q, setQ] = useState("");

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const rows = useMemo(() => {
    const list = q.trim()
      ? builds.filter((b) => {
          const asm = itemsById.get(b.assemblyId);
          return matches(q, b.number, asm?.sku, asm?.name, membersById.get(b.createdBy)?.name, b.note, b.status);
        })
      : builds;
    return [...list].sort((a, b) => buildDate(b).localeCompare(buildDate(a)));
  }, [builds, q, itemsById, membersById]);

  const columns = useMemo<Column<Build>[]>(
    () => [
      { key: "number", header: "Number", render: (b) => <span className="font-medium text-text">{b.number}</span>, sortValue: (b) => b.number, width: "110px" },
      {
        key: "date",
        header: "Date",
        render: (b) => (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="text-text-secondary" title={formatDateTime(buildDate(b))}>
              {formatDate(buildDate(b))}
            </span>
            {isBackDatedBuild(b) && (
              <span title={`Recorded ${formatDateTime(b.createdAt)}`}>
                <Badge tone="warning">Back-dated</Badge>
              </span>
            )}
          </span>
        ),
        sortValue: (b) => buildDate(b),
        width: "120px",
      },
      {
        key: "assembly",
        header: "Assembly",
        render: (b) => {
          const asm = itemsById.get(b.assemblyId);
          return asm ? (
            <span className="block min-w-0">
              <Link href={"/inventory/" + asm.id} className="font-mono text-[12px] font-medium text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                {asm.sku}
              </Link>
              <span className="block max-w-[260px] truncate text-text-secondary" title={asm.name}>
                {asm.name}
              </span>
            </span>
          ) : (
            <span className="font-mono text-[12px] text-text-tertiary">{b.assemblyId}</span>
          );
        },
        sortValue: (b) => itemsById.get(b.assemblyId)?.sku ?? "",
      },
      { key: "qty", header: "Qty", render: (b) => formatNumber(b.qty), sortValue: (b) => b.qty, align: "right", width: "70px" },
      { key: "components", header: "Components", render: (b) => <span className="text-text-secondary">{formatNumber(b.components.length)}</span>, sortValue: (b) => b.components.length, align: "right", width: "110px", hideBelow: "md" },
      {
        key: "sub",
        header: "Sub-assemblies",
        render: (b) => (b.consumeSubassemblies ? <Badge tone="info">From stock</Badge> : <Badge>Exploded</Badge>),
        sortValue: (b) => (b.consumeSubassemblies ? 1 : 0),
        width: "130px",
        hideBelow: "lg",
      },
      {
        key: "by",
        header: "Built by",
        render: (b) => <span className="text-text-secondary">{membersById.get(b.createdBy)?.name ?? "—"}</span>,
        sortValue: (b) => membersById.get(b.createdBy)?.name ?? "",
        hideBelow: "md",
      },
      { key: "status", header: "Status", render: (b) => <StatusBadge status={b.status} />, sortValue: (b) => b.status, width: "110px" },
    ],
    [itemsById, membersById],
  );

  const empty = q.trim() ? (
    <EmptyState icon={<Hammer />} title="No builds match" description={`Nothing matches “${q.trim()}”. Try a build number, assembly or teammate.`} action={<Button size="sm" onClick={() => setQ("")}>Clear search</Button>} />
  ) : (
    <EmptyState
      icon={<Hammer />}
      title="No builds yet"
      description="Building an assembly consumes its components and puts finished units on the shelf. Every build is recorded here."
      action={
        onNew ? (
          <Button variant="primary" size="sm" icon={<Hammer />} onClick={onNew}>
            Build assembly
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <Table
      rows={rows}
      columns={columns}
      rowKey={(b) => b.id}
      onRowClick={onSelect}
      defaultSort={{ key: "date", dir: "desc" }}
      pageSize={25}
      emptyState={empty}
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <h3 className="text-[13.5px] font-semibold text-text">Build history</h3>
          <SearchField value={q} onChange={setQ} placeholder="Search number, assembly or teammate" className="w-full sm:ml-auto sm:w-72" />
        </div>
      }
      footer={`${rows.length} of ${builds.length} ${builds.length === 1 ? "build" : "builds"}`}
    />
  );
}
