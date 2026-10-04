import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Comprovante do repasse (M4.10): até 5 MB pelo formulário, mais a sobra do multipart.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
