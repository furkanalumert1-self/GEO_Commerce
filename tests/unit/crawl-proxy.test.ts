import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { crawlProxyFor, safeFetch } from "@/lib/http/safe-fetch";

describe("ülke tarama proxy'si", () => {
  afterEach(() => {
    delete process.env.CRAWL_PROXY_TR;
  });

  it("CRAWL_PROXY_<ÜLKE> yalnız geçerli http(s) adresiyle etkin", () => {
    expect(crawlProxyFor("TR")).toBeUndefined();
    process.env.CRAWL_PROXY_TR = "http://u:p@proxy.example:8080";
    expect(crawlProxyFor("TR")).toBe("http://u:p@proxy.example:8080");
    expect(crawlProxyFor("tr")).toBeUndefined();
    process.env.CRAWL_PROXY_TR = "socks5://x";
    expect(crawlProxyFor("TR")).toBeUndefined();
  });

  it("tünel yalnız genel IP'ye çözülen hedefe host adıyla açılır; kimlik bilgisi proxy başlığında gider", async () => {
    let seen: { path?: string; auth?: string } = {};
    const server = createServer();
    server.on("connect", (req, socket) => {
      seen = { path: req.url, auth: req.headers["proxy-authorization"] as string | undefined };
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(safeFetch("https://shop.example/", { proxy: `http://user:pa%3Ass@127.0.0.1:${port}`, resolver: async () => ["93.184.216.34"], timeoutMs: 3000 })).rejects.toThrow(/proxy/i);
      expect(seen.path).toBe("shop.example:443");
      expect(seen.auth).toBe(`Basic ${Buffer.from("user:pa:ss").toString("base64")}`);
    } finally {
      server.close();
    }
  });

  it("iç ağa çözülen hedef proxy olsa da reddedilir", async () => {
    await expect(safeFetch("https://intra.example/", { proxy: "http://127.0.0.1:9", resolver: async () => ["10.0.0.5"] })).rejects.toThrow(/İç ağ/);
  });
});
