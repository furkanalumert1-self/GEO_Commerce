import { sha256 } from "@/lib/crypto";
import { ProviderError, type AiAnswer, type AiMonitorAdapter, type EngineKey } from "./types";

/**
 * Deterministik fixture adapter — yalnız DEMO_MODE ve testlerde. Dış çağrı ve harcama yok.
 * Hayali marka evreni (.example alan adları); gerçek markaya performans atfedilmez.
 */
export const FIXTURE_UNIVERSE = [
  { name: "Luma Bakım", domain: "lumabakim.example" },
  { name: "Nora Cilt", domain: "noracilt.example" },
  { name: "Vera Derma", domain: "veraderma.example" },
  { name: "Pera Kozmetik", domain: "perakozmetik.example" },
];

const THIRD_PARTY = ["https://guzellikrehberi.example/nemlendirici-karsilastirma", "https://ciltforum.example/konu/hassas-cilt", "https://kozmetikhaber.example/2026/serum-trendleri", "https://yorumlar.example/marka/luma-bakim"];

/** [0,1) deterministik değer. */
export function unit(seed: string): number {
  return parseInt(sha256(seed).slice(0, 8), 16) / 0x100000000;
}

const ENGINE_BIAS: Record<string, number> = { chatgpt: 0.08, gemini: -0.05, perplexity: 0.02 };

export function fixtureAnswer(engine: EngineKey, prompt: string, repetition = 1): AiAnswer {
  const seed = `${engine}|${prompt}|${repetition}`;
  // Seçili prompt'larda deterministik başarısızlık (coverage ve "başarısız ≠ düşüş" senaryosu için).
  if (unit(`${seed}|fail`) < 0.04) throw new ProviderError("Fixture geçici hata", true, 1000, "http_503");
  const bias = ENGINE_BIAS[engine] ?? 0;
  const present = FIXTURE_UNIVERSE.filter((b, i) => unit(`${seed}|${b.domain}`) < (i === 0 ? 0.42 + bias : 0.55 - i * 0.05 + bias));
  const order = [...present].sort((a, b) => unit(`${seed}|o|${a.domain}`) - unit(`${seed}|o|${b.domain}`));
  const asList = unit(`${seed}|list`) < 0.6 && order.length >= 2;
  const lines: string[] = [`"${prompt}" sorusu için öne çıkan seçenekler:`];
  if (asList) order.forEach((b, i) => lines.push(`${i + 1}. ${b.name} — hassas ciltler için içerik ve fiyat dengesiyle öne çıkıyor.`));
  else if (order.length) lines.push(`${order.map((b) => b.name).join(", ")} sık anılan markalar arasında. Seçim yaparken içerik listesini kontrol edin.`);
  else lines.push("Belirli bir marka öne çıkmıyor; içerik listesi ve cilt tipinize uygunluğu karşılaştırın.");
  const urls: string[] = [];
  for (const b of order) if (unit(`${seed}|cite|${b.domain}`) < 0.45) urls.push(`https://${b.domain}/urunler/${Math.floor(unit(`${seed}|p|${b.domain}`) * 30) + 1}`);
  for (const t of THIRD_PARTY) if (unit(`${seed}|tp|${t}`) < 0.3) urls.push(t);
  return {
    provider: "fixture",
    engine,
    model: `fixture-${engine}-v1`,
    surface: "api_grounded",
    text: lines.join("\n"),
    urls,
    latencyMs: 0,
    costMicros: 0n,
    supportsCitations: true,
    raw: { fixture: true },
  };
}

export function createFixtureAdapter(engine: EngineKey): AiMonitorAdapter {
  return {
    engine,
    provider: "fixture",
    surface: "api_grounded",
    status: () => "demo",
    statusReason: () => "Örnek veri modu — dış çağrı yapılmaz",
    ask: async (input) => fixtureAnswer(engine, input.prompt),
  };
}
