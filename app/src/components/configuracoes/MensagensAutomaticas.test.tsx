import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TEXTOS_BASE_CANCELAMENTO } from "@/configuracoes/modelos-texto";
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
import { MensagensAutomaticas } from "./MensagensAutomaticas";
import { Modelos } from "./Modelos";

const acao = vi.fn(async () => ({}));

describe("mensagens ao hóspede: as do cancelamento (M8.2c)", () => {
  it("cada mensagem do cancelamento mostra o texto-base (o que a ficha copia sem modelo) com o botão de copiar; as outras, não", () => {
    const h = renderToStaticMarkup(
      <MensagensAutomaticas
        ativo={false}
        ativoDesde={null}
        origens={[]}
        tipos={[
          { id: "confirmacao", nome: "Confirmação da reserva", selecionado: "" },
          { id: "cancelamento_recebido", nome: "Cancelamento: pedido recebido", selecionado: "", textoBase: TEXTOS_BASE_CANCELAMENTO.cancelamento_recebido },
        ]}
        modelos={[]}
        envios={[]}
        ultimaExecucao={null}
        salvar={acao}
      />,
    );
    expect(h).toContain("Cancelamento de reserva paga pelo site: pedido recebido (até 2 dias depois do pedido)");
    expect(h).toContain("Texto-base (sem modelo): “Olá, {hospede}! Recebemos o seu pedido de cancelamento da reserva {codigo}");
    expect(h.match(/Copiar o texto-base/g)).toHaveLength(1);
    expect(h).toContain('name="modelo_cancelamento_recebido"');
  });

  it("a lista de variáveis diz onde as do cancelamento valem", () => {
    const h = renderToStaticMarkup(<Modelos lista={[]} criar={acao} editar={acao} />);
    // M8.2d: a devolução feita serve também à alteração (nome novo).
    expect(h).toContain("<code>{valor}</code> valor devolvido (só em “Devolução feita (cancelamento ou alteração)”)");
    expect(h).toContain("<code>{recebido}</code> data e hora em que recebemos o pedido (só em “Cancelamento: pedido recebido”, “Cancelamento: decisão”, “Devolução feita (cancelamento ou alteração)”)");
    expect(h).toContain("<code>{hospede}</code> nome do hóspede</span>");
  });
});
