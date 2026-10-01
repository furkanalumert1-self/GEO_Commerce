export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { AuditForm } from "@/components/forms/audit-form";

export const metadata: Metadata = { title: "Ücretsiz GEO Audit" };

export default function AuditStartPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Ücretsiz GEO Audit</h1>
      <p className="text-sm text-muted">
        Akış: alan adı doğrulama → herkese açık HTML/sitemap taraması → marka/kategori/ürün örneklemi → 5 niyet sorusu → erişilebilir 2 AI motoru → özet.
        Alan adı ve cihaz başına 30 günde bir ücretsiz audit yapılabilir.
      </p>
      <Card className="p-5">
        <AuditForm demo={process.env.DEMO_MODE === "true"} />
      </Card>
    </div>
  );
}
