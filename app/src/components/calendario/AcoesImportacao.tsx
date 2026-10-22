"use client";

import { useActionState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import type { EstadoImportacao } from "@/calendario/acoes-importacao";
import styles from "../formularios.module.css";

type Acao = (a: EstadoImportacao, f: FormData) => Promise<EstadoImportacao>;
type Props = {
  imovelId: string;
  codigo: string;
  /** A assinatura da leitura revisada e as caixas "Usar como…" da conferência: a aprovação grava exatamente isto. */
  assinatura: string;
  usar: { precoBase: boolean; estadiaMaxima: boolean };
  /** Noites que a aprovação importa. */
  noites: number;
  /** Por que o botão "Aprovar e importar" não aparece (bloqueio, nada a importar, sem `imovel:editar`); null = aparece. */
  semAprovar: string | null;
  /** Noites importadas de hoje em diante (0 = nada a desfazer); com `imovel:editar`, o botão "Desfazer a importação" aparece. */
  importadas: number;
  podeDesfazer: boolean;
  aprovar: Acao;
  guardarCopia: Acao;
  desfazer: Acao;
};

function Resultado({ estado }: { estado: EstadoImportacao }) {
  if (estado.erro) return <p role="alert" className={styles.erro}>{estado.erro}</p>;
  return estado.mensagem ? <p role="status" className={styles.sucesso}>{estado.mensagem}</p> : null;
}

/** As ações da revisão da importação (M3.11a, 3.4): aprovar, guardar uma cópia agora e desfazer. */
export function AcoesImportacao({ imovelId, codigo, assinatura, usar, noites, semAprovar, importadas, podeDesfazer, aprovar, guardarCopia, desfazer }: Props) {
  const [aprovado, aprovarAgora, aprovando] = useActionState(aprovar, {});
  const [copiado, copiarAgora, copiando] = useActionState(guardarCopia, {});
  const [desfeito, desfazerAgora, desfazendo] = useActionState(desfazer, {});
  const ocupado = aprovando || copiando || desfazendo;
  return <section aria-label="Ações da importação" style={{ display: "grid", gap: 12 }}>
    <h3>Ações</h3>
    {semAprovar ? <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>{semAprovar}</p> : <form action={aprovarAgora} className={styles.form} aria-label="Aprovar e importar">
      <input type="hidden" name="imovelId" value={imovelId} />
      <input type="hidden" name="assinatura" value={assinatura} />
      <input type="hidden" name="usarPrecoBase" value={usar.precoBase ? "sim" : "nao"} />
      <input type="hidden" name="usarEstadiaMaxima" value={usar.estadiaMaxima ? "sim" : "nao"} />
      <div className={styles.acoes}>
        <BotaoConfirmar pergunta={`Importar ${noites} noites do Beds24 para o imóvel ${codigo}? Nada muda nas OTAs.`} disabled={ocupado}>{aprovando ? "Importando…" : "Aprovar e importar"}</BotaoConfirmar>
      </div>
      <Resultado estado={aprovado} />
    </form>}
    <form action={copiarAgora} className={styles.form} aria-label="Guardar uma cópia agora">
      <input type="hidden" name="imovelId" value={imovelId} />
      <div className={styles.acoes}><button type="submit" disabled={ocupado}>{copiando ? "Guardando…" : "Guardar uma cópia agora"}</button></div>
      <Resultado estado={copiado} />
    </form>
    {/* Depois de desfazer, a tela recarrega sem nada importado: o formulário fica para mostrar o resultado, sem o botão. */}
    {podeDesfazer && (importadas > 0 || Boolean(desfeito.mensagem || desfeito.erro)) && <form action={desfazerAgora} className={styles.form} aria-label="Desfazer a importação">
      <input type="hidden" name="imovelId" value={imovelId} />
      {importadas > 0 && <div className={styles.acoes}>
        <BotaoConfirmar pergunta={`Desfazer a importação do imóvel ${codigo}? As ${importadas} noites de hoje em diante voltam ao preço base e às regras.`} disabled={ocupado}>{desfazendo ? "Desfazendo…" : "Desfazer a importação"}</BotaoConfirmar>
      </div>}
      <Resultado estado={desfeito} />
    </form>}
  </section>;
}
