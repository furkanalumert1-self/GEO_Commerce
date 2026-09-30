import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ReportView, type ReportSnapshot } from "@/components/data/report-view";
import { db } from "@/lib/db";
import { getSharedReport } from "@/modules/reports/service";

export const metadata: Metadata = { title: "Paylaşılan rapor", robots: { index: false, follow: false } };

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await getSharedReport(db, token);
  if (!r?.snapshot) notFound();
  const wl = await db.whiteLabel.findUnique({ where: { workspaceId: r.workspaceId }, select: { displayName: true } });
  return <ReportView snapshot={r.snapshot as unknown as ReportSnapshot} timeZone="Europe/Istanbul" brandingName={wl?.displayName ?? undefined} />;
}
