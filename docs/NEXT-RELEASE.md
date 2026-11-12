# Next release: how unreleased work ships, and where each feature stands

Written 2026-11-11 against the feature notes of 2026-10-28 (items 42 to 72).

## The release flow

| | Branch | Address | Shows unreleased features |
|---|---|---|---|
| Production | `main` | cumulusos.com | No |
| Staging | `dev` | dev.cumulusos.com | Yes |
| Local | any | localhost | Yes |

- Build on `dev`. Every push deploys to dev.cumulusos.com (a Vercel branch domain on the same project).
- Every new feature is registered in `src/lib/features.ts` with a status:
  - `planned`: data model and logic only, nothing on screen.
  - `preview`: on in staging and local, hidden in production.
  - `beta`: as preview, and a production workspace can switch it on in Settings → Labs.
  - `released`: on for everyone.
- Because production hides anything in preview, **`dev` can be merged into `main` at any time**. Merge often so the branches never drift; unfinished features ride along switched off.
- To release a feature, change its status to `released` (or `beta` to let pilot customers opt in first), merge, done. Later, delete the flag and its checks.
- `CUMULUS_FEATURES=workOrders,jobs` (or `*`) on a deployment forces features on there, for a pilot customer's instance.
- Settings → Labs lists the features with a switch per workspace, so a feature can be switched off in staging to compare with today's product.
- Staging has no database configured: it runs the sample company in the browser, so demos cannot touch customer data. A staging bar across the top says so.

### Gating a new feature

```tsx
const enabled = useFeature("workOrders");        // one flag
const features = useFeatures();                   // several
```

Server routes use `serverFeatureEnabled("documentEmail", settings.features)`.

Fields that belong to a feature are optional on the types, so existing workspaces need no migration, and a form only writes them while the feature is on.

## Where each item stands

Status: **Built** = working on staging behind its flag. **Framework** = data model and tested logic, with the first screen. **Planned** = waiting on a decision.

| # | Note | Flag | Status | Where |
|---|---|---|---|---|
| 42 | LTL / freight | `freight` | Planned | Waiting on Mitch's idea. |
| 43, 64 | QuickBooks Desktop, accounting sync | `quickbooksDesktop` | Framework | Exports → QuickBooks Desktop writes an IIF file (invoices for shipped orders, bills for received deliveries). `src/lib/accounting/iif.ts`. Not yet test-imported into a real company file. |
| 44 | Modular BOMs | `modularBoms` | Built | Item → BOM: each line is Required, Optional or a Choice (alternatives share a name). The build dialog and work orders ask for the options. `src/lib/bomOptions.ts`. |
| 45 | Part numbers instead of SKUs | `partNumbers` | Built (partial) | Settings → Catalog: what an item code is called. Applied to Inventory, item form, order forms and details, prints, labels, emails. Other screens still say SKU: sweep them with `useTerms()`. |
| 46 | Enter PN, Enter qty, next line | `fastLineEntry` | Built | Sales and purchase order forms. `QuickLineEntry.tsx`. |
| 48 | Pick lists, BOMs as parts | `pickLists` | Built | Order → Pick list (optionally assemblies as parts), build dialog, work order. Sorted by location and bin. "Pick as parts" on an assembly's edit form. `src/lib/pickList.ts`. |
| 49 | Larger order screens | `largeOrderForms` | Built | Order and PO forms and details open near full width. |
| 50 | Location per order line | `lineLocations` | Built | Sales order form: "Ship from" per line. Shipping relieves that location. |
| 51 | Work orders, WIP, schedule | `workOrders` | Built (first version) | BOM → Work orders. Plan, release, complete; parts needed against stock; weekly schedule; parts committed. `src/lib/workOrders.ts`. |
| 53 | Overstock flags | `overstock` | Built | Inventory: Over chip, Overstock view, value above max. `src/lib/overstock.ts`. |
| 55 | Seasonality by PN or category | `seasonalityFilters` | Built | Reports → Seasonality. |
| 56 | MAP pricing column | `mapPricing` | Built | Item form, Inventory MAP column (red when the price is under it). |
| 57 | Unit conversions | `unitConversions` | Framework | Item form: other units, buy-in and sell-in units. Sales order lines can be entered in another unit. Purchase orders and receiving do not use them yet. `src/lib/units.ts`. |
| 58 | Email POs and SOs | `documentEmail` | Built | Order and PO details → Email. Hosted workspaces send through Resend; otherwise the message opens in the person's mail app. `/api/email/document`. |
| 59 | Period close | `periodLocks` | Built | Settings → Inventory policy → Period close. The ledger refuses movements dated into a closed period. Owners and admins close and reopen. |
| 59 | Restore a single record | `recordRestore` | Planned | Time Machine already takes daily snapshots; restoring one record from a snapshot is not built. |
| 60 | Print orders and BOMs | `printDocuments` | Built | Sales order Print / PDF (purchase orders already had it). BOM with bins prints as a pick list. |
| 61 | Reports subtitle | none | Done | "aging" (US spelling). |
| 62 | Customer export | `customerExport` | Built | Customers → Export. |
| 63 | Automated cost updates | none | Skipped | Moonshot. |
| 65 | Jobs and projects | `jobs` | Built (first version) | Jobs: crew (team or contractors), linked orders, purchases and work orders, revenue, cost, budget. `src/lib/jobs.ts`. |
| 66 | Item variants | `variants` | Framework | Item → Variants: options make the combinations, each a real item underneath; Inventory shows the family as one row. Store sync does not group them yet. `src/lib/variants.ts`. |
| 67 | Customizable labels | `labelFields` | Built | Labels: choose what the details line carries (category, bin, vendor PN, supplier, fitment). UPC and QR were already there. |
| 68 | Competitor comparison | none | Not code | A research project. |
| 69 | Reset filters | `resetFilters` | Built (Inventory) | Other lists to follow. |
| 70 | Rename / merge categories | `categoryTools` | Built | Settings → Catalog → Categories. |
| 71 | On order column | `onOrderColumn` | Built | Inventory; links to the open purchase orders for the part. |
| 72 | Labels from a PO or packing slip | `receiptLabels` | Built (PO) | Purchase order → Labels: one per unit received. From a receipt is the next step. |

## Decisions that are still open

1. **Who can open staging.** Vercel puts preview deployments behind a Vercel login. Either switch that off for this project (the repo is public and staging has no database, so little is protected) or keep it private to Vercel team members.
2. **Staging data.** Today: sample data in the browser. A shared staging database (real sign-in, persistent data, integration tests) needs its own Firestore database and env vars on the `dev` branch.
3. **WIP.** Work orders take parts out of stock when units are completed (backflush). Issuing parts to the floor at the start, with WIP as its own stock bucket, is the alternative.
4. **Variants.** Each combination is a real item with an automatic code. If a customer wants no codes at all, stock per option would have to live on one item, which is a ledger change.
5. **Period close.** Gated by role (owner, admin). The note asked for an admin password; a second confirmation with the person's own password can be added.
6. **Freight.** Needs Mitch's idea before anything is designed.

## Known gaps before release

- Strato has no tools for work orders, jobs, variants or modular BOMs yet.
- The data exports (Exports → Data) do not include work orders or jobs.
- Purchase orders are not unit-aware; receiving in a case and stocking in eaches still needs the conversion by hand.
- QuickBooks Desktop IIF needs a test import; item list export is not included.
- Logic checks for the new libraries were run from a scratch script; the repo has no test runner yet.
