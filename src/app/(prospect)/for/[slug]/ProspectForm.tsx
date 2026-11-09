"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, TextField } from "@/components/ui";
import styles from "./prospect.module.css";

/** Books the demo from a company's page. Posts to the public inquiry route, which files it and mails hello@. */
export function ProspectForm({ company }: { company: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [shop, setShop] = useState(company);
  const [errors, setErrors] = useState<{ name?: string; email?: string; form?: string }>({});
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = "Add your name so we know who to write to.";
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim())) next.email = "Add an email like you@yourshop.com.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setState("busy");
    try {
      const res = await fetch("/api/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "demo", name: name.trim(), email: email.trim(), company: shop.trim(), message: `Asked for a demo from the page we made for ${company}.`, page: window.location.pathname }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not send that right now. Try again in a moment.");
      setState("done");
    } catch (err) {
      setState("idle");
      setErrors({ form: err instanceof Error ? err.message : String(err) });
    }
  };

  if (state === "done") {
    return (
      <div className={`${styles.formIn} ${styles.success}`} role="status">
        <div>
          <h2 className={styles.formTitle}>Thanks, {name.trim().split(/\s+/)[0]}.</h2>
          <p className={styles.formSub}>
            Baker or Mitch will write to {email.trim()} with times, usually the same business day.
          </p>
        </div>
        <p>
          Want to pick a time now? <Link href="/book">Open the calendar</Link>
        </p>
        <p className={styles.quiet}>Have a spreadsheet handy? Bring it to the call and we will use it.</p>
      </div>
    );
  }

  return (
    <form className={`${styles.formIn} ${styles.lpForm}`} onSubmit={submit} noValidate aria-labelledby="form-title">
      <div>
        <h2 className={styles.formTitle} id="form-title">
          See it on {company} parts
        </h2>
        <p className={styles.formSub}>Thirty minutes with the founders. Bring a spreadsheet or a few part numbers.</p>
      </div>
      <div className={styles.formGrid}>
        <TextField label="Name" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={120} />
        <TextField label="Work email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <TextField label="Company" name="company" autoComplete="organization" value={shop} onChange={(e) => setShop(e.target.value)} maxLength={120} />
      </div>
      {errors.form && <p className={styles.formError}>{errors.form}</p>}
      <Button type="submit" variant="primary" size="lg" fullWidth loading={state === "busy"} disabled={state === "busy"}>
        Book my 30-minute demo
      </Button>
      <ul className={styles.assure}>
        <li>A reply from a founder, usually the same business day.</li>
        <li>If it is not a fit, we will say so and point you somewhere better.</li>
      </ul>
      <p className={styles.legal}>
        We use your details to set up the demo. <Link href="/privacy">Privacy policy</Link>
      </p>
    </form>
  );
}
