"use client";

import { useActionState, useState } from "react";
import type { ConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import type { EstadoConfigPagamento } from "@/pagamentos/acoes-painel";
import styles from "../formularios.module.css";

const nota = { fontSize: "0.8125rem", color: "var(--scl-texto-2)", margin: 0 } as const;

type Props = {
  config: ConfigPagamentoSite;
  /** Categorias de despesa ativas. */
  categorias: readonly { id: string; nome: string }[];
  nomeEmpresa: string;
  /** Limites e nomes vindos do servidor (a regra mora em configuracoes/pagamento-site). */
  limiteNome: number;
  visiveis: number;
  categoriaPadrao: string;
  /** Cartão (M8.2b): o teto de parcelas do Mercado Pago e as opções da verificação do banco, com os textos do servidor. */
  parcelasLimite: number;
  /** Cancelamento (M8.2c): o máximo de horas do não comparecimento (a regra mora em configuracoes/pagamento-site). */
  horasLimite: number;
  opcoesTresDS: readonly { valor: string; texto: string }[];
  /**
   * Disputa do pagamento (M8.2e): o nome da categoria criada no primeiro uso, os limites dos dias de aviso e os campos de
   * cada causa (nome e frase; na fraude, também as frases pela verificação do banco e do Pix), com os nomes de campo do
   * servidor (`campoDaCausa`) e o texto em vigor.
   */
  disputa?: {
    categoriaPadrao: string;
    dias: { min: number; max: number; padrao: number };
    causas: readonly { codigo: string; titulo: string; campos: readonly { nome: string; rotulo: string; valor: string; limite: number }[] }[];
  };
  /** financeiro:editar; sem ela, só leitura. */
  editar: boolean;
  salvar: (a: EstadoConfigPagamento, f: FormData) => Promise<EstadoConfigPagamento>;
};

/**
 * Configurações → Pagamento no site (M8.2a): oferecer ou não o pagamento no site, o cartão de crédito (M8.2b: ligado ou
 * não, o máximo de parcelas e a verificação do banco), o nome na fatura (para o cartão; vazio = o nome da empresa), a
 * categoria da despesa da taxa que o Mercado Pago não devolve e, no cancelamento (M8.2c), o pedido pelo hóspede em Minha
 * reserva e a tolerância do não comparecimento. Vale para as tentativas novas. M8.2e: a disputa do pagamento — a categoria
 * da perda, os dias de aviso antes do prazo dos documentos e o nome e a frase de cada causa (tudo auditado ao salvar).
 */
export function FormPagamentoSite({ config, categorias, nomeEmpresa, limiteNome, visiveis, categoriaPadrao, parcelasLimite, horasLimite, opcoesTresDS, disputa, editar, salvar }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  const [nome, setNome] = useState(estado.valores?.nomeFatura ?? config.nomeFatura ?? "");
  const naFatura = (nome.trim() || nomeEmpresa).slice(0, visiveis);
  const erro = (k: keyof ConfigPagamentoSite) =>
    estado.erros?.[k] ? (
      <span className={styles.erro} id={`erro-${k}`}>
        {estado.erros[k]}
      </span>
    ) : null;
  const categoriaEscolhida = config.categoriaTaxaId && categorias.some((c) => c.id === config.categoriaTaxaId) ? config.categoriaTaxaId : "";
  const categoriaDaDisputa = config.categoriaDaContestacao && categorias.some((c) => c.id === config.categoriaDaContestacao) ? config.categoriaDaContestacao : "";
  const erroDe = (k: string) => (estado.erros as Record<string, string | undefined> | undefined)?.[k];
  return (
    <form key={JSON.stringify(config)} action={enviar} className={styles.form} aria-label="Pagamento no site">
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      <fieldset disabled={!editar} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <label className={styles.check}>
          <input type="checkbox" name="oferecer" defaultChecked={estado.valores ? estado.valores.oferecer === "on" : config.oferecer} /> Oferecer pagamento no site
        </label>
        <p style={nota}>
          Desligado, o site volta ao pedido pela conversa nos pedidos novos. O que já foi pago continua sendo conferido, e pode ser devolvido, normalmente.
        </p>
        <label className={styles.check}>
          <input type="checkbox" name="cartao" defaultChecked={estado.valores ? estado.valores.cartao === "on" : config.cartao} /> Oferecer cartão de crédito
        </label>
        <p style={nota}>
          Ao lado do Pix (que continua em destaque), só com &ldquo;Oferecer pagamento no site&rdquo; ligado. Só crédito: débito e pré-pago não são
          aceitos. Os juros do parcelamento são do Mercado Pago e pagos pelo hóspede (o formulário mostra o total antes de confirmar); a SCL nunca
          oferece &ldquo;parcelamento sem acréscimo&rdquo; — deixe essa opção desligada no Mercado Pago.
        </p>
        <label>
          Número máximo de parcelas
          <input
            name="parcelasMaximas"
            type="number"
            min={1}
            max={parcelasLimite}
            inputMode="numeric"
            placeholder="máximo do Mercado Pago"
            defaultValue={estado.valores ? estado.valores.parcelasMaximas ?? "" : config.parcelasMaximas ?? ""}
            aria-invalid={estado.erros?.parcelasMaximas ? true : undefined}
            aria-describedby={estado.erros?.parcelasMaximas ? "erro-parcelasMaximas" : undefined}
          />
          {erro("parcelasMaximas")}
        </label>
        <p style={nota}>Vazio = o máximo que o Mercado Pago oferecer para o cartão (até {parcelasLimite}).</p>
        <label>
          Verificação do banco (3DS)
          <select name="tresDS" defaultValue={estado.valores?.tresDS ?? config.tresDS} aria-invalid={estado.erros?.tresDS ? true : undefined}>
            {opcoesTresDS.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </select>
          {erro("tresDS")}
        </label>
        <label>
          Nome na fatura (cartão)
          <input
            name="nomeFatura"
            maxLength={limiteNome}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={nomeEmpresa.slice(0, limiteNome)}
            aria-invalid={estado.erros?.nomeFatura ? true : undefined}
            aria-describedby={estado.erros?.nomeFatura ? "erro-nomeFatura" : undefined}
          />
          {erro("nomeFatura")}
        </label>
        <p style={nota}>
          Até {limiteNome} caracteres (letras, números, espaço, ponto e hífen). Vazio, vale o nome da empresa. A fatura costuma mostrar só os primeiros {visiveis}:{" "}
          <strong>{naFatura}</strong>
        </p>
        <label>
          Categoria da taxa do pagamento
          <select name="categoriaTaxaId" defaultValue={estado.valores?.categoriaTaxaId ?? categoriaEscolhida} aria-invalid={estado.erros?.categoriaTaxaId ? true : undefined}>
            <option value="">Criar &ldquo;{categoriaPadrao}&rdquo; no primeiro uso</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          {erro("categoriaTaxaId")}
        </label>
        {config.categoriaTaxaId && !categoriaEscolhida && (
          <p role="note" className={styles.alerta} style={{ margin: 0 }}>
            A categoria escolhida antes foi arquivada ou não existe mais: escolha outra (ou deixe criar no primeiro uso).
          </p>
        )}
        <p style={nota}>
          Quando um pagamento sem reserva é devolvido, a parte da taxa que o Mercado Pago não devolve vira despesa da empresa nesta categoria, só depois da
          confirmação e com o valor que ele informar.
        </p>
        <label className={styles.check}>
          <input
            type="checkbox"
            name="pedidoCancelamentoNoPortal"
            defaultChecked={estado.valores ? estado.valores.pedidoCancelamentoNoPortal === "on" : config.pedidoCancelamentoNoPortal}
          />{" "}
          Hóspede pode pedir o cancelamento em Minha reserva (reservas pagas pelo site)
        </label>
        <p style={nota}>
          O hóspede só pede: a data e a hora em que o pedido chegou ficam registradas na hora, e quem cuida do financeiro faz o cancelamento no painel, com a
          devolução pela política que ele aceitou.
        </p>
        <label>
          Não comparecimento: horas depois do horário de entrada
          <input
            name="naoComparecimentoHoras"
            type="number"
            min={0}
            max={horasLimite}
            inputMode="numeric"
            defaultValue={estado.valores ? (estado.valores.naoComparecimentoHoras ?? "") : config.naoComparecimentoHoras}
            aria-invalid={estado.erros?.naoComparecimentoHoras ? true : undefined}
            aria-describedby={estado.erros?.naoComparecimentoHoras ? "erro-naoComparecimentoHoras" : undefined}
          />
          {erro("naoComparecimentoHoras")}
        </label>
        <p style={nota}>
          Só depois disso a equipe pode registrar que o hóspede não chegou e não avisou (ele pode chegar atrasado). Com entrada às 15:00, 21 horas = 12:00 do
          dia seguinte.
        </p>
        {disputa && (
          <fieldset aria-label="Disputa do pagamento" style={{ border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", padding: 12, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <legend style={{ fontSize: "0.9375rem" }}>Disputa do pagamento (contestação no cartão, MED do Pix, reclamação)</legend>
            <label>
              Categoria da perda por disputa do pagamento
              <select name="categoriaDaContestacao" defaultValue={estado.valores?.categoriaDaContestacao ?? categoriaDaDisputa} aria-invalid={erroDe("categoriaDaContestacao") ? true : undefined}>
                <option value="">Criar &ldquo;{disputa.categoriaPadrao}&rdquo; no primeiro uso</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
              {erro("categoriaDaContestacao")}
            </label>
            {config.categoriaDaContestacao && !categoriaDaDisputa && (
              <p role="note" className={styles.alerta} style={{ margin: 0 }}>
                A categoria escolhida antes foi arquivada ou não existe mais: escolha outra (ou deixe criar no primeiro uso).
              </p>
            )}
            <p style={nota}>A perda prevista e a definitiva da SCL numa disputa, a tarifa do Mercado Pago pela disputa e a taxa que não voltou entram como despesa da empresa nesta categoria.</p>
            <label>
              Dias de aviso antes do prazo dos documentos
              <input
                name="diasAvisoDocumentacao"
                type="number"
                min={disputa.dias.min}
                max={disputa.dias.max}
                inputMode="numeric"
                defaultValue={estado.valores ? (estado.valores.diasAvisoDocumentacao ?? "") : config.diasAvisoDocumentacao}
                aria-invalid={erroDe("diasAvisoDocumentacao") ? true : undefined}
                aria-describedby={erroDe("diasAvisoDocumentacao") ? "erro-diasAvisoDocumentacao" : undefined}
              />
              {erro("diasAvisoDocumentacao")}
            </label>
            <p style={nota}>
              De {disputa.dias.min} a {disputa.dias.max} (vazio = {disputa.dias.padrao}): a partir de quantos dias antes do prazo o Início pede atenção e a equipe recebe o e-mail.
            </p>
            <p style={nota}>
              Causas da decisão de quem arca: os códigos são fixos; o nome e a frase da regra de cada uma aparecem ao lado do formulário da decisão (o sistema nunca escolhe). Vazio = o texto-base.
            </p>
            {disputa.causas.map((c) => (
              <div key={c.codigo} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <strong style={{ fontSize: "0.875rem" }}>{c.titulo}</strong>
                {c.campos.map((f) => (
                  <label key={f.nome}>
                    {f.rotulo}
                    <input
                      name={f.nome}
                      maxLength={f.limite}
                      defaultValue={estado.valores?.[f.nome] ?? f.valor}
                      aria-invalid={erroDe(f.nome) ? true : undefined}
                      aria-describedby={erroDe(f.nome) ? `erro-${f.nome}` : undefined}
                    />
                    {erroDe(f.nome) && (
                      <span className={styles.erro} id={`erro-${f.nome}`}>
                        {erroDe(f.nome)}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
        )}
      </fieldset>
      {estado.ok && (
        <p role="status" className={styles.sucesso}>
          {estado.aviso ?? "Salvo."}
        </p>
      )}
      {editar ? (
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      ) : (
        <p style={nota}>Só quem edita o financeiro muda estas regras.</p>
      )}
    </form>
  );
}
