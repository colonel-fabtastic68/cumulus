<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on cumulusOS

cumulusOS is inventory management for small manufacturers and parts sellers: items, BOMs, receiving, purchase and sales orders, transfers, returns, reports, and an in-app agent called Strato. Next.js 16 App Router, React 19, Tailwind v4, TypeScript. Read this file, then [docs/NEXT-RELEASE.md](docs/NEXT-RELEASE.md) for what is being built now. [README.md](README.md) has the feature tour.

## Run it

```bash
npm install
npx next dev -p 3001
```

With no `.env.local` the app runs in **local mode**: no accounts, no database, data in the browser's localStorage, seeded with a sample company (Halcyon Audio). That is all you need to build and test a feature. Open http://localhost:3001/home. Settings → Data resets the sample company.

- Strato (the chat) needs `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local` (your own key from https://aistudio.google.com/apikey). Everything else works without it.
- Do not set the `FIREBASE_*` variables. They point the app at the live database; local mode is the right place to try things.
- Next allows one `next dev` per folder. Stop the running one before starting another.
- `.claude/launch.json` has `cumulus-local` (all unreleased features on), `cumulus-local-staging`, and `cumulus-local-production` (what customers see today).

## Branches: where your work goes

| Branch | Deploys to | Who changes it |
|---|---|---|
| `main` | cumulusos.com, live customers | Baker only |
| `dev` | dev.cumulusos.com, staging with sample data | Merged pull requests |
| `yourname/short-topic` | Its own preview URL | You |

1. `git switch dev && git pull`, then `git switch -c yourname/short-topic`.
2. Build the feature. Commit in small steps with a plain subject line that says what changed.
3. Before pushing: `npx tsc --noEmit`, `npx eslint .`, `npx next build`. All three must pass. There is no test runner yet.
4. `git push -u origin yourname/short-topic`, then open a pull request **into `dev`**, never into `main`. Say what the feature does, how to reach it on screen, and what you did not finish.

**Never push to `main` and never merge into it.** A push to `main` goes straight to customers.

## Rules that are not negotiable

- **The repository is public.** Never commit a key, token, password, service-account file, `.env.local`, customer name, or customer data. If one lands in a commit, stop and tell Baker; deleting it in a later commit does not remove it.
- **No made-up data in the product.** No placeholder customers, fake numbers or lorem ipsum on a screen. The sample company in `src/lib/seed.ts` is the only demo data.
- **Stock only moves through the ledger.** Never write `onHand` directly. Use the functions in `src/lib/inventory.ts` (`adjustStock`, `receiveStock`, `buildAssembly`, `createOrder`, `shipOrder`); each one writes a movement with a running balance.
- **Every new feature goes behind a flag** (next section), so `dev` can be merged to `main` at any time without showing customers something unfinished.
- **US English**, plain words, sentence case. No uppercase eyebrow labels. Money with two decimals in the workspace currency.
- Do not change `firestore.rules`, billing, authentication, the integrations under `src/lib/integrations/`, or anything under `src/app/api/admin/` without Baker asking for it.

## Adding a feature

1. **Register a flag** in `src/lib/features.ts` with status `preview` (on in staging and local, hidden in production).
2. **Data model** in `src/lib/types.ts`. Make new fields optional so existing workspaces need no migration. A whole new collection also needs: `CollectionMap`, `COLLECTIONS`, `src/lib/store/local.ts`, `src/lib/store/firestore.ts`, both literals in `src/lib/seed.ts`, and the collection map on the Exports page.
3. **Logic** in its own file under `src/lib/` as plain functions that take a `Store` and an actor. No React in there. Throw `InventoryError` with a message a person can act on.
4. **Screens** under `src/app/(app)/` and `src/components/`. Gate them with `useFeature("yourFlag")`. New sidebar entries go through `navWithFeatures` in `src/components/shell/nav.ts`.
5. **Strato**, if the feature should be usable from chat: follow "Strato and unreleased features" in docs/NEXT-RELEASE.md. Prefer a new report or parameter on an existing tool over a new tool.
6. **Write it down**: add a row to the table in docs/NEXT-RELEASE.md with the flag, the status, and where to find it on screen.

## Where things are

```
src/lib/types.ts            every record type, and the list of collections
src/lib/store/              Store interface (list/get/put/patch/batch); local and Firestore versions
src/lib/inventory.ts        the stock ledger: movements, receiving, builds, orders, shipping, reports
src/lib/features.ts         feature flags; src/lib/useFeature.ts for components
src/lib/<topic>.ts          one file per area: purchaseOrders, workOrders, jobs, variants, units, replenishment, valuation ...
src/lib/agent/              Strato: tools.ts (what it can call), execute.ts (what each call does), context.ts (its summary)
src/lib/seed.ts             the sample company
src/components/ui/          the UI kit: Button, Modal, Drawer, Table, TextField, Select, Combobox, Badge, Banner, useToast
src/components/<area>/      screens' building blocks, by area
src/app/(app)/<page>/       the signed-in pages
src/app/api/                server routes (agent, integrations, email, cron, admin)
src/app/globals.css         design tokens
```

- Read data in components with `useCollection("items")`, `useItems()`, `useSettings()`, `useStore()` from `src/lib/store/provider`.
- In a `store.patch`, a top-level `undefined` clears that field.
- Document numbers (SO-, PO-, WO-, JOB-) come from `nextNumber` in `src/lib/inventory.ts`.

## Look and feel

Flat white and off-white, quiet borders, small radii, Inter. Use the components in `src/components/ui/` and the tokens in `globals.css` before writing new styles. No gradients, glows, or drop shadows beyond what the kit has. Match a neighboring screen: same table, same modal, same spacing. Check new screens at laptop width (about 1500px) and at phone width.

## Things that will trip you up

- The React Compiler lint rules reject common habits: no `Date.now()` or random values during render (use a `useState` initializer), no `setState` directly inside an effect body, no hand-written `useMemo` the compiler cannot keep.
- A form that should reset each time it opens: mount the inner component only while open, as `BuildModal` does.
- A route that sets a cookie must be opened with `window.location.assign`, never `<Link>`; prefetch would call it.
- Local mode and Firestore mode share all the code above the `Store`. If it works in local mode and uses only `Store` methods, it works hosted; do not test against the live database.

## Checking your work

Run the app and use the feature the way a customer would: create the record, edit it, look at stock before and after, reload the page. Then start `cumulus-local-production` and confirm the feature is invisible there. Say in the pull request what you checked and what you did not.
