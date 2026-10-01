import type { PrismaClient } from "@/generated/prisma/client";
import { blockingIssues, type ActionContent } from "./workflow";

const CHECKED = new Set(["draft", "review", "approved", "rejected"]);

/** Güncel sürümünde doldurulmamış zorunlu alan bulunan aksiyonlar (listelerde "Düzeltme gerekli" için). */
export async function actionsNeedingFix(db: PrismaClient, actions: Array<{ id: string; status: string; currentVersionId: string | null }>): Promise<Set<string>> {
  const targets = actions.filter((a) => a.currentVersionId && CHECKED.has(a.status));
  if (!targets.length) return new Set();
  const versions = await db.actionVersion.findMany({ where: { id: { in: targets.map((a) => a.currentVersionId!) } }, select: { id: true, content: true } });
  const blocked = new Set(versions.filter((v) => blockingIssues(v.content as unknown as ActionContent).length > 0).map((v) => v.id));
  return new Set(targets.filter((a) => blocked.has(a.currentVersionId!)).map((a) => a.id));
}
