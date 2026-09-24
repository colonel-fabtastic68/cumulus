export interface SettingsSectionDef {
  /** Anchor on the settings page: /settings#<id>. */
  id: string;
  title: string;
  description: string;
  /** Extra words the section answers to in the top-bar search. */
  keywords?: string;
}

/** The sections of the Settings page, in page order. Search links to them by id. */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: "company", title: "Company", description: "Name, currency and timezone used across the workspace.", keywords: "name currency timezone" },
  { id: "inventory-policy", title: "Inventory policy", description: "How stock buckets and builds behave. Changes apply to future movements only.", keywords: "in use bucket relieve build fulfill inactivity dead stock" },
  { id: "catalog", title: "Catalog", description: "Your own item types, customer price groups, and custom fields for items, customers and suppliers.", keywords: "item types price groups dealer distributor custom fields attributes" },
  { id: "locations", title: "Locations", description: "Warehouses, stores, trucks and trailers that hold stock. Transfers move stock between them.", keywords: "warehouse store truck trailer bins" },
  { id: "shipping", title: "Shipping and scanning", description: "Ship-from address and default parcel for carrier rates, and keyboard scanner behavior.", keywords: "parcel address carrier barcode scanner wedge" },
  { id: "quoting", title: "Quoting", description: "Labor rate, margins, tax and terms that every quote starts from.", keywords: "labor margin tax terms quotes" },
  { id: "strato", title: "Strato", description: "Whether Strato may change data on its own, and whether the model is configured.", keywords: "agent auto approve gemini model api key" },
  { id: "billing", title: "Plan and billing", description: "Your plan, what it includes, and where invoices and card details are managed.", keywords: "subscription price founding members invoice stripe payment upgrade" },
  { id: "time-machine", title: "Time Machine", description: "Snapshots of the whole workspace, taken daily and on demand, that you can roll back to.", keywords: "backup restore snapshot revert history undo rollback" },
  { id: "data", title: "Data and backend", description: "Where the workspace is stored, backups, and starting over.", keywords: "firestore local backup reset" },
  { id: "about", title: "About", description: "What this build is and where to read more.", keywords: "version docs" },
];

export function settingsSection(id: string): SettingsSectionDef {
  const s = SETTINGS_SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown settings section: ${id}`);
  return s;
}
