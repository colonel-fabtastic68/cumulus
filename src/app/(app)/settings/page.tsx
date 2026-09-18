"use client";

import { useEffect, type ReactNode } from "react";
import { useSettings } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Banner, Page, Section } from "@/components/ui";
import {
  AboutSection,
  AgentSection,
  BillingSection,
  CatalogSection,
  CompanySection,
  DataSection,
  InventoryPolicySection,
  LocationsSection,
  QuotingSection,
  ShippingSection,
  settingsSection,
} from "@/components/workspace/settings";
import { canManageTeam } from "@/components/workspace/team";

/** One settings block. The id is the anchor search results and links point at (/settings#locations). */
function Row({ id, children }: { id: string; children: ReactNode }) {
  const def = settingsSection(id);
  return (
    <div id={id} className="scroll-mt-4 border-t border-border py-6 first:border-t-0 first:pt-0 last:pb-0">
      <Section title={def.title} description={def.description}>
        {children}
      </Section>
    </div>
  );
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

  // Links like /settings#locations (search results, help text) arrive before the sections exist,
  // so the browser's own hash scroll finds nothing. Scroll once the page has rendered.
  useEffect(() => {
    const jump = () => {
      const id = window.location.hash.slice(1);
      if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, []);

  // Forms are keyed on updatedAt so they restart from the stored values after
  // every save (or when a teammate changes settings).
  const formKey = settings.updatedAt;

  return (
    <Page narrow title="Settings" subtitle="Company details, inventory policy, Strato, your plan and where the data lives">
      {readOnly && (
        <Banner tone="info" title="Read-only" className="mb-5">
          Only owners and admins can change settings. You can still review everything here.
        </Banner>
      )}
      <div className="flex flex-col">
        <Row id="company">
          <CompanySection key={formKey} settings={settings} readOnly={readOnly} />
        </Row>
        <Row id="inventory-policy">
          <InventoryPolicySection key={formKey} settings={settings} readOnly={readOnly} />
        </Row>
        <Row id="catalog">
          <CatalogSection key={formKey} settings={settings} readOnly={readOnly} />
        </Row>
        <Row id="locations">
          <LocationsSection readOnly={readOnly} />
        </Row>
        <Row id="shipping">
          <ShippingSection key={formKey} settings={settings} readOnly={readOnly} />
        </Row>
        <Row id="quoting">
          <QuotingSection key={formKey} settings={settings} readOnly={readOnly} />
        </Row>
        <Row id="strato">
          <AgentSection key={formKey} settings={settings} readOnly={readOnly} />
        </Row>
        <Row id="billing">
          <BillingSection settings={settings} />
        </Row>
        <Row id="data">
          <DataSection settings={settings} canManage={canManage} />
        </Row>
        <Row id="about">
          <AboutSection />
        </Row>
      </div>
    </Page>
  );
}
