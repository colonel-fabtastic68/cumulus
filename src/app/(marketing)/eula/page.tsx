import type { Metadata } from "next";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "End user license agreement · cumulusOS",
  description: "The license under which cumulusOS is made available to the people and companies who use it.",
};

export default function EulaPage() {
  return (
    <LegalPage
      title="End user license agreement"
      updated="16 September 2026"
      intro="This agreement is between cumulusOS and the person or company using the software. It sets out what you may do with cumulusOS, what we keep, and what happens if things go wrong. It sits alongside our terms of service, which cover accounts and subscriptions, and our privacy policy, which covers personal data."
    >
      <LegalSection heading="License">
        <p>While your subscription is active and you follow this agreement, we grant you a personal, non-exclusive, non-transferable right to use cumulusOS as a hosted service, for your own business. Everyone you invite to your workspace is covered by the same license, and you are responsible for what they do with it.</p>
      </LegalSection>

      <LegalSection heading="What you may not do">
        <LegalList
          items={[
            "Copy, sell, rent, sublicense or host the software for anyone outside your own business.",
            "Reverse engineer, decompile or try to extract the source, except where the law expressly allows it.",
            "Remove or obscure any notice of ownership.",
            "Use the service to break the law, infringe rights, or store data you have no right to hold.",
            "Probe, overload or interfere with the service, or bypass its limits and security.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Ownership">
        <p>cumulusOS, its interface, code and documentation stay ours. This agreement grants a right to use the service, not any ownership of it. Feedback you send us may be used to improve the product without obligation to you.</p>
      </LegalSection>

      <LegalSection heading="Your data">
        <p>The records you and your team enter remain yours. You allow us to store and process them only to provide the service. You can export everything at any time from the Exports page, and our privacy policy explains how personal data is handled.</p>
      </LegalSection>

      <LegalSection heading="Connected services">
        <p>cumulusOS can connect to services you already use, including QuickBooks Online, Shopify, WooCommerce and shipping carriers. When you authorize a connection, you permit us to read and write the data that connection needs, on your behalf and at your direction. Those services are run by their own providers under their own terms, and we are not responsible for their availability or for the accuracy of data they return.</p>
      </LegalSection>

      <LegalSection heading="Automated suggestions">
        <p>Strato, the assistant built into cumulusOS, drafts changes from your own records. Its output can be wrong, so it asks for approval before writing anything unless you turn that off. The person who approves a change is responsible for it, and important figures should be checked before you act on them.</p>
      </LegalSection>

      <LegalSection heading="Fees">
        <p>Access to a workspace depends on an active subscription. Prices, renewals and cancellation are set out in the terms of service.</p>
      </LegalSection>

      <LegalSection heading="Term and termination">
        <p>This license runs while you use cumulusOS. It ends when your subscription ends, when you stop using the service, or if we end it because this agreement has been broken. On termination your right to use the software stops; export your data first, and we will give you a reasonable chance to do so.</p>
      </LegalSection>

      <LegalSection heading="Warranties and liability">
        <p>The software is provided as it is, without warranties beyond those the law requires, and we do not promise it will be uninterrupted or error-free. To the extent the law allows, we are not liable for lost profits, lost data or indirect losses, and our total liability for any claim is limited to the fees you paid in the 12 months before it arose.</p>
      </LegalSection>

      <LegalSection heading="Changes, law and contact">
        <p>We will announce material changes to this agreement in the app before they take effect. It is governed by the laws of the state where cumulusOS is established, and the courts there handle any dispute. Questions go to legal@cumulusos.com.</p>
      </LegalSection>
    </LegalPage>
  );
}
