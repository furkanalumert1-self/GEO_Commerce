"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <Button
        variant="primary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const res = await fetch(`/api/v1/invites/${encodeURIComponent(token)}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
          const body = await res.json().catch(() => null);
          setPending(false);
          if (!res.ok) return setError(body?.error?.message ?? "Davet kabul edilemedi");
          router.push(`/w/${body.data.workspaceId}/overview`);
        }}
      >
        Daveti kabul et
      </Button>
    </div>
  );
}
