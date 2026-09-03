"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Tiny Markdown renderer for agent replies: headings, paragraphs, bold,
 * italic, inline code, fenced code, lists, GFM tables and links.
 * No dependency, no HTML passthrough.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`prose-sm text-[13px] leading-[1.5] ${className ?? ""}`}>{renderBlocks(text)}</div>;
}

function renderBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    // fenced code
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) buf.push(lines[i++]!);
      i++;
      out.push(
        <pre key={key++} className="my-1.5 overflow-x-auto rounded-[6px] bg-surface-hover p-2.5 font-mono text-[12px]">
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }
    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const cls = level <= 2 ? "mt-2 mb-1 text-[14px] font-semibold" : "mt-2 mb-0.5 text-[13px] font-semibold";
      out.push(
        <div key={key++} className={cls}>
          {renderInline(h[2]!)}
        </div>,
      );
      i++;
      continue;
    }
    // table
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(splitRow(lines[i++]!));
      out.push(
        <div key={key++} className="my-1.5 overflow-x-auto">
          <table>
            <thead>
              <tr>
                {header.map((c, j) => (
                  <th key={j}>{renderInline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, j) => (
                    <td key={j}>{renderInline(r[j] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    // lists
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) {
        let item = lines[i]!.replace(/^\s*([-*+]|\d+[.)])\s+/, "");
        i++;
        // continuation lines (indented)
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) item += " " + lines[i++]!.trim();
        items.push(item);
      }
      const Tag = ordered ? "ol" : "ul";
      out.push(
        <Tag key={key++}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    // blockquote
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) buf.push(lines[i++]!.replace(/^>\s?/, ""));
      out.push(
        <blockquote key={key++} className="my-1.5 border-l-2 border-border-strong pl-2.5 text-text-secondary">
          {renderInline(buf.join(" "))}
        </blockquote>,
      );
      continue;
    }
    // paragraph
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6})\s/.test(lines[i]!) && !lines[i]!.trim().startsWith("```") && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!) && !(lines[i]!.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!))) {
      buf.push(lines[i++]!);
    }
    out.push(<p key={key++}>{renderInline(buf.join(" "))}</p>);
  }
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;

export function renderInline(text: string): ReactNode {
  const parts = text.split(INLINE);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if ((p.startsWith("*") && p.endsWith("*")) || (p.startsWith("_") && p.endsWith("_"))) return <em key={i}>{p.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    if (link) {
      return (
        <a key={i} href={link[2]} className="text-accent underline" target={link[2]!.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}
