"use client";

import { useEffect } from "react";
import { Plug } from "lucide-react";
import { Banner, Button, Page } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { ImportWizard } from "@/components/import/ImportWizard";
import { CustomerImport } from "@/components/customers";

export default function ImportPage() {
  const { setPageContext } = useAgent();
  const user = useCurrentUser();

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
