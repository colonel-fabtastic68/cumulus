"use client";

import { useEffect } from "react";
import { Plug } from "lucide-react";
import { Banner, Button, Page } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { ImportWizard } from "@/components/import/ImportWizard";

export default function ImportPage() {
  const { setPageContext } = useAgent();
  const user = useCurrentUser();

  useEffect(() => {
    setPageContext({ page: "Import" });
  }, [setPageContext]);

  return (
    <Page
      title="Import"
      subtitle="Bring in items from a spreadsheet, Shopify or WooCommerce export"
      secondaryActions={
        <Button icon={<Plug />} href="/integrations">
          Integrations
        </Button>
      }
    >
      {!canWrite(user) && (
        <Banner tone="warning" title="You have view-only access" className="mb-4">
          You can walk through the wizard and preview the mapping, but importing items needs a member, admin or owner role.
        </Banner>
      )}
      <ImportWizard />
    </Page>
  );
}
