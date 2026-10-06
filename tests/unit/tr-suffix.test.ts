import { describe, expect, it } from "vitest";
import { trOfCount } from "@/lib/format";

describe("sayı + iyelik/bulunma eki", () => {
  it("okunuşun son kelimesine göre doğru ek", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(trOfCount)).toEqual(["0'ında", "1'inde", "2'sinde", "3'ünde", "4'ünde", "5'inde", "6'sında", "7'sinde", "8'inde", "9'unda"]);
    expect([10, 20, 30, 40, 50, 60, 70, 80, 90].map(trOfCount)).toEqual(["10'unda", "20'sinde", "30'unda", "40'ında", "50'sinde", "60'ında", "70'inde", "80'inde", "90'ında"]);
    expect([36, 100, 300, 1000, 2000].map(trOfCount)).toEqual(["36'sında", "100'ünde", "300'ünde", "1000'inde", "2000'inde"]);
  });
});
