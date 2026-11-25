"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Download, Pencil, Printer, Share2, Trash2 } from "lucide-react";
import { Banner, Button, DescriptionList, Drawer, Menu, useToast } from "@/components/ui";
import { downloadBlob } from "@/lib/export/formats";
import { formatDate } from "@/lib/format";
import { carriesLabel, codeDrawing, isRetail, midSentence, printedBeside, symbologyLabel, type CodedItem } from "@/lib/savedCodes";
import { useCollection, useSettings } from "@/lib/store/provider";
import { useTerms } from "@/lib/useTerms";
import { LabelPreview, useOrigin } from "./CodeArt";
import { codePng, codeSvg, shareOrDownload } from "./codeFiles";

/** One item's code, large, with what it is and everything that can be done with it. */
export function CodeDrawer({ item, writable, onClose, onPrint, onEdit, onDelete }: { item: CodedItem; writable: boolean; onClose: () => void; onPrint: () => void; onEdit: () => void; onDelete: () => void }) {
  const settings = useSettings();
  const terms = useTerms();
  const toast = useToast();
  const members = useCollection("members");
  const suppliers = useCollection("suppliers");
  const origin = useOrigin();
  const [busy, setBusy] = useState(false);

  const code = item.savedCode;
  const supplierName = useMemo(() => {
    const names = new Map(suppliers.map((s) => [s.id, s.name]));
    return (id: string) => names.get(id);
  }, [suppliers]);
  const drawing = codeDrawing(item, code, origin);
  const madeBy = code.createdBy ? members.find((m) => m.id === code.createdBy)?.name : undefined;

  const file = async (make: () => Promise<File>, then: (f: File) => Promise<void> | void) => {
    setBusy(true);
    try {
      await then(await make());
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };
  const share = () =>
    file(
      () => codePng(item, code, origin),
      async (f) => {
        if ((await shareOrDownload(f, `${item.sku} · ${item.name}`)) === "downloaded") toast("This browser has no share sheet, so the image was downloaded instead", "success");
      },
    );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(drawing.text);
      toast("Copied", "success");
    } catch {
      toast("Could not copy; select the text and copy it by hand", "critical");
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width={500}
      title={<span className="font-mono">{item.sku}</span>}
      subtitle={item.name}
      footer={
        <>
          {writable && (
            <Button variant="plain" icon={<Trash2 />} onClick={onDelete} className="mr-auto text-critical hover:bg-critical-soft">
              Delete
            </Button>
          )}
          {writable && (
            <Button icon={<Pencil />} onClick={onEdit}>
              Edit
            </Button>
          )}
          <Button variant="primary" icon={<Printer />} onClick={onPrint}>
            Print
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <LabelPreview item={item} code={code} origin={origin} currency={settings.currency} supplierName={supplierName} size="lg" />
        <div className="flex flex-wrap items-center gap-2">
          <Menu
            align="left"
            trigger={
              <Button icon={<Download />} loading={busy}>
                Download
              </Button>
            }
            items={[
              { label: "Image (PNG)", onSelect: () => void file(() => codePng(item, code, origin), (f) => downloadBlob(f.name, f)) },
              { label: "Vector (SVG), for artwork", onSelect: () => void file(() => codeSvg(item, code, origin), (f) => downloadBlob(f.name, f)) },
            ]}
          />
          <Button icon={<Share2 />} onClick={() => void share()} disabled={busy}>
            Share
          </Button>
        </div>
        {drawing.standIn && (
          <Banner tone="warning" title="No barcode number on this item">
            {symbologyLabel(code.symbology)} needs one. Until a number is saved on the item, this prints a Code 128 of the {midSentence(terms.itemCode)}.{" "}
            <Link href={`/inventory/${item.id}`} className="font-medium underline">
              Open the item
            </Link>
          </Banner>
        )}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-text">Reads as</span>
            <Button size="sm" variant="plain" icon={<Copy />} onClick={() => void copy()}>
              Copy
            </Button>
          </div>
          <div className="break-all rounded-[var(--radius)] border border-border bg-surface-subdued px-3 py-2 font-mono text-[12px] leading-5 text-text">{drawing.text}</div>
        </div>
        <DescriptionList
          rows={[
            { label: "Kind of code", value: symbologyLabel(code.symbology) },
            { label: "Carries", value: carriesLabel(code, terms.itemCodeShort) },
            { label: "Printed beside", value: printedBeside(code, terms.itemCodeShort) },
            ...(isRetail(code.symbology) ? [] : [{ label: "Barcode on the item", value: item.barcode ? <span className="font-mono text-[12px]">{item.barcode}</span> : "None" }]),
            { label: "Made", value: `${formatDate(code.createdAt)}${madeBy ? ` by ${madeBy}` : ""}` },
            ...(code.updatedAt ? [{ label: "Changed", value: formatDate(code.updatedAt) }] : []),
            {
              label: "Item",
              value: (
                <Link href={`/inventory/${item.id}`} className="text-accent hover:underline">
                  Open {item.sku}
                </Link>
              ),
            },
          ]}
        />
      </div>
    </Drawer>
  );
}
