"use client";

import { useEffect, type ReactNode } from "react";
import { useSettings } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Banner, Page, Section } from "@/components/ui";
import { AboutSection, AgentSection, CompanySection, DataSection, InventoryPolicySection } from "@/components/workspace/settings";
import { canManageTeam } from "@/components/workspace/team";

function Row({ children }: { children: ReactNode }) {
  return <div className="border-t border-border py-6 first:border-t-0 first:pt-0 last:pb-0">{children}</div>;
}

export default function SettingsPage() {
  const settings = useSettings();
  const user = useCurrentUser();
  const { setPageContext } = useAgent();
  const canManage = canManageTeam(user);
  const readOnly = !canManage;

  useEffect(() => {
    setPageContext({ page: "Settings" });
  }, [setPageContext]);

  // Forms are keyed on updatedAt so they restart from the stored values after
  // every save (or when a teammate changes settings).
  const formKey = settings.updatedAt;

  return (
    <Page narrow title="Settings" subtitle="Company details, inventory policy, Nimbus and where the data lives">
      {readOnly && (
        <Banner tone="info" title="Read-only" className="mb-5">
          Only owners and admins can change settings. You can still review everything here.
        </Banner>
      )}
      <div className="flex flex-col">
        <Row>
          <Section title="Company" description="Name, currency and timezone used across the workspace.">
            <CompanySection key={formKey} settings={settings} readOnly={readOnly} />
          </Section>
        </Row>
        <Row>
          <Section title="Inventory policy" description="How stock buckets and builds behave. Changes apply to future movements only.">
            <InventoryPolicySection key={formKey} settings={settings} readOnly={readOnly} />
          </Section>
        </Row>
        <Row>
          <Section title="Nimbus" description="Whether Nimbus may change data on its own, and whether the model is configured.">
            <AgentSection key={formKey} settings={settings} readOnly={readOnly} />
          </Section>
        </Row>
        <Row>
          <Section title="Data and backend" description="Where the workspace is stored, backups, and starting over.">
            <DataSection settings={settings} canManage={canManage} />
          </Section>
        </Row>
        <Row>
          <Section title="About" description="What this build is and where to read more.">
            <AboutSection />
          </Section>
        </Row>
      </div>
    </Page>
  );
}
