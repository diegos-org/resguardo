/**
 * Bloco "No Beds24" da ficha (M8.3a, desenho 8; seção 10, teste 12): os códigos do domínio em linguagem simples, o
 * "desligada" calculado, o histórico curto e o "Simular" só com a permissão e o ambiente. O componente só é importado no
 * painel: nenhuma tela do hóspede nem do portal cita o Beds24.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FichaReservaNoBeds24 } from "@/beds24/reservas-site-painel";
import { MOTIVOS_ACOMPANHAMENTO_BEDS24, SITUACOES_ACOMPANHAMENTO_BEDS24 } from "@/beds24/reservas-site-regras";

vi.mock("@/beds24/acoes-reservas", () => ({ simularReservaBeds24Acao: vi.fn() }));
import { NOMES_MOTIVO_NO_BEDS24, NOMES_SITUACAO_NO_BEDS24, ReservaNoBeds24, textoDaSimulacao } from "./ReservaNoBeds24";

const ID = "11111111-1111-4111-8111-111111111111";
const vazia: FichaReservaNoBeds24 = { desligada: ["ambiente", "chave", "credencial", "imovel", "sem_acompanhamento"], beds24Id: null, acompanhamento: null, operacoes: [], simular: true };
const html = (ficha: FichaReservaNoBeds24, editar = true, resultado?: string) => renderToStaticMarkup(<ReservaNoBeds24 reservaId={ID} ficha={ficha} editar={editar} resultado={resultado} />);

describe("bloco No Beds24 da ficha", () => {
  it("sem acompanhamento: desligado com os motivos em palavras, o aviso de que nada é escrito ainda, e o Simular", () => {
    const h = html(vazia);
    expect(h).toContain('aria-label="Reserva no Beds24"');
    expect(h).toContain("<strong>desligado</strong>");
    expect(h).toContain("aqui não é o deploy de produção");
    expect(h).toContain("a chave BEDS24_ESCRITA_RESERVAS não está ligada");
    expect(h).toContain("o imóvel não está ligado em Integrações");
    expect(h).toContain("o sistema ainda não acompanha esta reserva");
    expect(h).toContain("o sistema não escreve reservas no Beds24");
    expect(h).toContain(`name="reservaId" value="${ID}"`);
    expect(h).toContain(">Simular</button>");
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

  it("o resultado do Simular: simulada, repetida, com o imóvel desligado, nada (com o motivo); chave desconhecida, nada", () => {
    expect(textoDaSimulacao("simulada")).toContain("Simulação gravada");
    expect(textoDaSimulacao("simulada_imovel_desligado")).toContain("O imóvel não está ligado em Integrações");
    expect(textoDaSimulacao("repetida")).toContain("Nada mudou desde a última simulação");
    expect(textoDaSimulacao("nada_sem_pagamento")).toBe("Nada seria enviado ao Beds24: não há pagamento pelo site que confirmou a reserva (confirmada à mão: feche as datas à mão).");
    expect(textoDaSimulacao("nada_fora_do_ambiente")).toContain("simular só vale fora do deploy de produção");
    expect(textoDaSimulacao("nada_toString")).toBeNull();
    expect(textoDaSimulacao("<script>")).toBeNull();
    expect(textoDaSimulacao(undefined)).toBeNull();
    expect(html(vazia, true, "simulada")).toContain('role="status"');
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
});
