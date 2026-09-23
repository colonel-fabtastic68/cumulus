"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, ImageIcon, Plus, Star, Trash2 } from "lucide-react";
import type { Item, ItemImage } from "@/lib/types";
import { updateItem } from "@/lib/inventory";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { Badge, Button, EmptyState, IconButton, TextField, useToast } from "@/components/ui";

/** Web images for the product. The first is the main image on connected stores. */
export function itemImages(item: Pick<Item, "images" | "imageUrl">): ItemImage[] {
  if (item.images?.length) return item.images;
  return item.imageUrl ? [{ url: item.imageUrl }] : [];
}

function validUrl(raw: string): string | null {
  const v = raw.trim();
  if (!/^https?:\/\/\S+$/i.test(v)) return null;
  try {
    return new URL(v).toString();
  } catch {
    return null;
  }
}

export function ImagesTab({ item, canEdit }: { item: Item; canEdit: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const images = itemImages(item);
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  const save = async (next: ItemImage[], what: string) => {
    setBusy(true);
    try {
      await updateItem(store, user, item.id, { images: next, imageUrl: next[0]?.url }, what);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const clean = validUrl(url);
    if (!clean) return toast("Enter a full image address starting with http:// or https://", "critical");
    if (images.some((i) => i.url === clean)) return toast("That image is already on the item", "critical");
    await save([...images, { url: clean, alt: alt.trim() || undefined, source: "manual" }], "Added an image");
    setUrl("");
    setAlt("");
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length) return;
    const next = [...images];
    const [img] = next.splice(from, 1);
    next.splice(to, 0, img!);
    void save(next, "Reordered images");
  };
  const remove = (idx: number) => void save(images.filter((_, i) => i !== idx), "Removed an image");

  return (
    <div className="flex flex-col gap-5">
      {canEdit && (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-surface-subdued p-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <TextField label="Image address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cdn.yourstore.com/products/part.jpg" onKeyDown={(e) => e.key === "Enter" && void add()} />
          </div>
          <div className="w-full sm:w-56">
            <TextField label="Alt text" hint="(optional)" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="What the picture shows" onKeyDown={(e) => e.key === "Enter" && void add()} />
          </div>
          <Button variant="primary" icon={<Plus />} onClick={() => void add()} loading={busy} disabled={!url.trim()}>
            Add image
          </Button>
        </div>
      )}
      {images.length === 0 ? (
        <EmptyState icon={<ImageIcon />} title="No images yet" description="Add the web addresses of product photos. New items pushed to Shopify or WooCommerce take these images, and a sync fills them in from the store when the item has none." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img, idx) => (
            <figure key={img.url} className="group relative flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
              <a href={img.url} target="_blank" rel="noreferrer" className="flex aspect-square items-center justify-center bg-surface-subdued">
                {broken.has(img.url) ? (
                  <span className="px-3 text-center text-[12px] text-text-tertiary">Could not load this image</span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- product photos live on the store's own host
                  <img src={img.url} alt={img.alt ?? item.name} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain" onError={() => setBroken((b) => new Set(b).add(img.url))} />
                )}
              </a>
              <figcaption className="flex items-center gap-1 px-2 py-1.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-text-secondary" title={img.url}>
                  {idx === 0 && (
                    <Badge tone="info" className="mr-1">
                      Main
                    </Badge>
                  )}
                  {img.alt || img.url.replace(/^https?:\/\//, "")}
                </span>
                {img.source && img.source !== "manual" && <Badge>{img.source === "shopify" ? "Shopify" : "WooCommerce"}</Badge>}
              </figcaption>
              {canEdit && (
                <div className="flex items-center justify-end gap-0.5 border-t border-border px-1 py-0.5">
                  {idx !== 0 && (
                    <IconButton variant="plain" size="sm" aria-label="Make main image" title="Make main image" onClick={() => move(idx, 0)} disabled={busy}>
                      <Star className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                  <IconButton variant="plain" size="sm" aria-label="Move earlier" title="Move earlier" onClick={() => move(idx, idx - 1)} disabled={busy || idx === 0}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton variant="plain" size="sm" aria-label="Move later" title="Move later" onClick={() => move(idx, idx + 1)} disabled={busy || idx === images.length - 1}>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton variant="plain" size="sm" aria-label="Remove image" title="Remove image" className="text-text-tertiary hover:text-critical" onClick={() => remove(idx)} disabled={busy}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              )}
            </figure>
          ))}
        </div>
      )}
      {images.length > 0 && <p className="text-[12px] text-text-tertiary">The first image is the main one on connected stores. Images are shown from their own address; nothing is uploaded here.</p>}
    </div>
  );
}
