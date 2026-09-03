"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { useCollection } from "@/lib/store/provider";
import { useAuth, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Banner, Button, Page, PageLayout } from "@/components/ui";
import { InviteMemberModal, MembersTable, OnlineCard, RolesCard, canManageTeam } from "@/components/workspace/team";

export default function TeamPage() {
  const members = useCollection("members");
  const user = useCurrentUser();
  const { mode } = useAuth();
  const { setPageContext } = useAgent();
  const [inviting, setInviting] = useState(false);
  const canManage = canManageTeam(user);

  useEffect(() => {
    setPageContext({ page: "Team" });
  }, [setPageContext]);

  const inviteButton = canManage ? (
    <Button variant="primary" icon={<UserPlus />} onClick={() => setInviting(true)}>
      Invite teammate
    </Button>
  ) : undefined;

  return (
    <Page title="Team" subtitle="Who has access to this workspace and what they can do" primaryAction={inviteButton}>
      <div className="flex flex-col gap-4">
        {mode === "local" && (
          <Banner tone="info" title="Local mode">
            Use the avatar menu (top right) to switch between demo users and see how collaboration feels. Connect Firestore in{" "}
            <Link href="/settings" className="text-accent">
              Settings
            </Link>{" "}
            for real accounts.
          </Banner>
        )}
        <PageLayout
          aside={
            <>
              <OnlineCard members={members} />
              <RolesCard />
            </>
          }
        >
          <MembersTable members={members} onInvite={canManage ? () => setInviting(true) : undefined} />
        </PageLayout>
      </div>
      <InviteMemberModal open={inviting} onClose={() => setInviting(false)} />
    </Page>
  );
}
