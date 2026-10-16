"use client"; // As páginas de erro do Next são componentes de cliente.

import { ErroNoPortal } from "@/components/portal/ErroNoPortal";
import { useAvisoDeErro } from "@/observabilidade/aviso-de-erro";

/**
 * Erro inesperado no portal do proprietário (M7.8): na moldura do portal, com "tente de novo" e a volta ao portal. O erro
 * vai para o Sentry, sem dados pessoais (M0.9).
 */
export default function ErroNoPortalDoProprietario({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useAvisoDeErro(error);
  return <ErroNoPortal titulo="Portal do proprietário" volta={{ href: "/portal", rotulo: "Voltar ao portal" }} digest={error.digest} retry={retry} />;
}
