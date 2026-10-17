// @vitest-environment jsdom
/**
 * Integrações → WhatsApp (M10.1a, desenho 6.8; 8-G): o quadro com cada situação, as variáveis só como "existe" (nunca
 * o valor), os contadores de hoje, os avisos da conta com um texto por causa do e-mail, os dois formulários (os ids da
 * Meta, sem "Id do app", e quem vê as conversas, com a confirmação para liberar à operação) e a regra dos componentes
 * desta etapa: os de servidor sem "use client", e os de cliente sem o ambiente nem a situação inteira nas propriedades.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SituacaoWhatsapp } from "@/whatsapp/integracao";

vi.mock("@/whatsapp/acoes", () => ({ salvarIdsWhatsappAcao: vi.fn(async () => ({})), salvarQuemVeConversasAcao: vi.fn(async () => ({})) }));
import { salvarIdsWhatsappAcao, salvarQuemVeConversasAcao } from "@/whatsapp/acoes";
import { FormIdsWhatsapp } from "./FormIdsWhatsapp";
import { FormQuemVeConversas, PERGUNTA_LIBERAR_OPERACAO } from "./FormQuemVeConversas";
import { WhatsappIntegracao } from "./WhatsappIntegracao";

afterEach(cleanup);

const CONTA: SituacaoWhatsapp["conta"] = {
  situacao: "nao_conectada",
  ultimoEvento: null,
  motivo: null,
  iniciadoPor: null,
  situacaoEm: null,
  conectadoEm: null,
  prazo24h: null,
  sincronizacaoContatos: "nao_pedida",
  contatosRecebidosEm: null,
  sincronizacaoHistorico: "nao_pedida",
  progressoHistorico: null,
};
const w = (o: Partial<SituacaoWhatsapp> = {}, conta: Partial<SituacaoWhatsapp["conta"]> = {}): SituacaoWhatsapp => ({
  recebimentoLigado: true,
  token: "ok",
  segredoConfigurado: true,
  config: { wabaId: "200000000000002", numeroId: "100000000000001", quemVeConversas: "so_admin" },
  conta: { ...CONTA, ...conta },
  avisos: { hoje: { assinaturas_recusadas: 1, ilegiveis: 2, outra_conta: 3, desconhecidos: 4, ignorados: 5 }, ultimoValidoEm: new Date("2026-10-17T13:00:00Z") },
  eventosDaConta: [],
  enderecoWebhook: "https://scl-reconstrucao.vercel.app/api/whatsapp",
  ...o,
});
const texto = (s: SituacaoWhatsapp, naPrevia = false) =>
  renderToStaticMarkup(<WhatsappIntegracao w={s} naPrevia={naPrevia} />)
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("o quadro (6.8)", () => {
  it("título, recebimento, as duas variáveis só como \"configurada\", o endereço com o botão de copiar e os contadores de hoje (sem \"grande demais\")", () => {
    const h = renderToStaticMarkup(<WhatsappIntegracao w={w()} naPrevia={false} />);
    const t = texto(w());
    expect(h).toContain("WhatsApp (Meta)</h2>");
    expect(t).toContain("Recebimento: ligado");
    expect(t).toContain("Senha de verificação (WHATSAPP_VERIFY_TOKEN): configurada");
    expect(t).toContain("Chave secreta do app (WHATSAPP_APP_SECRET): configurada");
    expect(t).toContain("Endereço para colar no app da Meta: https://scl-reconstrucao.vercel.app/api/whatsapp");
    expect(h).toContain(">Copiar endereço</button>");
    expect(t).toContain("Último aviso válido: 17/10/2026 às 10:00");
    expect(t).toContain(
      "Hoje: 1 recusado(s) pela assinatura, 2 ilegível(is), 3 de outra conta ou número, 4 não reconhecido(s), 5 ignorado(s) (grupos, confirmações de entrega e avisos sem efeito).",
    );
    expect(t).not.toMatch(/grande\(s\) demais|corpo_grande/);
    expect(t).not.toContain("Esta é uma prévia de teste");
    expect(t).not.toContain("Falta o id do número");
  });

  it("o que falta, sem nenhum valor: recebimento desligado, a senha que falta ou é curta, a chave secreta que falta, o id do número que falta e nenhum aviso válido", () => {
    expect(texto(w({ recebimentoLigado: false }))).toContain("Recebimento: desligado (WHATSAPP_RECEBIMENTO não está como ligada na Vercel)");
    expect(texto(w({ token: "falta" }))).toContain("Senha de verificação (WHATSAPP_VERIFY_TOKEN): falta");
    expect(texto(w({ token: "curto" }))).toContain("Senha de verificação (WHATSAPP_VERIFY_TOKEN): curta demais (mínimo 32 caracteres)");
    expect(texto(w({ segredoConfigurado: false }))).toContain("Chave secreta do app (WHATSAPP_APP_SECRET): falta");
    expect(texto(w({ config: { wabaId: "200000000000002", numeroId: null, quemVeConversas: "so_admin" } }))).toContain(
      "Falta o id do número: os avisos de mensagem estão sendo recusados e contados como de outra conta.",
    );
    expect(texto(w({ avisos: { hoje: w().avisos.hoje, ultimoValidoEm: null } }))).toContain("Último aviso válido: nenhum ainda");
  });

  it("na prévia: o endereço só funciona na produção, e só ids fictícios no formulário", () => {
    expect(texto(w(), true)).toContain("Esta é uma prévia de teste: o endereço do WhatsApp só funciona na produção. Aqui, use só ids fictícios no formulário ‘Identificação na Meta’.");
  });

  it.each<[string, Partial<SituacaoWhatsapp["conta"]>, string]>([
    ["não conectada", {}, "Situação da conta: Não conectado"],
    ["conectada", { situacao: "conectada", situacaoEm: new Date("2026-10-16T21:30:00Z") }, "Situação da conta: Conectado (desde 16/10/2026 às 18:30)"],
    [
      "desconectada com motivo",
      { situacao: "desconectada", motivo: "COMPANION_INACTIVITY", situacaoEm: new Date("2026-10-16T21:30:00Z") },
      "Situação da conta: Desconectado (um aparelho vinculado ficou cerca de 30 dias sem uso, desde 16/10/2026 às 18:30)",
    ],
    ["aguardando reconexão", { situacao: "aguardando_reconexao", situacaoEm: new Date("2026-10-16T21:30:00Z") }, "Situação da conta: Aguardando reconexão (desde 16/10/2026 às 18:30)"],
    ["suspensa", { situacao: "suspensa", situacaoEm: new Date("2026-10-16T21:30:00Z") }, "Situação da conta: Suspenso (desde 16/10/2026 às 18:30)"],
  ])("situação %s: a linha com o rótulo, o motivo e a data quando houver", (_caso, conta, esperado) => {
    expect(texto(w({}, conta))).toContain(esperado);
  });

  it("o prazo das 24 h correndo, os contatos \"recebidos (último em …)\" (nunca \"recebendo\") e o histórico com o progresso", () => {
    const t = texto(
      w({}, { situacao: "conectada", conectadoEm: new Date("2026-10-17T02:00:00Z"), prazo24h: new Date("2026-10-18T02:00:00Z"), sincronizacaoContatos: "recebendo", contatosRecebidosEm: new Date("2026-10-17T03:15:00Z"), sincronizacaoHistorico: "recebendo", progressoHistorico: 40 }),
    );
    expect(t).toContain("Prazo para pedir os contatos e o histórico: até 17/10/2026 às 23:00");
    expect(t).toContain("Contatos da agenda: recebidos (último em 17/10/2026 às 00:15)");
    expect(t).not.toContain("Contatos da agenda: recebendo");
    expect(t).toContain("Histórico: recebendo (40%)");
    // O aviso do topo, o mesmo da caixa de entrada.
    expect(t).toContain("Conectado em 16/10/2026 às 23:00. O prazo para pedir os contatos e o histórico termina em 17/10/2026 às 23:00.");
  });

  it.each<[SituacaoWhatsapp["conta"]["sincronizacaoHistorico"], string]>([
    ["nao_pedida", "não pedido"],
    ["pedida", "pedido"],
    ["concluida", "concluído"],
    ["recusada", "recusado no celular"],
  ])("sincronização %s: \"%s\" nos contatos e no histórico (sem progresso, sem os parênteses)", (s, rotulo) => {
    const t = texto(w({}, { sincronizacaoContatos: s, sincronizacaoHistorico: s }));
    expect(t).toContain(`Contatos da agenda: ${rotulo}`);
    expect(t).toContain(`Histórico: ${rotulo} `);
    expect(t).not.toMatch(/Histórico: [^(]*\(\d+%\)/);
  });

  it("os últimos avisos da conta: a data, o evento, o motivo e um texto por causa do e-mail (nunca um palpite); sem e-mail no evento, nada", () => {
    const em = new Date("2026-10-16T21:30:00Z");
    const t = texto(
      w({
        eventosDaConta: [
          { tipo: "PARTNER_REMOVED", motivo: "PRIMARY_INACTIVITY", ocorridoEm: em, email: "enviado" },
          { tipo: "PARTNER_REMOVED", motivo: null, ocorridoEm: em, email: "sem-email" },
          { tipo: "ACCOUNT_OFFBOARDED", motivo: null, ocorridoEm: em, email: "sem-correio" },
          { tipo: "DISABLED_UPDATE", motivo: null, ocorridoEm: em, email: "falhou" },
          { tipo: "ACCOUNT_DELETED", motivo: null, ocorridoEm: em, email: "pendente" },
          { tipo: "PARTNER_APP_UNINSTALLED", motivo: null, ocorridoEm: em, email: "sem_nova_tentativa" },
          { tipo: "PARTNER_ADDED", motivo: null, ocorridoEm: em, email: "nao_se_aplica" },
        ],
      }),
    );
    expect(t).toContain("Últimos avisos da conta");
    expect(t).toContain("16/10/2026 às 18:30 — Desconectado do sistema: o celular principal ficou cerca de 14 dias sem abrir o WhatsApp Business · e-mail enviado");
    expect(t).toContain("16/10/2026 às 18:30 — Desconectado do sistema · e-mail não enviado: falta o e-mail da empresa em Configurações → Empresa");
    expect(t).toContain("16/10/2026 às 18:30 — Registrado em outro aparelho · e-mail não enviado: o e-mail do sistema (Resend) não está configurado");
    expect(t).toContain("16/10/2026 às 18:30 — Mudança de suspensão da conta · e-mail não enviado: o envio falhou; nova tentativa de hora em hora");
    expect(t).toContain("16/10/2026 às 18:30 — Conta apagada · e-mail ainda não enviado");
    expect(t).toContain("16/10/2026 às 18:30 — App do sistema removido da conta · e-mail não enviado: passaram 7 dias sem conseguir; não há nova tentativa");
    expect(t).toMatch(/16\/10\/2026 às 18:30 — Conectado ao sistema (?!·)/);
  });

  it("o formulário dos ids, com os ids atuais, a ajuda e \"Salvar\", sem \"Id do app\"; o de quem vê, com as duas opções e a frase fixa", () => {
    const h = renderToStaticMarkup(<WhatsappIntegracao w={w()} naPrevia={false} />);
    const t = texto(w());
    expect(h).toContain('aria-label="Identificação na Meta"');
    expect(t).toContain("Id da conta do WhatsApp Business (WABA)");
    expect(t).toContain("Id do número (phone number id)");
    expect(h).toContain('value="200000000000002"');
    expect(t).toContain("Números do painel de desenvolvedores da Meta. Não são senhas. Ficam só aqui, no banco do sistema.");
    expect(t).not.toMatch(/Id do app/i);
    expect(h).toContain('aria-label="Quem vê as conversas"');
    expect(t).toContain("Só o admin (padrão)");
    expect(t).toContain("Admin e operação");
    expect(t).toContain("Proprietários e equipe de limpeza nunca veem as conversas.");
  });
});

describe("quem vê as conversas: liberar à operação pede confirmação", () => {
  /** O valor de "quemVe" que a ação recebeu na última chamada. */
  const enviado = () => (vi.mocked(salvarQuemVeConversasAcao).mock.lastCall![1] as FormData).get("quemVe");

  it("escolher \"Admin e operação\" troca o botão pelo de confirmação, com a pergunta; cancelar não envia; confirmar envia admin_e_operacao", async () => {
    vi.mocked(salvarQuemVeConversasAcao).mockClear();
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<FormQuemVeConversas quemVe="so_admin" />);
    fireEvent.click(screen.getByLabelText("Admin e operação"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(confirmar).toHaveBeenCalledWith(PERGUNTA_LIBERAR_OPERACAO);
    expect(PERGUNTA_LIBERAR_OPERACAO).toBe("A operação vai passar a ver todas as conversas do WhatsApp, inclusive com proprietários e interessados. Confirmar?");
    await Promise.resolve();
    expect(salvarQuemVeConversasAcao).not.toHaveBeenCalled();
    confirmar.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(salvarQuemVeConversasAcao).toHaveBeenCalledTimes(1));
    expect(enviado()).toBe("admin_e_operacao");
    confirmar.mockRestore();
  });

  it("aba velha que ainda acha que está liberado: escolher de novo \"Admin e operação\" também pergunta (nenhum envio para a operação sem a confirmação)", async () => {
    vi.mocked(salvarQuemVeConversasAcao).mockClear();
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<FormQuemVeConversas quemVe="admin_e_operacao" />);
    fireEvent.click(screen.getByLabelText("Só o admin (padrão)"));
    fireEvent.click(screen.getByLabelText("Admin e operação"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(confirmar).toHaveBeenCalledWith(PERGUNTA_LIBERAR_OPERACAO);
    await Promise.resolve();
    expect(salvarQuemVeConversasAcao).not.toHaveBeenCalled();
    confirmar.mockRestore();
  });

  it("voltar para \"só o admin\" não pergunta e envia so_admin", async () => {
    vi.mocked(salvarQuemVeConversasAcao).mockClear();
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<FormQuemVeConversas quemVe="admin_e_operacao" />);
    fireEvent.click(screen.getByLabelText("Só o admin (padrão)"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(confirmar).not.toHaveBeenCalled();
    await waitFor(() => expect(salvarQuemVeConversasAcao).toHaveBeenCalled());
    expect(enviado()).toBe("so_admin");
    confirmar.mockRestore();
  });

  it("o valor salvo mudou (outra aba, ou depois de salvar): a marcação volta para ele, e a resposta da ação continua na tela", async () => {
    vi.mocked(salvarQuemVeConversasAcao).mockResolvedValueOnce({ ok: true, mensagem: "Salvo." });
    const { rerender } = render(<FormQuemVeConversas quemVe="admin_e_operacao" />);
    fireEvent.click(screen.getByLabelText("Só o admin (padrão)"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Salvo."));
    rerender(<FormQuemVeConversas quemVe="so_admin" />);
    expect((screen.getByLabelText("Só o admin (padrão)") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Admin e operação"));
    rerender(<FormQuemVeConversas quemVe="admin_e_operacao" />);
    expect((screen.getByLabelText("Admin e operação") as HTMLInputElement).checked).toBe(true);
    rerender(<FormQuemVeConversas quemVe="so_admin" />);
    expect((screen.getByLabelText("Só o admin (padrão)") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Admin e operação") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("Salvo.");
  });
});

describe("identificação na Meta: a resposta da ação aparece no formulário", () => {
  it("o id torto volta com a mensagem e com o que foi digitado; o salvo diz \"Salvo.\"", async () => {
    vi.mocked(salvarIdsWhatsappAcao).mockResolvedValueOnce({ ok: false, mensagem: "Use só números (até 25 dígitos).", valores: { wabaId: "12a", numeroId: "" } });
    render(<FormIdsWhatsapp wabaId={null} numeroId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Use só números (até 25 dígitos)."));
    expect((screen.getByLabelText("Id da conta do WhatsApp Business (WABA)") as HTMLInputElement).value).toBe("12a");
    vi.mocked(salvarIdsWhatsappAcao).mockResolvedValueOnce({ ok: true, mensagem: "Salvo." });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Salvo."));
  });
});

describe("a regra dos componentes desta etapa (6.8)", () => {
  const SRC = join(process.cwd(), "src");
  const ler = (rel: string) => readFileSync(join(SRC, rel), "utf8");

  it("os componentes que recebem a situação ou as conversas são de servidor (sem \"use client\")", () => {
    for (const arquivo of [
      "components/configuracoes/WhatsappIntegracao.tsx",
      "components/mensagens/AvisosWhatsapp.tsx",
      "components/mensagens/ListaConversas.tsx",
      "components/mensagens/Conversa.tsx",
      "components/mensagens/PainelVinculo.tsx",
      "components/reservas/ConversaWhatsapp.tsx",
    ])
      expect(ler(arquivo), arquivo).not.toMatch(/["']use client["']/);
  });

  it("os componentes de cliente recebem só ids, rótulos e o valor de \"quem vê\": nada do ambiente nem a situação inteira", () => {
    for (const arquivo of ["components/configuracoes/FormIdsWhatsapp.tsx", "components/configuracoes/FormQuemVeConversas.tsx", "components/mensagens/MarcarComoLida.tsx"]) {
      const codigo = ler(arquivo);
      expect(codigo, arquivo).toMatch(/^["']use client["']/);
      expect(codigo, arquivo).not.toMatch(/process\.env|NodeJS\.ProcessEnv|SituacaoWhatsapp|\benv\b/);
    }
  });
});
