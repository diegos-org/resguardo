# Extrato do proprietário e repasses por periodicidade (M4.10)

**Situação:** implementado em 4/10/2026 (PR do M4.10) conforme esta especificação, escrita pelo
Claude a partir do item M4.10 do ROADMAP (decisões de Diego de 4/10) e do que já existia
(fechamento mensal do M4.9, livro do M4.1, "quem recebe" do M2.7). As escolhas marcadas como
*decisão do Claude* foram tomadas com a autorização prévia de Diego para seguir sozinho; ele pode
mudar qualquer uma pelo painel ou pedindo.

**Onde está no código:** `app/src/repasses/` — `periodicidade.ts` (regras puras), `extrato.ts`
(classificação das partes e leitura), `recebimentos.ts` (recebimento do canal), `repasses.ts`
(fechamento com disponibilidade, antecipado, itens, comprovante, estorno), `email.ts`,
`cron.ts` (rotina das 8h), `proprietario.ts` e `regras-config.ts` (escolha, padrão e início do
sistema), `por-fora.ts` (acerto por fora, M4.11); telas em Financeiro → Repasses, Configurações →
Repasses, página da reserva, cadastro do proprietário e portal. Tabelas novas: `repasse_itens` e
`arquivos`; colunas novas em `repasses` e `proprietarios` (migração 0044). O M4.11 não precisou de
migração: o tipo de repasse é texto e a data de início fica na configuração da organização.

## O que o proprietário vê e escolhe

- **Como quer receber** (no portal, com explicação curta): mensal no dia 1º (padrão e intervalo
  máximo), quinzenal (dias 1 e 16), semanal (segundas-feiras) ou assim que disponível (dia
  seguinte ao check-in, com o dinheiro já com a empresa). Sem escolha, vale o padrão do tipo de
  contrato dele, definido em Configurações → Repasses. A escolha fica no histórico e vale a
  partir do próximo repasse.
- **Extrato por reserva:** para cada reserva, a parte dele e a situação:
  - **informação** — o canal pagou o proprietário direto (`split`): não entra em repasse;
  - **a liberar** — reserva confirmada, mas antes do check-in, ou dinheiro ainda não registrado
    com a empresa, ou "quem recebe" a confirmar (cada caso com o motivo escrito);
  - **disponível** — check-in já passou e o dinheiro está com a empresa; aparece a data prevista
    do próximo repasse dele;
  - **repassado em DD/MM** — já saiu num repasse (com o link para o repasse).
- **Repasses:** lista com data, valor, situação (a pagar, pago, pago sem comprovante, estornado),
  as reservas que o compõem e o comprovante do Pix para baixar.

## Quando um valor fica disponível (regra única)

Unidade: a **parte do proprietário de cada reserva em cada mês** (o lançamento
`direito_proprietario` do livro, um por mês de competência). Ela fica **disponível** quando,
ao mesmo tempo:

1. quem recebe, conforme registrado na reserva (ou o padrão do imóvel/canal), é **`empresa`**;
2. o **check-in já passou** (data de entrada ≤ ontem, no fuso do imóvel);
3. o **dinheiro está com a empresa**: existe lançamento de **recebimento** daquela reserva no
   livro, realizado ou conciliado (hoje registrado à mão na página da reserva — "Registrar
   recebimento", com data e valor; o M4.4 passa a conciliar com o extrato e o M8.2 registra a
   liberação do provedor do site automaticamente);
4. ainda **não compôs nenhum repasse** (vínculo único).

Fora disso: `split` é informação; `a_confirmar` fica a liberar, com aviso, fora de qualquer
repasse; sem recebimento registrado fica a liberar, com aviso ("nunca se repassa o que a
empresa ainda não recebeu").

## Repasses

- **Antecipado** (programado ou avulso): reúne tudo o que está disponível até o dia anterior e
  ainda não compôs repasse. É um adiantamento vinculado às reservas que o compõem: entra no livro
  como "repasse" (efeito no acerto), **um lançamento por imóvel e por mês de competência das
  partes, na competência delas** (*decisão do Claude* na implementação: assim o mês de cada noite
  fecha zerado e a reserva que atravessa o mês não vira "dívida" no fechamento do primeiro mês;
  o ROADMAP descrevia o saldo negativo, o efeito final é o mesmo e mais legível). O fechamento
  mensal o desconta naturalmente, porque soma o acerto acumulado. O antecipado não desconta
  adiantamentos nem despesas: isso continua no fechamento (decisão de Diego).
- **Programado:** a rotina diária (8h) gera, para cada proprietário, o repasse do dia quando a
  data bate com a periodicidade efetiva dele (segunda-feira no semanal; dias 1 e 16 no
  quinzenal; todo dia no "assim que disponível"). No **dia 1º** a rotina não gera antecipado: o
  fechamento mensal é o único repasse do dia. *Decisão do Claude:* o fechamento continua sendo
  disparado por Diego no painel (como no M4.9), para ele conferir antes; a automação total do dia
  1º fica para quando o Pix for automático.
- **Avulso:** o proprietário pede no portal ou Diego gera no painel; mesma regra do antecipado.
- **Fechamento mensal (dia 1º):** continua por competência (noites do mês fechado) e numa única
  transação por proprietário, com duas mudanças: (1) valores da competência cujo dinheiro ainda
  não está com a empresa ficam **fora** e passam para o repasse seguinte, aparecendo no extrato
  como a liberar com aviso; (2) valores já disponíveis com noites fora do mês fechado entram no
  mesmo repasse como **adiantamentos vinculados**, para a reserva ser paga inteira como prometido.
- **Vínculo único e idempotente:** cada parte disponível só pode compor um repasse (tabela de
  itens com índice único por lançamento). A rotina e o botão do painel podem rodar no mesmo dia
  sem pagar duas vezes: no máximo um repasse antecipado por proprietário por dia, e o item já
  usado nunca entra de novo. Estornar um repasse libera os itens dele (só o repasse mais recente
  do proprietário, de qualquer tipo, para a sequência continuar certa). Ao marcar pago, as partes
  pagas passam a "realizado" no livro: o recálculo do motor não mexe mais nelas (divergência vira
  conferência, como no M4.8).
- **Pagamento:** o sistema gera o repasse "a pagar" na data; o Pix sai pela equipe (manual) e,
  depois, por lote diário automático (API do banco ou do Mercado Pago), com o comprovante vindo do
  provedor.

## Comprovante e e-mail

- Ao **marcar pago**, Diego anexa o comprovante: arquivo do banco (PDF, PNG ou JPG até 5 MB) ou
  o identificador da transação Pix. *Decisão do Claude:* o arquivo fica guardado **no banco de
  dados**, numa tabela própria e privada (sem serviço externo nem variável nova); só o admin e o
  próprio proprietário conseguem baixar. Sem comprovante, o repasse fica "pago sem comprovante",
  com aviso, e o e-mail espera.
- **E-mail do repasse:** com o repasse pago e o comprovante registrado, sai um e-mail ao
  proprietário (e representantes com cópia) com a lista das reservas e valores (integral ou
  parcial) e o comprovante anexado. Uma vez por repasse (chave idempotente), pelo mesmo provedor
  do fechamento (Resend; sem provedor configurado, fica pendente com aviso no painel).

## Configuração (uma regra, um lugar)

Configurações → Repasses: dia da semana do semanal (padrão segunda), os dois dias do quinzenal
(padrão 1 e 16) e o padrão de periodicidade por tipo de contrato (padrão mensal para todos).
A data prevista no extrato é calculada daqui.

## Início do sistema e acerto por fora (M4.11, decisão de Diego em 4/10/2026)

O sistema vale a partir de **1/10/2026**; tudo o que é de antes — parte de reserva, comissão,
despesa, ajuste — já foi acertado fora dele e não pode entrar de novo (o acerto soma desde a primeira
reserva de cada imóvel, pela regra de 2/10 para o início dos contratos).

- **Data de início** em Configurações → Repasses (chave `inicio_sistema`): sempre dia 1º de um mês,
  porque as partes de reserva são por mês; nunca no futuro; vazia = não definida. Com acerto por fora
  em vigor, a data não pode voltar para antes dele nem ser apagada; com parte anterior à data nova já
  em repasse normal em vigor (fechamento ou antecipado), mês anterior já fechado, ou fechamento de mês
  a partir da data em vigor para um proprietário que ainda tem imóvel/mês de antes com acerto
  diferente de zero (o fechamento paga o acerto acumulado, então o de outubro leva um ajuste de
  setembro sem item de reserva, e a marcação zeraria setembro de novo), a data não pode avançar por
  cima (estornar primeiro). A marcação reconfere a data configurada sob a mesma trava, para uma
  mudança no meio não marcar com data velha.
- **Marcar como acertado por fora** (Financeiro → Repasses, seção "Antes do início do sistema"):
  para cada proprietário com lançamento anterior ao início, numa transação por proprietário
  (proprietário travado e reservas das partes travadas para o motor, como no antecipado), um repasse
  do tipo **`por_fora`**, com data e pagamento na véspera do início, situação "pago", sem comprovante
  e sem e-mail (a rotina de e-mails o ignora e o envio manual recusa). Ele tem um **item** para cada
  parte de reserva anterior ao início que a empresa receberia e que ainda não está em repasse em
  vigor (vínculo único do M4.10: a parte nunca entra em antecipado nem em fechamento) e um
  **lançamento "repasse"** por imóvel e mês de competência, no último dia do mês, realizado na
  véspera, com efeito igual ao oposto do acerto daquele mês — o acerto até a véspera fica em zero. As
  partes marcadas passam a "realizado" (o motor não as recalcula).
- **Reexecutável e idempotente:** a soma por imóvel e mês inclui os próprios lançamentos de acerto já
  feitos, então quem já está em zero não entra; só o que surgiu depois (uma reserva antiga importada
  atrasada) gera um repasse novo, só com ela. O painel conta os pares imóvel/mês com acerto diferente de
  zero (não só a soma): grupos que se anulam continuam marcáveis.
- **Bloqueios** (os mesmos do fechamento, limitados ao período anterior ao início): lançamento em
  conferência, ajuste com o proprietário a esclarecer, adiantamento em aberto. Recusam só aquele
  proprietário, com o motivo; os outros são marcados. Avisar em vez de supor: nada é marcado por cima
  de uma pendência.
- **O início vale nos repasses normais:** com a data definida, parte de mês anterior ao início nunca
  fica disponível (`classificarParte` recebe o início; a parte fica a liberar com o motivo "anterior ao
  início do sistema: aguarda a marcação"), então antecipado e pedido pelo portal nunca a pagam; e o
  fechamento bloqueia enquanto o proprietário tiver parte de antes fora de repasse ou mês de antes com
  acerto diferente de zero — inclusive uma reserva antiga importada depois da marcação. A marcação
  manual não precisa vencer corrida nenhuma: antecipado e fechamento tomam a mesma trava da
  configuração do início antes de ler as partes, então a data não muda entre a leitura e a gravação.
- **Estorno** como qualquer repasse (só o mais recente do proprietário): as partes voltam ao extrato
  (a liberar ou disponível) e o acerto de antes volta.
- **Extrato:** a parte aparece "Repassada" com o motivo "Acertada por fora, antes do início do
  sistema (até 30/09/2026)"; o resumo tem a linha "Acertado por fora (antes do sistema)", separada do
  "Já repassado (pago)", que é o que o sistema pagou. O repasse aparece na lista como "Acertado por
  fora, antes do sistema", sem comprovante nem e-mail.
- **Consequência para a reserva que atravessa o início** (ex.: 29/9 → 2/10): a parte de setembro já
  está acertada; o recebimento da reserva libera só a parte de outubro, que segue o fluxo normal.
  Isso substitui o checklist manual que o GUIA-DIEGO trazia para o fechamento de outubro.

## Fora deste item

- Pix automático em lote (fica planejado; depende de API do banco ou do Mercado Pago).
- Conciliação automática do extrato (M4.4) e liberação do provedor do site (M8.2): quando
  existirem, só alimentam a mesma condição 3.
- O cálculo do marketplace (M12.2) usa este mesmo extrato e estas mesmas periodicidades.
