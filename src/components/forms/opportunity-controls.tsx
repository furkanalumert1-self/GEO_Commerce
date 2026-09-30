"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

const NEXT: Record<string, Array<[string, string]>> = {
  new: [["triaged", "Değerlendirildi"], ["in_progress", "Üzerinde çalışılıyor"], ["dismissed", "Kapat"]],
  triaged: [["in_progress", "Üzerinde çalışılıyor"], ["dismissed", "Kapat"], ["new", "Yeniye döndür"]],
  in_progress: [["measuring", "Ölçüme al"], ["triaged", "Geri al"], ["dismissed", "Kapat"]],
  measuring: [["won", "Kazanıldı (insan onayı)"], ["in_progress", "Çalışmaya dön"], ["dismissed", "Kapat"]],
  won: [["in_progress", "Yeniden aç"]],
  dismissed: [["new", "Yeniden aç"], ["triaged", "Değerlendirmeye al"]],
};

export function OpportunityControls({ url, status, ownerId, priority, dueAt, members }: { url: string; status: string; ownerId: string | null; priority: string; dueAt: string; members: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [owner, setOwner] = useState(ownerId ?? "");
  const [prio, setPrio] = useState(priority);
  const [due, setDue] = useState(dueAt);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    const res = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) return setError(`${json?.error?.message ?? "Kaydedilemedi"}${json?.requestId ? ` · istek no: ${json.requestId}` : ""}`);
    setDirty(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(NEXT[status] ?? []).map(([to, label]) => (
          <Button key={to} disabled={pending} onClick={() => patch({ status: to, ...(to === "won" ? { humanApprovedWin: true } : {}) })}>{label}</Button>
        ))}
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          patch({ ownerId: owner || null, priority: prio, dueAt: due ? new Date(`${due}T12:00:00Z`).toISOString() : null });
        }}
        onChange={() => setDirty(true)}
      >
        <Field label="Sahip" htmlFor="o-owner">
          <select id="o-owner" className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Atanmadı</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Öncelik" htmlFor="o-prio">
          <select id="o-prio" className={inputClass} value={prio} onChange={(e) => setPrio(e.target.value)}>
            <option value="high">Yüksek</option>
            <option value="medium">Orta</option>
            <option value="low">Düşük</option>
          </select>
        </Field>
        <Field label="Termin" htmlFor="o-due">
          <input id="o-due" type="date" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={pending || !dirty}>{pending ? "Kaydediliyor…" : "Kaydet"}</Button>
      </form>
    </div>
  );
}
