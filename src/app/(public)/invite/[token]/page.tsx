import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { currentUser } from "@/lib/page-access";
import { AcceptInvite } from "@/components/forms/accept-invite";

export const metadata: Metadata = { title: "Davet", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await db.invite.findUnique({ where: { tokenHash: hashToken(token) }, include: { workspace: { select: { name: true } } } });
  const valid = invite && !invite.acceptedAt && invite.expiresAt > new Date();
  const user = await currentUser();
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-5">
        {!valid ? (
          <>
            <h1 className="text-xl font-semibold">Davet geçersiz</h1>
            <p className="mt-2 text-sm text-muted">Davetin süresi dolmuş veya daha önce kullanılmış olabilir. Çalışma alanı yöneticinizden yeni davet isteyin.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">{invite.workspace.name} çalışma alanına davet</h1>
            <p className="mt-2 text-sm text-muted">Davet {invite.email} adresine gönderildi. Kabul etmek için bu adresle giriş yapmalısınız.</p>
            <div className="mt-4">
              {user ? <AcceptInvite token={token} /> : <Link className="text-primary underline" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Giriş yap</Link>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
