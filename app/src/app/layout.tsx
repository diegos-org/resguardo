import type { Metadata, Viewport } from "next";
import { FaixaPrevia } from "@/components/FaixaPrevia";
import { TEMA } from "@/relatorios/tema";
import { ICONES_PADRAO } from "@/site/icone";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCL — Sua Casa Leblon",
  description: "Sistema de gestão da Sua Casa Leblon",
  // M7.18: a marca do estudo na aba e no atalho do celular (painel, portal do proprietário, telas de acesso e de erro).
  // As páginas do site trocam pela marca enviada em Configurações → Site, quando ela serve de ícone (src/site/icone.ts).
  icons: ICONES_PADRAO,
};

/** M7.18: a barra do navegador no celular no verde do site (o token --scl-floresta, pelo valor em TEMA). */
export const viewport: Viewport = {
  themeColor: TEMA.floresta,
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
