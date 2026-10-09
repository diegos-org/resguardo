"use client";

import { useActionState } from "react";
import type { EstadoRegrasCalendario } from "@/calendario/acoes";
import { APLICACOES_ULTIMA_HORA, centesimosParaMultiplicador, dataBr, type RegrasCalendario } from "@/calendario/regras-config";
import type { FontePrecos } from "@/imoveis/fonte-precos";
import { DIAS_SEMANA } from "@/imoveis/regras-venda";
import styles from "../formularios.module.css";

export type ImovelOpcao = { id: string; codigo: string; nome: string; vinculado: boolean; /** Fonte de preços (M3.9): com "beds24" o SCL envia só calendário. */ fontePrecos?: FontePrecos };
type Props = { regras: RegrasCalendario; imoveis: ImovelOpcao[]; salvar: (a: EstadoRegrasCalendario, f: FormData) => Promise<EstadoRegrasCalendario> };

const grupo = { border: "1px solid var(--scl-areia)", borderRadius: 8, padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 12, margin: 0 };
const legenda = { fontWeight: 500, padding: "0 6px" };
const nota = { fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 };

export function FormRegrasCalendario({ regras, imoveis, salvar }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  const v = estado.valores;
  const campo = (k: string, atual: string) => (v ? String(v[k] ?? "") : atual);
  const marcado = (k: string, atual: boolean) => (v ? v[k] === "on" : atual);
  const naLista = (k: string, id: string, atual: readonly string[]) => (v ? ((v[k] as string[] | undefined) ?? []).includes(id) : atual.includes(id));
  const erro = (k: string) => (estado.erros?.[k] ? <span className={styles.erro}>{estado.erros[k]}</span> : null);
  const invalido = (k: string) => (estado.erros?.[k] ? { "aria-invalid": true as const } : {});
  const feriadosTexto = regras.feriados.map((f) => `${dataBr(f.data)} ${f.nome}`.trim()).join("\n");
  const faixa = (n: 1 | 2) => {
    const f = regras.ultimaHora.faixas[n - 1];
    return <div className={styles.linha} key={n}>
      <label>{n}ª faixa: de (dias antes da noite)<input name={`faixa${n}De`} type="number" min={0} max={60} defaultValue={campo(`faixa${n}De`, String(f.deDias))} {...invalido(`faixa${n}De`)} />{erro(`faixa${n}De`)}</label>
      <label>até (dias antes)<input name={`faixa${n}Ate`} type="number" min={0} max={60} defaultValue={campo(`faixa${n}Ate`, String(f.ateDias))} {...invalido(`faixa${n}Ate`)} />{erro(`faixa${n}Ate`)}</label>
      <label>desconto (%)<input name={`faixa${n}Pct`} type="number" min={0} max={90} defaultValue={campo(`faixa${n}Pct`, String(f.percentual))} {...invalido(`faixa${n}Pct`)} />{erro(`faixa${n}Pct`)}</label>
    </div>;
  };
  const listaImoveis = (nome: string, atual: readonly string[]) => <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
    {imoveis.map((i) => <label key={i.id} className={styles.check} style={{ flex: "0 0 auto", minWidth: 0 }}><input type="checkbox" name={nome} value={i.id} defaultChecked={naLista(nome, i.id, atual)} /> {i.codigo}{nome === "envioImoveis" && !i.vinculado ? " (sem vínculo Beds24)" : ""}{nome === "envioImoveis" && i.fontePrecos === "beds24" ? " (preços do Beds24: o SCL envia só calendário)" : nome === "envioImoveis" && i.fontePrecos === "manual" ? " (preços digitados no cadastro)" : ""}</label>)}
    {!imoveis.length && <span style={nota}>Nenhum imóvel ativo cadastrado.</span>}
  </div>;
  return <form key={JSON.stringify(regras)} action={enviar} className={styles.form} aria-label="Regras de calendário e preços">
    {estado.mensagem && <p role="alert" className={styles.alerta}>{estado.mensagem}</p>}
    <fieldset style={grupo}>
      <legend style={legenda}>Semana normal e limites</legend>
      <p style={nota}>Estadia mínima pela noite de entrada. O cadastro de cada imóvel pode exigir mais (vale o maior); períodos especiais do imóvel substituem.</p>
      <div className={styles.linha}>
        {DIAS_SEMANA.map((d, n) => <label key={d} style={{ minWidth: 80, flex: "0 1 100px" }}>{d}<input name={`minimo_${n}`} type="number" min={1} max={30} defaultValue={campo(`minimo_${n}`, String(regras.minimoPorDia[n]))} {...invalido(`minimo_${n}`)} />{erro(`minimo_${n}`)}</label>)}
      </div>
      <div className={styles.linha}>
        <label>Estadia máxima padrão (noites)<input name="estadiaMaxima" type="number" min={1} max={364} defaultValue={campo("estadiaMaxima", String(regras.estadiaMaxima))} {...invalido("estadiaMaxima")} />{erro("estadiaMaxima")}</label>
        <label>Horizonte do envio (noites a partir de hoje)<input name="horizonteDias" type="number" min={7} max={540} defaultValue={campo("horizonteDias", String(regras.horizonteDias))} {...invalido("horizonteDias")} />{erro("horizonteDias")}</label>
      </div>
    </fieldset>
    <fieldset style={grupo}>
      <legend style={legenda}>Feriados e feriadões</legend>
      <p style={nota}>Um feriado por linha: data e nome (ex.: 02/11/2026 Finados). Feriado na quinta: janela de quarta a domingo; sexta: quinta a domingo; segunda: sexta a segunda; terça: sexta a terça. Quarta, sábado e domingo não criam janela. Confira as datas de cada ano em fonte confiável — o sistema não as adivinha.</p>
      <label>Feriados<textarea name="feriados" rows={6} defaultValue={campo("feriados", feriadosTexto)} {...invalido("feriados")} />{erro("feriados")}</label>
      <div className={styles.linha}>
        <label>Mínimo de noites no feriadão<input name="feriadoMinimo" type="number" min={1} max={30} defaultValue={campo("feriadoMinimo", String(regras.janelaFeriado.estadiaMinima))} {...invalido("feriadoMinimo")} />{erro("feriadoMinimo")}</label>
        <label>Multiplicador do preço base (ex.: 2 = o dobro)<input name="feriadoMultiplicador" inputMode="decimal" defaultValue={campo("feriadoMultiplicador", centesimosParaMultiplicador(regras.janelaFeriado.multiplicador))} {...invalido("feriadoMultiplicador")} />{erro("feriadoMultiplicador")}</label>
      </div>
      <label className={styles.check}><input type="checkbox" name="feriadoTodos" defaultChecked={marcado("feriadoTodos", regras.janelaFeriado.todosImoveis)} /> Aplicar os feriadões a todos os imóveis</label>
      <p style={nota}>Ou escolha os imóveis (Búzios tem regra própria e pode ficar de fora):</p>
      {listaImoveis("feriadoImoveis", regras.janelaFeriado.imoveis)}
    </fieldset>
    <fieldset style={grupo}>
      <legend style={legenda}>Última hora</legend>
      <p style={nota}>Desconto pela antecedência da noite (D0 = a própria noite de hoje). O piso de cada faixa fica no cadastro de cada imóvel: a diária final nunca fica abaixo dele. As faixas não podem se cruzar.</p>
      <label>Quem aplica o desconto<select name="ultimaHoraModo" defaultValue={campo("ultimaHoraModo", regras.ultimaHora.aplicadoPor)} {...invalido("ultimaHoraModo")}>{Object.entries(APLICACOES_ULTIMA_HORA).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>{erro("ultimaHoraModo")}</label>
      {faixa(1)}{faixa(2)}
    </fieldset>
    <fieldset style={grupo}>
      <legend style={legenda}>Envio ao Beds24</legend>
      <p style={nota}>Só os imóveis marcados recebem calendário e preços do SCL — comece pelo imóvel de teste (103). Imóvel com preços definidos no Beds24 (fonte escolhida no cadastro do imóvel) recebe só calendário, mínimos e bloqueios: o SCL não escreve preço nele. Mesmo marcados, nada é enviado enquanto a variável BEDS24_ESCRITA não estiver &quot;ligada&quot; na Vercel. Simular e enviar ficam em Calendário → Conferir calendário e preços.</p>
      {listaImoveis("envioImoveis", regras.envio.imoveis)}
      <label className={styles.check}><input type="checkbox" name="envioAutomatico" defaultChecked={marcado("envioAutomatico", regras.envio.automatico)} /> Enviar automaticamente todo dia às 7h (depois da importação do Beds24)</label>
      <p style={nota}>Deixe desligado até o teste manual no imóvel escolhido estar conferido. O envio automático respeita a mesma lista de imóveis e o mesmo sinal da Vercel.</p>
    </fieldset>
    <fieldset style={grupo}>
      <legend style={legenda}>Site público (disponibilidade e cotação)</legend>
      <p style={nota}>O site considera uma noite disponível só com leitura recente do Beds24 (unidades livres) e sem reserva ou bloqueio no SCL. Leitura mais antiga que o prazo abaixo vira &quot;a confirmar&quot;. O valor mostrado usa os mesmos preços que vão ao Beds24 (com última hora e taxas do imóvel).</p>
      <div className={styles.linha}>
        <label>Validade da leitura do Beds24 (horas)<input name="siteValidadeHoras" type="number" min={1} max={720} defaultValue={campo("siteValidadeHoras", String(regras.site.validadeLeituraHoras))} {...invalido("siteValidadeHoras")} />{erro("siteValidadeHoras")}</label>
        <label>Máximo de noites por consulta online<input name="siteMaximoNoites" type="number" min={1} max={364} defaultValue={campo("siteMaximoNoites", String(regras.site.maximoNoitesConsulta))} {...invalido("siteMaximoNoites")} />{erro("siteMaximoNoites")}</label>
        <label>Minutos que &quot;segurar as datas&quot; reserva no site<input name="siteMinutosHold" type="number" min={5} max={240} defaultValue={campo("siteMinutosHold", String(regras.site.minutosHold))} {...invalido("siteMinutosHold")} />{erro("siteMinutosHold")}</label>
      </div>
      <p style={nota}>Ao segurar as datas, o visitante cria um pedido que ocupa o calendário por esse tempo (padrão 30 minutos). Se a equipe não confirmar nem o pagamento acontecer até lá, o pedido vence sozinho e as noites voltam à venda.</p>
      <p style={nota}>Com o pagamento no site ligado, cada Pix segura as datas por pelo menos 30 minutos (até 3 por cotação, um de cada vez).</p>
    </fieldset>
    {estado.ok && <p role="status" className={styles.sucesso}>{estado.aviso ?? "Salvo."}</p>}
    <div className={styles.acoes}><button type="submit" disabled={enviando}>{enviando ? "Salvando…" : "Salvar regras"}</button></div>
  </form>;
}
