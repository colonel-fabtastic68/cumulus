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
- Since 2026-11-25 every feature the table marks Built is `released`: on for every workspace, with no switch. Serial numbers (`serials`) stays `beta`: off on cumulusos.com until a workspace switches it on in Settings → Labs. Since 2026-11-26 four more are `beta` the same way: upload a purchase order (`poUpload`), saved barcodes (`savedCodes`), New assembly on the BOM page (`newAssembly`) and Strato's on-screen guide (`stratoGuide`). The Framework ones (connectors, variants, unit conversions, QuickBooks Desktop) stay `preview`. The released flags and their `useFeature` checks are still in the code; deleting them is the next cleanup.
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

### Strato and unreleased features

Strato never loads a feature's records into its prompt. It gets one summary line per feature (`src/lib/agent/context.ts`) and reads detail through tools that run in the browser.

- A tool, report or parameter that belongs to an unreleased feature is registered in `src/lib/agent/tools.ts` (`TOOL_FEATURES`, `TOOL_FEATURE`, `REPORT_FEATURE`) and is only declared to the model while the feature is on. `agentToolsFor({})` returns exactly the released declarations, so a workspace without the feature pays nothing for it. The MCP endpoint lists tools the same way.
- The chat sends the features that are on for the workspace; `/api/agent` keeps only those this deployment allows, and adds that feature's paragraph of guidance to the prompt.
- Today: `saveWorkOrder`, `saveJob`, `createVariants`; the `workOrders`, `productionSchedule` and `jobs` reports; `choose` / `withOptional` on `explodeBom`, `buildAssembly` and `saveWorkOrder`; line roles on `updateBom`. `getItem` returns variants, BOM options, other units and MAP whenever an item has them.
- With all four features on, the declarations are about 13% larger than the released set. Prefer a new report or parameter on an existing tool over a new tool.
- When a feature is released, move its entries out of the feature maps and delete the pruning for it in `agentToolsFor`.

## Where each item stands

Status: **Built** = working and released to everyone (serial numbers: behind its Labs switch; saved barcodes: on staging only). **Framework** = data model and tested logic, with the first screen. **Planned** = waiting on a decision.

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
| none | Order connectors (email, phone, text) | `connectors` | Framework | Orders → Connectors. Channels: any number of inboxes, one phone line (ElevenLabs voice, Gemini understanding) and one text line, each saved with what it is read for and how it replies. Intake: messages added by hand are read into order lines against the catalog (`src/lib/intake.ts`) and open the new-order form filled in. Nothing reads a mailbox, answers a call or sends a text yet: channels save as "Not live yet". `src/lib/connectors.ts`. |
| none | Upload a purchase order | `poUpload` | Built (first version, beta) | Purchase orders → New purchase order now opens a menu: Upload a document, or Enter manually. A PDF, photos of the pages, or a spreadsheet opens beside a review pane at once; Strato fills the pane in (`/api/purchase-orders/read`), and a sheet that already is a table of part numbers and quantities is read in the browser with no model call. A line is filled in only when a printed code is exactly one item's SKU, supplier part number, barcode or cross-reference; a look-alike name or a superseded part's replacement is offered as a one-click suggestion. Every line has to be settled (pick the item, add it as new, or leave it off) before Add purchase order is enabled, and nothing is written until then. The pane shows the cost on file beside a changed cost, a unit that differs from the stocking unit, a PO number already in use, and the document's total against the lines. A part number matched by hand can be saved on the item as that supplier's, so the next document matches on its own. The light model reads first (about two seconds); a reading whose arithmetic does not agree with the printed totals, or that is empty or hard to read, is read again by the main model. `src/lib/poUpload.ts`, `UploadPurchaseOrder.tsx`. Not yet: several orders in one upload, keeping the uploaded file with the order, shipping and tax lines, unit conversion (a case against eaches is flagged, not converted), a Strato chat tool. |
| none | Inventory list remembers where you were (Mitch) | `inventoryPageFixes` | Built | Inventory: search, filters, view, sort and page are kept for the browser tab when you open an item and come back; a Rows per page choice in the footer is remembered in the browser (`stateKey` / `pageSizeKey` on `Table`). A location filter lists every item that lives there (stock or bin there, routed there, or unrouted with no stock elsewhere for the default location), not only items with stock. Without the flag too: Updated sorts newest first on the first click (`firstSortDir`), and bulk edit's "Location" text box is now labeled Bin / shelf, with the real location under it; the category, supplier and location filters always offer All, so a filter can be set back without Reset. |
| none | Assemblies without parts on the BOM page (Mitch) | `assembliesWithoutBom` | Built | BOM: active assemblies with no parts yet are listed too, marked No parts yet with an Add parts button that opens the item's BOM tab; a filter (All / Ready to build / No parts yet) shows when any exist. Before, an imported or new assembly without parts did not appear on the BOM page at all. `AssembliesTable.tsx`. |
| none | New assembly from the BOM page | `newAssembly` | Built (beta) | BOM → New assembly opens the item form with the type set to Assembly; saving goes straight to the new item's BOM tab to list its parts. An empty BOM page offers the same button. Without the flag too: Build assembly and New work order list items that match the search but cannot be built yet (not an assembly, no parts yet, inactive, superseded) with the reason, and picking one says what to set up with a button to its BOM tab; before, the search said No matching items. `BuildSetupNotice.tsx`, `buildBlocker` in `buildUtils.ts`. |
| none | Serial numbers (Mitch, phase 1 of raw material → finished unit) | `serials` | Built (first version) | Item → Production: "Give each unit its own serial number" and the number format. Releasing a work order creates one serial per unit; completing it books one build per unit, so each serial is its own one-unit batch with its own cost; numbered parts it consumed are recorded as built into it. Shipping a serial-tracked item always ships finished units (never relieves components on fulfillment) and records which serials went to which customer. BOM → Serial numbers lists them; each has a record page with what went into it (parts, batches, child serials), cost and a dated history with notes. `src/lib/serials.ts`. Not yet: choosing serials by hand when shipping or finishing, serials for bought-in parts at receiving, scrapping, Strato tools. |
| none | Work order steps (Mitch, phase 1) | `workOrderSteps` | Built (first version) | Item → Production → Standard steps (name, where, outside, days), copied onto each work order at release with planned dates laid end to end from the start date. Work order → Steps: start, finish or skip the current step, add or remove steps; the list's Step column says "In Weld (Fab bay) since …" or "At Powder coat, due back …". Each step lands in the run's serials' history. `src/lib/workOrderSteps.ts`. Work centers are names for now; rates, labor time and outside-step purchase orders are phase 2. |
| none | Edit rows and parts lists on import (Mitch) | `importEditing` | Built | Import → Items → Review: click a row to change it in a side panel (SKU, name, part or assembly, category, unit, quantity, cost, price, bin, supplier); tick rows and Mark as assembly / Mark as part / Remove from import (and bring them back); Add a part for something the file is missing; the action bar and column headers stay pinned while scrolling (`lockToolbar` on `Table`); an assembly gets its parts list from this file's rows or inventory. Components are created first, then linked; unknown SKUs, an assembly in its own list and loops are refused per row. `src/lib/importBoms.ts`, `RowEditor.tsx`. Strato does not set parts lists on import yet. |
| none | Saved barcodes, and barcodes on pick lists | `savedCodes` | Built (beta) | Labels & barcodes opens on a list of the codes made for each item, laid out like Inventory: search, Square codes / Bars tabs, kind and category filters, tick boxes, column layout. New codes walks through four steps in the guided setup's frame (which items, what kind of code, what is printed beside it, review and save). A row opens that item's code: download as PNG or SVG, share, copy what it reads as, edit, delete, print. Ticked rows: Print (label stock, copies, skip used positions; print, PDF, share or file under Documents), Export (PDF sheet, PNG images, CSV list), Share, Edit (one setting applied to all), Delete. One code per item, kept on the item as `savedCode` (`src/lib/savedCodes.ts`); a sheet can mix kinds (`perEntry` on `LabelSpec`). A pick list prints each part's saved code in a Barcode column, bars up to 44 mm wide, a QR code when the bars would be too fine to scan (`pickCodeArt` in `src/lib/pickList.ts`). The old sheet designer is at Other labels (`/exports/labels/sheet`) for locations, suppliers, batches and a purchase order's quantities. Links from Inventory and an item page tick those items in the list, or start the steps with them when they have no code yet. Not yet: Strato tools for saved codes, codes for locations or batches in the list, a custom label size in the print dialog. |
| none | Strato shows you around | `stratoGuide` | Built (first version, beta) | Strato's app map also says what a switched-on feature adds to its page (`FEATURE_NOTES` in `src/lib/guide.ts`: upload a purchase order, New assembly, saved barcodes) and lists the Labs switches that are off, so it sends people to Settings › Labs instead of the long way round. Ask Strato where something is or how to do it: it answers with the path and, with the flag on, lights up the sidebar entry, button, tab or settings section step by step with a note (showOnScreen tool; controls carry `data-guide` ids, conventions at the top of `src/lib/guide.ts`; `src/components/guide/GuideProvider.tsx`). Flag or not, Strato's prompt now carries a map of the app and names the screen the user is on and the guide step they reached. Not yet: phone layouts (the sidebar is behind the menu), targets inside most dialogs. |
| none | Sign-in codes (email as a second step, for the Intuit app review) | `signInCodes` | Built, not yet tried against a live account | After the password, every sign-in lands on `/verify-email` and asks for a 6-digit code emailed to the account; the same page new accounts already use. Sign-ins by emailed link and guests are not asked. The server refuses a password session on every API route (and the QuickBooks socket) until its code is entered: `secondStepFor` in `src/lib/server/signInCodes.ts`, called from `authenticate` and `authenticateAccount`. Verified sessions are kept by `auth_time` in `signInSessions/{uid}` (server only). An account-level flag, so it is not in Settings → Labs and staging (no accounts) cannot show it: switch it on for a deployment with `CUMULUS_FEATURES=signInCodes`, and it needs `RESEND_API_KEY`. Not done: `firestore.rules` does not check the code, so the browser's direct Firestore reads are held back by the app, not by the rules. |
| none | reCAPTCHA on sign-up, sign-in and password reset | none (switched on in the Firebase console) | Built, not yet tried with enforcement on | The account pages load the project's reCAPTCHA settings (`prepareRecaptcha` in `src/lib/store/firestore.ts`); the Firebase SDK then attaches a reCAPTCHA token to password sign-up, sign-in and reset, and Firebase itself refuses calls without one. Does nothing until bot protection is enabled for the project: Firebase console → Authentication → Settings → Fraud prevention → reCAPTCHA, email/password provider, Audit first, then Enforce. |
| none | Live QuickBooks sync over a WebSocket | `quickbooksLiveSync` | Built, socket not yet tried on Vercel | Integrations → QuickBooks → Sync now shows each step as it happens. `wss://…/api/integrations/quickbooks/live`: the browser sends its ID token as the first message (never in the address), then asks for one sync; same checks as the HTTP sync route. The conversation is `src/lib/integrations/liveSocket.ts`. `next dev` cannot upgrade connections, so locally (and anywhere the socket fails before a sync starts) the button uses the ordinary sync request. |

## Decisions that are still open

1. **Who can open staging.** Vercel puts preview deployments behind a Vercel login. Either switch that off for this project (the repo is public and staging has no database, so little is protected) or keep it private to Vercel team members.
2. **Staging data.** Today: sample data in the browser. A shared staging database (real sign-in, persistent data, integration tests) needs its own Firestore database and env vars on the `dev` branch.
3. **WIP.** Work orders take parts out of stock when units are completed (backflush). Issuing parts to the floor at the start, with WIP as its own stock bucket, is the alternative.
4. **Variants.** Each combination is a real item with an automatic code. If a customer wants no codes at all, stock per option would have to live on one item, which is a ledger change.
5. **Period close.** Gated by role (owner, admin). The note asked for an admin password; a second confirmation with the person's own password can be added.
6. **Freight.** Needs Mitch's idea before anything is designed.

## Known gaps before release

- Connectors has no server side: no mailbox sign-in, no phone number or voice agent, no text gateway, and Strato has no tool for the intake queue ("Hand to Strato" pastes the message into the chat). The handling rules are saved but nothing acts on them yet.
- Strato covers work orders, jobs, variants and modular BOMs (see below). It has no tools yet for unit conversions on order lines, period close, pick lists, document email or the QuickBooks Desktop export.
- The data exports (Exports → Data) do not include work orders or jobs.
- Purchase orders are not unit-aware; receiving in a case and stocking in eaches still needs the conversion by hand.
- QuickBooks Desktop IIF needs a test import; item list export is not included.
- Logic checks for the new libraries were run from a scratch script; the repo has no test runner yet.
