import type { Metadata } from "next";
import { FaixaPrevia } from "@/components/FaixaPrevia";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCL — Sua Casa Leblon",
  description: "Sistema de gestão da Sua Casa Leblon",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>
        {/* M7.12: "Prévia de teste" no topo de toda página, só fora do deploy de produção. */}
        <FaixaPrevia />
        {children}
      </body>
    </html>
  );
}
