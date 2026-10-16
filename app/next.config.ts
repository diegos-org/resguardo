import type { NextConfig } from "next";
import { regrasForaDosBuscadores } from "./src/site/fora-dos-buscadores";
import { MARCA_PADRAO } from "./src/site/marca";
import { politicaDaPaginaDePagamento } from "./src/site/politica-de-frames";

const nextConfig: NextConfig = {
  compiler: {
    // M0.9: o pacote do Sentry sem a parte de medição de desempenho (desligada em src/observabilidade/sentry.ts) e sem as
    // mensagens de depuração, o mesmo que o withSentryConfig faria: menos código em toda página. Booleanos, não textos
    // (um texto "false" contaria como verdadeiro).
    define: { __SENTRY_TRACING__: false, __SENTRY_DEBUG__: false },
  },
  experimental: {
    // Comprovante do repasse (M4.10): até 5 MB pelo formulário, mais a sobra do multipart.
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [
      // Página da cotação, onde o hóspede paga (M8.2a): nenhum outro site pode enquadrá-la (contra clique disfarçado); ela
      // só enquadra o Mercado Pago (formulário do cartão e desafio do banco, M8.2b).
      {
        source: "/reservar/:path*",
        headers: [
          { key: "Content-Security-Policy", value: politicaDaPaginaDePagamento() },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      // Páginas pessoais e internas fora dos buscadores (M7.10); a lista fica em src/site/fora-dos-buscadores.ts. As
      // regras se somam: a cotação recebe as duas.
      ...regrasForaDosBuscadores(),
    ];
  },
  async rewrites() {
    return [
      // M7.18: o navegador pede /favicon.ico sozinho quando a página não declara ícone (um PDF, uma foto aberta direto).
      // Recebe o arquivo da marca do estudo, o mesmo ícone do layout raiz (src/site/icone.ts), sem passar pela página não
      // encontrada nem pelo banco.
      { source: "/favicon.ico", destination: MARCA_PADRAO },
    ];
  },
};

export default nextConfig;
