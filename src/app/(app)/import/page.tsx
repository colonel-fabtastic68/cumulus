"use client";

import { Suspense, useEffect, useState } from "react";
import { Plug } from "lucide-react";
import { Banner, Button, Page, QueryParamEffect } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { ImportWizard } from "@/components/import/ImportWizard";
import { CustomerImport } from "@/components/customers";
import { WebsiteImport } from "@/components/import/WebsiteImport";
import { APP_HOME } from "@/lib/auth-routes";

export default function ImportPage() {
  const { setPageContext } = useAgent();
  const user = useCurrentUser();
  const [onboarding, setOnboarding] = useState(false);

  useEffect(() => {
    setPageContext({ page: "Import" });
  }, [setPageContext]);

  return (
    <Page
      title="Import"
      subtitle="Bring in items or customers from a spreadsheet or a store export"
      secondaryActions={
        <Button icon={<Plug />} href="/integrations">
          Integrations
        </Button>
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="onboarding" onValue={() => setOnboarding(true)} />
      </Suspense>
      {onboarding && (
        <Banner tone="info" title="Your workspace is ready. Bring your catalog in first?" className="mb-5" action={<Button href={APP_HOME}>Skip for now</Button>}>
          Paste your website below and your items appear in a minute. You can also upload a spreadsheet, or start empty and add items as you go.
        </Banner>
      )}
      <div className="mb-6">
        <WebsiteImport onboarding={onboarding} />
      </div>
      {!canWrite(user) && (
        <Banner tone="warning" title="You have view-only access">
          You can walk through the wizard and preview the mapping, but importing items needs a member, admin or owner role.
        </Banner>
      )}
      <ImportWizard />
      <div id="customers" className="mt-6 scroll-mt-4">
        <CustomerImport />
      </div>
    </Page>
  );
}
