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

## As cinco partes

| Parte | O que entrega | Depende de |
|---|---|---|
| **M8.2a** | **Pix em teste e a base de tudo:** adaptador, aviso assinado, conferência, confirmação só com as datas seguradas (inclusive aprovação tardia), taxa real, liberação virando o recebimento do M4.10, devolução do pagamento que ficou sem reserva, o que o hóspede vê em cada situação, painel e as travas. | M8.1 |
| **M8.2b** | **Cartão** (pronto em 9/10/2026, seção "Cartão (M8.2b)"): Card Payment Brick, parcelas com juros do hóspede e máximo configurável, freios contra teste de cartão roubado, identificação do aparelho, análise do cartão. | M8.2a |
| **M8.2c** | Cancelamento de reserva paga pela política (pronto em 10/10/2026, seção "Cancelamento pela política (M8.2c)"): integral até 14 dias antes, nada depois, arrependimento de 7 dias; lançamentos por componente, taxa que não volta com a SCL, dinheiro retido no cancelamento sem reembolso, desconto da parte já repassada no repasse seguinte. | M8.2a |
| **M8.2d** | Alteração de reserva paga (pronta em 10/10/2026, seção "Alteração de reserva paga (M8.2d)"; datas, pessoas ou valor, só antes da entrada), com novas datas seguradas, cobrança da diferença ou devolução parcial; e a devolução de parte do valor que o M8.2a e o M8.2c deixaram (o restante de um pagamento já devolvido em parte, a devolução parcial por fora, a devolução que o Mercado Pago fez a menos). | M8.2c |
| **M8.2e** | Contestação (chargeback): registro, conferência, decisão de quem arca, lançamentos. | M8.2b, M8.2c |

O pagamento **de verdade** só liga com as cinco partes e o M7.4 feitos (o M7.4 ficou pronto em
9/10/2026: páginas legais e aceite antes do Pix, desenho em `PAGINAS-LEGAIS.md`; o M8.2b ficou pronto
em 9/10/2026, o M8.2c e o M8.2d em 10/10/2026; falta o M8.2e), e com as decisões pendentes de Diego: taxa do pagamento (hoje sai antes da divisão; se a SCL passar a arcar, o motor precisa de
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
seção 7).

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
reserva (partes c e e).

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
motor da reserva-pedido → documentos legais / disjuntor / livro. Segurar uma alteração toma o motor da reserva e
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
- **O M8.2e decide quem arca com a contestação pelo `tres_ds_status = AUTHENTICATED` de cada pagamento,
  nunca pelo modo `tres_ds`.** Se `ATTEMPTED` também passa a responsabilidade é pergunta ao Mercado Pago
  (sandbox, item 15).
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

### Contestação (gancho para o M8.2e)

A leitura da order dá `contestado` quando uma transação está `charged_back/*` ou algum
`transactions.chargebacks[].status` é `in_process` ou `settled`, qualquer que seja a situação da order
(só o `status` é lido: nunca `case_id`, `id` ou `references`). O id numérico da Payments API (é o que chega
nos avisos de contestação, cujo prazo de 180 dias passa da janela de leitura das orders) fica em
`pagamentos.id_pagamento_provedor`. Registro, decisão de quem arca e lançamentos são do M8.2e; o aviso
assinado continua ignorando ids numéricos.

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
- Na parte (a), marcar no Mercado Pago só o evento "Order (Mercado Pago)".

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
com mais de 78 dias (`MARGEM_PEDIDO_DEVOLUCAO_DIAS`): não daria tempo de conferir. Contestação tardia (até 180 dias) fica com o M8.2e, por outro caminho (Payments ou Chargebacks).

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
   sistema chega no M8.2d — desde 10/10, "Devolver o restante ao hóspede").
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
  aceita quando o Mercado Pago mostra o pagamento aprovado de novo (contestação resolvida). O que
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
contestação (M8.2e)"); a parte do proprietário num repasse **ainda não pago** ("estorne esse repasse (o
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
Mercado Pago liga `devolucao_em_dobro`.

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
  devoluções, reserva cancelada com devolução integral). A taxa que não voltou é despesa da empresa com a reserva
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
"Beds24", nunca dado pessoal.
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
sozinho; a reserva-pedido nunca vai ao Beds24.

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
| Reserva cancelada, devolução pedida (M8.2c) | "Reserva cancelada": quem cancelou e quando o pedido chegou, "devolvemos o valor integral pago, R$ …, sem desconto de taxas", "Já pedimos a devolução ao Mercado Pago…" e como o dinheiro volta (Pix ou cartão; com partes por caminhos diferentes — reserva no Pix e diferença no cartão, ou uma parte devolvida por fora —, a frase de cada caminho usado, na mesma regra da devolução da diferença de uma alteração; com alguma parte por fora, o total nunca é dito "pelo Mercado Pago"). Também na devolução aceita ainda sem confirmação, no cartão com mais de 78 dias ("Estamos pedindo o estorno no seu cartão…", enquanto a devolução por fora do cartão não abre) e no cartão recusado com a devolução por fora ainda fechada |
| Reserva cancelada, devolvida (M8.2c) | "Devolução de R$ … confirmada pelo Mercado Pago em dd/mm" (o valor lido, quando a leitura o traz), "feita pelo Mercado Pago em dd/mm" (confirmada pela equipe) ou "feita em dd/mm" (por fora, com a frase da transferência e sem linha da forma de pagamento) |
| Reserva cancelada, com a equipe (M8.2c) | "A devolução de R$ … pelo Mercado Pago não foi possível." e a frase editável de que a equipe combina outra forma, sem custo (Pix recusado, ou cartão com a devolução por fora já aberta) |
| Reserva cancelada, em conferência (M8.2c) | devolução a menos, pagamento contestado ou devolvido em parte, devolução parada por um problema: "Estamos conferindo a devolução com o Mercado Pago; a nossa equipe fala com você." Nunca oferece outro jeito de pagar |
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
  restante pelo quadro do pagamento"), devolução pedida ou recusada,
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
contestação, IP (além das chaves do freio, de cerca de 24 h), os dados crus do Brick (`formData`,
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
próprios, ainda não entregues por este reforço de testes.
