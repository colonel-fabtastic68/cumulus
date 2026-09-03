"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Build } from "@/lib/types";
import { useCollection, useItemsById, useSettings } from "@/lib/store/provider";
import { formatDateTime, formatMoney, formatNumber, formatQty, formatRelative, pluralize } from "@/lib/format";
import { round, sum } from "@/lib/utils";
import { Badge, Button, DescriptionList, Modal, SimpleTable, StatusBadge } from "@/components/ui";
import { buildComponentRows, buildDate, isBackDatedBuild } from "./buildUtils";

interface BuildDetailModalProps {
  build: Build | null;
  onClose: () => void;
}

/** Mounts only while a build is selected and remounts per build. */
export function BuildDetailModal({ build, onClose }: BuildDetailModalProps) {
  if (!build) return null;
  return <BuildDetail key={build.id} build={build} onClose={onClose} />;
}

function BuildDetail({ build, onClose }: { build: Build; onClose: () => void }) {
  const itemsById = useItemsById();
  const movements = useCollection("movements");
  const members = useCollection("members");
  const { currency } = useSettings();

  const assembly = itemsById.get(build.assemblyId);
  const builtBy = members.find((m) => m.id === build.createdBy)?.name;
  const rows = useMemo(() => buildComponentRows(build, itemsById, movements), [build, itemsById, movements]);
  const totalCost = round(sum(rows.map((r) => r.extended)));
  const perUnit = build.qty > 0 ? round(totalCost / build.qty) : 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono">{build.number}</span>
          <StatusBadge status={build.status} />
        </span>
      }
      subtitle={assembly ? `${formatNumber(build.qty)} × ${assembly.sku} · ${assembly.name}` : `${formatNumber(build.qty)} units`}
      footer={
        <>
          <div className="mr-auto text-[13px] text-text-secondary">
            {pluralize(rows.length, "component")} · Cost <span className="font-semibold text-text tabular">{formatMoney(totalCost, currency)}</span>
            <span className="text-text-tertiary"> · {formatMoney(perUnit, currency)} per unit</span>
          </div>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <DescriptionList
            rows={[
              {
                label: "Assembly",
                value: assembly ? (
                  <Link href={"/inventory/" + assembly.id} className="font-mono text-[12.5px] text-accent hover:underline">
                    {assembly.sku}
                  </Link>
                ) : (
                  <span className="text-text-tertiary">Item no longer exists</span>
                ),
              },
              { label: "Quantity", value: formatQty(build.qty, assembly?.unit) },
              { label: "Sub-assemblies", value: build.consumeSubassemblies ? <Badge tone="info">Pulled from stock</Badge> : <Badge>Exploded to parts</Badge> },
            ]}
          />
          <DescriptionList
            rows={[
              {
                label: "Completed",
                value: (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span title={formatRelative(buildDate(build))}>{formatDateTime(buildDate(build))}</span>
                    {isBackDatedBuild(build) && <Badge tone="warning">Back-dated</Badge>}
                  </span>
                ),
              },
              { label: "Built by", value: builtBy ?? "—" },
              { label: "Recorded", value: <span title={formatDateTime(build.createdAt)}>{formatRelative(build.createdAt)}</span> },
            ]}
          />
        </div>

        <div>
          <div className="mb-1.5 text-[13px] font-semibold text-text">Components consumed</div>
          <SimpleTable>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Component</th>
                <th className="text-right">Qty per</th>
                <th className="text-right">Consumed</th>
                <th className="text-right">Unit cost</th>
                <th className="text-right">Extended</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td className="align-top">
                    {r.item ? (
                      <Link href={"/inventory/" + r.item.id} className="font-mono text-[12px] text-accent hover:underline">
                        {r.item.sku}
                      </Link>
                    ) : (
                      <span className="font-mono text-[12px] text-text-tertiary">{r.itemId}</span>
                    )}
                  </td>
                  <td className="max-w-[240px] truncate align-top text-text-secondary">{r.item?.name ?? "Item no longer exists"}</td>
                  <td className="text-right align-top text-text-secondary tabular">{formatQty(r.qtyPer, r.item?.unit)}</td>
                  <td className="text-right align-top tabular">{formatQty(r.qtyConsumed, r.item?.unit)}</td>
                  <td className="text-right align-top text-text-secondary tabular">{formatMoney(r.unitCost, currency)}</td>
                  <td className="text-right align-top font-medium tabular">{formatMoney(r.extended, currency)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-text-tertiary">
                    No components were recorded for this build.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={5} className="text-right text-text-secondary">
                    Total component cost
                  </td>
                  <td className="text-right font-semibold tabular">{formatMoney(totalCost, currency)}</td>
                </tr>
              </tfoot>
            )}
          </SimpleTable>
        </div>

        {build.note && (
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-text">Note</div>
            <p className="whitespace-pre-wrap rounded-[var(--radius-sm)] bg-surface-subdued px-3 py-2 text-[13px] text-text-secondary">{build.note}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
