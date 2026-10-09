import { authenticate, jsonError, loadConnected } from "@/lib/integrations/server";
import { wooCreds } from "@/lib/integrations/channelSync";
import { listProducts } from "@/lib/integrations/woocommerce";
import { requireRanch } from "@/lib/ranch/bridge";

export const maxDuration = 60;

/** The store's products, for linking pack listings to them (read-only). */
export async function GET(req: Request) {
  try {
    const ctx = await authenticate(req);
    requireRanch(ctx);
    const { integration, secrets } = await loadConnected(ctx, "woocommerce");
    const rows = await listProducts(await wooCreds(ctx, integration, secrets));
    const products = rows.map(({ product, variation }) => ({
      productId: String(product.id),
      variationId: variation ? String(variation.id) : undefined,
      name: variation ? `${product.name} – ${(variation.attributes ?? []).map((a) => a.option).filter(Boolean).join(" / ") || variation.sku}` : product.name,
      sku: (variation?.sku || product.sku || "").trim(),
      price: Number((variation ?? product).regular_price || (variation ?? product).price) || 0,
      stock: (variation ?? product).stock_quantity ?? null,
      status: product.status,
    }));
    return Response.json({ products });
  } catch (e) {
    return jsonError(e);
  }
}
