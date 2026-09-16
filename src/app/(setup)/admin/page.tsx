import { Suspense } from "react";
import type { Metadata } from "next";
import { AdminView } from "@/components/admin/AdminView";

export const metadata: Metadata = { title: "Admin · cumulusOS" };

export default function AdminPage() {
  return (
    <Suspense>
      <AdminView />
    </Suspense>
  );
}
