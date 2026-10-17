# Cotação persistida e hold do site (M8.1)

**Situação:** implementado em 3/10/2026 (`app/src/site/cotacoes.ts`). Regras de negócio do passo entre
"ver disponibilidade e valor" (M7.2) e "pagar" (M8.2). Nada aqui escreve no Beds24 (M8.3).

## Cotação

- Só nasce do que o site acabou de calcular (`consultarDisponibilidade`): estadia possível
  (**disponível** ou **a confirmar**) e valor completo (diárias e total não nulos). Indisponível, inválida
  ou sem valor completo não vira cotação — o site segue mandando falar com a equipe.
- Guarda datas, pessoas, noites, situação, diárias, limpeza, hóspede extra, total, a leitura do Beds24
  usada e um **código público** (`COT-` + 8 caracteres sem 0/O/1/I). O código não é credencial: quem o
  tem vê a cotação, sem dado pessoal (o contato fica só na reserva, no painel).
- **Revalidação** a cada abertura da página: cotação aberta é recalculada; se a situação (disponível × a
  confirmar) ou os valores não batem, a página diz o que mudou e oferece nova consulta — leitura do Beds24 que
  venceu ou sumiu conta como mudança. Nada é gravado só por visitar.
- **Freios do site público:** repetir a mesma consulta (mesmo imóvel, datas, pessoas, situação e valores) em
  24 h reaproveita a cotação aberta em vez de criar outra; cada imóvel aceita até 100 cotações abertas por 24 h
  (acima disso, "fale com a equipe"); cotação que nunca virou pedido é apagada pela rotina depois de 30 dias.
  Reaproveitamento, contagem e inserção correm em série por imóvel (trava consultiva na transação), para
  consultas simultâneas não furarem o teto.

## Segurar as datas (hold)

- Exige nome, e-mail e telefone válidos. Numa só transação: trava a linha do imóvel (`FOR UPDATE`, a mesma
  dos bloqueios), vence os holds atrasados daquele imóvel, exige cotação **aberta**, reconfere disponibilidade
  e valor (se mudaram: cotação **desatualizada**, nada gravado) e aplica os freios: **um** pedido em andamento
  por e-mail (com trava própria por e-mail, já que a do imóvel não serializa o mesmo e-mail em imóveis
  diferentes) e **cinco** por imóvel.
- Cria a reserva pela mesma porta das importações (`sincronizarReserva`, fonte `site`, idFonte = id da
  cotação, idempotente): estado **pedido**, origem **site**, valor bruto = total da cotação, taxa do canal
  desconhecida (null), observações com o código e o prazo. Pedido **ocupa inventário** (regra do M3.8) e
  **não entra no financeiro** (motor: sem lançamentos).
- Prazo: `regras.site.minutosHold` (padrão 30, entre 5 e 240), editável em Configurações → Calendário e
  preços → Site público. Uma regra, um lugar.

## Fim do hold

- Ordem das travas, igual nos dois caminhos (vencimento e confirmação no painel): **reserva → cotação**; o
  hold só vence outros holds depois de saber que a própria cotação está aberta. Assim nenhuma transação espera
  pela outra em círculo.
- Rotina `/api/cron/cotacoes` a cada 10 minutos (e antes de qualquer novo hold no imóvel): pedido ainda
  `pedido` com prazo vencido → reserva **cancelada** (histórico "sistema") e cotação **expirada**; pedido
  que a equipe **confirmou** → cotação **convertida**; que a equipe **cancelou** → cotação **cancelada**.
- A página da cotação reflete o vencimento mesmo antes da rotina (compara `holdAte` com agora).
- `confirmarReserva` aceita `pedido` além de `pendente` (painel: botão Confirmar na ficha do pedido). Pedido do
  site com o prazo vencido **não confirma**: vence na hora (reserva cancelada, cotação expirada) e a equipe
  pede uma cotação nova ao hóspede — a rotina de 10 minutos não é pré-requisito.

## Datas seguradas de uma alteração (M8.2d, 10/10/2026)

A alteração de uma reserva **já paga pelo site** (`PAGAMENTO-SITE.md`, seção "Alteração de reserva paga (M8.2d)")
reaproveita a ideia do hold, com as diferenças abaixo. O hold do visitante do site não mudou.

- **Reserva-pedido da alteração:** as noites que a alteração acrescenta (um intervalo só) ficam ocupadas por uma
  reserva `pedido` de fonte `alteracao` (`idFonte` = id da alteração, origem `site`, nome "Alteração SCL-…", sem
  e-mail nem telefone, sem valores), criada pela mesma porta (`sincronizarReserva`) sob a trava do imóvel. Ocupa o
  inventário pela regra de sempre; nunca é confirmada, nunca vai ao Beds24 e nunca entra no financeiro; a
  importação do Beds24 e da planilha nunca a casam. Confirmar ou cancelar pela ficha é recusado; ela some sozinha
  (cancelada por `cancelarPortador`) quando a alteração é aplicada, desistida ou vence. Sem noite nova, não há
  reserva-pedido.
- **Prazo próprio:** `regras.site.minutosHoldAlteracao` (padrão 60, entre 5 e 2880), editável em Configurações →
  Calendário e preços → Site público ("Minutos que as novas datas de uma alteração de reserva paga pelo site ficam
  seguradas"), separado de `minutosHold`: o hóspede de uma alteração combina pelo WhatsApp, não está na página da
  cotação, e mudar um prazo não muda o outro. O prazo fica em `alteracoes_reserva.hold_ate`, é estendido pelo
  pagamento da diferença (Pix, desafio do banco, cartão em análise uma vez por alteração) e nunca passa do horário de
  entrada; a carência de 15 minutos com um pagamento da diferença em andamento vale como no pedido do site.
- **Vencimento:** uma alteração com o prazo e a carência vencidos vale como vencida em toda conferência
  (`noitesLivres` não conta a reserva-pedido dela), antes de alguém gravar. `segurarDatas` e `criarBloqueio` vencem
  as alterações vencidas **do mesmo imóvel** antes de conferir as noites, cada uma num savepoint: se a trava da
  reserva alterada estiver ocupada, aquela alteração é pulada e o pedido do visitante segue (sem chamada ao Mercado
  Pago). A rotina `/api/cron/cotacoes` vence as alterações antes dos holds; o "Conferir agora" e toda ação da
  alteração vencem as da reserva.
- **Cotação da alteração:** `consultarDisponibilidade(…, { propria })` cota a estadia nova sem contar a própria
  reserva (nem o bloqueio de fonte Beds24 nas noites dela); as noites novas passam pela conferência de sempre.
- A cotação original continua `convertida`: o pagamento da diferença vive nela, com `alteracao_id`, e a rotina dos
  holds (que só fecha cotações `segurada`) não volta a ela.

## Limites conhecidos

- O hold nunca vai às OTAs (D9 do desenho do M8.3, `RESERVA-SITE-BEDS24.md`, seção 11, como no ROADMAP): durante o
  prazo, um visitante do Airbnb pode reservar as mesmas noites. Por isso o prazo é curto e a equipe deve confirmar ou
  cancelar logo. Só a reserva paga pelo site vai ao Beds24 pelo sistema (o envio é o M8.3c, ainda não feito). O pedido
  do site que a equipe confirma à mão, sem pagamento pelo site, nunca vai ao Beds24 pelo sistema (D3, decidida por
  Diego em 16/10/2026): a equipe fecha as datas no Beds24 como bloqueio e marca "Datas fechadas nas OTAs" na ficha da
  reserva. Até a marca, o Início (para quem edita reservas, sem valores) avisa "N reserva(s) do site confirmada(s) à
  mão, sem pagamento pelo site (SCL-…): feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs."
  (M8.3b, 17/10/2026, na branch do M8.3b, em revisão; regras em `PAGAMENTO-SITE.md` e `RESERVA-SITE-BEDS24.md`,
  seção 6).
  - **Registro (17/10/2026, M8.3b).** *Antes:* "Até o M8.3, as OTAs não sabem do hold: um visitante do Airbnb pode
    reservar as mesmas noites durante o prazo. Por isso o prazo é curto e a equipe deve confirmar ou cancelar logo."
    ("até o M8.3" sugeria que o M8.3 mudaria isso). *Agora:* o texto acima. *Motivo:* o desenho do M8.3 manteve as OTAs
    abertas durante o hold (D9, como no ROADMAP; o risco continua registrado), e Diego decidiu em 16/10 que só a reserva
    paga pelo site vai ao Beds24 (D3): no Airbnb o hóspede tem 24 horas para pagar, fechar as datas em todos os canais
    para quem depois não paga dá muito trabalho e tira reservas daquelas datas, e o caso é raro. A D3 reforça a D9 pelo
    mesmo motivo. *Objetivo final:* o Beds24 e as OTAs só fecham sozinhos as datas de uma reserva paga pelo site; o hold
    continua curto e o pedido confirmado à mão fica com a equipe, com o aviso até a marca.
- Até o M8.2, o fecho da reserva é na conversa (botão de WhatsApp na página da cotação com o código).
  Desde o M8.2a (8/10, em teste nas prévias), com o Pix oferecido, o pedido confirma sozinho quando o
  pagamento é aprovado com as datas seguradas; o prazo das datas é estendido até o fim do Pix; pedido com
  pagamento em andamento não vence antes de 15 minutos depois do prazo; e o painel recusa confirmar ou
  cancelar um pedido com Pix em andamento. Regras completas em `PAGAMENTO-SITE.md`.
- Freios por e-mail e por imóvel são constantes de código (não editáveis), por serem defesa, não regra de
  negócio; se incomodarem a operação, viram configuração.
