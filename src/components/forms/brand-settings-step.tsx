"use client";

import { useEffect, useRef, useState } from "react";
import { Field, inputClass } from "@/components/ui";

/** Adım 2: autosave (debounce 800 ms). Kaydetme durumu aria-live ile bildirilir. */
export function BrandSettingsStep({ url, initial }: { url: string; initial: { country: string; language: string; timezone: string; currency: string; aliases: string; categories: string } }) {
  const [f, setF] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setState("saving");
      const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
      const res = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: 2, country: f.country, language: f.language, timezone: f.timezone, currency: f.currency, aliases: split(f.aliases), categories: split(f.categories) }) });
      setState(res.ok ? "saved" : "error");
    }, 800);
    return () => clearTimeout(t);
  }, [f, url]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ülke kodu" htmlFor="s-country" hint="Türkiye için TR"><input id="s-country" maxLength={2} className={inputClass} value={f.country} onChange={set("country")} /></Field>
        <Field label="Dil kodu" htmlFor="s-lang" hint="Türkçe için tr"><input id="s-lang" maxLength={5} className={inputClass} value={f.language} onChange={set("language")} /></Field>
        <Field label="Saat dilimi" htmlFor="s-tz"><input id="s-tz" className={inputClass} value={f.timezone} onChange={set("timezone")} /></Field>
        <Field label="Para birimi" htmlFor="s-cur"><input id="s-cur" maxLength={3} className={inputClass} value={f.currency} onChange={set("currency")} /></Field>
      </div>
      <Field label="Markanızın diğer yazılışları (isteğe bağlı)" htmlFor="s-alias" hint="Virgülle ayırın (ör. Karaca Home). Çok kısa veya genel kelimeler otomatik eşleştirilmez; önce onayınıza sunulur."><input id="s-alias" className={inputClass} value={f.aliases} onChange={set("aliases")} /></Field>
      <Field label="Ürün kategorileri" htmlFor="s-cats" hint="Virgülle ayırın"><input id="s-cats" className={inputClass} value={f.categories} onChange={set("categories")} /></Field>
      <p aria-live="polite" className="text-xs text-muted">{state === "saving" ? "Kaydediliyor…" : state === "saved" ? "Kaydedildi" : state === "error" ? "Kaydedilemedi — alanları kontrol edin" : ""}</p>
    </div>
  );
}
