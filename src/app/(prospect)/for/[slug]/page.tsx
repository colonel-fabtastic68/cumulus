import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, CloudMark } from "@/components/ui";
import { findProspect, prospectView, type ProspectPage } from "@/lib/prospects";
import { ProspectForm } from "./ProspectForm";
import styles from "./prospect.module.css";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const prospect = findProspect(slug);
  return { title: prospect ? `cumulusOS for ${prospect.company}` : "Not found · cumulusOS" };
}

function Logo({ prospect, alt }: { prospect: ProspectPage; alt: string }) {
  const { src, width, height, dark } = prospect.logo;
  // eslint-disable-next-line @next/next/no-img-element -- small fixed logos, one per page
  const img = <img className={styles.logoImg} src={src} width={width} height={height} alt={alt} />;
  return dark ? <span className={styles.logoDark}>{img}</span> : img;
}

function Brand({ onBand }: { onBand?: boolean }) {
  return (
    <div className={`${styles.brand} ${onBand ? styles.brandOnBand : ""}`}>
      <CloudMark />
      <span>cumulusOS</span>
    </div>
  );
}

const STEPS = [
  { n: "01", title: "Book thirty minutes", body: "Bring a spreadsheet, an export from your store or accounting, or a few part numbers. We show cumulusOS on them, not on a sample." },
  { n: "02", title: "Import it with us", body: "Columns map themselves and unknown ones become custom fields. The review shows every change before it lands, and we do the first import with you." },
  { n: "03", title: "Connect and invite the shop", body: "Plug in the store, the register and the books. Teammates sign in with an emailed link and see the same numbers live." },
];

const COMPARE = [
  { row: "Time to a working system", us: "An afternoon, from your own spreadsheet", erp: "Weeks or months, often with paid implementation", sheet: "Hours, then it never ends" },
  { row: "Bulk changes", us: "Strato drafts them and waits for your approval", erp: "By hand or by consultant", sheet: "By hand, one row at a time" },
  { row: "Who sets it up", us: "The people who build it, on the call with you", erp: "A partner or an internal project", sheet: "Whoever built the sheet" },
  { row: "Pricing", us: "$99 a month, month-to-month. $1,000 setup waived", erp: "Usually quote-based and annual", sheet: "Free, until the errors" },
];

const FAQ = [
  { q: "Do we have to replace our store or QuickBooks?", a: "No. Shopify, WooCommerce, Square, Clover and QuickBooks Online plug in under Integrations. Stock levels push out, orders come in, and webhooks keep both sides live." },
  { q: "What do we bring to the demo?", a: "A spreadsheet, an export from your store or accounting, or a few part numbers. Strato reads paper count sheets and PDFs too." },
  { q: "Will the AI change our numbers on its own?", a: "No. Strato drafts the price change, the cycle count or the reorder, shows it in the table, and waits for a person to approve it." },
  { q: "Do we need to install anything?", a: "No. It runs in the browser on any device in the shop, and barcode and QR labels scan from any phone." },
  { q: "What does it cost?", a: "$99 a month, month-to-month. Cancel any month. We're waiving the $1,000 setup fee." },
];

/** A page made for one company, linked from the emails we send them. See src/lib/prospects.ts. */
export default async function ProspectDemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prospect = findProspect(slug);
  if (!prospect) notFound();
  const view = prospectView(prospect);
  const { company } = prospect;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={`${styles.wrap} ${styles.topbarIn}`}>
          <div className={styles.lockup}>
            <Brand />
            <span className={styles.times} aria-hidden="true">
              ×
            </span>
            <Logo prospect={prospect} alt={`${company} logo`} />
          </div>
          <p className={styles.byline}>
            Put together by Baker,
            <br />
            co-founder of cumulusOS
          </p>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <h1 className={styles.h1} id="hero-title">
              {view.headline}
            </h1>
            <p className={styles.lede}>{view.lede}</p>
          </div>

          <div className={styles.heroForm} id="demo">
            <div className={styles.card}>
              <div className={styles.checker} aria-hidden="true" />
              <ProspectForm company={company} />
            </div>
          </div>

          <div className={styles.heroProof}>
            <ul className={styles.checks}>
              {view.bullets.map((b) => (
                <li key={b}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <p className={styles.built}>
              Built with <strong>Longhorn Chassis</strong> and <strong>Willo Ranch</strong>. Proudly North Carolinian.
            </p>
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.previewBand}`} aria-labelledby="preview-title">
        <div className={styles.wrap}>
          <div className={styles.previewGrid}>
            <div>
              <h2 className={styles.display} id="preview-title">
                {company}, running on one count.
              </h2>
              <div className={styles.note}>
                <p>{view.note}</p>
                <p className={styles.sign}>Baker, co-founder of cumulusOS</p>
              </div>
            </div>
            <div className={styles.app} role="img" aria-label={`Sample cumulusOS workspace for ${company}: ${view.panel.strato}`}>
              <div className={styles.appHead}>
                <Logo prospect={prospect} alt="" />
                <span className={styles.appTitle}>
                  {company} / {view.panel.title}
                </span>
                <Badge>Sample data</Badge>
              </div>
              <div className={styles.appStats}>
                <div className={styles.appStat}>
                  <span>{view.panel.statA}</span>
                  <b>{view.panel.valA}</b>
                </div>
                <div className={styles.appStat}>
                  <span>{view.panel.statB}</span>
                  <b>{view.panel.valB}</b>
                </div>
              </div>
              <div className={styles.appScroll}>
                <table>
                  <thead>
                    <tr>
                      <th>{view.panel.c1}</th>
                      <th>{view.panel.c2}</th>
                      <th>{view.panel.c3}</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.panel.rows.map((r) => (
                      <tr key={r.a}>
                        <td>{r.a}</td>
                        <td>{r.b}</td>
                        <td>{r.c}</td>
                        <td>
                          <Badge tone={r.tone}>{r.s}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.strato}>
                <Badge tone="magic">Strato</Badge>
                <span className={styles.stratoText}>{view.panel.strato}</span>
                <Badge tone="attention">Waiting for approval</Badge>
              </div>
            </div>
          </div>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.num}>
                30<em>min</em>
              </span>
              <p>From a spreadsheet you bring to a demo on your own parts.</p>
            </div>
            <div className={styles.stat}>
              <span className={styles.num}>7</span>
              <p>Stores, registers, books and carriers it connects to today.</p>
            </div>
            <div className={styles.stat}>
              <span className={styles.num}>0</span>
              <p>Installs. It runs in the browser on any device in the shop.</p>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.alt}`} aria-labelledby="fix-title">
        <div className={styles.wrap}>
          <h2 className={styles.display} id="fix-title" style={{ maxWidth: "20em" }}>
            {view.problemHead}
          </h2>
          <div className={styles.problems}>
            {view.problems.map((p) => (
              <article key={p.t} className={styles.problem}>
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="how-title">
        <div className={styles.wrap}>
          <h2 className={styles.display} id="how-title">
            Spreadsheet to live shop floor in an afternoon.
          </h2>
          <ol className={styles.steps}>
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className={styles.stepN} aria-hidden="true">
                  {s.n}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
          <div className={styles.inlineCta}>
            <a className={styles.btn} href="#demo">
              Book my demo
            </a>
            <span className={styles.quiet}>No slides. The demo runs in a real workspace with your numbers.</span>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.alt}`} aria-labelledby="compare-title">
        <div className={styles.wrap}>
          <h2 className={styles.display} id="compare-title">
            Everything an ERP does, without the project.
          </h2>
          <div className={styles.tableBox} tabIndex={0} aria-label="Comparison table, scrolls sideways on small screens">
            <table className={styles.compare}>
              <thead>
                <tr>
                  <th scope="col">What matters</th>
                  <th scope="col" className={styles.us}>
                    cumulusOS
                  </th>
                  <th scope="col">A heavy ERP</th>
                  <th scope="col">Spreadsheets</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((c) => (
                  <tr key={c.row}>
                    <th scope="row">{c.row}</th>
                    <td className={styles.us}>{c.us}</td>
                    <td>{c.erp}</td>
                    <td>{c.sheet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="faq-title">
        <div className={`${styles.wrap} ${styles.faqGrid}`}>
          <div>
            <h2 className={styles.display} id="faq-title">
              Fair questions.
            </h2>
          </div>
          <div className={styles.faq}>
            {FAQ.map((f, i) => (
              <details key={f.q} open={i === 0}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.final}`} aria-labelledby="final-title">
        <div className={styles.checker} aria-hidden="true" />
        <div className={`${styles.wrap} ${styles.finalIn}`}>
          <div>
            <h2 className={styles.display} id="final-title">
              Bring {company} parts. We will do the rest live.
            </h2>
            <ul className={styles.assure}>
              <li>Leave with a plan for what to import first and what to connect.</li>
              <li>You talk to Baker, not a sales team.</li>
            </ul>
            <div className={styles.inlineCta} style={{ marginTop: 24 }}>
              <a className={`${styles.btn} ${styles.btnLight}`} href="#demo">
                Book my demo
              </a>
            </div>
          </div>
          <div className={styles.chip}>
            <div className={styles.plate}>
              <Logo prospect={prospect} alt={`${company} logo`} />
            </div>
            <span className={styles.chipTimes} aria-hidden="true">
              ×
            </span>
            <Brand onBand />
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footerIn}`}>
          <span>© 2026 cumulusOS. Proudly North Carolinian.</span>
          <nav aria-label="Legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href="mailto:hello@cumulusos.com">hello@cumulusos.com</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
