/**
 * Recebimento de um aviso do WhatsApp já lido (M10.1a, desenho na seção "Idempotência e ordem" de
 * `requisitos/product/WHATSAPP.md`): decide de que organização é cada bloco e grava tudo numa transação só, antes do
 * 200 da rota (T6). A dona da conta sai só dos ids configurados em Integrações (`organizacaoDaConta`, exatamente uma
 * organização), nunca de palpite: bloco de outra conta, ou de outro número, é contado em `outra_conta` e não grava
 * nada. Se a transação falhar, nada fica (nem os contadores), a rota responde 500 e a Meta reenvia.
 */
import type { Db } from "@/db/types";
import type { AvisoLido, BlocoLido } from "./aviso";
import { type ConfigWhatsapp, organizacaoDaConta, organizacaoDoNumero } from "./configuracao";
import { type ContagemDoDia, somarContagens, somarNoDia } from "./contadores";
import { gravarBlocos } from "./gravar";

/** Um evento de conta novo, aplicado, que pede o e-mail (a rota manda depois da resposta, em `after()`). */
export type EmailDeConta = { organizacaoId: string; eventoId: string };

type Dona = { organizacaoId: string; config: ConfigWhatsapp };

/**
 * O bloco é da organização? Os quatro campos de mensagem exigem o número configurado igual ao do bloco (T18: sem número
 * configurado, nada de mensagem é aceito); o `account_update` dispensa o número e é aceito se alguma das WABA do bloco
 * (`entry.id` ou `waba_info.waba_id`, T17) for a configurada.
 */
function aceito(b: BlocoLido, config: ConfigWhatsapp): boolean {
  if (b.campo === "account_update") return config.wabaId !== null && b.wabaIds.includes(config.wabaId);
  return b.numeroId !== null && config.numeroId === b.numeroId;
}

/**
 * 1. Para cada WABA distinta do aviso, a organização dona (uma consulta por WABA, guardada durante a chamada); o bloco
 *    sem WABA (só o histórico recusado sem envelope) acha a organização pelo número. Bloco cujas WABA dão nenhuma ou
 *    mais de uma organização, ou que a organização não aceita (`aceito`), soma 1 em `outra_conta`.
 * 2. Uma transação: `gravarBlocos` por organização (na ordem do corpo) e, no fim, os contadores do dia com o "último
 *    aviso válido" (o aviso passou pela assinatura): `outra_conta`, o que a leitura descartou fora de um bloco, e o
 *    que a leitura e a gravação contaram nos blocos aceitos (os de outra conta não somam os contadores deles).
 * Devolve os eventos de conta novos que pedem e-mail.
 */
export async function receberAviso(db: Db, aviso: Extract<AvisoLido, { ilegivel: false }>, agora: Date): Promise<{ emails: EmailDeConta[] }> {
  const porWaba = new Map<string, Dona | null>();
  const porNumero = new Map<string, Dona | null>();
  const donaDaWaba = async (waba: string) => {
    if (!porWaba.has(waba)) porWaba.set(waba, await organizacaoDaConta(db, [waba]));
    return porWaba.get(waba) ?? null;
  };
  const donaDoNumero = async (numero: string) => {
    if (!porNumero.has(numero)) porNumero.set(numero, await organizacaoDoNumero(db, numero));
    return porNumero.get(numero) ?? null;
  };
  async function donaDoBloco(b: BlocoLido): Promise<Dona | null> {
    if (!b.wabaIds.length) return b.numeroId !== null ? donaDoNumero(b.numeroId) : null;
    const donas = new Map<string, Dona>();
    for (const waba of b.wabaIds) {
      const d = await donaDaWaba(waba);
      if (d) donas.set(d.organizacaoId, d);
    }
    return donas.size === 1 ? [...donas.values()][0] : null;
  }

  const soma: ContagemDoDia = somarContagens({}, aviso.contagem);
  const porOrganizacao = new Map<string, BlocoLido[]>();
  for (const b of aviso.blocos) {
    const dona = await donaDoBloco(b);
    if (!dona || !aceito(b, dona.config)) {
      soma.outra_conta = (soma.outra_conta ?? 0) + 1;
      continue;
    }
    porOrganizacao.set(dona.organizacaoId, [...(porOrganizacao.get(dona.organizacaoId) ?? []), b]);
  }

  return db.transaction(async (tx) => {
    const emails: EmailDeConta[] = [];
    for (const [organizacaoId, blocos] of porOrganizacao) {
      const r = await gravarBlocos(tx, organizacaoId, blocos, agora);
      somarContagens(soma, r.contagem);
      emails.push(...r.emails.map((eventoId) => ({ organizacaoId, eventoId })));
    }
    await somarNoDia(tx, soma, agora, { valido: true });
    return { emails };
  });
}
