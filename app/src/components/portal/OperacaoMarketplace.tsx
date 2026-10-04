"use client";

import { useActionState, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { Periodos } from "@/components/imoveis/Periodos";
import type { EstadoPeriodo } from "@/imoveis/acoes";
import { EXPLICACAO_FONTE_PRECOS, type FontePrecos, NOMES_FONTE_PRECOS } from "@/imoveis/fonte-precos";
import { DIAS_SEMANA, type Periodo } from "@/imoveis/regras-venda";
import { centavosParaCampo, reaisParaCentavos } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
import { type PrecosMarketplace, simular } from "@/marketplace/precos";
import type { EstadoPrecosPortal, EstadoSimplesPortal } from "@/portal/acoes";
import type { LimpezaDoProprietario, ManutencaoDoProprietario, SituacaoEnvio } from "@/portal/marketplace";
import f from "../formularios.module.css";
import styles from "./portal.module.css";

/** O que o portal mostra e edita de cada imóvel marketplace (só os campos do portal; o resto do cadastro fica no painel). */
export type ImovelOperavel = {
  id: string;
  codigo: string;
  nome: string;
  /** Hoje no fuso do imóvel: a data de um serviço não passa disso (o servidor confere pela mesma régua). */
  hoje: string;
  /** Desde quando o imóvel é dele (AAAA-MM-DD): a data de um serviço não vem antes disso. */
  desde: string | null;
  fontePrecos: FontePrecos;
  regras: {
    precoBase: number | null;
    taxaLimpeza: number | null;
    hospedeExtraValor: number | null;
    hospedeExtraAPartirDe: number | null;
    estadiaMinima: number | null;
    estadiaMaxima: number | null;
    antecedenciaMinima: number | null;
    janelaMaxima: number | null;
    diasChegada: readonly number[];
    diasSaida: readonly number[];
    checkinAPartirDe: string;
    checkoutAte: string;
  };
  periodos: (Periodo & { id: string })[];
  envio: SituacaoEnvio;
};

type AcaoPrecos = (a: EstadoPrecosPortal, f: FormData) => Promise<EstadoPrecosPortal>;
type AcaoSimples = (a: EstadoSimplesPortal, f: FormData) => Promise<EstadoSimplesPortal>;
type Props = {
  imoveis: ImovelOperavel[];
  precos: PrecosMarketplace;
  limpezas: LimpezaDoProprietario[];
  manutencoes: ManutencaoDoProprietario[];
  empresa: string;
  salvarPrecos: AcaoPrecos;
  novoPeriodo: (a: EstadoPeriodo, f: FormData) => Promise<EstadoPeriodo>;
  excluirPeriodo: (f: FormData) => Promise<void>;
  marcarLimpeza: AcaoSimples;
  registrarManutencao: AcaoSimples;
};

const dataBr = (d: string) => d.split("-").reverse().join("/");
const quando = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d);
const NOMES_SITUACAO_ENVIO: Record<string, string> = { ok: "concluído", parcial: "concluído com pendências", erro: "com erro", ocupada: "não rodou (ocupado)", desligada: "desligado", incerto: "incerto", executando: "em andamento" };
const ESTADO_LIMPEZA = { pedida: "A fazer", confirmada: "A fazer", realizada: "Feita" } as const;

/**
 * O envio de calendário (M3.7) leva só isto às OTAs; o resto do cadastro vale apenas no site. Com os preços
 * definidos no Beds24 (M3.9), o envio não manda preço nenhum (a SCL só lê os preços de lá): vão só as estadias.
 */
const vaiAsOtas = (fonte: FontePrecos) => (fonte === "beds24" ? "estadias mínima e máxima" : "preço da noite e estadias mínima e máxima");
const oQueFica = (fonte: FontePrecos) => (fonte === "beds24" ? "as estadias anteriores" : "o preço e as estadias anteriores");
const SO_NO_SITE = "taxa de limpeza, hóspede extra, antecedência, janela de reservas, dias e horários de entrada e saída valem só no site";
const PRECO_NO_BEDS24 = "o preço da noite é definido no Beds24 e vem de lá para o site e para as OTAs";
const maiuscula = (t: string) => `${t[0].toUpperCase()}${t.slice(1)}`;

/** O que falta para o envio alcançar as OTAs de fato (lista, vínculo com o Beds24, chave de escrita); vazio = pronto. */
function oQueFaltaNoEnvio(e: SituacaoEnvio, empresa: string): string | null {
  if (!e.naLista) return `a ${empresa} incluir este imóvel no envio de calendário`;
  if (!e.vinculado) return `a ${empresa} vincular este imóvel ao Beds24 (propriedade e quarto, em Integrações) — sem o vínculo, o envio pula o imóvel`;
  if (!e.escritaPronta) return `a ${empresa} ligar a escrita no Beds24 (sinal e credencial) — hoje o envio só simula, nada sai`;
  return null;
}

/** Mensagem depois de salvar: promete Airbnb/Booking só para o que o envio carrega para esta fonte de preços, e só se o envio está de fato pronto. */
export function textoSalvo(e: SituacaoEnvio, empresa: string, fonte: FontePrecos = "scl"): string {
  const extra = fonte === "beds24" ? `; ${PRECO_NO_BEDS24}` : "";
  const falta = oQueFaltaNoEnvio(e, empresa);
  return falta === null
    ? `Salvo. Vale no site da ${empresa} agora. ${maiuscula(vaiAsOtas(fonte))} chegam ao Airbnb e ao Booking no próximo envio de calendário; ${SO_NO_SITE}${extra}.`
    : `Salvo. Vale no site da ${empresa} agora. Airbnb e Booking continuam com ${oQueFica(fonte)} até ${falta}; ${SO_NO_SITE}${extra}.`;
}

/** Explica, sem supor, se (e o que) do que o proprietário mudou chega às OTAs, conforme a fonte de preços e a prontidão real do envio. */
export function textoDoEnvio(e: SituacaoEnvio, empresa: string, fonte: FontePrecos = "scl"): string {
  const extra = fonte === "beds24" ? ` ${maiuscula(PRECO_NO_BEDS24)}.` : "";
  const falta = oQueFaltaNoEnvio(e, empresa);
  if (falta !== null) return `O que você mudar aqui vale no site da ${empresa}, mas o Airbnb e o Booking continuam com o calendário e ${oQueFica(fonte)} até ${falta}. Em qualquer caso, ${SO_NO_SITE}.${extra}`;
  const ultimo = e.ultimo ? ` Último envio: ${quando(e.ultimo.em)} (${NOMES_SITUACAO_ENVIO[e.ultimo.situacao] ?? e.ultimo.situacao}).` : " Ainda não houve envio para este imóvel.";
  return `${e.automatico ? `O envio ao Beds24 roda todo dia e leva ${vaiAsOtas(fonte)} ao Airbnb e ao Booking` : `O envio ao Beds24 é feito pela ${empresa}: até ele rodar, o Airbnb e o Booking continuam com ${oQueFica(fonte)}`}; ${SO_NO_SITE}.${extra}${ultimo}`;
}

/** Linha da simulação do modelo B (M12.1) para o preço de uma noite. */
export function textoDaSimulacao(precoNoite: number, precos: PrecosMarketplace, empresa: string): string {
  const s = simular(precoNoite, precos);
  return `Com ${formatBRL(precoNoite)} por noite: no Airbnb você receberia ${formatBRL(s.airbnb.proprietarioRecebe)}; no site da ${empresa} o hóspede paga ${formatBRL(s.site.hospedePaga)} (${formatBRL(s.site.desconto)} a menos), você recebe ${formatBRL(s.site.proprietarioRecebe)} e a ${empresa} fica com ${formatBRL(s.site.scl)}.`;
}

function FormPrecos({ imovel, precos, empresa, salvar }: { imovel: ImovelOperavel; precos: PrecosMarketplace; empresa: string; salvar: AcaoPrecos }) {
  const [estado, enviar, enviando] = useActionState(salvar, {} as EstadoPrecosPortal);
  const v = estado.valores;
  const r = imovel.regras;
  const campo = (k: keyof typeof r, atual: string) => (v ? String(v[k] ?? "") : atual);
  const dinheiro = (k: "precoBase" | "taxaLimpeza" | "hospedeExtraValor") => campo(k, centavosParaCampo(r[k]));
  const numero = (k: "hospedeExtraAPartirDe" | "estadiaMinima" | "estadiaMaxima" | "antecedenciaMinima" | "janelaMaxima") => campo(k, r[k] === null ? "" : String(r[k]));
  const naLista = (k: "diasChegada" | "diasSaida", dia: number) => (v ? ((v[k] as string[] | undefined) ?? []).includes(String(dia)) : r[k].includes(dia));
  const erro = (k: string) => (estado.erros?.[k] ? <span className={f.erro}>{estado.erros[k]}</span> : null);
  const invalido = (k: string) => (estado.erros?.[k] ? { "aria-invalid": true as const } : {});
  const [precoDigitado, setPrecoDigitado] = useState(dinheiro("precoBase"));
  const centavos = reaisParaCentavos(precoDigitado);
  const precoNoBeds24 = imovel.fontePrecos === "beds24";
  return (
    <form key={JSON.stringify(imovel.regras)} action={enviar} className={f.form} aria-label={`Preços e regras de venda do ${imovel.codigo}`}>
      <input type="hidden" name="imovelId" value={imovel.id} />
      <strong>Preços e regras de venda</strong>
      <p className={styles.miudo}>
        {NOMES_FONTE_PRECOS[imovel.fontePrecos]}. {EXPLICACAO_FONTE_PRECOS[imovel.fontePrecos]}
      </p>
      {estado.mensagem && (
        <p role="alert" className={f.alerta}>
          {estado.mensagem}
        </p>
      )}
      {estado.ok && (
        <p role="status" className={f.sucesso}>
          {textoSalvo(imovel.envio, empresa, imovel.fontePrecos)}
        </p>
      )}
      <div className={f.linha}>
        <label>
          Preço da noite (R$){precoNoBeds24 ? " — definido no Beds24" : ""}
          <input name="precoBase" inputMode="decimal" value={precoDigitado} onChange={(ev) => setPrecoDigitado(ev.target.value)} readOnly={precoNoBeds24} placeholder="ex.: 350,00" {...invalido("precoBase")} />
          {erro("precoBase")}
        </label>
        <label>
          Taxa de limpeza (R$)
          <input name="taxaLimpeza" inputMode="decimal" defaultValue={dinheiro("taxaLimpeza")} placeholder="ex.: 150,00" {...invalido("taxaLimpeza")} />
          {erro("taxaLimpeza")}
        </label>
        <label>
          Hóspede extra (R$ por noite)
          <input name="hospedeExtraValor" inputMode="decimal" defaultValue={dinheiro("hospedeExtraValor")} placeholder="ex.: 50,00" {...invalido("hospedeExtraValor")} />
          {erro("hospedeExtraValor")}
        </label>
        <label>
          A partir de quantos hóspedes
          <input name="hospedeExtraAPartirDe" inputMode="numeric" defaultValue={numero("hospedeExtraAPartirDe")} placeholder="ex.: 3" {...invalido("hospedeExtraAPartirDe")} />
          {erro("hospedeExtraAPartirDe")}
        </label>
      </div>
      <p className={styles.miudo} aria-live="polite">
        {precoNoBeds24
          ? `Como o preço vem do Beds24, o site da ${empresa} lê o valor de cada noite de lá — a conta do que o hóspede paga e do que você recebe não dá para simular aqui com um preço fixo.`
          : centavos
            ? textoDaSimulacao(centavos, precos, empresa)
            : "Informe o preço da noite para ver o que o hóspede paga e o que você recebe no site."}
      </p>
      <div className={f.linha}>
        <label>
          Estadia mínima (noites)
          <input name="estadiaMinima" inputMode="numeric" defaultValue={numero("estadiaMinima")} {...invalido("estadiaMinima")} />
          {erro("estadiaMinima")}
        </label>
        <label>
          Estadia máxima (noites)
          <input name="estadiaMaxima" inputMode="numeric" defaultValue={numero("estadiaMaxima")} {...invalido("estadiaMaxima")} />
          {erro("estadiaMaxima")}
        </label>
        <label>
          Antecedência mínima (dias)
          <input name="antecedenciaMinima" inputMode="numeric" defaultValue={numero("antecedenciaMinima")} {...invalido("antecedenciaMinima")} />
          {erro("antecedenciaMinima")}
        </label>
        <label>
          Aceita reservas até (dias à frente)
          <input name="janelaMaxima" inputMode="numeric" defaultValue={numero("janelaMaxima")} {...invalido("janelaMaxima")} />
          {erro("janelaMaxima")}
        </label>
      </div>
      <div className={f.linha}>
        <label>
          Entrada a partir das
          <input name="checkinAPartirDe" type="time" defaultValue={campo("checkinAPartirDe", r.checkinAPartirDe)} {...invalido("checkinAPartirDe")} />
          {erro("checkinAPartirDe")}
        </label>
        <label>
          Saída até as
          <input name="checkoutAte" type="time" defaultValue={campo("checkoutAte", r.checkoutAte)} {...invalido("checkoutAte")} />
          {erro("checkoutAte")}
        </label>
      </div>
      {(["diasChegada", "diasSaida"] as const).map((k) => (
        <fieldset key={k} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className={styles.miudo}>{k === "diasChegada" ? "Entrada só nestes dias (nenhum marcado = qualquer dia)" : "Saída só nestes dias (nenhum marcado = qualquer dia)"}</legend>
          <div className={f.linha}>
            {DIAS_SEMANA.map((nome, dia) => (
              <label key={dia} className={f.check}>
                <input type="checkbox" name={k} value={dia} defaultChecked={naLista(k, dia)} /> {nome}
              </label>
            ))}
          </div>
          {erro(k)}
        </fieldset>
      ))}
      <div className={f.acoes}>
        <button type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar preços e regras"}
        </button>
      </div>
    </form>
  );
}

function Limpezas({ limpezas, marcar }: { limpezas: LimpezaDoProprietario[]; marcar: AcaoSimples }) {
  const [estado, enviar] = useActionState(marcar, {} as EstadoSimplesPortal);
  return (
    <section aria-label="Limpezas" className={styles.secao}>
      <h3>Limpezas por sua conta</h3>
      <p className={styles.miudo}>
        A cada saída de hóspede o sistema marca uma limpeza. Quando fizer, marque como feita (a partir do dia). Quando entra outro hóspede no mesmo dia, deixe pronto até a hora de entrada.
      </p>
      {estado.erro && (
        <p role="alert" className={styles.alerta}>
          {estado.erro}
        </p>
      )}
      {estado.ok && (
        <p role="status" className={styles.sucesso}>
          Limpeza marcada como feita.
        </p>
      )}
      {limpezas.length === 0 ? (
        <p className={styles.miudo}>Nenhuma limpeza dos últimos dias nem das próximas duas semanas.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Imóvel</th>
                <th>Reserva</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {limpezas.map((l) => (
                <tr key={l.id}>
                  <td>{dataBr(l.data)}</td>
                  <td>
                    {l.imovelCodigo} · {l.imovelNome}
                  </td>
                  <td>{l.reservaCodigo ?? "avulsa"}</td>
                  <td>
                    {ESTADO_LIMPEZA[l.estado]}
                    {l.atrasada ? " · atrasada" : ""}
                    {l.entraNoDia && l.estado !== "realizada" ? " · entra hóspede no mesmo dia" : ""}
                  </td>
                  <td>
                    {l.podeMarcar && (
                      <form action={enviar}>
                        <input type="hidden" name="id" value={l.id} />
                        <BotaoConfirmar className={f.pequeno} pergunta={`Marcar a limpeza de ${dataBr(l.data)} (${l.imovelCodigo}) como feita?`}>
                          Marcar como feita
                        </BotaoConfirmar>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Manutencoes({ imoveis, manutencoes, registrar }: { imoveis: ImovelOperavel[]; manutencoes: ManutencaoDoProprietario[]; registrar: AcaoSimples }) {
  const [estado, enviar, enviando] = useActionState(registrar, {} as EstadoSimplesPortal);
  const v = estado.valores ?? {};
  // "Hoje" é o do imóvel escolhido (cada um no seu fuso): o servidor recusa data futura pela mesma régua.
  const [imovelId, setImovelId] = useState(v.imovelId ?? imoveis[0]?.id ?? "");
  const escolhido = imoveis.find((i) => i.id === imovelId) ?? imoveis[0];
  const hoje = escolhido?.hoje ?? "";
  const desde = escolhido?.desde ?? undefined;
  return (
    <section aria-label="Manutenção" className={styles.secao}>
      <h3>Manutenção por sua conta</h3>
      <p className={styles.miudo}>Registre aqui os consertos e serviços que você fez no imóvel: fica no histórico dele, sem custo para a empresa.</p>
      {manutencoes.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {manutencoes.map((m) => (
            <li key={m.id}>
              {m.dataRealizada ? `${dataBr(m.dataRealizada)} · ` : ""}
              {m.imovelCodigo} · <strong>{m.titulo}</strong>
              {m.descricao ? ` — ${m.descricao}` : ""}
              {m.porContaPropria ? "" : ` (${m.estado}, pela empresa)`}
            </li>
          ))}
        </ul>
      )}
      <form key={manutencoes.length} action={enviar} className={f.form} aria-label="Registrar manutenção feita">
        {estado.erro && (
          <p role="alert" className={f.alerta}>
            {estado.erro}
          </p>
        )}
        {estado.ok && (
          <p role="status" className={f.sucesso}>
            Manutenção registrada.
          </p>
        )}
        <div className={f.linha}>
          <label>
            Imóvel
            <select name="imovelId" value={imovelId} onChange={(e) => setImovelId(e.target.value)} required>
              {imoveis.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.codigo} · {i.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            Data do serviço
            <input type="date" name="data" defaultValue={v.data ?? hoje} min={desde} max={hoje} required />
          </label>
          <label className={f.largo}>
            O que foi feito
            <input name="titulo" required maxLength={200} defaultValue={v.titulo ?? ""} placeholder="ex.: troca do chuveiro" />
          </label>
        </div>
        <label>
          Detalhes (opcional)
          <textarea name="descricao" rows={2} maxLength={1000} defaultValue={v.descricao ?? ""} />
        </label>
        <div className={f.acoes}>
          <button type="submit" disabled={enviando}>
            {enviando ? "Registrando…" : "Registrar manutenção feita"}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Seção "Seu imóvel no marketplace" do portal (M12.4): preços e regras de venda com a simulação do
 * modelo B, períodos especiais, situação do envio ao Beds24, limpezas e manutenção por conta própria.
 * Só aparece para quem tem imóvel em contrato marketplace em vigor (decidido no servidor).
 */
export function OperacaoMarketplace({ imoveis, precos, limpezas, manutencoes, empresa, salvarPrecos, novoPeriodo, excluirPeriodo, marcarLimpeza, registrarManutencao }: Props) {
  if (!imoveis.length) return null;
  return (
    <section aria-label="Seu imóvel no marketplace" className={styles.secao}>
      <h2>Seu imóvel no marketplace</h2>
      <p className={styles.miudo}>
        No marketplace você cuida da parte física (limpeza, reposição, chaves, consertos) e define os preços e as regras de venda; a {empresa} cuida do anúncio, das reservas, do site e do
        atendimento. O site da {empresa} vende pelo seu preço com o desconto do site por cima — a conta aparece abaixo de cada preço.
      </p>
      {imoveis.map((i) => (
        <article key={i.id} className={styles.caixa} aria-label={`${i.codigo} · ${i.nome}`}>
          <p className={styles.olho}>{i.codigo}</p>
          <h3 style={{ margin: "4px 0 8px" }}>{i.nome}</h3>
          <p className={styles.miudo} role="note">
            {textoDoEnvio(i.envio, empresa, i.fontePrecos)}
          </p>
          <FormPrecos imovel={i} precos={precos} empresa={empresa} salvar={salvarPrecos} />
          <Periodos imovelId={i.id} periodos={i.periodos} criar={novoPeriodo} excluir={excluirPeriodo} semPreco={i.fontePrecos === "beds24"} />
        </article>
      ))}
      <Limpezas limpezas={limpezas} marcar={marcarLimpeza} />
      <Manutencoes imoveis={imoveis} manutencoes={manutencoes} registrar={registrarManutencao} />
    </section>
  );
}
