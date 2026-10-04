# Relatório mensal do proprietário — modelo oficial (M5.7)

**Situação:** especificado em 4/10/2026 a pedido de Diego; implementação é o item **M5.7** do
ROADMAP (a fazer). Modelo navegável com dados fictícios em `prototipos/relatorio-mensal/relatorio.html`.

**Decisão de Diego (4/10/2026):** o relatório mensal que a Lia (Codex) montou com ele para
setembro/2026 vira o **padrão** do sistema, adaptado às cores e fontes da identidade visual nova
(M7.5, `requisitos/product/DESIGN.md`), com um bloco de métricas e um gráfico leve, e vale:

- para o PDF que o **proprietário baixa no portal** (M5.3) e para o **envio mensal da empresa** no
  dia 1º (M5.4) — um modelo só;
- **adaptado, para o marketplace** (M12): vendas do site com o modelo B separadas das vendas que o
  dono faz nas OTAs dele;
- como **família visual e de linguagem** para e-mails e, quando ligado (M10), WhatsApp (confirmação
  de reserva, lembretes, instruções, repasse, fechamento).

O PDF de referência contém nomes, códigos de reserva e valores reais: ficou **fora do Git**. Este
documento registra só a estrutura dele e o que muda. Ele substitui o "modelo visual" de
`requisitos/operations/RELATORIOS-PROPRIETARIOS.md`; as regras de lá sobre destinatários
(proprietário formal primeiro, representante autorizado depois, sem virar coproprietário),
conferência das fontes, isolamento de dados e compensação assumida pela empresa continuam valendo,
assim como o tom de `requisitos/operations/RELATORIOS-E-TOM.md`.

## O que foi mantido do modelo da Lia, o que muda

| No modelo de setembro/2026 | No modelo oficial |
|---|---|
| Faixa escura com a marca, "RELATÓRIO MENSAL — 1 a 30 de setembro de 2026", nomes dos proprietários em versalete, nome do imóvel, "Proprietária/Representante", foto | Mantido. Cores e fontes pelos tokens do M7.5 (floresta/papel/areia/dourado; serifa nos títulos, sem serifa no corpo). O período escrito por extenso; "parcial até dia N" quando for o mês corrente |
| Caixa de destaque "Parcela do proprietário no Airbnb R$ …" | Vira **"Seu resultado em {mês}"** com a base escrita embaixo: a parte do proprietário em todas as reservas do mês (todos os canais), já descontadas as despesas do imóvel. Nunca o total de um canal como se fosse lucro ou repasse |
| Linhas: bruto, taxas do canal, líquido antes da gestão, parcela da gestão, ajustes debitados, parcela após ajustes, ajuste "responsabilidade da empresa", total com a compensação | Mantidas e generalizadas para todos os canais (ver "Do bruto ao resultado"). Compensação assumida pela empresa continua uma linha separada, com o estado (pendente / paga, com comprovante) |
| Notas: "parcela consta como enviada… não confirma crédito bancário"; "posição extraída em …" | Mantidas. A posição vem do próprio sistema (data e hora da emissão) |
| Página "Detalhamento das reservas": N reservas, N noites; um cartão por reserva (primeiro nome, código, datas, noites, bruto, taxa do canal, limpeza, gestão, proprietário) | Mantida. Entra o **canal** de cada reserva e a **situação** da parte (paga pelo canal, já repassada, a transferir, a liberar — M4.10). Estadia que atravessa o mês mostra só as noites do mês, com nota |
| Página "Conciliação — do extrato ao mês completo": total do PDF oficial "pago", parcelas em espera, total apurado; distribuição proprietário/empresa | Mantida e ampliada: **do extrato de cada canal ao resultado** (Airbnb paga direto; Booking, site e direta passam pela empresa), **repasses feitos no mês** (antecipados, com comprovante) e **o que vai no fechamento, com quem paga quem e o Pix**; despesas do imóvel listadas |
| Extrato oficial do Airbnb como anexo (páginas copiadas) | Mantido: **sempre no fim**, como emitido, um bloco por canal (Booking quando houver). Só páginas daquele imóvel e daqueles favorecidos |
| — | **Novo:** bloco de métricas do mês e gráfico de barras de 12 meses, na página das reservas (abaixo) |

## Princípios

- **Uma regra, um lugar.** O relatório não calcula nada: lê o resumo, as reservas, o rodapé do
  portal (`portal/resumo`, `portal/reservas`, `portal/rodape`) e o extrato do M4.10
  (`repasses/extrato`). Portal, painel, PDF e e-mail mostram os mesmos números.
- **Avisar em vez de supor.** Métrica sem dado no período inteiro aparece como "sem dado no sistema",
  nunca zero nem estimativa. Recebimento do canal não registrado: a parte é "a liberar", com o motivo.
  Total de canal não é lucro; "enviado" não é "creditado".
- **Dinheiro em centavos inteiros**, formatado em R$; fuso `America/Sao_Paulo`.
- **Privacidade.** Hóspede só pelo primeiro nome; nenhuma chave Pix completa no PDF (a transferência
  cita "a chave cadastrada no portal"); extrato de outro imóvel ou de outro favorecido nunca entra;
  foto só real e autorizada (M7.3) — até lá, o quadro "foto em breve", nunca imagem genérica.
- **Autorização no servidor** como hoje (`relatorios/gerar.ts`): portal só o próprio dono, dentro da
  janela, sem anexos; painel com foto e extrato anexados na hora, com histórico.
- **Legível em A4 e na tela**: uma coluna, tabelas com números alinhados à direita, texto 11–13 pt,
  nada de cor fixa no código (tokens do M7.5). Bonito e relevante, sem ser exaustivo: um gráfico e
  um bloco de quatro números (página 2), e cada página cabe numa folha; o detalhe fica nas páginas
  seguintes.

## Estrutura (página a página)

### 1. Capa e resultado
1. **Faixa** verde-floresta: marca "Sua Casa *Leblon*" (itálico dourado), "Relatório mensal ·
   {mês de ano}" e, à direita, "Emitido em {data} · fechamento do mês" (ou "parcial até {dia}").
2. **Identidade:** nome público do imóvel (serifa), "Para {proprietário}" e "com cópia a
   {representante}, representante autorizado" quando houver; bairro/cidade; tipo de contrato e
   comissão em vigor (gestão completa X% / marketplace).
3. **Foto** do imóvel (3:2, real e autorizada).
4. **Seu resultado em {mês}** — valor grande com a base: "sua parte nas reservas do mês, em todos os
   canais, já descontadas as despesas do imóvel". Ao lado, **Como chega até você**, uma linha por
   caminho, só as que existirem: pago direto pelo canal (Airbnb, split); já repassado no mês
   (antecipados, com as datas); a transferir no fechamento (valor, data e **quem paga quem**: "a Sua
   Casa Leblon transfere para {nome}" ou "{nome} transfere para a Sua Casa Leblon", pela chave Pix
   cadastrada); a liberar (recebimento do canal pendente / liberação do provedor), com o motivo.
5. **Do bruto ao resultado** (tabela): bruto das reservas; taxas dos canais; líquido depois dos
   canais; comissão da gestão (X% sobre o líquido); despesas e ajustes do imóvel (um total, detalhe
   na página 3); ajuste "responsabilidade da empresa" quando houver, com o estado; **seu resultado**.
   No marketplace, as linhas do modelo B (desconto do hóspede, taxa do pagamento, parte da SCL)
   aparecem só para as vendas do site (ver "Variantes").
6. **Avisos** (só se houver): pendências que mudam a leitura (recebimento não registrado,
   lançamento em conferência, compensação pendente), uma linha cada, com o que acontece depois.
7. Rodapé: "Os números são os mesmos do portal; o extrato oficial de cada canal está no fim,
   como emitido." Página N de M. A capa cabe numa folha A4: foto, resultado, "como chega" e a
   tabela do bruto ao resultado; os números do mês ficam na página 2.

### 2. Números e reservas do mês
Em cima, **Números do mês** — quatro quadros e um gráfico (ver "Métricas"). Embaixo, as reservas:
"{N} reservas · {n} noites em {mês}". Uma linha (ou cartão) por reserva: primeiro nome do hóspede,
canal, código do canal, entrada → saída, noites no mês, bruto, taxa do canal, limpeza (quando o
componente existir no livro), comissão da gestão, **sua parte** e situação da parte (paga pelo canal /
repassada em {data} / a transferir / a liberar: {motivo}). Nota de rodapé: estadia que atravessa o
mês entra só com as noites do mês, rateio igual por noite (regra de 24/09). Ordem: por entrada.

### 3. Conciliação e repasses
1. **Do extrato dos canais ao seu resultado** — uma linha por canal: reservas, bruto, taxa, quem
   recebeu (o canal pagou a você direto / pagou à Sua Casa Leblon em {datas} / liberado pelo
   provedor em {data} / **a receber**), sua parte. Totais iguais aos da capa.
2. **Repasses do mês** — antecipados pagos (data, valor, reservas, "comprovante no portal") e o
   fechamento: saldo do acerto, adiantamentos descontados, valor a transferir, quem paga quem, data
   prevista. A liberar: lista com o motivo e "entra no próximo repasse".
3. **Despesas e ajustes do imóvel** — data, descrição, valor, nota/anexo no portal.
4. "Posição extraída em {data e hora}. Repasse 'enviado' não confirma crédito na sua conta;
   confira o comprovante no portal."

### 4. Anexos
Extratos oficiais dos canais, **como emitidos, sem alterações**, um bloco por canal (Airbnb; Booking e
outros quando houver), com a nota "páginas X a Y do extrato completo" quando for parcial. Sem anexo no
PDF do portal (como hoje); no painel, anexados na hora.

## Métricas e gráfico (página 2)

Todas vêm do livro e do calendário do SCL; nenhuma é estimada.

| Quadro | Definição | Quando aparece |
|---|---|---|
| **Noites e ocupação** | noites ocupadas no mês (reservas confirmadas, rateio por noite) e ocupação = noites ocupadas ÷ noites disponíveis, onde disponíveis = noites do mês − noites bloqueadas pelo proprietário para uso próprio (M5.5). Mostra "{n} de {d} disponíveis" e as bloqueadas | sempre |
| **Diária média** | bruto do mês ÷ noites ocupadas no mês; rótulo "por noite, com limpeza" (o bruto do livro inclui a limpeza) | se houver noite ocupada |
| **Comparado ao mês anterior** | variação % do resultado e ocupação "de X% para Y%" | só se o mês anterior estiver inteiro no sistema (depois do início do sistema, M4.11, ou do histórico importado) |
| **Mesmo mês do ano anterior** | variação % do resultado | idem; senão "sem dado no sistema" |
| **Acumulado do ano** | soma do resultado de janeiro até o mês — ou "desde {mês/ano}" quando o dado começa depois de janeiro, escrito no rótulo | sempre que houver ao menos um mês |
| **Gráfico** | barras dos últimos 12 meses do resultado (sua parte − despesas); meses sem dado em hachura, com legenda "sem dado no sistema"; eixo em R$ mil; o mês atual destacado | sempre |

Mês parcial (relatório do mês corrente): métricas calculadas até o dia, com o rótulo "até {dia}", e
sem comparação percentual com meses inteiros (a comparação mostraria queda falsa).

## Variantes

- **Portal × painel/e-mail.** Mesmo PDF; o do portal sai sem anexos e só dentro da janela do portal
  (como hoje); o do painel e o do e-mail do dia 1º (M5.4) levam a foto e os extratos.
- **Gestão completa × marketplace.** No marketplace, a capa diz "contrato marketplace"; "Do bruto ao
  resultado" separa **vendas pelo site SCL** (valor cheio, desconto do hóspede, taxa do pagamento,
  parte da SCL, sua parte — modelo B, M12.1/M12.2) de **vendas suas nas OTAs** (sem comissão da SCL;
  entram no resultado só quando o dinheiro passa pela empresa — quem recebe `empresa`, M2.7 —, senão
  aparecem como informação, "pago a você pelo canal"). As métricas somam tudo, com a nota.
- **Mês corrente (parcial).** Igual, com "parcial até {dia}" na faixa e a frase de tom do guia da
  Lia: é para acompanhar o andamento; o fechamento completo vem no dia 1º.
- **Vários imóveis do mesmo dono.** Um relatório por dono com uma capa (resultado consolidado e
  um quadro por imóvel) ou um por imóvel — escolha do proprietário no portal; o painel gera os dois.
  Imóveis de donos diferentes nunca no mesmo PDF (regra atual de `donosDosEscolhidos`).

## E-mails e WhatsApp — a mesma família

Vale para o e-mail do fechamento (M5.4), o do repasse (M4.10), as mensagens ao hóspede (M9.2) e, quando
ligado, o WhatsApp (M10). Modelos continuam editáveis em Configurações → Modelos de mensagem (M1.7); o
que se fixa é a **ordem e o tom**, não o texto:

1. saudação pelo primeiro nome;
2. uma frase dizendo o que é a mensagem ("segue o fechamento de outubro", "sua reserva está
   confirmada", "amanhã é o check-out");
3. **um destaque** — o número ou a data que importa (valor repassado e data do Pix; dia e hora do
   check-in; código da reserva);
4. lista curta, até cinco linhas, do que a pessoa precisa saber ou fazer;
5. próximo passo ou onde ver mais (link do portal / "o relatório completo está anexo");
6. assinatura curta e um contato.

Visual do e-mail (HTML simples, com versão em texto equivalente — o WhatsApp usa a de texto): faixa
verde-floresta com a marca, fundo papel, serifa só no título, uma tabela simples quando houver
valores, botão musgo quando houver link; sem imagens pesadas (foto só no relatório). Tom de
`RELATORIOS-E-TOM.md` §5: caloroso, simples, direto, sem jargão nem promessas; emoji só se já for o
tom da conversa. Nenhum arquivo sem contexto: todo PDF vai com a mensagem.

## Implementação (item M5.7)

Reaproveita `app/src/relatorios/` (`relatorio.ts` monta os textos a partir do portal; `pdf.ts` desenha
com pdf-lib; `gerar.ts` decide quem pode gerar) e troca o desenho:

1. **Tokens no PDF:** as cores saem de uma lista única (`relatorios/tema.ts`) com os mesmos valores
   dos tokens do M7.5 (DESIGN.md é a fonte); títulos em Times-Roman (serifa padrão do PDF, no papel
   da Georgia do site; uma serifa própria só por arquivo local, se Diego quiser), corpo Helvetica.
2. **Dados novos em `DadosRelatorio`:** `comoChega` (pago pelo canal / repassado no mês / a
   transferir / a liberar, com motivos) e `conciliacao` a partir de `repasses/extrato` e dos repasses
   do mês; `metricas` (módulo puro `relatorios/metricas.ts` com testes: noites, ocupação, diária
   média, variações, acumulado, série de 12 meses, regras de "sem dado"); por reserva, canal, código
   e os componentes do livro (taxa, limpeza, comissão) já existentes por lançamento (M4.2).
3. **Páginas** 1–4 como acima, cada uma numa folha A4; gráfico desenhado com retângulos (sem imagem); hachura para "sem dado".
4. **Variante marketplace** pelo tipo de contrato; linhas do modelo B só com o M12.2 pronto (até lá,
   as vendas do site aparecem com a comissão do contrato, como hoje).
5. **E-mails** do fechamento e do repasse ganham o esqueleto da seção anterior (HTML + texto); os
   modelos existentes continuam editáveis.
6. **Testes:** métricas puras; extração de texto do PDF (como `relatorio.test.ts` faz hoje) para a
   presença de cada bloco, da base do destaque e das frases de aviso; isolamento de dados (dono,
   imóvel, favorecido); mês parcial; "sem dado".
7. Documentação: ROADMAP (M5.7 feito), GUIA-DIEGO (seção 2 e "como está ficando" com prints
   fictícios), este arquivo (situação).

## Fora do escopo do M5.7

- Fotos reais (M7.3); histórico anterior a 1/10/2026 (M11.1) — até ele, as comparações dizem "sem
  dado"; WhatsApp (M10); exportação para planilha/contador (ideia em `requisitos/labs/`); segundo
  gráfico (ocupação) — decisão de Diego depois de ver o primeiro.

## Referências

- Modelo navegável: `prototipos/relatorio-mensal/relatorio.html` (dados fictícios; abrir no navegador;
  imprimir em A4 mostra as quebras de página).
- Visual: `requisitos/product/DESIGN.md`. Repasses e extrato: `requisitos/product/REPASSES-POR-PERIODICIDADE.md`.
- Conferência, destinatários e tom: `requisitos/operations/RELATORIOS-PROPRIETARIOS.md`,
  `requisitos/operations/RELATORIOS-E-TOM.md`.
