import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ReportView, type ReportSnapshot } from "@/components/data/report-view";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { isUuid } from "@/modules/tenancy/access";

export const metadata: Metadata = { title: "Rapor" };

export default async function ReportPage({ params }: { params: Promise<{ workspaceId: string; brandId: string; reportId: string }> }) {
  const { workspaceId, brandId, reportId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  if (!isUuid(reportId)) notFound();
  const r = await db.report.findFirst({ where: { id: reportId, workspaceId, brandId } });
  if (!r?.snapshot) notFound();
  return <ReportView snapshot={r.snapshot as unknown as ReportSnapshot} timeZone={access.brand.timezone} />;
}
