"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button type="button" className="mt-1 min-h-11 text-left text-sm text-primary underline-offset-2 hover:underline lg:min-h-0" onClick={() => signOut({ callbackUrl: "/" })}>
      Çıkış yap
    </button>
  );
}
