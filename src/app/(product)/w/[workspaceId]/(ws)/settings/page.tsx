import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, PageHeader, TableWrap, Td, Th, cn } from "@/components/ui";
import { ApiButton } from "@/components/forms/api-button";
import { InviteForm, ApiKeyForm, WorkspaceGeneralForm } from "@/components/forms/settings-forms";
import { db } from "@/lib/db";
import { pageWorkspace } from "@/lib/page-access";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { hasFeature } from "@/modules/billing/plans";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Ayarlar" };

const TABS = [["general", "Genel"], ["members", "Üyeler ve roller"], ["branding", "Marka görünümü"], ["api", "API anahtarları"], ["webhooks", "Webhook'lar"], ["privacy", "Gizlilik"]] as const;

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const access = await pageWorkspace(workspaceId);
  const ctx = { role: access.role, isApprover: access.isApprover };
  if (!can(ctx, "workspace.update")) return <><PageHeader title="Ayarlar" /><Alert tone="neutral" title="Yetkiniz yok">Ayarlar yalnız sahip ve yöneticiler içindir.</Alert></>;
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "general";
  const base = `/w/${workspaceId}/settings`;
  const api = `/api/v1/workspaces/${workspaceId}`;
  const [ws, members, invites, brands, keys, wl, privacy] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    db.membership.findMany({ where: { workspaceId }, include: { user: { select: { email: true, name: true } }, grants: { include: { brand: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } }),
    db.invite.findMany({ where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    db.brand.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, name: true } }),
    db.apiKey.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } }),
    db.whiteLabel.findUnique({ where: { workspaceId } }),
    db.privacyRequest.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return (
    <>
      <PageHeader title="Ayarlar" />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map(([k, l]) => <Link key={k} href={`${base}?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={cn("inline-flex min-h-11 items-center border-b-2 px-3 text-sm sm:min-h-9", tab === k ? "border-primary font-medium text-primary" : "border-transparent text-muted")}>{l}</Link>)}
      </div>
      {tab === "general" ? <Card className="max-w-xl p-4"><WorkspaceGeneralForm url={api} initial={{ name: ws.name, timezone: ws.timezone }} /></Card> : null}
      {tab === "members" ? (
        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader title={`Üyeler (${members.length} / ${access.entitlements.seats} koltuk)`} description="Müşteri ve görüntüleyiciler yalnız verilen markaları görür." />
            <TableWrap label="Üyeler">
              <thead><tr><Th>Kişi</Th><Th>Rol</Th><Th>Marka erişimi</Th></tr></thead>
              <tbody>
                {members.map((m) => <tr key={m.id}><Td>{m.user.name ?? "—"}<p className="text-xs text-muted">{m.user.email}</p></Td><Td>{ROLE_LABELS[m.role]}{m.isApprover ? <Badge className="ml-1" tone="primary">Onaylayıcı</Badge> : null}</Td><Td className="text-xs text-muted">{m.grants.length ? m.grants.map((g) => g.brand.name).join(", ") : "Tüm markalar"}</Td></tr>)}
                {invites.map((i) => <tr key={i.id}><Td>{i.email}</Td><Td>{ROLE_LABELS[i.role]} <Badge tone="warning">Davet bekliyor</Badge></Td><Td className="text-xs text-muted">{fmtDate(i.expiresAt, ws.timezone)} bitiş</Td></tr>)}
              </tbody>
            </TableWrap>
          </Card>
          <Card><CardHeader title="Davet et" /><div className="p-4"><InviteForm url={`${api}/invites`} brands={brands} /></div></Card>
        </div>
      ) : null}
      {tab === "branding" ? (
        <Card className="max-w-xl p-4 text-sm">
          {hasFeature(access.entitlements, "white_label") ? (
            <>
              <p>Görünen ad: <strong>{wl?.displayName ?? "—"}</strong> · Vurgu rengi: <code>{wl?.accent ?? "#2458A6"}</code></p>
              <p className="mt-2 text-muted">Özel alan adı: {wl?.customDomain ? `${wl.customDomain} ${wl.verifiedAt ? "(doğrulandı)" : "(doğrulama bekliyor)"}` : "tanımlı değil"}. TLS sağlama sağlayıcısı bağlı olmadığından müşteri portalı çalışma alanı alt yolunda sunulur; rastgele Host başlığı tenant seçmez.</p>
              <p className="mt-2 text-muted">Yalnız logo, ad ve erişilebilir tek vurgu rengi özelleştirilebilir; özel CSS/HTML enjeksiyonu yoktur.</p>
            </>
          ) : <Alert tone="primary" title="White-label Agency paketinde" />}
        </Card>
      ) : null}
      {tab === "api" ? (
        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader title="API anahtarları" description="Anahtar yalnız oluşturulduğunda bir kez gösterilir; burada yalnız son 4 karakter." />
            <TableWrap label="API anahtarları">
              <thead><tr><Th>Ad</Th><Th>Kapsam</Th><Th>Son kullanım</Th><Th>İşlem</Th></tr></thead>
              <tbody>{keys.map((k) => <tr key={k.id}><Td>{k.name}<p className="text-xs text-muted">…{k.last4} · {fmtDate(k.createdAt, ws.timezone)}</p></Td><Td className="text-xs">{k.scopes.join(", ")}</Td><Td className="text-muted">{fmtDate(k.lastUsedAt, ws.timezone, "tr-TR", true)}</Td><Td>{k.revokedAt ? <Badge>İptal edildi</Badge> : <ApiButton url={`${api}/api-keys/${k.id}`} method="DELETE" variant="danger" label="İptal et" confirm="Anahtar iptal edilsin mi? Bu anahtarı kullanan entegrasyonlar çalışmayı durdurur." />}</Td></tr>)}</tbody>
            </TableWrap>
          </Card>
          <Card><CardHeader title="Yeni anahtar" /><div className="p-4">{hasFeature(access.entitlements, "public_api") ? <ApiKeyForm url={`${api}/api-keys`} brands={brands} /> : <p className="text-sm text-muted">Public API Commerce ve üzeri paketlerde.</p>}</div></Card>
        </div>
      ) : null}
      {tab === "webhooks" ? (
        <Card className="max-w-2xl p-4 text-sm">
          <p>Giden webhook zarfı: <code>{"{id,type,occurredAt,workspaceId,brandId,data,schemaVersion}"}</code>; imza HMAC-SHA256(raw body + timestamp), 5 dakika replay penceresi, üstel yeniden deneme.</p>
          <p className="mt-2 text-muted">Olaylar: audit.completed, monitoring.completed, opportunity.created, action.published, report.ready, integration.degraded, usage.threshold.</p>
          <Alert tone="warning" title="Webhook adresi ekleme henüz açık değil">Bu bölüm geliştiriciler içindir; adres ekleme arayüzü yakında gelecek.</Alert>
        </Card>
      ) : null}
      {tab === "privacy" ? (
        <Card className="max-w-2xl p-4 text-sm">
          <p>Yalnız hizmet için gereken veriyi tutarız. AI yanıt metinleri ve site inceleme içerikleri 30 gün, giriş yapmadan yapılan ücretsiz ölçümler 7 gün saklanır. Verileriniz başka müşterilerin sorularında veya yapay zekâ modeli eğitiminde kullanılmaz. KVKK/GDPR için teknik önlemler uygulanır; bu, hukuki uygunluk garantisi değildir.</p>
          <div className="mt-3"><ApiButton url={`${api}/privacy/export`} label="Veri dışa aktarma talebi oluştur" onSuccessMessage="Talep oluşturuldu" /></div>
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">{privacy.map((p) => <li key={p.id} className="px-3 py-2">{p.kind} · {p.status} · son tarih {fmtDate(p.dueAt, ws.timezone)}</li>)}</ul>
        </Card>
      ) : null}
    </>
  );
}
