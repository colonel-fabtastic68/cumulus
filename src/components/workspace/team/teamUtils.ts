import type { Member, MemberRole } from "@/lib/types";

/** Small palette for new avatars. Matches the colours used by the seed and Firebase sign-up. */
export const MEMBER_COLORS = ["#1f5f8b", "#7a3e9d", "#2e7d4f", "#b5541c", "#8b1f4f", "#3e6b9d", "#5c7a1f"];

export const ROLE_OPTIONS: Array<{ value: MemberRole; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: "Everything, including settings, data reset and billing. There must always be at least one.",
  admin: "Everything an owner can do except removing the last owner. Manages the team and settings.",
  member: "Day-to-day work: receive, build, ship, adjust stock, edit items, run the agent.",
  viewer: "Read-only. Can browse inventory, reports and activity but cannot change anything.",
};

export function roleLabel(role: MemberRole): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
}

/** Owners and admins manage the team. */
export function canManageTeam(member: Pick<Member, "role">): boolean {
  return member.role === "owner" || member.role === "admin";
}

/** Pick the palette colour used least by the current members. */
export function pickMemberColor(members: Array<Pick<Member, "color">>): string {
  const counts = new Map<string, number>(MEMBER_COLORS.map((c) => [c, 0]));
  for (const m of members) if (counts.has(m.color)) counts.set(m.color, (counts.get(m.color) ?? 0) + 1);
  let best = MEMBER_COLORS[0]!;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of MEMBER_COLORS) {
    const n = counts.get(c) ?? 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
