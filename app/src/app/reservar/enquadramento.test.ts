import { expect, it } from "vitest";
import nextConfig from "../../../next.config";

it("a página da cotação (onde o hóspede paga) não pode ser enquadrada por outro site (M8.2a); o resto da configuração continua", async () => {
  const regras = await nextConfig.headers!();
  const reservar = regras.find((r) => r.source === "/reservar/:path*");
  expect(reservar?.headers).toEqual([
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    { key: "X-Frame-Options", value: "DENY" },
  ]);
  expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("6mb");
});
