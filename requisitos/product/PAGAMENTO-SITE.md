# Pagamento da reserva direta no site (M8.2)

> Situação: desenho de 8/10/2026 para o M8.2, dividido em cinco partes (M8.2a a M8.2e), revisado
> por quatro leituras adversariais (dinheiro, concorrência, segurança e produto) e pela primeira
> revisão do Codex. Ajustado em 9/10/2026 pela revisão do código do M8.2a (liberação, devolução
> em dobro, travas, freios e taxa perdida) e pela conferência das correções (data da liberação à
> mão, devolução sem resposta, Pix real no teste, situação inesperada, trava da reserva). Base:
> ROADMAP (M8.0, M8.1, M8.2, M7.4, M4.10, M4.12, M12.2), `RECEBIMENTO-SITE.md`,
> `COTACAO-E-HOLD-SITE.md` e `REPASSES-POR-PERIODICIDADE.md`. API conferida
> na documentação oficial do Mercado Pago em 8/10/2026 (Checkout Transparente pela Orders API); o
> que a documentação deixa em aberto está em "A conferir no sandbox".
> **M8.2b (cartão) pronto em 9/10/2026**, só no teste, com o desenho revisado por uma leitura
> adversarial (dinheiro, segurança, API e produto) e a documentação de Orders e do Card Payment Brick
> relida em 9/10/2026: seção "Cartão (M8.2b)" e itens 9 a 29 de "A conferir no sandbox".
> **M8.2c (cancelamento de reserva paga, pela política) pronto em 10/10/2026**, só no teste, com o
> desenho revisado por quatro leituras adversariais (dinheiro, concorrência, produto e API/segurança)
> e a documentação de devolução das Orders relida em 9/10/2026: seção "Cancelamento pela política
> (M8.2c)" e itens 30 a 43 de "A conferir no sandbox". A devolução de parte do valor que o M8.2a e o
> M8.2c deixaram de fora passou para o M8.2d.
> **M8.2d (alteração de reserva paga e devolução de parte do valor) pronto em 10/10/2026**, só no teste, com o
> desenho revisado por quatro leituras adversariais (dinheiro, concorrência, produto e API/segurança) e a
> documentação de devolução das Orders relida em 10/10/2026: seção "Alteração de reserva paga (M8.2d)" e itens 44
> a 58 de "A conferir no sandbox". Com ele, várias devoluções por pagamento, a devolução de parte do valor (pedida
> ao Mercado Pago só depois da liberação do pagamento) e o que o M8.2a e o M8.2c deixaram (o restante de um
> pagamento já devolvido em parte, a devolução parcial por fora, a devolução feita a menos). As frases "chega no
> M8.2d" das seções anteriores ficam como histórico, com o que vale desde 10/10 ao lado.
> **M8.2e (contestação do pagamento: chargeback, MED do Pix e reclamação no Mercado Pago) pronto em 11/10/2026**, só no
> teste, com o desenho revisado por quatro leituras adversariais (dinheiro, concorrência, produto e API/segurança) e a
> documentação de contestações das Orders relida em 11/10/2026: seção "Contestação (M8.2e)" e itens 59 a 73 de "A conferir
> no sandbox". Com ele, as cinco partes estão prontas no teste; o pagamento de verdade continua esperando as decisões
> marcadas com ★. As frases "fica com o M8.2e" das seções anteriores ficam como histórico, com o que vale desde 11/10 ao
> lado.

## As cinco partes

| Parte | O que entrega | Depende de |
|---|---|---|
| **M8.2a** | **Pix em teste e a base de tudo:** adaptador, aviso assinado, conferência, confirmação só com as datas seguradas (inclusive aprovação tardia), taxa real, liberação virando o recebimento do M4.10, devolução do pagamento que ficou sem reserva, o que o hóspede vê em cada situação, painel e as travas. | M8.1 |
| **M8.2b** | **Cartão** (pronto em 9/10/2026, seção "Cartão (M8.2b)"): Card Payment Brick, parcelas com juros do hóspede e máximo configurável, freios contra teste de cartão roubado, identificação do aparelho, análise do cartão. | M8.2a |
| **M8.2c** | Cancelamento de reserva paga pela política (pronto em 10/10/2026, seção "Cancelamento pela política (M8.2c)"): integral até 14 dias antes, nada depois, arrependimento de 7 dias; lançamentos por componente, taxa que não volta com a SCL, dinheiro retido no cancelamento sem reembolso, desconto da parte já repassada no repasse seguinte. | M8.2a |
| **M8.2d** | Alteração de reserva paga (pronta em 10/10/2026, seção "Alteração de reserva paga (M8.2d)"; datas, pessoas ou valor, só antes da entrada), com novas datas seguradas, cobrança da diferença ou devolução parcial; e a devolução de parte do valor que o M8.2a e o M8.2c deixaram (o restante de um pagamento já devolvido em parte, a devolução parcial por fora, a devolução que o Mercado Pago fez a menos). | M8.2c |
| **M8.2e** | Contestação (chargeback) (pronta em 11/10/2026, seção "Contestação (M8.2e)"): a disputa lida da order, da Chargebacks API e da Payments API, ou registrada pela equipe (também o MED do Pix e a reclamação no Mercado Pago); a reserva em conferência até a decisão de quem arca; o valor segurado nos repasses; o resultado sempre confirmado pela equipe; os lançamentos de cada momento; "Cancelar a reserva contestada" antes da entrada. | M8.2b, M8.2c |

O pagamento **de verdade** só liga com as cinco partes e o M7.4 feitos (o M7.4 ficou pronto em
9/10/2026: páginas legais e aceite antes do Pix, desenho em `PAGINAS-LEGAIS.md`; o M8.2b ficou pronto
em 9/10/2026, o M8.2c e o M8.2d em 10/10/2026 e o M8.2e em 11/10/2026: as cinco partes estão prontas no teste), e com as decisões pendentes de Diego: taxa do pagamento (hoje sai antes da divisão; se a SCL passar a arcar, o motor precisa de
base por canal, porque a opção atual vale para todos), arrependimento conferido com o contador (e o
limite "até o horário de entrada", com o advogado),
a verificação do banco (3DS) do cartão (padrão "quando houver risco"; com "nunca", toda contestação
por cartão roubado fica com a SCL), a devolução por fora do cartão, o campo de e-mail do formulário do
cartão em produção (seção "Cartão (M8.2b)"), quem arca com a taxa e a parte do proprietário quando a SCL
cancela ou dá uma exceção, e ligar os e-mails ao hóspede (recibo do pedido de cancelamento, decisão e
devolução; seção "Cancelamento pela política (M8.2c)"). Desde o M8.2d, também: a redução contando da entrada
original ou da nova, a que vier primeiro; a taxa do Mercado Pago sobre a parte devolvida com a SCL; a política e
o arrependimento depois de uma alteração (a versão e a aprovação do primeiro pagamento); a devolução de parte
esperando a liberação do pagamento; e os e-mails da alteração (seção "Alteração de reserva paga (M8.2d)"; GUIA,
seção 7). Desde o M8.2e, também as seis decisões ★ da contestação: quanto o proprietário perde quando ele arca, "a
proporção da sua parte", o que fica segurado, o resultado e o valor perdido confirmados pela equipe, o pagamento não
reconhecido (pela verificação do banco) e a disputa antes da entrada (seção "Contestação (M8.2e)", "Decisões de
Diego"; GUIA, seção 7).

## Perímetro do teste (parte a)

- **O teste roda só nas prévias da Vercel** (e no computador de desenvolvimento), nunca no deploy
  de produção. As prévias usam o banco de prévia; o banco de produção já tem a operação real
  (recebimentos de outubro, chaves Pix, início do sistema) e um pagamento de teste ali criaria
  receita, parte do proprietário e repasse de verdade.
- No deploy de produção (`VERCEL_ENV=production`), com chaves de teste ou não, o site segue pelo
  pedido na conversa e Integrações diz "o teste do pagamento roda nas prévias".
- As chaves de teste vão na Vercel **só no ambiente Preview**.
- Como a Vercel não deixa o Mercado Pago chegar às prévias, no teste a confirmação vem da página do
  hóspede (que consulta o provedor enquanto espera) e do botão **Conferir agora** do painel. O aviso
  assinado (webhook) é testado com o botão "Simular" do Mercado Pago contra o endereço de produção,
  que só confere a assinatura e registra o evento (lá não há pagamento a aplicar).
- A página mostra "Ambiente de teste: nenhuma cobrança real" e o painel marca "pagamento de teste".

## Variáveis e travas

| Variável | Para quê |
|---|---|
| `MERCADOPAGO_PUBLIC_KEY` | chave pública: desde o M8.2b, usada pelo formulário do cartão no navegador (sem ela, o cartão não é oferecido; o Pix continua) |
| `MERCADOPAGO_ACCESS_TOKEN` | chave privada, só no servidor |
| `MERCADOPAGO_WEBHOOK_SECRET` | assinatura secreta dos avisos |
| `MERCADOPAGO_AMBIENTE` | ausente ou exatamente `teste` = teste; exatamente `producao` = travado; qualquer outro valor = configuração inválida, travado, com aviso |

Cobrança só acontece com tudo isto (uma função só decide, para criar, cancelar e devolver):
1. fora do deploy de produção: só nas prévias da Vercel (`VERCEL_ENV=preview`), no `vercel dev` e no
   computador de desenvolvimento (sem `VERCEL_ENV` e com `NODE_ENV` diferente de `production`); um
   servidor ou script fora da Vercel com `NODE_ENV=production`, ou um `VERCEL_ENV` inesperado, conta
   como produção;
2. ambiente `teste`;
3. as duas chaves presentes;
4. **conta conferida como de teste no Mercado Pago** (`GET /users/me`; critério positivo, ex.:
   marca `test_user`, a conferir no sandbox; resposta estranha ou falha = não é teste; resultado
   guardado alguns minutos, inclusive a falha; nas telas do site e do painel a conferência espera no
   máximo 2 s: passou disso, não cobra naquela hora, a página segue e a conferência continua no fundo);
5. a chave "Oferecer pagamento no site" ligada no painel (começa **desligada**: o Diego liga na aba);
6. as três páginas legais publicadas — termos de uso, política de privacidade e política de
   cancelamento (M7.4, motivo `sem_paginas_legais`, conferido depois da chave do painel e antes da
   conta). Cancelar, conferir e devolver não dependem delas (`provedorDeConferencia`).

O **cartão** (M8.2b) precisa, além disso, de "Oferecer cartão de crédito" ligado (começa
**desligado**), da chave pública e do disjuntor de recusas fechado (`ofertaDeCartao`). Nada disso
entra na função acima: com o cartão desligado ou o disjuntor aberto, o Pix continua.

Aviso com `live_mode=true` (não é assinado; serve de alarme) vira aviso no painel. Nas tentativas
gravadas fica o ambiente e o `live_mode` lido do provedor. **Desvio registrado (9/10):** uma order
lida com `live_mode=true` no teste nunca confirma reserva (vira "aprovado sem reserva", motivo
`ao_vivo`), e um Pix recém-criado assim é cancelado na hora: "Gerar Pix" responde falha (nunca "deu
certo" com um Pix já cancelado, nem com uma order que a criação já devolve aprovada) e o prazo
provisório das datas volta ao que era. Depois disso a
cotação não gera outro Pix (nenhum dos 3 se gasta) e a página nunca mostra aquele QR: enquanto o
cancelamento não se confirma, "conferindo" (cada consulta da página manda cancelar de novo); depois,
"o pagamento pelo site não está disponível agora: fale com a equipe", sem "Gerar outro Pix".

## Quando o site oferece o Pix

Além das travas (entre elas, as três páginas legais publicadas: M7.4, `podeCobrar`): cotação
**segurada** com o pedido ainda em `pedido`; situação **disponível**
(cotação "a confirmar" segue pela conversa); e o **mesmo cálculo do motor**, em seco, na data de
entrada, dá receita e parte do proprietário sem pendência (contrato de gestão vigente na entrada,
um proprietário, quem recebe do site = empresa). Marketplace segue pela conversa até o M12.2. Fora
disso, a página mostra o fluxo de hoje, e a aba de pagamento lista cada imóvel com o motivo.

## Tabelas (migração 0061; cartão na 0066; colunas em texto como nas tabelas novas)

- **`pagamentos`**: uma linha por tentativa (cada order aceita uma transação). Cotação, reserva,
  imóvel, ambiente, forma, referência única (`scl-<id>`), chave de idempotência da criação,
  situação local (abaixo), id da order, `live_mode`, **valor** (o que enviamos: igual a
  `cotacoes.total`), valor pago pelo hóspede (só para mostrar), taxa, líquido, liberação prevista,
  liberação confirmada, copia e cola e imagem do Pix (apagados quando o Pix vence ou é pago), prazo
  do Pix, `consultadoEm`, desfecho (`reserva`, `devolucao`, `por_fora`) com motivo, autor e data,
  motivo de "sem reserva". Índice único parcial: um desfecho `reserva` por reserva. Nada de CPF,
  e-mail ou nome do pagador; nada de resposta crua do provedor.
- **`devolucoes_pagamento`**: uma por pagamento (índice único; toda busca passa por
  `devolucaoDoPagamento`, a regra que o M8.2d muda); motivo, valor, situação (`pedida`, `confirmada`,
  `recusada`, `por_fora`), tentativas, chave da tentativa atual (`devolucao:<id>:<n>`), próxima
  tentativa, id da devolução no provedor. Desde o M8.2c, também a origem (abaixo). **Desde o M8.2d, várias por
  pagamento**: o índice único virou cinco parciais (uma `pedida` por pagamento) e `devolucaoDoPagamento` saiu
  (migração 0068, abaixo; regras em "Alteração de reserva paga (M8.2d)", "Várias devoluções por pagamento").
- **`eventos_pagamento`**: avisos com assinatura válida (tipo, ação, id, request-id, ts, quando,
  resultado), índice único por (request-id, ts, id) para não processar repetição (o evento e o "último
  aviso válido" são gravados numa transação só: se um falhar, nada fica, e o reenvio é processado como novo); apagados depois de
  90 dias. Sem request-id e sem ts não há como reconhecer a repetição: cada aviso é um evento novo e é
  processado (a leitura da order é idempotente), para dois avisos diferentes da mesma order nunca se
  fundirem num só. Assinaturas inválidas só contam num número agregado do dia ("assinaturas recusadas") e
  no "último aviso válido em".
- **Migração 0066 (M8.2b), colunas novas em `pagamentos`** (texto sem CHECK, como as outras):
  `parcelas`, `bandeira` (`payment_method_id`), `tres_ds` (modo pedido, retrato do painel na criação),
  `tres_ds_status` (último resultado lido, maiúsculo, lista fechada), `etapa_cartao` (`desafio`,
  `analise`, `processando`; só com a situação `pendente`), `desafio_url` (apagado quando a etapa deixa de
  ser `desafio`), `prazo_analise_ate` (a extensão única da análise; preenchido em qualquer tentativa da
  cotação = já usada), `com_dispositivo` (o pedido trouxe um id de aparelho válido; o id nunca é
  guardado), `encerrado_em` (primeira saída para recusado, cancelado ou vencido, qualquer forma),
  `cancelamento_por` (`hospede`, `sistema`, `equipe`), `conta_no_disjuntor`, `id_pagamento_provedor`
  (id numérico da Payments API, para as contestações do M8.2e) e `custo_parcelas_vendedor` (custo do
  "parcelamento sem acréscimo" cobrado da SCL, da última leitura que o trouxe). `valor_pago` passa a
  guardar também o total pago com os juros. Índice parcial dos cartões por organização e data (teto
  geral e disjuntor).
- **`disjuntores_cartao`** (M8.2b): uma linha por disparo do disjuntor (aberto em, até quando — vazio =
  só religando à mão —, recusas contadas, janela `30min` ou `24h`, reincidente, religado em e por quem).
  Aberto = sem `religado_em` e com `ate` vazio ou no futuro. Nada de IP, e-mail ou dado de cartão.
- **Migração 0067 (M8.2c), idempotente como a 0053** (`IF NOT EXISTS` em tudo; cada chave estrangeira num
  bloco que confere `pg_constraint`), porque o banco das prévias é compartilhado:
  - tipo de lançamento novo `devolucao` (o dinheiro que voltou ao hóspede: saída, `montante` = o que saiu,
    `valor` 0);
  - `reservas.valor_retido` (centavos que ficaram com a empresa numa reserva **cancelada** sem devolução;
    o motor divide esse valor como uma reserva confirmada);
  - em `pagamentos`, o que a última leitura mostrou: `devolvido_lido`, `devolucao_em_andamento_lida` e
    `devolvido_visto_em` (primeira leitura que viu o pagamento devolvido; gravada uma vez);
  - tabela **`cancelamentos_reserva`**: uma linha por pedido ou cancelamento (situação `pedido`,
    `cancelada` ou `descartado`; no máximo um ativo por reserva, índice único parcial), com o momento em
    que a SCL recebeu o pedido (e o registrado antes, quando o financeiro o corrigiu, com o motivo), canal,
    quem cancela, motivo da SCL, motivo da exceção (lista fechada), notas validadas, o retrato da política
    e da decisão (versão, dias, limite do arrependimento, último dia do integral e do arrependimento,
    instante da entrada, calculado, direito, base, valor pago, valor a devolver), quando o resultado e o
    caixa foram lançados, `espelhado`, as marcas das OTAs e de "hóspede avisado" (pedido, decisão,
    devolução), o descarte (quem, quando, motivo; no pedido do site, canal e hora da desistência). Linhas
    descartadas nunca são apagadas;
  - em `devolucoes_pagamento`: `origem` (`sem_reserva` do M8.2a, `cancelamento`; o M8.2d acrescentou
    `alteracao`), `cancelamento_id`, `saida_lancamento_id`, `confirmada_por` (`leitura` ou `equipe`),
    `confirmada_nota`, `valor_confirmado`, `ultimo_codigo` (lista fechada), a recusa registrada do painel do
    Mercado Pago (quando, quem, nota) e a parada (quando, nota). O comentário de `falhas` foi corrigido:
    resposta incerta conta; "aguarde" não.
- **Migração 0068 (M8.2d), idempotente como a 0067:**
  - tabela **`alteracoes_reserva`** (sem dado pessoal): reserva, cotação original, o pagamento que confirmou a
    reserva, situação (`segurada`, `aplicada`, `expirada`, `desistida`; no máximo uma segurada por reserva, índice
    único parcial `alteracoes_reserva_uma_segurada`), quem pede (`hospede`, `empresa`) e o motivo da SCL, o momento
    e o canal do pedido, nota validada, antes e depois (datas, pessoas, valor), origem do valor (`cotacao`,
    `mantido`, `digitado`) com motivo de lista fechada e nota, o retrato da cotação das datas novas, a diferença
    (com sinal), a entrada de que a política conta, as noites novas, o prazo das datas seguradas e a reserva-pedido
    que as segura (índice único), o retrato da política e da decisão (só na redução), o valor a devolver, a
    assinatura, a taxa e o resultado por mês depois de aplicada, quem e quando aplicou (e se foi tardia), venceu ou
    desistiu (com o motivo), as marcas das OTAs (`ota_atualizada_em/por`) e de "hóspede avisado" (proposta,
    confirmação, devolução). Linhas nunca apagadas; as chaves estrangeiras de nome longo têm nome explícito;
  - em `pagamentos`: `alteracao_id` (as tentativas da diferença) e `devolvido_fora_reconhecido` (centavos que o
    painel do Mercado Pago devolveu fora do sistema e a equipe reconheceu numa decisão; só cresce, sob a trava,
    auditado); índices `pagamentos_um_desfecho_alteracao` (um desfecho `alteracao` por alteração) e
    `pagamentos_alteracao`;
  - em `devolucoes_pagamento`: `alteracao_id`, `origem_devolucao_id` (o restante de uma devolução feita a menos),
    `avisos` (os da própria devolução), `caixa_lancado_em` (o caixa desta devolução acertado), `taxa_atribuida` (a
    taxa da parte devolvida, congelada) e `corpo_integral` (a forma do corpo enviado com a chave atual);
  - o índice `devolucoes_pagamento_um_por_pagamento` sai e entram cinco parciais (`devolucoes_pagamento_sem_reserva`,
    `_do_cancelamento`, `_da_alteracao`, `_restante` e `_uma_pedida`) e um simples por pagamento
    (`devolucoes_pagamento_pagamento`);
  - duas cópias de dados, que só mexem em linhas ainda no padrão (rodar de novo não muda nada): os avisos de
    devolução do pagamento passam para a devolução (até aqui, uma por pagamento) e o caixa já acertado das
    devoluções de cancelamento fica marcado na própria devolução;
  - listas no código, sem migração: desfecho `alteracao`, origem de devolução `alteracao`, situação de devolução
    `substituida`, reserva de fonte `alteracao`, os motivos "sem reserva" da diferença, os códigos `ja_devolvido` e
    `aguardando_liberacao`, o aviso `devolucao_aguardando_liberacao_atrasada`, as duas mensagens novas e
    `regras.site.minutosHoldAlteracao`.
- **Migração 0069 (M8.2e), idempotente como a 0067 e a 0068:**
  - tabela **`contestacoes_pagamento`** (sem dado pessoal; linhas nunca apagadas): uma linha por disputa e rodada, com
    a identificação (tipo, origem, ids do caso, da contestação e da transação), a situação, o que a leitura mostrou, a
    decisão de quem arca, o resultado e os vínculos de caixa;
  - tabela **`eventos_contestacao`** (a linha do tempo de cada disputa, só códigos, datas e centavos; nunca apagada);
  - `pagamentos.contestacoes_buscadas_em` (a busca tardia semanal) e `devolucoes_pagamento.contestacao_id` (a devolução
    substituída pela disputa, com chave estrangeira de nome próprio);
  - índices `contestacoes_pagamento_caso`, `_cbk`, `_sem_id` (únicos parciais), `_situacao`, `_leitura` (parcial, só as
    não finais), `_reserva` e `_pagamento`, e `devolucoes_pagamento_contestacao` (parcial);
  - listas no código, sem migração: as da seção "Contestação (M8.2e)", "Tabelas" (situações, tipos, origens, estados
    lidos, causas, quem arca, avisos, o desfecho `contestacao`, a origem de lançamento `contestacao_pagamento`, a base de
    cancelamento `contestacao` e o valor `contestacao` de `confirmada_por`).

  As listas fechadas ficam no código (texto sem CHECK, como as outras tabelas novas). A configuração muda
  só no JSON (`pagamento_site`, versões da `politica_cancelamento`, `textos_site`, `mensagens_hospede`).

**Situação local** de uma tentativa: `criando` (gravada antes da chamada), `incerta` (a chamada
caiu e não se sabe se a order existe), `pendente`, `aprovado`, `recusado`, `cancelado`, `expirado`,
`devolvido`, `devolvido_parcial`, `contestado`. Transições (só por leitura do provedor, nunca pelo
relógio; sob a trava da tentativa): `criando`/`incerta` → qualquer; `pendente` → qualquer outra;
`recusado`, `cancelado`, `expirado` → só `aprovado` ou depois (dinheiro vence ausência de
dinheiro); `aprovado` → `devolvido_parcial`, `devolvido`, `contestado`; `devolvido_parcial` →
`devolvido`, `contestado`. Desconhecido nunca sobrescreve uma situação conhecida (vira aviso).
Tentativa com desfecho `reserva` que vira devolvida ou contestada por fora gera aviso, sem mexer na
reserva (partes c e e). **Desde o M8.2e**, `contestado` tem duas saídas: → `devolvido` com um pedido de devolução
aceito (a leitura o confirma) e → a situação de antes da disputa (`situacao_pagamento_antes`) quando todas as disputas
do pagamento terminam ganhas ou sem efeito, pela confirmação da equipe e só se o pagamento ainda está `contestado`
(nunca pela leitura; auditoria `pagamento.situacao`, motivo `contestacao_ganha`). A situação que a leitura dá a um
pagamento com disputa sai de `situacaoDaLeitura` (`contestacaoDaLeitura`): seção "Contestação (M8.2e)".

**Etapa do cartão (M8.2b):** a verificação do banco, a análise e o processamento do Mercado Pago
continuam `pendente`; a etapa vai em `etapa_cartao` e muda só o texto, o prazo das datas, o intervalo de
leitura e o que dá para cancelar. Nenhuma situação nova: a carência, a trava das ações da equipe, as
transições e a rotina do `pendente` valem iguais.

A reserva continua `pedido` enquanto o hóspede paga. Não há estado novo de reserva.

## Ordem das travas (uma só, em todos os caminhos)

imóvel (`FOR NO KEY UPDATE`) → reserva (`FOR NO KEY UPDATE`) → cotação → tentativas da cotação (por
id) → devolução → **cancelamento ativo da reserva** (M8.2c) → **motor da reserva**
(`travarMotorDaReserva`, M8.2c) → documentos legais / disjuntor / livro. Motor e livro travam depois, como já fazem.
**Desde o M8.2d:** … → cancelamento ativo → **todas as alterações da reserva** (por id) → motor da reserva →
**linha da reserva-pedido da alteração** (`FOR NO KEY UPDATE`, só pelo código da alteração: `cancelarPortador`) →
motor da reserva-pedido → documentos legais / disjuntor / livro. **Desde o M8.2e:** … → alterações → **contestações dos
pagamentos da cotação** (por id, `FOR NO KEY UPDATE`; o retrato `Travado.contestacoes`) → motor da reserva → livro; toda
gravação em `contestacoes_pagamento` e `eventos_contestacao` acontece dentro de `travarCotacao` (seção "Contestação
(M8.2e)", "Dinheiro e livro"). Segurar uma alteração toma o motor da reserva e
depois cria a reserva-pedido (`sincronizarReserva`, trava consultiva da fonte, motor dela): a mesma ordem. O
cancelamento à mão (`tentarCancelarReserva`) recusa a reserva-pedido, e o recálculo de toda a empresa não passa por
ela. `segurarDatas` e `criarBloqueio` vencem as alterações do imóvel em savepoints, depois da trava do imóvel.
Desde o M8.2c, a trava do proprietário no fechamento, no antecipado (`travarDono`) e no estorno de repasse é
`FOR NO KEY UPDATE` (antes `FOR UPDATE`): fechamentos e antecipados do mesmo proprietário continuam em fila, mas
não esperam mais a conferência da chave estrangeira de quem grava um lançamento dele (o desconto do cancelamento),
o que dava impasse 40P01 com um fechamento. O imóvel e a reserva são travados com
`NO KEY UPDATE`, não `FOR UPDATE`: serializam pagamento e hold entre si e com quem muda a mesma linha
(bloqueios, contratos, confirmar ou cancelar à mão, recebimento lançado à mão, que trava a reserva antes de
conferir o pagamento, e o estorno dele, que trava a reserva antes do lançamento), mas não bloqueiam a conferência das chaves
estrangeiras de quem grava lançamentos, itens de repasse, limpezas ou pagamentos daquele imóvel ou
daquela reserva (com `FOR UPDATE`, a confirmação à mão e o Pix entravam em impasse; e um estorno da
liberação ou uma taxa tardia, que esperam a trava do motor, com um repasse ou recálculo que tem essa
trava e grava lançamentos da reserva). Os UPDATEs de reserva nessas transações não mexem nas chaves
únicas, e as releituras da reserva na mesma transação (gravar a taxa, confirmar o pedido pago, a
sincronização da reserva) usam o mesmo modo: uma releitura `FOR UPDATE` subiria a trava. Toda escrita
que ocupa noites passa pela mesma trava do imóvel, antes de qualquer outra: reserva lançada no painel,
importada do Beds24 ou da planilha (`sincronizarReserva`), bloqueio vindo do Beds24 (os bloqueios do
painel já travavam o imóvel). Assim uma importação nas mesmas noites espera a confirmação do pagamento
(ou o contrário), e a conferência das noites sempre vê a outra. Trava não
obtida (tempo-limite ou impasse desfeito pelo Postgres) = "ocupado": nada fica pela metade e o
hóspede tenta de novo; na rotina, o
hold que falhou é contado e os seguintes continuam. As chamadas ao Mercado Pago **nunca** acontecem
com trava aberta: três fases, como no envio ao Beds24 (gravar a intenção; chamar fora de transação;
reler e aplicar). A rotina de vencimento de holds passa a vencer cada hold numa transação curta,
travando o imóvel primeiro; e o pagamento nunca vence holds de outras cotações (a conferência das
noites só ignora pedidos já vencidos).

Cartão (M8.2b): a trava do disjuntor (advisory por organização) é a **última** de todas — imóvel →
reserva → cotação → tentativas → devoluções → páginas legais → disjuntor —, tomada só no fim de
`aplicarLeitura`, quando a tentativa que encerra conta no disjuntor; "Religar o cartão" toma só ela, então
não há ciclo. Depois da chamada ao Mercado Pago, trava não obtida na fase 3 nunca é "ocupado" (o cartão
pode ter sido cobrado): `guardarIdDaOrder` grava o id da order num comando só (`update … where id = ? and
id_provedor is null`, com o mesmo tempo-limite, esperando só aquela linha e sem segurar outra), e a fase 3
é tentada mais uma vez com a leitura em memória; falhou de novo, a tentativa fica `incerta` e as leituras
seguintes vão pelo id.

## Pix

- **Um Pix por vez.** Pix válido existente é mostrado de novo (mesmo QR, mesmo prazo). Pix novo só
  depois de cancelar o anterior no provedor (cancelado, já cancelado ou vencido). Até 3 Pix por
  cotação (constante, freio como os do M8.1), conferido **antes** de cancelar o anterior (o terceiro,
  ainda pagável, não é cancelado à toa).
- **Aceite das páginas legais (M7.4):** a fase 1 confere o aceite das versões publicadas agora
  (depois de reaproveitar um Pix válido, antes do teto), sob as travas compartilhadas dos três
  documentos tomadas depois das travas da cotação; o aceite que o formulário manda é gravado na mesma
  transação, e a tentativa nova guarda `pagamentos.aceite_id`. Sem aceite das versões em vigor,
  `aceite_pendente`; versões que mudaram com a página aberta, `aceite_mudou` — nos dois casos nada é
  criado e o prazo das datas não muda. Um Pix ainda válido continua com o aceite com que foi criado, e
  a aprovação nunca confere aceite. Detalhes em `PAGINAS-LEGAIS.md`.
- **Prazo:** o Pix vale no mínimo 30 minutos (regra do Mercado Pago). Na fase 1 o prazo das datas é
  estendido provisoriamente para agora + validade + 2 minutos; na fase 3, para o `date_of_expiration`
  devolvido + 2 minutos (só se o pedido ainda for `pedido` e a cotação `segurada`; senão o Pix é
  cancelado). Assim o QR nunca vale mais que as datas. Se o pedido nem chegou ao provedor (tentativa
  apagada), ou se o provedor recusou a criação (order recusada, ou dados inválidos sem order) e não há Pix
  para pagar, a extensão provisória é desfeita. A extensão aparece na tela do prazo das datas do painel
  ("com o pagamento ligado, cada Pix segura as datas por pelo menos 30 minutos"). Uma leitura sem o
  prazo (ou sem a imagem, ou o link) não apaga o que já se sabia do mesmo Pix; Pix pendente sem prazo
  nenhum vira aviso.
- **Carência:** a rotina e o `segurarDatas` não vencem um pedido com tentativa `criando`,
  `incerta`, `pendente` ou aprovada sem desfecho até 15 minutos depois do prazo; nesse tempo, as
  datas continuam ocupadas.
- **O mesmo e-mail:** segurar outras datas fica recusado enquanto o mesmo e-mail tem um Pix em
  andamento **na carência daquela cotação** (prazo + 15 minutos) ou um pagamento aprovado sem desfecho
  (este, sem limite de tempo). Uma tentativa que nunca se resolve não prende o e-mail depois da
  carência (e aparece no Início). A resposta é a mesma de "reserva em andamento": nada revela que
  aquela pessoa está pagando.
- Sem imagem do QR (o sandbox às vezes não manda), a página mostra o copia e cola e o link do
  Mercado Pago. No celular, o copia e cola vem primeiro.
- O e-mail do pagador enviado ao Mercado Pago sai do servidor: no teste, `test@testuser.com`
  (exigência do sandbox). A página nunca recebe nome, e-mail ou telefone da reserva.

## Cartão (M8.2b)

Pronto em 9/10/2026, só no teste, com as mesmas travas do Pix. Código: `app/src/pagamentos/cartao.ts`
(criação em três fases), `criacao.ts` (peças comuns com o Pix), `disjuntor.ts`, `aplicar.ts` (os efeitos
do cartão, num lugar só), `app/src/site/acoes-pagamento.ts` (`pagarComCartaoAcao`),
`app/src/site/mensagens-cartao.ts`, `app/src/components/site/PagamentoCartao.tsx`, `DesafioCartao.tsx` e
`sdk-mercadopago.ts`; migração 0066.

### Quando o site oferece o cartão

Tudo o que oferece o Pix (`podeCobrar`, cotação segurada, motor em seco sem pendência) **e**:
"Oferecer cartão de crédito" ligado em Configurações → Pagamento no site (vem **desligado** e só vale
com "Oferecer pagamento no site"), a chave pública presente e com formato válido, e o disjuntor fechado
(`ofertaDeCartao`; motivos `cartao_desligado`, `disjuntor` e `sem_chave_publica`, além dos do Pix). O
disjuntor e a chave do cartão nunca entram em `podeCobrar`: o Pix continua. Até 3 tentativas de cartão
por cotação, à parte dos 3 Pix.

### Formulário

- **Card Payment Brick** do Mercado Pago, carregado do endereço oficial
  (`https://sdk.mercadopago.com/js/v2`, sem pacote npm), só no componente do cartão e só com a oferta, o
  cookie da cotação e o aceite das páginas legais marcado (ou já registrado): o hóspede nunca digita o
  cartão antes de aceitar.
- **Só crédito:** o Brick esconde débito e pré-pago (`types.excluded`) e o servidor recusa qualquer outro
  tipo (`so_credito`), que é a trava de verdade; o erro do Brick `payment_method_not_in_allowed_types`
  mostra o mesmo texto.
- **Parcelas:** o máximo do painel (`parcelasMaximas`; vazio = o máximo que o Mercado Pago permitir, até
  36); o servidor confere de 1 até o teto antes de chamar o provedor. As opções, com os juros, o Brick
  busca no Mercado Pago com a chave pública; o servidor não busca parcelas (precisaria do BIN, que ele
  nunca recebe).
- **Juros do hóspede** (Diego, 4/10): o valor enviado (`total_amount`) é o total da cotação; os juros
  entram por cima, no que o hóspede paga (`valor_pago`), só para mostrar, nunca no livro. A página
  avisa: "No cartão parcelado há juros do Mercado Pago, pagos por você; o total aparece no formulário
  antes de confirmar." A confirmação aceita o pago maior que o total só pela própria tentativa: forma
  cartão e mais de 1 parcela (as parcelas da leitura ou, sem elas, as da tentativa: o GET pode vir sem
  esses campos).
- **E-mail:** no teste, o Brick já vem com `test@testuser.com` (o mesmo que o servidor envia), o que
  esconde o campo; a página continua sem receber o e-mail da reserva. Em produção, decidir junto com os
  e-mails do Mercado Pago ao comprador recusado (Limites).
- **CPF e aparelho:** o CPF digitado no Brick e o id do aparelho (`window.MP_DEVICE_SESSION_ID`, posto
  pelo SDK, enviado como `X-meli-session-id`) só passam pelo servidor a caminho do Mercado Pago; nada é
  guardado ou registrado (só `com_dispositivo`). Sem o id (bloqueador de anúncios), o pagamento segue.
- **Marca do Mercado Pago:** a linha fixa "Pagamento processado pelo Mercado Pago" e o título do Brick,
  com as bandeiras aceitas, visível (sem `hideFormTitle`).
- **O que o servidor lê:** só token, bandeira, tipo, parcelas, documento, aparelho, aceite e as versões
  das páginas legais, com tamanho limitado. E-mail, valor, emissor, BIN, últimos dígitos e titular
  mandados pelo navegador são ignorados; a resposta nunca devolve o que veio; o registro de erro leva só
  o tipo do erro.
- **Erros do Brick:** erro crítico → "Não deu para carregar o formulário do cartão. Recarregue a página
  ou pague com Pix.", com o Pix ao lado; débito ou pré-pago → o texto do `so_credito`; os outros erros de
  campo o próprio Brick mostra. Só a causa (`cause`, formato fechado) vai para o registro, nunca a
  mensagem.
- **Depois de uma recusa** o Brick é recriado (o token é de uso único); quando o teto, as parcelas ou a
  oferta mudaram, a página recarrega antes. Enquanto o formulário está aberto, a consulta de rotina da
  página não o apaga: a atualização espera, salvo quando chega dinheiro.

### Três fases e uma tentativa por vez

Como o Pix. Fase 1 sob as travas: oferta e disjuntor, tentativa em andamento, dinheiro, `live_mode`,
aceite, tetos (antes de cancelar qualquer coisa), cancelamento do pendente que dá para trocar, e a
tentativa gravada como `criando` (com `parcelas`, `bandeira`, `tres_ds` e `com_dispositivo`). Fase 2: a
chamada ao Mercado Pago, sem transação nem trava; o token e o CPF vivem só na memória dessa chamada.
Fase 3: aplica a resposta (confirma na mesma transação quando vem aprovada). Corpo: `processing_mode` e
`capture_mode` automáticos, `transaction_security` conforme o painel (3DS, abaixo), chave
`pagamento:<id>:criar`, referência `scl-<id>`, sem `issuer_id`. Não há prazo provisório das datas na
fase 1 (a carência protege a tentativa `criando`; recusa não tem o que desfazer).

| Situação | Pix novo | Cartão novo |
|---|---|---|
| Pix pendente válido | mostra o mesmo | cancela o Pix no Mercado Pago (pedido pelo hóspede), relê e só então cria (pago nesse meio = `ja_pago`) |
| Cartão no desafio do banco | cancela o desafio, relê e cria o Pix | cancela, relê e cria (conta nos 3) |
| Cartão em análise | `em_analise` | `em_analise` |
| Cartão processando, ou qualquer tentativa `criando`/`incerta` | `em_andamento` | `em_andamento` |
| Algum dinheiro | `ja_pago` | `ja_pago` |
| Alguma tentativa com `live_mode` | bloqueado | bloqueado |
| Teto da forma pedida | `limite` (a outra forma não é cancelada) | `limite` ou `limite_geral` (o Pix válido não é cancelado) |

### Criação sem resposta

Com captura automática, o cartão pode ser cobrado durante a chamada; um Pix que talvez não exista não
pode ser pago, um cartão pode já ter sido. Por isso:
- depois da fase 2, trava não obtida nunca é "ocupado" (ver "Ordem das travas"): o id da order é gravado
  e a fase 3 tentada de novo uma vez; senão, `incerto` ("Não deu para confirmar se o pagamento com cartão
  foi feito. Não pague de novo: a página atualiza sozinha assim que o Mercado Pago responder.");
- tentativa de cartão `criando`/`incerta` sem id da order só é dada por não criada
  (`cancelado/nao_criada`) depois de **24 horas** (`DESISTIR_SEM_ORDER_CARTAO_MS`) **e** com a busca de
  orders e a Payments API pela referência (`existePagamentoPorReferencia`) vazias na mesma leitura. Até
  lá fica `incerta`: a cotação responde `em_andamento`, o e-mail fica preso (abaixo) e o Início lista a
  tentativa depois da carência. O Pix continua com os 15 minutos;
- resposta incerta (409/423/500 `idempotency_validation_failed`, tempo esgotado, 5xx) = `incerta`,
  resolvida só por leitura (pelo id quando se sabe, senão pela referência), nunca com chave nova.

### Verificação do banco (3DS)

- **Painel:** "Verificação do banco (3DS)" com duas opções, nestas palavras: **Quando houver risco
  (recomendado)** — "o banco pede a verificação só nos pagamentos arriscados; quando o hóspede passa pela
  verificação, a contestação por cartão roubado fica com a bandeira; nos outros pagamentos, continua com
  a SCL" — e **Nunca** — "nenhuma verificação; toda contestação por cartão roubado fica com a SCL".
  Padrão: quando houver risco (decisão pendente de Diego). "Sempre" não é oferecido (não aparece na
  documentação de Orders do Brasil; sandbox, item 15).
- **Corpo:** `{ validation: "on_fraud_risk", liability_shift: "required" }` ou `{ validation: "never" }`.
  O modo fica em `pagamentos.tres_ds` (retrato do painel em cada tentativa) e o resultado lido em
  `tres_ds_status` (`AUTHENTICATED`, `NOT_AUTHENTICATED`, `CHALLENGE`, `ATTEMPTED`, `REJECTED`, `ERROR`).
- **Desde o M8.2e, a frase da causa `fraude` ("pagamento não reconhecido") segue o `tres_ds_status` do pagamento,
  congelado na abertura da disputa, nunca o modo `tres_ds`; quem decide quem arca é a equipe** (seção "Contestação
  (M8.2e)", "Quem arca: a decisão da equipe"). *Antes* (desenho de 9/10): "O M8.2e decide quem arca com a contestação
  pelo `tres_ds_status = AUTHENTICATED` de cada pagamento". *Motivo:* o sistema nunca escolhe quem arca; a verificação do
  banco vira a frase da regra ao lado da escolha. Se `ATTEMPTED` também passa a responsabilidade é pergunta ao Mercado
  Pago (sandbox, itens 15 e 65).
- **Desafio:** transação `action_required/pending_challenge` = etapa `desafio`. O endereço vem só na
  resposta da criação (o GET não o documenta) e só vale com https e domínio (ou subdomínio) de
  `mercadopago.com`, `mercadopago.com.br`, `mercadolibre.com` ou `mercadolivre.com.br`
  (`DOMINIOS_DESAFIO`); fica em `desafio_url` até a etapa mudar. A página mostra o desafio num quadro
  (`DesafioCartao`), que só aceita mensagens dessas origens e, com `COMPLETE`, consulta o servidor na hora
  (nunca confia no navegador; a consulta de rotina continua).
- **Prazo:** o Mercado Pago dá 40 minutos ao hóspede (`DESAFIO_3DS_MINUTOS`); as datas ficam seguradas
  até a criação + 42 minutos (só alonga; como o QR do Pix, não volta se o desafio terminar sem dinheiro,
  e são no máximo 3 cartões por cotação).
- **Desafio sem endereço válido** na resposta da criação → cancelado pelo sistema, aviso
  `desafio_sem_url`, o hóspede vê "verificação não concluída". Uma leitura que não é a da criação
  (aviso, página) nunca liga esse aviso, e uma leitura seguinte com o endereço guardado o desliga.
  **Desafio com as datas já vencidas** → cancelado pelo sistema (`prazo`: "O prazo das datas desta
  cotação acabou durante o pagamento: nada foi cobrado.").
- **Verificação que falhou** é decidida pela situação, não pelo código (o sandbox encerra o desafio
  recusado como `failed/failed`): a tentativa estava no desafio, ou `tres_ds_status` é
  `NOT_AUTHENTICATED`/`REJECTED`, ou o código é `cc_rejected_3ds_challenge`/`3ds_challenge_expired` →
  `verificacao` ("A verificação do seu banco não foi concluída. Tente de novo ou pague com Pix."). Desafio
  cancelado ou vencido também.

### Cartão em análise ou processando

- A situação continua `pendente`; a etapa é `analise` (`in_review`, `pending_review_manual`) ou
  `processando` (`processing/in_process`, o processamento em segundo plano).
- **Prazo das datas:** na primeira leitura em análise ou processando, uma vez por cotação, as datas
  ficam seguradas até `max(prazo atual, agora + minutos)`, com os minutos de **Configurações →
  Calendário e preços** ("Minutos a mais que um cartão em análise segura as datas", de 0 a 240, padrão
  60; 0 = nenhum), gravado em `prazo_analise_ate`. Depois, a carência normal e a aprovação tardia do
  M8.2a: noites livres com leitura atual = confirma; senão, "aprovado sem reserva" e devolução.
- **Nada mais nesta cotação** enquanto um cartão está em análise (`em_analise`: nem Pix nem outro cartão;
  o Mercado Pago não cancela um cartão em análise), e a equipe também não cancela nem confirma à mão.
- **Na página:** o texto editável `pagamentoCartaoAnalise` (texto-base: "…pode levar até 2 dias úteis…",
  sem horário; só na análise — o processando usa o texto de "conferindo") e uma linha fixa do prazo das
  datas, no fuso do imóvel: antes do fim, "As datas estão seguradas até HH:MM."; depois, "O prazo das
  datas acabou às HH:MM: se a análise aprovar e as datas ainda estiverem livres, confirmamos a reserva;
  senão, devolvemos o valor integral." A página lê no máximo uma vez por minuto nessa etapa
  (`INTERVALO_ANALISE_MS`), não a cada 15 s.
- **O mesmo e-mail:** além da regra do Pix, segurar outras datas com o mesmo e-mail fica recusado
  enquanto houver um cartão `criando`/`incerta`, ou pendente fora do desafio (análise ou processando),
  criado nos últimos **5 dias** (`PRAZO_CARTAO_SEM_RESPOSTA_DIAS`: "até 2 dias úteis" num feriadão passa
  de 4 dias corridos); solta sozinho assim que o Mercado Pago decide. A mensagem é uma só para todos os
  casos: "Já existe uma reserva ou um pagamento em andamento com este e-mail. Use o link daquela cotação
  ou fale com a equipe pelo WhatsApp."
- **Pagou duas vezes?** Uma confirmação tardia de cartão, com outra reserva do site do mesmo e-mail
  confirmada depois que esta tentativa foi criada, liga o aviso `outra_reserva_mesmo_email` ("o hóspede
  pode ter pago duas vezes. Confira com ele."). A regra de reviver o pedido não muda.
- **Início:** "N pagamento(s) com cartão em análise há mais de um dia…" (24 horas,
  `ALERTA_ANALISE_CARTAO_HORAS`, só o alerta).

### Freios

Constantes (defesa, como os do M8.1, não regra de venda), mostradas só para ler na aba Pagamento no
site; mudar é código, a pedido:
- **Por origem**, a cada envio do formulário que passa pelo cookie (token adulterado conta também): 5
  por hora por endereço de internet (IPv6 pela rede /64), 10 por hora sem origem conhecida. Este freio
  não conta no geral (`semGeral`): cliques que nunca chegam ao Mercado Pago não gastam a vez de ninguém.
- **Geral:** 30 tentativas de cartão por hora na empresa toda, contadas na fase 1 pelas linhas que
  chegaram ao Mercado Pago (`limite_geral`). Não é serializado entre cotações: algumas tentativas em
  paralelo podem passar da linha; quem para de verdade é o disjuntor.
- **Por cotação:** 3 tentativas de cartão (linhas que chegaram ao Mercado Pago, inclusive as recusadas
  por dados inválidos; linha apagada por falha de transporte não conta), uma em andamento por vez.
- **Disjuntor** (`disjuntor.ts`, tabela `disjuntores_cartao`): 8 recusas que contam em 30 minutos desligam
  o cartão por 60 minutos; no terceiro disparo em 24 horas, ou com 20 recusas em 24 horas, o cartão fica
  desligado até alguém religar. O Pix nunca é afetado.
  - **Contam** (decidido uma vez, na transição que encerra a tentativa, e gravado em
    `conta_no_disjuntor`): recusa que chegou ao banco ou à análise de risco (com order, ou o 402 sem
    `data`), salvo os códigos de token e `processing_error`; recusa ou vencimento que encerra um desafio
    com endereço (inclusive o `failed/failed`); cancelamento pedido pelo hóspede de um desafio com
    endereço (trocou por outro cartão ou pelo Pix: chegar ao desafio já diz a quem testa que o cartão
    vale).
  - **Nunca contam:** dados inválidos (4xx sem order), token (`invalid_card_token`,
    `card_token_not_found`, `invalid_token`), `processing_error`, falha de transporte, criação não feita,
    aprovações, análises, cancelamentos do sistema ou da equipe, `live_mode`.
  - A janela de 30 minutos conta desde o fim do último disparo; a de 24 horas, desde o último "Religar o
    cartão" (o fim automático de um disparo de 30 minutos não a zera). Recusas de antes de religar nunca
    disparam de novo. Duas recusas em paralelo no limite criam um disparo só (a trava do disjuntor). A
    contagem não tem limite de cima: `encerrado_em` é a hora em que o pedido começou, e uma recusa que
    começou antes pode terminar depois de outra; quem pega a trava por último conta todas as já gravadas.
  - Conferido em `ofertaDeCartao` (a página esconde o cartão), na ação (antes do provedor) e na fase 1
    (sob trava); nunca em `podeCobrar`, na conferência, no cancelamento ou na devolução.
  - **Religar o cartão:** só quem edita o financeiro, com confirmação; auditado
    (`pagamento.disjuntor_religado`). O disparo também é auditado (`pagamento.disjuntor_aberto`), só com
    contagens, janela e horário.
  - **Início:** disjuntor aberto (atenção, com link para a aba); alerta a partir de 10 recusas em 24 horas
    com o cartão ainda ligado; 3 recusas por token numa hora ("confira se a chave pública e o token do
    Mercado Pago são da mesma conta"). **Integrações** avisa quando a chave pública e o token parecem de
    contas ou ambientes diferentes (prefixos `TEST-` × `APP_USR-`).
- Ficaram de fora: teto por e-mail e contador de recusas por origem (quem testa troca de e-mail; o teto
  por origem já limita uma origem).

### Mensagens ao hóspede

Lista fechada (`MENSAGENS_CARTAO_HOSPEDE`, em `app/src/site/pagamento.ts` com os textos de
`mensagens-cartao.ts`), não editável: a recusa precisa continuar a mesma para todo motivo. Todo motivo do
banco ou da análise de risco (`bad_filled_card_data`, `high_risk`, `rejected_by_issuer`,
`required_call_for_authorize`, `max_attempts_exceeded`, `card_disabled`, `insufficient_amount`,
`card_insufficient_amount`, `amount_limit_exceeded`, `invalid_installments` e qualquer código
desconhecido) dá **o mesmo texto**: "Não foi possível aprovar o pagamento com este cartão. Confira os
dados, use outro cartão ou pague com Pix." As exceções não servem de pista a quem testa cartões: token
vencido ou inválido ("Os dados do cartão expiraram. Preencha de novo."), verificação do banco não
concluída (pela situação, acima) e `processing_error` (falha do próprio Mercado Pago: "Não deu para falar
com o Mercado Pago agora…", fora do disjuntor). Nunca um limite, nunca quando o disjuntor volta, nunca o
texto do provedor, nunca "Beds24". O adaptador devolve para toda recusa a mesma `mensagem` ("Pagamento
recusado pelo Mercado Pago."); o motivo vai num código, e os textos por motivo ficam só no painel
(`MOTIVOS_RECUSA_CARTAO`), para quem lê o financeiro. Sem a tela de situação do Mercado Pago (Status
Screen Brick).

### Devolução

- **Pelo Mercado Pago:** igual ao Pix (integral, corpo vazio); o valor registrado é o pago na order
  (com os juros, quando o Mercado Pago os mostra; sandbox, item 18).
- **Por fora, no cartão, só quando o Mercado Pago não pode devolver** (regra apertada no M8.2c, uma só para o
  pagamento sem reserva e para o cancelamento, `porForaPermitidoNoCartao`, que o quadro também usa): a
  devolução ficou recusada por uma recusa **definitiva** do Mercado Pago (`nao_permitido`, `prazo`, ou
  `nao_encontrado` dentro do prazo de leitura); a equipe registrou que o painel do Mercado Pago recusou a
  devolução; a leitura mostrou que a **nossa** devolução (o id gravado) falhou e o sistema a soltou (aviso
  `devolucao_falhou`); ou o pagamento passou dos 180 dias do Mercado Pago (`PRAZO_DEVOLUCAO_CARTAO_DIAS`).
  Saldo insuficiente, "aguarde", três respostas incertas e a devolução de um pagamento com mais de 78 dias
  (nada foi pedido) nunca abrem. Antes do M8.2c, qualquer `recusada` abria. Fora disso, recusa: "Pagamento com cartão: devolva pelo
  Mercado Pago. A devolução por fora só é registrada quando o Mercado Pago recusou a devolução ou o
  pagamento passou de 180 dias (a cobrança ficaria no cartão do hóspede e uma contestação poderia
  devolver de novo)." A releitura da order antes de registrar continua, e a confirmação avisa que o
  hóspede pode também contestar a cobrança no cartão e receber de novo. Order que não volta na releitura:
  dentro do prazo de releitura (85 dias), nada se registra; depois dele (o Mercado Pago só guarda a order
  por 90 dias, então o cartão depois dos 180 dias cai sempre aqui), vale o último valor pago que o sistema
  conferiu, com as mesmas regras locais (sem desfecho, sem pedido aceito à espera). Padrão com decisão pendente de
  Diego (GUIA, seção 7).
- **Antes da liberação:** no cartão, devolver antes de o Mercado Pago liberar o dinheiro pode pedir saldo
  disponível na conta; o texto de `devolucao_falhou` do cartão diz isso e manda conferir no Mercado Pago
  (sandbox, item 24).
- Devolução de parte do valor: M8.2d (o M8.2c só devolve o valor integral). **Feita no M8.2d (10/10/2026)**, só
  depois da liberação do pagamento; no cartão, o restante por fora segue a mesma regra do cartão (seção "Alteração
  de reserva paga (M8.2d)").

### Taxa e liberação

- **Taxa** = valor − líquido, de uma leitura da Payments API; os juros (`fee_payer: payer`) ficam de
  fora. A divisão (a taxa sai antes da divisão, na proporção) é a decisão pendente 3 de Diego e vale igual
  para o cartão, agora com taxas de ~4% a 5%.
- **Parcelamento sem acréscimo**, detectado pelo dinheiro e não pelo campo `installments_cost` (o exemplo
  da documentação mostra `"seller"` numa order comum): `custoParcelasVendedor` = soma dos `fee_details` do
  tipo `financing_fee` que não são do comprador (`pagamentos.custo_parcelas_vendedor`). Com mais de 1
  parcela e (custo > 0, ou aprovado com o pago igual ao valor) → aviso `parcelas_sem_juros`. Com o aviso
  ligado ou o custo > 0 (lido agora ou numa leitura anterior), a taxa não entra sozinha na reserva e a
  liberação não é lançada sozinha (o motor tiraria esse custo da parte do proprietário): a equipe decide
  quem paga e registra a liberação à mão. A trava não é decidida leitura a leitura: uma leitura seguinte
  sem o custo (`fee_details` ausente ou ilegível) não a solta. Parcelado com o líquido informado e o custo
  desconhecido também trava (nunca supor zero), com o aviso `custo_parcelas_desconhecido`, que sai quando o
  custo vem. Só a liberação registrada à mão (um recebimento em vigor, inclusive depois de o Mercado Pago
  conciliá-la) solta a trava e apaga os avisos; estornada, a trava volta. A SCL nunca oferece
  "parcelamento sem acréscimo"; Diego deixa a opção desligada no Mercado Pago.
- **Liberação em parcelas:** `money_release_schema` não vazio (ex.: `payment_in_flow`) ⇒ `liberado =
  null` e aviso `liberacao_em_parcelas`, nunca recebimento automático; a equipe registra a liberação à mão
  (feito no M8.2b, em `financeiroDoPagamento`, `mercadopago.ts`).
- **Prazo:** o cartão libera conforme o plano da conta (na hora 4,98%, 14 dias 4,49%, 30 dias 3,98%; a
  confirmar nos termos vigentes). A reserva fica "a liberar" até o sinal explícito `released`, com "o
  Mercado Pago libera em dd/mm"; a releitura de 6 em 6 horas e os 85 dias cobrem os 30 dias.
- **Sob disputa (desde o M8.2e):** com uma contestação não final ou perdida, a liberação nunca é lançada sozinha: a
  leitura com `liberado = true` liga `contestacao_liberacao_lida` e a equipe registra a liberação à mão, que passa a ser
  aceita sob disputa (o retido da disputa é outra linha); a taxa lida durante a disputa não muda a reserva (diferente da
  conhecida = `taxa_divergente`). `precisaFinanceiro` olha a situação explicada (`situacaoDaLeitura`), não a crua: a
  Payments API é lida durante a disputa (para o aviso da liberação lida) e depois da ganha, mesmo com a order ainda em
  `charged_back/*`, quando a liberação volta a lançar sozinha. Seção "Contestação (M8.2e)", "Liberação".

### Contestação (gancho para o M8.2e)

**Desde o M8.2e (11/10/2026), ver a seção "Contestação (M8.2e)".** O texto de 9/10 fica como histórico, com o que vale
agora ao lado.

A leitura da order dá `contestado` quando uma transação está `charged_back/*` ou algum
`transactions.chargebacks[].status` é `in_process` ou `settled`, qualquer que seja a situação da order
(só o `status` é lido: nunca `case_id`, `id` ou `references`). *Agora:* `normalizarSituacao` não muda, e
`transactions.chargebacks[]` passa a ser lido por lista branca para `Cobranca.contestacoes` (o `id` CBK…, o `case_id`,
o `transaction_id` só como pista, o `status` e o `amount`; `references`, `reason` e `documentation` continuam nunca
lidos). O id numérico da Payments API (é o que chega
nos avisos de contestação, cujo prazo de 180 dias passa da janela de leitura das orders) fica em
`pagamentos.id_pagamento_provedor`. *Correção de 11/10:* pela documentação atual, o aviso de contestação das Orders
chega como **order** (`ORD…`, `order.charged_back`), não pelo id numérico; o número do pagamento serve para ler a disputa
pela Chargebacks API e pela Payments API depois dos 85 dias, e desde o M8.2e o Pix também o grava. Registro, decisão de
quem arca e lançamentos são do M8.2e (feitos em 11/10); o aviso
assinado continua ignorando ids numéricos (até o item 59 do sandbox mostrar outro formato).

### Limites do M8.2b

- Sem captura manual (autorizar e capturar depois): a aprovação tardia do M8.2a já dá um desfecho a
  toda aprovação.
- **Antes do pagamento de verdade:** o campo de e-mail do Brick (preenchido ou à mostra), decidido junto
  com os e-mails do Mercado Pago ao comprador recusado (se dizem o motivo e se dá para desligar; no teste
  o e-mail é sempre `test@testuser.com`, então o sandbox não mostra); uma política de conteúdo com nonce
  (`script-src`/`connect-src`) em `/reservar` (o SAQ A do PCI pede a página do pagamento protegida
  contra script injetado; hoje só o `frame-src` está restrito); uma versão nova publicada da Política de
  privacidade.
- Juros e taxa na devolução, devolução antes da liberação, liberação das parcelas e o risco de
  `payments[0].amount` incluir os juros dependem do sandbox (itens 12, 14, 18 e 24).

## Quem pode pagar

O código da cotação circula no WhatsApp e não é credencial. Ao segurar as datas, o navegador recebe
um cookie assinado (finalidade própria, só para `/reservar`, validade até o fim do pedido). Gerar o
Pix e ver o QR exigem o cookie. Noutro aparelho, "Continuar o pagamento" pede o e-mail usado ao
segurar (conferido no servidor, com limite de tentativas) e emite o cookie de novo. Sem cookie, a
página mostra só a situação. Freios por endereço de internet e geral por organização para gerar Pix,
para "Continuar o pagamento", para a consulta da página e também para segurar as datas: a origem é
conferida **primeiro** e só o pedido que ainda cabe no teto dela conta no geral (uma origem só não
tira a vez de todo mundo, como na entrada com senha); IPv6 conta pela rede /64; origem desconhecida
conta numa chave compartilhada com teto baixo. O cartão (M8.2b) exige o mesmo cookie antes de qualquer
coisa (sem ele, nenhum token se gasta); o freio dele por origem não conta no geral, que é contado pelas
tentativas que chegam ao Mercado Pago (seção "Cartão", "Freios"). A validade do cookie cobre o prazo das
datas mais longo possível: 3 Pix, 3 desafios do banco e a maior extensão de cartão em análise (240
minutos), com as carências.

## Aviso assinado (webhook)

- Rota pública `POST /api/pagamentos/mercadopago`. Sem `x-signature` ou sem segredo configurado:
  401 sem ler o corpo nem tocar no banco. Corpo até 64 KB.
- Assinatura: HMAC-SHA256 de `id:<data.id da URL>;request-id:<x-request-id>;ts:<ts>;`, comparação em
  tempo constante; aceita o id como veio ou em minúsculas (documentação e SDK divergem). Só o
  `data.id` da URL vale (é o assinado); nada é decidido pelo corpo ou pelo `type`.
- `data.id` precisa ter o formato de order (`ORD…`); id numérico (contestação, pagamento, alerta
  de fraude) é registrado como ignorado, com 200. Order que este banco não conhece: 200, sem aviso.
- Válido: grava o evento (repetição = nada), responde 200 e processa depois da resposta, com tempo
  limite em cada chamada. O resultado fica no evento para a rotina saber o que falhou.
- Na parte (a), marcar no Mercado Pago só o evento "Order (Mercado Pago)". **Desde o M8.2e**, marcar também
  "Contestações" (`chargebacks`; GUIA, seção 6, item 37). O id numérico continua registrado como ignorado: o aviso de
  contestação das Orders chega como order (`ORD…`, `order.charged_back`) e a releitura da order traz a disputa
  (item 59 do sandbox).

## Conferência (uma função, vários gatilhos)

`conferirPagamento(tentativa)`: lê a order (pelo id, ou pela referência quando a tentativa está
`criando`/`incerta`), lê taxa/líquido/liberação na Payments API só quando faltam (no máximo a cada
alguns minutos), e aplica numa transação curta. Gatilhos: aviso, página do hóspede (no máximo uma
leitura a cada 15 s por tentativa, enquanto pendente e também no Pix recusado, cancelado ou vencido há
pouco, até 15 min depois do prazo dele (ou do mínimo de 30 min desde a criação, sem prazo conhecido; nunca
pela última atualização, que cada leitura muda), porque o cancelamento pode cruzar com o pagamento e o
provedor pode corrigir uma recusa (a mesma regra, `paginaAindaLe`, mantém a página acompanhando nesse tempo,
mesmo com os 3 Pix gastos ou depois do prazo das datas (sem outro pagamento a mostrar, a página fica em
"conferindo" até o fim dessa leitura), e relê essas tentativas antes de "Gerar outro Pix":
se uma virou dinheiro, nenhum outro sai; essa releitura é sempre **nova**, sem o intervalo de 15 s, porque a
última leitura da página pode ser de segundos antes do pagamento, e sem ela, com o provedor falhando, nenhum
outro Pix sai; os cliques já passam pelo freio por endereço); nas outras, a leitura é **reservada num comando só**
antes de chamar o provedor, então pedidos simultâneos leem uma vez; leitura que nem chegou ao
provedor não conta, mas na página o "muitas chamadas" (429) ou a falta de resposta (tempo esgotado,
5xx) **contam**: a página lê no máximo uma vez a cada 15 s mesmo com o Mercado Pago falhando — o
freio vale justamente quando a conta está no limite; na rotina, a leitura que falha não conta; freio
por endereço de internet), rotina (a de holds, que primeiro confere os pagamentos e só depois
vence holds) e **Conferir agora** no painel (sem o intervalo; o de tudo lê na hora tudo o que está no
prazo, sem os intervalos de 15 s, 6 h e 24 h da rotina; as devoluções seguem a espera entre envios). Uma
devolução parada logo na releitura nunca aparece como "pedida" para a equipe. A rotina relê uma vez por dia, por 85
dias, os pagamentos com desfecho (`reserva`, `devolucao`, `por_fora`) e os aprovados sem reserva à
espera da devolução: devolução ou contestação feita por fora, ou devolução em dobro, vira aviso, nunca
estorno automático. O prazo é o do Mercado Pago: a consulta da order (`GET /v1/orders/{id}`) só vale
para orders de até três meses; depois disso "não encontrada" é o limite do provedor e não vira aviso.
O mesmo prazo de 85 dias (uma regra só, `PRAZO_RELEITURA_DIAS`) vale para a tentativa que ficou em andamento
(nem a página nem a rotina leem mais, nem o cancelamento do Pix que sobrou numa cotação confirmada; o aviso "o
sistema parou de conferir" liga uma vez), para a releitura a
cada 6 h da taxa e da liberação que não chegaram (depois dele, a equipe registra à mão) e para as devoluções
pedidas: depois dele a rotina para de ler a order (a
confirmação nunca chegaria e as leituras gastariam o limite do provedor sem fim) e liga, uma vez, o aviso
de que o sistema parou de conferir aquela devolução; desde o M8.2c, a equipe resolve pelo painel do Mercado
Pago e registra no quadro do pagamento ("Confirmar devolução feita no painel do Mercado Pago", "Registrar
que o Mercado Pago recusou a devolução no painel" ou "Parar a devolução pedida"; seção "Cancelamento pela
política (M8.2c)", "Devolução"). Desde o M8.2c, o sistema também não **pede** mais devolução de pagamento
com mais de 78 dias (`MARGEM_PEDIDO_DEVOLUCAO_DIAS`): não daria tempo de conferir. Contestação tardia (até 180 dias) fica com o M8.2e, por outro caminho (Payments ou Chargebacks). *Desde 11/10:* a
rotina das disputas (`conferirContestacoes`, depois de vencer os holds) relê cada disputa aberta uma vez por dia, e a
busca tardia semanal (`buscarContestacoesTardias`) procura disputas novas de todo pagamento com o número, até 540 dias
(seção "Contestação (M8.2e)", "De onde vem cada fato", item 5).

No cartão (M8.2b), `paginaAindaLe` considera a forma: cartão recusado não é relido (order `failed` é
final); cartão cancelado ou vencido no desafio é relido até 15 minutos depois de encerrado (ou da criação
+ 40 minutos), porque o cancelamento pode cruzar com o fim do desafio. Na análise ou no processamento, a
página e a rotina leem no máximo uma vez por minuto (`INTERVALO_ANALISE_MS`); as leituras forçadas (aviso,
"Conferir agora", releitura da fase 1) não mudam. A criação sem resposta segue a regra das 24 horas
(seção "Cartão").

**Onde a rotina roda:** o cron da Vercel só roda no deploy de produção, onde o pagamento fica
desligado. No teste (prévias), nada confere sozinho: a página do hóspede confere o próprio Pix e o
**Conferir agora** do painel faz o papel da rotina (os avisos dizem isso). A limpeza dos avisos com
mais de 90 dias roda na rotina do site em qualquer ambiente (o webhook grava no deploy de produção),
nunca no "Conferir agora" de uma empresa.

## Confirmação (na transação, com as travas na ordem acima)

"Datas seguradas" = reserva ainda `pedido` e cotação ainda `segurada`, conferidas sob trava (as
noites nunca foram liberadas), seja qual for o relógio.

1. **Aprovado com as datas seguradas e sem conflito** (nenhuma outra reserva ou bloqueio nas mesmas
   noites, a própria reserva excluída da conta): a reserva vira `confirmada` (com `confirmadaEm`,
   quem recebe = empresa), a cotação `convertida`, o motor roda. Desfecho `reserva`. As outras
   tentativas pendentes da cotação são canceladas no provedor (isso vale para **qualquer** dinheiro que
   chegue, confirmando a reserva ou não: um Pix já copiado nunca fica pagável ao lado de um pago; a rotina
   também cancela o que sobrar numa cotação com dinheiro).
2. **Aprovado depois que o pedido venceu** (cotação `expirada`, vencida pela rotina ou pelo painel):
   confere as noites (livres no SCL e na leitura atual do Beds24, sem regras de venda nem preço).
   Livres: a mesma reserva volta a `confirmada` pelo valor pago, com auditoria "confirmação tardia".
3. **Qualquer outro caso** vira **aprovado sem reserva**, com o motivo gravado na mesma transação
   (depois disso só a equipe muda): noites ocupadas ou sem leitura atual para conferir; pedido
   cancelado pela equipe (cotação `cancelada`, ou reserva cancelada com a cotação ainda segurada:
   nunca é revivido); valor aprovado diferente do total da cotação (`total_amount`, o valor da
   transação — que precisa vir na order — e o total pago, quando vier; no cartão parcelado, o pago pode
   passar do total pelos juros do hóspede, decidido pela própria tentativa: forma cartão e mais de 1
   parcela, M8.2b); outra tentativa da mesma cotação já com desfecho `reserva`; reserva
   com recebimento registrado à mão (confirmada à mão, ainda `pedido` ou cancelada; a mesma conferência
   impede gerar o Pix, sob a trava da reserva que o recebimento à mão também toma); dinheiro que chega **já devolvido em parte ou
   contestado**, sem uma leitura "aprovado" antes (motivo "situação inesperada", com aviso: nunca
   confirma sozinho; o resto se resolve pelo painel do Mercado Pago, e a devolução de parte do valor pelo
   sistema chega no M8.2d — desde 10/10, "Devolver o restante ao hóspede"). **Desde o M8.2e**, o dinheiro que chegou
   contestado ganha a linha da disputa e segue o fluxo dela, com o resultado sempre confirmado pela equipe (o aviso diz
   "acompanhe a disputa pelo quadro do pagamento"); o por fora continua recusado enquanto ela não é ganha.
4. **Reserva confirmada à mão pela equipe** (sem recebimento manual e sem outra tentativa com
   desfecho `reserva`): o pagamento vira o desfecho `reserva` dela.
5. Recusado, cancelado ou expirado: nada muda; o hóspede pode tentar de novo enquanto as datas
   estiverem seguradas.
6. **Pagamento da diferença de uma alteração (M8.2d):** decidido antes de tudo isso, num savepoint, pela alteração
   (seção "Alteração de reserva paga (M8.2d)", "Aumento"); nunca confirma a reserva de novo.

Confirmar à mão um pedido que tem pagamento aprovado sem reserva (a devolver) fica recusado, com a
mensagem apontando o quadro do pagamento: o pagamento não se liga à reserva depois.

O retorno do navegador nunca confirma nada. O M8.2a não manda e-mail novo ao hóspede; a confirmação
do M9.2 passa a valer para reservas pagas quando Diego ligar as mensagens.

## Taxa, liberação e recebimento (M4.10 e M4.12)

- **Valor** = o que enviamos (`total_amount`), igual ao total da cotação. **Líquido** = o que o
  provedor informa. **Taxa** = valor − líquido, em centavos inteiros a partir dos textos decimais,
  numa leitura só (nunca soma de itens). Taxa negativa ou líquido maior que o valor viram aviso. Se
  o provedor informar outro líquido **antes** de qualquer recebimento lançado, a taxa é atualizada
  (reserva e motor) antes de lançar; com recebimento já lançado, outro líquido vira aviso, sem mexer.
- Gravar a taxa: `reservas.taxaCanal` (e `valorLiquido`), aplicar o motor, nessa ordem, numa
  transação. A taxa de referência de 4% do M12.1 continua só para o desconto do site.
- A data de liberação informada é a **prevista**: aparece no painel e no extrato ("o Mercado Pago
  libera em dd/mm"), não libera nada.
- Só o pagamento com desfecho `reserva`, com a reserva confirmada (desde o M8.2c, também a cancelada com
  valor retido; a cancelada com devolução integral só marca a liberação, sem recebimento) e a situação ainda
  `aprovado`, lança o `recebimento`, e só quando o provedor disser **explicitamente** que liberou (campo e valor
  exatos a conferir no sandbox; data passada sozinha nunca basta; liberação em parcelas não lança
  sozinha: desde o M8.2b, `financeiroDoPagamento` lê o `money_release_schema` e, não vazio, deixa
  `liberado` vazio e liga o aviso `liberacao_em_parcelas` — seção "Cartão", "Taxa e liberação").
  Recebimento: montante = o líquido **informado pelo provedor nessa leitura** (nunca o
  guardado antes), data de caixa = o dia (em São Paulo) da leitura que viu o sinal — a data informada
  é a prevista e, com retenção ou contestação, o dinheiro sai depois dela; nunca se lança o caixa antes
  de o dinheiro estar liberado —, `conciliado`, origem
  `sincronizacao`, chave `mercadopago:<tentativa>:recebimento`. Liberado sem o líquido: aviso, nada
  lançado.
- Sem o sinal, a equipe registra a liberação à mão (com confirmação): informa a data (entre o dia
  da criação do Pix, em São Paulo, e hoje — não a hora da aprovação gravada, que é a da primeira
  leitura e pode vir dias depois do pagamento) e o líquido; o sistema deriva a taxa, grava
  `taxaCanal` e lança o recebimento `realizado` com a mesma chave. Se o provedor confirmar depois
  com o mesmo líquido, passa a `conciliado` (a data fica a que a equipe viu no Mercado Pago); outro
  líquido, aviso, sem mexer (o aviso não é apagado pela mesma leitura que o
  ligou; sai com uma leitura cujo líquido bate com o registrado, ou com o estorno). No estorno da
  manual, a taxa e o líquido voltam ao que o provedor tinha informado antes (ou a desconhecidos), o
  aviso de liberação divergente sai, a reserva recebe essa taxa com o motor e a próxima conferência
  relê a Payments API: o sinal seguinte lança o líquido certo.
- O recebimento do pagamento não aparece como estornável na lista genérica; estorno (só do manual)
  pelo quadro do pagamento, e o registro seguinte usa chave versionada (`#N`), como o motor.
- "Registrar recebimento" manual fica recusado em reserva com tentativa pendente ou aprovada (aponta
  para o pagamento). Textos do fechamento e do extrato dizem "o Mercado Pago libera em dd/mm" para
  essas reservas.
- Reserva paga que um recálculo deixe sem lançamento do motor (contrato encerrado, troca para
  marketplace): aviso "dinheiro recebido sem cálculo".
- **Desde o M8.2d:** a taxa da reserva é a de `taxaDaReserva` (as taxas conhecidas dos pagamentos da reserva menos a
  atribuída às devoluções de alteração); a liberação lança o recebimento de qualquer pagamento da reserva (desfecho
  `reserva` ou `alteracao`), também devolvido em parte sem devolução inexplicada; a liberação à mão também lança, na
  mesma transação, as saídas de devolução que esperavam o recebimento (`acertarCaixasPendentes`) e acorda as
  devoluções de parte que esperavam a liberação; o `valor_pago` fica congelado na aprovação. Seção "Alteração de
  reserva paga (M8.2d)", "Lançamentos".
- **Desde o M8.2e:** com uma disputa não final ou perdida no pagamento, a liberação lida não lança (aviso
  `contestacao_liberacao_lida`) e a liberação à mão é aceita sob disputa; `precisaFinanceiro` usa a situação explicada
  pela disputa; na ganha sem recebimento e sem sinal, o aviso `contestacao_ganha_sem_recebimento` e a liberação no próprio
  formulário de "Ganhou"; `estornarLiberacaoManual` recusa com o retido da disputa realizado. As chaves da disputa
  (`mercadopago:<pagamento>:contestacao:<id>:…`) nunca contêm `recebimento`: ficam fora das somas dos recebimentos do
  pagamento. Seção "Contestação (M8.2e)", "Liberação" e "Dinheiro e livro".

## Devolução na parte (a): só do pagamento sem reserva

- A equipe escolhe (com confirmação), na ficha: **Devolver pelo Mercado Pago** (integral) ou
  **Registrar devolução feita por fora** (data, valor, nota; a data entre o dia em que o pagamento foi
  criado e hoje). Exigem desfecho vazio e nenhuma devolução pedida, sob a trava da tentativa. No
  cartão, a devolução por fora só quando o Mercado Pago não pode devolver (seção "Cartão",
  "Devolução").
- Devolução pelo provedor: `pedida` até confirmar. A chave de cada pedido é gravada antes de chamar, junto
  com o valor que a order relida mostra como pago (é o que a devolução integral devolve; no valor divergente,
  não o total da cotação).
  A chave já é gravada **em dúvida** antes do envio (se o processo cair depois de o provedor aceitar e
  antes de gravar a resposta, o envio seguinte repete a mesma chave); só uma recusa clara tira a dúvida.
  Depois de uma resposta **incerta** (o pedido pode ter sido aceito), o pedido seguinte repete a
  **mesma** chave: o provedor nunca devolve duas vezes pela mesma chave (no pior caso responde
  "chave já usada", que conta como incerta). Chave nova só depois de uma recusa clara **de uma chave
  nova** ou de um pedido novo da equipe (depois de recusada): uma chave que já estava em dúvida continua em
  dúvida mesmo recusada depois (a recusa pode vir antes de o provedor conferir a chave), até a desistência
  com a order relida sem sinal de devolução. Pedido **aceito** pelo provedor (`chave_aceita`): daí em diante
  nada se envia de novo (nem com outra chave, nem num pedido novo da equipe); só a leitura da order
  confirma, e três leituras sem a devolução viram o aviso "o Mercado Pago aceitou a devolução, mas o
  pagamento ainda não aparece como devolvido" (continua pedida). O pedido aceito **nunca para**, qualquer que
  seja a leitura (devolvida em parte, contestada, outra situação): a devolução aceita ainda pode sair, e parar
  abriria o registro por fora (em dobro); o registro por fora é recusado enquanto houver um pedido aceito. Com um
  pedido aceito à espera, a leitura pode levar o pagamento de contestado a devolvido (é o que o confirma). Antes
  de tentar de novo um pedido ainda não aceito, relê a order
  (já devolvida = confirmada; devolução em andamento lá = não pede de novo; **devolvida em parte ou
  contestada** = a leitura é aplicada e a devolução para, recusada, com o aviso de que parou: devolver
  o valor inteiro por cima devolveria a mais ou correria com a contestação; **qualquer outra leitura que
  não seja a mesma order aprovada** (situação desconhecida, recusada, cancelada, vencida, pendente, ou
  outra referência) também é aplicada e para a devolução, com o mesmo aviso: o pedido só sai com a
  releitura aprovada, nunca pela situação local, que pode estar velha). Sob a trava, antes de
  gravar a chave, o pagamento ainda precisa estar aprovado e sem desfecho: uma leitura que cruzou e o
  deixou devolvido em parte ou contestado também para a devolução, com o mesmo aviso. `already_refunded` =
  confirmada. **Desde o M8.2c**, `order_refund_already_in_process`/`refund_in_progress` (qualquer código
  HTTP), `movement_operations_pending`, 423 e 425 são **"aguarde"**: a devolução continua pedida, a chave
  fica em dúvida (a próxima vez repete a mesma), nunca vira aceita e **não conta falha**; a próxima vez relê
  a order antes (antes do M8.2c, o 409 marcava a chave como aceita sem id e o 425 contava falha). Cada
  resposta deixa o seu código de lista fechada em `ultimo_codigo` (o quadro explica: "o Mercado Pago pediu
  saldo disponível na conta", "pediu para esperar"). Recusa e resposta **incerta** (tempo esgotado, 5xx, resposta que o sistema não sabe
  ler) contam do mesmo jeito; na terceira, a order é relida antes e só sem nenhum sinal de devolução
  (feita, em parte ou em andamento) a devolução fica recusada, com o aviso "o Mercado Pago recusou ou
  não respondeu três vezes: confira no painel do Mercado Pago antes de tentar de novo ou de
  registrar a devolução feita por fora"; com sinal, continua pedida e a leitura confirma. Assim uma
  devolução que só recebe respostas incertas não fica pedida para sempre. Sob a trava, a
  vez e o número de tentativas são conferidos de novo (painel e rotina juntos não pedem duas vezes).
- **Registrar devolução feita por fora** relê antes a order no Mercado Pago (fora da transação):
  outra order (id ou referência diferentes dos deste pagamento), devolvida (no todo ou em parte), com
  devolução em andamento ou contestada = recusa; sem conseguir ler (ou sem o provedor, como no deploy
  de produção) = recusa também. Nesta parte, só o valor integral **pago**, pela leitura de agora (o
  total pago quando vier, senão o valor da order: no valor divergente, o que o hóspede pagou, não o
  total da cotação; devolução de parte do valor é o M8.2d — desde 10/10, a por fora de parte vale pelo valor que a
  devolução ainda deve, e o restante do pagamento sem reserva já devolvido em parte também). Desde o M8.2c, a nota passa pelo validador de
  dados pessoais e a taxa que não voltou é **calculada** no registro (abaixo). O dinheiro que chegou já **contestado** (situação
  inesperada) continua com essa opção: a situação local nunca volta a "aprovado", e a releitura só
  aceita quando o Mercado Pago mostra o pagamento aprovado de novo (contestação resolvida). *Desde o M8.2e (C1):* a
  contestação se resolve pela disputa, com o resultado confirmado pela equipe, nunca pela leitura; enquanto ela não é
  `ganha`, o por fora é recusado ("o pagamento está em disputa"; perdida, `contestacao_perdida`); na ganha, o pagamento
  volta à situação de antes e os caminhos de sempre valem. Perdida num pagamento sem reserva: desfecho `contestacao`, a
  taxa como despesa da SCL e a devolução substituída confirmada pela disputa (seção "Contestação (M8.2e)", "Casos"). O que
  chegou já **devolvido em parte** não tem essa opção (o Mercado Pago sempre mostra a parte
  devolvida): o quadro explica e oferece só "Conferir agora", e o resto se resolve pelo painel do
  Mercado Pago (a devolução de parte do valor pelo sistema chega no M8.2d; desde 10/10, "Devolver o restante ao
  hóspede", com o valor que o painel do Mercado Pago mostra quando a leitura não diz). Se o Mercado Pago mostrar depois o pagamento devolvido com o desfecho
  "por fora", aviso de **devolução em dobro** (a releitura diária inclui
  esses pagamentos). Os textos do painel nunca afirmam que o Mercado Pago "não fez": mandam conferir
  lá antes de registrar por fora.
- A taxa que não voltar vira despesa da empresa só depois da confirmação, **com o valor informado pela
  equipe** ("Registrar taxa que não voltou", no quadro do pagamento, com confirmação que mostra o
  valor digitado; zero se voltou toda; nunca mais que a taxa cobrada na aprovação — sem ela, que o
  valor pago —, com os dois valores na recusa; uma vez por devolução): o Mercado Pago só informa a tarifa
  da aprovação, não o que voltou na devolução (item 7 de "A conferir no sandbox").
  Até a equipe informar, aviso, nunca palpite. **Desde o M8.2c:**
  - chave **por devolução**, `mercadopago:<tentativa>:devolucao:<devolução>:taxa_perdida` (`#N` a cada
    correção); a despesa antiga do M8.2a fica com a chave antiga e nunca é lançada de novo;
  - teto = taxa da aprovação + juros do parcelamento pagos pelo hóspede (pago − valor); sem a taxa, o valor
    confirmado pela leitura (ou o devolvido); no por fora, o valor devolvido por fora;
  - **por fora, a taxa é calculada:** devolvido − soma dos recebimentos em vigor do pagamento (o líquido que
    entrou); sem recebimento, devolvido − líquido informado pelo Mercado Pago; com o aviso
    `taxa_divergente` ligado, ou sem os dois, nada é calculado e fica o aviso `taxa_perdida_desconhecida`
    (então a equipe informa);
  - **"Corrigir taxa que não voltou"** (quem edita o financeiro): estorna a despesa atual com o motivo e lança
    a nova com a chave `#N+1`, auditado; e a despesa com chave `mercadopago:` não se estorna mais em
    Despesas ("corrija pelo quadro Pagamento no site da reserva");
  - a despesa leva a reserva quando a devolução é de um cancelamento (desde o M8.2d, de qualquer pagamento da reserva:
    cancelamento, alteração e os restantes delas). Categoria escolhida na aba de pagamento (criada no
  primeiro uso, editável). Regra derivada (a decisão de 7/10 fala do reembolso integral da política;
  aqui a falha é do sistema): está no GUIA para Diego confirmar.
- Cancelar à mão (o botão de sempre) uma reserva com tentativa pendente fica recusado, com mensagem.
  Desde o M8.2c, a reserva paga pelo site se cancela pela política, no quadro "Pagamento no site" (seção
  seguinte): o botão de sempre some da ficha e, se chamado, responde "Não cancelada por aqui: esta reserva
  foi paga pelo site. Use "Cancelar a reserva" no quadro Pagamento no site (devolução pela política
  aceita pelo hóspede)." Confirmar à mão um pedido com Pix pendente também fica recusado ("há um Pix em
  andamento até HH:MM").

## Cancelamento pela política (M8.2c)

Pronto em 10/10/2026, só no teste, nas prévias, com as mesmas travas. Cancelar, conferir e devolver usam
`provedorDeConferencia` e nunca dependem da chave da oferta nem das páginas legais. Código:
`app/src/configuracoes/politica-cancelamento.ts` (a regra pura), `app/src/pagamentos/cancelamento.ts` (prévia,
cancelamento, pedido, descarte, OTAs, "hóspede avisado"), `acerto-cancelamento.ts` (o livro por componente),
`devolucao.ts` e `aplicar.ts` (a devolução), `cancelamento-tela.ts` e `acoes-cancelamento.ts` (o painel),
`app/src/hospede/cancelamento.ts` (Minha reserva), `app/src/repasses/descontos.ts` (o desconto do
proprietário), `app/src/site/pagamento-vista.ts` (`textoDoCancelamento`), `app/src/lib/dados-pessoais.ts`;
telas `components/reservas/CancelamentoSite.tsx` e `FormCancelamentoSite.tsx`; migração 0067.

### Quem pode

| Ação | Permissão |
|---|---|
| Calcular a prévia e cancelar a reserva paga pelo site | `reserva:editar` **e** `financeiro:editar` |
| Corrigir o momento de um pedido registrado pela equipe (com motivo) | as duas, dentro do cancelamento |
| Descartar um pedido feito pelo hóspede no site (só como desistência dele) | `reserva:editar` + `financeiro:editar` |
| Registrar um pedido que chegou por outro canal; descartar um pedido registrado pela equipe; "Datas reabertas nas OTAs"; "Mensagem enviada ao hóspede" do pedido recebido | `reserva:editar` |
| "Mensagem enviada ao hóspede" da decisão e da devolução, e copiar essas mensagens (levam o valor) | `reserva:editar` na ação; a ficha só mostra esses botões a quem também tem `financeiro:ler` |
| Ações da devolução (pedir de novo, por fora, confirmar o que se viu no painel do Mercado Pago, registrar a recusa de lá, parar, taxa que não voltou) | `financeiro:editar` |

Hoje só o admin tem o financeiro (`acesso/politica.ts`): só Diego cancela reservas pagas pelo site e mexe
nas devoluções. A operação vê "Esta reserva foi paga pelo site: o cancelamento com devolução é feito por quem
cuida do financeiro." e registra ou descarta pedidos. Decisão pendente (GUIA, seção 7). As ações checam
sessão → permissão → validação → domínio, como no M8.2a; listas fechadas, e `site` nunca vem do formulário.

### O pedido e o momento que conta

Vale o momento em que a SCL **recebeu** o pedido (a política publicada diz isso), em `pedido_recebido_em`.
- **Pelo hóspede em Minha reserva:** o relógio do servidor no clique, **travado** (nem a equipe muda).
- **Registrado pela equipe** ("Registrar pedido de cancelamento": data, hora, como chegou — WhatsApp, E-mail,
  Telefone, Pessoalmente, Outro — e onde está o pedido, opcional): entre a criação do pagamento e agora (mais
  59 s); no máximo um pedido ativo por reserva. No cancelamento, esse momento vem preenchido; mudar exige o
  motivo ("Por que corrigir o horário", sem dados pessoais), guarda o registrado antes e é auditado
  (`recebidoEm: [registrado, usado]`); a prévia mostra os dois.
- **Sem pedido registrado**, o cancelamento a pedido do hóspede exige o momento e o canal (nunca `site`).
- **A SCL cancela ou não comparecimento:** o momento é agora.
- **Descarte** ("Descartar pedido", com motivo): o pedido registrado pela equipe, por quem edita reservas; o
  pedido feito no site, só por quem edita o financeiro, como desistência do hóspede, com o canal e a hora da
  desistência (o motivo começa com "O hóspede desistiu do pedido"). A linha fica (nunca é apagada) e aparece
  na ficha e na prévia; um pedido do site descartado antes de um horário posterior gera aviso na prévia.
- Pedido nunca se perde pela demora da equipe: com um pedido ativo, a reserva pode ser cancelada depois da
  saída (o momento do pedido manda); sem pedido, depois da saída: "A estadia já terminou e não há pedido de
  cancelamento registrado: não se cancela; registre um ajuste se precisar."

### A regra

`decidirPelaPolitica` (pura, testada) com a **versão da Política de cancelamento aceita no pagamento que
confirmou a reserva** (`politicaDoPagamento`), nunca a versão em vigor, e os dias como datas do calendário no
fuso do imóvel (fuso diferente de `America/Sao_Paulo` = aviso na prévia). O instante da entrada =
`imoveis_detalhes.checkin_a_partir_de` no dia da entrada (sem cadastro, 15:00, com aviso). Ordem:
1. **A SCL cancela** (apartamento sem condições, força maior, outro) → integral, em qualquer prazo. Também num
   pagamento sem a política aceita (a SCL nunca fica com o dinheiro de uma reserva que ela cancelou; "não
   devolver" é recusado: "Quando a SCL cancela, o hóspede recebe o valor integral pago…").
2. **Não comparecimento** → nada. Só sem pedido ativo ("Há um pedido de cancelamento do hóspede recebido em
   dd/mm às HH:MM: não é não comparecimento…") e só depois de `naoComparecimentoHoras` depois do instante da
   entrada (padrão 21, de 0 a 72, em Configurações → Pagamento no site: entrada às 15:00 = 12:00 do dia
   seguinte; antes: "Não comparecimento só depois de dd/mm às HH:MM (o hóspede pode chegar atrasado e
   avisar)."). A pergunta começa por "Confirme que o hóspede não chegou e não avisou de atraso."
3. **No prazo** (pedido até 23h59 do dia que fica N dias antes da entrada, `prazoDoReembolso`) → integral.
4. **Arrependimento** (dia da aprovação + 7 dias, até 23h59; `DIAS_ARREPENDIMENTO`, da lei, não editável) →
   integral, mesmo dentro dos N dias. Com `regras.arrependimentoAteEntrada` (padrão: sim), só antes do instante
   da entrada. `aprovadoEm` é a primeira leitura que viu a aprovação: a janela só pode ficar maior que a real.
5. **Depois do início da estadia** → nada (`estadia_iniciada`). No pedido do hóspede, o cancelamento é
   **recusado**: "saída antecipada não é cancelamento"; a reserva continua (descarte o pedido, se for o caso).
6. Fora disso → nada (`fora_do_prazo`).

**Desde o M8.2e:** "Cancelar a reserva contestada" é outra rota, sem a decisão pela política e **sem devolução pelo
sistema** (base e motivo `contestacao`, quem cancela a SCL, direito `nenhum`, `valor_retido` = o principal pago menos
o devolvido realizado e o reconhecido devolvido fora, dividido como em "Dinheiro retido (sem devolução)"): só antes do horário de entrada, com uma disputa não final
e valor em risco maior que zero, `reserva:editar` e `financeiro:editar`. O dinheiro volta ao titular pela disputa, se ele
ganhar. Registro de decisão (antes: item 1, "a SCL nunca fica com o dinheiro de uma reserva que ela cancelou"; agora; o
motivo; a alternativa, decisão 6 ★) na seção "Contestação (M8.2e)", "A reserva enquanto a disputa está aberta". Essa rota
não tem a mensagem da decisão ao hóspede: numa disputa, a equipe fala com ele caso a caso.

**A equipe só decide onde a política não decide:**
- **Exceção:** a política dá nada → "Devolver tudo por exceção", com motivo da lista (Erro da SCL, Força maior,
  Cortesia comercial, Saúde ou família, Outro) e nota obrigatória (nunca mostrada ao hóspede nem ao
  proprietário). Vale também para a saída antecipada.
- **Sem política** (pagamento sem o aceite das páginas legais, de antes de 9/10): "Devolver tudo" ou "Não
  devolver", com motivo obrigatório.
- **Um direito integral nunca vira nada:** "Pela política aceita, o hóspede tem direito ao valor integral: a
  equipe não decide outra coisa." O pagamento que o Mercado Pago já mostra devolvido por inteiro só aceita
  decisão integral.
- Na exceção e na SCL que cancela, o proprietário perde a parte que teria pela política: a prévia e a pergunta
  mostram "O proprietário deixa de receber R$ X…" (na SCL que cancela, só quando o pedido do hóspede, no
  horário dele, não teria devolução). Quem arca é decisão pendente de Diego (GUIA, seção 7).

O resultado é sempre **integral ou nada**: devolução de parte do valor é o M8.2d. **Desde o M8.2d**, o integral
de um pagamento já devolvido em parte (por uma redução ou no painel do Mercado Pago, reconhecido) devolve o restante,
e o prazo conta de `entradaQueConta` (seção "Alteração de reserva paga (M8.2d)", "Cancelar depois de alterar").

**Recusas antes de decidir:** reserva não confirmada ou já cancelada; sem pagamento com desfecho `reserva`
(vale o cancelamento de sempre); outra tentativa sem resposta criada dentro do prazo de leitura (`em_andamento`;
fora dele, só aviso); pagamento que a última leitura mostra devolvido em parte, com devolução em andamento,
`devolvido_lido > 0` sem estar devolvido, ou em situação que o sistema não reconhece ("…o cancelamento pela
política espera isso se resolver… a devolução de parte do valor chega com o M8.2d."; desde o M8.2d, o devolvido em
parte e o `devolvido_lido > 0` não recusam mais por si: só a devolução em andamento, a situação desconhecida e o
devolvido fora sem o valor informado); contestado ("…espera a
contestação (M8.2e)"; desde o M8.2e, qualquer disputa em curso do pagamento, pela regra `contestacaoEmCurso`, com o texto
"Disputa do pagamento em curso: o cancelamento pela política espera o resultado…", e, depois de perdida, a recusa
`contestacao_perdida`); a parte do proprietário num repasse **ainda não pago** ("estorne esse repasse (o
proprietário recebe o resto no próximo) e então cancele. Se ele já foi pago de fato, marque-o como pago
antes…"); notas com dado pessoal.

### Três fases e travas

- **Fase 0** (sem trava): releitura forçada do pagamento no Mercado Pago (`conferirTentativa`), quando há
  provedor e o pagamento está no prazo de leitura. **Decisão integral de um pagamento no prazo de leitura só com
  essa leitura aplicada**; senão `sem_leitura` ("Não deu para conferir o pagamento no Mercado Pago agora: tente
  de novo em instantes."; com pedido registrado, "o horário do pedido já está registrado e não muda"; sem ele,
  pede para registrar o pedido antes). A prévia faz a mesma releitura.
- **Fase 1** (uma transação): `travarCotacao` (… → devoluções → cancelamento ativo), **depois**
  `travarMotorDaReserva` e **só então** a decisão (`montarDecisao`, a mesma da prévia) e a conferência da
  **assinatura** da prévia (obrigatória; hash da decisão, base, rota, valores, versão, momento, componentes, parte
  já repassada, leitura, pedido ativo e descartados): mudou → `previa_mudou` ("O cálculo mudou desde a prévia…
  calcule de novo antes de cancelar."). Grava o cancelamento (retrato da política e da decisão), a reserva
  `cancelada` (com `valor_retido` quando não há devolução), a cotação `cancelada`, a auditoria (sem notas nem
  nomes), o resultado no livro e a devolução. Trava não obtida (55P03) ou impasse (40P01) → "ocupado" ("Muitas
  mudanças nesta reserva agora…"): nada foi pedido ao Mercado Pago. Índice único violado → "já cancelada".
- **Fase 2** (fora da transação): o pedido da devolução ao Mercado Pago (`tentarDevolucao`); se falhar aqui, o
  "Conferir agora" (e a rotina, em produção) retoma.
- Segundo clique: "Esta reserva já foi cancelada em dd/mm." Tudo no livro tem chave; a chave da devolução é
  gravada antes de chamar (`devolucao:<id>:<n>`).
- Uma aprovação tardia de outra tentativa da cotação depois do cancelamento vira "aprovado sem reserva"
  (`outra_tentativa`) e segue a devolução do M8.2a.
- A prévia mostra os avisos (avisar em vez de supor): fuso, horário de entrada sem cadastro, taxa ainda não
  informada (sem devolução), valor retido diferente do valor da reserva, o que o proprietário deixa de receber,
  ajustes manuais da reserva (não mexidos), pagamento com mais de 78 dias, Pix com mais de 90, cartão com mais
  de 180, cartão não liberado (pode pedir saldo), parte já repassada, pedido registrado mais de dois dias depois
  de chegar, momento corrigido, pedidos descartados, tentativa sem resposta há mais de 85 dias e a linha da
  leitura do Mercado Pago.

### Devolução

Rota: nada a devolver (`nenhuma`); o Mercado Pago já mostra devolvido (`ja_devolvida`, abaixo); pagamento com
mais de **78 dias** (`fora_do_prazo`: o sistema não pede, a devolução nasce `recusada` com o aviso
`devolucao_fora_do_prazo`); senão `pedida`, com o motivo "Cancelamento da reserva SCL-… pela política". A
devolução do cancelamento tem `origem = 'cancelamento'`; código, rotina e leitura ignoram origem desconhecida
(o banco das prévias é compartilhado com versões mais novas).

- **Pedida até o Mercado Pago confirmar**, com as regras do M8.2a (chave em dúvida, mesma chave depois de
  resposta incerta, nada se envia depois de aceita, três falhas sem sinal = `recusada`) e as mudanças do
  M8.2c: "aguarde" não conta falha (seção "Devolução na parte (a)"); o id da devolução é o que **não** estava na
  leitura de antes do envio (num reenvio com a mesma chave sem id novo, o único que a resposta lista);
  `ultimo_codigo` guardado a cada resposta; a margem de 78 dias vale também nas novas tentativas (com a chave em
  dúvida, nada se envia e só a leitura continua; sem dúvida, `recusada` com o aviso).
- **Pedido aceito que falhou:** solto sozinho (recusada, falhas no máximo, aviso `devolucao_falhou`, auditoria)
  **só** quando a leitura mostra a devolução com o **nosso** id falhada, nada confirmado nem em andamento, nada
  devolvido e o pagamento aprovado. Sem o id, nunca sozinho: fica o aviso `devolucao_sem_confirmacao` e os
  caminhos da equipe.
- **Confirmação pela leitura:** pela situação `devolvido`, ou, com o pedido aceito, **pelo valor** (soma das
  devoluções confirmadas lidas ≥ o devido e nada em andamento: o exemplo da documentação, `processed/refunded`,
  o sistema lê como situação desconhecida de propósito). Guarda `valor_confirmado`.
- **Devolução a menos:** confirmadas < devido, ou `devolvido_parcial`, com o pedido aceito → aviso
  `devolucao_a_menor` com os dois valores, a espera para e nada é acertado (M8.2d, ou o painel do Mercado Pago
  mais a confirmação da equipe). **Desde o M8.2d:** com o id, a devolução é confirmada pelo que voltou e a equipe pede
  o restante ou o registra por fora; sem o id, a equipe confirma o valor que o painel mostra (D15).
- **Pedir de novo** (devolução recusada, pagamento até 78 dias): reaproveita a linha, com chave nova.
- **Substituída pela disputa (desde o M8.2e):** a devolução pedida sem aceite (ou recusada) de um pagamento que entra
  em disputa para e fica substituída por ela (`devolucoes_pagamento.contestacao_id`, evento `substituicao`, auditoria
  `pagamento.devolucao_substituida`): o valor dela sai do valor em risco. Perdida: a devolução é **confirmada pela
  disputa** (`confirmada_por = 'contestacao'`), pelo menor entre o valor dela e o valor perdido, sem saída de caixa
  própria (o caixa é o da disputa); a menos, o aviso `devolucao_a_menor`. Ganha ou sem efeito: volta a ser devida,
  recusada, com o aviso `devolucao_devida_depois_da_disputa` e os caminhos de sempre. A aceita ou com a chave em dúvida
  nunca é substituída. Seção "Contestação (M8.2e)", "A reserva enquanto a disputa está aberta", "Devoluções do mesmo
  pagamento".
- **Por fora** ("Registrar devolução feita por fora"): Pix sempre que a devolução está recusada e sem pedido
  aceito; cartão só pela regra estrita da seção "Cartão (M8.2b)", "Devolução". A reserva continua com o
  desfecho `reserva`; o financeiro do cancelamento é acertado com a data informada.
- **"Confirmar devolução feita no painel do Mercado Pago"** (data e nota obrigatória): só quando a leitura não
  tem como confirmar — pagamento fora do prazo de leitura (85 dias) ou com os avisos `devolucao_sem_confirmacao`,
  `devolucao_a_menor` ou `situacao_desconhecida`; antes disso, "O Mercado Pago ainda deixa conferir este
  pagamento: use Conferir agora". Relê a order antes (confirmou sozinha = "confirmada pela leitura"); sem
  provedor, só com a order certamente apagada (mais de 90 dias). Vale também para a devolução do M8.2a.
- **"Registrar que o Mercado Pago recusou a devolução no painel"** (data e nota): devolução recusada, ou pedida
  sem aceite depois do prazo de leitura, ou aceita que nunca apareceu (com `devolucao_sem_confirmacao` e a última
  leitura sem nada devolvido nem em andamento). Abre a devolução por fora no cartão.
- **"Parar a devolução pedida"** (só depois dos 85 dias): sem pedido aceito nem em dúvida, para direto; com ele,
  só com a order fora da leitura do Mercado Pago e a nota dizendo que o painel não mostra devolução. Vira
  `recusada` e abre o por fora (Pix) e os caminhos do cartão.
- **Prazos:** 78 dias (o sistema não pede mais), 85 (para de ler: `PRAZO_RELEITURA_DIAS`), 90 (o Mercado Pago
  apaga a order; Pix com mais de 90 dias provavelmente não volta pelo Mercado Pago, regra do Banco Central:
  por fora), 180 (o cartão não volta mais pelo Mercado Pago: por fora).
- **Já devolvido no painel do Mercado Pago antes do cancelamento** (só decisão integral): a devolução nasce
  `confirmada` pela leitura e o caixa é acertado na mesma transação, com a data da primeira leitura que viu o
  pagamento devolvido (`devolvido_visto_em`; sem ela, a da auditoria; sem nenhuma, hoje, `realizado`, com o
  aviso `devolucao_data_a_conferir`).
- A liberação do Mercado Pago de um pagamento cancelado com devolução integral só é marcada (o dinheiro volta ao
  hóspede e nunca entra no livro); a liberação à mão é recusada, o estorno de uma liberação à mão também, e a
  taxa que chega depois não entra mais na reserva (só no pagamento). Na cancelada com valor retido, a liberação
  (pelo provedor ou à mão) lança o recebimento como numa confirmada, e a taxa que chega depois recalcula a
  divisão.

### Lançamentos por componente

Dois momentos (`acerto-cancelamento.ts`), idempotentes (`resultado_lancado_em`, `caixa_lancado_em` e as chaves):

- **Resultado (receita, taxa, comissão, parte do proprietário), na hora do cancelamento (fase 1):**
  - sem devolução → o motor divide o valor retido (abaixo);
  - integral e nada movimentado → o motor estorna, no mês de cada lançamento, como em qualquer cancelamento;
  - integral e algum mês já movimentou dinheiro (parte paga num repasse, ou lançamento realizado/conciliado) →
    esse mês ganha **espelhos no mês corrente** (mesmo tipo, valores negados, origem `cancelamento`, chave
    `cancelamento:<cancelamento>:espelho:<lançamento original>`; o da parte do proprietário é o desconto,
    abaixo), os outros meses são estornados no próprio mês, a reserva fica **congelada no motor** (`espelhado`:
    nenhum recálculo a mexe mais) e a conferência é dada por resolvida pelo sistema, com auditoria. O mês já
    fechado e o relatório já enviado não mudam; cada mês continua com bruto − taxa − comissão = parte.
- **Caixa, só quando a devolução se realiza** (leitura = `conciliado`; por fora ou confirmada pela equipe =
  `realizado`): tipo `devolucao` com `montante` = soma dos recebimentos em vigor do pagamento (o líquido que
  entrou; nada entrou = nada lançado), chave `mercadopago:<pagamento>:devolucao:<devolução>:saida`; a taxa que
  não voltou é despesa da empresa (informada, ou calculada no por fora). Assim o caixa fecha em todos os
  caminhos: devolução depois da liberação (+L, −L, −taxa perdida), antes da liberação (só a taxa perdida),
  por fora depois ou antes da liberação.
- `recebidoPorReserva` desconta a devolução realizada; os espelhos não entram no devido e a data em que o
  hóspede pagou continua a do recebimento.
- A comissão sai junto com a reserva no reembolso integral (a SCL perde a comissão); sem devolução, fica.
- Ajustes manuais da reserva não são mexidos (a prévia lista).

### Dinheiro retido (sem devolução)

`reservas.valor_retido` = o valor do pagamento. O motor divide a reserva cancelada com valor retido **como uma
confirmada**, com o valor retido como base (`reservaCalculadaPeloMotor` em TS e `reservaCalculadaSql` em SQL,
usados em todo lugar que testava "confirmada" por causa do dinheiro: conferência, Início, portal, ficha,
"dar por resolvida", conferência do deploy). A parte do proprietário fica disponível depois da **data de
entrada original** e da liberação do Mercado Pago (pelo provedor ou à mão), com o motivo "Reserva cancelada sem
devolução ao hóspede (política de cancelamento)…". No resumo do portal e no PDF, "inclui R$ retido de N
reserva(s) cancelada(s) sem devolução". Valor retido diferente do valor da reserva: aviso na prévia.

### Parte já repassada

Uma **parte negativa** (`direito_proprietario` com valor e efeito negativos, origem `cancelamento`, no mês
corrente em São Paulo, nunca no passado: `lancarDescontoDoProprietario`), disponível na hora, que o **próximo
repasse de qualquer tipo** vincula como item negativo e desconta ("desconto no repasse seguinte" ao pé da
letra):
- **antecipado:** as partes menos o desconto; se não cobrem, recusa ("As partes disponíveis (R$ P) não cobrem
  o desconto de R$ D (reserva X cancelada com devolução): ficam para o próximo repasse.") e a rotina segue em
  silêncio;
- **fechamento:** o desconto entra como parte disponível (da competência, ou adiantada quando é de mês
  seguinte); sem partes que cubram, nada a repassar e o proprietário fica devendo (o portal, o PDF e "como
  chega até você" dizem que o desconto sai do próximo repasse, sem pedir Pix); o e-mail e o painel mostram
  cada parte na sua linha (`separarAntecipado`);
- a parte de um mês que movimentou dinheiro **sem** ter sido paga ao proprietário não é desconto: o espelho a
  **anula** (as duas entram juntas no próximo repasse e somam zero);
- **estornar** um repasse cuja parte já foi descontada por um cancelamento é recusado ("…estornar o repasse
  deixaria o desconto sem o pagamento. Corrija com um ajuste."); o repasse que só leva o desconto pode ser
  estornado (o desconto volta a esperar);
- Início (financeiro): "Proprietário X tem R$ D de desconto de cancelamento a descontar desde dd/mm…" depois
  de 7 dias; extrato do portal com o rótulo "Desconto" ("descontada no repasse de dd/mm"); relatório do mês do
  cancelamento com a linha "Reserva SCL-… cancelada com devolução ao hóspede".

Decisão de Diego pendente: o antecipado desconta (o M4.10 diz que ele não desconta adiantamentos nem
despesas). Parte num repasse **ainda não pago** recusa o cancelamento (acima).

### Devolvido no painel do Mercado Pago (fora da política)

O pagamento que confirmou a reserva aparece devolvido (no todo ou em parte), com devolução lida ou com o aviso
`devolvido_por_fora`, e a reserva não tem cancelamento integral → os lançamentos dela ficam **em conferência**
(`devolvidaNoProvedorSql` na regra da conferência; o gêmeo TS `devolvidaNoProvedor`): a parte não é repassada
(fora dos antecipados) e o fechamento do proprietário espera. A ficha mostra "O Mercado Pago mostra o pagamento
desta reserva devolvido fora do sistema: a parte do proprietário não é repassada. Cancele pela política
(devolução integral) ou registre um ajuste e dê a conferência por resolvida." e o Início avisa. A nossa própria
devolução de cancelamento nunca liga `devolvido_por_fora`; uma devolução por fora registrada mais a devolução no
Mercado Pago liga `devolucao_em_dobro`. **Desde o M8.2e**, o MED do Pix e a reclamação no Mercado Pago registrados pela
equipe explicam a devolução lida, até o valor deles (`devolvidoPelaDisputa` em `devolucaoInexplicada` e o gêmeo
`devolvidoPelaDisputaSql` em `devolvidaNoProvedorSql`): o registro não grava `devolvido_fora_reconhecido`, o valor vira
o retido realizado da disputa (no dia em que a leitura viu a devolução) e, daí em diante, quem segura a reserva é a
disputa.

### O que o hóspede vê

Na página da reserva (`/reservar/<código>`), com o título "Reserva cancelada" (lista em "O que o hóspede vê"),
o texto de `textoDoCancelamento` (o mesmo das mensagens): os fatos (código, datas e horas, versão da política,
valores) escritos pelo sistema e as frases editáveis em Textos do site (14 chaves `cancelamento…`; só a frase
final e a abertura de Minha reserva podem ficar vazias), nunca "Beds24", nunca dado pessoal. A frase do prazo só aparece quando ele valeu (reserva paga já
depois do prazo do integral: só o arrependimento); a do arrependimento, só quando ele vai além do prazo.

### Minha reserva

Para a reserva paga pelo site daquele e-mail (os mesmos filtros de Minha reserva, no domínio), antes do
instante da entrada e com "Hóspede pode pedir o cancelamento em Minha reserva" ligado (Configurações →
Pagamento no site, ligado por padrão): o quadro "Cancelar a reserva" com a abertura editável, os prazos da
política aceita ("pedidos até dd/mm (23h59) têm devolução integral; depois disso, não há devolução, salvo o
arrependimento até dd/mm ou até a entrada, o que vier antes. Pedido feito agora: devolução integral | sem
devolução pela política"; sem política aceita, "A equipe confirma com você, por escrito, o valor da
devolução.") e o botão **"Pedir o cancelamento"** (com confirmação). Nunca valores. O hóspede **só pede**: o
horário do servidor fica gravado (repetir devolve o mesmo; trava ocupada = uma nova tentativa com o mesmo
horário), a página confirma na hora ("Pedido de cancelamento recebido em dd/mm às HH:MM (horário de
Brasília)…", com o link da página da reserva) e a equipe recebe um e-mail no endereço da empresa, depois da
resposta, só com o código, o apartamento e a hora (`email/aviso-equipe.ts`, conteúdo restrito). Depois da
entrada: "A estadia já começou: para cancelar, fale com a equipe." Quando a equipe cancela, o acesso à reserva
some de Minha reserva, como antes; o resultado fica na página da reserva.

### Mensagens

Três mensagens novas em Configurações → Modelos de mensagem (M9.2): "Cancelamento: pedido recebido",
"Cancelamento: decisão" e "Cancelamento: devolução feita". Variáveis novas, sem sublinhado: `{recebido}` (as três),
`{decisao}` (só na decisão), `{valor}`, `{data}` e `{comovolta}` (só na devolução feita) e `{link}` (as três);
`{hospede}` e `{codigo}` continuam. O pedido recebido precisa de `{codigo}` e `{recebido}` e nunca aceita
`{valor}` (a operação o copia); a devolução feita precisa de `{valor}`; nenhuma aceita `{endereco}`. A regra vale
ao escolher o modelo, ao editar um modelo já escolhido e ao copiar (modelo que não serve cai no texto-base).
- **Agora:** a ficha mostra cada mensagem pronta para copiar (o modelo escolhido ou o texto-base, montada na hora,
  nunca gravada; o nome do hóspede lido da reserva) e o botão "Mensagem enviada ao hóspede" (com confirmação),
  que grava quem e quando. O pedido recebido, para quem edita reservas; a decisão e a devolução feita (com o
  valor), só para quem lê o financeiro.
- **Sozinhas:** só quando Diego ligar as mensagens ao hóspede (M9.2), com um modelo escolhido para a mensagem e a
  origem `site` marcada: pedido recebido até 2 dias depois do pedido, decisão até 7 dias depois do cancelamento,
  devolução feita até 7 dias depois dela; uma vez por cancelamento (ou devolução), marcando "avisado" pelo
  sistema; nunca a que a equipe já marcou como enviada.
- **Início** (para quem edita reservas, sem valores): cada pedido esperando ("Pedido de cancelamento da reserva
  SCL-…: recebido em dd/mm às HH:MM, entrada em dd/mm (há N dia(s))", atenção a partir de 24 horas do pedido ou
  3 dias antes da entrada; leva à lista filtrada "Só com pedido esperando a equipe", de qualquer período). O
  aviso "cancelamento(s) com mensagem ao hóspede pendente" vai só para quem lê o financeiro (atenção depois de
  24 horas).

### OTAs e o gancho do M8.3

Nada é escrito no Beds24. O Início (para quem edita reservas), com ou sem o envio ao Beds24 ligado (ver a decisão
de 10/10 em "OTAs e o gancho do M8.3" do M8.2d), lista as reservas do site canceladas com saída no futuro e sem a marca: "reabra as datas nas OTAs (no Beds24,
apague o bloqueio)", com o botão **"Datas reabertas nas OTAs"** na ficha (com confirmação, auditado). As datas
voltam à venda no site na hora do cancelamento. O M8.3 vai consumir `cancelamentos_reserva` com
`situacao = 'cancelada'` e `ota_liberada_em` vazio, e gravar a marca sozinho.

### Limites do M8.2c

- Só integral ou nada; um cancelamento integral não se desfaz; um retido não vira devolução por exceção depois
  (M8.2d, ou por fora mais um ajuste). O M8.2d não fez essa troca: continua por fora mais um ajuste.
- Pagamento devolvido em parte, contestado, com devolução em andamento ou em situação desconhecida não se
  cancela pela política até isso se resolver. Desde o M8.2d, o devolvido em parte se cancela (o restante).
- Os e-mails ao hóspede (recibo do pedido — o decreto do comércio eletrônico pede a confirmação imediata —,
  decisão e devolução) estão prontos, mas só saem quando Diego ligar as mensagens; até lá, copiar e marcar.
- Se a taxa e os juros do cartão voltam numa devolução integral é desconhecido (itens 7, 18, 35 e 36 de "A
  conferir no sandbox"): a equipe informa a taxa que não voltou, e o aviso fica até lá.
- Testar só na prévia mais nova: as prévias antigas usam o mesmo banco e não conhecem `origem = 'cancelamento'`.

## Alteração de reserva paga (M8.2d)

Pronta em 10/10/2026, só no teste, nas prévias, com as mesmas travas. Calcular, segurar, aplicar, desistir e
devolver usam `provedorDeConferencia`; o pagamento da diferença passa por `podeCobrar`, como qualquer cobrança.
Código: `app/src/pagamentos/alteracao.ts` (prévia, segurar, aplicar, desistir, aprovação da diferença),
`alteracao-regras.ts` (regras puras), `alteracao-prazo.ts` (vencimento), `alvo.ts` (o alvo da cobrança),
`alteracao-tela.ts`, `alteracao-painel.ts` e `acoes-alteracao.ts` (o painel), `devolucao.ts`, `aplicar.ts`,
`liberacao.ts`, `acerto-cancelamento.ts` e `travas.ts` (várias devoluções por pagamento),
`app/src/site/disponibilidade.ts` e `app/src/calendario/envio.ts` (a cotação que não conta a própria reserva),
`app/src/site/pagamento-vista.ts` (`textoDaAlteracao`); telas `components/reservas/AlteracaoSite.tsx`,
`FormAlteracaoSite.tsx` e `components/site/AlteracaoNaReserva.tsx`; migração 0068. O desenho passou por quatro
leituras adversariais (dinheiro, concorrência, produto e API/segurança) e a documentação de devolução das Orders
foi relida em 10/10/2026: a devolução de parte do valor é documentada (o exemplo da referência responde uma parcial
com `processed/refunded`); várias parciais na mesma order, a taxa que volta e o formato da resposta ficam para os
itens 44 a 58 de "A conferir no sandbox".

### Quem pode

| Ação | Permissão |
|---|---|
| Calcular, segurar, aplicar e desistir de uma alteração | `reserva:editar` **e** `financeiro:editar` |
| "Datas atualizadas nas OTAs"; "Mensagem enviada ao hóspede" | `reserva:editar` (copiar as mensagens, que levam valores, só com `financeiro:ler`) |
| Ações das devoluções (pedir de novo, pedir o restante, restante por fora, por fora, confirmar o que se viu no painel do Mercado Pago com o valor, registrar a recusa de lá, parar, taxa que não voltou) | `financeiro:editar` |

Hoje só o admin tem o financeiro: só Diego altera reservas pagas pelo site. Sem `financeiro:editar`, a ficha diz
"Esta reserva foi paga pelo site: a alteração é feita por quem cuida do financeiro." e mostra a alteração segurada
sem valores. As ações seguem sessão → permissão → validação → domínio; os ids (`alteracaoId`, `devolucaoId`) são
resolvidos com o filtro da organização antes de qualquer trava (`cotacaoDaAlteracao`, `cotacaoDaDevolucao`): id de
outra empresa = "não encontrada", sem chamada ao provedor nem gravação. Só a equipe prepara uma alteração; o
hóspede não tem botão de pedir alteração (ele pede pelos canais de sempre).

### Só antes da entrada

A alteração vale enquanto agora é antes do instante da entrada atual (`checkin_a_partir_de` no dia da entrada, no
fuso do imóvel) e com a nova entrada a partir de hoje; nova entrada hoje só antes do horário de entrada ("A nova
entrada (hoje) já passou do horário de entrada (HH:MM): escolha uma data a partir de amanhã."). Todo caminho que
aplica confere de novo: agora antes da entrada **mais cedo** das duas (a de antes e a nova), a nova entrada a partir
de hoje e nenhum mês da estadia nova antes do mês corrente. Assim nenhuma linha do motor da reserva movimentou
dinheiro (antes da entrada nada é repassado e as linhas do motor de uma reserva do site nunca são realizadas) e
todos os meses envolvidos são o corrente ou depois. Depois da entrada: "A estadia já começou: a alteração pelo
sistema vale só antes da entrada…": mais noites são uma reserva nova (no painel, com o pagamento registrado, ou
pelo site quando a estadia mínima permitir); a saída antecipada não tem devolução pela política e a reserva fica
como está (as noites seguem ocupadas e a limpeza de saída fica na data original).

Fora do escopo: acrescentar noites antes **e** depois ao mesmo tempo (`duas_pontas`: "faça em duas alterações");
trocar de apartamento (cancelar e reservar de novo); mudar o número de pessoas num apartamento sem a capacidade
cadastrada.

### O pedido, a prévia e a assinatura

Formulário em dois passos, no quadro "Pagamento no site" da ficha, bloco **Alteração da reserva**:
- **"Calcular a alteração"**: nova entrada, nova saída, pessoas (de 1 à capacidade); quem pede ("O hóspede pediu" ou
  "A SCL propõe (apartamento sem condições, força maior ou outro)", com o motivo da SCL); o valor ("Pela cotação do
  site (preços de hoje)", "Manter o valor atual (R$ Y)" ou "Outro valor", os dois últimos com motivo de uma lista —
  A SCL propôs a alteração, Cortesia comercial, Erro da SCL, Acordo com o hóspede, Preço a confirmar, Outro — e nota
  obrigatória); quando o pedido chegou e por onde (pedido do hóspede); onde está o pedido (opcional).
- A **prévia** mostra antes e depois (datas, noites, pessoas, valor e de onde veio o valor), a diferença, a política
  aceita (versão, último dia do integral, contando da entrada que conta, arrependimento), a decisão e a base, como a
  devolução sai por pagamento, o financeiro antes, depois e a diferença por componente (valor bruto, taxa do Mercado
  Pago, comissão da SCL, parte do proprietário) e por mês, as noites novas seguradas e por quanto tempo, os avisos e
  "Copiar a proposta para o hóspede" (o modelo `alteracao_proposta` preenchido pela prévia).
- O botão segue o rumo: aumento → **"Segurar as novas datas e liberar o pagamento da diferença"**; redução ou mesmo
  valor → **"Aplicar a alteração"** (segura e aplica numa transação só) e **"Só segurar as datas (o hóspede ainda
  decide)"**. Cada um com `BotaoConfirmar` e a pergunta montada pelo domínio (`pergunta`), que repete as datas, as
  pessoas, os valores e, na redução, a política, como a devolução sai e a taxa sobre a parte devolvida; na redução e
  no mesmo valor, começa por "Confirme que o hóspede aceitou por escrito"; na proposta da SCL com aumento pela
  cotação, "A alteração é proposta pela SCL: confirme que o hóspede paga a diferença".
- A ação exige a **assinatura** da prévia (hash de antes e depois, cotação, origem do valor, diferença, entrada que
  conta, decisão, direito, base, valor a devolver, partes, financeiro, versão da política, momento do pedido, quem
  pede e a leitura de cada pagamento): mudou → `previa_mudou` ("O cálculo mudou desde a prévia (reserva, pagamento,
  leitura do Mercado Pago, preços ou agenda): calcule de novo antes de seguir."). Mudou um campo do formulário →
  "calcule de novo".

**Recusas** (texto fixo de cada uma): reserva não confirmada pelo site; sem pagamento com desfecho `reserva`; outra
tentativa da cotação sem resposta dentro do prazo de leitura (fora dele, só aviso); pagamento contestado (espera o
M8.2e); devolução fora do sistema não reconhecida ou situação desconhecida (`devolvido_fora`); uma devolução com a
chave em voo, ainda pedida ou devolvida a menos sem o restante (`devolucao_em_andamento`), ou esperando a liberação
("A devolução de R$ X espera o Mercado Pago liberar o pagamento (previsto para dd/mm): depois disso a reserva pode
ser alterada de novo."); pedido de cancelamento ativo; outra alteração segurada ("Já há uma alteração com as datas
seguradas até HH:MM…"); estadia iniciada; nova entrada antes de hoje; nada muda (`sem_mudanca`); `duas_pontas`;
novas datas indisponíveis ou noites novas ocupadas (reserva, bloqueio ou agenda do Beds24); leitura do Beds24 velha
nas noites novas (`sem_leitura`); valor "a confirmar" com "pela cotação" (`a_confirmar`: mantenha ou digite); o
financeiro não calcula nas novas datas (`sem_calculo`, com a pendência); dinheiro já movimentado ou reserva em
conferência (guardas: antes da entrada não acontecem); aumento com a cobrança pelo site fechada (`sem_cobranca`, com
o motivo do portão); redução só de valor com a política retendo (`sem_efeito`: "Pela política, a diferença não é
devolvida e nada muda; para dar o desconto, use a exceção."); saldo dos pagamentos que não cobre a devolução
(`sem_saldo`); momento do pedido no futuro ou antes do pagamento; nota com dado pessoal; trava ocupada (`ocupado`).

### O novo valor

- **Pela cotação** (padrão quando o hóspede pede): `consultarDisponibilidade(…, { propria })` cota a **estadia
  inteira nova** com a regra de hoje, sem contar a própria reserva: `planejarImovel` ignora a reserva (e recorta das
  noites dela o bloqueio de fonte Beds24 que a equipe fechou até o M8.3); nas noites que já eram dela, nem a
  ocupação nem o fechamento da leitura contam, mas o preço segue a regra (fonte Beds24 sem leitura atual = a
  confirmar). A entrada ou a saída que não muda já foi vendida: nela não valem antecedência, horizonte, dias de
  entrada e de saída nem as restrições de entrada e saída do Beds24; sem mudar as datas (só pessoas ou valor), o
  mínimo e o máximo de noites também não. As noites novas passam pela conferência de sempre e, de novo, por
  `noitesLivres` com leitura atual.
- **Manter o valor atual** ou **Outro valor** (de R$ 0,01 a R$ 10.000.000,00), sempre com motivo e nota, auditados
  na alteração. A prévia mostra "Cotação do site para as novas datas: R$ C; valor usado: R$ V (motivo)".
- **A SCL propõe:** o formulário começa em "Manter o valor atual" com o motivo "A SCL propôs a alteração" (o
  hóspede não paga pelo problema da SCL); escolher a cotação com aumento mostra o aviso "A alteração é proposta pela
  SCL: cobrar R$ D do hóspede?" e a frase na pergunta. Numa redução proposta pela SCL, a diferença é sempre
  devolvida.
- Aviso quando noites e valor andam em direções opostas ("Menos noites e valor maior pela cotação de hoje…" e o
  contrário).
- O que a reserva guarda (`valorNovo`): aumento = antes + diferença; redução devolvida = o novo; redução retida e
  mesmo valor = o de antes.

### Datas novas seguradas

- As noites acrescentadas (um intervalo só) ficam seguradas por uma **reserva-pedido da alteração**: fonte
  `alteracao`, `idFonte` = id da alteração, estado `pedido`, origem `site`, nome "Alteração SCL-…", sem e-mail nem
  telefone, sem valores, observações sem valores. Ocupa as noites pela regra de sempre; nunca é confirmada, nunca vai
  ao Beds24, nunca tem lançamentos; a importação do Beds24 e da planilha nunca a casam. Confirmar ou cancelar pela
  ficha é recusado ("Estas são as datas seguradas de uma alteração da reserva SCL-……"); a ficha dela mostra "Datas
  seguradas para a alteração da reserva SCL-… até HH:MM", sem e-mail, Confirmar, Cancelar e Horários. Sem noite
  nova, não há reserva-pedido.
- **Prazo próprio:** `regras.site.minutosHoldAlteracao`, em Configurações → Calendário e preços ("Minutos que as
  novas datas de uma alteração de reserva paga pelo site ficam seguradas"; padrão 60, de 5 a 2880), separado do
  prazo do visitante do site (`minutosHold`). O pagamento da diferença estende o prazo com as regras da cotação
  (Pix: a validade dele mais a folga; desafio do banco; cartão em análise uma vez por alteração), e o prazo
  **nunca passa do horário de entrada** (a primeira das duas entradas): na gravação, nas extensões e no alvo da
  cobrança; a prévia avisa quando o prazo fica limitado por isso. Carência de 15 minutos depois do prazo enquanto um
  pagamento da diferença está em andamento (`alteracaoEmCarencia`).
- **Situação que vale agora** (`situacaoEfetiva`): uma segurada com o prazo e a carência vencidos vale como
  `expirada` em toda guarda e tela, antes de alguém gravar. **Vencimento preguiçoso:** toda ação da alteração, o
  cancelamento, a aprovação da diferença e o "Conferir agora" da reserva vencem primeiro (`expirarSeVencida`, sob as
  travas, sem chamar o provedor); `segurarDatas` (M8.1) e `criarBloqueio` vencem as do mesmo imóvel antes de
  conferir as noites, cada uma num savepoint (trava ocupada = pulada); e a rotina (só em produção) vence as
  vencidas. Vencer = `expirada`, a reserva-pedido cancelada (`cancelarPortador`, que trava a linha dela com `FOR NO
  KEY UPDATE`), auditoria.
- **Desistir** ("Desistir da alteração", motivo obrigatório, com confirmação): só a segurada; recusada com um
  pagamento da diferença sendo criado ou um cartão em análise ("Há um pagamento da diferença em andamento: espere ele
  terminar."); a reserva-pedido é cancelada e os Pix da diferença ainda pendentes são cancelados no Mercado Pago
  depois do commit. Um Pix pago nessa corrida vira aprovação tardia e sem reserva (`alteracao_desistida`), para
  devolver.

### Aumento: o pagamento da diferença

- É uma tentativa nova **na cotação original** (`cotacao_id` = a original, `reserva_id` = a reserva, `alteracao_id` =
  a alteração, valor = a diferença); aprovada e aplicada, desfecho `alteracao` (no máximo um por alteração, índice
  único parcial). A trava, o cookie do hóspede e "Continuar o pagamento" ficam os mesmos.
- **Alvo da cobrança** (`alvoDaCobranca`): toda regra que olhava "as tentativas da cotação" olha as do alvo (a
  reserva original ou uma alteração): o limite de 3 Pix e 3 cartões, o "já pago", o cartão em análise, o cancelamento
  do Pix anterior, a extensão do prazo e o cancelamento das irmãs (`aplicar.ts` e `rotina.ts`: só as do mesmo alvo).
  Sem isso, a releitura do pagamento original cancelaria o Pix da diferença. A guarda do `live_mode` continua na
  cotação inteira. A rotina cancela as tentativas pendentes de uma alteração que não está mais segurada.
- **Oferta** (Pix e cartão): alteração segurada com prazo, diferença > 0, reserva confirmada sem cancelamento, cotação
  da alteração disponível (ou valor da equipe, cujas noites já passaram pela leitura atual), imóvel público e ativo, o
  motor calculando nas novas datas, sem recebimento registrado à mão. O formulário leva o id da alteração (campo
  escondido); alteração mudada com a página aberta → `alteracao_mudou` ("A alteração mudou enquanto a página estava
  aberta: atualize a página.").
- **Aceite (D11):** a reserva continua na Política de cancelamento aceita no pagamento que a confirmou. A caixa diz
  "Li e aceito os Termos (versão T) e li a Privacidade (versão P). A sua reserva continua na Política de
  cancelamento versão N, aceita em dd/mm." e só aparece quando as versões em vigor ainda não foram aceitas nesta
  cotação; o aceite grava `{ termos: T, privacidade: P, cancelamento: N }` (`aceiteVigenteTravado` com
  `cancelamentoDaReserva`). O pagamento da diferença não abre outro prazo de arrependimento: toda decisão de política
  da reserva (alteração e cancelamento) usa a versão e a aprovação do primeiro pagamento.
- **Aprovação** (`decidirAprovacaoDaAlteracao`, antes de `valorConfere(total da cotação)` e de `outra_tentativa`,
  num **savepoint**): valor diferente da diferença → `valor_divergente`; outra tentativa da mesma alteração já
  aplicada → `outra_tentativa`; alteração desistida → `alteracao_desistida`; reserva não confirmada ou com pedido de
  cancelamento → `alteracao_reserva_mudou` (`cancelada_pela_equipe` quando cancelada); segurada (com a carência) →
  aplica; vencida com a reserva igual ao retrato, nenhuma alteração da reserva criada depois e as datas ainda no
  futuro → tenta as noites de novo com leitura atual e aplica (`alteracao_tardia`); senão, ou numa recusa da
  aplicação, "aprovado sem reserva" com o motivo: `alteracao_noites_ocupadas`, `alteracao_sem_leitura`,
  `alteracao_desistida`, `alteracao_reserva_mudou` ou `alteracao_nao_aplicada:<código>` (inclusive `estadia_iniciada`
  e `financeiro_movimentado`, que desfaz até o savepoint). Esse pagamento segue a devolução do M8.2a ("Devolver ao
  hóspede", por fora); Início: "N pagamento(s) da diferença de uma alteração aprovado(s) sem a alteração: devolva ao
  hóspede". Nenhuma aprovação fica sem desfecho e a leitura nunca é desfeita pelo erro da aplicação.
- A mensagem de confirmação da reserva (M9.2) não sai de novo por causa da alteração.

### Redução: a política, contando da entrada que conta

- `decidirPelaPolitica` com a versão aceita no pagamento que confirmou (`politicaDoPagamento`), a aprovação dele, o
  momento do pedido e quem pede, com **`checkin: entradaQueConta(entrada da cotação, entrada atual)`** — a mais
  cedo das duas — e `entradaAtual` = a entrada de agora (para "a estadia começou" e o limite do arrependimento; com
  ela, "no prazo" exige também a estadia não iniciada). `entradaQueConta` (`configuracoes/politica-cancelamento.ts`)
  é a única fonte para o painel (alteração e cancelamento), `/reservar` (`site/aceites.ts`) e Minha reserva
  (`hospede/cancelamento.ts`). **Registro de decisão (10/10/2026):** o texto-base publicado da política e a pergunta
  de 9/10 no GUIA diziam "contando os dias a partir da data de entrada original"; o M8.2d conta da original **ou da
  atual, a que vier primeiro**, porque contar só da original deixaria uma estadia adiantada ser cancelada com
  devolução integral no meio da estadia (entrada original 15/01, adiantada para 28/11, pedido em 01/12: pela
  original ainda daria integral). Adiar nunca reabre o prazo e adiantar o fecha. Objetivo: a alteração nunca virar
  um cancelamento sem perda. Padrão em uso, ★ decisão 1 de Diego (GUIA, seção 7); a frase da v2 da política está no
  GUIA (seção 6, item 42). **Ajuste de 11/10/2026 (revisão do M8.2d):** com mais de uma alteração, conta a menor de
  **todas** as entradas que a reserva teve (a da cotação, a atual e as de cada alteração aplicada,
  `entradasDasAlteracoes`/`entradasDaReserva`); antes, só a original e a atual, e uma reserva de 15/01 adiantada para
  28/11 e depois adiada para 01/02 voltava a contar de 15/01, reabrindo o prazo que o adiantamento fechou.
- Integral → a diferença é devolvida **depois** de a alteração ser aplicada; nada → retida: a reserva fica com o
  valor de antes nas datas novas, dividido como uma reserva normal, e as noites liberadas voltam à venda (a prévia
  avisa). Pela mesma regra do M8.2c: a SCL propõe → integral; política `nenhum` + exceção (motivo da lista e nota) →
  integral; sem política aceita → a equipe escolhe "Devolver a diferença" ou "Não devolver", com motivo; um direito
  integral nunca vira nada. Os textos dizem quem decidiu ("Pela política", "Por exceção", "Como a alteração é
  proposta pela SCL", "Por decisão da equipe"); "pela política" só quando a política decidiu.
- **Partes:** a devolução se divide entre os pagamentos que contam (`dividirDevolucao`): primeiro os que podem sair
  agora (no prazo de 78 dias, liberados, com a taxa conhecida), dos mais novos para os mais antigos; cada um até o
  principal que ainda pode devolver. Pagamento com mais de 78 dias → `fora_do_prazo` (painel do Mercado Pago no
  cartão, por fora no Pix). A prévia avisa a parte que espera a liberação, a com mais de 78 dias e o cartão com
  juros ("a devolução é da diferença do valor da reserva; os juros seguem as regras do cartão").

### A ordem: aplica, depois devolve

`aplicarNaTransacao` (segurar e aplicar, aplicar de uma segurada, aprovação da diferença), sob travas → alterações →
motor da reserva → linha da reserva-pedido → motor dela: confere tudo de novo (reserva confirmada, sem
cancelamento, igual ao retrato — senão `reserva_mudou`: "A reserva mudou depois que as datas foram seguradas:
desista desta alteração e prepare outra." —, as datas do "só antes da entrada", o motor sem nada movimentado e, na
redução, os pagamentos); as noites novas de novo (excluindo a própria reserva e a reserva-pedido; leitura atual só
na aprovação tardia); cancela a reserva-pedido; grava a reserva pela porta de sempre (`sincronizarReserva`, com
`dadosDoSite`, o mesmo construtor da reserva do site, e a taxa de `taxaDaReserva`), acrescenta às observações
"Alterada em dd/mm: de dd/mm–dd/mm (N noites, P pessoas) para …" (nunca valores); marca a alteração `aplicada`
com o resultado por mês; **só então** cria as devoluções da diferença (origem `alteracao`, uma por parte, motivo
"Alteração da reserva SCL-…: devolução da diferença pela política" ou quem decidiu, `pedida`, ou `recusada` com
`devolucao_fora_do_prazo`), depois do teto (D12). Auditoria `reserva.alterar` com datas, pessoas e `valorBruto`
(escondido sem `financeiro:ler`); os valores da alteração ficam na auditoria da entidade `alteracao`. O pedido ao
Mercado Pago vem depois do commit (fase 2). Nunca fica pela metade: `financeiroNaoAtualizado` lança
`ErroAlteracaoProtegida` e a transação (ou o savepoint da aprovação) desfaz tudo.

"Aplicar" de uma alteração segurada ("Conferir para aplicar (o hóspede aceitou)" → "Aplicar a alteração") nunca cota
de novo: `montarAplicacao` lê o retrato gravado (datas, pessoas, valor, diferença, cotação, política, momento do
pedido) e refaz só o estado do dinheiro (leituras, devoluções, datas, motor, a decisão com as mesmas entradas, que
precisa dar a mesma, as partes e as noites novas); a assinatura da aplicação cobre o retrato que decide (situação,
prazo, datas, valor, diferença, política) e o dinheiro de agora — marcar o hóspede avisado não a invalida; uma
leitura nova da agenda ou um preço mudado durante o prazo não bloqueiam; uma leitura do pagamento mudada, sim.

### Várias devoluções por pagamento

- O índice único `devolucoes_pagamento_um_por_pagamento` virou cinco índices parciais (migração 0068): uma
  devolução principal `sem_reserva` por pagamento; uma por (cancelamento, pagamento); uma por (alteração,
  pagamento); um restante por devolução de origem; e **uma `pedida` por pagamento**. `devolucaoDoPagamento` saiu;
  as regras de quanto cada devolução compromete moram em `travas.ts`: `comprometido` (confirmada = o valor
  confirmado; por fora = o valor por fora; pedida ou recusada = o valor; substituída = 0; origem desconhecida conta,
  por defesa), `devolvidoProprio`, `saldoDevolvivel`, `saldoPrincipal`, `integralIntocada`, `valorPagoAprovado`.
- **Pago congelado** (D28): `valorPagoAprovado = valor_pago ?? valor`, congelado na aprovação (uma leitura
  depois nunca o muda). **Teto sob a trava** em todo caminho que cria, pede de novo, registra por fora, pede o
  restante ou confirma um valor: comprometido + valor ≤ pago − devolvido fora reconhecido. O adaptador não tem mais
  teto local no valor explícito (o `refund_amount_exceeds` do Mercado Pago é a última defesa).
- **Valor explícito** em toda devolução que não é a integral de um pagamento intocado (corpo `null` só nela, e em
  todo reenvio de uma chave gravada com corpo vazio: `corpo_integral`, D29); o valor nunca muda com a chave em
  dúvida ou aceita.
- **Confirmação por devolução** (D14): pelo id (`refunds[].id` = o da devolução); senão pelo valor que entrou desde
  então (o devolvido lido menos as outras confirmadas e o reconhecido, nada em andamento, com a chave aceita ou em
  dúvida); senão por completar o pagamento (situação `devolvido` e esta devolução fecha o pago). `devolvido_parcial`
  é o esperado depois de uma parcial, nunca aviso por si.
- **"Possivelmente nossa"** (D21): o pedido enviado com a chave em dúvida ou aceita conta em `devolvidoProprio`,
  então a nossa parcial cuja resposta se perdeu nunca parece devolução de fora; com a chave em dúvida e o excesso até
  o valor dela, o sistema reenvia com a mesma chave (`repetida`, mesmo corpo) e o adaptador acha a nossa pelos ids
  conhecidos. `devolucaoInexplicada` (TS) e `devolvidaNoProvedorSql` (SQL, `portal/posse.ts`) são a mesma regra,
  testada numa matriz; `devolvido_por_fora` é recalculado a cada leitura (nunca entrada da regra).
- **Situação `processed/refunded` explicada** (D27): quando as nossas devoluções enviadas e o reconhecido explicam
  o devolvido, a situação vira `devolvido` (chegou ao pago) ou `devolvido_parcial`, sem `situacao_desconhecida`.
- **Avisos por devolução:** `devolucao_falhou`, `devolucao_parada`, `devolucao_sem_confirmacao`,
  `devolucao_fora_do_prazo`, `devolucao_a_menor`, `taxa_perdida_desconhecida`, `devolucao_data_a_conferir` e
  `devolucao_aguardando_liberacao_atrasada` vivem em `devolucoes_pagamento.avisos`; o pagamento leva a união. A regra
  do cartão por fora (`porForaPermitidoNoCartao`) lê os avisos da própria devolução.
- **Respostas novas do Mercado Pago** (adaptador): a nossa devolução é a que nem a leitura de antes nem o banco
  conhecem (`conhecidas`); `confirmada` só com a nossa processada; 409 `order_already_refunded` = confirmada no
  pedido integral, incerta no parcial com a mesma chave, `ja_devolvido` (recusada, a leitura seguinte decide) no
  parcial com chave nova; `unsupported_partially_refunds`, `payment_not_refundable` e `max_refunds_exceeded` =
  `nao_permitido`; `amount_not_refundable` = `valor_excede`. Pedido de parte do valor sem o id da
  transação na leitura: nada se envia e a devolução para (`devolucao_parada`, motivo "o Mercado Pago não informou a
  transação do pagamento"), para a equipe conferir no painel dele. Na terceira falha,
  só desiste sem uma devolução **nova** desde o pedido.

### Devolução de parte do valor só depois da liberação (D13)

Uma devolução de um pagamento da reserva que não é a integral de um pagamento intocado (a da alteração, o restante de
um cancelamento, um restante) só é pedida ao Mercado Pago com o pagamento **liberado** (`liberacaoConfirmadaEm`) e a
**taxa conhecida**, conferido antes de qualquer leitura e de novo sob a trava, quando a chave é gravada. Até lá fica
`pedida`, sem chave, com `ultimo_codigo = 'aguardando_liberacao'` e a próxima volta na data prevista; passada a data
prevista (ou 35 dias da aprovação, sem previsão), aviso `devolucao_aguardando_liberacao_atrasada` ("A liberação deste
pagamento passou da data prevista e a devolução de R$ X continua esperando: confira no painel do Mercado Pago e
registre a liberação à mão quando ela aparecer."). As razões: a devolução de parte de um cartão antes da liberação
redistribui as parcelas a liberar (o líquido liberado deixaria de ser o que o caixa espera) e a identidade do caixa
(abaixo); a falta de saldo continua tratada como hoje (saldo disponível na conta é outra condição). A devolução
integral de um pagamento intocado e a do pagamento sem reserva saem na hora, como antes. Quem espera a liberação
nunca é tratada como pedida ao Mercado Pago: o hóspede vê "será pedida quando o Mercado Pago liberar o pagamento
(previsto para dd/mm)", o quadro mostra "aguardando a liberação do pagamento (prevista para dd/mm)", "Confirmar
devolução vista no painel" não vale para ela, e uma nova alteração espera ("depois disso a reserva pode ser
alterada de novo"). **No teste, o sinal de liberação nunca chega:** a equipe registra a liberação à mão no quadro
do pagamento, e a devolução sai na volta seguinte (GUIA, seção 6, item 44). A liberação à mão é aceita também numa
reserva cancelada com devolução integral quando uma devolução de parte espera por ela (marca só o pagamento, nada
no livro). Estornar uma liberação à mão é recusado com uma devolução de parte já pedida ao Mercado Pago ou realizada
esperando o caixa. Conflito com o texto publicado ("Pedimos a devolução ao Mercado Pago logo depois de confirmar"; no
arrependimento, "imediatamente"): ★ decisão 11 de Diego; a frase da v2 está no GUIA, item 42; o item 55 confere se a
regra pode afrouxar.

### O que o M8.2a e o M8.2c deixaram

- **Restante do pagamento sem reserva** (chegou `devolvido_parcial` — situação inesperada — ou a devolução parou):
  **"Devolver o restante ao hóspede (R$ X)"**, X = pago − comprometido − reconhecido. Na criação, sob a trava, o
  devolvido fora do sistema que a leitura mostra (devolvido lido − devolvido nosso) é gravado em
  `pagamentos.devolvido_fora_reconhecido` (auditado); quando o Mercado Pago mostra devolução sem dizer quanto, a
  ação pede o valor que o painel dele mostra ("O Mercado Pago não informou quanto já foi devolvido: informe o valor
  que aparece no painel dele"). Uma devolução parada é pedida de novo, ou registrada por fora, pelo restante. O
  desfecho do pagamento sem reserva só é gravado quando ele fica completo (`por_fora` se alguma parte foi por fora,
  senão `devolucao`).
- **Reserva confirmada com parte devolvida no painel do Mercado Pago:** o cancelamento pela política passa a ser
  aceito, com o mesmo reconhecimento (da leitura, ou o valor digitado — sem ele, "informe o valor que aparece no
  painel do Mercado Pago antes de cancelar"); o integral devolve só o restante; uma decisão "nada" com dinheiro já
  devolvido fora do sistema é recusada para a equipe decidir (exceção ou ajuste). A alteração recusa enquanto essa
  devolução não é reconhecida.
- **Por fora de parte** (D16): pelo valor exato que a devolução ainda deve ("A devolução por fora registra o valor
  desta devolução: R$ X."), só numa devolução nunca enviada ou recusada sem chave em dúvida nem aceita ("O pedido
  desta devolução já foi enviado ao Mercado Pago e ainda pode sair por lá…"); a releitura antes recusa devolução que
  o sistema não pediu, em andamento, contestação ou outra situação. Taxa que não voltou da parte por fora: a taxa
  atribuída a ela.
- **Devolução que o Mercado Pago fez a menos** (D15): com o id, confirmada pelo que voltou (o caixa pelo que voltou,
  a taxa atribuída recalculada uma vez), aviso `devolucao_a_menor` ("O Mercado Pago devolveu R$ X de R$ Y pedidos
  nesta devolução: o que voltou já está no financeiro. Peça o restante ao Mercado Pago ou registre o restante
  devolvido por fora."), e a espera para; a equipe escolhe **"Pedir o restante ao Mercado Pago"** (devolução nova,
  chave nova, `origem_devolucao_id` = a de origem; confirmação "Confira antes no painel do Mercado Pago que ele não
  saiu") ou **"Registrar o restante devolvido por fora"** (no cartão, só quando a regra do cartão permite: o botão
  só aparece quando funcionaria). Restante recusado com `valor_excede` ou `nao_permitido`: aviso de a menos e
  "confira no painel do Mercado Pago", com a confirmação pelo valor visto, a recusa do painel ou um ajuste. Sem o id,
  só o aviso: nada é acertado e a equipe confirma o valor que o painel mostra ("Confirmar devolução vista no painel
  do Mercado Pago", com o valor, até o devido e sob o teto; menos que o devido = confirmada por esse valor, com o
  aviso). A confirmação da equipe vale também para uma devolução parada.

### Lançamentos

**Registro de decisão (10/10/2026).** Regra anterior (ROADMAP, M8.2, e o desenho de 8/10): ao confirmar a alteração,
"lançamentos de diferença por componente (valor bruto, taxa do pagamento, comissão e parte do proprietário — cada
um só com a diferença entre o novo e o anterior, no tipo certo), idempotentes (uma chave por alteração)". Regra
nova, para a alteração antes da entrada (a única que o sistema faz): **a diferença é o recálculo do motor**. A
alteração grava os fatos novos pela porta de sempre e o motor estorna as linhas antigas no próprio mês (aberto: o
mês corrente ou depois) e lança as novas; o estorno leva o motivo "Alteração <id> da reserva SCL-…: recalculado"
(`aplicarMotor` com `motivoEstorno`), então cada linha se liga à alteração. Por componente e mês, estorno + linha
nova = exatamente novo − anterior; antes e depois por mês ficam em `alteracoes_reserva.resultado` e aparecem na ficha
(tabela "Antes / Depois / Diferença"), e um teste confere Σ novas − Σ estornadas = o guardado. Motivo: antes da
entrada nada movimentou dinheiro, então o líquido é o mesmo, e linhas de diferença explícitas congelariam o motor de
toda reserva alterada (duas versões da mesma regra). Idempotência: a alteração passa de `segurada` a `aplicada` uma
vez, sob a trava, e o motor tem chave e assinatura (rodar de novo não muda nada). O que depende de dinheiro no
provedor continua pendente: o recebimento do pagamento da diferença só na liberação; a saída e a taxa perdida da
devolução só quando ela se realiza; as linhas do motor ficam `previsto`. Objetivo final: linhas de diferença
explícitas no mês corrente (e a parte negativa do proprietário, `lancarDescontoDoProprietario`, com origem
`alteracao`) quando existir uma alteração depois da entrada, item futuro. É a decisão 17 de Diego (GUIA, seção 7)
e está no "Entregue em" do ROADMAP.

- **Taxa da parte devolvida** (D19): `taxaAtribuida(p, v) = arredondamento de p.taxa × v / p.valor` (meio centavo
  para cima), sobre o **principal** acumulado das devoluções do pagamento (nunca mais que `p.taxa`); a taxa de uma
  devolução é a diferença entre o acumulado depois e antes dela (várias parciais nunca derivam um centavo), gravada
  em `devolucoes_pagamento.taxa_atribuida` na primeira vez que dá para calcular. Os juros do cartão ficam só com a
  devolução que cruza o principal.
- **Taxa da reserva** (`taxaDaReserva`, uma regra, um lugar): Σ das taxas **conhecidas** dos pagamentos que contam
  menos a atribuída às devoluções de alteração decididas (uma devolvida a menos conta pelo valor decidido até o
  restante existir). Taxa desconhecida de um pagamento mantém as conhecidas e avisa ("a divisão usa as taxas
  conhecidas até ele informar"); um pagamento só, sem devolução de alteração = a taxa dele (igual ao de antes).
  `gravarTaxaNaReserva` grava `taxaCanal` e `valorLiquido`.
- **Caixa por devolução** (`acertarCaixaDaDevolucao`, idempotente por `devolucoes_pagamento.caixa_lancado_em`):
  sai `devolvido − taxa atribuída` (a que completa o pagamento leva tudo o que ainda está dentro); sem o recebimento
  do pagamento lançado, espera (`acertarCaixasPendentes` lança logo depois do recebimento, na liberação do
  provedor **e** na registrada à mão), ou nada é lançado quando nada vai entrar (pagamento completado pelas
  devoluções, reserva cancelada com devolução integral, ou a integral de corpo vazio que saiu antes da liberação).
  A confirmada pela equipe sem nunca ter sido pedida não conta como integral: a parte espera o recebimento como as
  outras (ajuste de 11/10, revisão do Codex: antes, a que não se sabia parcial era tratada como integral e o caixa
  ficava acertado sem saída, sobrando dinheiro no caixa depois da liberação). A taxa que não voltou é despesa da empresa com a reserva
  (`reservaId`), informada pela equipe ou calculada no por fora; tetos por devolução e por pagamento (a soma das
  taxas perdidas ≤ taxa + juros), com os dois valores na recusa.
- **Liberação:** lança `mercadopago:<pagamento>:recebimento` para qualquer pagamento da reserva (desfecho
  `reserva` ou `alteracao`) aprovado ou devolvido em parte explicado; `liberacoesDoSite` dá a última liberação
  prevista dos pagamentos ainda não liberados; `temRecebimentoManual` ignora as chaves `mercadopago:`.
- **Identidade do caixa** (`recebido = devido` no fim, em todos os caminhos): devolução de parte depois da liberação
  (+L1, −(R − F_r), −taxa perdida); por fora depois ou antes da liberação (a saída adiada até o recebimento);
  devolução integral de um pagamento intocado não liberado (nada entra nem sai do caixa; a taxa perdida informada);
  aumento (+L1 e +L2 nas duas liberações).
- **Exemplos (Pix 0,99%, comissão 15%):**
  - **Aumento:** 10/11–14/11 por R$ 1.500,00 (taxa R$ 14,85) passa a 10/11–15/11 pela cotação de R$ 1.900,00;
    diferença R$ 400,00 (taxa R$ 3,96). Novembro: bruto +R$ 400,00, taxa −R$ 3,96, comissão +R$ 59,41, parte
    +R$ 336,63. A parte espera também a liberação do pagamento da diferença.
  - **Redução devolvida, mudando de mês:** 28/11–03/12 (R$ 1.500,00) passa em 01/11 a 05/12–09/12 pela cotação
    de R$ 1.200,00; prazo contado de 28/11 (integral até 14/11) → devolve R$ 300,00; taxa atribuída R$ 2,97
    (taxa da reserva R$ 11,88). Novembro estornado; dezembro passa a {R$ 1.200,00, −R$ 11,88, R$ 178,22,
    R$ 1.009,90}. Confirmada a devolução, saem do caixa R$ 297,03; a taxa que não voltar (até R$ 2,97) é despesa
    da empresa.
  - **Redução retida:** o mesmo pedido em 20/11 (fora do prazo e sem arrependimento) → nada; o valor continua
    R$ 1.500,00 nas datas de dezembro, dividido como uma reserva normal, e as noites liberadas voltam à venda.
  - **Devolução a menos:** o Mercado Pago devolve R$ 290,00 dos R$ 300,00 → confirmada por R$ 290,00 (taxa
    atribuída R$ 2,87, saída R$ 287,13); "Pedir o restante" cria R$ 10,00 (taxa R$ 0,10, saída R$ 9,90).

### Cancelar depois de alterar

- O prazo conta de `entradaQueConta` (adiantar fecha a janela: entrada original 15/01, adiantada para 28/11 e
  pedido em 01/12 → nada, a estadia começou); "a estadia começou" conta da entrada atual; a política e o
  arrependimento são os do primeiro pagamento.
- Base = Σ (pago − comprometido − reconhecido) dos pagamentos que contam; **uma devolução de cancelamento por
  pagamento** com saldo (depois de um aumento, a do pagamento da reserva e a do pagamento da diferença, cada uma
  integral e com corpo vazio quando intocada; depois de uma redução, o restante com valor explícito, esperando a
  liberação se preciso); `valorRetido` = o que ficou (o valor de cada pagamento menos o principal das devoluções de
  alteração decididas).
- **Absorção** (D23): no cancelamento integral, a devolução de alteração que nunca chegou ao Mercado Pago (pedida
  sem envio, esperando a liberação, ou recusada sem chave em dúvida nem aceita) vira `substituida` (auditada, nunca
  apagada, comprometendo 0) e o valor dela entra na devolução do cancelamento daquele pagamento; se o pagamento
  fica intocado, a devolução é integral e sai na hora (cartão esperando a liberação, depois cancelado no prazo: a
  redução fica substituída e o cancelamento devolve o valor inteiro na hora). Com "nada", a devolução da alteração
  continua (e uma recusada pode ser pedida de novo depois).
- **Recusas novas:** uma devolução da reserva com a chave em voo ("…espere ela ser confirmada (use Conferir agora)
  antes de cancelar."); uma devolvida a menos sem o restante ("…peça o restante ao Mercado Pago ou registre o
  restante por fora antes de cancelar."); devolução fora do sistema sem o valor; alteração segurada com o pagamento da
  diferença em andamento (`ha_alteracao`: "…espere o pagamento terminar ou desista da alteração antes de
  cancelar."). Sem pagamento em andamento, todo cancelamento (também sem devolução) desiste da alteração segurada
  (motivo "cancelamento da reserva"). `devolvido_parcial` e `devolvido_lido > 0` deixam de recusar por si.
- Pedido do hóspede em Minha reserva: o botão continua depois de uma devolução de parte confirmada (todo pagamento
  que conta aprovado, ou devolvido em parte sem devolução inexplicada; o pagamento da diferença devolvido por inteiro
  pelas nossas devoluções também não bloqueia); registrar o pedido deixa a alteração segurada como está (a equipe
  decide; a aprovação da diferença depois recusa a alteração).
- O estado do cancelamento na página e no quadro é o da devolução menos adiantada (esperando a liberação > pedida >
  com a equipe > em conferência > feita), com o valor somado; a mensagem "Devolução feita" sai uma vez, quando todas
  se realizam.
- Parte devolvida pelo painel do Mercado Pago sem a leitura dizer quanto (D17), em mais de um pagamento da reserva: a
  equipe informa o valor de cada pagamento (um campo por pagamento, com a forma, o dia e o valor dele); faltando
  algum, a recusa diz quais. Um valor nunca vale para dois pagamentos.
- Reserva cancelada depois de uma redução aplicada: a devolução da diferença que o cancelamento não absorveu (a já
  feita antes, ou a que continua no cancelamento sem devolução) mantém a mensagem "Devolução feita" dela, ainda não
  avisada, no prazo de sempre (7 dias da devolução), pelo motor e para copiar; a proposta e a confirmação da alteração
  não saem mais.

### O que o hóspede vê (alteração)

`/reservar/<código>`, acima do quadro do pagamento, o bloco de `AlteracaoNaReserva` com o texto de
`textoDaAlteracao` (o mesmo das mensagens e do "Copiar a proposta"): fatos escritos pelo sistema (código, datas,
noites, pessoas, valores, diferença, prazo "até HH:MM", ou "dd/mm às HH:MM" quando é outro dia, horário de Brasília,
versão da política e a data de que os prazos contam) e frases editáveis em Textos do site (`alteracaoEmAndamento`,
`alteracaoAguardaConfirmacao`, `alteracaoPolitica`, `alteracaoConfirmada`, `devolucaoAguardaLiberacao`,
`alteracaoSemDevolucao`, `alteracaoNaoAplicada`, `alteracaoNaoVale`; as cinco primeiras obrigatórias). Nunca
"Beds24", nunca dado pessoal. O fim do arrependimento é escrito com a mesma regra da decisão (`fimDoArrependimento`):
"até dd/mm, 7 dias depois do pagamento" ou, quando a política aceita para o arrependimento na entrada e ela vem antes,
"até a entrada, em dd/mm" (também no texto do cancelamento, desde 11/10). Na alteração, a entrada desse texto é a
da estadia alterada, a que vale dali em diante (ajuste de 11/10, revisão do Codex: antes era a entrada de antes da
alteração, e uma alteração que adiantava a entrada para antes dos 7 dias ainda dizia "7 dias depois do pagamento").
A decisão não muda: ela continua contando da estadia de quando o pedido chegou.
- **Segurada** (em qualquer rumo): "Alteração da sua reserva"; no aumento, com o Pix e o cartão da diferença
  (aceite D11 quando preciso); na redução ou no mesmo valor, "Para confirmar, responda à nossa mensagem…" e a linha
  da política com a decisão ("…é devolvida | não é devolvida…").
- **Aplicada** (a última, enquanto a devolução está aberta e por 30 dias): "Alteração confirmada", com a devolução:
  esperando a liberação ("Devolução da diferença: R$ X (previsto para dd/mm). Ela será pedida ao Mercado Pago
  quando ele liberar o seu pagamento…", nunca "já pedimos"), pedida, feita, com a equipe, em conferência, ou sem
  devolução.
- **Não aplicada** (pagamento da diferença sem reserva): "A alteração não pôde ser feita" e a frase de que o valor
  volta.
- **Que não vale mais** (vencida ou desistida, sem pagamento, por 7 dias): "Alteração que não vale mais".
- Depois de uma alteração aplicada, o resumo da cotação diz que é o da cotação original e mostra as datas, as
  pessoas e o valor de agora.
- **Minha reserva:** "Há uma alteração da sua reserva esperando {o pagamento da diferença | a sua confirmação} até
  dd/mm às HH:MM (horário de Brasília): " com o link da página da reserva, sem valores (com o pagamento da diferença em
  andamento depois do prazo, "…com o pagamento da diferença em andamento").

### Mensagens

Dois tipos novos em Configurações → Modelos de mensagem (M9.2): "Alteração: proposta (e pagamento da diferença, se
houver)" (`alteracao_proposta`, qualquer rumo, enquanto segurada) e "Alteração: confirmada" (`alteracao_confirmada`);
"Cancelamento: devolução feita" passou a se chamar "Devolução feita (cancelamento ou alteração)" e serve também à
devolução da diferença ({recebido} = o momento do pedido da alteração). Variável nova `{alteracao}` (as frases
prontas do caso, com o prazo das datas seguradas), só nas mensagens da alteração; a proposta precisa de `{alteracao}`
e `{link}`, a confirmada de `{alteracao}`; nenhuma aceita `{endereco}`. Textos-base: "Olá, {hospede}! Preparamos a
alteração da sua reserva {codigo}: {alteracao} Veja os detalhes em {link}. Até a confirmação, a reserva continua
como está." e "Olá, {hospede}! A alteração da sua reserva {codigo} está confirmada: {alteracao} Acompanhe em {link}.
Qualquer dúvida, é só responder esta mensagem." O aviso do envio automático diz em que mensagens a variável vale,
pelos nomes (`ondeVale`).
- **Agora:** a ficha mostra "Copiar a proposta", "Copiar mensagem: alteração confirmada" e "Copiar mensagem: devolução
  feita" (com valores: só com `financeiro:ler`), cada uma com "Mensagem enviada ao hóspede" (com confirmação; grava
  quem e quando na alteração); a prévia também copia a proposta.
- **Sozinhas:** só com as mensagens ao hóspede ligadas e um modelo escolhido: a proposta enquanto a alteração está
  segurada, a confirmada até 7 dias depois de aplicada, a devolução feita até 7 dias depois dela; uma vez cada,
  marcando "avisado" pelo sistema; nunca a que a equipe já marcou. A confirmação da reserva não sai de novo depois
  de uma alteração aplicada.

### OTAs e o gancho do M8.3

Nada é escrito no Beds24. O Início (para quem edita reservas), com ou sem o envio ao Beds24 ligado, avisa
"N reserva(s) do site alterada(s) (SCL-…): mude o bloqueio nas OTAs (no Beds24, feche as novas datas e reabra as
antigas)." para a alteração aplicada que mudou as datas, ainda sem a marca e com alguma noite por vir; a ficha tem
**"Datas atualizadas nas OTAs"** (com confirmação, auditado). Mudar só pessoas ou valor não mexe no bloqueio. O M8.3
vai consumir `alteracoes_reserva` com `situacao = 'aplicada'` e `ota_atualizada_em` vazio, e gravar a marca
sozinho; a reserva-pedido nunca vai ao Beds24. O plano do envio (M3.7) também não conta as noites dela (elas podem
vencer), e o envio confere as reservas do imóvel de novo logo antes e logo depois de escrever: se uma alteração for
aplicada (ou qualquer reserva mudar) entre o plano e a escrita, nada é escrito pelo plano velho; se mudar durante a
escrita, o que foi escrito fica velho. Nos dois casos, o envio do imóvel é refeito em seguida, numa execução nova com as
reservas de agora (uma vez; se mudar de novo, fica para o próximo envio). O que muda depois da conferência já é
posterior à escrita, como qualquer reserva feita depois de um envio.

**Decisão de 10/10/2026 (revisão do M8.2d), vale para os três avisos das OTAs** (reserva do site paga, do M8.2a;
cancelada, do M8.2c; alterada, do M8.2d):
- *Antes:* cada aviso sumia quando o envio automático ao Beds24 (M3.7) estava ligado no ambiente
  (`BEDS24_ESCRITA=ligada` com credencial) e no painel, supondo que o envio cuidava das datas.
- *Agora:* o aviso aparece sempre, até a marca da equipe (ou do M8.3).
- *Motivo:* o envio do M3.7 manda só os bloqueios do SCL (`bloqueios` com fonte diferente de `beds24`) e o
  calendário de preços e mínimos; ele nunca fecha, reabre nem muda as datas de uma reserva. Com o aviso escondido,
  uma reserva paga, cancelada ou alterada no site ficaria vendável (ou fechada) nas OTAs sem ninguém saber, também nos
  imóveis fora da lista de envio.
- *Objetivo final:* o M8.3 fecha, reabre e muda as datas das reservas do site no Beds24 e grava as marcas sozinho;
  aí os avisos deixam de aparecer porque não sobra nada a fazer à mão.

### Início

- Operação (quem edita reservas, sem valores, da empresa toda): "Alteração da reserva SCL-…: datas seguradas até
  HH:MM, esperando {o pagamento da diferença | a confirmação do hóspede}." (com o link da ficha); o bloqueio a mudar
  nas OTAs (acima); "N alteração(ões) com mensagem ao hóspede pendente…" (só para quem lê o financeiro, atenção
  depois de 24 horas).
- Financeiro: devoluções feitas a menos ("peça o restante…"), devoluções de parte esperando a liberação (informativo)
  e com a liberação atrasada (atenção), pagamentos da diferença aprovados sem a alteração (atenção). "Pede atenção"
  inclui a alteração segurada. Financeiro → Pagamentos do site: "Diferença da alteração de dd/mm".

### Limites do M8.2d

- Só antes da entrada; depois dela, mais noites são uma reserva nova e a saída antecipada não tem devolução (as
  noites seguem ocupadas e a limpeza de saída fica na data original) até um item futuro. As linhas de diferença
  explícitas, a parte negativa do proprietário de uma parte já paga e o congelamento do motor ficam para essa
  alteração depois da entrada.
- Noites dos dois lados ao mesmo tempo: em duas alterações. Trocar de apartamento: cancelar e reservar de novo. O
  hóspede não pede alteração em Minha reserva; a equipe prepara.
- Uma segunda alteração espera enquanto a devolução de uma redução espera a liberação.
- Devolução de parte só depois da liberação e com a taxa conhecida; no teste, liberação registrada à mão. Com mais
  de 78 dias, pelo painel do Mercado Pago (cartão) ou por fora (Pix). A devolvida a menos não é pedida de novo
  sozinha. Se a taxa e os juros voltam numa parcial é desconhecido (itens 48 e 49): a equipe informa a taxa que não
  voltou. Uma parcial só se confirma por valor com uma leitura que traga `refunds[]`, o valor somado desde o pedido ou
  a confirmação da equipe (item 44).
- Um cancelamento retido não vira devolução por exceção depois: por fora mais um ajuste.
- Depois de um aumento, toda a parte do proprietário espera a liberação do pagamento da diferença (uma regra de
  dinheiro por reserva), e a data do pagamento (M4.12) passa a ser o dia dessa liberação.
- Hoje só o admin tem o financeiro: só Diego prepara alterações e mexe nas devoluções. As mensagens só saem sozinhas
  quando Diego ligar as mensagens ao hóspede.
- Testar só na prévia mais nova: as prévias antigas usam o mesmo banco e não conhecem o desfecho `alteracao`, a
  origem `alteracao`, a situação `substituida`, várias devoluções por pagamento nem as reservas-pedido das
  alterações (uma prévia antiga poderia oferecer "Confirmar" numa delas). Nas prévias a rotina não roda: as datas
  seguradas vencem na próxima ação da reserva, no "Conferir agora", num novo pedido do site ou num bloqueio do mesmo
  imóvel.
- Ganchos do M8.2e: pagamento contestado recusa a alteração; as devoluções são por pagamento com
  `devolucaoInexplicada`; `lancarDescontoDoProprietario`, `id_pagamento_provedor` e `tres_ds_status` não mudaram.

## Contestação (M8.2e)

Pronta em 11/10/2026, só no teste, nas prévias, com as mesmas travas. Desenho de 11/10/2026, a partir da `main` em
821ee7f, revisado no mesmo dia por quatro leituras adversariais (dinheiro, concorrência, produto e API/segurança),
conferidas no código e na documentação; o que a implementação ajustou está em "O que a implementação ajustou", no fim
desta seção, com o motivo. **Ler** usa `provedorDeConferencia`; **decidir, confirmar e lançar não
dependem dele** (nem da chave da oferta, nem das páginas legais): com a trava do provedor fechada, a equipe decide e
confirma com a nota "sem leitura do Mercado Pago". Nada de cobrança nova.

Base:
- a decisão de Diego de 7/10 (ROADMAP, M8.2; `RECEBIMENTO-SITE.md`, pergunta 4);
- os ganchos das partes anteriores: `id_pagamento_provedor` e `tres_ds_status` (M8.2b), as recusas `contestado` do
  cancelamento e da alteração (M8.2c e M8.2d), `lancarDescontoDoProprietario` e o "Dinheiro retido (sem devolução)"
  (M8.2c), as várias devoluções por pagamento e o D15/D21 (M8.2d);
- a documentação oficial do Mercado Pago relida em 11/10/2026: gestão de contestações e avisos de contestação das
  Orders (Checkout API e Checkout Pro), situação da order, 3DS e relatórios.

**O que a documentação atual diz** (páginas das Orders, 11/10/2026):
- `charged_back/reimbursed` na order: "o valor foi devolvido ao pagador depois da contestação" (a SCL perdeu);
  `settled`: "a transação foi liquidada"; `in_process`: em análise;
- `coverage_applied` é o resultado: `true` = a favor do vendedor (o dinheiro volta), `false` = contra; o exemplo
  oficial traz `null` (antes da decisão). Páginas antigas e o comentário de `CONTESTACAO_ABERTA` em `mercadopago.ts`
  ("reimbursed = o dinheiro voltou à SCL") dizem o contrário: o comentário é corrigido neste PR;
- o aviso de contestação das Orders chega como **order** (`type: "order"`, `action: "order.charged_back"`,
  `data.id` `ORD…`): o caminho de hoje já o processa;
- `GET /v1/chargebacks/{id}` e `GET /v1/chargebacks/search?payment_id=` exigem `X-Caller-Id` (o id numérico do
  vendedor); no exemplo, `id` vem como texto ("234000062890459000"), `payments` como lista de números e `amount` como
  número;
- no exemplo do aviso, o `transaction_id` da contestação não é o `id` do pagamento da mesma order: não serve para
  identificar.

O sandbox não tem cenário de contestação: o M8.2e é construído e testado sobre a versão falsa, nos formatos dos exemplos
oficiais. Como as páginas já se contradisseram e um resultado errado moveria dinheiro do proprietário, **o resultado da
contestação nunca é aplicado só pela leitura** (C1, abaixo). O que fica em aberto está nos itens 59 a 73 de "A conferir
no sandbox".

Código (em `app/src/`):
- `pagamentos/contestacao.ts`: a rotina e a busca tardia, o registro pela equipe, os e-mails à equipe, a decisão (registrar,
  mudar, atualizar o valor segurado), o débito, outra disputa, documentos e prazo, o resultado, o sem efeito e conferir o
  aviso; reexporta `contestacao-leitura.ts`;
- `pagamentos/contestacao-leitura.ts`: a leitura sob a trava (casar, criar a linha, os avisos do pagamento, o retido, a
  substituição das devoluções), separada de `contestacao.ts` para não fechar o ciclo de importação `aplicar` →
  `contestacao` → `conferencia` → `aplicar`;
- `pagamentos/contestacao-acerto.ts`: o livro da disputa (`lancarContestacao`, as partes efetivas da reserva);
- `pagamentos/contestacao-regras.ts`: as regras puras (`casarContestacao`, `transicaoDaContestacao`,
  `contestacaoDaLeitura`, `contestacaoEmCurso`, `valorEmRisco`, `dividirPerda`, `acertoDaPerda`, as chaves, as assinaturas
  e os textos);
- `pagamentos/contestacao-tela.ts` e `acoes-contestacao.ts`: o painel; `contestacao-portal.ts`: a leitura do proprietário;
- adaptador em `pagamentos/provedor.ts`, `mercadopago.ts` e `falso.ts`;
- `pagamentos/aplicar.ts`, `travas.ts`, `conferencia.ts` (`precisaFinanceiro`), `rotina.ts`, `devolucao.ts`, `liberacao.ts`,
  `cancelamento.ts`, `alteracao.ts`, `alteracao-tela.ts`, `acerto-cancelamento.ts`, `consultas.ts`, `situacoes.ts` e
  `acoes-painel.ts` ("Conferir agora" de um pagamento);
- `repasses/descontos.ts` (`lancarAcertoDoProprietario`), `extrato.ts`, `recebimentos.ts`, `repasses.ts`, `email.ts`,
  `inicio.ts` e `avisos-contestacao.ts` (os avisos dos repasses no Início);
- `despesas/despesas.ts` e `despesas/acoes.ts`; `components/reservas/Recebimentos.tsx`;
- `portal/posse.ts`, `portal/resumo.ts`, `portal/reservas.ts` e `portal/rodape.ts`;
- `relatorios/dados.ts`, `dinheiro.ts` e `relatorio.ts`;
- `painel/dashboard.ts` (`avisosDeContestacao`), `configuracoes/pagamento-site.ts`, `textos-site.ts` e `como-funciona.ts`,
  `site/pagamento-vista.ts`, `hospede/cancelamento.ts` e `mensagens/hospede.ts` (a rota contestada sem a mensagem da
  decisão);
- telas `components/reservas/ContestacaoSite.tsx`, `FormDecisaoContestacao.tsx`, `FormResultadoContestacao.tsx`,
  `FormRegistrarContestacao.tsx`, `FormCancelarContestada.tsx`, `FormAcaoContestacao.tsx` (os formulários menores) e
  `BotaoImprimir.tsx`; a página para imprimir `app/painel/reservas/[id]/defesa/page.tsx`; e as páginas da ficha, de
  Pagamentos do site, de Configurações → Pagamento no site, de despesas, de repasses, do portal, de `/reservar` e de Minha
  reserva;
- migração `0069_m8_2e_contestacao.sql`.

Testes: `pagamentos/contestacao-regras.test.ts`, `contestacao-leitura.test.ts`, `contestacao.test.ts`,
`contestacao-decisao.test.ts`, `contestacao-resultado.test.ts`, `contestacao-tela.test.ts`, `contestacao-dados.test.ts`,
`acoes-contestacao.test.ts`, `repasses/disputa.test.ts`, `components/reservas/ContestacaoSite.test.tsx` e
`components/repasses/CartaoRepasse.test.tsx`, além dos casos novos nos testes do adaptador, da migração, da configuração e
das telas que já existiam.

Com o M8.2e, as cinco partes estão prontas no teste. O pagamento de verdade continua esperando as decisões marcadas com
★ (aqui e nas partes anteriores).

### O que é contestação aqui

**Contestação (chargeback)** é o pedido do titular do cartão ao banco dele para desfazer a cobrança. Passa pela bandeira e
pelo emissor, não pelo Mercado Pago. O Mercado Pago retém o valor em disputa na conta da SCL (se debita ou só bloqueia,
e se pelo bruto ou pelo líquido, está a conferir: item 64) e a decisão pode levar até 6 meses.

- **Cartão:** o caso principal. O sistema detecta sozinho (abaixo).
- **Pix com `charged_back` na leitura:** registrado igual, por defesa, com o aviso `contestacao_pix`.
- **MED do Pix** (Mecanismo Especial de Devolução, do Banco Central). Só vale para fraude, golpe ou falha operacional,
  nunca para desacordo comercial. Quem analisa o caso é o Mercado Pago, como banco de quem recebeu, em cerca de 7 dias.
  - Nenhuma página do Mercado Pago diz como o MED aparece para o vendedor (item 67). O sistema não o detecta.
  - Entra pelo registro da equipe ("Registrar disputa vista no painel do Mercado Pago", tipo `med`, só num Pix) e
    segue o mesmo fluxo.
  - Se o dinheiro aparece na order como uma devolução que o sistema não pediu, o caso cai antes no D21 (reserva em
    conferência, aviso `devolvido_por_fora`). **O registro do MED não grava `devolvido_fora_reconhecido`**: o valor do
    MED vira o retido da contestação (uma saída de caixa já realizada, no dia em que a leitura viu a devolução,
    `devolvido_visto_em`), e o D21 passa a contar as contestações `med` e `reclamacao` do pagamento como explicação
    da devolução lida, até o valor delas (`devolucaoInexplicada` e `devolvidaNoProvedorSql`). Daí em diante, quem segura
    a reserva é a contestação. Reconhecer o valor como "devolvido fora" zeraria o valor em risco e deixaria no caixa um
    dinheiro que já saiu.
- **Reclamação do Mercado Pago** (Claims API, mediação): não é contestação.
  - Se aparecer na order como `charged_back/in_process` (a página de migração mapeia `in_mediation` para isso), é lida
    como contestação: o sistema não tem como separar, e o aviso diz isso.
  - Se aparecer como devolução, a equipe a registra à mão (tipo `reclamacao`), como o MED.
- **Nome no código:** "contestação" já existe para os adiantamentos (M4.4: `contestacoes_adiantamento`,
  `repasses.contestado`). Aqui é sempre "contestação do pagamento": tabela `contestacoes_pagamento` e origem de
  lançamento `contestacao_pagamento`.
- **Nome nos textos, por tipo:** "contestação no cartão" (`chargeback`), "devolução pedida pelo Pix (MED)" (`med`),
  "reclamação no Mercado Pago" (`reclamacao`); nas contagens e no que vale para os três, "disputa do pagamento".
- **Para o proprietário:** "disputa do pagamento da reserva SCL-…" (rótulo "Disputa do pagamento"; abaixo). A palavra
  "Contestados" do e-mail do repasse (adiantamentos que o proprietário contestou) continua só para aquilo.
- **Para o hóspede:** a palavra "contestação" nunca aparece na página da reserva nem em Minha reserva: lá é "pagamento
  em conferência".

### Quem pode

| Ação | Permissão |
|---|---|
| Ver que o pagamento está em conferência por uma disputa (tipo, situação, datas e prazo dos documentos, sem valores) | `reserva:ler` |
| "Documentos enviados no painel do Mercado Pago"; abrir a página "Documentos para a defesa" | `reserva:editar` ou `financeiro:editar` |
| Ver valores, motivo, decisão, lançamentos, notas e a linha do tempo | `financeiro:ler` **e** papel diferente de `proprietario` |
| Registrar disputa vista no painel do Mercado Pago; confirmar o débito do Mercado Pago; registrar e mudar quem arca; atualizar o valor segurado; confirmar o resultado e o valor perdido; encerrar sem efeito; conferir o aviso (e reabrir) | `financeiro:editar` |
| Cancelar a reserva contestada (sem devolução pelo sistema) | `reserva:editar` **e** `financeiro:editar` |

- Hoje só o admin tem o financeiro: só Diego decide.
- As ações seguem sessão → permissão → validação → domínio, como no M8.2c e no M8.2d.
- **O papel `proprietario` tem `financeiro:ler`** (`acesso/politica.ts`) e hoje só o redirecionamento do layout do painel o
  barra. As leituras da equipe (`lerContestacoesDaEquipe`) exigem `financeiro:ler` e papel diferente de `proprietario`,
  no servidor. O portal usa outra função (`contestacoesDoProprietario`, em `contestacao-portal.ts`) com lista branca de
  campos (abaixo), filtrada por `reservaDosDonos` **e** pelo `proprietario_id` das linhas do motor da reserva — nunca pelo
  dono atual do imóvel.
- Os ids vindos do formulário são resolvidos com o filtro da organização **antes de qualquer trava**:
  `contestacaoDaOrganizacao` (o id da contestação) e `pagamentoDaOrganizacao` (o registro pela equipe recebe o id do
  pagamento). Id de outra empresa = "não encontrada", sem chamada ao provedor nem gravação.
- As listas são fechadas.
- O proprietário vê no portal só o que o atinge: a reserva em conferência, o valor segurado e o desconto definitivo ou
  devolvido, a causa e a explicação ao proprietário (quando a equipe escreveu). Nunca a nota interna, o número do caso, o
  motivo do Mercado Pago ou dado do hóspede.

### De onde vem cada fato

1. **Leitura da order**, a mesma conferência de sempre, até 85 dias.
   - `cobrancaDaOrder` passa a ler `transactions.chargebacks[]` por lista branca, até 20 itens, para
     `Cobranca.contestacoes: ContestacaoLida[]`. Cada item traz:
     - `idContestacao` (`CBK…`, `idContestacaoValido`);
     - `idCaso` (`case_id`: texto `^\d{1,20}$`, ou número com `Number.isSafeInteger`, convertido com `String`; outro
       formato = null, e o caso é procurado pela busca do pagamento);
     - `idTransacao` (`PAY…`): só como pista, nunca para casar (o exemplo oficial não bate com o pagamento);
     - `estadoLido`: `in_process`, `settled`, `reimbursed` ou `desconhecido` (com o `codigo` cru curto ao lado);
     - `valor` (`amount`, número ou texto, por `valorApiParaCentavos`; ilegível = null).
   - `references`, `reason`, `documentation` e qualquer texto livre nunca são lidos.
   - A transação `charged_back/<detalhe>` sem item na lista dá uma `ContestacaoLida` sem identificação, com o estado pelo
     detalhe.
   - A transação de volta a `processed/accredited` com uma contestação conhecida é guardada como fato ("a transação
     voltou a aprovada"), nunca como resultado.
   - `normalizarSituacao` não muda: continua dando `contestado`. A situação que vale para o pagamento sai de
     `contestacaoDaLeitura` (abaixo).
2. **Chargebacks API**, dois métodos novos no adaptador.
   - `consultarContestacao(idCaso)` (`GET /v1/chargebacks/{id}`) → `CasoDeContestacao`, ou null (404), ou
     `{ semAcesso: true }` (403).
   - `buscarContestacoes(idPagamento)` (`GET /v1/chargebacks/search?payment_id=`) → lista; 403 = `{ semAcesso: true }`;
     404 (rota inexistente), falha de transporte ou resposta ilegível lançam `ErroProvedor`: nunca "nenhuma" sem saber.
   - `CasoDeContestacao`, por lista branca:
     - `idCaso` (texto `^\d{1,20}$` ou inteiro seguro) e `pagamentos[]` (só inteiros seguros, convertidos com `String`);
     - `valor` (`amount`);
     - `motivoId` (`reason_id`, `^\d{1,6}$`) e `motivoCodigo` (`reason`, só `^[a-z][a-z0-9_]{0,39}$`, sem espaço: uma
       frase com nome nunca passa);
     - `coberturaAplicada` (`coverage_applied`: null, true ou false, **o resultado** pela documentação atual) e
       `coberturaElegivel` (aceita também a grafia `coverage_elegible`);
     - `documentacao` (`pending`, `review_pending`, `valid`, `invalid`, `not_supplied`, `not_applicable`; outro =
       desconhecida);
     - `prazoDocumentacao` (`date_documentation_deadline`, pode vir null);
     - `criadoEm`, `atualizadoEm` (`date_last_updated`) e `aoVivo`.
   - Nunca: `documentation[]` (endereços, arquivos, descrições), o `reason` em texto livre e a resposta crua.
   - **O caso precisa ser deste pagamento:** só vale um caso cujo `payments[]` contém `pagamentos.id_pagamento_provedor`.
     Senão, nada do caso é usado e liga `contestacao_caso_de_outro_pagamento` ("Este caso é de outro pagamento no Mercado
     Pago."); no registro pela equipe, a ação recusa com essa frase. Sem `id_pagamento_provedor`, o número do caso fica só
     como referência e os valores dele não são usados. A mesma conferência vale para cada item da busca.
   - **Contrato do adaptador:** `ClienteMercadoPagoHttp.chamar` hoje lança `ErroProvedor("credencial")` em todo 401 e 403
     antes de o método ver a resposta, e não aceita cabeçalho. `Chamada` ganha `cabecalhos` (lista branca: só
     `X-Caller-Id`) e `aceitar` (status que voltam ao método em vez de lançar: aqui, 403 e 404). 401 continua credencial.
   - **`X-Caller-Id`:** o `id` de `GET /users/me` (já chamado em `conferirContaDeTeste`, que hoje só lê `tags`), só
     algarismos e inteiro seguro, guardado em memória no cliente. Uma chamada só, sempre com o cabeçalho; se a chamada
     sem ele existe é o item 60. O `user_id` do corpo do aviso (não assinado) nunca serve.
   - Tempo-limite de 8 s por chamada nestes métodos (os outros continuam com 15 s).
3. **Payments API pelo número** (`GET /v1/payments/{id_pagamento_provedor}`), método novo `situacaoDoPagamento`: só
   `status`, `status_detail` e `money_release_status`, por lista branca. Terceira fonte, para as contestações com mais de
   85 dias (a order não é mais lida) e para a ganha sem recebimento. Se responde para pagamentos antigos é o item 72;
   enquanto não responder, vale o aviso do dia 85 (abaixo).
   - **O Pix passa a gravar `id_pagamento_provedor`.** `aplicar.ts` hoje só grava no cartão; passa a gravar sempre que
     `detalheFinanceiro.idPagamento` vem. O limite é o mesmo do caso: `^\d{1,20}$` (hoje 30), num lugar só.
4. **Aviso assinado.** Nada muda no caminho: o aviso de contestação das Orders chega como order (`ORD…`,
   `order.charged_back`), e a releitura da order já traz `transactions.chargebacks[]`. O id numérico continua registrado
   como `ignorado` (com o `type` que já é gravado), até o item 59 mostrar outro formato.
   - Diego marca também o evento "Contestações" (`chargebacks`) no painel de Webhooks (GUIA, seção 6, item 37
     atualizado).
   - Nas prévias o aviso não chega: o "Simular" do Mercado Pago contra o endereço de produção só confere a assinatura e
     grava o evento (item 59).
5. **Rotina** (`conferirContestacoes`, em `rotinaDoSite` **depois** de `expirarHoldsVencidos`, para um Mercado Pago lento
   nunca atrasar o vencimento das datas seguradas; nas prévias, pelo "Conferir agora", depois de `conferirPendentes`).
   - Orçamento de 60 s por volta e 8 s por chamada; no máximo 50 leituras por volta
     (`LEITURAS_DE_CONTESTACAO_POR_VOLTA`), em ordem de `proxima_leitura_em`. Desde a revisão do Codex de 11/10, o
     orçamento é conferido também antes de cada chamada dentro de um pagamento (abaixo, "Revisão do Codex").
   - Cada contestação `aberta` ou `a_confirmar` é relida uma vez por dia (`RELER_CONTESTACAO_A_CADA_MS`):
     - pela order, enquanto ela está nos 85 dias;
     - pela Chargebacks API, pelo id do caso (ou pela busca pelo id do pagamento, sem o caso; desde a revisão do Codex de
       11/10, a busca roda sempre que alguma disputa do pagamento não tem o caso, mesmo com outra com caso ao lado);
     - depois dos 85 dias, também pela Payments API pelo número.
   - **A fila anda também na falha:** `proxima_leitura_em` avança com espera crescente (1, 2, 4 dias, até 7) e
     `falhas_leitura` conta; as mesmas 50 nunca ocupam todas as voltas.
   - 403 da Chargebacks API: aviso `contestacao_sem_leitura`, uma vez (a equipe confere no painel do Mercado Pago).
   - **Dia 85 sem fonte** (sem caso nem `id_pagamento_provedor`, ou Chargebacks e Payments sem resposta útil): aviso
     `contestacao_sem_fonte`, uma vez ("confira o resultado no painel do Mercado Pago e confirme aqui"), em vez de esperar
     os 240 dias.
   - Até 240 dias da abertura (`PRAZO_LEITURA_CONTESTACAO_DIAS`: os 6 meses da decisão, com folga). Depois, para de ler e
     liga uma vez `contestacao_fora_do_prazo`; a equipe confirma o resultado pelo painel do Mercado Pago.
   - **Busca tardia** (`buscarContestacoesTardias`): todo pagamento com `id_pagamento_provedor` e dinheiro (aprovado,
     devolvido em parte ou por inteiro, contestado), **de qualquer desfecho** (reserva, alteração, devolução, por fora,
     sem reserva), na janela de 80 dias da aprovação até 200 dias depois do maior entre a aprovação e a saída da reserva,
     com teto de 540 dias da aprovação (`JANELA_CONTESTACAO_TARDIA`): nas bandeiras, o prazo de "serviço não prestado"
     conta do dia previsto do serviço (itens 66 e 71). Uma vez por semana por pagamento, pela coluna
     `pagamentos.contestacoes_buscadas_em`, reservada por `UPDATE … RETURNING` antes da chamada (como a leitura reservada
     do M8.2a). Sem o id, nada (o quadro diz isso). O 403 gasta a vez e, desde a revisão do Codex de 11/10, liga o aviso
     `contestacao_busca_sem_acesso` no pagamento (contado no Início), que sai na primeira busca tardia que responder (a da
     semana seguinte, ou a do "Conferir agora").
   - **"Conferir agora" com `pagamentoId`** (o quadro de uma reserva): só as contestações e a busca daquele pagamento.
   - O comentário de `rotina.ts` ("Contestação depois disso é do M8.2e") e o de `RETENCAO_ORDERS_DIAS` passam a apontar
     para cá.
6. **Registro pela equipe**: "Registrar disputa vista no painel do Mercado Pago", no quadro do pagamento.
   - Campos:
     - tipo: Contestação no cartão (`chargeback`), MED do Pix (`med`, só num Pix) ou Reclamação no Mercado Pago
       (`reclamacao`);
     - aberta em (data entre a aprovação e hoje);
     - valor (até o pago);
     - prazo dos documentos (opcional; sem ele, aviso `contestacao_prazo_desconhecido`, abaixo);
     - número do caso (opcional, só algarismos, até 20; conferido contra o pagamento quando dá para ler);
     - nota obrigatória, passada por `textoSemDadosPessoais`.
   - Fase 0 (sem trava, melhor esforço): releitura da order e da Chargebacks API. Falhou ou o provedor está fechado: segue,
     com "sem leitura do Mercado Pago" na nota.
   - Fase 1, sob a trava: `casarContestacao` de novo (a rotina pode ter criado a linha no meio). Casou com uma linha
     existente: "O Mercado Pago já mostra esta disputa: ela está no quadro." O índice único violado (23505) responde o
     mesmo, nunca o erro cru.
   - Origem `equipe`. O quadro diz "registrada à mão: o sistema confere pela leitura quando puder".

**Casamento e idempotência** (`casarContestacao(lidas, linhas)`, pura, testada numa matriz que inclui a order antes da API,
a API antes da order, a leitura sem lista depois com lista, e a linha final relida):
1. Casa pelo `id_caso` e depois pelo `id_contestacao`, na rodada mais nova (índices únicos abaixo). O `id_transacao`
   nunca casa sozinho.
2. Leitura sem identificação, ou com um id nunca visto, num pagamento com **exatamente uma** linha não final: é essa
   linha, e ela é completada (`completarIdentificacao`), nunca duplicada.
3. Leitura com estado final (`settled`, `reimbursed`, ou `coverage_applied` preenchido), ou que só casa com linhas
   finais, **nunca cria linha**: atualiza os fatos ou liga `contestacao_resultado_mudou`. Num pagamento sem linha
   nenhuma (a busca tardia achou uma disputa já encerrada), liga no pagamento `contestacao_ambigua` ("o Mercado Pago
   mostra uma disputa já encerrada que o sistema não conhecia: registre-a pelo quadro e confirme o resultado").
4. Linha nova só com `in_process` e nenhuma linha não final no pagamento.
5. Qualquer outro caso (duas linhas não finais e uma leitura sem id, por exemplo): aviso `contestacao_ambigua`, sem criar
   nada; a equipe confere no painel do Mercado Pago.
6. **Segunda disputa no mesmo pagamento com outra ainda não final** (pela equipe, ou um caso com id novo e outro aberto):
   nasce com valor em risco 0, sem retido, com o aviso `contestacao_possivel_duplicata`, até a equipe "Confirmar que é
   outra disputa" (auditado). A soma dos valores em risco das linhas não finais, não duplicadas e não `sem_efeito` de um
   pagamento nunca passa do pago.

**Ordem das leituras.**
- Cada linha guarda `lida_em` (o início da chamada que a leu) e `atualizado_no_provedor_em` (`date_last_updated`). Sob a
  trava, uma leitura iniciada antes da última aplicada, ou com `date_last_updated` mais antigo, é descartada.
- Entre as fontes da mesma volta, a precedência é fixa: qualquer `in_process` = em disputa. Fontes que divergem no
  encerramento (`reimbursed` com `coverage_applied = true`, por exemplo) ligam `contestacao_leitura_conflitante` uma
  vez, sem transição.
- Evento só quando o estado combinado muda; uma leitura que não muda nada só atualiza `consultada_em` e `lida_em`.

**Desconhecido nunca sobrescreve conhecido.**
- Status fora da lista: `estado_lido` fica o último conhecido, o código estranho vai em `codigo`, aviso
  `contestacao_situacao_desconhecida`, situação mantida.
- Valor ilegível: aviso `contestacao_valor_desconhecido`; o valor em risco usa o pago e o diz.
- Valor maior que o valor da reserva: aviso `contestacao_valor_acima`: "o valor contestado (R$ A) passa do valor da
  reserva (R$ P): pode incluir os juros do parcelamento; confira no painel do Mercado Pago quanto saiu da conta".
- `live_mode = true` no caso: aviso `ao_vivo`, como em toda leitura (só alarme).

### Tabelas (migração 0069, idempotente como a 0067 e a 0068)

`IF NOT EXISTS` em tudo, e cada chave estrangeira num bloco que confere `pg_constraint`, porque o banco das prévias é
compartilhado. Sem tipo novo no `pgEnum` de lançamentos.

**`contestacoes_pagamento`** (sem dado pessoal; linhas nunca apagadas):
- **Vínculos:** `organizacao_id`, `pagamento_id`, `reserva_id` (null no pagamento sem reserva) e `imovel_id`.
- **Identificação:**
  - `tipo` (`chargeback`, `med`, `reclamacao`);
  - `origem` (`leitura`, `equipe`);
  - `id_caso`, `id_contestacao` e `id_transacao` (pista);
  - `rodada` (1; a reabertura de uma disputa ganha cria a rodada seguinte, abaixo);
  - `duplicata_possivel` (boolean) e `confirmada_outra_em`/`confirmada_outra_por`.
- **Situação:** `situacao` (abaixo) e `situacao_pagamento_antes` (`aprovado`, `devolvido_parcial` ou `devolvido`: a da
  primeira linha não final do pagamento; para onde o pagamento volta se a SCL ganhar).
- **Leitura:**
  - `estado_lido` (o último conhecido: `in_process`, `settled`, `reimbursed`) e `codigo` (o cru curto, inclusive
    desconhecido);
  - `cobertura_aplicada`, `cobertura_elegivel`, `motivo_id` e `motivo_codigo`;
  - `valor` (centavos em disputa) e `valor_origem` (`leitura`, `equipe`, `pagamento`);
  - `valor_em_risco` (o derivado, gravado sob a trava a cada mudança: é o que a regra da conferência em SQL lê);
  - `aberta_em` (primeira vez vista ou registrada) e `aberta_no_provedor_em`;
  - `documentacao`, `documentacao_prazo`, `documentos_enviados_em` e `documentos_enviados_por`;
  - `tres_ds_status`, o retrato do pagamento na abertura;
  - `ao_vivo`, `consultada_em`, `lida_em`, `atualizado_no_provedor_em`, `proxima_leitura_em`, `falhas_leitura`,
    `avisos` (jsonb) e `nota_registro`.
- **Decisão:**
  - `causa`, `quem_arca`, `decisao_nota` e `explicacao_proprietario` (opcional, até 300, mostrada ao proprietário);
  - `decisao_por`, `decisao_em` e `decisao_versao` (0 = sem decisão; sobe a cada mudança);
  - `base_parte_proprietario` e `base_comissao` (o retrato da divisão, em centavos);
  - `exposicao` (o valor em risco usado na versão em vigor) e `parte_proprietario`/`parte_scl` (a divisão em vigor).
- **Resultado:**
  - `resultado_em` (data informada), `resultado_por` e `resultado_nota`;
  - `valor_perdido`, `liquido_nao_entrou`, `debito_em` (o dia em que o Mercado Pago debitou) e `tarifa`;
  - `definitivo_em` (os lançamentos definitivos feitos) e `encerrada_nota` (sem efeito);
  - `aviso_conferido_em`, `aviso_conferido_por` e `aviso_conferido_nota` ("Conferir o aviso").
- **Caixa:** `retido_lancamento_id`, `retido_confirmado_em`, `retido_confirmado_por`, `volta_lancamento_id` e
  `caixa_final_lancamento_id`.
- **Índices:**
  - `contestacoes_pagamento_caso`: único (`pagamento_id`, `id_caso`, `rodada`) com o caso preenchido;
  - `contestacoes_pagamento_cbk`: único (`pagamento_id`, `id_contestacao`, `rodada`) com o id preenchido;
  - `contestacoes_pagamento_sem_id`: único (`pagamento_id`) com o caso e o id vazios e a situação `aberta`/`a_confirmar`;
  - `contestacoes_pagamento_situacao` (`organizacao_id`, `situacao`);
  - `contestacoes_pagamento_leitura` (`proxima_leitura_em`) parcial, só as não finais;
  - `contestacoes_pagamento_reserva` (`reserva_id`).

**`eventos_contestacao`** (a linha do tempo; "registro de cada evento"; nunca apagada, ao contrário de
`eventos_pagamento`, que some em 90 dias e não se liga ao pagamento):
- colunas: `contestacao_id`, `fonte` (`order`, `chargebacks`, `payments`, `equipe`, `sistema`), `tipo`, `antes` e
  `depois` (jsonb pequeno, só códigos, datas e centavos), `usuario_id` (null = o sistema) e `em`;
- tipos: `aberta`, `estado_lido`, `documentacao`, `prazo`, `valor`, `cobertura`, `decisao`, `documentos_enviados`,
  `debito_confirmado`, `resultado`, `sem_efeito`, `aviso_conferido`, `reaberta`, `outra_disputa`, `substituicao`,
  `cancelamento`, `caixa`, `lancamentos`, `email_equipe`;
- índice (`contestacao_id`, `em`).

**Em `pagamentos`:** `contestacoes_buscadas_em` (a busca tardia semanal). **Em `devolucoes_pagamento`:**
`contestacao_id` (a contestação que substitui esta devolução, abaixo; chave estrangeira com nome próprio).

**Listas no código, sem migração:**
- `SITUACOES_CONTESTACAO`, `TIPOS_CONTESTACAO`, `ORIGENS_CONTESTACAO`, `ESTADOS_LIDOS_CONTESTACAO`,
  `SITUACOES_DOCUMENTACAO`, `CODIGOS_CAUSA_CONTESTACAO`, `QUEM_ARCA_CONTESTACAO`, `FONTES_EVENTO_CONTESTACAO` e
  `TIPOS_EVENTO_CONTESTACAO`;
- `AVISOS_DE_CONTESTACAO`: `contestacao_pix`, `contestacao_situacao_desconhecida`, `contestacao_valor_desconhecido`,
  `contestacao_valor_acima`, `contestacao_valor_mudou`, `contestacao_com_devolucao`, `contestacao_liberacao_lida`,
  `contestacao_ganha_sem_recebimento`, `contestacao_resultado_mudou`, `contestacao_leitura_conflitante`,
  `contestacao_ambigua`, `contestacao_possivel_duplicata`, `contestacao_caso_de_outro_pagamento`,
  `contestacao_sem_leitura`, `contestacao_sem_fonte`, `contestacao_fora_do_prazo` e `contestacao_prazo_desconhecido`
  ("a divisão da reserva mudou depois da decisão" é calculado na leitura, nunca gravado: abaixo); desde a revisão do Codex
  de 11/10, também `contestacao_busca_sem_acesso` (o 403 da busca tardia), que mora só no pagamento, como a
  `contestacao_ambigua` (`AVISOS_DE_CONTESTACAO_DO_PAGAMENTO`);
- o desfecho `contestacao` (só no pagamento sem reserva, abaixo);
- a origem de lançamento `contestacao_pagamento` e o prefixo das chaves `mercadopago:<pagamento>:contestacao:<id>:`;
- a origem de devolução não muda; a confirmação de uma devolução ganha o valor `contestacao` em `confirmada_por`;
- os códigos de recusa `contestacao_perdida` e `contestacao_previa_mudou`;
- o motivo de cancelamento `contestacao` (abaixo);
- a chave de Textos do site `pagamentoEmConferencia`;
- em `pagamento_site`: `categoriaDaContestacao`, `diasAvisoDocumentacao` e `causasContestacao` (nome e frase de cada
  código, editáveis).

**Registro de decisão (11/10/2026), dados pessoais.**
- *Antes* (M8.2b, seção "Dados pessoais"): "nunca guardado nem registrado: … ids dos casos de contestação".
- *Agora:* `id_caso`, `id_contestacao` e `id_transacao` são guardados.
- *Motivo:* são identificadores do Mercado Pago para a disputa, sem dado de ninguém, como o id da order e o número do
  pagamento que a ficha já mostra. São a única forma de ler o caso depois dos 85 dias e de achá-lo no painel do Mercado
  Pago.
- *Continua proibido:* o `reason` em texto livre, a documentação (arquivos, endereços e descrições), qualquer dado do
  pagador e a resposta crua.

### Situações e transições

Situação da contestação (`situacao`, local):

| Situação | Quando |
|---|---|
| `aberta` | em disputa: leitura `in_process`, aviso ou registro da equipe |
| `a_confirmar` | o Mercado Pago mostra a disputa encerrada (`settled`, `reimbursed`, `coverage_applied` preenchido, ou a transação de volta a aprovada): resultado a conferir pela equipe |
| `ganha` | a SCL ganhou (confirmado pela equipe) |
| `perdida` | a SCL perdeu (confirmado pela equipe) |
| `sem_efeito` | registrada por engano, duplicata, ou reclamação resolvida sem dinheiro (pela equipe, com nota) |

- A documentação é um eixo à parte: `documentacao`, `documentacao_prazo` e a marca "Documentos enviados no painel do
  Mercado Pago" (com data, auditada).
- **Transições** (`transicaoDaContestacao`, pura, testada numa matriz):
  - pela leitura: `aberta` → `a_confirmar`; `a_confirmar` → `aberta` só com uma leitura mais nova (ordem acima) que
    mostra `in_process` do mesmo caso, com evento e aviso uma vez;
  - pela equipe: `aberta`/`a_confirmar` → `ganha`/`perdida`/`sem_efeito`.
  - `ganha`, `perdida` e `sem_efeito` são finais. Uma leitura que contradiz uma linha final (um caso `ganha` lido
    `in_process` ou com `coverage_applied = false`; um caso `perdida` lido com `coverage_applied = true`) liga
    `contestacao_resultado_mudou` e não muda a linha nem a situação do pagamento.
  - **"Conferir o aviso"** (`financeiro:editar`, nota obrigatória), numa linha final com `contestacao_resultado_mudou`:
    - "A disputa continua encerrada no painel do Mercado Pago": o aviso sai;
    - só numa `ganha` relida `in_process`: **"A disputa foi reaberta (reapresentação ou arbitragem)"**: nasce a rodada
      seguinte (linha nova, mesma identificação, origem `equipe`, `aberta`, sem decisão), que segue o fluxo inteiro. A
      rodada ganha fica como está, com os lançamentos dela.
    - Numa `perdida` contradita, a correção é um ajuste (limites).
- **C1, Registro de decisão (11/10/2026).**
  - *Antes:* o M8.2a supunha a contestação resolvida pela leitura ("a releitura só aceita quando o Mercado Pago mostra o
    pagamento aprovado de novo", seção "Devolução na parte (a)").
  - *Agora:* o resultado só vale com a confirmação da equipe ("Confirmar o resultado"). O formulário **começa sem nada
    marcado** e mostra os fatos em palavras: "O Mercado Pago mostra a disputa encerrada (código `reimbursed`). Pela página
    atual do Mercado Pago, `reimbursed` é 'devolvido ao pagador' e a cobertura `false` é 'contra o vendedor'; o sentido
    está a conferir (item 61). Confira no painel dele se o dinheiro voltou à SCL." Datas e valores vêm preenchidos; o
    resultado, nunca. A sugestão pela leitura existe no código atrás de `SUGERIR_RESULTADO_PELA_LEITURA = false`.
  - *Motivo:* as páginas oficiais já deram sentidos opostos a `reimbursed` ("devolvido ao pagador" na situação da order ×
    "o dinheiro voltou à SCL" no comentário do M8.2b, tirado de página antiga), e `coverage_applied` já apareceu como
    cobertura e como resultado. Um resultado errado moveria dinheiro do proprietário. As contestações são raras:
    confirmar custa pouco.
  - *Objetivo final:* depois de o item 61 do sandbox (ou o primeiro caso real) conferir os códigos, um item futuro liga a
    sugestão e, depois, aplica o resultado pela leitura; a equipe só confirma o valor.
- **A situação do pagamento** (`contestacaoDaLeitura(c, linhas)`, pura: uma função só, que devolve se a leitura está
  explicada pelas linhas conhecidas e a situação que vale):
  - usada por `aplicarLeitura` e por todos os testes que hoje olham a situação crua: `tentarDevolucao`
    (`devolucao.ts`, o `cobranca.situacao === "contestado"`), `recusaPeloProvedor` (o por fora), `precisaFinanceiro`
    (`conferencia.ts`), `estadoDaCancelada` (`consultas.ts`), `montarDecisao` (`cancelamento.ts`) e `conferirReserva`
    (`alteracao.ts`);
  - continua `contestado` (a leitura e `transicaoPermitida` não mudam) enquanto houver contestação não final;
  - um pagamento `devolvido` contestado **não muda de situação** (`transicaoPermitida` não deixa); a linha nasce mesmo
    assim, com o aviso `contestacao_com_devolucao`;
  - com todas as linhas `ganha` ou `sem_efeito`, `confirmarResultado` (ou o "sem efeito") volta o pagamento a
    `situacao_pagamento_antes` **só se ele ainda estiver `contestado`** (uma devolução aceita que se confirmou no meio
    já o levou a `devolvido`), auditado (`pagamento.situacao`, motivo `contestacao_ganha`). É a segunda saída de
    `contestado`, ao lado de contestado → devolvido com um pedido de devolução aceito;
  - depois disso, uma leitura `contestado` em que cada contestação lida é de uma linha final conhecida, sem `in_process`,
    é explicada e mantém a situação local. Uma leitura **sem id** em `settled`/`reimbursed` é explicada por qualquer
    linha final do pagamento. Só `in_process` sem linha não final abre linha nova (casamento, item 4); `in_process` sem
    id com só linhas finais liga `contestacao_resultado_mudou`, sem linha nova.
- **Em curso** (`contestacaoEmCurso(t, pagamentoId)`, pura, sobre o retrato travado): alguma linha `aberta`,
  `a_confirmar` ou `perdida`, de qualquer origem (leitura ou equipe), ou uma `ganha` com `contestacao_resultado_mudou`
  vindo de `in_process` e ainda não conferido. Uma regra, um lugar: `montarDecisao` (cancelamento), `conferirReserva` e
  `aplicarNaTransacao` (alteração), `tentarDevolucao`, `registrarRecebimento` e o "pedir de novo" leem daqui, além da
  situação. Assim, um MED registrado à mão num Pix aprovado e um caso achado só pela Chargebacks API depois do dia 85
  (a order já apagada, o pagamento ainda `aprovado`) recusam o cancelamento pela política e a alteração como um
  pagamento `contestado`.
- **Avisos.**
  - O aviso `contestado` do pagamento passa a valer só com contestação em curso e é desligado quando ela termina. O texto
    passa a ser por tipo: "Pagamento contestado no cartão", "Devolução pedida pelo Pix (MED)" ou "Reclamação no Mercado
    Pago", mais ": acompanhe no quadro da disputa."
  - Os avisos de cada contestação vivem em `contestacoes_pagamento.avisos`. O pagamento leva a união deles
    (`avisosComContestacoes`, o gêmeo de `avisosComDevolucoes`), recalculada na mesma transação de toda gravação.

### A reserva enquanto a disputa está aberta

**Em conferência por disputa** (uma regra, um lugar: `contestacaoSemDecisaoSql()` em `portal/posse.ts` e o gêmeo TS
`contestacaoSemDecisao` em `contestacao-regras.ts`). A reserva tem um pagamento com o dinheiro dela (desfecho `reserva`
ou `alteracao`) com uma linha não duplicada que se encaixa num destes casos:
- `aberta` ou `a_confirmar`, com `valor_em_risco > 0` e sem decisão de quem arca;
- `perdida`, com perda a dividir maior que zero e sem a decisão.

Efeitos:
- **Parte do proprietário dessa reserva ainda não repassada:** fica "a liberar" (`classificarParte`, campo novo
  `ParteBruta.contestacaoSemDecisao`), com o motivo "Reserva em conferência: disputa do pagamento; a parte espera a
  decisão de quem arca."
- **Parte já repassada:** nada é descontado de ninguém até a decisão.
- **Parte num repasse ainda a pagar** quando a disputa abre: o repasse ganha o aviso "A reserva SCL-… tem uma disputa do
  pagamento aberta desde dd/mm: estorne o repasse antes de pagar, se quiser segurar a parte dela." (painel e Início), e
  o `BotaoConfirmar` de "Marcar como pago" repete a frase. Nada é bloqueado: é decisão da equipe.
- **C2, Registro de decisão (11/10/2026).** A disputa **não entra em `lancamentoEmConferencia`**.
  - *Motivo:* aquela regra bloqueia o fechamento inteiro do proprietário, e uma disputa dura até 6 meses.
  - *Como funciona:* a parte presa fica fora do fechamento (`foraDoFechamento`, a mesma porta do M4.10 para o dinheiro
    que ainda não está com a empresa) e vai para o repasse seguinte. As outras partes do proprietário seguem.
  - *Onde aparece:* o portal (`portal/reservas.ts`), o rodapé, o resumo e o relatório mostram "em conferência" pela
    regra nova, com o texto "disputa do pagamento". No fechamento e no e-mail do repasse, a parte presa por disputa tem
    motivo próprio: "reserva em conferência: disputa do pagamento" (nunca "dinheiro ainda não recebido pela empresa",
    que é falso aqui).
  - *Continua:* o débito do proprietário depois da decisão é `previsto`, não `pendente` (C3, abaixo), e por isso também
    não bloqueia nada.
- **C5, Registro de decisão (11/10/2026), "em conferência até a decisão".**
  - *O texto:* o ROADMAP (M8.2) diz "reserva em conferência até a decisão da disputa"; a decisão de 7/10 diz "registra a
    disputa e avisa, sem descontar de ninguém, até a decisão registrada; com a decisão, … débito pendente durante a
    disputa … o desconto fica segurado no repasse durante a disputa".
  - *A leitura do desenho:* "a decisão" é a decisão de quem arca, registrada pela equipe. Com ela, a parte da reserva
    volta às regras de sempre e só o valor de quem arca fica segurado até o resultado.
  - *Motivo:* segurar a parte inteira por até 6 meses depois de a equipe já ter decidido quem arca contradiz "o desconto
    fica segurado no repasse durante a disputa".
  - *Em aberto:* Diego confirma (decisão 14).
- **Calendário:** nada muda sozinho. A reserva continua confirmada, as noites continuam ocupadas e nada vai ao Beds24.
- **Disputa com a estadia por vir** (o titular não reconheceu o pagamento antes da entrada; pode ser fraude): aviso de
  atenção no Início, "Disputa do pagamento da reserva SCL-… com entrada em dd/mm: não libere a entrada antes de falar
  com quem cuida do financeiro." e a ação "Cancelar a reserva contestada" (abaixo).
- **Escalada no Início:** parte presa há mais de 15 dias (`DIAS_ESCALADA_CONTESTACAO`) sobe de tom: "R$ 4.846,02 da
  parte do proprietário presos há 15 dias por uma disputa de R$ 200,00 (reserva SCL-…): registre quem arca."
- **Cancelamento.**
  - `montarDecisao` continua recusando com contestação em curso (pela regra acima). O texto `TEXTO_CONTESTADO` passa a
    ser "Disputa do pagamento em curso: o cancelamento pela política espera o resultado (o dinheiro pode voltar ao
    hóspede por ela). O pedido do hóspede pode ser registrado: vale pelo horário em que chegou. Antes da entrada, use
    'Cancelar a reserva contestada'."
  - O pedido registrado pela equipe continua aceito (`registrarPedidoDeCancelamento`).
  - Depois de `ganha`, o pagamento volta à situação de antes e o cancelamento segue a política com o momento do pedido.
    Com o pagamento acima de 78 dias, a devolução segue as regras de sempre do M8.2c (painel do Mercado Pago, registro de
    recusa, por fora): o texto aponta esses caminhos, nunca "Pedir de novo".
  - Depois de `perdida`, recusa nova `contestacao_perdida`: "O pagamento desta reserva foi perdido numa disputa: o valor
    já voltou ao hóspede por ela. Não se cancela pela política; corrija com um ajuste."
- **Cancelar a reserva contestada (sem devolução pelo sistema)** (★ decisão 6).
  - Só antes do horário de entrada, com uma linha não final e valor em risco maior que zero num pagamento da reserva;
    `reserva:editar` e `financeiro:editar`; `BotaoConfirmar` e nota obrigatória.
  - Grava um cancelamento com o motivo `contestacao` (quem cancela: a SCL), sem decisão pela política: a reserva fica
    `cancelada` com `valor_retido` = o pago dos pagamentos da reserva menos o devolvido realizado, e **nenhuma devolução
    é criada** (o dinheiro volta ao titular pela disputa, se ele ganhar). O motor divide o retido como no M8.2c ("Dinheiro
    retido (sem devolução)").
  - Mesmas recusas do M8.2c que não dependem da política: parte num repasse ainda a pagar, devolução com chave em voo,
    tentativa em andamento, nota com dado pessoal.
  - Entra no Início a tarefa "reabra as datas nas OTAs" do M8.2c; a página do hóspede mostra `cancelada_em_conferencia`.
  - A disputa segue igual: perdida, a decisão de quem arca vale sobre o valor perdido; ganha, o banco deu a cobrança por
    válida e o retido continua dividido como numa reserva cancelada sem devolução.
  - **Registro de decisão (11/10/2026).** *Antes* (M8.2c, "A regra", item 1): "A SCL cancela → integral, em qualquer
    prazo… a SCL nunca fica com o dinheiro de uma reserva que ela cancelou". *Agora:* o cancelamento por disputa do
    pagamento é outra rota, sem devolução pelo sistema. *Motivo:* a devolução pelo sistema pagaria o hóspede duas vezes
    (a devolução e a disputa); o caminho do dinheiro é a disputa. *Alternativa* (decisão 6): cancelar com direito
    integral e a devolução substituída pela disputa (abaixo), pedida só se a SCL ganhar.
- **Alteração.**
  - `conferirReserva` continua recusando com contestação em curso. `TEXTO_CONTESTADO_ALTERACAO` passa a ser "Disputa do
    pagamento em curso: a alteração espera o resultado." Depois de `perdida`, recusa `contestacao_perdida`.
  - Alteração segurada quando a disputa abre: `aplicarNaTransacao` confere os pagamentos de novo (pela regra em curso) e
    recusa com `alteracao_nao_aplicada:contestado`. A diferença paga fica "aprovado sem reserva", para devolver (regra do
    M8.2d).
- **Minha reserva.** Hoje o botão "Pedir o cancelamento" some sem explicação (`todosAprovados` falso). Passa a mostrar a
  frase editável `pagamentoEmConferencia` e "Para cancelar, fale com a equipe.", sem botão.
- **Devoluções do mesmo pagamento.**
  - **Pedida sem aceite, ou recusada, de origem `cancelamento`, `alteracao` ou `sem_reserva`:** quando a disputa abre,
    para como hoje (`pararDevolucao`, recusada, `devolucao_parada`, motivo "o pagamento está em disputa") e fica
    **substituída pela disputa** (`devolucoes_pagamento.contestacao_id`, evento `substituicao`, auditoria
    `pagamento.devolucao_substituida`). O valor dela (`substituido`) sai do valor em risco: o acerto do cancelamento ou da
    alteração já o tirou do resultado, e a disputa é o caminho por onde o dinheiro volta ao hóspede.
    - Perdida: a devolução é **confirmada pela disputa** (`confirmada_por = 'contestacao'`) pelo menor entre o valor dela
      e o valor perdido, sem saída de caixa própria (o caixa é o da disputa) e com o caminho de sempre da taxa que não
      voltou (`taxa_perdida_desconhecida`; a taxa do reembolso fica com a SCL, como no M8.2c e no M8.2d). Menor que o
      valor dela: o aviso `devolucao_a_menor` (D15) e "Devolver o restante ao hóspede".
    - Ganha ou sem efeito: a substituição acaba (o vínculo fica no histórico) e a devolução volta a ser devida, recusada,
      com o aviso "A SCL ganhou a disputa: a devolução de R$ X que a reserva deve ao hóspede continua devida" e os
      caminhos de sempre (pedir de novo até 78 dias; depois, painel do Mercado Pago ou por fora).
  - **Aceita ou com a chave em dúvida:** continua esperando a leitura (nunca para), sem substituição.
  - **Realizada** (confirmada, por fora, ou o reconhecido devolvido fora) com uma disputa no mesmo pagamento: aviso
    `contestacao_com_devolucao`, "O hóspede pode receber duas vezes: a devolução de R$ X (dd/mm) e a disputa de R$ Y. Envie
    o comprovante da devolução ao Mercado Pago como defesa e confira quanto ele debitou." O valor em risco não desconta a
    devolução realizada (o Mercado Pago retém o que está em disputa).
  - Depois de `ganha`: "Pedir a devolução de novo" volta a valer (até 78 dias; depois, os caminhos acima).
  - Depois de `perdida`: pedir de novo, pedir o restante (fora o da substituída, acima) e por fora são recusados
    (`contestacao_perdida`).
- **Liberação.**
  - **Com contestação não final ou perdida, a liberação nunca é lançada sozinha.** A leitura que mostra `liberado = true`
    liga `contestacao_liberacao_lida`: "O Mercado Pago mostra a liberação de um pagamento em disputa: registre a liberação
    à mão com o líquido do pagamento que caiu na conta." Corrige a lacuna de hoje: o ramo que, num `contestado` com
    desfecho `reserva`, gravava `liberacao_confirmada_em` sem recebimento.
  - **A liberação à mão é aceita sob disputa** (`registrarLiberacaoManual` deixa de recusar `contestado` quando a
    contestação explica a situação): lança o recebimento com o líquido informado, como sempre. O retido da disputa é
    outra linha (abaixo). Assim o caixa registra a parte que entrou, inclusive numa disputa de parte do valor antes da
    liberação, e o atraso do livro (prévias, parcelado, as 6 h da rotina) nunca deixa a entrada e a saída fora dele.
  - A taxa lida durante a disputa não muda a reserva (o líquido informado pode vir reduzido pela disputa: item 73);
    diferente da conhecida = o aviso `taxa_divergente` de sempre.
  - `estornarLiberacaoManual` recusa enquanto houver retido realizado da disputa: "A disputa do pagamento já tem o débito
    do Mercado Pago confirmado contra esta liberação: corrija com um ajuste."
  - Depois de `ganha`, a leitura volta a lançar sozinha. `precisaFinanceiro` usa a situação explicada
    (`contestacaoDaLeitura`), então a Payments API volta a ser lida mesmo com a order ainda em `charged_back/*`. Ganha sem
    recebimento e sem sinal: aviso `contestacao_ganha_sem_recebimento` ("registre a liberação à mão quando o dinheiro
    cair") e o formulário de "Ganhou" oferece registrar a liberação ali mesmo (data e líquido, as mesmas regras de
    `registrarLiberacaoManual`, sob a mesma trava).
  - `liberacaoVencida` e a releitura de 6 em 6 horas ignoram só os pagamentos com contestação `aberta` ou `a_confirmar`;
    a ganha volta a ter o aviso de liberação vencida.

### Quem arca: a decisão da equipe

"Registrar quem arca" (`registrarDecisao`) fica no quadro da disputa, com a situação `aberta`, `a_confirmar` ou `perdida`
sem decisão, e valor em risco (ou perda a dividir) maior que zero. Disputa que só substitui uma devolução já lançada
(valor em risco 0) não pede decisão: o quadro diz "A disputa cobre a devolução que a reserva já devia ao hóspede: nada a
dividir."

- **Causa** (`CODIGOS_CAUSA_CONTESTACAO`, códigos fixos; nome e frase editáveis em Configurações → Pagamento no site,
  auditados). Texto-base:
  - `imovel`: "Problema do imóvel (estrutura, equipamento ou obra do proprietário)";
  - `scl`: "Falha da SCL (atendimento, limpeza, entrada, manutenção combinada)";
  - `cobranca`: "Falha na cobrança (valor errado, cobrança em dobro, devolução que não saiu)";
  - `fraude`: "Pagamento não reconhecido (cartão de terceiro, golpe ou fraude)";
  - `outro`: "Outro".
- **Quem arca** (`QUEM_ARCA_CONTESTACAO`):
  - `proprietario`: O proprietário;
  - `scl`: A SCL;
  - `proporcional`: Cada um na proporção da sua parte (sem como separar).
- **Nota obrigatória** (até 300, `textoSemDadosPessoais`), nunca mostrada ao proprietário.
- **Explicação ao proprietário** (opcional, até 300, `textoSemDadosPessoais`): mostrada no extrato, no PDF e no e-mail,
  ao lado da causa. Depois da decisão, o quadro oferece um "Texto para o proprietário" pronto para copiar (causa, valores,
  o que acontece em cada resultado), sem envio automático.
- **O sistema nunca escolhe.** O formulário começa sem nada marcado. Cada causa mostra a frase da regra (editável):
  - imóvel → "pela regra de 7/10, o proprietário";
  - falha da SCL ou falha na cobrança → "pela regra de 7/10, a SCL";
  - pagamento não reconhecido → pela verificação do banco já explicada em Configurações → Pagamento no site:
    `tres_ds_status = AUTHENTICATED` → "o hóspede passou pela verificação do banco: a responsabilidade costuma passar à
    bandeira; espere o resultado antes de decidir"; nos outros casos → "pela regra da verificação do banco (Configurações
    → Pagamento no site), a SCL"; no Pix → "decida e registre o motivo";
  - outro → nenhuma ("decida e registre o motivo").

  Uma escolha diferente da frase é aceita (a equipe decide) e repetida na pergunta de confirmação. "O proprietário" numa
  causa `fraude` pede confirmação reforçada: "A regra da verificação do banco, mostrada quando o cartão foi ligado, diz
  que fica com a SCL. Confirma que o proprietário arca?"
- **Fatos ao lado do formulário:**
  - valor em disputa, valor em risco (com a conta), datas e prazo dos documentos;
  - a estadia (já aconteceu ou por vir) e, nas datas dela, as limpezas e manutenções do imóvel (das telas de sempre);
  - quanto o proprietário já recebeu da reserva;
  - a verificação do banco do pagamento: `tres_ds_status` congelado na abertura e o modo `tres_ds`. `ATTEMPTED` mostra
    "verificação tentada: se passa a responsabilidade é pergunta ao Mercado Pago" (item 65);
  - a cobertura (`coverage_applied`, `coverage_eligible`), com "pela página atual do Mercado Pago, a cobertura aplicada
    é o resultado; o sentido está a conferir";
  - a documentação;
  - se o proprietário já aceitou uma versão do "Como funciona" com a seção "Contestações de pagamento" preenchida; sem
    isso, o aviso (sem bloquear): "O proprietário ainda não aceitou um 'Como funciona' que fale de disputas do
    pagamento."

  Nenhum desses fatos muda a decisão sozinho.
- **Prévia:** para cada opção, o débito de cada lado (`dividirPerda`) e o que o proprietário e a SCL ficam da reserva
  (com o resultado perdido e com o ganho).
- **Confirmação:** `BotaoConfirmar`, com a pergunta montada pelo domínio (`perguntaDaDecisao`): causa, quem arca, os dois
  valores, "o valor do proprietário fica segurado nos próximos repasses até o resultado" e, sem resultado ainda, "volta
  no repasse seguinte se a SCL ganhar a disputa".
- **Versão e assinatura** (como no M8.2c): o formulário leva `decisaoVersao` e a assinatura das entradas de
  `dividirPerda` (valor em risco, D, C, quem arca). Sob a trava: versão diferente → "A decisão mudou desde que você abriu
  a tela: confira de novo."; assinatura diferente → `contestacao_previa_mudou`. "Registrar" só com a versão 0; "Mudar"
  só com a versão 1 ou mais.
- **A proporção** (`dividirPerda(valor, D, C)`, pura):
  - proprietário = arredondamento de `valor × D / (D + C)` (meio centavo para cima); SCL = `valor` − proprietário. A
    soma é sempre exata.
  - D e C são as **partes efetivas** da reserva: as somas em vigor de `direito_proprietario` e `comissao` de origem
    `motor` e `cancelamento` (os espelhos), todos os meses, congeladas na decisão em `base_parte_proprietario` e
    `base_comissao`.
  - Com a base líquida de hoje (a taxa sai antes da divisão), D + C = valor − taxa: cada um arca com a taxa na sua
    proporção, como na comissão. Com a base bruta, a taxa fica com a SCL. Uma regra só: `regras.base`.
  - Se um recálculo depois mudar D ou C, o débito não muda (vale a data da decisão). O quadro **calcula na leitura** se
    a base congelada difere da atual e diz "A divisão da reserva mudou depois da decisão: mude a decisão se quiser."
    O motor e o recálculo nunca gravam em `contestacoes_pagamento` (ordem das travas, abaixo).
  - `proprietario` = o valor inteiro com o proprietário; `scl` = o valor inteiro com a SCL.
- **Recusas:**
  - `proprietario` e `proporcional` numa reserva sem proprietário nas linhas do motor (`sem_calculo`); `scl` é sempre
    aceito;
  - `proporcional` com D + C = 0 (reserva cancelada com devolução integral: "não há partes para dividir: escolha a SCL
    ou o proprietário");
  - nota ou explicação com dado pessoal;
  - contestação `ganha`, `perdida` com decisão, `sem_efeito`, ou possível duplicata ainda não confirmada;
  - versão ou assinatura diferentes (acima);
  - trava ocupada (`ocupado`).
- **Pagamento sem reserva** (aprovado sem reserva, a devolver, que é disputado): não há proprietário, então não há o que
  escolher. O formulário não aparece. O quadro diz "Pagamento sem reserva: não há proprietário; a perda, se houver, é da
  SCL", e a confirmação do resultado faz o resto (abaixo).
- **Mudar a decisão** ("Mudar quem arca", nota obrigatória "por que mudar"):
  - só antes do resultado; sobe `decisao_versao`;
  - lança só a diferença de cada lado, no mês corrente, numa transação, com a auditoria `contestacao.decisao`
    [antes, depois] (códigos e valores, nunca a nota).
  - Depois do resultado, a decisão não muda pelo sistema: "A disputa já terminou: corrija com um ajuste, que fica
    registrado."
  - `perdida` sem decisão aceita a primeira decisão, que nasce definitiva.
- **O valor em risco mudou depois da decisão** (a leitura trouxe o valor do caso, uma devolução substituída, outra
  disputa confirmada): aviso `contestacao_valor_mudou` ("O valor em disputa mudou de R$ A para R$ B: o valor segurado
  continua R$ C") com a ação pronta "Atualizar o valor segurado" (`financeiro:editar`, mesma causa e quem arca, versão
  n+1, a diferença de cada lado no mês corrente). O sistema nunca muda o segurado sozinho.

### Dinheiro e livro

**C3, Registro de decisão (11/10/2026), "débito pendente".**
- O texto do ROADMAP fala em débito pendente. No livro ele é `previsto`, não `pendente`.
- *Motivo:* `pendente`, no livro, é "acerto pendente" (sem proprietário, quem recebe a confirmar). Ele bloqueia o
  fechamento (`lancamentoEmConferencia`) e aparece no Início com o texto "falta proprietário ou confirmar quem recebe do
  canal".
- O "pendente" da disputa é a linha `previsto` mais a situação da contestação (aberta = pode voltar).

**Meses e datas.**
- As linhas de resultado (proprietário e SCL) têm origem `contestacao_pagamento` e competência no **mês corrente em São
  Paulo** (nunca o passado: mês fechado e relatório enviado não mudam).
- As linhas de caixa (retido, volta, caixa final; valor 0, só `montante`) seguem o padrão da saída do caixa da devolução
  do M8.2c e da liberação à mão: competência = data de caixa = o dia do fato (o débito, a volta), nunca no futuro. O
  retido previsto, sem data de caixa, tem a competência do dia da abertura.
- Nenhuma linha muda de estado num mês anterior: a perda definitiva da SCL nasce no mês corrente, ao lado do espelho da
  prevista (abaixo), em vez de `mudarEstado`.
- **Chaves:** todas começam com `mercadopago:<pagamento>:contestacao:<contestação>:` (e nunca contêm `recebimento`), e
  por isso herdam os bloqueios que já existem para o dinheiro do site: `estornarRecebimento` e `Recebimentos.tsx` não
  estornam, `temRecebimentoManual` ignora, `estornarDespesa` recusa (com o texto próprio `ERRO_DESPESA_DA_CONTESTACAO`:
  "Esta despesa é da disputa do pagamento da reserva SCL-…: corrija pelo quadro da disputa."). Idempotência pela chave e
  por `decisao_versao`.

**Travas**, na ordem única: imóvel → reserva → cotação → tentativas → devoluções → cancelamento ativo → alterações →
**contestações dos pagamentos da cotação (por id, `FOR NO KEY UPDATE`)** → motor da reserva (`travarMotorDaReserva`) →
livro. `travarCotacao` passa a tomar as contestações depois das alterações (o retrato `Travado` ganha `contestacoes`).
`aplicarLeitura` já roda sob essa trava. **Toda gravação** em `contestacoes_pagamento` e `eventos_contestacao` acontece
só dentro de `travarCotacao`, recalculando na mesma transação a união dos avisos do pagamento; nada de UPDATE em massa
como o `avisarForaDoPrazo` (os avisos de prazo são gravados linha a linha, sob a trava). O motor nunca mexe nessas linhas
(a origem não é `motor`) e o recálculo nunca grava nelas.

**Valor em risco** (`valorEmRisco`, pura, gravado em `valor_em_risco` a cada mudança). É o que o débito pendente usa na
decisão:

`valor em risco = máx(0, mín(contestado, pago − soma dos valores em risco das outras disputas não finais e não duplicadas
do pagamento) − substituído)`

- **contestado:** o valor lido (ou registrado pela equipe); ilegível = o pago, com o aviso.
- **substituído:** a soma das devoluções do pagamento substituídas por esta disputa (acima): o que o cancelamento ou a
  alteração já tirou do resultado e o hóspede ainda não recebeu.
- **Devolução já realizada não desconta** (o Mercado Pago retém o que está em disputa): o aviso
  `contestacao_com_devolucao` mostra os dois valores.
- **Entrou ou não entrou** não muda o valor em risco: isso só se decide no resultado (`liquido_nao_entrou`, abaixo), pelo
  sinal de liberação do provedor ou pela equipe.

**O retido** (a disputa no caixa):
- **Na abertura:** linha `devolucao`, `montante` = valor em risco, `valor` 0, **`previsto`**, sem data de caixa, "Valor
  em disputa bloqueado pelo Mercado Pago (a confirmar)", chave `…:retido`. Atualizada (estorno e linha nova, `#N`)
  quando o valor em risco muda antes de ser confirmado.
- **"Confirmar o débito do Mercado Pago"** (`financeiro:editar`, data e valor, nota quando o valor difere): o retido vira
  `realizado` com a data e o valor confirmados (valor diferente: a prevista é estornada e nasce a realizada, `#N`).
- **MED (e reclamação) que a leitura mostra como devolução:** o retido nasce `realizado`, com o valor da disputa, no dia
  em que a leitura viu a devolução (`devolvido_visto_em`): é fato lido.
- Antes da decisão, o retido é o único lançamento da disputa; nada é lançado para ninguém.

**Lançamentos por momento** (`lancarContestacao`, sob as travas):

| Momento | Proprietário (parte negativa) | SCL (perda) | Caixa |
|---|---|---|---|
| Abertura | nada | nada | retido `previsto` (acima) |
| Débito confirmado | nada | nada | retido `realizado` na data do débito |
| Decisão (versão 1) | `direito_proprietario` com valor e efeito `−x`, `previsto`, "Disputa do pagamento da reserva SCL-…: R$ x segurado dos seus próximos repasses até o resultado", chave `…:proprietario:v1` | `despesa_empresa` com valor `−y` e `montante` `y`, `previsto`, sem data de caixa, categoria `categoriaDaContestacao`, `reservaId`, "…: perda prevista da SCL", chave `…:scl:v1` | nada |
| Mudança ou valor atualizado (versão n) | a diferença `−(xₙ − xₙ₋₁)`, chave `…:proprietario:v<n>` | a diferença, chave `…:scl:v<n>` | nada |
| Ganha | reversão `+Σx`, chave `…:proprietario:reverte` | espelho `+Σy` (`previsto`), chave `…:scl:reverte` | retido realizado → volta: `recebimento` com `montante` = o retido realizado, `realizado`, no "dia em que o dinheiro voltou" (padrão: a data do resultado), chave `…:volta`; retido previsto → estornado |
| Perdida | o ajuste `xF − Σx`, chave `…:proprietario:final` (nada com 0) | espelho `+Σy` (`previsto`), chave `…:scl:espelho`, e a perda definitiva `−yF`, `realizado`, sem data de caixa, chave `…:scl:final` | retido previsto → estornado; caixa final = `valor perdido − líquido que não entrou − retido realizado`: saída (se > 0) ou entrada (se < 0) na data do débito, chave `…:caixa_final` |
| Tarifa (ganha ou perdida, opcional) | nada | `despesa_empresa` `realizado` com data de caixa, chave `…:tarifa` | a própria despesa |

- Nada é lançado com valor 0.
- **Na perda** (`acertoDaPerda`, pura): a perda a dividir = `valor perdido − o que confirmou a devolução substituída`;
  `xF` e `yF` = `dividirPerda(perda a dividir, D, C)` congelados (ou o valor inteiro de um lado), comparados sempre com o
  **já lançado** (Σx, Σy), nunca com o valor em risco recalculado. Exemplo: exposição 100.000 (proprietário 85.000, SCL
  15.000), depois uma devolução realizada de 20.000 e a equipe confirma 80.000 perdidos → proprietário `xF` = 68.000,
  ajuste +17.000; SCL `yF` = 12.000.
- **Líquido que não entrou** (`liquido_nao_entrou`): preenchido com o líquido do pagamento quando não há recebimento em
  vigor (o Mercado Pago não liberou), e 0 quando há; a equipe corrige. Contestação integral antes da liberação, com
  taxa de 3.980: valor perdido 100.000, não entrou 96.020, retido realizado 0 → saída de 3.980 (a taxa que o Mercado Pago
  cobrou; se não cobrou, a equipe confirma 96.020 perdidos e não há saída).
- **Tarifa** (`tarifa`, opcional no "Ganhou" e no "Perdeu"): uma tarifa do Mercado Pago pela disputa (item 64), sempre
  despesa da SCL (decisão 13), na categoria da contestação.
- `lancarAcertoDoProprietario` (`repasses/descontos.ts`) generaliza `lancarDescontoDoProprietario`: recebe a origem
  (`cancelamento` ou `contestacao_pagamento`) e o valor com sinal (o débito é negativo; a reversão, positiva), com a
  mesma regra da competência no mês corrente. `lancarDescontoDoProprietario` continua para o M8.2c, sem mudança de
  comportamento.
- A reversão e os ajustes são **espelhos no mês corrente**, nunca `estornar`: o estorno herda a competência do original e
  mexeria num mês que pode estar fechado. O padrão é o dos espelhos do M8.2c. O retido previsto (sem caixa, sem
  resultado) é a exceção: sai por estorno, porque nada se moveu.
- **Despesas:** as linhas `despesa_empresa` com o prefixo da disputa saem de `totaisDespesas.aPagar` e não têm "Marcar
  como paga" nem "Estornar"; `marcarDespesaPaga` e `estornarDespesa` recusam (`ERRO_DESPESA_DA_CONTESTACAO`). A lista
  diz "Perda por disputa do pagamento (prevista até o resultado): acompanhe no quadro da disputa", e depois "definitiva
  (disputa perdida em dd/mm)" ou "revertida (disputa ganha em dd/mm)". Sem isso, "marcar paga" tiraria do caixa uma
  segunda vez o que o retido já tirou, e um estorno consumiria a chave e a perda nunca ficaria definitiva.

**O valor segurado no repasse** (C4; uma regra, um lugar: `classificarParte`, com `ehLinhaDeContestacao` e o SQL gêmeo
na lista de partes). Todas as linhas do proprietário de uma disputa seguem a parte dele na mesma reserva:
- **alguma parte da reserva ainda não repassada está "a liberar"** (conferência, check-in por vir, dinheiro que não
  entrou): as linhas ficam "a liberar" junto, com o motivo "segurado junto com a sua parte desta reserva, até o
  resultado". Nada sai de outros repasses, e o proprietário nunca fica com a parte presa e o valor descontado ao mesmo
  tempo;
- **as partes da reserva já foram repassadas, ou estão disponíveis:** as linhas ficam disponíveis e o próximo repasse de
  qualquer tipo as leva. Fica retido exatamente o valor do proprietário.
- As partes que não cobrem: o antecipado espera e o fechamento mostra que o proprietário fica devendo. O texto de
  `gerarAntecipado` passa a falar de "desconto" de cancelamento ou de disputa.
- **Ganha:** a reversão `+Σx` segue a mesma regra. Se o débito já tinha saído num repasse, o valor volta no próximo. Se
  não, as duas linhas entram juntas e somam zero.
- **Perdida:** o rótulo passa de "segurado" a "definitivo". A linha não muda; o ajuste, se houver, entra no mês corrente.
- **Repasse, e-mail e fechamento** reconhecem as linhas da disputa (ramo `contestacao`, um teste de cada):
  - `descricaoDoItem`: "valor segurado pela disputa do pagamento (até o resultado)", "desconto definitivo da disputa do
    pagamento" ou "valor segurado devolvido (a SCL ganhou a disputa)";
  - `separarAntecipado`: uma linha própria, "Disputa do pagamento" (o débito e a reversão), fora de "Desconto de reserva
    cancelada" e de "Noites de meses seguintes";
  - `itensDoRepasse`: as linhas da disputa não são "outras partes" da reserva (`ne(origem)` também para
    `contestacao_pagamento`), e a parte verdadeira não vira "parcial" por causa delas;
  - o aviso de `foraDoFechamento` e o e-mail: o motivo "reserva em conferência: disputa do pagamento" (C2).
- **Aviso do Início:** `avisosDeDescontos` continua só para o desconto de cancelamento. As linhas da disputa têm aviso
  próprio em `avisosDeContestacao`, só para as classificadas "disponível" e ainda não descontadas há mais de 7 dias
  ("as partes disponíveis não cobriram"); a que espera junto com a parte não é aviso.
- Estornar um repasse que levou uma linha de disputa segue a regra do M8.2c para o desconto ("…estornar o repasse
  deixaria o desconto sem o pagamento. Corrija com um ajuste."). O repasse que só leva a linha pode ser estornado.

**O dinheiro com a empresa** (`recebidoPorReserva`, a regra única de `dinheiroComAEmpresa`):
- Enquanto a disputa não é `perdida` com os lançamentos definitivos, as linhas de caixa dela (retido, volta, caixa final)
  não contam. Quem segura a reserva nesse tempo é a regra da disputa acima: sem isso, a parte ficaria presa duas vezes.
- **Perdida e com os lançamentos definitivos:** contam o retido realizado e o caixa final, e `perdaCoberta` = `valor
  perdido`. A condição passa a ser `recebido + perdaCoberta ≥ devido`. A identidade fecha nos três caminhos: liberado
  (95.020 − 100.000 + 100.000 = 95.020), não liberado (0 − 3.980 + 100.000 = 96.020) e disputa de parte do valor
  (96.020 − 30.000 + 30.000).
- As somas dos recebimentos de um pagamento (`recebimentosDoPagamento`, `liberacoesDoSiteComAlvo`) já procuram só
  `mercadopago:<pagamento>:recebimento`: as chaves da disputa ficam de fora sem mudança.

**Casos.**
- **Disputa de parte do valor:** o valor em risco é o contestado. A parte não contestada entra no livro pela liberação à
  mão (acima); o retido é só o valor em disputa.
- **Depois de uma devolução de parte do valor (M8.2d):** o valor em risco não desconta a devolução realizada; aviso
  `contestacao_com_devolucao`. A equipe confere quanto o Mercado Pago debitou e confirma o valor perdido.
- **Pagamento já devolvido por inteiro e contestado:** a linha nasce (com a marca `contestacao_com_devolucao`, sem mudar
  a situação do pagamento), o valor em risco é o contestado e, numa reserva cancelada com devolução integral, D + C = 0:
  a escolha é `scl` ou `proprietario`. Se o Mercado Pago debitar, o retido e o caixa final registram a saída.
- **Vários pagamentos na reserva** (reserva e diferença, M8.2d): uma disputa por pagamento, a proporção da reserva e o
  valor em risco do pagamento disputado. O cancelamento e a alteração recusam com qualquer pagamento da reserva em curso.
- **Juros do parcelamento:** se o valor contestado inclui os juros, a proposta mostra os dois números
  (`contestacao_valor_acima`) e a equipe confirma o que saiu da conta.
- **Taxa:** se a taxa do Mercado Pago volta numa disputa perdida, e se há tarifa por disputa, não se sabe (item 64). A
  confirmação do valor perdido, do líquido que não entrou e da tarifa é o lugar de corrigir.
- **Pagamento sem reserva:** na perda confirmada, desfecho `contestacao` ("o dinheiro voltou ao pagador pela disputa").
  O valor perdido proposto é a taxa do pagamento: o dinheiro dele nunca entrou no livro, e o que a SCL perde é a taxa,
  salvo se o Mercado Pago a devolver. Ela vira despesa da empresa, `realizado` com data de caixa, chave `…:taxa`. A
  devolução `sem_reserva` substituída é confirmada pela disputa. As ações de devolução desse pagamento param.

**Exemplos** (cartão, comissão de 15%, base líquida; com a taxa saindo antes da divisão, o proporcional dá 85% para o
proprietário e 15% para a SCL).

1. **Liberado na hora (4,98%), parte já repassada, proporcional, perdida.**
   - Reserva de R$ 1.000,00 com taxa de R$ 49,80: base R$ 950,20, comissão R$ 142,53, parte R$ 807,67. Estadia em
     10/11–14/11; parte repassada no fechamento de 02/12.
   - 15/12, disputa de R$ 1.000,00: retido previsto de R$ 1.000,00 ("bloqueado, a confirmar"). Nada descontado.
   - 16/12, a equipe confirma o débito do Mercado Pago (16/12, R$ 1.000,00): o retido vira realizado.
   - 18/12, decisão proporcional: em dezembro, proprietário −R$ 850,00 (segurado; sai do próximo repasse) e SCL
     −R$ 150,00 (perda prevista).
   - 10/03, perdida, R$ 1.000,00: caixa final 0; as linhas do proprietário ficam definitivas; em março, o espelho
     +R$ 150,00 e a perda definitiva −R$ 150,00 da SCL.
   - Final: proprietário −R$ 42,33 (807,67 − 850,00) e SCL −R$ 7,47 (142,53 − 150,00). Somam −R$ 49,80, a taxa perdida.
     O caixa confere: +950,20 − 1.000,00. Dezembro não muda.
2. **O mesmo, ganha em 10/03.**
   - Março: proprietário +R$ 850,00 (volta no próximo repasse), espelho +R$ 150,00 da SCL e volta de +R$ 1.000,00 no
     caixa.
   - Resultado igual ao de antes da disputa.
3. **Liberação em 30 dias (3,98%), disputa do valor inteiro antes da liberação, problema do imóvel, perdida.**
   - Taxa R$ 39,80, base R$ 960,20, comissão R$ 144,03, parte R$ 816,17.
   - 25/11, disputa aberta: retido previsto de R$ 1.000,00. A parte espera (conferência e liberação).
   - 26/11, o proprietário arca: novembro, −R$ 1.000,00, segurado junto com a parte (os dois esperam).
   - O Mercado Pago nunca libera. 15/02, perdida, R$ 1.000,00; não entrou R$ 960,20 (preenchido, sem recebimento): o
     retido previsto é estornado e o caixa final é a saída de R$ 39,80 (a taxa cobrada). A parte e o débito ficam
     disponíveis juntos e o próximo repasse leva −R$ 183,83 (816,17 − 1.000,00): a comissão e a taxa, que o
     proprietário cobre pela decisão 1.
   - Caixa −R$ 39,80; SCL +R$ 144,03; proprietário −R$ 183,83.
4. **Liberado, a SCL arca (cobrança em dobro), perdida.**
   - O proprietário mantém a parte de R$ 807,67.
   - A SCL lança −R$ 1.000,00 e fica com 142,53 − 1.000,00 = **−R$ 857,47**.
   - Caixa: −R$ 49,80 no total (+950,20 − 1.000,00).
5. **Disputa de R$ 300,00 antes da liberação (30 dias), falha na cobrança, perdida.**
   - Retido previsto de R$ 300,00. No dia 30, o Mercado Pago mostra a liberação: aviso; a equipe registra a liberação à
     mão (R$ 960,20) e confirma o débito de R$ 300,00. Caixa +960,20 − 300,00.
   - A SCL arca: −R$ 300,00. Perdida: caixa final 0; `recebido` 660,20 + 300,00 = 960,20, a parte de R$ 816,17 fica
     disponível depois do check-in. SCL 144,03 − 300,00 = −R$ 155,97. Se o Mercado Pago informar o líquido já sem os
     R$ 300,00, a equipe registra o que caiu e o débito em separado (item 73).
6. **Cancelamento integral com a devolução ainda não saída, depois a disputa, perdida.**
   - Reserva do exemplo 1, parte repassada. 05/12, cancelamento pela política, integral: o proprietário ganha o desconto
     de −R$ 807,67 e a comissão sai; a devolução de R$ 1.000,00 é pedida.
   - 08/12, antes de o pedido sair, a disputa abre: a devolução para e fica substituída pela disputa; valor em risco 0,
     sem decisão ("nada a dividir").
   - 10/03, perdida, R$ 1.000,00: a devolução é confirmada pela disputa (sem saída própria), o retido confirmado é a
     saída e a taxa que não voltou (R$ 49,80) é informada e lançada como despesa da SCL.
   - Final: proprietário −R$ 807,67 só pelo cancelamento (nada a mais), SCL −R$ 49,80, caixa −R$ 49,80. Se a SCL ganhar,
     a devolução volta a ser devida e segue os caminhos de sempre.

### Confirmar o resultado

"Confirmar o resultado" (`confirmarResultado`, `financeiro:editar`), com a situação `aberta` ou `a_confirmar`:
- **Campos:**
  - Ganhou ou Perdeu, **sem nada marcado** (C1), com os fatos do Mercado Pago em palavras ao lado;
  - data do resultado (entre a abertura e hoje);
  - no "Ganhou": o dia em que o dinheiro voltou (com o retido realizado), a tarifa (opcional) e, sem recebimento do
    pagamento, a liberação (data e líquido, opcional);
  - no "Perdeu": "Valor que a SCL perdeu" (preenchido com o valor em disputa, com a conta), "Quanto deste pagamento nunca
    entrou na conta" (preenchido, acima), "Dia em que o Mercado Pago debitou" (preenchido com o do retido) e a tarifa
    (opcional);
  - nota, obrigatória quando o resultado ou o valor diferem do que o Mercado Pago mostra, quando ele não mostra nada ("o
    Mercado Pago não informa o resultado: confirme pelo painel dele"), ou quando a leitura não deu.
- **Fase 0:** releitura (order, Chargebacks API e, depois dos 85 dias, Payments API), melhor esforço. Falhou ou trava do
  provedor fechada: segue só com a nota "não deu para conferir no Mercado Pago agora". Uma leitura bem-sucedida que
  mostra `in_process` **do mesmo caso** não recusa: pede a nota reforçada ("o painel do Mercado Pago já mostra o
  resultado") e a pergunta avisa; uma leitura depois que contradiga liga `contestacao_resultado_mudou`.
- **Fase 1, numa transação:** a situação, o pagamento (de volta à situação de antes na ganha, se ainda `contestado`), as
  linhas da tabela acima, a devolução substituída, o evento e a auditoria `contestacao.resultado`.
- **Assinatura**, como no M8.2c: o formulário leva `decisaoVersao` e a assinatura dos fatos (situação, estado combinado,
  valor em disputa, valor em risco, Σx, Σy, o retido e a versão). Mudou: `contestacao_previa_mudou`. Nunca entram na
  assinatura `consultada_em`, eventos, avisos ou lançamentos de outras origens da reserva (a própria fase 0 e a rodada
  do motor não invalidam a confirmação).
- **Perdida sem decisão:** a situação vira `perdida`, o caixa é acertado (retido, caixa final, tarifa, a devolução
  substituída) e, com perda a dividir maior que zero, a reserva continua em conferência, com o aviso de atenção
  "Disputa perdida sem decisão de quem arca"; a decisão depois nasce definitiva.
- **"Encerrar sem efeito"** (nota obrigatória; numa leitura `in_process` do mesmo caso, a nota reforçada):
  - só sem lançamentos definitivos;
  - espelha no mês corrente os lançamentos previstos do proprietário e da SCL, chave `…:sem_efeito:<lançamento
    original>` (repetir depois de uma falha não duplica);
  - o retido previsto é estornado; o retido realizado pede "o dia em que o dinheiro voltou" e lança a volta;
  - a devolução substituída volta a ser devida;
  - devolve o pagamento à situação de antes quando é a última disputa dele (e ele ainda está `contestado`).

### O que o hóspede vê

Nunca a palavra "contestação", nunca uma acusação, nunca "Beds24", nunca dado pessoal. Nenhuma mensagem automática nova e
nenhum modelo novo em Modelos de mensagem. A equipe fala com o hóspede caso a caso: uma mensagem automática sobre uma
disputa pode soar como pressão, e quem lê a página de uma reserva paga com cartão de terceiro pode nem ser o titular.

- **`/reservar/<código>`**, reserva confirmada com disputa em curso:
  - continua "Reserva confirmada";
  - **com o cookie do checkout** (`autorizadoNaCotacao`), ganha a linha editável `pagamentoEmConferencia` (Textos do
    site, texto-base "O pagamento desta reserva está em conferência com o Mercado Pago. Se tiver qualquer dúvida sobre a
    cobrança, fale com a nossa equipe.", até 240 caracteres; vazia = a linha não aparece). Sem o cookie (quem só tem o
    código, que circula no WhatsApp), nada muda: só "Reserva confirmada";
  - a linha some com o resultado.
- **Reserva cancelada** com pagamento em disputa (inclusive pela ação "Cancelar a reserva contestada"): o
  `cancelada_em_conferencia` de sempre (`cancelamentoEmConferencia`).
- **Minha reserva:** a mesma frase e "Para cancelar, fale com a equipe." no lugar do botão (acima).
- O botão de contato leva a mensagem de sempre da reserva.

### O que o proprietário vê

No portal, no extrato, no PDF e no e-mail do repasse. Nada do hóspede, nem a nota interna, nem o número do caso. Um
proprietário nunca vê a disputa de um imóvel que não é dele (`reservaDosDonos` e o `proprietario_id` das linhas da
reserva). **Nas linhas da disputa, só o código da reserva**, sem o nome do hóspede (as linhas de sempre da reserva não
mudam).

- **Reserva:** "Em conferência (disputa do pagamento)" enquanto não há decisão. O resumo do portal conta essa parte como
  "a liberar".
- **Extrato**, rótulo "Disputa do pagamento":
  - segurado (proporcional): "Disputa do pagamento da reserva SCL-…: R$ 850,00 segurados dos seus próximos repasses até o
    resultado — 85% do valor em disputa (R$ 1.000,00), a proporção da sua parte. Se a SCL ganhar a disputa, o valor volta
    no repasse seguinte. Causa registrada: [nome da causa]." e a explicação ao proprietário, quando há;
  - segurado (o proprietário arca com tudo): "…: R$ 1.000,00 segurados dos seus próximos repasses até o resultado — o
    valor em disputa inteiro, que inclui a comissão e a taxa do pagamento…";
  - definitivo: "…: desconto definitivo (a SCL perdeu a disputa em dd/mm).";
  - devolvido: "…: valor segurado devolvido (a SCL ganhou a disputa em dd/mm).";
  - junto com a parte presa: "segurado junto com a sua parte desta reserva".
- **Fechamento e e-mail do repasse:** a parte presa por disputa com o motivo "reserva em conferência: disputa do
  pagamento"; as linhas da disputa na linha própria "Disputa do pagamento" (acima).
- **Relatório mensal:** a linha da disputa é tratada como o espelho do cancelamento: sem componentes (bruto, taxa,
  comissão), sem noites, sem canal e sem data de pagamento, fora das métricas (receita, ocupação, receita por noite
  disponível), na variante `contestacao` (`"segurado" | "definitivo" | "devolvido"`) de `partesDoRelatorio`, com uma linha
  própria na conciliação (`relatorios/dinheiro.ts`: "Disputa do pagamento da reserva SCL-… (segurado | definitivo |
  devolvido)") e no resumo do portal (`portal/resumo.ts`). O mês já enviado não muda.
- **"Como funciona", versão 2** (Diego publica; seção "Contestações de pagamento", hoje vazia). Texto-base proposto para
  o GUIA, item 42:
  > Quando um hóspede contesta no banco uma cobrança de reserva paga pelo site, o Mercado Pago segura o valor até a
  > decisão do banco, o que pode levar alguns meses. Enquanto isso, a reserva fica em conferência: se a sua parte dela
  > ainda não foi repassada, ela espera; se já foi, nada é descontado até a equipe registrar quem arca. Arca quem deu
  > causa ao motivo da disputa: um problema do imóvel fica com você; uma falha da SCL ou na cobrança fica com a SCL; sem
  > como separar, cada um arca na proporção da sua parte. Com a decisão, o seu valor fica segurado nos próximos repasses
  > (de qualquer reserva sua) até o resultado: se a SCL ganhar, ele volta no repasse seguinte; se perder, o desconto fica
  > definitivo. Exemplo: numa reserva de R$ 1.000,00 em que a sua parte é R$ 807,67 e a da SCL R$ 142,53, uma disputa
  > perdida dividida na proporção desconta R$ 850,00 de você e R$ 150,00 da SCL; se o problema foi do imóvel, R$ 1.000,00
  > de você. Cada passo aparece no seu extrato.
- **Termos de uso, versão 2** (opcional; Diego decide): "Se não reconhecer uma cobrança ou tiver um problema com a
  reserva, fale com a gente antes de pedir ao seu banco para desfazer a cobrança: resolvemos mais rápido. Um pedido ao
  banco deixa o pagamento em conferência com o Mercado Pago até a decisão dele." A Política de privacidade já cobre
  "defender direitos em … contestações de pagamento": nada muda.
- Textos que ficam velhos e o PR atualiza:
  - a dica de `configuracoes/como-funciona.ts` e `FormComoFunciona.tsx` ("decisão ainda pendente");
  - `COMO-FUNCIONA-PROPRIETARIO.md` e `RECEBIMENTO-SITE.md` (pergunta 4);
  - o GUIA (seção 2, linha do M8; item 31);
  - o comentário de `CONTESTACAO_ABERTA` em `mercadopago.ts`.

### Painel

- **Quadro "Pagamento no site"** da ficha, um bloco **Disputa** por linha:
  - cabeçalho por tipo: "Contestação no cartão | Devolução pedida pelo Pix (MED) | Reclamação no Mercado Pago — aberta em
    dd/mm" (com "rodada 2" quando houver);
  - situação em palavras: aberta; "encerrada no Mercado Pago, resultado a conferir"; ganha; perdida; encerrada sem efeito;
  - o valor em disputa, o valor em risco (com a conta) e o número do caso (com botão de copiar, como os ids da linha "No
    Mercado Pago");
  - o que o Mercado Pago mostra: estado (com o código), documentação e prazo, cobertura e os códigos do motivo, com "o
    sentido está a conferir" onde vale;
  - a verificação do banco do pagamento;
  - a linha do tempo (`eventos_contestacao`, a mais nova em cima);
  - a decisão (causa, quem arca, versão, quem e quando; a nota e a explicação ao proprietário só para a equipe com o
    financeiro), e "a divisão da reserva mudou depois da decisão" quando vale;
  - os lançamentos de cada lado (segurado, definitivo ou revertido), o caixa (retido previsto ou realizado, volta, caixa
    final) e a devolução substituída, quando há;
  - os avisos.
- **Ações**, cada uma só quando o domínio permite e com `BotaoConfirmar`; o resultado volta por uma chave fixa
  (`?contestacao=`):
  - "Confirmar o débito do Mercado Pago" (data e valor);
  - "Registrar quem arca", "Mudar quem arca" e "Atualizar o valor segurado";
  - "Confirmar que é outra disputa" (na possível duplicata);
  - "Documentos enviados no painel do Mercado Pago" (com a data);
  - "Confirmar o resultado";
  - "Encerrar sem efeito";
  - "Conferir o aviso" (na linha final com `contestacao_resultado_mudou`; com "A disputa foi reaberta" só na ganha);
  - "Cancelar a reserva contestada" (antes da entrada);
  - "Conferir agora", o de sempre, que também relê as disputas daquele pagamento.
- **Prazo dos documentos:** "Envie os documentos pelo painel do Mercado Pago até dd/mm (faltam N dias); depois marque
  'Documentos enviados'." com o link para "Documentos para a defesa". Prazo desconhecido (null na leitura, ou registro sem
  prazo): aviso de atenção `contestacao_prazo_desconhecido`, "prazo dos documentos desconhecido: confira no painel do
  Mercado Pago e informe aqui", com o campo para informar (auditado). O envio pela API é uma vez por caso e o sistema não
  guarda arquivos (limites).
- **"Documentos para a defesa"**: uma página para imprimir (`reserva:editar` ou `financeiro:editar`), montada na hora, sem
  guardar nada: resumo da reserva (código, imóvel, datas, pessoas), o pagamento (ids, data, forma, verificação do banco),
  a política aceita (versão, horário e texto, de `PaginasLegaisAceitas`), a lista da portaria (M6.4, quando o imóvel
  exige) e o que o sistema não tem e a equipe junta por fora (a conversa com o hóspede, o registro de entrada e saída do
  prédio, fotos).
- **E-mail à equipe** (`avisarEquipePorEmail`, o mesmo do pedido de cancelamento; só o código da reserva e o imóvel): na
  abertura (leitura ou registro), ao entrar nos dias de aviso do prazo e no dia do prazo sem a marca. Uma vez cada
  (evento `email_equipe`).
- **Fora do quadro:** "Registrar disputa vista no painel do Mercado Pago" fica no quadro do pagamento.
- **Sem `financeiro:ler`:** "O pagamento desta reserva está em disputa ([tipo]): quem cuida do financeiro acompanha.", com
  a situação e o prazo, sem valores, e as ações de documentos.
- **Financeiro → Pagamentos do site:** filtro "Com disputa" (aberta, a confirmar, perdida sem decisão) e a coluna
  "Disputa". `desfechoEmPalavras` ganha "Reserva (pagamento em disputa)". Os textos "Contestado (tinha confirmado a
  reserva)" e "A contestação se resolve pelo painel do Mercado Pago" (`PagamentoNoSite.tsx`, página da lista) passam a
  apontar para o bloco.
- **Configurações → Pagamento no site:**
  - "Categoria da perda por disputa do pagamento", criada no primeiro uso e editável, como a da taxa perdida;
  - "Dias de aviso antes do prazo dos documentos" (padrão 5, de 1 a 15);
  - os nomes e as frases das causas (códigos fixos);
  - tudo auditado.
- **Início** (`avisosDeContestacao`, financeiro, empresa toda; "pede atenção" inclui os de atenção):
  - "N disputa(s) do pagamento sem decisão de quem arca: a parte do proprietário dessas reservas espera." (atenção), e a
    escalada depois de 15 dias (acima);
  - "Disputa da reserva SCL-…: documentos até dd/mm (faltam N dias)." (atenção dentro dos dias do aviso; antes,
    informativo); passado o prazo sem a marca: "o prazo dos documentos passou" (atenção); prazo desconhecido (atenção);
  - "N disputa(s) encerrada(s) no Mercado Pago com resultado a conferir." (atenção);
  - "Disputa perdida sem decisão de quem arca" (atenção);
  - a estadia por vir (acima, atenção);
  - o repasse a pagar com parte de reserva em disputa (acima, atenção);
  - possível duplicata, disputa ambígua, caso de outro pagamento, resultado que mudou e leituras em conflito (atenção);
  - ganha sem recebimento; dia 85 sem fonte; aberta há mais de 240 dias (atenção);
  - débito da disputa disponível e não descontado há mais de 7 dias (atenção).
  - O aviso de `situacaoInesperada` continua para o dinheiro sem reserva, com "(acompanhe a disputa pelo quadro do
    pagamento)".
  - O contador de lançamentos `pendente` do Início não conta nada da disputa (C3).

### Auditoria

- Ações:
  - `contestacao.registrar` (equipe), `contestacao.outra_disputa`;
  - `contestacao.debito` (valor e data confirmados);
  - `contestacao.decisao` (causa, quem arca, versão e os dois valores [antes, depois]; também a atualização do valor
    segurado);
  - `contestacao.documentos` e `contestacao.prazo`;
  - `contestacao.resultado` (resultado, valor perdido, não entrou, data do débito, tarifa);
  - `contestacao.sem_efeito`, `contestacao.conferir_aviso` e `contestacao.reabrir`;
  - `contestacao.cancelar_reserva` (com as do cancelamento);
  - `pagamento.devolucao_substituida` e `pagamento.devolucao_confirmada` (pela disputa);
  - `pagamento.situacao` (contestado → situação de antes, motivo `contestacao_ganha`);
  - as do livro (`lancamento.*`).
- A auditoria nunca copia notas nem a explicação ao proprietário.
- O que o sistema lê vai para `eventos_contestacao` com `usuario_id` null.

### Dados pessoais

**Contestação (M8.2e).**
- **Pode ser guardado:**
  - os ids do caso, da contestação (`CBK…`) e da transação;
  - códigos de listas fechadas, `reason_id` e o código do motivo, valores, datas e booleanos de cobertura;
  - o retrato de `tres_ds_status`;
  - ids de usuário e notas validadas (até 300 caracteres: registro, decisão, mudança, resultado, sem efeito, conferir o
    aviso, débito) e a explicação ao proprietário, também validada.
- **Nunca:**
  - nome, e-mail, telefone, CPF, chave Pix ou dados bancários e de cartão do hóspede ou do titular;
  - o `reason` em texto livre, a documentação (arquivos, endereços, descrições, uuids) e a resposta crua.
- Toda nota passa por `textoSemDadosPessoais`. A página "Documentos para a defesa" é montada na hora e nunca gravada.
- `semDadosPessoais` percorre também `contestacoes_pagamento` e `eventos_contestacao`, depois dos fluxos aberta → ganha,
  aberta → perdida, sem identificação → com caso, registro da equipe, MED, duplicata e reabertura. O teste do adaptador
  HTTP usa o JSON oficial com `reason` em frase, `documentation[].description` com e-mail e `references` com dado
  pessoal, e confere que nada sai normalizado.

### Testes a escrever (Vitest, PGlite, versão falsa; sem rede)

1. **Adaptador:**
   - `cobrancaDaOrder` lê `transactions.chargebacks[]` por lista branca: `CBK…`, `case_id` como texto e como número
     (inteiro seguro; 18 algarismos como número = null), status, `amount` como número e como texto; ignora
     `references`, `reason` e `documentation`; status estranho = desconhecido;
   - `consultarContestacao`/`buscarContestacoes`: `coverage_elegible`, prazo null, `id` texto, `payments` números, 404 →
     null, 403 → sem acesso, 401 → credencial, busca 404 lança, falha lança; `X-Caller-Id` conferido num `fetchImpl`
     espião; o id vem de `/users/me`;
   - `reason` com espaço nunca passa; `reason_id` só algarismos;
   - `situacaoDoPagamento` por lista branca;
   - o JSON oficial cheio de dados pessoais no cliente HTTP (acima);
   - a versão falsa ganha `MetodoProvedor` com os métodos novos, `respostaChargebacks: "403" | "404" | "falha"` por
     método, e os cenários: `contestar(id, como, { valor, idCaso, idCbk, documentacao, prazo, cobertura })`,
     `resolverContestacao(id, { estado, cobertura })`, `contestarTarde(idPagamento, …)` (só pela Chargebacks API, com a
     order apagada), `documentacaoDoCaso`, `casoDeOutroPagamento`, transação contestada sem lista que depois traz a
     lista, `reimbursed` com cobertura `false`, cobertura null → true/false, id como número e como texto.
2. **Casamento** (matriz de `casarContestacao`): N leituras = 1 linha e o evento só quando muda; sem id completada pelo
   caso; order antes da API e API antes da order; leitura final nunca cria linha; sem id com linha final = explicada;
   `in_process` sem id com só linhas finais = aviso; duas não finais + leitura sem id = ambígua; segunda disputa =
   possível duplicata com valor em risco 0; Σ ≤ pago; caso de outro pagamento recusado; o retrato do `tres_ds_status`.
3. **Ordem das leituras:** leitura iniciada antes da última aplicada descartada; `date_last_updated` mais velho
   descartado; fontes divergentes = aviso uma vez, sem oscilar; a confirmação da equipe nunca é desfeita por leitura velha.
4. **Situação do pagamento:** `contestado` durante a disputa; ganha → volta à de antes só se ainda `contestado`;
   devolução aceita confirmada no meio → fica `devolvido`; leitura `reimbursed` depois não a muda; caso novo
   `in_process` abre linha; o aviso `contestado` desligado; pagamento `devolvido` contestado não muda de situação.
5. **Em curso:** MED à mão num Pix aprovado e caso tardio só da API recusam o cancelamento, a alteração (também na
   aplicação segurada), o pedir de novo e o recebimento à mão; todos os testes crus usam `contestacaoDaLeitura`.
6. **Transições** (matriz de `transicaoDaContestacao`): finais não mudam; `contestacao_resultado_mudou`; "Conferir o
   aviso" limpa ou reabre (rodada 2 com o fluxo inteiro); sem efeito e resultado contra `in_process` só com a nota
   reforçada.
7. **Liberação sob disputa:** a lida não lança e liga o aviso (a lacuna de hoje corrigida); a à mão lança com o retido
   separado; o estorno da liberação recusado com retido realizado; ganha → lança na leitura seguinte, com a order ainda
   `charged_back/*`; ganha sem recebimento = aviso e liberação no próprio formulário; a liberação vencida volta na ganha.
8. **Conferência:** a parte não repassada fica a liberar até a decisão; a repassada não é descontada; valor em risco 0
   não segura; o fechamento não trava (as outras partes passam e a presa vai ao seguinte, com o motivo próprio); portal,
   rodapé, resumo e relatório mostram "em conferência (disputa do pagamento)"; o aviso do repasse a pagar.
9. **Decisão:**
   - permissões: só `financeiro:editar`; o proprietário (com `financeiro:ler`) na leitura da equipe = negado; dono de
     outro imóvel = não encontrada; id de outra organização = não encontrada; nota com dado pessoal recusada;
   - sem decisão, nada lançado para ninguém (só o retido);
   - `dividirPerda` (matriz: proprietário, SCL, proporcional com o arredondamento, a soma exata, base líquida e bruta,
     partes efetivas com espelhos);
   - D + C = 0 recusa o proporcional; `scl` sem proprietário aceito; pagamento sem reserva não tem formulário;
   - a frase da causa `fraude` pela verificação do banco e a confirmação reforçada;
   - a base mudou calculada na leitura (o motor não grava nada); recálculo simultâneo com uma decisão sem impasse;
   - versão e assinatura (duas abas; recálculo entre a prévia e o clique).
10. **Linhas pendentes:** chaves com o prefixo `mercadopago:…:contestacao:`; `previsto`; competência no mês corrente
    (virada de mês e de ano em São Paulo); repetir = as mesmas linhas; duas decisões simultâneas = uma versão.
11. **Segurado no repasse:** com a parte a liberar, as linhas esperam junto; com a parte repassada ou disponível, saem do
    próximo antecipado e do próximo fechamento; partes que não cobrem; o aviso de 7 dias só das disponíveis; estorno de
    repasse recusado; `descricaoDoItem`, `separarAntecipado`, `itensDoRepasse` e o e-mail com o ramo `contestacao`.
12. **Mudar e atualizar a decisão:** a diferença por lado no mês corrente; a auditoria [antes, depois]; recusa depois do
    resultado; `contestacao_valor_mudou` e "Atualizar o valor segurado".
13. **Retido:** nasce previsto; débito confirmado = realizado (valor diferente = estorno e linha nova); MED realizado na
    data da leitura; fora do dinheiro com a empresa enquanto não é perdida.
14. **Ganha:** reversão no mês corrente (o mês da decisão, fechado, não muda); volta = retido realizado; retido previsto
    estornado; o valor devolvido no próximo repasse; débito nunca descontado + reversão = soma zero; tarifa como despesa.
15. **Perdida:** os seis exemplos acima com a identidade do caixa; ajuste comparado com o já lançado (exposição 100.000,
    perdidos 80.000); líquido que não entrou; perdida sem decisão continua em conferência e a decisão depois nasce
    definitiva; SCL com espelho e perda definitiva no mês corrente, sem `mudarEstado`.
16. **Substituição:** cancelamento integral + disputa perdida = proprietário com −80.767 no total; redução com a
    devolução da diferença parada não cobra a diferença de novo; ganha → a devolução volta a ser devida; perdida menor
    que a devolução = `devolucao_a_menor`.
17. **Despesas e recebimentos:** fora do "a pagar"; "marcar paga" e "estornar" recusados; `estornarRecebimento` da volta
    recusado; `Recebimentos.tsx` sem o botão.
18. **Cancelar a reserva contestada:** só antes da entrada; valor retido; sem devolução; tarefa das OTAs; a página do
    hóspede; perdida = decisão sobre o valor perdido; ganha = retido dividido.
19. **Devoluções:** a não aceita para e é substituída; a aceita segue; devolução realizada + disputa =
    `contestacao_com_devolucao` e valor em risco cheio; pedir de novo recusado depois de perdida e aceito depois de ganha
    (até 78 dias; depois, os caminhos do painel).
20. **Rotina:** releitura diária pela Chargebacks API depois dos 85 dias; Payments API depois dos 85; a fila anda na
    falha (espera crescente); busca tardia semanal de todo desfecho, na janela nova, reservada pela coluna; 403 →
    `contestacao_sem_leitura` uma vez; dia 85 sem fonte; 240 dias; o limite por volta e o orçamento de tempo; roda depois
    dos holds; "Conferir agora" de um pagamento só lê aquele.
21. **Aviso assinado:** `ORD…` com `order.charged_back` cria a disputa pela releitura; número = `ignorado`; corpo e
    `type` nunca decidem.
22. **Registro pela equipe:** a releitura antes; não duplica a lida (o casamento sob a trava; 23505 = "já registrada");
    sem provedor segue com a nota; MED só no Pix, sem gravar o reconhecido, com o retido realizado e o D21 explicado.
23. **Pix:** `id_pagamento_provedor` gravado; `contestado` num Pix = `contestacao_pix`.
24. **Pagamento sem reserva:** perdida = desfecho `contestacao` e a taxa como despesa; a devolução substituída confirmada;
    as ações de devolução param.
25. **Início:** cada contagem e texto; a escalada; "pede atenção"; o contador de `pendente` intacto; o e-mail à equipe uma
    vez por momento.
26. **Hóspede:** a linha editável só com o cookie (sem ele, nada; vazia some); nenhuma das palavras "contestação" e
    "Beds24"; Minha reserva sem o botão e com a frase.
27. **Proprietário:** os rótulos e textos no extrato, no portal, no PDF e no e-mail; a explicação ao proprietário; sem
    nota, sem número do caso, sem nome do hóspede nas linhas da disputa; o dono de outro imóvel não vê; o relatório sem
    noites nem bruto em dobro.
28. **Dados pessoais e meses fechados:** `semDadosPessoais` nas tabelas novas; nenhuma linha de resultado com competência
    antes do mês corrente; relatório já enviado igual.

### Decisões de Diego (GUIA, seção 7, "Contestação (M8.2e)")

Em cada uma há um padrão, e o sistema funciona assim. As marcadas com ★ precisam vir antes do pagamento de verdade.

1. ★ **Quanto o proprietário perde quando "o proprietário arca".** Numa reserva de R$ 1.000,00 (parte dele R$ 807,67,
   comissão R$ 142,53, taxa R$ 49,80) e disputa perdida de R$ 1.000,00:
   - **padrão, o valor perdido inteiro:** proprietário fica com −R$ 192,33 (paga também a comissão e a taxa), SCL com
     +R$ 142,53;
   - **alternativa, o valor perdido menos a comissão da SCL:** proprietário −R$ 49,80, SCL R$ 0,00;
   - para comparar, o **proporcional** dá proprietário −R$ 42,33 e SCL −R$ 7,47.
   Na disputa antes da liberação em que o dinheiro nunca entrou (exemplo 3), o padrão faz o proprietário pagar a comissão
   (R$ 144,03) e a taxa; a alternativa dá zero para os dois.
2. ★ **"A proporção da sua parte".** Padrão: parte do proprietário ÷ (parte + comissão), pelas partes efetivas da reserva.
   Com a taxa saindo antes da divisão, como hoje, dá 85% e 15% numa comissão de 15%. Ligada à pergunta 3 da taxa.
3. ★ **O que fica segurado.** Padrão:
   - antes da decisão, a parte da reserva ainda não repassada espera, e nada é descontado do que já foi pago;
   - depois da decisão, só o valor do proprietário fica segurado: junto com a parte da reserva enquanto ela espera, ou no
     próximo repasse de qualquer tipo quando ela já foi paga;
   - se a SCL ganhar, volta no repasse seguinte.
   O efeito: numa estadia de R$ 6.000,00 (parte R$ 4.846,02) com disputa de R$ 200,00 por um item extra, os R$ 4.846,02
   ficam presos até a decisão; num caso igual cuja parte foi repassada um dia antes, nada fica preso. Alternativa: a parte
   segue normalmente e, com a decisão, o débito sai do próximo repasse, como quando ela já foi repassada. Com o padrão, o
   Início sobe o tom depois de 15 dias.
4. ★ **Resultado e valor perdido confirmados pela equipe**, com o formulário sem resultado marcado e os fatos do Mercado
   Pago em palavras, até a conta de teste ou o primeiro caso conferirem os códigos (itens 61 e 64). Alternativa: aplicar
   pela leitura (arriscado: as páginas do Mercado Pago já deram sentidos opostos a `reimbursed`).
5. ★ **Pagamento não reconhecido (fraude ou cartão de terceiro).** A tela de Configurações e o GUIA já disseram: "quando o
   hóspede passa pela verificação, a contestação por cartão roubado fica com a bandeira; nos outros pagamentos, continua
   com a SCL". Padrão: a frase da causa segue isso (com a verificação, "espere o resultado"; sem ela, "a SCL"), e escolher
   o proprietário pede confirmação reforçada. Confirma? Se a regra mudar, fica o registro de decisão (antes, agora,
   motivo).
6. ★ **Disputa antes da entrada.** Padrão: a reserva continua confirmada, o Início avisa ("não libere a entrada…") e a
   equipe pode "Cancelar a reserva contestada" sem devolução pelo sistema: o valor fica retido até o resultado (perdida,
   a decisão de quem arca; ganha, dividido como reserva cancelada sem devolução). Alternativa: cancelar com direito
   integral e a devolução substituída pela disputa, pedida só se a SCL ganhar.
7. **O hóspede vê "pagamento em conferência"** só com o cookie do pagamento e em Minha reserva, numa frase editável que
   pode ficar vazia. Nenhuma mensagem automática.
8. **MED do Pix e reclamações do Mercado Pago** entram pelo registro à mão, com o mesmo fluxo.
9. **Quem decide:** só quem cuida do financeiro (hoje, você), como no cancelamento e na alteração; a marca "Documentos
   enviados" e a página da defesa também para a operação.
10. **Textos:** a seção "Contestações de pagamento" do "Como funciona" (versão 2, com o exemplo) e a frase opcional dos
    Termos, juntos com o item 42; os nomes e as frases das causas (texto-base acima, editáveis).
11. **Marcar o evento "Contestações"** no painel de Webhooks do Mercado Pago, além de "Order (Mercado Pago)" (item 37
    atualizado).
12. **Pagamento sem reserva disputado e perdido:** a taxa que não voltar fica com a SCL (a decisão de 7/10, estendida).
13. **Tarifa do Mercado Pago pela disputa** (se existir, item 64): despesa da SCL, ganhe ou perca.
14. **"Em conferência até a decisão"** quer dizer até a decisão de quem arca (C5); depois, só o valor de quem arca fica
    segurado até o resultado. Alternativa: a parte inteira presa até o resultado da disputa.

### Limites do M8.2e

- Só teste. O sandbox não cria contestação: no teste das prévias, Diego registra uma à mão num pagamento de teste
  (GUIA, item novo 46), confirma o débito, decide e confirma o resultado. A leitura automática só foi testada com a
  versão falsa.
- O resultado nunca é aplicado só pela leitura (C1), e o formulário não sugere resultado.
- Uma disputa perdida que o Mercado Pago reverte depois vira aviso e ajuste manual. Uma ganha reaberta vira a rodada
  seguinte pela equipe ("Conferir o aviso"), nunca sozinha.
- Os documentos são enviados pelo painel do Mercado Pago; o sistema só marca e monta a página para imprimir. O envio pela
  API (uma vez por caso, até 10 arquivos) fica para depois, porque pediria guardar arquivos com dados do hóspede.
- A alteração de uma reserva com disputa em curso ou perdida não é feita pelo sistema; o cancelamento, só pela ação
  "Cancelar a reserva contestada" (antes da entrada); depois de ganha, os dois voltam ao normal.
- O MED e as reclamações não são lidos sozinhos: só o registro da equipe.
- O id numérico no aviso assinado continua ignorado (item 59).
- O marketplace segue fora (M12.2): a proporção pelos pesos do modelo B entra lá.
- A decisão não muda depois do resultado; a correção é um ajuste.
- Testar só na prévia mais nova: as antigas usam o mesmo banco e não conhecem `contestacoes_pagamento` (uma prévia
  antiga mostraria só "Contestado" e manteria as recusas de hoje). Nas prévias a rotina não roda: o "Conferir agora" faz
  o papel dela.
- **O restante de uma devolução substituída que a disputa perdida confirmou a menos.** *Até a revisão de 11/10:* não
  tinha ação no sistema ("Pedir o restante" e "Registrar o restante devolvido por fora" recusados com
  `contestacao_perdida`). *Agora:* resolvido como o próximo passo previsto — o restante sai por fora (só ele), também no
  cartão; pedir o restante ao Mercado Pago é recusado com texto próprio (ver "O que a implementação ajustou", revisão).
- **A nota do débito.** *Até a revisão de 11/10:* conferida e não guardada (a 0069 não tinha a coluna). *Agora:* a 0069
  ganhou `debito_nota` e "Confirmar o débito do Mercado Pago" a grava; o evento `debito_confirmado` e a auditoria
  `contestacao.debito` continuam só com o dia e o valor.
- **Contestação nova sobre uma ganha já conferida** ("continua encerrada") e relida em `in_process` com os mesmos fatos:
  não volta a ligar o aviso nem a segurar o pagamento (a equipe já conferiu); um fato novo liga de novo. A correção, se a
  equipe errou, é registrar a disputa vista no painel.

### O que a implementação ajustou (11/10/2026)

Cada ajuste com o motivo. Nenhum muda uma decisão de Diego; os que mudam um texto ou uma regra do desenho dizem o antes.

**Adaptador** (`provedor.ts`, `mercadopago.ts`, `falso.ts`):
- `ContestacaoLida.daTransacao` marca a leitura tirada só da transação `charged_back/<detalhe>`, sem item na lista, e
  `Cobranca.transacaoAprovada` leva o fato "a transação voltou a aprovada" (também quando a contestação aparece só na
  lista). *Motivo:* o adaptador não sabe quais disputas o banco conhece; quem cruza o fato com as linhas é o domínio.
- Um item de `transactions.chargebacks[]` sem nada legível vira uma leitura sem identificação, com estado
  `desconhecido`. *Motivo:* avisar em vez de sumir.
- O limite de 20 algarismos é um só para o caso e para o número do pagamento (`ID_NUMERICO_PROVEDOR`, em `provedor.ts`,
  também em `aplicar.ts`); `payments[]` do caso aceita também texto só de algarismos. `ESTADOS_LIDOS_CONTESTACAO` e
  `SITUACOES_DOCUMENTACAO` vivem em `provedor.ts`, e `contestacao-regras.ts` só as reexporta (uma regra, um lugar).
- `documentacao`: null quando o campo não vem; `desconhecida` quando vem fora da lista.
- `buscarContestacoes` com um número que não pode existir devolve a lista vazia sem chamar a rede (como `consultar` com
  id inválido); um item sem id legível faz a busca inteira falhar (nunca "nenhuma" sem saber). `consultarContestacao` e
  `situacaoDoPagamento` exigem que a resposta traga o id pedido; senão, falham.
- `situacaoDoPagamento`: 404 = null; 403 continua erro de credencial (o 403 "sem acesso" só vale na Chargebacks API).
- `X-Caller-Id`: guardado em memória também quando vem de `conferirContaDeTeste`; chamadas ao mesmo tempo esperam a
  mesma leitura de `/users/me`; sem id válido, a Chargebacks API não é chamada, e a falha não fica guardada (a próxima
  chamada tenta de novo).

**Esquema** (0069):
- Dois índices além do desenho: `contestacoes_pagamento_pagamento` (as travas e as leituras por pagamento) e
  `devolucoes_pagamento_contestacao` (parcial, a soma das devoluções substituídas). A chave estrangeira do caixa final se
  chama `contestacoes_pagamento_caixa_final_fk`: o nome gerado passaria de 63 caracteres.
- O desfecho `contestacao` aparece como "Voltou ao pagador pela disputa". A base de cancelamento `contestacao` e o valor
  `contestacao` de `confirmada_por` são só tipos (as colunas são texto).
- **Colunas do aceite (11/10, depois da revisão).** *Antes:* a 0069 não tinha nenhuma delas. *Agora:*
  - `contestacoes_pagamento.decisao_mudanca_nota` (o "por que mudar" da mudança mais recente; abaixo, "Telas");
  - `eventos_contestacao.ordem` (identidade, a ordem de gravação: os eventos de uma mesma ação têm o mesmo `em`, e a
    linha do tempo desempatava pelo id aleatório);
  - `repasses.fora_presa_disputa` e `repasses.fora_segurado_junto` (a divisão do que ficou fora, gravada no fechamento;
    null nos fechamentos de antes; abaixo, "Proprietário e repasses").
  *Motivo:* sem elas, a explicação ao proprietário e a nota da decisão se perdiam na mudança, a linha do tempo trocava de
  ordem a cada leitura e o motivo do que ficou fora de um fechamento dependia do valor em risco de agora. A 0069 ainda não
  foi aplicada em nenhum banco (a branch não foi publicada), por isso as colunas entram nela, idempotentes como o resto.

**Leitura, casamento e transições:**
- `contestacaoDaLeitura` devolve `{ explicada, contestado }`, não a situação; com `contestado` falso, vale a situação
  local (`situacaoDaLeitura`, em `travas.ts`, é quem dá a situação). Uma leitura `in_process` contra uma linha final não
  muda a situação do pagamento: quem segura as recusas é o "em curso". Uma disputa encerrada que o sistema não conhecia
  (ambígua) deixa o pagamento `contestado` até a equipe registrá-la.
- Numa linha final, a leitura grava os fatos lidos mesmo quando contradizem o resultado, sem mudar a situação. *Motivo:*
  o "em curso" precisa saber que a contradição veio de `in_process`, e sem os fatos o aviso voltaria a cada leitura.
- `contestacao_resultado_mudou` liga na primeira contradição e, depois de "Conferir o aviso", só volta com um fato novo;
  a passagem `a_confirmar` → `aberta` usa o mesmo aviso; `contestacao_leitura_conflitante` fica até a equipe confirmar o
  resultado; uma leitura `in_process` sem identificação, num pagamento com só linhas finais, cai na final mais nova (com
  `contestacao_resultado_mudou`).
- Registro da equipe sem número de caso: num pagamento com uma disputa sem identificação aberta, cai nela ("já está no
  quadro": o índice `_sem_id` não deixaria outra); com uma disputa que a leitura já criou com o número, nasce **possível
  duplicata** (valor em risco 0) em vez de "já está no quadro". *Motivo:* sem o número não dá para saber se é a mesma; a
  equipe confirma "outra disputa" ou encerra sem efeito (avisar em vez de supor). O índice único violado (23505) responde
  "já está no quadro" no código, sem teste direto (a corrida não se provoca de fora).
- Confirmar o resultado de uma possível duplicata é recusado (confirme antes que é outra disputa); "Encerrar sem efeito"
  vale nela.
- `contestacao_caso_de_outro_pagamento` fica só na linha; um item da busca que é de outro pagamento é ignorado.

**Avisos do pagamento:**
- O aviso `contestado` liga só com a disputa aberta, a confirmar, ou ganha que o Mercado Pago voltou a mostrar em
  andamento, não com a perdida. *Motivo:* ele é o retrato do "em curso" para quem lê sem a trava (`estadoDaCancelada`,
  `liberacaoVencida`), e a liberação vencida só ignora as disputas que ainda correm. A perdida continua recusando o
  cancelamento, a alteração e as devoluções pelo `contestacaoEmCurso`, em que ela conta.
- `contestacao_liberacao_lida` vai nas linhas em curso ou perdidas; a liberação à mão o desliga.
- O aviso `devolucao_devida_depois_da_disputa` diz o valor no quadro (`textoDevolucaoDevidaDepoisDaDisputa`), com a mesma
  frase na ganha e no sem efeito: "A disputa do pagamento terminou sem o dinheiro voltar ao hóspede por ela: a devolução
  de R$ X que a reserva deve a ele continua devida…". *Antes* (desenho): "A SCL ganhou a disputa: a devolução de R$ X…".
  *Motivo:* no sem efeito ninguém ganhou.

**Caixa e valor em risco:**
- No pagamento sem o dinheiro da reserva (sem reserva) não há retido: esse dinheiro nunca entrou no livro. Na perda, a
  taxa vira despesa da SCL (como no desenho).
- O valor em risco de várias disputas não finais do mesmo pagamento é distribuído pela ordem de abertura: a mais antiga
  tem prioridade (a soma nunca passa do pago).
- MED que a leitura mostra como devolução: o retido usa o valor em risco, no dia de `devolvido_visto_em`; sem essa data
  (devolução de parte do valor), hoje. `retido_confirmado_em` fica vazio (é fato lido, não confirmação da equipe).
- "Confirmar o débito" sempre estorna o retido previsto e lança o realizado (`#N`), mesmo com o valor igual, com a
  competência na data do débito. *Motivo:* nenhuma linha muda de estado nem de competência depois de lançada.
- A substituição das devoluções pega só a pedida sem aceite e sem chave em dúvida, ou a recusada (salvo a parada com a
  chave em dúvida).
- Durante a disputa, `precisaFinanceiro` lê a Payments API também, para dar o aviso da liberação lida.
- A tarifa usa a data do resultado; a taxa do pagamento sem reserva usa o dia do débito ou, sem ele, a data do resultado.
- "Cancelar a reserva contestada": `valor_retido` = o principal menos as devoluções realizadas e o reconhecido devolvido
  fora; o direito do hóspede fica `nenhum`; sem a mensagem da decisão ao hóspede e sem o aviso de mensagem pendente no
  Início (a equipe fala com ele caso a caso).
- Fase 0 do resultado: "em andamento na leitura de agora" = a linha relida no mesmo instante com `in_process`
  (conservador: pede a nota reforçada).

**Proprietário e repasses:**
- Os avisos dos repasses no Início ficam em `repasses/avisos-contestacao.ts` (`avisosDeContestacaoNosRepasses`), não em
  `repasses/inicio.ts`: aquele arquivo trata do início do sistema (M4.12), e pôr os avisos lá criaria importação circular.
  O Início os mostra junto com `avisosDeContestacao` (`painel/dashboard.ts`).
- O e-mail do fechamento refaz a parte presa por disputa (`foraPorDisputaDoFechamento`) pelo livro como estava no
  instante do fechamento e pelas disputas abertas antes dele e ainda sem decisão nele. *Motivo:* o repasse grava só o
  total `foraDoFechamento`; assim não foi preciso outra coluna.
  - *Revisão de 11/10 (dinheiro). Antes:* a conta lia `decisao_em` e `valor_em_risco` de agora (`decisao_em` é regravado a
    cada versão, o "Encerrar sem efeito" zera o valor em risco, e uma disputa ganha sem decisão antes do fechamento
    continuava contando). Com o total fora negativo, o e-mail mostrava "(reserva em conferência: disputa do pagamento):
    -R$ …", e o painel do mês fechado dizia sempre "dinheiro ainda não registrado". *Agora:* a divisão `{ presa, seguradoJunto, outras }` é refeita pela linha do tempo
    daquele instante: decisão tomada antes do corte (as linhas `…:(proprietario|scl):(vN|final)` criadas até ele, o evento
    `decisao` ou `decisao_em` até ele); disputa encerrada antes do corte (os eventos `resultado` e `sem_efeito`); a
    duplicata pela `confirmada_outra_em`; o valor em risco de uma encerrada sem efeito pelo retido em vigor no corte; a
    perdida antes do corte com perda a dividir. O e-mail mostra uma linha por motivo, com o sinal de cada uma, e o valor
    segurado que espera junto ganha linha própria. O painel do mês fechado dá os mesmos motivos (`foraDividido`). *Limite
    registrado:* o valor em risco de uma disputa ainda aberta é o de agora; *próximo passo:* uma coluna no repasse.
  - *Aceite (11/10): o próximo passo, feito.* O fechamento grava a divisão daquele instante (`fora_presa_disputa` e
    `fora_segurado_junto`, da mesma `foraDividido` da previsão), e `foraPorDisputaDoFechamento` lê daí; a reconstrução pela
    linha do tempo fica só para os fechamentos de antes (colunas null), com o limite acima. Financeiro → Repasses mostra
    as três linhas pelo `foraDividido`, cada uma com o sinal ("− Fora do fechamento (dinheiro ainda não com a empresa)",
    "− Fora do fechamento (reserva em conferência: disputa do pagamento)" e "+ Valor segurado pela disputa do pagamento,
    fora deste repasse (espera junto com a parte da reserva)"), no mês fechado também. *Antes:* o painel usava
    `p.repasse ? 0 : p.foraPorDisputa`, e o mês fechado dizia tudo "dinheiro ainda não com a empresa".
- Estornar um repasse é recusado quando ele levou uma parte da reserva e existe, fora dele, uma linha da disputa do
  mesmo proprietário lançada depois; o repasse que só leva a linha da disputa pode ser estornado.
- O segurado e a reversão que entram juntos somam zero ("Nada disponível"), sem a mensagem de desconto não coberto.
- No rodapé do portal, o valor segurado em que o proprietário fica devendo não se transfere (como o desconto do
  cancelamento): ele sai dos próximos repasses, e o portal nunca pede Pix por ele.
- Na tabela de reservas do portal, as linhas da disputa ficam fora da "sua parte" de cada reserva (as de sempre não
  mudam) e aparecem à parte, no extrato e no resumo.
- A tarifa e a taxa da disputa têm texto próprio na lista de despesas.
  - *Revisão de 11/10 (dinheiro). Antes:* as duas eram "Tarifa… acompanhe no quadro da disputa". *Agora:* a taxa é "Taxa
    do pagamento do site perdida na disputa (pagamento sem reserva), definitiva (disputa perdida em dd/mm)", e a tarifa é
    "Tarifa do Mercado Pago pela disputa do pagamento, já paga (disputa ganha/perdida em dd/mm)", sem "acompanhe" nas já
    realizadas.
- **Cada linha da disputa diz o valor dela** (revisão de 11/10, dinheiro). *Antes:* todas as linhas do extrato repetiam
  `parte_proprietario` (o total em vigor), e a linha positiva (a que devolve) era chamada de "segurados". *Agora:* a linha é
  identificada pela chave (versão N, reverte, final ou sem efeito), com o valor segurado antes e depois tirado das linhas
  de versão no livro: a versão 1 diz o valor dela; a versão N diz "com a decisão atualizada, o valor segurado passa de R$ a
  para R$ b", seguido de "mais R$ d segurados…" ou "R$ d voltam a você", e "Nada fica segurado de você" quando b = 0; a
  versão que já não vale diz "pela primeira decisão (atualizada depois)"; o definitivo e o devolvido seguem a mesma
  lógica. A causa, a explicação e a proporção só aparecem na versão em vigor.
- **Causa e explicação no e-mail e no PDF** (revisão de 11/10, dinheiro). *Antes:* só o extrato e a lista do portal as
  mostravam. *Agora:* ao lado da linha do item (painel, portal e e-mail do repasse; no e-mail, as linhas da disputa nunca
  caem no "e mais N reserva(s)") e, no PDF, na nota abaixo da tabela das reservas (a coluna da situação é cortada). A
  linha devolvida e a versão que já não vale não as levam.
- **Portal, perdida sem nada a dividir** (aceite de 11/10). *Antes:* sem decisão, tudo que não era ganha aparecia "em
  conferência", também a perdida definitiva sem perda a dividir (a perda coberta pela devolução substituída). *Agora:*
  "Disputa do pagamento da reserva SCL-…: nada descontado de você (a SCL perdeu a disputa em dd/mm)." (variante
  definitivo); a perdida que ainda espera a decisão continua em conferência.
- `definitivo_em` só é preenchido com os lançamentos definitivos feitos (`recebidoPorReserva` depende disso).

**Telas:**
- Os formulários menores (débito, prazo, documentos, outra disputa, sem efeito, conferir o aviso, atualizar o valor
  segurado) usam um componente só, `FormAcaoContestacao`.
- "Documentos para a defesa" monta a política aceita pelas mesmas funções das páginas legais (`lerPaginaLegal`,
  `preencherCampos`, `blocosDoDocumento`), sem o módulo do site que só roda no servidor.
- O e-mail à equipe sai por `avisarEquipeDasContestacoes`, que usa `avisarEquipePorEmail` (o mesmo do pedido de
  cancelamento), na rotina e no registro; o "Conferir agora" de um pagamento é `conferirContestacoesDoPagamento`.
- **Revisão das telas (11/10/2026).**
  - **"Para cancelar, fale com a equipe." em Minha reserva** vale também com a disputa perdida (a regra única,
    `disputaDoPagamento`: em curso ou perdida), também no MED do Pix perdido com o pagamento ainda aprovado; a frase
    "pagamento em conferência" só aparece enquanto a disputa está em curso.
  - **"Texto para o proprietário"**: neutro quanto ao tipo e à forma de pagamento ("foi aberta uma disputa de R$ X sobre o
    pagamento desta reserva no Mercado Pago", como o portal; nunca "titular do cartão") e escrito pela situação (segurado
    até o resultado; ganha, volta no repasse seguinte; perdida, fica definitivo; sem efeito, nada fica descontado).
    "Cancelar a reserva contestada" diz "pagador".
  - **Caixa da nota reforçada**: aparece também com a linha aberta e o caso da Chargebacks API sem estado nem cobertura
    (`leituraEmDisputa`), e sempre depois da recusa `nota_reforcada`, no resultado e no sem efeito (a ação nunca fica
    travada sem a caixa que o domínio pede).
  - **"Mudar quem arca"**: o campo vem com a explicação ao proprietário em vigor; enviar sem mexer a mantém, e apagar o
    campo apaga a explicação (de propósito).
  - **"Nunca entrou na conta"**: obrigatório; em branco nunca vira 0 (a ação manda null, e o domínio recusa). O valor
    digitado entra na pergunta do botão, e o texto de `liberacaoAntesDaPerda` aparece quando o domínio pede a liberação
    antes.
  - **"Documentos para a defesa"**: sem o titular da reserva (não está na lista do desenho), e o valor pago só para quem
    lê o financeiro (`verValores`).
  - **Ambígua no Início**: contada pelos avisos do pagamento (`pagamentos.avisos` com `contestacao_ambigua`), também sem
    linha no quadro, o que fecha "a contagem do Início pelos avisos do pagamento é das telas" (revisão do domínio, abaixo).
  - Também: a prévia da decisão diz o que cada lado fica da reserva com a disputa perdida e com a ganha; o hóspede da
    reserva cancelada pela disputa lê "em conferência", nunca "não há devolução"; a prévia do cancelamento não exige a
    nota (só o passo 2); o provedor só é consultado depois de achar a reserva na empresa da sessão.
- **Aceite (11/10/2026): o que cada corretor deixou para a área de outro.**
  - **A nota do débito no quadro** (a coluna veio na revisão do domínio): "Nota do débito (só a equipe)", na leitura da
    equipe que lê o financeiro; a operação não a vê.
  - **A origem da disputa no quadro**: `textoDaOrigemDaContestacao` em toda linha ("Lida no Mercado Pago como contestação:
    pode ser uma reclamação no Mercado Pago (mediação)…" ou "Registrada à mão: …"). *Antes:* só a registrada à mão tinha
    texto.
  - **"Perdeu" que pede a liberação antes**: o texto de `liberacaoAntesDaPerda` leva o atalho "Ir para 'Registrar
    liberação'", que desce até o formulário do pagamento, só quando essa ação está no quadro (o domínio a aceitaria).
  - **"Mudar quem arca" guarda o "por que mudar" à parte** (`decisao_mudanca_nota`). *Antes:* ele substituía a
    `decisao_nota`, e a nota da decisão se perdia. *Agora:* o quadro mostra as duas ("Nota da decisão" e "Por que a decisão
    mudou", só a equipe); nenhuma vai ao proprietário, ao evento ou à auditoria. A explicação vazia continua apagando a
    explicação (acima).
  - **O aviso "contestado" do quadro do pagamento diz o tipo** da disputa em curso mais antiga (`tipoDaDisputaEmCurso`,
    `textoDoAvisoContestado`): "Pagamento contestado no cartão…", "Devolução pedida pelo Pix (MED)…" ou "Reclamação no
    Mercado Pago…". *Antes:* sempre o texto geral "Disputa do pagamento em curso…".
  - **A recusa da nota reforçada diz a caixa a marcar**, com o rótulo de cada formulário: 'marque a caixa "O painel do
    Mercado Pago já mostra o resultado"' (resultado) e '… "O painel do Mercado Pago já mostra a disputa encerrada"' (sem
    efeito). *Antes:* "confirme na nota que o painel do Mercado Pago já mostra o resultado", nos dois.
  - **A linha do tempo na ordem de gravação** (`eventos_contestacao.ordem`, o mais novo em cima). *Antes:* os eventos de uma
    mesma ação (a decisão e os lançamentos dela) trocavam de ordem a cada leitura, e um teste das telas falhava às vezes.

**Revisão do domínio (11/10/2026, depois da auditoria do PR).** Cada item com o antes e o motivo; os marcados *(segue o
desenho)* só fazem o código cumprir o que já estava escrito acima.
- **`contestacao_ambigua`.** *Antes:* toda volta em que as leituras casavam desligava o aviso. *Agora:* a Chargebacks API e
  a Payments API só o ligam; quem o desliga é a releitura da order (`aplicarLeitura`) ou o registro pela equipe.
  *Motivo:* as fontes da rotina chegam em transações diferentes, e o caso conhecido que casava apagava, na mesma volta, a
  disputa sem número que a order acabava de mostrar. A contagem do Início pelos avisos do pagamento é das telas.
- **`a_confirmar` → `aberta` só com `in_process` lido** (order ou Payments API) *(segue o desenho, "Transições")*. O caso
  da Chargebacks API ainda sem cobertura conta como "em disputa" para criar ou manter a linha aberta, nunca para desfazer o
  encerramento que outra fonte mostrou; na fase 0 do resultado, ele só pede a nota reforçada com a linha ainda aberta.
  *Antes:* a order levava a `a_confirmar` e o caso devolvia a `aberta`, todo dia.
- **Conflito entre as fontes** *(segue o desenho, "Ordem das leituras")*: a divergência no encerramento é vista também
  entre o fato guardado de uma fonte e o da fonte nova (`fatosEmConflito`: `reimbursed` guardado e a cobertura true lida
  depois), não só dentro de uma chamada; liga `contestacao_leitura_conflitante`, sem transição.
- **Dia 85 sem fonte.** *Antes:* só sem falha. *Agora:* também com 3 falhas seguidas da Chargebacks API e da Payments API
  (`FALHAS_PARA_SEM_FONTE`), lidas como "sem resposta útil". *Motivo:* com a rota sempre falhando, a disputa chegava calada
  aos 240 dias.
- **Avisos de leitura que saem.** *Antes:* `contestacao_sem_leitura` e `contestacao_sem_fonte` só saíam na confirmação
  da equipe. *Agora:* o primeiro sai quando a Chargebacks API volta a responder sem 403; o segundo, com uma resposta útil.
- **Busca tardia.** A janela inteira (até 200 dias depois do maior entre a aprovação e a saída) vai ao SQL antes do limite
  da volta, e a vez volta também quando a aplicação falha depois da chamada (trava ocupada) *(segue o desenho, "a falha
  devolve a marca")*. *Motivo:* os pagamentos fora da janela ocupavam a fila para sempre, e uma trava ocupada escondia a
  disputa achada por uma semana.
- **Fase 0 com a trava ocupada** *(segue o desenho, "melhor esforço")*: a releitura da order que não aplica por trava
  ocupada é uma leitura que não deu ("não deu para conferir no Mercado Pago agora" / "sem leitura do Mercado Pago"), no
  resultado, no sem efeito e no registro pela equipe.
- **Uma `sem_efeito` não absorve a disputa nova.** *Antes (ajuste anterior):* a leitura `in_process` sem identificação,
  num pagamento só com linhas finais, caía na final mais nova. *Agora:* na final mais nova **com resultado** (ganha ou
  perdida, com `contestacao_resultado_mudou`); só com `sem_efeito`, nasce a linha nova (casamento, item 4). *Motivo:* uma
  disputa registrada por engano e encerrada sem efeito escondia a contestação de verdade, e o pagamento voltava a pagar
  devoluções pelo sistema durante ela.
- **Avisos da liberação.** *Antes:* `contestacao_liberacao_lida` ligava a cada leitura com `liberado` e só a liberação à
  mão o desligava. *Agora:* liga só sem recebimento em vigor e com líquido que ainda cabe; a liberação lida pelo Mercado
  Pago (ou a à mão conciliada) desliga os dois avisos de liberação; a confirmação do resultado desliga o da liberação lida
  (na ganha sempre: a leitura volta a lançar; na perdida, com recebimento, ou quando o líquido inteiro já é "nunca
  entrou"). `registrarLiberacaoManual` recusa o que passa do líquido menos o "nunca entrou" das perdidas
  (`liquidoQueAindaPodeEntrar`), e o quadro esconde a ação quando nada mais cabe. *Motivo:* depois da perdida que já
  contou o líquido no caixa final, o aviso pedia, e o sistema aceitava, a mesma entrada de novo.
- **"Nunca entrou" e a perdida sem recebimento.** *Antes:* proposto o líquido sempre que não havia recebimento, e o campo
  ia até o pago. *Agora:* nunca mais que o valor perdido (recusa acima dele); com o sinal de liberação do Mercado Pago (o
  aviso da liberação lida, ou a liberação confirmada) ou numa disputa de parte do valor, o "Perdeu" pede antes a liberação
  registrada à mão (`FatosDoResultado.liberacaoAntesDaPerda`, código `liberacao_antes`), sem valor proposto. *Motivo:* o
  desenho decide o "entrou ou não" "pelo sinal de liberação do provedor ou pela equipe"; sem isso, a disputa parcial
  lançava uma entrada de caixa que não existiu e dava o dinheiro por "com a empresa" sem liberação.
- **Pagamento sem reserva perdido.** *Antes:* o valor perdido ia até o pago. *Agora:* até a taxa do pagamento mais o custo
  do parcelamento pago pela SCL; sem a taxa conhecida, a nota (com a taxa vista no painel do Mercado Pago) é obrigatória.
  *Motivo:* o dinheiro dele nunca entrou no livro; o que a SCL perde é a taxa, e um valor maior é quase sempre digitação.
- **Datas de caixa.** *Antes:* a partir da aprovação. *Agora:* o débito (confirmar e perdida) a partir da abertura no
  Mercado Pago (o dia do caso, ou o que a equipe registrou; sem ela, a aprovação, porque o dia em que a leitura viu a
  disputa pode vir depois do débito), e a volta (ganha e sem efeito) a partir do débito.
- **Reabrir com outra disputa sem número aberta:** recusa com texto próprio (a equipe segue por ela ou a encerra sem
  efeito); a rodada nova nasce num ponto de salvamento (o índice único violado responde com texto).
- **Decisão:** a trava do motor da reserva vem antes da leitura das partes efetivas (registrar, mudar e atualizar o valor
  segurado) *(segue o desenho, "ordem única")*.
- **Devolução com a chave em dúvida quando a disputa abre** *(segue o desenho, "Devoluções do mesmo pagamento")*: só relê
  e espera — nem para, nem envia de novo com a mesma chave (se o primeiro pedido não chegou, sairia uma devolução nova por
  cima da disputa), também sob a trava. *Antes:* parava como a pedida sem aceite. O texto do M8.2a ("Devolução na parte
  (a)": "devolvida em parte ou contestada = … a devolução para") vale para a pedida sem a chave em dúvida.
- **Retido do MED e da reclamação.** *Antes:* realizado pelo valor em risco, só no registro com a devolução já lida.
  *Agora:* pelo devolvido lido que a disputa explica (até o valor em risco), no registro e também quando a leitura vê a
  devolução depois do registro (o previsto é estornado e nasce o realizado, no dia em que a leitura a viu). Registrado acima
  do devolvido lido: a mensagem na hora ("o caixa registra R$ X"); o resto não vira outro retido (uma disputa tem um retido
  só) e entra no caixa final, se o Mercado Pago debitar. *Motivo:* o retido é fato lido; o mesmo fato dava caixas
  diferentes conforme a ordem, e um valor digitado acima virava saída de caixa que não existiu.
- **Restante da devolução confirmada pela disputa** (limite resolvido): "Registrar o restante devolvido por fora" vale
  para a devolução `confirmada_por = 'contestacao'` com a perdida (também no cartão; o "contestado" que o Mercado Pago ainda
  mostra dessa disputa não recusa); outra disputa em curso continua segurando; "Pedir o restante" é recusado com texto
  próprio (`ERRO_RESTANTE_DA_DISPUTA`) e o quadro oferece só o por fora. As devoluções de um pagamento com disputa em curso
  ou perdida deixam de oferecer "Pedir o restante" e "por fora" que o domínio recusaria.
- **Nota do débito** (limite resolvido): coluna `debito_nota` na 0069, gravada em "Confirmar o débito". O quadro a mostra
  a quem lê o financeiro (feito no aceite, "Telas").
- **"Cancelar a reserva contestada".** *Antes:* `valor_retido` = o principal menos as devoluções realizadas e o
  reconhecido. *Agora:* menos também as devoluções substituídas por uma disputa não final, e nunca mais que o valor da
  reserva de agora. *Motivo:* depois de uma redução, a diferença que é do hóspede voltava ao resultado do proprietário e da
  SCL, e o resultado deixava de bater com o caixa.
- **Taxa que não voltou na devolução confirmada pela disputa.** *Antes:* o caminho de sempre (despesa paga, com data de
  caixa no dia da confirmação, que é o do débito). *Agora:* despesa realizada **sem** data de caixa, no mês corrente.
  *Motivo:* o retido (ou o caixa final) da disputa já tirou do caixa o valor bruto debitado, que inclui a taxa; a despesa
  paga a tirava de novo, num mês que podia estar fechado.
- **Origem da disputa no quadro** *(segue o desenho, "O que é contestação aqui")*: `textoDaOrigemDaContestacao` dá, para a
  linha lida, "lida no Mercado Pago como contestação: pode ser uma reclamação no Mercado Pago (mediação); o sistema não tem
  como separar, confira no painel dele" (`TEXTO_LIDA_PODE_SER_RECLAMACAO`); a registrada à mão continua com o texto dela.
  O quadro mostra os dois textos desde o aceite ("Telas").

**Revisão do Codex (11/10/2026).**
- **A Payments API com disputas de tipos diferentes no mesmo pagamento** *(segue o desenho, "De onde vem cada fato",
  item 3)*. *Antes:* depois dos 85 dias, a Payments API só era lida quando **todas** as disputas do pagamento eram no
  cartão; com um MED ou uma reclamação registrados ao lado, a contestação no cartão ficava sem a terceira fonte e ganhava
  `contestacao_sem_fonte`. *Agora:* ela é lida sempre que há uma disputa no cartão a reler, e a leitura vale só para as
  disputas no cartão (`LeituraDeContestacao.soDoTipo`: o casamento a liga só às linhas desse tipo, e o MED e a reclamação
  ao lado não a tornam ambígua). No MED e na reclamação, só a leitura do caso deles conta como fonte útil (o
  `contestacao_sem_fonte` deles não sai por causa da Payments API). *Motivo:* o desenho pede a releitura de cada disputa
  no cartão pela Payments API depois dos 85 dias.
- **A busca pelo número do pagamento com uma disputa sem caso ao lado de outra com caso** *(segue o desenho, "De onde vem
  cada fato", item 2)*. *Antes:* a rotina só fazia a busca da Chargebacks API pelo número do pagamento quando **nenhuma**
  disputa dele tinha número de caso; um MED ou uma reclamação registrados sem o número, ao lado de uma contestação no
  cartão com caso, nunca eram procurados. E a resposta útil do caso de uma disputa contava como fonte para todas as
  disputas no cartão do pagamento (o `contestacao_sem_fonte` de uma contestação sem caso saía sem nada tê-la lido).
  *Agora:* a busca roda sempre que alguma disputa a reler não tem um número de caso legível (os casos já lidos pelo número
  não entram de novo), e a fonte útil é olhada disputa a disputa: só a que recebeu alguma leitura na volta (casada pelo caso,
  ou por ser a única não final do tipo) perde o `contestacao_sem_fonte`. O casamento continua conservador: com duas
  disputas não finais, o caso novo achado pela busca não se liga a nenhuma e vira a `contestacao_ambigua` (a equipe confere
  no painel do Mercado Pago e registra pelo quadro). *Motivo:* sem isso, a disputa sem caso ficava sem fonte e sem aviso.
- **O orçamento da volta dentro de um pagamento** *(segue o desenho, "Rotina", orçamento de 60 s)*. *Antes:* o orçamento
  era conferido só antes de cada pagamento; um pagamento com muitas disputas chamava a Chargebacks API caso a caso até o
  fim (8 s cada), passando do minuto. *Agora:* ele é conferido também antes de cada chamada da Chargebacks API e da Payments
  API. Esgotado no meio de um pagamento, andam na fila só as disputas cujo caso já respondeu (sem ligar o
  `contestacao_sem_fonte`, porque as fontes que faltaram não foram chamadas); as outras continuam na vez e são as primeiras
  da próxima volta, e a volta para ali. *Motivo:* a rotina tem de caber no tempo da função.
- **O 403 na busca tardia** *(segue o desenho, "Busca tardia")*. *Antes:* a Chargebacks API recusando a busca (403) gastava
  a vez da semana sem nenhum aviso: a disputa aberta tarde ficava invisível. *Agora:* o 403 continua gastando a vez (a
  próxima busca é na semana seguinte, ou no "Conferir agora"), mas liga, sob a trava, o aviso do pagamento
  `contestacao_busca_sem_acesso` (mora só no pagamento, como a `contestacao_ambigua`), com a contagem no Início ("O
  Mercado Pago não deixa esta conta procurar disputas…"). A primeira busca tardia que responder (a da semana seguinte, ou a
  do "Conferir agora") desliga o aviso. Junto, os avisos
  do pagamento que a leitura da disputa liga (`ao_vivo` e este) passam pela gravação única dos avisos
  (`sincronizarAvisosDaDisputa`, `ligar`/`desligar`), em vez de mudar a lista na memória antes dela (o que podia pular a
  escrita num pagamento sem disputa em curso). *Motivo:* "avisar em vez de supor": a falta de permissão tem de aparecer.
- **"Voltou a aprovado" com a contestação que o pagamento não registra** *(segue o desenho, "De onde vem cada fato",
  item 3)*. *Antes:* depois dos 85 dias, o `approved` da Payments API só valia como "a transação voltou a aprovada" quando
  o pagamento estava `contestado`. A contestação no cartão registrada pela equipe, ou achada pela Chargebacks API depois
  dos 85 dias, não muda a situação do pagamento (continua `aprovado`); sem o caso legível na Chargebacks API, a disputa
  ficava aberta para sempre. *Agora:* vale também quando o quadro tem uma contestação no cartão não final; a disputa vai
  para `a_confirmar` e a equipe confirma o resultado (como sempre). *Motivo:* o fato que a Payments API dá é o mesmo; o que
  muda é só por onde o sistema soube da disputa.
- **A falha de um caso não para os outros** *(segue o desenho, "Rotina", "a fila anda também na falha")*. *Antes:* com
  várias disputas no mesmo pagamento, a falha na leitura do primeiro caso (transporte, resposta ilegível) encerrava as
  leituras dos outros casos e a busca, e todas as disputas do pagamento contavam a falha. *Agora:* cada caso é lido numa
  chamada isolada; a falha conta só para a disputa daquele caso (ou para todas, quando falha uma fonte do pagamento inteiro
  — a order, a busca ou a Payments API — e nada as leu na volta), e os outros casos e a busca seguem. *Motivo:* um caso
  com problema não pode deixar as outras disputas sem leitura.
- **O "Conferir agora" da empresa conta as disputas** *(segue o desenho, "Painel")*. *Antes:* a mensagem só olhava os
  pagamentos, as devoluções e os Pix cancelados; uma volta que só achava ou mudava uma disputa respondia "Nada pendente
  para conferir com o Mercado Pago". *Agora:* a mensagem diz as disputas novas, as relidas e os pagamentos com disputa
  atualizada (como o "Conferir agora" de um pagamento já fazia).
- **A possível duplicata não explica a devolução lida** *(segue o desenho, "D21 com a disputa" e "possível duplicata")*.
  *Antes:* o MED ou a reclamação registrados como possível duplicata (há outra disputa não final) já contavam, pelo valor
  inteiro, na explicação da devolução que a leitura mostra (D21, no TS e no gêmeo SQL), embora não segurem nada até a
  equipe confirmar que é outra disputa. *Agora:* uma regra só, `explicaDevolucaoLida` (`travas.ts`): explicam a devolução
  o MED e a reclamação que não estão encerrados sem efeito nem são possível duplicata ainda não confirmada; o gêmeo SQL
  (`devolvidoPelaDisputaSql`) e a conta do retido (`devolvidoExplicadoPelaDisputa`) seguem a mesma regra. Ao "Confirmar
  que é outra disputa", ela passa a explicar, e o aviso `devolvido_por_fora` sai se nada mais ficar sem explicação.
  *Motivo:* uma duplicata não confirmada não pode liberar a parte do proprietário.
- **A saída do `devolvido_por_fora` é sempre gravada** *(segue o desenho)*. *Antes:* o registro de um MED ou de uma
  reclamação que explicava a devolução tirava o aviso só da lista em memória antes da gravação única dos avisos; quando o
  resto da lista não mudava, a gravação era pulada e o aviso continuava no pagamento. *Agora:* a saída vai pelo `desligar`
  de `sincronizarAvisosDaDisputa`, como os outros avisos do pagamento.
- **A página do hóspede depois do resultado de "Cancelar a reserva contestada"** *(segue o desenho, "Estados da página":
  "enquanto a disputa não termina")*. *Antes:* a página ficava em `cancelada_em_conferencia` enquanto o pagamento estava
  contestado, e a disputa perdida deixa o pagamento contestado para sempre: "Estamos conferindo a devolução…" nunca saía.
  *Agora:* a página segue as linhas da disputa dos pagamentos da reserva: em curso, `cancelada_em_conferencia`; perdida
  (o resultado confirmado pela equipe), `cancelada_devolvida`, com a frase nova editável `cancelamentoDevolvidoPelaDisputa`
  ("O dinheiro desta reserva voltou a você pelo banco ou pelo Mercado Pago."; sem a palavra "contestação"); ganha ou
  encerrada sem efeito, `cancelada_sem_devolucao`, como antes. Sem linha nenhuma (lido antes do M8.2e), a situação do
  pagamento, como antes. *Motivo:* a página não pode prometer uma conferência que já terminou.
- **O teto do pago com uma disputa já perdida** *(segue o desenho, "Valor em risco": a soma nunca passa do pago)*.
  *Antes:* o valor em risco somava só as disputas não finais; com duas disputas confirmadas no mesmo pagamento, a perdida
  saía da conta e a outra voltava a poder segurar (e perder) o pago inteiro, e "Confirmar o resultado" aceitava qualquer
  perda até o pago: a soma das perdas podia passar do que entrou. *Agora:* `perdidoNoPagamento` (`contestacao-leitura.ts`)
  soma o que as perdidas do pagamento já levaram (o valor perdido; no pagamento sem reserva, o contestado ou o pago); o
  valor em risco das outras parte desse total (`recalcularDisputas`), a proposta do valor perdido nunca passa do que sobra,
  e "Confirmar o resultado" recusa uma perda acima disso (`textoPerdaAcimaDoQueSobra`). *Motivo:* o dinheiro perdido nas
  disputas de um pagamento nunca passa do que ele pagou.
- **O prazo dos documentos no registro pela equipe** *(segue o desenho, "Registro pela equipe")*. *Antes:* o registro aceitava
  um prazo anterior ao dia em que a disputa abriu (o formulário só limitava pelo dia da aprovação), e a disputa já nascia
  com o prazo vencido nos avisos. *Agora:* o prazo vai do dia da abertura em diante, no servidor e no formulário (como em
  "Informar o prazo").
- **A data do envio dos documentos** *(segue o desenho, "Painel", ações: "Documentos enviados no painel do Mercado
  Pago" com a data)*. *Antes:* "Documentos enviados no painel do Mercado Pago" aceitava qualquer dia desde a aprovação
  do pagamento, no servidor e no formulário; numa disputa aberta
  dias depois da aprovação, uma data anterior à abertura ficava gravada para sempre (a marca é uma vez só) e tirava o
  aviso do prazo. *Agora:* uma regra só, `desdeADefesa` (`contestacao.ts`): o envio dos documentos e o prazo deles vão do
  dia da abertura no Mercado Pago em diante, ou, sem ela, do dia em que o sistema viu ou a equipe registrou a disputa
  (nunca antes da aprovação); o domínio e o formulário leem dali. O débito continua desde a abertura no Mercado Pago ou,
  sem ela, desde a aprovação (`desdeAberturaDaDisputa`: o débito pode vir antes de o sistema ver a disputa), e o
  formulário dele passa a ler a mesma regra do domínio. *Motivo:* a defesa só começa depois de a disputa abrir.
- **"Pedir o cancelamento" pelo hóspede com a disputa registrada** *(segue o desenho, "Minha reserva": o botão some com a
  disputa em curso ou perdida)*. *Antes:* o botão sumia, mas o pedido (`pedirCancelamentoPeloHospede`) não conferia a
  disputa: um formulário aberto antes, ou o envio direto da ação, gravava o pedido num pagamento que segue aprovado com um
  MED registrado ou um caso tardio da Chargebacks API. *Agora:* o pedido recusa ("fale com a equipe") antes e de novo sob a
  trava, pela mesma regra do botão.
- **O pagamento contestado sem linha no quadro, para o hóspede** *(segue o desenho, "Estados da página" e "Minha
  reserva")*. *Antes:* a leitura ambígua (`contestacao_ambigua`, que não cria linha) ou o pagamento contestado antes do
  M8.2e deixavam Minha reserva sem o botão e sem explicação nenhuma, e a página da reserva sem a frase "pagamento em
  conferência". *Agora:* uma regra só, `disputaDoPagamentoOuSituacao` (`contestacao-regras.ts`): a disputa de cada pagamento
  é a das linhas dele, ou, sem linha nenhuma, a situação dele (contestado é em curso). Minha reserva, o pedido de
  cancelamento, a página da reserva e a da reserva cancelada pela disputa leem dali (esta última já usava a situação
  quando a reserva não tinha linha nenhuma; agora decide pagamento a pagamento). *Motivo:* o hóspede nunca fica sem saber
  por que não pode pedir o cancelamento.
- **A disputa de parte do valor perdida, na reserva cancelada pela disputa** *(segue o desenho, "Estados da página")*.
  *Antes:* qualquer disputa perdida levava a página a `cancelada_devolvida` ("O dinheiro desta reserva voltou a você…"),
  também numa disputa de parte do valor ou de um só dos pagamentos da reserva, com o resto ainda retido. *Agora:* só
  quando o que as perdidas levaram (`perdidoNoPagamento`, a mesma conta do teto do pago, somada nos pagamentos da
  reserva) cobre o retido da reserva (`reservas.valor_retido`); senão, `cancelada_em_conferencia` ("Estamos conferindo a
  devolução com o Mercado Pago; a nossa equipe fala com você."), e a equipe trata o resto com o hóspede. *Motivo:* a
  página nunca diz que o dinheiro todo voltou quando só parte voltou.
- **"Confirmar que é outra disputa" num MED ou numa reclamação que a leitura já mostra como devolução** *(segue o desenho,
  "Lançamentos", o retido do MED)*. *Antes:* o registro de um MED que a leitura já mostrava como devolução lançava o
  retido realizado, mas a possível duplicata confirmada depois como outra disputa ganhava só o retido previsto; depois
  dos 85 dias, nenhuma leitura da order o corrigiria, e a saída de caixa que já aconteceu ficava prevista para sempre.
  *Agora:* `confirmarOutraDisputa` faz a mesma sequência do registro (`recalcularDisputas` sem caixa e
  `lancarRetidoRealizado`, no dia em que a leitura viu a devolução, pelo que esta disputa explica). *Motivo:* o caixa
  registra a saída que já aconteceu.
- **O teto da perda no pagamento sem reserva** *(segue o desenho, "Pagamento sem reserva": o que a SCL perde é a taxa)*.
  *Antes:* "Confirmar o resultado" aceitava até a taxa mais o custo do parcelamento cobrado da SCL
  (`custo_parcelas_vendedor`), que já está dentro da taxa (`financeiroDoPagamento`); e cada disputa perdida do mesmo
  pagamento podia perder a taxa inteira, lançando a mesma taxa como despesa mais de uma vez. *Agora:* o teto é a taxa do
  pagamento menos o que as outras perdidas dele já levaram (`taxaJaPerdidaNoPagamento`, `contestacao-leitura.ts`); a
  proposta do valor perdido segue o mesmo teto (zero quando outra disputa já levou a taxa), e a recusa diz quanto as outras
  já levaram. *Motivo:* a taxa de um pagamento é cobrada uma vez só.
- **A data do resultado** *(segue o desenho, "Confirmar o resultado": a data entre a abertura e hoje)*. *Antes:* o mínimo
  era o dia em que o sistema viu ou a equipe registrou a disputa (`aberta_em`); numa disputa registrada ou achada dias
  depois de abrir, um resultado verdadeiro entre a abertura e o registro era recusado (e o formulário levava ao mesmo
  mínimo, forçando uma data falsa). *Agora:* o mínimo é o da abertura no Mercado Pago (`desdeAberturaDaDisputa`, a mesma
  regra do débito; sem ela, a aprovação), no domínio e no formulário (`ResultadoNaTela.desde`). Os passos da defesa
  (documentos e prazo, `desdeADefesa`) continuam a partir da abertura ou, sem ela, do dia em que o sistema viu a disputa.
  *Motivo:* o resultado, como o débito, pode vir antes de o sistema ver a disputa.
- **O id da conta dentro dos 8 s da chamada** *(segue o desenho, "Rotina", orçamento de 60 s com 8 s por chamada)*.
  *Antes:* num cliente novo, a primeira chamada da Chargebacks API lia antes o id da conta (GET /users/me, para o
  X-Caller-Id) com 8 s próprios, e o pedido do caso tinha mais 8 s: uma chamada do provedor podia levar 16 s, e a volta
  passava do orçamento mais do que uma chamada. *Agora:* os 8 s valem para o método inteiro (`chamarContestacoes`,
  `mercadopago.ts`): a leitura do id sai do mesmo prazo, e o pedido à Chargebacks API fica com o que sobrar (sem sobra, a
  chamada falha por tempo, como as outras). *Motivo:* o orçamento conta cada chamada do provedor como no máximo 8 s.
- **"Voltou a aprovado" pela order, com a contestação que o pagamento não registra** *(segue o desenho, "De onde vem
  cada fato", item 1)*. *Antes:* a correção anterior (a Payments API, depois dos 85 dias) não valia para a leitura da
  order: dentro dos 85 dias, a order aprovada de novo, sem disputa listada, só dava o fato com o pagamento `contestado`; a
  contestação no cartão registrada pela equipe (o pagamento continua `aprovado`) ficava aberta. *Agora:* uma regra só,
  `comContestacaoNoCartaoEmAberto` (`contestacao-regras.ts`; desde a rodada seguinte, `voltouAAprovadaTemDisputa`, abaixo):
  a leitura da order e a da Payments API dão o fato sempre que há uma contestação no cartão não final no quadro, de
  qualquer origem; a disputa vai para `a_confirmar` e a equipe confirma o resultado, como sempre.
- **Um orçamento só para a volta das disputas** *(segue o desenho, "Rotina", orçamento de 60 s)*. *Antes:* a releitura das
  disputas abertas e a busca tardia da mesma volta tinham 60 s cada (até uns 120 s na volta). *Agora:* as duas dividem um
  orçamento só, contado do início da volta (`disputasDaVolta` na rotina e no "Conferir agora" da empresa,
  `conferirContestacoesDoPagamento` no de uma reserva): a busca usa o que a releitura deixou, e o que não coube fica para a
  próxima volta, com a vez intacta. *Motivo:* a volta tem de caber no tempo da função.
- **"Voltou a aprovado" depois de uma disputa perdida** *(segue o desenho, "Transições": a leitura que contradiz uma linha
  final liga `contestacao_resultado_mudou`)*. *Antes:* o fato só valia com uma contestação no cartão não final; com a
  única disputa já confirmada como perdida, a order (ou a Payments API) de novo aprovada, sem disputa listada, não dava
  fato nenhum, ou era tida como explicada pela linha final, e a perda definitiva e o livro ficavam sem aviso. *Agora:* a
  regra (`voltouAAprovadaTemDisputa`) inclui a contestação no cartão perdida; sem id e só com linhas finais, o fato vai para
  a perdida mais nova (a ganha mais nova o explica; a sem efeito não conta); a perdida contradita pela transação de volta a
  aprovada liga o aviso, sem mudar a linha, a situação do pagamento nem o livro (a correção é da equipe, por um ajuste), e
  "Conferir o aviso" o tira até um fato novo. O fato da order sem lista fala só da contestação no cartão (`soDoTipo`), como
  o da Payments API. *Motivo:* "avisar em vez de supor".
- **O e-mail da abertura com o dia em que a disputa abriu** *(segue o desenho, "Painel", "E-mail à equipe")*. *Antes:* o e-mail
  dizia o dia do registro (ou da primeira leitura). *Agora:* diz a abertura no Mercado Pago (a data que a equipe informou,
  ou a do caso), como o quadro; sem ela, o dia em que o sistema a viu.
- **A liberação lida pela Payments API depois dos 85 dias** *(segue o desenho, "Taxa, liberação e recebimento": a liberação
  sob disputa só à mão, com o aviso)*. *Antes:* a leitura do pagamento pelo número (`situacaoDoPagamento`) trazia o
  `money_release_status`, mas a disputa só usava a situação: um pagamento em disputa liberado depois dos 85 dias nunca
  ligava `contestacao_liberacao_lida`, e o resultado podia propor que o líquido nunca entrou. *Agora:* uma regra só para o
  status (`liberadoPeloStatus`, `provedor.ts`: o financeiro da order e a Payments API leem dela) e uma só para o aviso
  (`avisarLiberacaoLidaNaDisputa`, `liberacao.ts`: a leitura da order e a da Payments API chamam a mesma): com a disputa em
  curso ou perdida, sem recebimento em vigor e com líquido que ainda cabe, o aviso pede o registro à mão. *Motivo:* o
  sinal do Mercado Pago é o mesmo; só muda por onde o sistema o lê.
- **O "Conferir agora" de uma reserva diz quando a leitura das disputas falhou** *(segue o desenho, "Painel")*. *Antes:* a
  falha na Chargebacks API, na busca ou na Payments API (a order lida sem problema) não entrava na mensagem, que podia
  dizer "nada mudou". *Agora:* a mensagem diz "Não deu para conferir as disputas do pagamento agora: tente de novo em
  instantes.", como o "Conferir agora" da empresa já diz das falhas.
- **A disputa perdida no cartão depois dos 85 dias** *(segue o desenho, "Transições": a leitura que contradiz uma linha
  final liga `contestacao_resultado_mudou`; e "Rotina", a busca tardia semanal)*. *Antes:* a releitura diária só pega as
  disputas `aberta` e `a_confirmar`; depois dos 85 dias (a order não é mais lida), nada lia a situação de um pagamento cuja
  disputa no cartão foi perdida, e a transação de volta a aprovada não dava aviso. *Agora:* a busca tardia semanal
  (`buscarContestacoesTardias`), na vez do pagamento, lê também a Payments API pelo número quando ele está fora da order,
  tem uma contestação no cartão perdida e nenhuma outra no cartão ainda não final (essa a releitura diária já lê). A
  leitura passa pelo mesmo casamento e pelas mesmas transições: a transação de volta a aprovada liga o aviso na perdida, e
  a liberação lida liga `contestacao_liberacao_lida` (`avisarLiberacaoLidaNaDisputa`). A perdida não volta à fila diária
  (sem espera crescente nem `contestacao_sem_fonte`). A falha dessa leitura, ou a falta de tempo para ela na volta,
  devolve a vez, como a falha da busca. *Motivo:* a perda definitiva não pode ficar sem aviso quando o Mercado Pago a
  desfaz, e a busca semanal já é a leitura dos pagamentos antigos.
- **A disputa ganha no cartão reaberta depois dos 85 dias** *(segue o desenho, "Transições": a ganha relida `in_process`
  liga `contestacao_resultado_mudou` e volta a segurar o "em curso"; "Conferir o aviso" com "A disputa foi reaberta")*.
  *Antes:* a leitura da Payments API na busca semanal (item anterior) valia só para a perdida; a ganha reaberta
  (reapresentação ou arbitragem) depois dos 85 dias não era vista: a Chargebacks API não diz `in_process`. *Agora:* a mesma
  leitura vale para a contestação no cartão ganha ou perdida (sem outra no cartão ainda não final): `charged_back/in_process`
  liga o aviso na ganha, e a equipe abre a rodada seguinte por "Conferir o aviso". *Motivo:* uma disputa ativa não pode
  ficar tida como resolvida.
- **O pagamento contestado de novo com só disputas encerradas no quadro** *(segue o desenho, "Estados da página": "enquanto
  a disputa não termina")*. *Antes:* `disputaDoPagamentoOuSituacao` só olhava a situação do pagamento quando ele não tinha
  linha nenhuma. Com uma disputa encerrada (ganha, sem efeito ou perdida) e uma leitura nova que não casou
  (`contestacao_ambigua`, o pagamento `contestado` de novo), a página do hóspede não dizia "em conferência", ou mostrava a
  perda antiga como o resultado. *Agora:* com o pagamento contestado, vale "em curso" quando o quadro não o explica (sem
  linha, só encerradas sem perda) ou com a leitura ambígua, mesmo ao lado de uma perdida; a perdida sozinha (que deixa o
  pagamento contestado) segue perdida. Uma regra, um lugar: as três telas do hóspede e o pedido de cancelamento por ele.
- **Cada chamada da volta das disputas só começa se o tempo dela cabe no orçamento** *(segue o desenho, "Rotina", orçamento
  de 60 s)*. *Antes:* o orçamento era conferido antes de cada pagamento e antes das chamadas da Chargebacks API e da
  Payments API, mas a leitura da order (`conferirTentativa`, a order e o financeiro, cada um com o tempo-limite padrão de
  15 s) começava sem conferir. Com o orçamento quase no fim, uma order lenta levava a volta a uns 75 s. *Agora:* uma regra
  só, `cabeNoOrcamento` (`contestacao-regras.ts`): uma chamada só começa se o tempo máximo dela cabe no que resta do
  orçamento. A order reserva `TEMPO_LEITURA_DA_ORDER_MS` (2 × 15 s), e a Chargebacks API e a Payments API reservam 8 s,
  na releitura e na busca tardia. A volta nunca passa dos 60 s, e o que não coube fica na vez para a próxima.
  `TEMPO_LIMITE_PADRAO_MS` (`provedor.ts`) é o tempo-limite padrão do cliente, num lugar só. *Motivo:* a volta tem de caber
  no tempo da função.
- **A devolução lida que cresce depois do MED ou da reclamação** *(segue o desenho, "Devolvido no painel do Mercado
  Pago (fora da política)": o valor vira o retido realizado da disputa, no dia em que a leitura viu a devolução)*.
  *Antes:* o retido realizado pela
  leitura era lançado uma vez só, pelo devolvido lido naquele dia. Se o Mercado Pago devolvia mais ao pagador depois (a
  devolução em partes), a leitura seguinte não mexia no retido, e o aviso `devolvido_por_fora` saía, porque o valor da
  disputa explicava o devolvido maior. O caixa ficava sem a saída que o Mercado Pago já mostrava. *Agora:* quando o que a
  disputa explica passa do retido realizado pela leitura, `lancarRetidoRealizado` estorna o realizado com a data de caixa
  de hoje e lança o `retido#N` com o valor todo, também hoje. O caixa do dia anterior não muda, o de hoje leva só a
  diferença, e o retido continua um lançamento só. Não mexe no retido conciliado nem no confirmado pela equipe (o débito
  confirmado). A devolução lida que diminui não muda o caixa: o resultado da disputa acerta. *Motivo:* o caixa acompanha a
  saída de dinheiro que o Mercado Pago mostra, sem mudar o passado.
- **As disputas que passam dos 240 dias juntas** *(segue o desenho, "Rotina": até 240 dias, depois
  `contestacao_fora_do_prazo` uma vez; até 50 por volta e o orçamento de 60 s)*. *Antes:* a consulta das disputas com mais
  de 240 dias não tinha limite nem ordem, e a marcação de cada uma (uma transação sob a trava) não conferia o orçamento.
  Um acúmulo (a rotina parada por um tempo) podia gastar a volta inteira antes da releitura e da busca tardia. *Agora:*
  as mais antigas primeiro (`aberta_em`, depois `id`), no máximo `LEITURAS_DE_CONTESTACAO_POR_VOLTA` (50) por volta. O
  orçamento é conferido antes de cada uma, e a marcação para quando ele acaba. As que ficaram são marcadas na volta
  seguinte. *Motivo:* a volta tem de caber no tempo da função, e a marcação não pode tomar o lugar das leituras.
- **A leitura da order na volta das disputas não cancela as irmãs pendentes** *(segue o desenho, "Rotina", orçamento de
  60 s)*. *Antes:* a releitura da order (`conferirTentativa`) cancelava no provedor os pagamentos pendentes que sobraram
  na cotação e relia cada um. O cancelamento e a releitura têm 15 s cada, e os 30 s reservados para a order não os
  contavam: com uma irmã pendente, a chamada passava do orçamento. *Agora:* a leitura das disputas lê a order sem
  cancelar (`semCancelar`). As irmãs ficam marcadas pelo sistema (`cancelamento_por`), e a varredura das que sobraram
  (`conferirPendentes`, que roda antes das disputas em toda volta da rotina) as cancela. *Motivo:* a volta tem de caber
  no tempo da função, e o cancelamento já tem o lugar dele.
- **Disputas abertas no mesmo instante** *(segue o desenho, "Devolvido no painel do Mercado Pago (fora da política)": o
  devolvido lido é explicado pelas disputas mais antigas primeiro)*. *Antes:* o devolvido que um MED ou uma reclamação
  explica descontava as outras abertas "até o mesmo instante". Com duas abertas no mesmo instante, cada uma descontava a
  outra: com 500,00 devolvidos e duas disputas de 500,00, nenhuma ganhava o retido realizado, e o caixa ficava sem a saída
  que o Mercado Pago já mostrava. *Agora:* uma ordem só, `ordemDeAbertura` (`contestacao-regras.ts`): pela abertura e,
  no mesmo instante, pelo id. Uma regra, um lugar: o valor em risco, o devolvido que cada disputa explica, o acerto do
  retido lido, a primeira disputa não final e o tipo da disputa em curso. *Motivo:* o mesmo fato tem de dar o mesmo
  caixa, sem depender de empate.
- **O estado lido que o painel não conhece** *(segue o desenho: o estado fora da lista é "desconhecido" e nunca
  sobrescreve o último conhecido)*. *Antes:* o quadro "O que o Mercado Pago mostra" traduzia o estado gravado por uma
  lista sem frase de reserva. O estado gravado é sempre um dos conhecidos (o desconhecido vai só no código), mas um valor
  de fora da lista (uma versão futura, um dado antigo) aparecia como "Situação: undefined". *Agora:* a lista exige uma
  frase para cada estado conhecido (`Record<EstadoConhecidoContestacao, string>`), e o que não está nela diz "situação
  que o sistema não conhece", com o código lido, como já acontecia com a documentação. *Motivo:* avisar em vez de supor,
  e nunca mostrar um texto quebrado.
- **A liberação opcional no "Ganhou" começa em branco** *(segue o desenho, "A reserva enquanto a disputa está aberta":
  o "Ganhou" oferece registrar a liberação ali mesmo, com data e líquido)*. *Antes:* sem recebimento do pagamento, o
  líquido da liberação vinha preenchido com o lido no Mercado Pago, e a data em branco. A ação pede os dois ou nenhum,
  então o "Ganhou" sem registrar a liberação era sempre recusado até a equipe apagar o valor. *Agora:* os dois campos
  começam em branco. O líquido lido aparece ao lado do campo ("o Mercado Pago mostra R$ …") e como sugestão dentro dele,
  sem ir no envio. *Motivo:* o opcional não pode travar a confirmação, e o valor do Mercado Pago continua à vista para
  quem registra.

### Mudanças nas outras seções deste arquivo (no mesmo PR)

Feitas em 11/10/2026: cada seção diz "desde o M8.2e" (ou "desde 11/10") ao lado do texto anterior.

- **"As cinco partes":** a linha do M8.2e ("pronta em …") e o parágrafo "falta o M8.2e".
- **"Tabelas":** a migração 0069 (resumo).
- **"Ordem das travas":** as contestações depois das alterações.
- **"Situação local":** a frase das transições ganha a saída contestado → situação de antes pela disputa ganha.
- **"Verificação do banco (3DS)":** "O M8.2e decide quem arca… pelo `tres_ds_status`" vira "a frase da causa `fraude`
  segue o `tres_ds_status`; quem decide é a equipe (seção Contestação (M8.2e))".
- **"Taxa e liberação" (M8.2b) e "Taxa, liberação e recebimento":** a liberação sob disputa (só à mão) e o
  `precisaFinanceiro` pela situação explicada.
- **"Contestação (gancho para o M8.2e)":** "desde o M8.2e, ver a seção Contestação (M8.2e)". O "nunca `case_id`, `id`
  ou `references`" e "o aviso assinado continua ignorando ids numéricos" viram histórico, com a regra nova ao lado; "o id
  numérico… é o que chega nos avisos de contestação" é corrigido (o aviso das Orders chega como order).
- **"Aviso assinado":** "marcar também Contestações"; o id numérico continua ignorado.
- **"Conferência":** a frase "Contestação tardia … fica com o M8.2e" aponta para a rotina daqui.
- **"Confirmação", item 3,** e **"Devolução na parte (a)":** o dinheiro que chegou contestado segue a disputa (resultado
  confirmado); o por fora continua recusado enquanto ela não é ganha.
- **"Cancelamento pela política (M8.2c)", "A regra":** a rota "Cancelar a reserva contestada" com o registro de decisão
  acima; **"Devolução":** a devolução substituída pela disputa e a confirmada pela disputa.
- **"Devolvido no painel do Mercado Pago (fora da política)":** o MED e a reclamação registrados explicam a devolução lida.
- **"O que o hóspede vê":** a linha "Confirmada com o pagamento em conferência (M8.2e)", só com o cookie.
- **"Painel", "Início":** os avisos novos.
- **"Dados pessoais":** o parágrafo acima e o registro de decisão dos ids.

## O que o hóspede vê (`/reservar/<código>`)

A vista da cotação lê também a tentativa mais recente. Um pagamento aprovado ou pendente sempre vence
"expirada" e "cancelada" na tela; enquanto houver dinheiro sem desfecho, nunca aparece "faça uma nova
consulta".

| Situação | Na tela |
|---|---|
| Datas seguradas, Pix oferecido | Pix em destaque, prazo das datas; WhatsApp como opção |
| Pix aguardando | copia e cola com botão de copiar, QR, prazo; "pode fechar e voltar por este link"; sem o prazo informado pelo provedor, continua aguardando, sem contagem (nunca "vencido") |
| Pagamento recebido, confirmando | "Pagamento recebido, confirmando sua reserva" |
| Confirmada | "Pagamento aprovado: reserva SCL-… confirmada", link para Minha reserva, "guarde este link"; com outro pagamento da mesma cotação ainda não devolvido, avisa que a equipe devolve o pagamento a mais (o aviso sai quando ele volta ao hóspede) |
| Aprovado sem as datas | "Recebemos seu pagamento, mas não conseguimos garantir as datas. A equipe vai falar com você e devolver o valor integral", com WhatsApp |
| Devolução pedida / feita | o que foi pedido e quando; devolução que o Mercado Pago recusou ou não respondeu (parada, à espera da equipe) aparece como "pagamento recebido sem as datas" (a equipe fala com o hóspede), nunca como pedida; com mais de um pagamento sem reserva, "devolvido" só quando todos foram devolvidos |
| Pix vencido sem pagar, datas ainda seguradas | gerar outro (até 3), só com o Pix ainda oferecido (a página que espera recarrega quando a oferta volta) |
| Cartão: verificação do banco (M8.2b) | "Verificação do seu banco": o quadro do banco (endereço só com o cookie, conferido de novo; sem endereço válido, "Não deu para abrir a verificação do banco" e as outras opções), mais "Pagar com Pix" e "Usar outro cartão" quando oferecidos (os dois cancelam o desafio antes) |
| Cartão em análise (M8.2b) | "Pagamento em análise": o texto editável da análise e a linha fixa do prazo das datas (antes e depois do fim); continua assim mesmo depois do prazo das datas, porque a análise ainda pode aprovar |
| Cartão recusado, datas ainda seguradas (M8.2b) | "Datas seguradas" com a mensagem genérica (recusa ou verificação não concluída) e as opções que restam: outro cartão, Pix, WhatsApp; com as datas já vencidas, igual ao Pix (sem pagamento) |
| Confirmada com pedido de cancelamento esperando a equipe (M8.2c) | a reserva continua confirmada, com a linha "Pedido de cancelamento recebido em dd/mm às HH:MM (horário de Brasília)." e a frase editável de que a equipe confirma por escrito o valor (sem política aceita, a frase fixa sem citar política); "Acompanhe ou peça pelo seu acesso: Minha reserva" |
| Confirmada com o pagamento em conferência (M8.2e) | só com o cookie de quem pagou (`autorizadoNaCotacao`): "Reserva confirmada" e a frase editável `pagamentoEmConferencia` ("O pagamento desta reserva está em conferência com o Mercado Pago…", até 240 caracteres; vazia = nada); sem o cookie, só "Reserva confirmada". Nunca a palavra "contestação" nem acusação. A linha some com o resultado da disputa |
| Reserva cancelada, devolução pedida (M8.2c) | "Reserva cancelada": quem cancelou e quando o pedido chegou, "devolvemos o valor integral pago, R$ …, sem desconto de taxas", "Já pedimos a devolução ao Mercado Pago…" e como o dinheiro volta (Pix ou cartão; com partes por caminhos diferentes — reserva no Pix e diferença no cartão, ou uma parte devolvida por fora —, a frase de cada caminho usado, na mesma regra da devolução da diferença de uma alteração; com alguma parte por fora, o total nunca é dito "pelo Mercado Pago"). Também na devolução aceita ainda sem confirmação, no cartão com mais de 78 dias ("Estamos pedindo o estorno no seu cartão…", enquanto a devolução por fora do cartão não abre) e no cartão recusado com a devolução por fora ainda fechada |
| Reserva cancelada, devolvida (M8.2c) | "Devolução de R$ … confirmada pelo Mercado Pago em dd/mm" (o valor lido, quando a leitura o traz), "feita pelo Mercado Pago em dd/mm" (confirmada pela equipe) ou "feita em dd/mm" (por fora, com a frase da transferência e sem linha da forma de pagamento) |
| Reserva cancelada, com a equipe (M8.2c) | "A devolução de R$ … pelo Mercado Pago não foi possível." e a frase editável de que a equipe combina outra forma, sem custo (Pix recusado, ou cartão com a devolução por fora já aberta) |
| Reserva cancelada, em conferência (M8.2c) | devolução a menos, pagamento contestado ou devolvido em parte, devolução parada por um problema (desde o M8.2e, também a reserva cancelada por "Cancelar a reserva contestada", enquanto a disputa não termina, e depois da perdida que não cobre todo o retido; perdida e cobrindo o retido, a página diz que o dinheiro voltou pela frase `cancelamentoDevolvidoPelaDisputa`, desde a revisão do Codex de 11/10): "Estamos conferindo a devolução com o Mercado Pago; a nossa equipe fala com você." Nunca oferece outro jeito de pagar |
| Reserva cancelada sem devolução (M8.2c) | os prazos da política aceita ("Prazo de reembolso integral: pedidos até dd/mm, às 23h59." e o arrependimento, quando vai além) e a frase do caso (fora do prazo, não comparecimento, ou decisão da equipe sem política) |
| Reserva cancelada, devolução esperando a liberação (M8.2d) | o restante de um pagamento já devolvido em parte, que só é pedido depois da liberação: "…previsto para dd/mm" e a frase editável `devolucaoAguardaLiberacao` ("Ela será pedida ao Mercado Pago quando ele liberar o seu pagamento…"), nunca "Já pedimos" |
| Alteração segurada (M8.2d) | "Alteração da sua reserva": de/para (datas, noites, pessoas, valor, diferença), "Datas seguradas até HH:MM (horário de Brasília)" (ou "dd/mm às HH:MM"), a frase do rumo e a linha da política; no aumento, o Pix e o cartão da diferença (com o aceite D11 quando preciso); a reserva continua como está até a confirmação |
| Alteração confirmada (M8.2d) | "Alteração confirmada": as datas, as pessoas e o valor novos e, na redução, a devolução da diferença (esperando a liberação, pedida, feita, com a equipe, em conferência) ou "não é devolvida"; a última aplicada, enquanto a devolução está aberta e por 30 dias |
| Alteração não aplicada (M8.2d) | "A alteração não pôde ser feita": "Recebemos o pagamento da diferença (R$ D) em dd/mm." e a frase de que a reserva continua como estava e o valor volta |
| Alteração que não vale mais (M8.2d) | "Alteração que não vale mais": a preparada em dd/mm, vencida ou desistida sem pagamento, por 7 dias |

Desde o M8.2b, com as duas formas oferecidas, o quadro se chama "Pagamento" e começa pela escolha
**Pix (recomendado)**, marcado e em destaque, ou **Cartão de crédito**, com a nota dos juros embaixo do
cartão; só aparecem as formas oferecidas, e cada texto muda conforme elas (por exemplo, com o máximo de
Pix e o cartão ainda oferecido: "Esta cotação já gerou o máximo de Pix. Você ainda pode pagar com cartão
de crédito."). No Pix aguardando, "Prefere pagar com cartão?" abre o formulário (o envio cancela o Pix no
Mercado Pago e o relê: pago nesse meio = "já recebemos"). A caixa de aceite aparece em toda situação em
que o Pix ou o cartão podem ser oferecidos (uma lista só, `ESTADOS_QUE_PAGAM`, que decide também a
oferta). Nunca "Gerar outro Pix" para um cartão. Com o cartão ligado, "por Pix" vira "por Pix ou cartão"
na cotação e ao segurar as datas.

Desde o M7.4, o "Gerar Pix" (na primeira vez e no "Gerar outro Pix") leva a caixa de aceite das
páginas legais enquanto a cotação não aceitou as versões em vigor: resumo da Política de
cancelamento, a data-limite do reembolso integral desta reserva e "Li e aceito…" com o link de cada
versão. Já aceitas, só a linha "Você aceitou…"; na reserva confirmada, as versões aceitas e o prazo.

Os textos principais (convite para pagar, Pix aguardando, aprovado sem as datas e, desde o M8.2b, o
cartão em análise; desde o M8.2c, as frases do cancelamento; desde o M8.2d, as da alteração) são editáveis em Textos do site, com
texto-base. Nas cinco situações da reserva cancelada, o título é "Reserva cancelada", o botão de contato
leva a mensagem "Quero falar sobre o cancelamento da minha reserva SCL-…", o formulário do cartão nunca fica
aberto e a página não fica relendo o Mercado Pago. O convite tem texto-base neutro desde
o M8.2b ("Pague aqui mesmo: …", sem citar a forma); uma cópia salva antes continua com o texto antigo,
que fala de Pix, até Diego revisar. As mensagens de recusa do cartão não são editáveis. Os "nenhum
pagamento é feito no site" passam a depender de o Pix estar oferecido para aquele imóvel. A página
proíbe ser enquadrada por outro site e, desde o M8.2b, só enquadra o próprio site e os domínios do
Mercado Pago (`frame-src` montado de `DOMINIOS_DESAFIO`, `app/src/site/politica-de-frames.ts`): o
navegador também barra um desafio em outro endereço.

## Painel

- **Integrações** (e Sistema, pela mesma função): situação do Mercado Pago, conta de teste
  conferida ou não, ambiente, segredo do webhook, último aviso válido, assinaturas recusadas no dia,
  endereço fixo do webhook para copiar (`https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago`).
- **Configurações → Pagamento no site** (regras de venda): oferecer pagamento no site (liga e
  desliga), nome na fatura (para o cartão; padrão o nome da empresa), categoria da taxa perdida e a
  lista de imóveis com ✓ ou o motivo de não oferecer. Tudo auditado, valendo para as tentativas novas.
  A conferência da conta no Mercado Pago espera no máximo 2 s: passou disso, a aba avisa "não deu
  para conferir a conta agora" e mostra o resto (a chave para desligar nunca fica presa). Integrações e
  Sistema esperam o mesmo tanto e mostram a conta como "não conferida".
- **Ficha da reserva:** quadro "Pagamento no site". Situação, forma e datas para quem lê reservas;
  valores para quem lê o financeiro; ações (devolver, devolução por fora, registrar liberação,
  conferir agora) para quem edita o financeiro, com confirmação.
- **Cartão no painel (M8.2b):**
  - Configurações → Pagamento no site: "Oferecer cartão de crédito" (desligado), "Número máximo de
    parcelas" (vazio = o máximo do Mercado Pago; de 1 a 36) e "Verificação do banco (3DS)" com as duas
    opções; um bloco **Cartão** com a situação do disjuntor ("Ligado", "Desligado pelo disjuntor até
    HH:MM — N recusas em 30 minutos", "Desligado até alguém religar — N recusas em 24 horas"), as recusas
    das últimas 24 horas, os 5 últimos disparos, os freios fixos e **Religar o cartão** (só quem edita o
    financeiro, com confirmação). Os valores valem para as tentativas novas.
  - Configurações → Calendário e preços: "Minutos a mais que um cartão em análise segura as datas (uma vez
    por cotação; 0 = nenhum)", e a nota do prazo das datas passa a falar do cartão.
  - Ficha da reserva: "Cartão de crédito · Visa · 3x", "Valor da reserva" e a linha **No Mercado Pago**
    (order `ORD…`, referência `scl-…` e o número do pagamento na Payments API, com botão de copiar), para
    quem lê reservas: não são dados pessoais e servem para achar o pagamento no Mercado Pago. A situação
    do cartão é genérica para todos (verificação do banco até HH:MM, em análise, processando, recusado).
    Só para quem lê o financeiro: o motivo interno da recusa, com a linha fixa "Não informe o motivo ao
    hóspede: peça outro cartão ou o Pix."; a verificação do banco pedida e o resultado deste pagamento; o
    pago pelo hóspede com os juros ("inclui R$ X de juros do parcelamento, que ficam com o Mercado
    Pago"); o custo do parcelamento sem acréscimo cobrado da SCL. Nunca BIN, últimos dígitos ou titular,
    mesmo que o Mercado Pago os mande (a leitura por lista branca os ignora). Bandeiras por extenso
    (`master` → Mastercard, `amex` → American Express…).
  - Início (empresa toda): disjuntor aberto, recusas a partir de 10 em 24 horas, recusas por token, cartão
    em análise há mais de um dia (seção "Cartão"), e o alerta de criação sem resposta fala de
    "pagamento(s) do site", não só de Pix. Integrações: o aviso de chave pública e token de contas
    diferentes.
- **Financeiro → Pagamentos do site:** lista por período com filtro "pede atenção".
- **Início** (para a empresa toda, sem depender do filtro de imóveis): aprovado sem desfecho (a
  devolver), dinheiro que chegou já devolvido em parte ou contestado antes da decisão (alerta
  próprio: resolver no painel do Mercado Pago; o sistema passa a cuidar disso no M8.2d — desde 10/10, "devolva o
  restante pelo quadro do pagamento"; desde 11/10, no contestado, "(acompanhe a disputa pelo quadro do pagamento)"),
  devolução pedida ou recusada,
  liberação prevista vencida sem sinal, criação do pagamento sem resposta do Mercado Pago há mais que a
  carência, conta das chaves que não é de teste, configuração inválida,
  aviso com `live_mode`, dinheiro sem cálculo, e o informativo "N reserva(s) do site paga(s): feche as
  datas nas OTAs (no Beds24, como bloqueio)." (desde 10/10, com ou sem o envio ao Beds24 ligado; antes, só com ele
  desligado: ver a decisão em "OTAs e o gancho do M8.3" do M8.2d).
- Até o M8.3, a equipe fecha as datas no Beds24 como **bloqueio**, nunca como reserva (a importação
  criaria uma segunda reserva).
- **Cancelamento no painel (M8.2c):**
  - Configurações → Pagamento no site: "Hóspede pode pedir o cancelamento em Minha reserva (reservas pagas
    pelo site)" (ligado) e "Não comparecimento: horas depois do horário de entrada" (0 a 72, padrão 21).
  - Configurações → Páginas legais do site, Política de cancelamento: a caixa "O arrependimento vale só até o
    horário de entrada (como no texto-base)…" (`PAGINAS-LEGAIS.md`).
  - Configurações → Textos do site: as frases do cancelamento. Configurações → Modelos de mensagem: as três
    mensagens, com o texto-base de cada uma para copiar.
  - Ficha da reserva paga pelo site: o botão de cancelar de sempre some; dentro do quadro "Pagamento no
    site", o quadro "Cancelamento pela política" (registrar e descartar pedido; calcular e cancelar em dois
    passos, com a prévia em linhas e o botão de cancelar só enquanto a prévia vale — mudou um campo, "calcule
    de novo"; exceção e sem política só quando a decisão permite; não comparecimento desabilitado com pedido
    ativo e com a hora a partir da qual vale) e, depois do cancelamento, as linhas "Pedido recebido em",
    "Quem cancelou", "Política", "Decisão" (a nota da exceção só para quem lê o financeiro), "Devolução" (com
    a dica do último código do Mercado Pago), "Financeiro" (resultado e caixa lançados), "Parte do
    proprietário" (saiu do financeiro, desconto lançado e se já foi descontado, ou retida), "OTAs", "Hóspede
    avisado", os pedidos descartados e as mensagens prontas para copiar. As ações da devolução novas
    ("Confirmar devolução feita no painel do Mercado Pago", "Registrar que o Mercado Pago recusou a devolução
    no painel", "Parar a devolução pedida", "Corrigir taxa que não voltou", "Pedir a devolução de novo")
    aparecem só quando o domínio permite, sempre com confirmação. O resultado de cada ação volta com um texto
    fixo.
  - Valores só para quem lê o financeiro; a operação vê situação, datas e as mensagens sem valor.
  - Lista de reservas: filtro "Pedido de cancelamento → Só com pedido esperando a equipe", de qualquer
    período. Financeiro → Pagamentos do site e o quadro dizem "Reserva cancelada: devolução pedida /
    devolvida / com a equipe / em conferência / sem devolução (valor retido)".
  - Início: para quem edita reservas (sem valores), os pedidos esperando, as datas a reabrir nas OTAs (desde 10/10,
    com ou sem o envio ao Beds24 ligado); para quem lê o financeiro, as mensagens ao hóspede pendentes, as devoluções
    pedidas e paradas (de qualquer origem), as de pagamento com mais de 78 dias, as feitas a menos, as reservas
    devolvidas no Mercado Pago fora da política e o desconto de proprietário esperando há mais de 7 dias.
    "Pede atenção" inclui o pagamento com pedido de cancelamento esperando.
- **Alteração no painel (M8.2d):**
  - Configurações → Calendário e preços, "Site público": "Minutos que as novas datas de uma alteração de reserva
    paga pelo site ficam seguradas" (padrão 60, de 5 a 2880), com a nota "o Pix da diferença estende o prazo. Não muda
    o tempo do site." Configurações → Textos do site: as frases da alteração. Configurações → Modelos de mensagem:
    as duas mensagens da alteração e "Devolução feita (cancelamento ou alteração)".
  - Ficha da reserva paga pelo site, no quadro "Pagamento no site", o bloco **Alteração da reserva**: o formulário em
    dois passos (só com a reserva confirmada, sem pedido de cancelamento, sem outra alteração segurada e antes da
    entrada; depois dela, a frase do D1), a alteração segurada (o que espera, as tentativas da diferença, "Copiar a
    proposta", "Conferir para aplicar (o hóspede aceitou)" sem aumento, "Desistir da alteração"), a última aplicada
    e as que ainda esperam o bloqueio nas OTAs (antes e depois, a devolução da diferença, o financeiro por mês
    "Antes / Depois / Diferença", "Datas atualizadas nas OTAs" quando as datas mudaram, as mensagens e "Hóspede
    avisado") e o histórico (aplicadas, vencidas e desistidas: data, de → para, quem, resultado; valores só com
    `financeiro:ler`). O resultado de cada ação volta por uma chave fixa (`?alteracao=`).
  - A ficha da reserva-pedido mostra só "Datas seguradas para a alteração da reserva SCL-… até HH:MM", sem e-mail,
    Confirmar, Cancelar e Horários. Sem `financeiro:ler`, nenhum R$ na ficha, nas observações e no histórico
    (`diferenca` entrou em `CAMPOS_FINANCEIROS`).
  - Quadro "Pagamento no site": **uma linha por devolução** ("Devolução da alteração de dd/mm | do cancelamento | do
    pagamento sem reserva | Restante de uma devolução", com a situação: aguardando a liberação do pagamento (prevista
    para dd/mm), pedida, confirmada (com o valor que o Mercado Pago devolveu, quando outro), por fora, recusada,
    "substituída pela devolução do cancelamento") e as ações que o domínio permite para ela, cada uma com o id da
    devolução: pedir de novo (escondido com outra devolução do pagamento pedida), "Pedir o restante ao Mercado
    Pago", "Registrar o restante devolvido por fora" (no cartão só quando a regra permite), "Confirmar devolução
    vista no painel do Mercado Pago" (com o valor), recusa do painel, parar, por fora, taxa que não voltou;
    "Devolver o restante ao hóspede" no pagamento sem reserva já devolvido em parte (sem o valor do Mercado Pago, o
    formulário pede o valor do painel dele e não mostra número); o pagamento da diferença aparece como "Diferença de
    uma alteração da reserva". No quadro do cancelamento, a linha "Devolução" mostra a de cada pagamento (o da
    diferença também, e o restante). A devolução que manda no pagamento é a mais nova pela criação.
  - Início: seção "Alteração de reserva paga (M8.2d)", "Início".
- **Disputa do pagamento no painel (M8.2e):** o bloco **Disputa** por linha no quadro "Pagamento no site" (com as ações,
  cada uma com `BotaoConfirmar`, e o resultado pela chave `?contestacao=`), "Registrar disputa vista no painel do
  Mercado Pago" no quadro do pagamento, a página para imprimir "Documentos para a defesa", Financeiro → Pagamentos do
  site (filtro "Com disputa" e a coluna "Disputa"), Configurações → Pagamento no site (a categoria da perda por disputa,
  os dias de aviso do prazo dos documentos e os nomes e as frases das causas) e Textos do site
  (`pagamentoEmConferencia`). Os avisos novos do Início (`avisosDeContestacao`, em `painel/dashboard.ts`, e
  `avisosDeContestacaoNosRepasses`, em `repasses/avisos-contestacao.ts`): sem decisão de quem arca (e a escalada depois de
  15 dias), prazo dos documentos (informativo, atenção, passou, desconhecido), resultado a conferir, perdida sem decisão,
  estadia por vir, repasse a pagar com parte de reserva em disputa, possível duplicata, disputa ambígua, caso de outro
  pagamento, resultado que mudou, leituras em conflito, ganha sem recebimento, dia 85 sem fonte, 240 dias e o débito
  disponível não descontado há mais de 7 dias. Seção "Contestação (M8.2e)", "Painel".

## Dados pessoais

O adaptador lê por lista branca (ids, situação, código de detalhe de lista fechada, valores em
centavos, datas) e nunca devolve nem grava a resposta crua. Erros com tipo e código fechados; o
registro do servidor só leva códigos. Nada de dado do pagador em tentativas, eventos, auditoria ou
estado das ações. Teste: depois de um fluxo completo com o provedor falso, nenhum e-mail ou documento
do pagador aparece nessas tabelas.

**Cartão (M8.2b).** Pode ser guardado: forma, tipo (crédito), bandeira, parcelas, valor pago (com os
juros), códigos de detalhe, `tres_ds`, `tres_ds_status`, `etapa_cartao`, `desafio_url` (apagado depois),
`com_dispositivo`, `encerrado_em`, `cancelamento_por`, `conta_no_disjuntor`, `id_pagamento_provedor`,
`custo_parcelas_vendedor`, `aceite_id` e `live_mode`. **Nunca** guardado nem registrado: token do cartão,
BIN, últimos dígitos, titular, CPF ou outro documento, e-mail do pagador, id do aparelho, ids dos casos de
contestação (*desde o M8.2e*, os ids do caso, da contestação e da transação são guardados: registro de decisão na seção
"Contestação (M8.2e)", "Tabelas"), IP (além das chaves do freio, de cerca de 24 h), os dados crus do Brick (`formData`,
`additionalData`, a mensagem de erro) e a resposta crua do provedor. Disparos do disjuntor e auditorias
só com contagens, horários e ids de usuário. O motivo da recusa só aparece para quem lê o financeiro. O
teste de dados pessoais (`semDadosPessoais`) percorre `pagamentos`, `eventos_pagamento`, `auditoria`,
`aceites_site`, `disjuntores_cartao` e `tentativas_login` depois dos fluxos aprovado, recusado, em análise
e com desafio (token, CPF, id do aparelho, e-mails e o nome de teste "APRO").

**Cancelamento (M8.2c).** Pode ser guardado: horários, códigos de canal e de quem cancela, o retrato da
política e da decisão, motivos de lista fechada, valores, ids de usuário, notas validadas (até 300 caracteres),
`valor_retido`, os valores lidos e os códigos da devolução, e lançamentos com o código da reserva na descrição.
**Nunca:** nome, e-mail, telefone, CPF, chave Pix ou dados bancários do hóspede (o por fora é só data, valor e
nota), dado de cartão, a mensagem do pedido, ids de devolução além de `id_provedor` (`refunds[]` vive só na
memória; `e2e_id` nunca é lido). **Validador em tempo de execução** (`textoSemDadosPessoais`,
`lib/dados-pessoais.ts`), chamado por toda ação e função que grava uma nota (cancelamento, pedido, descarte, por
fora — também a do M8.2a —, confirmação da equipe, recusa do painel, parada, correção da taxa, motivo do estorno
da liberação): recusa e-mail, CPF e CNPJ (com ou sem pontos), 6 ou mais algarismos seguidos depois de tirar
`. - / ( )` e espaço (telefone, CPF, cartão), "final 1234", formato de UUID ou chave Pix aleatória e "chave"
junto de um desses; passam "14h10", "10/10" e "R$ 1.500,00". Texto fixo: "Tire dados pessoais da nota (CPF,
e-mail, telefone, chave Pix, cartão)." A auditoria nunca copia notas; o e-mail à equipe é conteúdo restrito e não
leva nome nem e-mail; as mensagens prontas são montadas na hora e nunca gravadas. `semDadosPessoais` percorre
também `devolucoes_pagamento`, `cancelamentos_reserva` e `lancamentos`, depois de cada fluxo (com o nome do
hóspede de teste).

**Alteração (M8.2d).** Pode ser guardado: em `alteracoes_reserva`, datas, números de pessoas, valores, códigos de
listas fechadas, o retrato da política, ids de usuário e notas validadas (até 300 caracteres: a nota do pedido, o
motivo da decisão, a nota do motivo do valor, o motivo da desistência); na reserva-pedido, o nome "Alteração
SCL-…", sem e-mail nem telefone, e observações sem valores; em `pagamentos.devolvido_fora_reconhecido` e nas
colunas novas de `devolucoes_pagamento`, ids, códigos, valores, um horário e um booleano. **Nunca:** nome, e-mail,
telefone, CPF, chave Pix, dados bancários ou de cartão do hóspede, a mensagem do pedido, ids de devolução além de
`id_provedor` (`refunds[]` e os ids conhecidos vivem só na memória). Toda nota passa por `textoSemDadosPessoais`;
a auditoria nunca copia notas; os valores ficam na auditoria das entidades `alteracao` e `pagamento`, e a
auditoria `reserva.alterar` só leva `valorBruto` (escondido sem `financeiro:ler`). As observações da reserva levam
datas e pessoas, nunca valores. `semDadosPessoais` percorre também `alteracoes_reserva` e as reservas-pedido.

**Contestação (M8.2e).** Pode ser guardado: os ids do caso, da contestação (`CBK…`) e da transação (registro de decisão
de 11/10 na seção "Contestação (M8.2e)", "Tabelas": são identificadores do Mercado Pago para a disputa, sem dado de
ninguém, e a única forma de ler o caso depois dos 85 dias); códigos de listas fechadas, o `reason_id` e o código do
motivo (só `^[a-z][a-z0-9_]{0,39}$`), valores, datas, booleanos de cobertura, o retrato do `tres_ds_status`, ids de
usuário, notas validadas (até 300 caracteres) e a explicação ao proprietário, também validada. **Nunca:** nome, e-mail,
telefone, CPF, chave Pix ou dados bancários e de cartão do hóspede ou do titular; o `reason` em texto livre; a
documentação do caso (arquivos, endereços, descrições); a resposta crua. A página "Documentos para a defesa" é montada na
hora e nunca gravada; o e-mail à equipe leva só o código da reserva e o imóvel. `semDadosPessoais` percorre também
`contestacoes_pagamento` e `eventos_contestacao`, depois dos fluxos aberta → ganha, aberta → perdida, sem identificação →
com caso, registro da equipe, MED, duplicata e reabertura (`contestacao-dados.test.ts`, que também planta um valor em
cada tabela para provar que a varredura as lê); os testes de cada fluxo da disputa conferem o mesmo depois de cada caso.

O texto-base da Política de privacidade (`paginas-legais-rascunho.ts`) diz agora, na linha do
pagamento: "no cartão, também a bandeira, o número de parcelas, o valor pago com os juros e o resultado
da verificação do banco, nunca o número do cartão". Versão publicada nunca muda por código: Diego
publica uma versão nova antes de ligar o cartão.

## A conferir no sandbox (Diego e Claude)

1. Qual campo de `GET /users/me` marca a conta de teste.
2. Se a Payments API acha o pagamento de uma order pela referência (taxa, líquido, liberação) e qual
   campo diz "liberado" de forma explícita.
3. O endereço e a janela da busca de orders pela referência.
4. O que uma repetição com a mesma chave depois de um tempo esgotado devolve.
5. Se o `data.id` da assinatura vai em minúsculas e se o reenvio traz `ts` novo.
6. Se o Pix de teste aprova sozinho com o nome APRO e se vem a imagem do QR.
7. Se a taxa volta na devolução integral (registrar em `RECEBIMENTO-SITE.md`). Até lá, a equipe
   informa a taxa que não voltou.
8. O valor de `live_mode` nas orders do usuário de teste (se vier `true`, todo Pix do teste é
   cancelado na hora: ver o desvio em "Variáveis e travas").

Cartão (M8.2b):

9. Se o corpo do cartão é aceito com `capture_mode: "automatic"` e `config.online.transaction_security`,
   e se o resultado vem na hora (não `processing/in_process` toda vez). Se o Mercado Pago recusar o campo
   `capture_mode`, tirá-lo.
10. O formato do 402 de um cartão recusado (`errors[]` com `data` trazendo a order, ou sem `data`), o
    prefixo do id da order (`ORD`, `ORDTST` ou nenhum) e onde vem o `status_detail`. Os dois formatos
    contam no disjuntor.
11. Situação e `status_detail` de cada nome de titular de teste (APRO, OTHE, CONT, CALL, FUND, SECU, EXPI,
    FORM, INST, DUPL, LOCK, CTNA, BLAC…): toda recusa precisa mostrar o mesmo texto ao hóspede; se CONT
    dá `in_review`, `pending_review_manual` ou `in_process`, e se algum dia se resolve.
12. Com parcelas: `total_amount`, `payments[0].amount`, `paid_amount`, `total_paid_amount`,
    `installment_amount`, e se o GET devolve `payment_method.type` e `installments` (o exemplo da
    referência traz null). **Risco:** se `payments[0].amount` incluir os juros, todo pagamento parcelado
    vira `valor_divergente` (saída: comparar `total_amount` e aceitar o valor da transação maior que o
    total só com mais de 1 parcela). Se `total_paid_amount` nunca incluir os juros, tirar o sinal "pago
    igual ao valor" do parcelamento sem acréscimo.
13. `config.payment_method.installments_cost` nas orders de 1x e de várias parcelas da conta de teste
    (só para registro; não é usado).
14. Payments API pela referência no cartão: `fee_details` (`financing_fee` do comprador e
    `mercadopago_fee` da SCL; `financing_fee` da SCL com o "parcelamento sem acréscimo" ligado),
    `net_received_amount` sem os juros (senão `taxa_invalida`), `money_release_date` por plano (14 e 30
    dias), `money_release_status` de pendente a liberado, os valores de `money_release_schema` em 1x e
    parcelado com "receber à vista" ligado e desligado, e quanto tempo o pagamento leva para aparecer em
    `/v1/payments/search` depois da criação da order (regra das 24 horas).
15. 3DS com `on_fraud_risk` e os titulares APRO-CHOK, OTHE-CHNO, APRO-AUTH, APRO-ATMT e OTHE-NAUT no
    Brasil: `action_required/pending_challenge` só para CHOK e CHNO; onde vem o endereço do desafio e em
    que domínio (o exemplo da documentação é `www.mercadopago.com.ar`: se o sandbox do Brasil também usar
    `.com.ar`, acrescentar a `DOMINIOS_DESAFIO`); se o GET também traz o endereço; o tamanho do quadro; se
    o atributo `sandbox` do iframe atrapalha; origem e conteúdo do `postMessage`; os códigos finais
    (documentado: `failed/failed` para CHNO e NAUT; `canceled/expired` ou `failed/3ds_challenge_expired`
    depois de 40 minutos); maiúsculas ou minúsculas no `tres_ds_status`; se `ATTEMPTED` passa a
    responsabilidade; e se `validation: "always"` existe no Brasil. Desafios que falham ou vencem contam no
    disjuntor.
16. Aparelho: se o SDK v2 sozinho preenche `window.MP_DEVICE_SESSION_ID` (senão, acrescentar o
    `security.js`); se o `X-meli-session-id` é aceito no `POST /v1/orders`; se a falta dele dá
    `transaction_security.status = ERROR`.
17. Cancelar uma order de cartão em `processing` ou `in_review`: 409 (o nosso `nao_cancelavel`)?
18. Devolução integral de um cartão parcelado: se o hóspede recebe os juros de volta, se a taxa do
    Mercado Pago volta e o que `refunds[].amount` mostra (registrar em `RECEBIMENTO-SITE.md`; o M8.2c
    precisa da base da devolução parcial).
19. Que chave pública faz par com o token do vendedor de teste (credenciais de produção do usuário de
    teste, `APP_USR-…`); um par trocado provavelmente dá `invalid_card_token` (400 ou 402?) — o alerta de
    token do Início precisa aparecer.
20. O Brick em português mostra juros e total por parcela; `maxInstallments` acima da oferta do Mercado
    Pago é ignorado; o e-mail preenchido esconde o campo; a marca do Mercado Pago e as bandeiras aceitas
    aparecem; `types.excluded` esconde o débito — **digitar um cartão pré-pago de teste** e conferir que é
    recusado com `payment_method_not_in_allowed_types`; se não for, trocar por (ou somar) `prepaid-card`,
    a grafia da referência do SDK.
21. `statement_descriptor`: quantos caracteres aparecem de fato na fatura (50, ~10 ou 13) e se vem um
    prefixo "MERCADOPAGO*".
22. `idempotency_validation_failed` (500) no cartão: tratado como `incerto` (nunca chave nova).
23. O disjuntor na prática: 8 recusas de teste em 30 minutos o desligam na prévia (esperado); "Religar o
    cartão" funciona.
24. Devolução de um cartão aprovado **antes** de `money_release_status` virar `released`: o Mercado Pago
    tira do dinheiro a liberar ou exige saldo disponível (`devolucao_falhou`)?
25. Várias tentativas seguidas com o mesmo pagador (`test@testuser.com`) e o mesmo valor: aparece
    `high_risk` (regra de duplicidade do antifraude)? Se sim, anotar nos passos de teste do GUIA.
26. As causas de `onError` que o Brick emite de fato para: cartão de débito digitado, campos incompletos,
    BIN desconhecido, falha ao buscar as parcelas.
27. Os endereços que o Brick e o SDK carregam de fato em `/reservar` (script, quadro, conexão), com o
    `frame-src` restrito: registrar para o `script-src`/`connect-src` da produção e acrescentar qualquer
    domínio de quadro que falte (por exemplo, `*.mlstatic.com`).
28. A leitura da order depois de uma contestação (se o sandbox simular): os formatos da transação
    `charged_back/*` e de `transactions.chargebacks[]`.
29. Parcelamento sem acréscimo: com a opção ligada na conta de teste, um pagamento em 3x mostra
    `financing_fee` com `fee_payer: collector` e o pago igual ao valor (aviso `parcelas_sem_juros`, sem
    taxa automática).

Cancelamento e devolução (M8.2c):

30. Devolução integral de um Pix de teste aprovado: o código HTTP (200 ou 201), o corpo e o
    `refunds[].status` logo depois. **A order e a transação ficam em `refunded/refunded` ou em
    `processed/refunded`?** Quanto tempo até `processed`.
31. O GET depois da devolução traz `transactions.refunds[]` (id, valor, situação)? O `total_paid_amount` cai?
32. `order_refund_already_in_process` vem como 400 ou 409 nas orders da Checkout API? Uma segunda devolução
    integral, com uma em andamento, o devolve?
33. Uma devolução que falha (se der para simular): o valor de `refunds[].status` (failed, rejected,
    cancelled) e se o item que falhou mantém o mesmo id.
34. Devolução de cartão antes da liberação: `insufficient_money_for_refund` (428?) e se a chave é gasta
    (completa o item 24).
35. Devolução de cartão com juros: o hóspede recebe os juros de volta, e eles saem do saldo da SCL? (Completa
    o item 18; teto da taxa perdida; `devolucao_a_menor`.)
36. A taxa volta na devolução integral (Pix 0,99% e cartão)? Em que campo aparece (Payments
    `charges_details[].amounts.refunded`, `fee_details`, a linha REFUND do relatório da conta)? (Completa o
    item 7.)
37. `POST /v1/orders/{id}/refund` numa order com mais de 90 dias (o GET já não funciona): 404 ou funciona?
    `POST /v1/payments/{id}/refunds` num pagamento criado pela Orders: aceito, e a order mostra? (O caminho
    futuro para o pagamento com mais de 78 dias.)
38. Pix devolvido depois de 90 dias (regra do Banco Central): o código do erro.
39. A mesma chave e o mesmo corpo reenviados depois de mais de 24 horas, quando o primeiro não fez nada: cria uma
    devolução? (Só registrar.)
40. A `action` do aviso (webhook) na devolução e na devolução parcial (só registro).
41. **O `refunds[].id` da resposta 201 é o mesmo do GET? A 201 lista só a devolução nova ou todas?** (A
    liberação só pelo id, seção "Cancelamento pela política (M8.2c)", "Devolução".)
42. **As orders online devolvem os códigos de espera do Point (`movement_operations_pending`, 425
    `order_payment_not_yet_enabled_for_refund`) ou `refund_period_exceeded`?**
43. **As situações de devolução que aparecem de fato (além de `processed`)**, para a lista branca da leitura
    (`processed`/`approved` = confirmada; `failed`/`rejected`/`canceled`/`cancelled` = falhou; o resto = em
    andamento).

Alteração e devolução de parte do valor (M8.2d):

44. **(Condição para o teste do GUIA, item 44.)** Devolução parcial de uma order Pix de teste aprovada: o código
    HTTP; se a 201 lista só a devolução nova ou todas; `refunds[].status` logo depois; a situação da order e da
    transação (`processed/partially_refunded` ou `processed/refunded`, como no exemplo da referência); se o GET traz
    `transactions.refunds[]` com os valores; se o `total_paid_amount` cai depois da devolução.
45. Uma segunda devolução parcial na mesma order (Pix e cartão): depois de a primeira estar processada, e com ela
    ainda em andamento. Aceita, ou `refund_in_progress` / `order_refund_already_in_process` (400 ou 409)?
46. **(Condição.)** O restante depois das parciais, enviado com valor explícito: a order fica `refunded/refunded` ou
    `processed/refunded`?
47. O teto exato do `refund_amount_exceeds` num cartão parcelado com juros: o `amount` da transação, o
    `total_amount` ou o `total_paid_amount`?
48. Devolução parcial de um cartão com juros pagos pelo hóspede: ele recebe juros proporcionais? O que mostram
    `refunds[].amount` e os campos da Payments (`transaction_amount_refunded`, `amount_refunded_to_payer`,
    `adjustment_amount`, `fee_details`)? Sai do saldo da SCL?
49. A taxa do Mercado Pago volta proporcional numa devolução parcial (Pix e cartão)? Em que campo ou linha do
    relatório?
50. Alguma forma de pagamento online recusa a devolução parcial (`unsupported_partially_refunds`, Payments 3024)?
51. A mesma chave de idempotência reenviada com outro valor (`idempotency_key_already_used`?); a mesma chave e o
    mesmo corpo (a 201 de antes repetida, com o mesmo id REF…?).
52. Um pedido parcial com a order já devolvida por inteiro no painel do Mercado Pago: `order_already_refunded` ou
    `cannot_refund_order`? E com a chave repetida?
53. Devolução de Pix em contingência no endpoint de Orders: 400 ou 201 `in_process`? O `X-Render-In-Process-Refunds`
    é aceito?
54. As orders online devolvem os códigos 422 (`amount_not_refundable`, `payment_not_refundable`,
    `max_refunds_exceeded`)? Há um máximo de devoluções parciais por order?
55. Devolução parcial de um cartão **antes** da liberação: 428 `insufficient_money_for_refund`, a redistribuição das
    parcelas a liberar, e a chave é gasta? (O D13 impede o sistema de pedir; isto confere se a regra pode afrouxar.
    Fazer com uma chamada à mão no sandbox, não pelo sistema.)
56. Duas orders seguidas para o mesmo pagador de teste e a mesma reserva (a original e a diferença, Pix e cartão):
    aparece `high_risk` ou recusa por duplicidade? A busca por `external_reference` acha a order certa?
57. Os nomes de `action` do aviso (webhook) na devolução parcial e na total de uma order (só registro).
58. O `GET /v1/orders/{id}` ainda funciona depois de 90 dias? A referência do Checkout Pro diz 1 ano; completa o
    item 37 e pode mudar a regra dos 78/85 dias.

Contestação (M8.2e):

59. Simular, no painel de Webhooks, um evento "Chargebacks" ("Contestações") contra o endereço de produção. Registrar a
    URL (`data.id` e `type`), o corpo (a página atual mostra `type: "order"`, `action: "order.charged_back"` e
    `data.id` `ORD…`) e se a assinatura confere com o id da URL. Se chegar um id numérico, se é o `case_id` ou o número do
    pagamento.
60. `GET /v1/chargebacks/search?payment_id=<pagamento de teste>` e `GET /v1/chargebacks/{id}` com as credenciais de
    teste: lista vazia, 401, 403 ou 404? O `X-Caller-Id` é o `id` de `GET /users/me`? Sem ele, 400 ou 403?
61. **(Condição para sugerir e, depois, aplicar o resultado pela leitura.)** Perguntar ao suporte do Mercado Pago:
    - se existe contestação de teste;
    - o que `settled` e `reimbursed` querem dizer na order, na transação, em `transactions.chargebacks[]` e na Payments
      API (a página atual da order diz "devolvido ao pagador" para `reimbursed`; o comentário do M8.2b dizia o contrário);
    - se `coverage_applied` é sempre o resultado (true = a favor do vendedor) e quando sai de null.
62. Se `payments[]` do caso traz o mesmo número que `pagamentos.id_pagamento_provedor`; se o `case_id` da order é o `id`
    da Chargebacks API; por que, no exemplo do aviso, o `transaction_id` da contestação não é o `id` do pagamento.
63. Quantos avisos chegam (abertura, documentos, decisão) e com que `action`; se `order.charged_back` chega a quem marcou
    só "Order (Mercado Pago)".
64. **(Condição para tirar a confirmação do valor.)** O dinheiro:
    - na abertura, o Mercado Pago debita ou só bloqueia? Bruto ou líquido?
    - a taxa e os juros voltam na perda? Há tarifa por disputa, ganha ou perdida?
    - em que dia o dinheiro volta na ganha?
    - que linhas (`chargeback`, `reserve_for_cbk_cross_recovery`) o relatório de liberações e o de dinheiro em conta
      mostram em cada momento;
    - o que acontece sem saldo.
65. 3DS: `AUTHENTICATED` e `ATTEMPTED` passam a responsabilidade só no motivo "não reconhecido" ou em todos? Como isso
    aparece no caso (`coverage_applied`, ou o caso nem é aberto contra a SCL)? Bandeira ou emissor? `coverage_eligible`
    pode ser `true` para hospedagem (serviço)?
66. A lista de `reason`/`reason_id` (quais são "não reconhecido" e quais são "serviço não prestado") e de quando conta o
    prazo da bandeira em hospedagem.
67. MED do Pix: como aparece para o vendedor (situação do pagamento, devolução `by_admin`, aviso, linha do relatório,
    bloqueio do saldo) e se o vendedor responde ou manda evidência.
68. Reclamação (Claims API) no Checkout Transparente: o hóspede que paga sem conta no Mercado Pago consegue abrir? Como
    aparece na order (`in_mediation` vira `charged_back/in_process`)?
69. Volta de estado: `settled` pode virar `reimbursed` (reapresentação, arbitragem)? A ganha volta a `in_process`? A
    transação resolvida volta a `processed/accredited` ou fica em `charged_back/*`?
70. Formatos: `id` do caso como texto ou número, `payments[]` como números, `amount` como número ou texto; os valores
    reais de `documentation_status`; quando `date_documentation_deadline` vem null.
71. A Chargebacks API responde para pagamentos com mais de 180 dias e para orders já apagadas (mais de 90 dias; completa
    o item 58)?
72. `GET /v1/payments/{id}` de um pagamento com mais de 90 e de 180 dias: responde? Que `status`/`status_detail` mostra
    durante e depois de uma disputa, e o `money_release_status` depois de ganha?
73. Disputa de parte do valor antes da liberação: o Mercado Pago libera a parte não disputada? O `net_received_amount` e o
    `money_release_status` da Payments API vêm com ou sem o valor bloqueado?

## Conferência dos prazos de cartão — 10/10/2026

A regra de taxa e liberação do M8.2b acima foi mantida. O teste automatizado
`app/src/pagamentos/cartao-prazos.test.ts` compara liberação imediata, em 14 dias e em
30 dias com reserva, proprietário, relógio, banco e provedor fictícios. O objetivo é
proteger o caixa e o repasse em todos os prazos, sem inferir que o dinheiro entrou
apenas porque a previsão passou.

Em cada cenário: cartão aprovado confirma a reserva; previsão futura com sinal
contraditório não lança recebimento; previsão passada com sinal ausente ou pendente
também não; confirmação explícita lança só o líquido informado, uma vez mesmo com
releitura; a parte do proprietário só fica disponível depois do check-in e da
liberação. Os valores e as datas do teste são fictícios, sem tabela comercial de
taxas nem mudança do plano da conta.

Esta conferência não foi executada contra a conta de teste do Mercado Pago. Continuam
pendentes as verificações de formato e comportamento do provedor na lista de sandbox
acima, inclusive o item 14. Nenhuma cobrança ou devolução real foi feita. Cancelar
reserva paga (M8.2c), alterar (M8.2d) e tratar contestação (M8.2e) permanecem itens
próprios, ainda não entregues por este reforço de testes (entregues depois, só no teste: o M8.2c e o M8.2d em 10/10, o
M8.2e em 11/10/2026).
