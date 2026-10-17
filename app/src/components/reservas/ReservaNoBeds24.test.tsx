/**
 * Bloco "No Beds24" da ficha (M8.3a, desenho 8; seção 10, teste 12): os códigos do domínio em linguagem simples, o
 * "desligada" calculado, o histórico curto e o "Simular" só com a permissão e o ambiente. M8.3b (testes 15 e 16): o texto
 * da tarefa das OTAs desta reserva e as marcas manuais, só com `reserva:editar`. O componente só é importado no painel:
 * nenhuma tela do hóspede nem do portal cita o Beds24.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FichaReservaNoBeds24 } from "@/beds24/reservas-site-painel";
import { MOTIVOS_ACOMPANHAMENTO_BEDS24, SITUACOES_ACOMPANHAMENTO_BEDS24 } from "@/beds24/reservas-site-regras";
import type { TarefaOta } from "@/beds24/reservas-site-tarefas";

vi.mock("@/beds24/acoes-reservas", () => ({ simularReservaBeds24Acao: vi.fn(), marcarDatasFechadasNasOtasAcao: vi.fn(), marcarDatasReabertasNasOtasAcao: vi.fn() }));
import { NOMES_MOTIVO_NO_BEDS24, NOMES_SITUACAO_NO_BEDS24, ReservaNoBeds24, textoDaSimulacao } from "./ReservaNoBeds24";

const ID = "11111111-1111-4111-8111-111111111111";
const vazia: FichaReservaNoBeds24 = { desligada: ["ambiente", "chave", "credencial", "imovel", "sem_acompanhamento"], beds24Id: null, acompanhamento: null, operacoes: [], simular: true, pedido: null, tarefas: [], atencoes: [] };
const tarefa = (o: Partial<TarefaOta> = {}): TarefaOta => ({
  reservaId: ID,
  codigo: "SCL-7K2QXM",
  caso: "paga",
  estado: "manual",
  checkin: "2026-12-20",
  checkout: "2026-12-27",
  desde: new Date("2026-10-01T15:00:00Z"),
  alteracaoIds: [],
  texto: "Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.",
  marca: "datas_fechadas",
  ...o,
});
const html = (ficha: FichaReservaNoBeds24, editar = true, resultado?: string) => renderToStaticMarkup(<ReservaNoBeds24 reservaId={ID} ficha={ficha} editar={editar} resultado={resultado} />);

describe("bloco No Beds24 da ficha", () => {
  it("sem acompanhamento: desligado com os motivos em palavras, nada a fazer à mão sem tarefa, e o Simular", () => {
    const h = html(vazia);
    expect(h).toContain('aria-label="Reserva no Beds24"');
    expect(h).toContain("<strong>desligado</strong>");
    expect(h).toContain("aqui não é o deploy de produção");
    expect(h).toContain("a chave BEDS24_ESCRITA_RESERVAS não está ligada");
    expect(h).toContain("o imóvel não está ligado em Integrações");
    expect(h).toContain("o sistema ainda não acompanha esta reserva");
    expect(h).toContain("Nada a fazer à mão nas OTAs para esta reserva agora.");
    expect(h).not.toContain("Datas fechadas nas OTAs");
    expect(h).toContain(`name="reservaId" value="${ID}"`);
    expect(h).toContain(">Simular</button>");
  });

  it("pedido com as datas seguradas (D9): nunca manda fechar as datas à mão; o pedido vencido sem pagamento não manda abrir", () => {
    const segurado = html({ ...vazia, pedido: "segurado" });
    expect(segurado).toContain("É um pedido com as datas seguradas: ele não vai ao Beds24, e as datas não devem ser fechadas à mão nas OTAs");
    expect(segurado).not.toContain("Feche as datas");
    expect(segurado).not.toContain("Nada a fazer à mão nas OTAs para esta reserva agora.");
    const vencido = html({ ...vazia, pedido: "vencido" });
    expect(vencido).toContain("O pedido venceu sem pagamento");
    expect(vencido).not.toContain("Feche as datas");
  });

  it("M8.3b: a tarefa das OTAs desta reserva com o botão da marca (reserva:editar); sem a permissão, só o texto", () => {
    const paga = html({ ...vazia, tarefas: [tarefa()] });
    expect(paga).toContain("Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.");
    expect(paga).toContain(">Datas fechadas nas OTAs</button>");
    // Sem acompanhamento, a linha da marca aparece como "não marcado".
    expect(paga).toMatch(/Datas fechadas nas OTAs<\/dt><dd>não marcado/);
    expect(paga).not.toContain("Nada a fazer à mão nas OTAs");
    const semEditar = html({ ...vazia, tarefas: [tarefa()] }, false);
    expect(semEditar).toContain("Feche as datas no Beds24 como bloqueio");
    expect(semEditar).not.toContain("</button>");
    // A D3 cancelada pelo botão de sempre: mudar o bloqueio para Cancelado e "Datas reabertas nas OTAs".
    const reabrir = html({ ...vazia, tarefas: [tarefa({ caso: "d3_cancelada", texto: "Mude o bloqueio de 20/12 a 27/12 para Cancelado (não apague).", marca: "datas_reabertas" })] });
    expect(reabrir).toContain("Mude o bloqueio de 20/12 a 27/12 para Cancelado (não apague).");
    expect(reabrir).toContain(">Datas reabertas nas OTAs</button>");
    expect(reabrir).not.toContain(">Datas fechadas nas OTAs</button>");
    // Sem a marca (envio em curso, a cancelada e a alterada, que têm a marca no quadro delas): nenhum botão das OTAs.
    const semMarca = html({ ...vazia, tarefas: [tarefa({ caso: "cancelada_bloqueio", texto: "Mude o bloqueio de 20/12 a 27/12 para Cancelado (não apague).", marca: null })] });
    expect(semMarca).not.toMatch(/Datas (fechadas|reabertas) nas OTAs<\/button>/);
  });

  it("M8.3b: o que o sistema está enviando e o que pede atenção (nunca \"feche como bloqueio\" por cima)", () => {
    expect(html({ ...vazia, tarefas: [tarefa({ estado: "sendo_enviada", marca: null })] })).toContain("O sistema está enviando esta reserva ao Beds24: não feche nem mude as datas à mão.");
    const atrasada = html({ ...vazia, tarefas: [tarefa({ estado: "atrasada", marca: null })] });
    expect(atrasada).toContain("O envio desta reserva ao Beds24 está atrasado (mais de 30 minutos)");
    expect(atrasada).not.toContain("Feche as datas");
    const conflito = html({ ...vazia, atencoes: [{ reservaId: ID, codigo: "SCL-7K2QXM", tipo: "conflito" }] });
    expect(conflito).toContain("As noites estão ocupadas por outra reserva no Beds24 (possível venda dupla): não feche como bloqueio sobre elas");
    expect(conflito).not.toContain("Nada a fazer à mão nas OTAs");
  });

  it("M8.3b: o resultado das marcas (`?beds24=`), só de chaves conhecidas", () => {
    expect(html(vazia, true, "ota_fechada")).toMatch(/class="[^"]*sucesso[^"]*">Datas marcadas como fechadas nas OTAs\./);
    expect(html(vazia, true, "ota_reaberta")).toContain("Datas marcadas como reabertas nas OTAs.");
    expect(html(vazia, true, "ota_inventada")).not.toContain('role="status"');
  });

  it("o Simular some sem reserva:editar ou quando o ambiente não deixa (deploy de produção com a chave ligada)", () => {
    expect(html(vazia, false)).not.toContain(">Simular</button>");
    expect(html({ ...vazia, simular: false })).not.toContain(">Simular</button>");
  });

  it("com acompanhamento: situação e motivo, id, quarto, conferência, leitura, marca das OTAs e o histórico", () => {
    const h = html({
      desligada: ["pausa"],
      beds24Id: "98765",
      acompanhamento: {
        situacao: "divergente",
        motivo: "cancelada_no_beds24",
        quarto: "20",
        conferidaEm: new Date("2026-10-15T12:00:00Z"),
        lido: { quarto: "20", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, situacao: "cancelada" },
        lidoEm: new Date("2026-10-16T12:00:00Z"),
        otaFechadaEm: new Date("2026-10-02T12:00:00Z"),
        otaFechadaAMao: false,
      },
      operacoes: [
        { id: "o1", tipo: "criar", modo: "simulacao", situacao: "simulada", pedido: { quarto: "20", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, situacao: "confirmada", referencia: "SCL-7K2QXM" }, beds24Id: null, iniciadoEm: new Date("2026-10-01T12:00:00Z"), terminadoEm: null, erro: "" },
        { id: "o2", tipo: "cancelar", modo: "real", situacao: "recusada", pedido: null, beds24Id: "98765", iniciadoEm: new Date("2026-10-03T12:00:00Z"), terminadoEm: new Date("2026-10-03T12:01:00Z"), erro: "a credencial não tem permissão de escrever reservas" },
      ],
      simular: true,
      pedido: null,
      tarefas: [],
      atencoes: [],
    });
    expect(h).toContain("Diferente no Beds24: cancelada no Beds24 por fora");
    expect(h).toContain("98765");
    expect(h).toContain("15/10/2026");
    expect(h).toContain("quarto 20, 20/12/2026 → 27/12/2026, 4 pessoa(s), cancelada");
    expect(h).toContain("(pelo sistema)");
    expect(h).toContain("Criar (simulação)");
    expect(h).toContain("simulada (nada enviado)");
    expect(h).toContain("marca SCL-7K2QXM");
    expect(h).toContain("recusada: a credencial não tem permissão de escrever reservas");
    expect(h).toContain("a pausa geral está ligada em Integrações");
  });

  it("a marca manual gravada (D8): \"marcado pela equipe\" e a equipe cuidando à mão", () => {
    const h = html({
      ...vazia,
      desligada: ["ambiente", "chave", "credencial", "imovel"],
      acompanhamento: { situacao: "manual", motivo: null, quarto: null, conferidaEm: null, lido: null, lidoEm: null, otaFechadaEm: new Date("2026-10-02T12:00:00Z"), otaFechadaAMao: true },
    });
    expect(h).toContain("A equipe cuida à mão");
    expect(h).toContain("02/10/2026 às 09:00 (marcado pela equipe)");
    expect(h).toContain("Nada a fazer à mão nas OTAs para esta reserva agora.");
  });

  it("o resultado do Simular: simulada, repetida, com o imóvel desligado, nada (com o motivo); chave desconhecida, nada", () => {
    expect(textoDaSimulacao("simulada")).toContain("Simulação gravada");
    expect(textoDaSimulacao("simulada_imovel_desligado")).toContain("esta criação só sairia depois de ele ser ligado");
    // Confirmada antes de qualquer ligação: nunca promete o envio depois de ligar (D6); fica com a equipe, à mão.
    for (const chave of ["simulada_imovel_desligado_anterior", "repetida_imovel_desligado_anterior"]) {
      const t = textoDaSimulacao(chave)!;
      expect(t).toContain("a simulação considerou o imóvel ligado antes da confirmação");
      expect(t).toContain("esta continua com a equipe, à mão");
      expect(t).not.toMatch(/sairia depois|até ele ser ligado/);
    }
    expect(textoDaSimulacao("repetida")).toContain("Nada mudou desde a última simulação");
    expect(textoDaSimulacao("nada_sem_pagamento")).toBe("Nada seria enviado ao Beds24: não há pagamento pelo site que confirmou a reserva (confirmada à mão: feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs).");
    expect(textoDaSimulacao("nada_fora_do_ambiente")).toContain("simular só vale fora do deploy de produção");
    expect(textoDaSimulacao("nada_toString")).toBeNull();
    expect(textoDaSimulacao("<script>")).toBeNull();
    expect(textoDaSimulacao(undefined)).toBeNull();
    expect(html(vazia, true, "simulada")).toContain('role="status"');
    // Só a simulação gravada é sucesso; "Nada seria enviado" (cadastro faltando, envio em curso) é aviso.
    for (const chave of ["simulada", "repetida_imovel_desligado"]) expect(html(vazia, true, chave)).toMatch(/class="[^"]*sucesso/);
    for (const chave of ["nada_sem_contrato", "nada_nao_encontrada", "nada_envio_em_curso"]) {
      const h = html(vazia, true, chave);
      expect(h).toMatch(/class="[^"]*alerta/);
      expect(h).not.toMatch(/class="[^"]*sucesso/);
    }
    expect(textoDaSimulacao("nada_envio_em_curso")).toContain("ainda sem confirmação");
  });

  it("toda situação e todo motivo do acompanhamento têm rótulo", () => {
    for (const s of SITUACOES_ACOMPANHAMENTO_BEDS24) expect(NOMES_SITUACAO_NO_BEDS24[s]).toBeTruthy();
    for (const mo of MOTIVOS_ACOMPANHAMENTO_BEDS24) expect(NOMES_MOTIVO_NO_BEDS24[mo]).toBeTruthy();
  });
});

describe("o Beds24 fica no painel", () => {
  /** Todos os arquivos de código de `src/` (menos os testes). */
  function arquivos(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return arquivos(p);
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
    });
  }
  const src = join(__dirname, "..", "..");

  it("o bloco da ficha e a seção de Integrações só são importados pelas páginas do painel (nunca pelo site, Minha reserva ou o portal)", () => {
    const quem = (nome: string) =>
      arquivos(src)
        .filter((f) => readFileSync(f, "utf8").includes(`/${nome}"`))
        .map((f) => relative(src, f).replaceAll("\\", "/"))
        .sort();
    expect(quem("ReservaNoBeds24")).toEqual(["app/painel/reservas/[id]/page.tsx", "components/configuracoes/ReservasSiteBeds24.tsx"]);
    expect(quem("ReservasSiteBeds24")).toEqual(["app/painel/configuracoes/integracoes/page.tsx"]);
    expect(quem("acoes-reservas")).toEqual(["components/configuracoes/AcaoReservasBeds24.tsx", "components/reservas/ReservaNoBeds24.tsx"]);
    const leitores = quem("reservas-site-painel");
    expect(leitores.length).toBeGreaterThan(0);
    expect(leitores.every((f) => f.startsWith("app/painel/") || f.startsWith("beds24/") || f.startsWith("components/configuracoes/") || f.startsWith("components/reservas/"))).toBe(true);
  });

  it("M8.3b: as tarefas das OTAs só no painel (o Início e a ficha); nenhum funil do pagamento importa o módulo do M8.3", () => {
    const quem = (nome: string) => arquivos(src).filter((f) => readFileSync(f, "utf8").includes(`/${nome}"`)).map((f) => relative(src, f).replaceAll("\\", "/")).sort();
    expect(quem("reservas-site-tarefas")).toEqual(["beds24/acoes-reservas.ts", "beds24/reservas-site-painel.ts", "components/reservas/ReservaNoBeds24.tsx", "painel/dashboard.ts"]);
    expect(arquivos(join(src, "pagamentos")).filter((f) => readFileSync(f, "utf8").includes("@/beds24/"))).toEqual([]);
  });
});
