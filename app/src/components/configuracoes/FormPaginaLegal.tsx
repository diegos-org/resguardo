"use client";

import Link from "next/link";
import { useActionState, useDeferredValue, useEffect, useRef, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import { DocumentoLegal } from "@/components/site/DocumentoLegal";
import siteStyles from "@/components/site/site.module.css";
import type { EstadoForm } from "@/configuracoes/acoes";
import { versaoBaseDoFormulario } from "@/configuracoes/documentos-versionados";
import {
  blocosDoDocumento,
  CAMPOS_LEGAIS,
  type CampoLegal,
  citaBeds24,
  conferirCampos,
  DIAS_REEMBOLSO_MAX,
  DIAS_REEMBOLSO_MIN,
  type DocumentoLegal as Documento,
  MENSAGEM_ARREPENDIMENTO_SEM_LIMITE,
  MENSAGEM_SEM_PRAZO,
  mensagemDosCampos,
  PAGINAS_LEGAIS,
  preencherCampos,
  textoLimitaArrependimento,
} from "@/configuracoes/paginas-legais-texto";
import styles from "../formularios.module.css";

type Props = {
  documento: Documento;
  /** Versão publicada agora; null = nada publicado (o formulário traz o texto-base). */
  atual: { numero: number; data: string } | null;
  /** Texto de cada seção do documento que o formulário mostra ao abrir. */
  valores: Record<string, string>;
  /** Prazo do reembolso integral em dias (só na Política de cancelamento). */
  dias: number | null;
  /**
   * O arrependimento vale só até o horário de entrada (só na Política de cancelamento): o da versão em vigor, com o padrão
   * (a versão 1, sem o campo, abre marcada), ou o do texto-base. null fora da política.
   */
  arrependimentoAteEntrada?: boolean | null;
  /** Dados de Configurações → Empresa que o texto pode usar, com o valor de agora ("" = não preenchido). */
  campos: { chave: CampoLegal; rotulo: string; valor: string }[];
  salvar: (a: EstadoForm, f: FormData) => Promise<EstadoForm>;
};

const br = (d: string) => d.split("-").reverse().join("/");
const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;
const PRAZO_PADRAO = 14;

const SAIR = "Sair sem publicar? O texto mudado aqui se perde.";

/**
 * Clique que tira desta tela na mesma aba: um link para outra página (abas de Configurações, menu do painel, os links
 * daqui). Não contam o que abre em outra aba ou janela, o que baixa um arquivo e o link que só rola esta página (#).
 */
function cliqueQueSai(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!a || a.hasAttribute("download") || !["", "_self"].includes(a.getAttribute("target") ?? "")) return false;
  const destino = new URL(a.getAttribute("href") ?? "", window.location.href);
  if (destino.protocol !== "http:" && destino.protocol !== "https:") return false;
  return !(destino.hash && mesmaPagina(destino, new URL(window.location.href)));
}

const mesmaPagina = (a: URL, b: URL) => a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;

/** Prazo digitado, se for um número inteiro de dias dentro do limite (a mesma conferência da publicação). */
function diasDoCampo(t: string): number | null {
  const n = /^\d{1,3}$/.test(t.trim()) ? Number(t.trim()) : Number.NaN;
  return n >= DIAS_REEMBOLSO_MIN && n <= DIAS_REEMBOLSO_MAX ? n : null;
}

/**
 * Texto de uma página legal do site (M7.4): o texto (e, na Política de cancelamento, o resumo e o prazo do reembolso
 * integral), a prévia de como fica no site com os dados da empresa de agora, o que impede publicar e a publicação, que
 * cria a versão seguinte datada de hoje. Nada é guardado antes de publicar: sair da tela com o texto mudado (link do
 * painel, Voltar do navegador, fechar ou recarregar) pede confirmação.
 */
export function FormPaginaLegal({ documento, atual, valores, dias, arrependimentoAteEntrada = null, campos, salvar }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  const def = PAGINAS_LEGAIS[documento];
  const cancelamento = documento === "cancelamento";
  const diasIniciais = cancelamento ? String(dias ?? PRAZO_PADRAO) : "";
  // Sem valor vindo do servidor, vale o padrão da regra (com o limite).
  const limiteInicial = arrependimentoAteEntrada ?? true;
  const [secoes, setSecoes] = useState<Record<string, string>>(() => Object.fromEntries(def.secoes.map((s) => [s.chave, valores[s.chave] ?? ""])));
  const [diasTexto, setDiasTexto] = useState(diasIniciais);
  const [limiteArrependimento, setLimiteArrependimento] = useState(limiteInicial);
  // Diego já confirmou sair sem publicar (não pergunta de novo no caminho); volta a proteger quando ele edita outra vez.
  const saidaConfirmada = useRef(false);
  const alterado =
    def.secoes.some((s) => (secoes[s.chave] ?? "").trim() !== (valores[s.chave] ?? "").trim()) || diasTexto.trim() !== diasIniciais || (cancelamento && limiteArrependimento !== limiteInicial);

  // Sem rascunho guardado: sair com o texto mudado pede confirmação. Fechar ou recarregar passa pelo aviso do navegador;
  // os links do painel (<Link>, que trocam de tela sem recarregar) e o Voltar/Avançar do navegador não passam, e por isso
  // são parados aqui antes de o roteador agir.
  useEffect(() => {
    if (!alterado) return;
    saidaConfirmada.current = false;
    // Esta tela no histórico, para voltar a ela se Diego desistir de sair pelo Voltar do navegador.
    const aqui = { url: window.location.href, estado: window.history.state as unknown };
    const confirmar = () => {
      if (saidaConfirmada.current) return true;
      saidaConfirmada.current = window.confirm(SAIR);
      return saidaConfirmada.current;
    };
    const avisar = (e: BeforeUnloadEvent) => {
      if (saidaConfirmada.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // Na captura do documento: roda antes do <Link> (que ouve na raiz do React) e, se Diego desistir, ele nem fica sabendo.
    const clicar = (e: MouseEvent) => {
      if (!cliqueQueSai(e) || confirmar()) return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Na captura da janela: roda antes do roteador do Next. Desistiu? A tela volta para o histórico, como se não tivesse saído.
    const voltar = (e: PopStateEvent) => {
      if (mesmaPagina(new URL(window.location.href), new URL(aqui.url)) || confirmar()) return;
      e.stopImmediatePropagation();
      window.history.pushState(aqui.estado, "", aqui.url);
    };
    window.addEventListener("beforeunload", avisar);
    document.addEventListener("click", clicar, true);
    window.addEventListener("popstate", voltar, true);
    return () => {
      window.removeEventListener("beforeunload", avisar);
      document.removeEventListener("click", clicar, true);
      window.removeEventListener("popstate", voltar, true);
    };
  }, [alterado]);
  const editarSecao = (chave: string, valor: string) => {
    saidaConfirmada.current = false;
    setSecoes((atuais) => ({ ...atuais, [chave]: valor }));
  };
  const editarDias = (valor: string) => {
    saidaConfirmada.current = false;
    setDiasTexto(valor);
  };
  const editarLimite = (valor: boolean) => {
    saidaConfirmada.current = false;
    setLimiteArrependimento(valor);
  };

  // Valores que a publicação usaria agora: os da empresa e, no cancelamento, o prazo digitado.
  const prazo = cancelamento ? diasDoCampo(diasTexto) : null;
  const valoresAgora: Partial<Record<CampoLegal, string>> = Object.fromEntries(campos.filter((c) => c.valor.trim()).map((c) => [c.chave, c.valor.trim()]));
  if (prazo !== null) valoresAgora.dias_reembolso_integral = String(prazo);
  const conferencia = conferirCampos(documento, secoes, valoresAgora);
  // No cancelamento, o prazo inválido é avisado uma vez só, pelo próprio campo (e não também como "campo vazio" do texto).
  const impedimentos = [
    cancelamento && prazo === null ? `Informe um número de dias entre ${DIAS_REEMBOLSO_MIN} e ${DIAS_REEMBOLSO_MAX} para o reembolso integral.` : null,
    mensagemDosCampos(cancelamento ? { ...conferencia, vazios: conferencia.vazios.filter((k) => k !== "dias_reembolso_integral") } : conferencia),
    cancelamento && !conferencia.usados.includes("dias_reembolso_integral") ? MENSAGEM_SEM_PRAZO : null,
    cancelamento && !limiteArrependimento && textoLimitaArrependimento(secoes) ? MENSAGEM_ARREPENDIMENTO_SEM_LIMITE : null,
  ].filter((x): x is string => Boolean(x));
  const citaOBeds24 = def.secoes.some((s) => citaBeds24(secoes[s.chave] ?? ""));

  // Prévia: o texto como o site mostraria, com marcadores no lugar do que falta (só aqui no painel).
  const previa = useDeferredValue(secoes);
  const marcador = (campo: string) => {
    const c = CAMPOS_LEGAIS.find((x) => x.chave === campo);
    if (!c) return `[não existe: {{${campo}}}]`;
    if ("so" in c && c.so !== documento) return `[não vale aqui: {{${campo}}}]`;
    return `[falta: ${c.rotulo}]`;
  };
  const blocos = (texto: string) => blocosDoDocumento(preencherCampos(texto, valoresAgora, marcador));

  const proxima = (atual?.numero ?? 0) + 1;
  const doDocumento = documento === "termos" ? `dos ${def.titulo}` : `da ${def.titulo}`;
  const pergunta = atual
    ? `Publicar a versão ${proxima} ${doDocumento}? Ela passa a valer no site a partir de hoje: os próximos pagamentos pedem o aceite desta versão, e quem já aceitou a anterior continua com a anterior. Se nada mudou, nenhuma versão nova é criada.`
    : `Publicar a versão 1 ${doDocumento}? Ela passa a valer no site a partir de hoje, e os próximos pagamentos pedem o aceite desta versão.`;
  const textoParaCopiar = def.secoes.map((s) => (s.chave === "resumo" ? `## Resumo\n\n${secoes.resumo ?? ""}` : (secoes[s.chave] ?? ""))).join("\n\n");
  const erro = (k: string) =>
    estado.erros?.[k] ? (
      <span className={styles.erro} id={`erro-${k}`}>
        {estado.erros[k]}
      </span>
    ) : null;

  return (
    <form action={enviar} className={styles.form} aria-label={def.titulo} style={{ maxWidth: 960 }}>
      <input type="hidden" name="documento" value={documento} />
      <input type="hidden" name="versaoBase" value={versaoBaseDoFormulario(estado.valores, atual)} />
      {!atual ? (
        <p role="note" style={{ margin: 0, fontSize: "0.875rem", padding: "10px 14px", borderLeft: "3px solid var(--scl-dourado)", background: "var(--scl-papel)" }}>
          <strong>Nenhuma versão publicada: este é o texto-base.</strong> Foi escrito pelo Claude a partir da lei e do que o sistema faz, e ainda não foi conferido por um
          advogado: revise com o contador e, de preferência, um advogado antes de publicar. Até você publicar a versão 1, nada aparece no site (a página diz que está em
          preparação) e o pagamento pelo site fica desligado.
        </p>
      ) : (
        <p style={nota}>
          Versão {atual.numero}, publicada em {br(atual.data)}. Mudou alguma coisa? Ao publicar nasce a versão {proxima}, datada de hoje; quem já aceitou a versão {atual.numero}{" "}
          continua com ela.
        </p>
      )}
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      {cancelamento && (
        <label>
          Reembolso integral até quantos dias antes da entrada
          <input
            type="number"
            name="diasReembolsoIntegral"
            min={DIAS_REEMBOLSO_MIN}
            max={DIAS_REEMBOLSO_MAX}
            step={1}
            required
            value={diasTexto}
            onChange={(e) => editarDias(e.target.value)}
            style={{ maxWidth: 120 }}
            aria-invalid={estado.erros?.diasReembolsoIntegral ? true : undefined}
            aria-describedby={estado.erros?.diasReembolsoIntegral ? "erro-diasReembolsoIntegral" : undefined}
          />
          <span style={{ fontSize: "0.8125rem" }}>
            Entra no texto pelo campo {"{{dias_reembolso_integral}}"} e é o mesmo número que a devolução usa. Mudou? Publique: vale para os pagamentos de hoje em diante.
          </span>
          {erro("diasReembolsoIntegral")}
        </label>
      )}
      {cancelamento && (
        <label className={styles.check}>
          {/* Sem `checked` controlado: o formulário volta ao `defaultChecked` depois de cada envio, e ele é o que foi enviado. */}
          <input
            type="checkbox"
            name="arrependimentoAteEntrada"
            defaultChecked={estado.valores ? estado.valores.arrependimentoAteEntrada === "on" : limiteInicial}
            onChange={(e) => editarLimite(e.target.checked)}
            aria-invalid={estado.erros?.arrependimentoAteEntrada ? true : undefined}
            aria-describedby={estado.erros?.arrependimentoAteEntrada ? "erro-arrependimentoAteEntrada" : undefined}
          />{" "}
          O arrependimento vale só até o horário de entrada (como no texto-base). Desmarque só se o advogado tirar esse limite do texto — e ajuste o texto junto.
          {erro("arrependimentoAteEntrada")}
        </label>
      )}
      {def.secoes.map((s) => (
        <label key={s.chave}>
          {s.titulo}
          <textarea
            name={s.chave}
            rows={s.chave === "resumo" ? 8 : 30}
            maxLength={s.limite}
            value={secoes[s.chave] ?? ""}
            onChange={(e) => editarSecao(s.chave, e.target.value)}
            aria-invalid={estado.erros?.[s.chave] ? true : undefined}
            aria-describedby={estado.erros?.[s.chave] ? `erro-${s.chave}` : undefined}
          />
          <span style={{ fontSize: "0.8125rem" }}>
            {s.dica} Até {s.limite.toLocaleString("pt-BR")} caracteres ({(secoes[s.chave] ?? "").length.toLocaleString("pt-BR")} usados).
          </span>
          {erro(s.chave)}
        </label>
      ))}
      <div>
        <BotaoCopiar texto={textoParaCopiar} rotulo="Copiar o texto" className={styles.pequeno} />{" "}
        <span style={nota}>Para mandar ao contador ou ao advogado, com os campos {"{{…}}"} como estão.</span>
      </div>
      <section aria-label="Campos disponíveis" style={{ fontSize: "0.8125rem" }}>
        <strong>Campos disponíveis</strong> — escreva o campo no texto e ele vira o dado de agora, que fica guardado na versão publicada:
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {campos.map((c) => (
            <li key={c.chave}>
              <code>{`{{${c.chave}}}`}</code> — {c.rotulo}:{" "}
              {c.valor.trim() ? (
                c.valor.trim()
              ) : (
                <>
                  falta preencher em{" "}
                  <Link href="/painel/configuracoes/empresa">Configurações → Empresa</Link>
                </>
              )}
            </li>
          ))}
          {cancelamento && (
            <li>
              <code>{"{{dias_reembolso_integral}}"}</code> — dias para o reembolso integral: {prazo ?? "informe no campo acima"} (do campo acima; só nesta política)
            </li>
          )}
        </ul>
      </section>
      <details open>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Prévia de como fica no site</summary>
        <div style={{ marginTop: 10, padding: "14px 18px", border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", background: "var(--scl-branco)" }}>
          {cancelamento && previa.resumo?.trim() && (
            <section className={siteStyles.resumoLegal} aria-label="Prévia do resumo">
              <h2>Resumo</h2>
              <DocumentoLegal blocos={blocos(previa.resumo)} marcarFaltas />
            </section>
          )}
          <DocumentoLegal blocos={blocos(previa.texto ?? "")} marcarFaltas />
        </div>
      </details>
      {impedimentos.length > 0 && (
        <div role="note" className={styles.alerta} aria-label="O que impede publicar">
          <strong>Antes de publicar:</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {impedimentos.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {conferencia.vazios.some((k) => k !== "dias_reembolso_integral") && (
            <p style={{ margin: "4px 0 0" }}>
              <Link href="/painel/configuracoes/empresa">Abrir Configurações → Empresa</Link>{" "}
              para preencher.
            </p>
          )}
        </div>
      )}
      {citaOBeds24 && (
        <p role="note" style={{ margin: 0, fontSize: "0.875rem", padding: "10px 14px", borderLeft: "3px solid var(--scl-dourado)", background: "var(--scl-papel)" }}>
          O texto cita o Beds24: pela sua decisão de 7/10 (M5.9), o hóspede não vê esse nome. Se o advogado pedir para citar quem trata os dados, descreva o serviço (por
          exemplo, &ldquo;o sistema de gestão de reservas&rdquo;) em vez do nome. É só um aviso: dá para publicar assim.
        </p>
      )}
      {estado.ok && (
        <p role="status" className={styles.sucesso}>
          {estado.aviso ?? "Publicado."}
        </p>
      )}
      <div className={styles.acoes}>
        <BotaoConfirmar pergunta={pergunta} disabled={enviando}>
          {enviando ? "Publicando…" : `Publicar a versão ${proxima}`}
        </BotaoConfirmar>
      </div>
    </form>
  );
}
