import type { PedidoConsulta } from "@/site/site";
import styles from "./site.module.css";

/**
 * Chamada para gravar a cotação e seguir para a página dela (M8.1). Só aparece quando a estadia é
 * possível e o site tem o valor completo. Nada é pago nem reservado aqui: o contato vem na próxima tela.
 * `comPagamento` (M8.2a): o site oferece o Pix para esta estadia (o texto diz que dá para pagar depois de segurar).
 */
export function SegurarDatas({
  pedido,
  aConfirmar,
  acao,
  nivel = 2,
  comPagamento = false,
}: {
  pedido: PedidoConsulta;
  aConfirmar: boolean;
  acao: (form: FormData) => void | Promise<void>;
  /** 3 dentro do quadro "Resumo da viagem". */
  nivel?: 2 | 3;
  comPagamento?: boolean;
}) {
  const Titulo = nivel === 3 ? "h3" : "h2";
  return (
    <section className={styles.bloco} aria-label="Segurar datas">
      <Titulo>Quer garantir essas datas?</Titulo>
      <p className={styles.texto}>
        {comPagamento
          ? "Segure as datas por alguns minutos: na próxima tela você informa seu contato, recebe um código de cotação e pode pagar por Pix ali mesmo. Nada é cobrado nesta etapa."
          : "Segure as datas por alguns minutos enquanto fala com a equipe: na próxima tela você informa seu contato e recebe um código de cotação. Nenhum pagamento é feito aqui."}
      </p>
      {aConfirmar && (
        <p className={styles.miudo} role="note">
          A disponibilidade ainda será confirmada pela equipe: segurar as datas reserva a sua vez na conversa, não garante a reserva.
        </p>
      )}
      <form action={acao} style={{ marginTop: 12 }}>
        <input type="hidden" name="imovel" value={pedido.imovel} />
        <input type="hidden" name="entrada" value={pedido.entrada} />
        <input type="hidden" name="saida" value={pedido.saida} />
        <input type="hidden" name="hospedes" value={pedido.hospedes} />
        <button type="submit" className={styles.botao}>
          Segurar estas datas
        </button>
      </form>
    </section>
  );
}
