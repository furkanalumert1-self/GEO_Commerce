"use client";

import { AutoRetryError } from "@/components/data/auto-retry-error";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <AutoRetryError {...props} />;
}
