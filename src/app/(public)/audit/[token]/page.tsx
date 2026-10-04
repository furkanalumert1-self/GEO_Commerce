import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getAuditByToken, publicAuditView } from "@/modules/audit/service";
import { AuditResult } from "@/components/data/audit-result";
import { currentUser } from "@/lib/page-access";
import { executionMode } from "@/lib/queue";

export const metadata: Metadata = { title: "Ölçüm sonucu", robots: { index: false, follow: false } };

export default async function AuditResultPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const audit = await getAuditByToken(db, token);
  if (!audit) notFound();
  const user = await currentUser();
  return <AuditResult token={token} initial={JSON.parse(JSON.stringify(publicAuditView(audit)))} signedIn={Boolean(user)} inline={executionMode() === "inline"} />;
}
