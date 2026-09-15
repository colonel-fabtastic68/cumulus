const AVATAR_COLORS = ["#1f5f8b", "#7a3e9d", "#2e7d4f", "#b5541c", "#8b1f4f", "#3e6b9d", "#5c7a1f"];

/** A stable avatar colour for an id. Shared by the browser and the server. */
export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
