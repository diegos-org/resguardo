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

## Limites conhecidos

- Até o M8.3, as OTAs não sabem do hold: um visitante do Airbnb pode reservar as mesmas noites durante o
  prazo. Por isso o prazo é curto e a equipe deve confirmar ou cancelar logo.
- Até o M8.2, o fecho da reserva é na conversa (botão de WhatsApp na página da cotação com o código).
  Desde o M8.2a (8/10, em teste nas prévias), com o Pix oferecido, o pedido confirma sozinho quando o
  pagamento é aprovado com as datas seguradas; o prazo das datas é estendido até o fim do Pix; pedido com
  pagamento em andamento não vence antes de 15 minutos depois do prazo; e o painel recusa confirmar ou
  cancelar um pedido com Pix em andamento. Regras completas em `PAGAMENTO-SITE.md`.
- Freios por e-mail e por imóvel são constantes de código (não editáveis), por serem defesa, não regra de
  negócio; se incomodarem a operação, viram configuração.
