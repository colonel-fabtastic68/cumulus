import type { Metadata } from "next";
import { JoinInvite } from "@/components/auth/JoinInvite";

export const metadata: Metadata = { title: "Join a workspace · Cumulus" };

export default async function JoinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JoinInvite id={id} />;
}
