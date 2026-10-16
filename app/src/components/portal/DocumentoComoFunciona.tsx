import { secoesParaMostrar, type VersaoComoFunciona } from "@/configuracoes/como-funciona";
import { dataBr, dataHoraNoFuso } from "@/lib/datas";
import type { DadosDoProprietario } from "@/portal/dados-contrato";
import styles from "./portal.module.css";

export type DonoNoDocumento = {
  nome: string;
  /** Aceite da versão atual (por qualquer usuário deste proprietário). */
  aceite: { aceitoEm: Date; email: string } | null;
  /** Último aceite de qualquer versão. */
  ultimo: { versao: number; aceitoEm: Date } | null;
};

type Props = {
  versao: VersaoComoFunciona;
  empresa: string;
  dados: (DadosDoProprietario & { nome: string })[];
  donos: DonoNoDocumento[];
  /** Ação do botão "Registrar o meu aceite"; sem ela (pré-visualização), o formulário não aparece. */
  aceitar?: (f: FormData) => Promise<void>;
  mensagem?: { tipo: "ok" | "erro"; texto: string } | null;
};

/** O "Como funciona" como o proprietário lê (M5.6): texto por seção, quadro "Seus dados" e o aceite. */
export function DocumentoComoFunciona({ versao, empresa, dados, donos, aceitar, mensagem }: Props) {
  const pendentes = donos.filter((d) => !d.aceite);
  return (
    <article aria-label="Como funciona" className={styles.secao} style={{ gap: 24 }}>
      <p className={styles.rotulo} style={{ margin: 0 }}>
        Versão {versao.numero}, de {dataBr(versao.data)}
      </p>
      {secoesParaMostrar(versao, empresa).map((s) => (
        <section key={s.chave} className={styles.secao} aria-label={s.titulo}>
          <h2>{s.titulo}</h2>
          {s.paragrafos.map((p, i) => (
            <p key={i} style={{ margin: 0 }}>
              {p}
            </p>
          ))}
        </section>
      ))}
      {dados.length > 0 && (
        <section className={styles.caixa} aria-label="Seus dados" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2>Seus dados</h2>
          {dados.map((d) => (
            <div key={d.proprietarioId} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {dados.length > 1 && <strong>{d.nome}</strong>}
              {d.imoveis.length === 0 ? (
                <p style={{ margin: 0 }}>Nenhum imóvel ligado ao seu cadastro ainda.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {d.imoveis.map((i) => (
                    <li key={i.codigo}>
                      {i.codigo} · {i.nome}:{" "}
                      {i.contrato ? `${i.contrato.tipo}${i.contrato.comissao ? `, comissão de ${i.contrato.comissao}` : ""}, desde ${dataBr(i.contrato.desde)}` : "sem contrato em vigor hoje"}
                    </li>
                  ))}
                </ul>
              )}
              {d.periodicidade && (
                <p style={{ margin: 0 }}>
                  Repasses: <strong>{d.periodicidade.nome}</strong> — {d.periodicidade.descricao}
                  {d.periodicidade.escolha ? "" : " (padrão do contrato; você pode mudar no portal, em Extrato e repasses)"}.
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      <section className={styles.caixa} aria-label="Aceite" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2>Aceite</h2>
        {mensagem && (
          <p role={mensagem.tipo === "erro" ? "alert" : "status"} className={mensagem.tipo === "erro" ? styles.alerta : styles.sucesso}>
            {mensagem.texto}
          </p>
        )}
        {donos.map((d) => (
          <p key={d.nome} style={{ margin: 0 }}>
            {d.aceite
              ? `${d.nome}: versão ${versao.numero} aceita em ${dataHoraNoFuso(d.aceite.aceitoEm)} (${d.aceite.email}).`
              : d.ultimo
                ? `${d.nome}: a versão ${d.ultimo.versao} foi aceita em ${dataHoraNoFuso(d.ultimo.aceitoEm)}; o texto mudou em ${dataBr(versao.data)} — leia e aceite a versão ${versao.numero}.`
                : `${d.nome}: ainda sem aceite.`}
          </p>
        ))}
        {aceitar && pendentes.length > 0 && (
          <form action={aceitar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="hidden" name="versao" value={versao.numero} />
            <label className={styles.opcao}>
              <input type="checkbox" name="aceito" required /> Li o documento &ldquo;Como funciona&rdquo; (versão {versao.numero}, de {dataBr(versao.data)}) e aceito as condições descritas.
            </label>
            <div>
              <button type="submit" className={styles.botao}>
                Registrar o meu aceite
              </button>
            </div>
          </form>
        )}
      </section>
    </article>
  );
}
