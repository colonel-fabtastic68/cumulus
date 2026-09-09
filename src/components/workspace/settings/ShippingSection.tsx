"use client";

import { useState } from "react";
import type { Address, ParcelDefaults, WorkspaceSettings } from "@/lib/types";
import { Button, FormGrid, Select, TextField, Toggle, useToast } from "@/components/ui";
import { useSaveSettings } from "./useSaveSettings";

const EMPTY_ADDRESS: Address = { name: "", company: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US", phone: "", email: "" };
const EMPTY_PARCEL: ParcelDefaults = { length: 12, width: 9, height: 4, distanceUnit: "in", weight: 1, massUnit: "lb" };

/** Factor 41 and 32: where parcels ship from, the box used for rate quotes, and whether keyboard scanners are listened to. */
export function ShippingSection({ settings, readOnly }: { settings: WorkspaceSettings; readOnly: boolean }) {
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const [from, setFrom] = useState<Address>({ ...EMPTY_ADDRESS, ...(settings.shipping?.from ?? {}) });
  const [parcel, setParcel] = useState<ParcelDefaults>({ ...EMPTY_PARCEL, ...(settings.shipping?.parcel ?? {}) });
  const [wedge, setWedge] = useState(settings.scanning?.keyboardWedge ?? true);
  const [saving, setSaving] = useState(false);

  const setF = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setFrom((a) => ({ ...a, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

  const save = async () => {
    setSaving(true);
    try {
      const clean: Address = { ...from, country: (from.country || "US").toUpperCase() };
      for (const k of Object.keys(clean) as Array<keyof Address>) if (clean[k] === "") delete clean[k];
      const hasFrom = !!(clean.street1 && clean.city && clean.zip);
      await saveSettings({ shipping: { from: hasFrom ? clean : undefined, parcel }, scanning: { keyboardWedge: wedge } });
      toast("Shipping settings saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 text-[13px] font-semibold text-text">Ship-from address</div>
        <p className="mb-3 text-[12.5px] text-text-secondary">Carriers quote rates from here. Leave it blank if you only record tracking numbers by hand.</p>
        <FormGrid cols={2}>
          <TextField label="Company" value={from.company ?? ""} onChange={setF("company")} disabled={readOnly} />
          <TextField label="Contact name" value={from.name ?? ""} onChange={setF("name")} disabled={readOnly} />
          <TextField label="Street" value={from.street1} onChange={setF("street1")} disabled={readOnly} />
          <TextField label="Street 2" value={from.street2 ?? ""} onChange={setF("street2")} disabled={readOnly} />
          <TextField label="City" value={from.city} onChange={setF("city")} disabled={readOnly} />
          <TextField label="State / region" value={from.state ?? ""} onChange={setF("state")} disabled={readOnly} />
          <TextField label="Postal code" value={from.zip} onChange={setF("zip")} disabled={readOnly} />
          <TextField label="Country (2 letters)" value={from.country} onChange={setF("country")} maxLength={2} disabled={readOnly} />
          <TextField label="Phone" value={from.phone ?? ""} onChange={setF("phone")} disabled={readOnly} />
          <TextField label="Email" type="email" value={from.email ?? ""} onChange={setF("email")} disabled={readOnly} />
        </FormGrid>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-semibold text-text">Default parcel</div>
        <p className="mb-3 text-[12.5px] text-text-secondary">Used for rate quotes when the items on an order carry no weight or dimensions.</p>
        <FormGrid cols={4}>
          <TextField label="Length" type="number" min={0} step="any" value={String(parcel.length)} onChange={(e) => setParcel((p) => ({ ...p, length: num(e.target.value) }))} disabled={readOnly} />
          <TextField label="Width" type="number" min={0} step="any" value={String(parcel.width)} onChange={(e) => setParcel((p) => ({ ...p, width: num(e.target.value) }))} disabled={readOnly} />
          <TextField label="Height" type="number" min={0} step="any" value={String(parcel.height)} onChange={(e) => setParcel((p) => ({ ...p, height: num(e.target.value) }))} disabled={readOnly} />
          <Select label="Unit" value={parcel.distanceUnit} onChange={(e) => setParcel((p) => ({ ...p, distanceUnit: e.target.value as ParcelDefaults["distanceUnit"] }))} options={[{ value: "in", label: "in" }, { value: "cm", label: "cm" }]} disabled={readOnly} />
          <TextField label="Weight" type="number" min={0} step="any" value={String(parcel.weight)} onChange={(e) => setParcel((p) => ({ ...p, weight: num(e.target.value) }))} disabled={readOnly} />
          <Select label="Weight unit" value={parcel.massUnit} onChange={(e) => setParcel((p) => ({ ...p, massUnit: e.target.value as ParcelDefaults["massUnit"] }))} options={[{ value: "lb", label: "lb" }, { value: "oz", label: "oz" }, { value: "kg", label: "kg" }, { value: "g", label: "g" }]} disabled={readOnly} />
        </FormGrid>
      </div>
      <Toggle label="Listen for keyboard barcode scanners" help="USB and Bluetooth scanners type the code and press Enter. When nothing else has focus, that opens the scanned item." checked={wedge} onChange={setWedge} disabled={readOnly} />
      {!readOnly && (
        <div>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Save shipping settings
          </Button>
        </div>
      )}
    </div>
  );
}
