import Link from "next/link";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import formStyles from "@/components/formularios.module.css";
import { dataHoraNoFuso } from "@/lib/datas";
import { confirmarVinculoAcao, desfazerVinculoAcao, vincularPorCodigoAcao } from "@/whatsapp/acoes";
import type { ConversaCompleta } from "@/whatsapp/conversas";
import { type Candidato, ROTULO_MOTIVO_CANDIDATO } from "@/whatsapp/vinculo";
import styles from "./mensagens.module.css";

export type SugestoesDaConversa = { candidatos: readonly Candidato[]; mais: number };

const SEMPRE = "O vínculo não copia o telefone nem o nome para a reserva ou para nenhum cadastro.";

/**
 * O vínculo da conversa (M10.1a): confirmado (com quem confirmou, quando, "Abrir" e "Desfazer vínculo" só quando a
 * sessão lê o alvo) ou as sugestões calculadas na hora, com "Vincular" em cada uma, e a busca manual pelo código. O
 * sistema nunca vincula sozinho. Componente de servidor: os formulários chamam as ações de `whatsapp/acoes.ts`, que
 * conferem tudo de novo; o único componente cliente é o `BotaoConfirmar`, com a pergunta já montada.
 */
export function PainelVinculo({ contatoId, vinculo, sugestoes }: { contatoId: string; vinculo: ConversaCompleta["vinculo"]; sugestoes: SugestoesDaConversa | null }) {
  if (vinculo) {
    return (
      <section aria-label="Vínculo da conversa" className={styles.cartao}>
        <h2>Vínculo</h2>
        {/* Quem e quando vêm antes do rótulo: o rótulo da reserva termina na situação dela ("… · cancelada"), e "cancelada
            por Fulano" daria a entender que foi essa pessoa que cancelou. */}
        <p>{`Vinculada por ${vinculo.confirmadoPor ?? "usuário removido"} em ${dataHoraNoFuso(vinculo.confirmadoEm)} a: ${vinculo.rotulo}.`}</p>
        {/* "Abrir" é a ação principal (o botão musgo); "Desfazer vínculo" é a secundária, como os "Desfazer" do painel. */}
        {(vinculo.link || vinculo.podeDesfazer) && (
          <div className={styles.acoesVinculo}>
            {vinculo.link && (
              <Link href={vinculo.link} className={formStyles.botao}>
                Abrir
              </Link>
            )}
            {vinculo.podeDesfazer && (
              <form action={desfazerVinculoAcao}>
                <input type="hidden" name="contatoId" value={contatoId} />
                <BotaoConfirmar className={formStyles.pequeno} pergunta={`Desfazer o vínculo desta conversa com ${vinculo.rotulo}? A conversa continua guardada.`}>
                  Desfazer vínculo
                </BotaoConfirmar>
              </form>
            )}
          </div>
        )}
        <p className={styles.nota}>{SEMPRE}</p>
      </section>
    );
  }
  const candidatos = sugestoes?.candidatos ?? [];
  return (
    <section aria-label="Sugestões de vínculo" className={styles.cartao}>
      <h2>Sugestões de vínculo</h2>
      {candidatos.length ? (
        <ul className={styles.candidatos}>
          {candidatos.map((c) => (
            <li key={`${c.tipo}:${c.id}`} className={styles.candidato}>
              <span>
                {c.link ? <Link href={c.link}>{c.rotulo}</Link> : c.rotulo}
                {` — ${c.motivos.map((m) => ROTULO_MOTIVO_CANDIDATO[m]).join(", ")}`}
              </span>
              <form action={confirmarVinculoAcao}>
                <input type="hidden" name="contatoId" value={contatoId} />
                <input type="hidden" name="tipo" value={c.tipo} />
                <input type="hidden" name="alvoId" value={c.id} />
                {/* Um nome por botão (começa pelo texto visível): no leitor de tela, cada "Vincular" diz a quê. */}
                <button type="submit" aria-label={`Vincular a ${c.rotulo}`}>
                  Vincular
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p>Nenhuma sugestão. O sistema sugere pelo código da reserva (SCL-…) ou da cotação (COT-…) escrito na conversa e pelo telefone; nunca vincula sozinho.</p>
      )}
      {sugestoes && sugestoes.mais > 0 && <p className={styles.nota}>{`e mais ${sugestoes.mais}`}</p>}
      <form action={vincularPorCodigoAcao} className={styles.busca} aria-label="Vincular pelo código">
        <input type="hidden" name="contatoId" value={contatoId} />
        <label>
          Código da reserva ou da cotação
          <input className={styles.campo} name="codigo" placeholder="SCL-XXXXXX ou COT-XXXXXXXX" autoComplete="off" spellCheck={false} maxLength={40} />
        </label>
        <button type="submit">Procurar e vincular</button>
      </form>
      <p className={styles.nota}>{SEMPRE}</p>
    </section>
  );
}
