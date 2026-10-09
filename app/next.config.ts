import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Comprovante do repasse (M4.10): até 5 MB pelo formulário, mais a sobra do multipart.
    serverActions: { bodySizeLimit: "6mb" },
  },
  // Página da cotação, onde o hóspede paga (M8.2a): nenhum outro site pode enquadrá-la (contra clique disfarçado).
  async headers() {
    return [
      {
        source: "/reservar/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
