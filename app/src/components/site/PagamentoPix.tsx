"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useActionState, useEffect, useRef, useSyncExternalStore } from "react";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import type { EstadoContinuar, EstadoPix } from "@/site/acoes-pagamento";
import { emEspera, type EstadoPagamentoHospede, type PagamentoDoHospede } from "@/site/pagamento-vista";
import styles from "./site.module.css";

/** A página consulta a situação a cada 5 s enquanto espera; depois de um "muitas consultas", espera 1 minuto. */
export const INTERVALO_ACOMPANHAMENTO_MS = 5_000;
export const ESPERA_DEPOIS_DO_LIMITE_MS = 60_000;

type AcaoPix = (estado: EstadoPix, form: FormData) => Promise<EstadoPix>;
type AcaoContinuar = (estado: EstadoContinuar, form: FormData) => Promise<EstadoContinuar>;

export type TextosPagamento = { convite: string; aguardando: string; semDatas: string };

const brl = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formato = (fuso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, ...o });
const quando = (iso: string, fuso: string) => formato(fuso, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const hora = (iso: string, fuso: string) => formato(fuso, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dia = (iso: string, fuso: string) => formato(fuso, { dateStyle: "short" }).format(new Date(iso));

/**
 * Acompanha o pagamento (M8.2a): enquanto a situação é de espera, consulta a rota da cotação a cada 5 s (a primeira
 * logo ao abrir, para a página conferir quem volta pelo link), pausa com a aba escondida e volta quando ela aparece.
 * Mudou a situação ou o "pode gerar outro Pix" (ex.: as travas voltaram depois de uma falha passageira): recarrega a
 * página (o servidor mostra o que vale agora); situação final: para.
 */
export function useAcompanharPagamento(codigo: string, estado: EstadoPagamentoHospede, podeGerar: boolean, ativo: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!ativo) return;
    let parado = false;
    let consultando = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Começa do que a página mostra; resposta sem `podeGerar` conta como sem mudança nele.
    const assinatura = (e: string, g: boolean) => `${e}|${g}`;
    let ultimo = assinatura(estado, podeGerar);
    let ultimoPodeGerar = podeGerar;
    const escondida = () => document.visibilityState === "hidden";
    const agendar = (ms: number) => {
      if (parado || timer || escondida()) return;
      timer = setTimeout(consultar, ms);
    };
    async function consultar() {
      timer = null;
      if (parado || consultando || escondida()) return;
      consultando = true;
      let proxima = INTERVALO_ACOMPANHAMENTO_MS;
      try {
        const r = await fetch(`/reservar/${encodeURIComponent(codigo)}/pagamento`, { cache: "no-store", headers: { accept: "application/json" } });
        if (r.status === 429) proxima = ESPERA_DEPOIS_DO_LIMITE_MS;
        else if (r.ok) {
          const j = (await r.json()) as { estado?: EstadoPagamentoHospede; podeGerar?: boolean };
          const gerar = typeof j.podeGerar === "boolean" ? j.podeGerar : ultimoPodeGerar;
          if (!parado && j.estado && assinatura(j.estado, gerar) !== ultimo) {
            ultimo = assinatura(j.estado, gerar);
            ultimoPodeGerar = gerar;
            if (!emEspera(j.estado)) parado = true;
            router.refresh();
          }
        }
      } catch {
        // Sem rede: tenta de novo na próxima volta.
      } finally {
        consultando = false;
      }
      agendar(proxima);
    }
    const aoMudarVisibilidade = () => {
      if (!escondida()) return agendar(0);
      if (timer) clearTimeout(timer);
      timer = null;
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    agendar(0);
    return () => {
      parado = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [codigo, estado, podeGerar, ativo, router]);
}

const assinarRelogio = (aviso: () => void) => {
  const t = setInterval(aviso, 1000);
  return () => clearInterval(t);
};
const segundoAtual = () => Math.floor(Date.now() / 1000);
const semRelogio = () => null;

/** Contagem até o fim do Pix (só no navegador: no servidor, só a hora). Venceu: recarrega a página uma vez. */
function Contagem({ ate }: { ate: string }) {
  const router = useRouter();
  const segundo = useSyncExternalStore(assinarRelogio, segundoAtual, semRelogio);
  const restante = segundo === null ? null : Math.ceil(Date.parse(ate) / 1000) - segundo;
  const venceu = restante !== null && restante <= 0;
  const recarregou = useRef(false);
  useEffect(() => {
    if (!venceu || recarregou.current) return;
    recarregou.current = true;
    router.refresh();
  }, [venceu, router]);
  if (restante === null) return null;
  if (venceu) return <> · venceu</>;
  return (
    <>
      {" "}
      (faltam {Math.floor(restante / 60)}:{String(restante % 60).padStart(2, "0")})
    </>
  );
}

function GerarPix({ acao, rotulo }: { acao: AcaoPix; rotulo: string }) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  return (
    <form action={enviar} className={styles.pixAcao}>
      <button type="submit" className={styles.botao} disabled={enviando}>
        {enviando ? "Gerando o Pix…" : rotulo}
      </button>
      {estado.erro && (
        <p role="alert" className={styles.aviso}>
          {estado.erro}
        </p>
      )}
    </form>
  );
}

/** "Continuar o pagamento" noutro aparelho: o e-mail usado ao segurar as datas. O e-mail digitado fica no navegador. */
function ContinuarPagamento({ codigo, acao }: { codigo: string; acao: AcaoContinuar }) {
  const [estado, enviar, enviando] = useActionState(async (_a: EstadoContinuar & { email?: string }, f: FormData): Promise<EstadoContinuar & { email?: string }> => {
    // O estado anterior não volta ao servidor; o e-mail digitado fica só aqui.
    const r = await acao({}, f);
    return { ...r, email: r.ok ? "" : String(f.get("email") ?? "") };
  }, {} as EstadoContinuar & { email?: string });
  return (
    <form action={enviar} className={styles.formulario} aria-label="Continuar o pagamento">
      <strong>Continuar o pagamento</strong>
      <p className={styles.miudo} style={{ margin: 0 }}>
        Para pagar neste aparelho, informe o e-mail usado ao segurar as datas.
      </p>
      <input type="hidden" name="codigo" value={codigo} />
      <label>
        E-mail
        <input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={estado.email ?? ""} />
      </label>
      {estado.erro && (
        <p role="alert" className={styles.aviso}>
          {estado.erro}
        </p>
      )}
      <button type="submit" className={styles.botao} disabled={enviando}>
        {enviando ? "Conferindo…" : "Continuar o pagamento"}
      </button>
    </form>
  );
}

function QrDoPix({ pix }: { pix: NonNullable<PagamentoDoHospede["pix"]> }) {
  if (pix.imagem) {
    return (
      <div className={styles.pixQr}>
        {/* QR em data: (gerado pelo Mercado Pago, sem arquivo para otimizar). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pix.imagem} alt="QR code do Pix" width={220} height={220} />
      </div>
    );
  }
  if (pix.link) {
    return (
      <p className={styles.pixQr}>
        <a href={pix.link} className={`${styles.botao} ${styles.botaoContorno}`} target="_blank" rel="noopener noreferrer">
          Abrir o Pix no Mercado Pago
        </a>
      </p>
    );
  }
  return null;
}

/** Pix aguardando, com a autorização: copia e cola primeiro (no celular), o QR, o prazo e "pode fechar e voltar". */
function PixAguardando({ pix, textos, fuso, total }: { pix: NonNullable<PagamentoDoHospede["pix"]>; textos: TextosPagamento; fuso: string; total: number }) {
  return (
    <>
      <p className={styles.texto}>{textos.aguardando}</p>
      <p className={styles.pixValor}>
        Valor: <strong>{brl(total)}</strong>
      </p>
      <div className={styles.pixCodigos}>
        <div className={styles.pixCopia}>
          <span className={styles.pixRotulo} id="pix-copia-e-cola">
            Pix copia e cola
          </span>
          <p className={styles.pixCodigo} aria-labelledby="pix-copia-e-cola">
            {pix.copiaECola}
          </p>
          <BotaoCopiar texto={pix.copiaECola} rotulo="Copiar o código do Pix" className={styles.botao} />
        </div>
        <QrDoPix pix={pix} />
      </div>
      {pix.expiraEm && (
        <p className={styles.texto}>
          Este Pix vale até <strong>{hora(pix.expiraEm, fuso)}</strong>
          <Contagem ate={pix.expiraEm} />.
        </p>
      )}
      <p className={styles.miudo}>Pode fechar e voltar por este link: a página confirma sozinha quando o pagamento chegar.</p>
    </>
  );
}

/**
 * O pagamento por Pix na página da cotação (M8.2a, design "O que o hóspede vê"): convite e "Gerar Pix", Pix
 * aguardando (copia e cola, QR, prazo), vencido, esgotado, conferindo, recebido, confirmado, sem as datas e
 * devolução. Sem a autorização do pedido (cookie), mostra só a situação e "Continuar o pagamento". O servidor
 * decide tudo; aqui só se mostra e se acompanha. `contato` é o botão para falar com a equipe (opção secundária).
 */
export function PagamentoPix({
  codigo,
  pagamento: v,
  autorizado,
  fuso,
  total,
  textos,
  contato,
  gerarPix,
  continuar,
}: {
  codigo: string;
  pagamento: PagamentoDoHospede;
  autorizado: boolean;
  fuso: string;
  total: number;
  textos: TextosPagamento;
  contato: ReactNode;
  gerarPix: AcaoPix;
  continuar: AcaoContinuar;
}) {
  useAcompanharPagamento(codigo, v.estado, v.podeGerar, emEspera(v.estado));
  const prazo = v.holdAte ? (
    <p className={styles.texto}>
      As datas estão seguradas para você até <strong>{quando(v.holdAte, fuso)}</strong>.
    </p>
  ) : null;
  const outraOpcao = contato ? (
    <div className={styles.pixOutraOpcao}>
      <span className={styles.miudo}>Prefere combinar com a equipe?</span>
      {contato}
    </div>
  ) : null;
  const pagarOuContinuar = (rotulo: string) => (autorizado ? <GerarPix acao={gerarPix} rotulo={rotulo} /> : <ContinuarPagamento codigo={codigo} acao={continuar} />);

  switch (v.estado) {
    case "pagar":
      return (
        <section className={styles.pix} aria-label="Pagamento por Pix">
          <h3>Pague com Pix</h3>
          <p className={styles.texto}>{textos.convite}</p>
          <p className={styles.pixValor}>
            Valor: <strong>{brl(total)}</strong>
          </p>
          {prazo}
          {pagarOuContinuar("Gerar Pix")}
          {outraOpcao}
        </section>
      );
    case "pix_aguardando":
      return (
        <section className={styles.pix} aria-label="Pagamento por Pix">
          <h3>Pix gerado</h3>
          {autorizado && v.pix ? (
            <PixAguardando pix={v.pix} textos={textos} fuso={fuso} total={total} />
          ) : (
            <>
              <p className={styles.texto}>Há um Pix desta cotação aguardando pagamento. A página atualiza sozinha quando o pagamento chegar.</p>
              {prazo}
              {!autorizado && <ContinuarPagamento codigo={codigo} acao={continuar} />}
            </>
          )}
          {outraOpcao}
        </section>
      );
    case "pix_vencido":
      return (
        <section className={styles.pix} aria-label="Pagamento por Pix">
          <h3>O Pix venceu</h3>
          {v.podeGerar ? (
            <>
              <p className={styles.texto}>
                O Pix venceu sem pagamento, mas as datas continuam seguradas. Gere outro para pagar
                {v.pixRestantes > 0 ? ` (ainda dá para gerar ${v.pixRestantes})` : ""}.
              </p>
              {prazo}
              {pagarOuContinuar("Gerar outro Pix")}
              {outraOpcao}
            </>
          ) : (
            <>
              <p className={styles.texto}>O Pix venceu sem pagamento, e o pagamento pelo site não está disponível agora. As datas continuam seguradas: para reservar, fale com a equipe.</p>
              {prazo}
              {contato}
            </>
          )}
        </section>
      );
    case "pix_esgotado":
      return (
        <section className={`${styles.pix} ${styles.pixAtencao}`} aria-label="Pagamento por Pix">
          <p className={styles.texto}>Esta cotação já gerou o máximo de Pix sem pagamento. Para reservar, fale com a equipe.</p>
          {prazo}
          {contato}
        </section>
      );
    case "verificando":
      return (
        <section className={styles.pix} aria-label="Pagamento por Pix" aria-live="polite">
          <p className={styles.texto}>Estamos conferindo o pagamento com o Mercado Pago. A página atualiza sozinha; pode fechar e voltar por este link.</p>
          {outraOpcao}
        </section>
      );
    case "confirmando":
      return (
        <section className={`${styles.pix} ${styles.pixOk}`} aria-label="Pagamento por Pix" aria-live="polite">
          <p className={styles.texto}>
            <strong>Pagamento recebido, confirmando sua reserva.</strong> A página atualiza sozinha em instantes.
          </p>
        </section>
      );
    case "confirmada":
      return (
        <section className={`${styles.pix} ${styles.pixOk}`} aria-label="Pagamento por Pix" aria-live="polite">
          <p className={styles.texto}>
            <strong>Pagamento aprovado: reserva {v.reservaCodigo ?? ""} confirmada.</strong>
          </p>
          <p className={styles.texto}>Guarde este link. Os detalhes da estadia ficam em Minha reserva, com o e-mail usado ao segurar as datas.</p>
          {v.pagamentoEmDobro && <p className={styles.aviso}>Recebemos mais de um pagamento desta cotação: a equipe vai devolver o valor pago a mais.</p>}
          <p>
            <a href="/hospede" className={styles.botao}>
              Minha reserva
            </a>
          </p>
        </section>
      );
    case "aprovado_sem_datas":
      return (
        <section className={`${styles.pix} ${styles.pixAtencao}`} aria-label="Pagamento por Pix">
          <p className={styles.texto}>{textos.semDatas}</p>
          {contato}
        </section>
      );
    case "devolucao_pedida":
      return (
        <section className={`${styles.pix} ${styles.pixAtencao}`} aria-label="Pagamento por Pix">
          <p className={styles.texto}>
            Pedimos a devolução do valor integral ao Mercado Pago{v.devolucao?.em ? ` em ${dia(v.devolucao.em, fuso)}` : ""}. Ela pode levar alguns dias para aparecer na sua conta.
          </p>
          {contato}
        </section>
      );
    case "devolvido":
      return (
        <section className={styles.pix} aria-label="Pagamento por Pix">
          <p className={styles.texto}>O valor do pagamento foi devolvido{v.devolucao?.em ? ` em ${dia(v.devolucao.em, fuso)}` : ""}.</p>
          {contato}
        </section>
      );
    default:
      return null;
  }
}
