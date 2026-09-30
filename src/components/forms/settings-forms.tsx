"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, json };
}

export function WorkspaceGeneralForm({ url, initial }: { url: string; initial: { name: string; timezone: string } }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setPending(true);
      const r = await send(url, "PATCH", f);
      setPending(false);
      setMsg(r.ok ? { ok: true, text: "Kaydedildi" } : { ok: false, text: `${r.json?.error?.message ?? "Kaydedilemedi"}${r.json?.requestId ? ` · istek no: ${r.json.requestId}` : ""}` });
      if (r.ok) router.refresh();
    }}>
      <Field label="Çalışma alanı adı" htmlFor="ws-name"><input id="ws-name" className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Saat dilimi (IANA)" htmlFor="ws-tz"><input id="ws-tz" className={inputClass} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
      {msg ? <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p> : null}
      <Button type="submit" variant="primary" disabled={pending}>Kaydet</Button>
    </form>
  );
}

export function InviteForm({ url, brands }: { url: string; brands: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setPending(true);
      const r = await send(url, "POST", { email, role, brandIds });
      setPending(false);
      if (!r.ok) return setMsg({ ok: false, text: `${r.json?.error?.message ?? "Davet gönderilemedi"}${r.json?.requestId ? ` · istek no: ${r.json.requestId}` : ""}` });
      setMsg({ ok: true, text: r.json.data.delivered ? "Davet e-postası gönderildi" : "E-posta yapılandırılmamış; bağlantıyı güvenli bir kanalla iletin (yalnız bir kez gösterilir):", link: r.json.data.inviteUrl ?? undefined });
      setEmail("");
      router.refresh();
    }}>
      <Field label="E-posta" htmlFor="inv-email"><input id="inv-email" type="email" required className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Rol" htmlFor="inv-role">
        <select id="inv-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="admin">Yönetici</option><option value="editor">Editör</option><option value="analyst">Analist</option><option value="viewer">Görüntüleyici</option><option value="client">Müşteri</option><option value="billing">Faturalama</option>
        </select>
      </Field>
      {role === "client" || role === "viewer" ? (
        <fieldset className="flex flex-col gap-1 text-sm"><legend className="font-medium">Markalar</legend>
          {brands.map((b) => <label key={b.id} className="flex min-h-11 items-center gap-2 sm:min-h-0"><input type="checkbox" checked={brandIds.includes(b.id)} onChange={(e) => setBrandIds((s) => e.target.checked ? [...s, b.id] : s.filter((x) => x !== b.id))} />{b.name}</label>)}
        </fieldset>
      ) : null}
      {msg ? <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}{msg.link ? <input readOnly aria-label="Davet bağlantısı" className="mt-1 w-full rounded-md border border-border px-2 text-xs text-text" value={msg.link} onFocus={(e) => e.currentTarget.select()} /> : null}</div> : null}
      <Button type="submit" variant="primary" disabled={pending}>Davet et</Button>
    </form>
  );
}

export function ApiKeyForm({ url, brands }: { url: string; brands: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const r = await send(url, "POST", { name, scopes: ["brand:read", "export:read"], brandIds: brandId ? [brandId] : [] });
      if (!r.ok) return setError(r.json?.error?.message ?? "Oluşturulamadı");
      setKey(r.json.data.key);
      setName("");
      router.refresh();
    }}>
      <Field label="Ad" htmlFor="k-name"><input id="k-name" required minLength={2} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Marka kapsamı" htmlFor="k-brand"><select id="k-brand" className={inputClass} value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">Tüm markalar</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <p className="text-xs text-muted">Kapsam: yalnız okuma (brand:read, export:read).</p>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {key ? <div role="status" className="text-sm">Anahtar (yalnız şimdi gösterilir): <input readOnly aria-label="API anahtarı" className="mt-1 w-full rounded-md border border-border px-2 font-mono text-xs" value={key} onFocus={(e) => e.currentTarget.select()} /></div> : null}
      <Button type="submit" variant="primary">Oluştur</Button>
    </form>
  );
}
