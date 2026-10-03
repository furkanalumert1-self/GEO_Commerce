import Image from "next/image";
import logo from "@/assets/brand/geoadra-logo.png";
import { APP_FULL_NAME } from "@/lib/brand";
import { cn } from "@/components/ui";

/** Ortak ürün logosu (GeoAdra by Callypso). Yükseklik sınıfla verilir; genişlik oranla (1234×288) hesaplanır. */
export function Logo({ className, priority }: { className?: string; priority?: boolean }) {
  return <Image src={logo} alt={APP_FULL_NAME} priority={priority} sizes="240px" className={cn("block w-auto max-w-full", className ?? "h-[42px]")} />;
}
