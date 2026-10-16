"use client";

import { type KeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { diasEntre, somarDias } from "@/imoveis/regras-venda";
import { DIAS_NA_ORDEM, posicaoNaSemana } from "@/lib/datas";
import {
  cruzaOcupada,
  dataCurta,
  dataISOValida,
  dataPorExtenso,
  type Datas,
  DIAS_DA_SEMANA_CURTOS,
  DIAS_SEMANA,
  escolherDia,
  type Etapa,
  inicioDoMes,
  limiteDoCalendario,
  mesesEntre,
  nomeDoMes,
  rotuloDoDia,
  semanasDoMes,
  situacaoDoDia,
  somarMeses,
} from "@/site/calendario";
import css from "./calendario.module.css";
import styles from "./site.module.css";

/**
 * Campo de datas do site (M7.6): "Entrada" e "Saída" num calendário próprio, no lugar do campo de data do
 * navegador. As datas seguem em campos escondidos (`entrada`, `saida`, AAAA-MM-DD), então o formulário GET
 * continua igual e o servidor confere tudo de novo (mínimo de noites, regras de venda, disponibilidade).
 *
 * Com o lugar conhecido (`imovel` fixo, ou o valor do `<select name={campoImovel}>` do mesmo formulário), o
 * calendário marca as noites ocupadas lidas de `/api/site/ocupacao`, mês a mês; falha nessa leitura não
 * aparece (o servidor confere depois). Dois meses lado a lado no computador; um mês, de baixo para cima,
 * no celular. Teclado: setas mudam o dia, Enter/Espaço escolhem, Esc fecha e o foco volta ao campo.
 */
export type PropsCampoDatas = {
  /** Hoje (AAAA-MM-DD) para o formulário; dias antes não são escolhidos. */
  hoje: string;
  entrada?: string;
  saida?: string;
  /** Código fixo do lugar; tem precedência sobre `campoImovel`. */
  imovel?: string;
  /** Nome do `<select>` do mesmo formulário cujo valor é o código do lugar (acompanhado quando muda). */
  campoImovel?: string;
  erroEntrada?: string;
  erroSaida?: string;
  variante?: "padrao" | "busca" | "lateral";
  /**
   * Cartão da página de uma casa (M7.9): o código dela. Com outra casa escolhida em `campoImovel`, o envio abre a página
   * da outra casa com as mesmas datas (`TrocaDeCasa`), que confere tudo de novo e diz se ela está indisponível; por isso,
   * nessa troca, a estadia não é desfeita quando a outra casa tem noite ocupada no meio (desfeita, o envio pararia aqui
   * para pedir a saída e a outra casa nunca abriria).
   */
  casaDaPagina?: string;
};

const CELULAR = "(max-width: 700px)";
const CODIGO = /^[\w-]{1,40}$/;

const assinarTela = (avisar: () => void) => {
  const m = typeof window.matchMedia === "function" ? window.matchMedia(CELULAR) : null;
  m?.addEventListener("change", avisar);
  return () => m?.removeEventListener("change", avisar);
};
const lerTela = () => typeof window.matchMedia === "function" && window.matchMedia(CELULAR).matches;

const maior = (a: string, b: string) => (a > b ? a : b);
const menor = (a: string, b: string) => (a < b ? a : b);

function Icone() {
  return (
    <svg className={css.icone} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3.5" y="5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function CampoDatas({ hoje, entrada = "", saida = "", imovel, campoImovel, erroEntrada, erroSaida, variante = "padrao", casaDaPagina }: PropsCampoDatas) {
  const id = useId();
  const inicial = dataISOValida(entrada) ? entrada : "";
  const [datas, setDatas] = useState<Datas>({ entrada: inicial, saida: inicial && dataISOValida(saida) && saida > inicial ? saida : "" });
  const [aberto, setAberto] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>("entrada");
  const [mes, setMes] = useState(inicioDoMes(hoje));
  const [foco, setFoco] = useState(hoje);
  const [previa, setPrevia] = useState<string | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);
  /** Noites ocupadas já lidas, por "código|mês". */
  const [ocupacao, setOcupacao] = useState<Record<string, readonly string[]>>({});

  const botaoEntrada = useRef<HTMLButtonElement>(null);
  const botaoSaida = useRef<HTMLButtonElement>(null);
  const campoEntrada = useRef<HTMLInputElement>(null);
  const campoSaida = useRef<HTMLInputElement>(null);
  const dialogo = useRef<HTMLDivElement>(null);
  const pedidos = useRef(new Map<string, Promise<readonly string[] | null>>());
  const origem = useRef<Etapa>("entrada");
  const focarDia = useRef(false);

  const celular = useSyncExternalStore(assinarTela, lerTela, () => false);
  const n = celular ? 1 : 2;

  // Lugar escolhido no `<select>` do mesmo formulário, acompanhado pelo evento "change".
  const seletor = useCallback(() => {
    const el = campoImovel ? botaoEntrada.current?.form?.elements.namedItem(campoImovel) : null;
    return el instanceof HTMLSelectElement ? el : null;
  }, [campoImovel]);
  const assinarLugar = useCallback(
    (avisar: () => void) => {
      const s = seletor();
      s?.addEventListener("change", avisar);
      return () => s?.removeEventListener("change", avisar);
    },
    [seletor],
  );
  const lugarDoFormulario = useSyncExternalStore(assinarLugar, () => seletor()?.value ?? "", () => "");
  const lugar = imovel ?? lugarDoFormulario;
  const comLugar = CODIGO.test(lugar);

  const limite = limiteDoCalendario(hoje);
  const ultimoDia = somarDias(limite, -1);
  const primeiroMes = inicioDoMes(hoje);
  const ultimoMes = somarMeses(limite, -n);
  const visiveis = Array.from({ length: n }, (_, i) => somarMeses(mes, i));
  const fimVisivel = somarMeses(mes, n);
  const ocupadas = new Set(comLugar ? Object.entries(ocupacao).flatMap(([k, v]) => (k.startsWith(`${lugar}|`) ? v : [])) : []);
  const contexto = { hoje, ocupadas, ultimoDia };
  const etapaAtual: Etapa = etapa === "saida" && datas.entrada ? "saida" : "entrada";
  // Dia que recebe o Tab na grade: o do foco, se está à vista; senão o primeiro dia escolhível à vista.
  const focoVisivel = foco >= mes && foco < fimVisivel ? foco : menor(maior(mes, hoje), ultimoDia);

  /** Outra casa escolhida no cartão da página de uma casa: o envio abre a página dela, e a estadia fica como está. */
  const trocaDeCasa = useCallback((cod: string) => !imovel && !!casaDaPagina && cod !== casaDaPagina, [imovel, casaDaPagina]);

  /** Lê (uma vez por lugar e mês) as noites ocupadas; erro de rede ou resposta estranha = nada marcado. */
  const pedirMes = useCallback(
    (cod: string, m: string): Promise<readonly string[] | null> => {
      const chave = `${cod}|${m}`;
      const ja = pedidos.current.get(chave);
      if (ja) return ja;
      const inicio = maior(m, hoje);
      const fim = somarMeses(m, 1);
      const p: Promise<readonly string[] | null> =
        inicio >= fim
          ? Promise.resolve([])
          : fetch(`/api/site/ocupacao?${new URLSearchParams({ imovel: cod, inicio, fim })}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((j: { ocupadas?: unknown } | null) => (Array.isArray(j?.ocupadas) ? j.ocupadas.filter((d): d is string => typeof d === "string" && dataISOValida(d)) : null))
              .catch(() => null);
      pedidos.current.set(chave, p);
      void p.then((lista) => {
        if (!lista) {
          pedidos.current.delete(chave);
          return;
        }
        setOcupacao((o) => ({ ...o, [chave]: lista }));
        // Noites que chegam depois da escolha: se a estadia do lugar escolhido agora passa por uma delas, a saída
        // é desfeita (a mesma regra da troca de lugar), em vez de seguir para o servidor recusar.
        if ((imovel ?? seletor()?.value) !== cod || trocaDeCasa(cod)) return;
        const noites = new Set(lista);
        setDatas((d) => (d.entrada && d.saida && cruzaOcupada(d.entrada, d.saida, noites) ? { entrada: d.entrada, saida: "" } : d));
      });
      return p;
    },
    [hoje, imovel, seletor, trocaDeCasa],
  );

  // Meses à vista (e, escolhendo a saída, os meses desde a entrada, para conferir o caminho).
  useEffect(() => {
    if (!aberto || !comLugar) return;
    const meses = new Set(Array.from({ length: n }, (_, i) => somarMeses(mes, i)));
    if (etapaAtual === "saida") for (const m of mesesEntre(maior(datas.entrada, hoje), somarMeses(mes, n - 1))) meses.add(m);
    for (const m of meses) if (m >= primeiroMes && m < limite) void pedirMes(lugar, m);
  }, [aberto, comLugar, lugar, mes, n, etapaAtual, datas.entrada, hoje, primeiroMes, limite, pedirMes]);

  // Lugar trocado: se a estadia escolhida passa por noite ocupada no novo lugar, a saída é desfeita.
  useEffect(() => {
    const s = imovel ? null : seletor();
    if (!s) return;
    const aoMudar = () => {
      setRecusa(null);
      const cod = s.value;
      const [e, sd] = [campoEntrada.current?.value ?? "", campoSaida.current?.value ?? ""];
      if (!CODIGO.test(cod) || !e || !sd || trocaDeCasa(cod)) return;
      const meses = mesesEntre(maior(e, hoje), somarDias(sd, -1)).filter((m) => m < limiteDoCalendario(hoje));
      void Promise.all(meses.map((m) => pedirMes(cod, m))).then((listas) => {
        const noites = new Set(listas.flatMap((l) => l ?? []));
        // Resposta atrasada de um lugar que já foi trocado de novo não vale.
        if (s.value !== cod) return;
        setDatas((d) => (d.entrada === e && d.saida === sd && cruzaOcupada(e, sd, noites) ? { entrada: e, saida: "" } : d));
      });
    };
    s.addEventListener("change", aoMudar);
    return () => s.removeEventListener("change", aoMudar);
  }, [imovel, seletor, hoje, pedirMes, trocaDeCasa]);

  const mesParaMostrar = (dia: string, desde?: string) => {
    let m = inicioDoMes(desde ?? dia);
    if (dia >= somarMeses(m, n)) m = somarMeses(dia, -(n - 1));
    return menor(maior(m, primeiroMes), ultimoMes);
  };

  const abrir = (qual: Etapa) => {
    const nova: Etapa = qual === "saida" && datas.entrada ? "saida" : "entrada";
    const alvo = nova === "saida" ? datas.saida || somarDias(datas.entrada, 1) : datas.entrada || hoje;
    const dia = menor(maior(alvo, hoje), ultimoDia);
    origem.current = qual;
    focarDia.current = true;
    setEtapa(nova);
    setMes(mesParaMostrar(dia, nova === "saida" ? maior(datas.entrada, hoje) : undefined));
    setFoco(dia);
    setPrevia(null);
    setRecusa(null);
    setAberto(true);
  };

  const fechar = useCallback((devolverFoco: boolean) => {
    setAberto(false);
    setPrevia(null);
    if (devolverFoco) (origem.current === "saida" ? botaoSaida : botaoEntrada).current?.focus();
  }, []);

  const alternar = (qual: Etapa) => {
    if (aberto && etapaAtual === (qual === "saida" && datas.entrada ? "saida" : "entrada")) fechar(false);
    else abrir(qual);
  };

  // Enviar sem uma das datas abre o calendário em vez de enviar (o servidor confere de novo).
  const abrirRef = useRef(abrir);
  useEffect(() => {
    abrirRef.current = abrir;
  });
  useEffect(() => {
    const form = botaoEntrada.current?.form;
    if (!form) return;
    const aoEnviar = (e: SubmitEvent) => {
      const falta: Etapa | null = !campoEntrada.current?.value ? "entrada" : !campoSaida.current?.value ? "saida" : null;
      if (!falta) return;
      e.preventDefault();
      abrirRef.current(falta);
    };
    form.addEventListener("submit", aoEnviar);
    return () => form.removeEventListener("submit", aoEnviar);
  }, []);

  // Posição do quadro no computador: logo abaixo dos campos, sem sair da tela (no celular o CSS o prende embaixo).
  useLayoutEffect(() => {
    if (!aberto) return;
    const posicionar = () => {
      const d = dialogo.current;
      const [a, b] = [botaoEntrada.current?.getBoundingClientRect(), botaoSaida.current?.getBoundingClientRect()];
      if (!d || !a || !b) return;
      const largura = d.offsetWidth;
      const tela = document.documentElement.clientWidth;
      const desejada = variante === "lateral" ? b.right - largura : a.left;
      d.style.setProperty("--topo", `${Math.max(a.bottom, b.bottom) + window.scrollY + 8}px`);
      d.style.setProperty("--esquerda", `${Math.max(16, Math.min(desejada, tela - largura - 16)) + window.scrollX}px`);
    };
    posicionar();
    window.addEventListener("resize", posicionar);
    return () => window.removeEventListener("resize", posicionar);
  }, [aberto, n, variante]);

  // Clique fora (fora do quadro e dos dois campos) fecha sem roubar o foco.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      const t = e.target instanceof Node ? e.target : null;
      const dentro = [dialogo.current, botaoEntrada.current?.closest("label") ?? botaoEntrada.current, botaoSaida.current?.closest("label") ?? botaoSaida.current];
      if (t && dentro.some((el) => el?.contains(t))) return;
      fechar(false);
    };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aberto, fechar]);

  // Foco do teclado no dia (ao abrir e ao mover com as setas).
  useEffect(() => {
    if (!aberto || !focarDia.current) return;
    focarDia.current = false;
    dialogo.current?.querySelector<HTMLButtonElement>(`[data-dia="${foco}"]`)?.focus();
  }, [aberto, foco, mes]);

  const irPara = (dia: string) => {
    const alvo = menor(maior(dia, hoje), ultimoDia);
    if (alvo < mes || alvo >= fimVisivel) setMes(mesParaMostrar(alvo, alvo < mes ? alvo : somarMeses(alvo, -(n - 1))));
    focarDia.current = true;
    setFoco(alvo);
    if (etapaAtual === "saida") setPrevia(alvo);
  };

  const navegar = (passo: number) => {
    const novo = menor(maior(somarMeses(mes, passo), primeiroMes), ultimoMes);
    setMes(novo);
    if (foco < novo || foco >= somarMeses(novo, n)) setFoco(menor(maior(novo, hoje), ultimoDia));
  };

  const clicar = (dia: string) => {
    const r = escolherDia(datas, dia, etapaAtual, contexto);
    setFoco(dia);
    setRecusa(r.recusa);
    if (r.recusa) return;
    setDatas(r.datas);
    if (r.etapa === "pronta") {
      origem.current = "saida";
      fechar(true);
    } else setEtapa(r.etapa);
  };

  const limpar = () => {
    // O botão "Limpar" fica desabilitado depois: o foco vai antes para a grade, para o Esc e o Tab continuarem no quadro.
    dialogo.current?.querySelector<HTMLButtonElement>(`[data-dia="${focoVisivel}"]`)?.focus();
    setDatas({ entrada: "", saida: "" });
    setEtapa("entrada");
    setPrevia(null);
    setRecusa(null);
  };

  // Setas andam um dia ou uma semana; Home e End vão ao começo e ao fim da semana mostrada, segunda e domingo (M7.22).
  const teclasDoDia = (e: KeyboardEvent<HTMLButtonElement>, dia: string) => {
    const passos: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let alvo: string | null = null;
    if (e.key in passos) alvo = somarDias(dia, passos[e.key]);
    else if (e.key === "Home") alvo = somarDias(dia, -posicaoNaSemana(dia));
    else if (e.key === "End") alvo = somarDias(dia, 6 - posicaoNaSemana(dia));
    else if (e.key === "PageUp" || e.key === "PageDown") {
      const m = somarMeses(dia, e.key === "PageUp" ? -1 : 1);
      alvo = `${m.slice(0, 8)}${String(Math.min(Number(dia.slice(8)), diasEntre(m, somarMeses(m, 1)))).padStart(2, "0")}`;
    }
    if (!alvo) return;
    e.preventDefault();
    irPara(alvo);
  };

  // Esc fecha; Tab fica dentro do quadro enquanto ele está aberto.
  const teclasDoQuadro = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      fechar(true);
      return;
    }
    if (e.key !== "Tab" || !dialogo.current) return;
    const focaveis = [...dialogo.current.querySelectorAll<HTMLElement>("button:not(:disabled)")].filter((el) => el.tabIndex >= 0);
    if (!focaveis.length) return;
    const [primeiro, ultimo] = [focaveis[0], focaveis[focaveis.length - 1]];
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  };

  const previaValida = etapaAtual === "saida" && previa && previa > datas.entrada && !cruzaOcupada(datas.entrada, previa, ocupadas) ? previa : null;
  const noites = previaValida ? diasEntre(datas.entrada, previaValida) : datas.entrada && datas.saida ? diasEntre(datas.entrada, datas.saida) : 0;

  const mesNaTela = (m: string) => (
    <div key={m} className={css.mes}>
      <strong className={css.nomeMes} id={`${id}-${m}`}>
        {nomeDoMes(m)}
      </strong>
      <table role="grid" className={css.grade} aria-labelledby={`${id}-${m}`} onMouseLeave={() => setPrevia(null)}>
        <thead>
          <tr>
            {DIAS_NA_ORDEM.map((n) => (
              <th key={n} scope="col" abbr={DIAS_SEMANA[n]}>
                {DIAS_DA_SEMANA_CURTOS[n]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanasDoMes(m).map((semana, i) => (
            <tr key={i}>
              {semana.map((dia, j) => {
                if (!dia) return <td key={`v${j}`} role="gridcell" />;
                const s = situacaoDoDia(dia, datas, etapaAtual, contexto, previa);
                const escolhido = !!datas.entrada && (dia === datas.entrada || (!!datas.saida && dia > datas.entrada && dia <= datas.saida));
                const classes = [
                  css.dia,
                  s.passada && css.passada,
                  s.ocupada && !s.soSaida && css.ocupada,
                  s.soSaida && css.soSaida,
                  !s.disponivel && !s.passada && !s.ocupada && css.indisponivel,
                  s.noIntervalo && css.intervalo,
                  (s.entrada || (previaValida ? dia === previaValida : s.saida)) && css.ponta,
                  s.hoje && css.hoje,
                ];
                return (
                  <td key={dia} role="gridcell" aria-selected={escolhido}>
                    <button
                      type="button"
                      data-dia={dia}
                      tabIndex={dia === focoVisivel ? 0 : -1}
                      className={classes.filter(Boolean).join(" ")}
                      aria-label={rotuloDoDia(dia, s)}
                      aria-pressed={s.entrada || s.saida}
                      aria-disabled={s.disponivel ? undefined : true}
                      aria-current={s.hoje ? "date" : undefined}
                      onClick={() => clicar(dia)}
                      onKeyDown={(e) => teclasDoDia(e, dia)}
                      onMouseEnter={() => setPrevia(dia)}
                      onFocus={() => etapaAtual === "saida" && setPrevia(dia)}
                    >
                      {Number(dia.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const quadro = aberto && (
    <>
      <div className={css.fundo} aria-hidden="true" />
      <div ref={dialogo} id={`${id}-calendario`} role="dialog" aria-modal="true" aria-label="Escolher as datas da estadia" className={css.calendario} onKeyDown={teclasDoQuadro}>
        <div className={css.topo}>
          <p className={css.etapa} aria-live="polite">
            {etapaAtual === "saida" ? `Entrada em ${dataCurta(datas.entrada)} · escolha a saída` : "Escolha o dia de entrada"}
          </p>
          {noites > 0 && (
            <span className={css.noites}>
              {noites} {noites === 1 ? "noite" : "noites"}
            </span>
          )}
        </div>
        <div className={`${css.meses} ${n === 1 ? css.umMes : ""}`}>
          <button type="button" className={`${css.seta} ${css.anterior}`} aria-label="Mês anterior" disabled={mes <= primeiroMes} onClick={() => navegar(-1)}>
            <span aria-hidden="true">←</span>
          </button>
          <button type="button" className={`${css.seta} ${css.proximo}`} aria-label="Próximo mês" disabled={mes >= ultimoMes} onClick={() => navegar(1)}>
            <span aria-hidden="true">→</span>
          </button>
          {visiveis.map(mesNaTela)}
        </div>
        <p className={css.recusa} role="status">
          {recusa}
        </p>
        <div className={css.rodape}>
          {comLugar ? (
            <p className={css.legenda}>
              <span className={css.amostra} aria-hidden="true">
                12
              </span>
              Noites ocupadas
            </p>
          ) : (
            // Sem casa escolhida ("Todas as casas", M7.9): nada é marcado, e o quadro diz isso em vez de parecer tudo livre.
            <p className={css.legenda}>Com todas as casas, as noites ocupadas não aparecem aqui: a situação de cada casa vem na próxima tela.</p>
          )}
          <div className={css.acoes}>
            <button type="button" className={css.limpar} onClick={limpar} disabled={!datas.entrada}>
              Limpar
            </button>
            <button type="button" className={css.fechar} onClick={() => fechar(true)}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    </>
  );

  const campo = (qual: Etapa) => {
    const valor = qual === "entrada" ? datas.entrada : datas.saida;
    const erro = qual === "entrada" ? erroEntrada : erroSaida;
    const nome = qual === "entrada" ? "Entrada" : "Saída";
    return (
      <label className={css.rotulo}>
        {nome}
        <button
          ref={qual === "entrada" ? botaoEntrada : botaoSaida}
          type="button"
          className={erro ? `${css.campo} ${css.comErro}` : css.campo}
          aria-haspopup="dialog"
          aria-expanded={aberto}
          aria-controls={aberto ? `${id}-calendario` : undefined}
          aria-label={`${nome}: ${valor ? dataPorExtenso(valor) : "escolha a data"}`}
          aria-describedby={erro ? `erro-${qual}` : undefined}
          onClick={() => alternar(qual)}
          onPointerEnter={() => comLugar && [inicioDoMes(datas.entrada || hoje), somarMeses(datas.entrada || hoje, 1)].forEach((m) => m < limite && void pedirMes(lugar, m))}
        >
          <span className={valor ? undefined : css.vazio}>{valor ? dataCurta(valor) : "Escolha a data"}</span>
          <Icone />
        </button>
        <input ref={qual === "entrada" ? campoEntrada : campoSaida} type="hidden" name={qual === "entrada" ? "entrada" : "saida"} value={valor} />
        {erro && (
          <span className={styles.erro} id={`erro-${qual}`}>
            {erro}
          </span>
        )}
      </label>
    );
  };

  return (
    <>
      {campo("entrada")}
      {campo("saida")}
      {quadro && createPortal(quadro, document.body)}
    </>
  );
}
