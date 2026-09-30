/** Opens a print view; the browser's print dialog offers Save as PDF. Returns false when pop-ups are blocked. */
export function openPrintWindow(title: string, bodyHtml: string, extraCss = ""): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:12px/1.45 -apple-system,Inter,Segoe UI,sans-serif;color:#1a1a1a;margin:28px}
h1{font-size:20px;margin:0 0 2px}.muted{color:#666}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #cfcfcf;padding:6px 7px;text-align:left;vertical-align:middle}th{background:#f3f3f3;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}
.n{text-align:right;white-space:nowrap}.box{display:inline-block;width:14px;height:14px;border:1.5px solid #1a1a1a;border-radius:3px;vertical-align:middle}
.blank{display:inline-block;min-width:64px;border-bottom:1px solid #1a1a1a;height:16px}tr{page-break-inside:avoid}@page{margin:12mm}
${extraCss}</style></head><body>${bodyHtml}<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},200)})</script></body></html>`);
  w.document.close();
  return true;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
