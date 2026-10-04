export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { AuditForm } from "@/components/forms/audit-form";
import { auditEngineScope } from "@/modules/audit/service";
import { ENGINE_SHORT } from "@/lib/format";

export const metadata: Metadata = { title: "Ücretsiz ölçüm" };

export default function AuditStartPage() {
  const scope = auditEngineScope();
  const names = (list: string[]) => list.map((e) => ENGINE_SHORT[e] ?? e).join(", ");
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Ücretsiz ölçüm</h1>
      <p className="text-sm text-muted">
        Site adresinizi girin; sitenizi inceleyip ürün gruplarınıza uygun 5 soruyu AI platformlarına sorar ve kısa bir ön analiz hazırlarız. Hesap açmanız gerekmez. Alan adı ve cihaz başına 30 günde bir ücretsizdir.
      </p>
      <p className="text-sm" data-testid="audit-scope">
        <span className="font-medium">Sorulacak platformlar:</span> {names(scope.engines)}
        {scope.unavailable.length ? <span className="text-text-secondary"> · {names(scope.unavailable)}: şu anda kullanılamıyor</span> : null}
        <span className="block text-xs text-text-secondary">Web aramalı API yanıtları kullanılır; uygulamalardaki (ChatGPT, Gemini, Claude) sonuçla birebir aynı değildir.</span>
      </p>
      <Card className="p-5">
        <AuditForm demo={process.env.DEMO_MODE === "true"} />
      </Card>
    </div>
  );
}
