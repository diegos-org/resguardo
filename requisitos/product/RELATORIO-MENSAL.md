# Relatório mensal do proprietário — modelo oficial (M5.7)

**Situação:** especificado em 4/10/2026 a pedido de Diego e **implementado em 4/10/2026 (item M5.7 do
ROADMAP, feito)**: `app/src/relatorios/` (`metricas.ts` e `dinheiro.ts` puros, `relatorio.ts` textos, `pdf.ts`
desenho, `extratos.ts` extratos guardados, `tema.ts` cores) e `app/src/email/modelo.ts` (esqueleto dos e-mails).
Fora deste item, como previsto: foto da capa (M7.3), linhas do modelo B (M12.2), histórico anterior a
1/10/2026 (M11.1), WhatsApp (M10). Ajustes de Diego em 4/10 já aplicados: quadros 2×2 em vez de quatro
em linha, nada com rolagem lateral no celular, cada página como uma folha. Modelo navegável com dados
fictícios em `prototipos/relatorio-mensal/relatorio.html`.

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
- **Resultado por noite, dinheiro por data de pagamento.** O resultado do mês e os números do mês
  seguem a competência (rateio igual por noite, regra de 24/09). O dinheiro — "como chega até você"
  e a conciliação — segue a **data em que o canal pagou**: o Airbnb paga o proprietário direto, no dia
  seguinte ao check-in, a reserva inteira; uma reserva de 29/9 a 2/10 foi paga em 30/9, então a
  noite de outubro **não** entra no "pago pelo Airbnb em outubro" (entrou em setembro), e o relatório
  escreve a ponte entre os dois ("inclui R$ X de noites de setembro; R$ Y de noites de outubro já
  vieram em setembro"). É o que o extrato do Airbnb mostra, por pagamento. (Decisão de Diego em
  4/10; a mesma regra vale para o acerto por fora do início do sistema, item M4.12.)
- **Avisar em vez de supor.** Métrica sem dado no período inteiro aparece como "sem dado no sistema",
  nunca zero nem estimativa. Recebimento do canal não registrado: a parte é "a liberar", com o motivo.
  Total de canal não é lucro; "enviado" não é "creditado".
- **Dinheiro em centavos inteiros**, formatado em R$; fuso `America/Sao_Paulo`.
- **Privacidade.** Hóspede só pelo primeiro nome; nenhuma chave Pix completa no PDF (a transferência
  cita "a chave cadastrada no portal"); extrato de outro imóvel ou de outro favorecido nunca entra;
  foto só real e autorizada (M7.3) — até lá, o quadro "foto em breve", nunca imagem genérica.
- **Autorização no servidor** como hoje (`relatorios/gerar.ts`): portal só o próprio dono, dentro da
  janela, sem anexos; painel com foto e extrato anexados na hora, com histórico.
- **Legível em A4, na tela e no celular**: uma coluna, tabelas com números alinhados à direita;
  texto do corpo de 9,5 a 11 pt (13–15 px na tela), tabelas densas (reservas e conciliação) no mínimo
  9 pt (12 px), notas de rodapé e etiquetas no mínimo 8 pt (11 px); nada de cor fixa no código
  (tokens do M7.5 para cor e fonte; os tamanhos são os deste documento, não os do site). Cada página cabe numa folha A4
  (no PDF nada é cortado). Na tela do celular (a partir de 360 px de largura), **nada rola de lado**:
  a página encolhe como uma folha; a tabela de reservas e a de canais viram uma lista empilhada
  (um bloco por reserva, rótulo e valor em cada linha) e os quadros ficam um embaixo do outro
  (pedido de Diego em 4/10). Bonito e relevante, sem ser exaustivo: um gráfico e um bloco de quatro
  números (página 2); o detalhe fica nas páginas seguintes.

## Estrutura (página a página)

### 1. Capa e resultado
1. **Faixa** verde-floresta: marca "Sua Casa *Leblon*" (itálico dourado), "Relatório mensal ·
   {mês de ano}" e, à direita, "Emitido em {data} · fechamento do mês" (ou "parcial até {dia}").
2. **Identidade:** nome público do imóvel (serifa), "Para {proprietário}" e "com cópia a
   {representante}, representante autorizado" quando houver; bairro/cidade; tipo de contrato e
   comissão em vigor (gestão completa X% / marketplace).
3. **Foto** do imóvel (3:2, real e autorizada).
4. **Seu resultado em {mês}** — valor grande com a base: "sua parte nas reservas do mês, em todos os
   canais, já descontadas as despesas do imóvel". Ao lado, **Como chega até você**, por data de
   pagamento (ver "Resultado por noite, dinheiro por data de pagamento"), uma linha por
   caminho, só as que existirem: pago direto pelo canal (Airbnb, split) no mês — só o que o canal já
   pagou até a data do relatório; data do canal ainda no futuro aparece como "previsto para", na capa
   e na conciliação; já repassado no mês
   (antecipados, com as datas — o Pix inteiro, como gravado no repasse e na tabela da página 3, com a
   parte de outro mês de uma reserva que atravessa e a de reservas de outro imóvel do mesmo dono, fora
   do relatório, discriminadas, como no "pago pelo canal"); a transferir no fechamento (valor, data e **quem paga quem**: "a Sua
   Casa Leblon transfere para {nome}" ou "{nome} transfere para a Sua Casa Leblon", pela chave Pix
   cadastrada); a liberar (recebimento do canal pendente / liberação do provedor), com o motivo.
5. **Do bruto ao resultado** (tabela): bruto das reservas; taxas dos canais; líquido depois dos
   canais; comissão da gestão (X% sobre o líquido); despesas e ajustes do imóvel (um total, detalhe
   na página 3); ajuste "responsabilidade da empresa" quando houver, com o estado; **seu resultado**.
   No marketplace, as linhas do modelo B (desconto do hóspede, taxa do pagamento, parte da SCL)
   aparecem só para as vendas do site (ver "Variantes").
6. **Avisos** (só se houver): pendências que mudam a leitura (recebimento não registrado,
   lançamento em conferência, compensação pendente), uma linha cada, com o que acontece depois: o
   valor a liberar "entra no próximo repasse; você não precisa fazer nada"; quando é o proprietário
   quem transfere, o aviso pede a transferência (chave Pix da empresa no portal), nunca o contrário.
7. Rodapé: "Os números são os mesmos do portal." e, **só quando há anexos** (PDF do painel e do
   e-mail), "O extrato oficial de cada canal está no fim, como emitido."; no PDF do portal, que
   sai sem anexos, a frase é "Os extratos oficiais dos canais ficam com a equipe: peça se
   precisar." Página N de M (M conta o PDF inteiro, inclusive as páginas copiadas dos extratos, que levam só o número). A capa cabe numa folha A4: foto,
   resultado, "como chega" e a tabela do bruto ao resultado; os números do mês ficam na página 2.

### 2. Números e reservas do mês
Em cima, **Números do mês** — quatro quadros em **duas linhas de dois** (pedido de Diego em 4/10:
com quatro lado a lado o texto fica apertado) e, embaixo deles, o gráfico (ver "Métricas"). Depois,
as reservas:
"{N} reservas · {n} noites em {mês}". Uma linha (ou cartão) por reserva: primeiro nome do hóspede,
canal, código do canal, entrada → saída, noites no mês, bruto, taxa do canal, limpeza (quando o
componente existir no livro), comissão da gestão, **sua parte** e situação da parte (paga pelo canal em {data}, ou prevista para {data} pelo canal quando a data ainda não chegou /
repassada em {data} / a transferir / a liberar: {motivo}). Nota de rodapé: estadia que atravessa o
mês entra só com as noites do mês, rateio igual por noite (regra de 24/09). Ordem: por entrada.

### 3. Conciliação e repasses
1. **Do extrato dos canais ao seu resultado** — uma linha por canal, **pelo que o canal pagou no
   mês** (data do pagamento: Airbnb, dia seguinte ao check-in; Booking, site e direta, data do
   recebimento registrado ou da liberação do provedor): reservas, bruto, taxa, quem recebeu (o canal
   pagou a você direto / pagou à Sua Casa Leblon em {datas} / liberado pelo provedor em {data} /
   **a receber**), sua parte. Embaixo, a **ponte para o resultado do mês**: "+ noites de {mês}
   pagas no mês anterior" e "− noites de {mês seguinte} pagas neste mês", até fechar nos totais da
   capa (competência). É a "conciliação do extrato ao mês completo" do modelo da Lia.
2. **Repasses do mês** — antecipados pela data do Pix (a do pagamento quando pago, a programada
   enquanto não; o programado para 31/10 e pago em 1/11 é de novembro), com data, valor, reservas,
   "comprovante no portal", e o
   fechamento: saldo do acerto, adiantamentos descontados, valor a transferir, quem paga quem, data
   prevista. A liberar: lista com o motivo e "entra no próximo repasse".
3. **Despesas e ajustes do imóvel** — data, descrição, valor, nota/anexo no portal.
4. "Posição extraída em {data e hora}. Repasse 'enviado' não confirma crédito na sua conta;
   confira o comprovante no portal."

### 4. Anexos
Extratos oficiais dos canais, **como emitidos, sem alterações**, um bloco por canal (Airbnb; Booking e
outros quando houver), com a nota "páginas X a Y do extrato completo" quando for parcial. Sem anexo no
PDF do portal (como hoje): a página 4 não existe nele, o rodapé da capa diz onde pedir os extratos e
a numeração conta só as páginas que existem; no painel, anexados na hora; no e-mail, os guardados por
imóvel e mês (ver "Portal × painel/e-mail").

## Métricas e gráfico (página 2)

Todas vêm do livro e do calendário do SCL; nenhuma é estimada.

| Quadro | Definição | Quando aparece |
|---|---|---|
| **Noites e ocupação** | noites ocupadas no mês (estadias confirmadas nos imóveis do relatório, independentemente de em que livro está o dinheiro; cada noite de cada imóvel uma vez) e ocupação = noites ocupadas ÷ noites disponíveis, onde disponíveis = noites de imóvel no período de posse do proprietário − noites bloqueadas pelo proprietário para uso próprio (M5.5). Posse como intervalos (histórico de troca de dono + vínculo atual): ocupadas, bloqueadas e disponíveis contam só dentro da posse — uma estadia que atravessa a troca de dono fica, para cada dono, com as noites em que o imóvel era dele. Mostra "{n} de {d} disponíveis" e as bloqueadas. Com zero noites disponíveis (mês inteiro bloqueado para uso próprio), a ocupação é "não se aplica", com a nota "mês bloqueado para seu uso"; nunca 0 ÷ 0 | sempre (a ocupação, "não se aplica" sem noite disponível) |
| **Diária média** | bruto ÷ noites ocupadas, os dois só das noites contadas (dentro da posse e do período, fora das bloqueadas para uso próprio, e a noite que duas reservas sobrepostas disputam uma vez só, com a que entrou primeiro) — o bruto é o de cada estadia no livro (em vigor: a reserva divergente usa o valor protegido; sem lançamento, o valor da reserva), rateado igual por noite, dessas noites; rótulo "por noite, com limpeza" (o bruto do livro inclui a limpeza) | se houver noite ocupada; senão "sem reserva no mês" |
| **Comparado ao mês anterior** | variação % do resultado e ocupação "de X% para Y%"; se o resultado do mês de comparação for zero (mês sem reserva e sem despesa), mostra a diferença em R$ ("+ R$ X; setembro sem resultado"), nunca % | só se o mês anterior estiver inteiro no sistema (depois do início do sistema, M4.11, ou do histórico importado) |
| **Mesmo mês do ano anterior** | variação % do resultado; base zero, a mesma regra do mês anterior (diferença em R$) | idem; senão "sem dado no sistema" |
| **Acumulado do ano** | soma do resultado de janeiro até o mês — ou "desde {mês/ano}" quando o dado começa depois de janeiro, escrito no rótulo | sempre que houver ao menos um mês |
| **Gráfico** | barras dos últimos 12 meses do resultado (sua parte − despesas); meses sem dado em hachura, com legenda "sem dado no sistema"; eixo em R$ mil; o mês atual destacado | sempre |

Mês parcial (relatório do mês corrente): métricas calculadas até o dia, com o rótulo "até {dia}" —
inclusive o denominador da ocupação: noites disponíveis contadas só até o dia (noites de 1 a {dia}
menos as bloqueadas nesse intervalo), nunca o mês inteiro, senão 10 noites ocupadas até 10/10
apareceriam como 10 de 31 em vez de 10 de 10 —, e sem comparação percentual com meses inteiros (a
comparação mostraria queda falsa).

## Variantes

- **Portal × painel/e-mail.** Mesmo PDF; o do portal sai sem anexos e só dentro da janela do portal
  (como hoje); o do painel e o do e-mail do dia do fechamento (M5.4) levam a foto e os extratos. **De
  onde vêm os anexos do e-mail** (hoje `relatorioDoFechamento` gera sem anexos e só o painel aceita
  upload na hora): a equipe guarda, por imóvel, proprietário favorecido e mês, os extratos oficiais dos canais (o
  proprietário é parte da chave: imóvel que troca de dono no mês tem um extrato por dono, e o relatório
  de um nunca anexa o do outro) — upload em
  Financeiro → Fechamento, antes do dia do fechamento, em armazenamento privado como o comprovante
  do Pix do M4.10 —, e a foto vem da ficha do imóvel (M7.3); o e-mail anexa o que estiver guardado
  e, sem arquivo guardado, sai sem anexos, com o rodapé "ficam com a equipe" e um aviso no painel
  ("relatório de {mês} enviado sem o extrato do Airbnb"). Importação automática do extrato do canal
  fica para o M4.4.
- **Gestão completa × marketplace.** No marketplace, a capa diz "contrato marketplace"; "Do bruto ao
  resultado" separa **vendas pelo site SCL** (valor cheio, desconto do hóspede, taxa do pagamento,
  parte da SCL, sua parte — modelo B, M12.1/M12.2) de **vendas suas nas OTAs** (comissão da SCL
  zero). As duas entram no resultado, nos números do mês, na conciliação e no gráfico — **um escopo
  só**, o mesmo da capa (sua parte em todas as reservas do mês); o que muda entre elas é o caminho do
  dinheiro em "como chega até você": OTA com `split` (M2.7) é "pago a você pelo canal"; OTA com
  `empresa` e venda do site passam pelo repasse do M4.10.
- **Mês corrente (parcial).** Igual, com "parcial até {dia}" na faixa e a frase de tom do guia da
  Lia: é para acompanhar o andamento; o fechamento completo vem no dia do fechamento.
- **Dia de emissão.** O relatório do mês sai no dia do fechamento mensal (hoje, dia 1º; Diego
  propôs em 4/10 passar para o dia 2, porque o Airbnb paga a reserva com check-in no último dia
  do mês só no dia 1º — item M4.13, dia configurável). O que o canal ainda não pagou até lá
  aparece como "a receber"/"a liberar" e entra no mês seguinte; nunca é suposto.
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
   transferir / a liberar, com motivos) e `conciliacao` por data de pagamento, com a ponte para a
   competência, a partir de `repasses/extrato`, dos recebimentos (M4.10) e da regra de pagamento do
   canal (Airbnb: dia seguinte ao check-in — a mesma regra do M4.12, num lugar só); `metricas` (módulo puro `relatorios/metricas.ts` com testes: noites, ocupação, diária
   média, variações, acumulado, série de 12 meses, regras de "sem dado"); por reserva, canal, código
   e os componentes do livro (taxa, limpeza, comissão) já existentes por lançamento (M4.2).
3. **Páginas** 1–4 como acima, cada uma numa folha A4; gráfico desenhado com retângulos (sem imagem); hachura para "sem dado".
4. **Variante marketplace** pelo tipo de contrato; linhas do modelo B só com o M12.2 pronto (até lá,
   as vendas do site aparecem com a comissão do contrato, como hoje).
5. **Extratos guardados por imóvel e mês:** tabela e armazenamento privado (como o comprovante do
   Pix), tela de upload em Financeiro → Fechamento, e `relatorioDoFechamento` anexando o que houver
   (sem arquivo, PDF sem anexos com o rodapé certo e aviso no painel).
6. **E-mails** do fechamento e do repasse ganham o esqueleto da seção anterior (HTML + texto); os
   modelos existentes continuam editáveis.
7. **Testes:** métricas puras; extração de texto do PDF (como `relatorio.test.ts` faz hoje) para a
   presença de cada bloco, da base do destaque e das frases de aviso; isolamento de dados (dono,
   imóvel, favorecido); mês parcial; "sem dado".
8. Documentação: ROADMAP (M5.7 feito), GUIA-DIEGO (seção 2 e "como está ficando" com prints
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
