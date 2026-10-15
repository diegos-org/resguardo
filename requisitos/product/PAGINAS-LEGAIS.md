# Páginas legais do site — M7.4 (pedido de Diego em 4/10/2026)

> Situação: pronto em 9/10/2026. Termos de uso, Política de privacidade e Política de cancelamento no
> site, com texto editável no painel, versão numerada e datada a cada publicação e aceite do hóspede
> antes de gerar o Pix (e, desde o M8.2b, de 9/10/2026, antes do formulário do cartão). **Os textos-base foram escritos pelo Claude a partir da lei e ainda não foram
> conferidos por um advogado:** Diego revisa com o contador e, de preferência, com um advogado antes
> de ligar o pagamento de verdade (pontos no fim deste documento). Base: ROADMAP (M7.4, M8.2,
> M5.6, M5.9), `PAGAMENTO-SITE.md`, `RECEBIMENTO-SITE.md` (decisão 5) e
> `COMO-FUNCIONA-PROPRIETARIO.md`. **Desde o M8.2c (10/10/2026)**, a devolução do cancelamento lê a versão
> da política aceita no pagamento, o limite do arrependimento passou a ser uma regra da versão (caixa no
> formulário) e o hóspede pede o cancelamento em Minha reserva (seção "Para o M8.2c — feito em 10/10/2026").
> **Desde o M8.2d (10/10/2026)**, a alteração para um valor menor segue a política contando da entrada original ou
> da nova, a que vier primeiro, o pagamento da diferença aceita os Termos e a Privacidade em vigor e mantém a
> política da reserva, e a devolução de parte do valor espera a liberação do pagamento (seção "Para o M8.2d — feito
> em 10/10/2026").
> **Desde o M7.14 (15/10/2026)**, os dois formulários de proprietários de "Anuncie seu imóvel" registram a
> autorização: data e hora, versão e texto exato da caixa (falha "Formulários de proprietários", em "Pontos a
> conferir", e "Fora deste item", abaixo).

Código: `app/src/configuracoes/documentos-versionados.ts` (motor de versões, o mesmo do "Como
funciona"), `paginas-legais-texto.ts` (regras puras: campos, blocos do texto, prazo do reembolso,
validação), `paginas-legais.ts` (banco: ler, publicar, versões em vigor), `paginas-legais-rascunho.ts`
(texto-base), `app/src/site/aceites.ts` (aceite do hóspede), `app/src/site/paginas-legais.ts` (o que a
página pública mostra), tabela `aceites_site` e coluna `pagamentos.aceite_id` (migração 0065). Telas:
Configurações → Páginas legais do site, `/termos`, `/privacidade`, `/cancelamento`, a caixa de aceite
no "Gerar Pix" (`components/site/BlocoAceite.tsx`) e, na ficha da reserva, a linha "Aceite" de cada
tentativa e a seção "Páginas legais aceitas".

## Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | O mecanismo de versões do "Como funciona" (M5.6) virou um motor genérico; o "Como funciona" usa o motor com o mesmo formato gravado e as mesmas funções, e as páginas legais são mais três documentos dele. | Uma regra, um lugar. Os testes do M5.6 passam sem mudança. |
| D2 | Uma chave de configuração por documento (`termos_uso`, `politica_privacidade`, `politica_cancelamento`), cada uma com as suas versões, numeração e trava. | Publicar um documento nunca mexe nos outros. |
| D3 | Cada documento é um texto longo (até 30 mil caracteres): `## ` abre um título, linha em branco separa parágrafos, `- ` e `1. ` abrem listas. A Política de cancelamento tem também um **resumo** (até 2 mil), mostrado junto da caixa de aceite e no topo da página. Os títulos dos documentos são fixos. | Tudo editável, e a revisão de um advogado pode ser colada de uma vez. O resumo exigido antes da contratação (Decreto 7.962/2013, art. 4º, I) fica num lugar só. |
| D4 | `{{campo}}` vira um dado de Configurações → Empresa (novo campo "encarregado") e os valores usados ficam **congelados na versão**. Publicar é recusado com campo usado vazio, campo que não existe ou campo fora do documento dele. | Avisar em vez de supor; o que o hóspede leu e aceitou nunca muda. |
| D5 | O prazo do reembolso integral (14 dias) é um **campo da versão** da política (de 1 a 365), entra no texto por `{{dias_reembolso_integral}}`, e a política só é publicada se o resumo ou o texto usar esse campo. | O texto e a devolução (M8.2c) leem o mesmo número; mudar o prazo é versão nova, valendo daquela data em diante. |
| D6 | Sem rascunho guardado: antes da versão 1 o formulário traz o texto-base; depois, a versão em vigor. Prévia ao vivo e aviso de "sair sem publicar". | Só existe um estado não publicado, que nunca se confunde com o publicado. |
| D7 | O aceite é pedido **no pagamento**, não ao segurar as datas: a caixa obrigatória fica no "Gerar Pix", junto do resumo da política e da data-limite desta reserva. Ao segurar as datas, só o aviso de como os dados são usados, com o link da Política de privacidade. | O contrato se faz no pagamento. Reservas pela conversa não ficam presas à política do site. O cartão (M8.2b) usa a mesma caixa. |
| D8 | Tabela nova `aceites_site` (uma linha por aceite com as versões dos três documentos) e `pagamentos.aceite_id` em cada tentativa. Sem nome, e-mail nem IP. | `aceites_documento` exige proprietário e usuário; o hóspede não tem usuário e é identificado pela cotação → reserva. Dado do pagador fica fora das tabelas do pagamento (`PAGAMENTO-SITE.md`, "Dados pessoais"). |
| D9 | A conferência que vale é a da fase 1 do Pix (`pagamentos/pix.ts`), sob as travas da cotação, depois de reaproveitar um Pix válido e antes do teto de 3 Pix; o aceite enviado é gravado **na mesma transação** da tentativa. As versões publicadas são lidas sob uma trava **compartilhada** dos três documentos. | Deny-by-default e atômico, sem ciclo de travas, e os hóspedes não esperam uns pelos outros. |
| D10 | A trava da empresa fica em `podeCobrar` (motivo `sem_paginas_legais`, depois da chave do painel e antes da conferência da conta). O aceite de cada cotação **não** entra na oferta do Pix. | É a trava única que já existia; fora da oferta, a página fica em "pagar" com a caixa, em vez de "fale com a equipe". |
| D11 | Versão nova depois do aceite: um Pix ainda válido continua valendo com o aceite antigo; um Pix **novo** pede o aceite das versões em vigor. A aprovação de um pagamento (aviso, página, rotina, "Conferir agora") **nunca** confere aceite. | Mudança vale daquela data em diante; dinheiro que chegou nunca vira "aprovado sem reserva" por um detalhe. |
| D12 | Não existe "despublicar": as versões só se acumulam e todas continuam no site em `/<página>?versao=N`. | O contrato aceito tem de continuar disponível (Decreto 7.962/2013, art. 4º, IV), e a trava do pagamento só pode ir de fechada para aberta. |

## Documentos e versões

- **Guardado em:** `configuracoes(chave).valor = { versoes: [...] }`. Cada versão tem número, data
  (`hojeISO()`, em São Paulo), autor, as seções (`texto`; no cancelamento, também `resumo`), os
  **valores congelados** dos campos que o texto usa e, só no cancelamento, `regras.diasReembolsoIntegral`
  e, desde o M8.2c, `regras.arrependimentoAteEntrada` (ausente = sim, como na versão 1).
  Termos e Privacidade têm `regras: null`. Ao publicar, as versões anteriores voltam ao banco exatamente como
  estavam gravadas (a v1, publicada sem o campo do limite, não o ganha na publicação da v2).
- **Campos:** `{{nome_empresa}}`, `{{razao_social}}`, `{{cnpj}}`, `{{endereco}}`, `{{email_contato}}`,
  `{{telefone_contato}}`, `{{encarregado}}` (todos de Configurações → Empresa) e
  `{{dias_reembolso_integral}}` (só na Política de cancelamento, do campo da própria política).
- **Publicar:** valida o formulário (todas as seções escritas e no limite; no cancelamento, o prazo
  de 1 a 365), confere a versão base (se outra pessoa publicou com a página aberta, recusa e pede
  para recarregar), confere os campos contra a Empresa de agora e grava a versão seguinte com uma
  linha de auditoria (o que mudou por seção, por campo congelado e no prazo). Texto, valores e prazo
  iguais aos da versão em vigor: nenhuma versão nova ("Nada mudou"). Uma mudança na Empresa que o
  documento usa só aparece no site quando Diego publica de novo; até lá o painel avisa ("os dados da
  empresa mudaram depois da versão N").
- **Site:** `/termos`, `/privacidade` e `/cancelamento` mostram a versão em vigor com "Versão N, em
  vigor desde dd/mm/aaaa" e os valores congelados nela. `?versao=N` mostra uma versão anterior com o
  aviso de que foi substituída e o link para a atual (fora dos buscadores); versão inexistente dá
  "não encontrada". Antes da versão 1, só "Esta página está em preparação" — nada do texto-base aparece.
  O rodapé de todas as páginas tem os três links e, com razão social ou CNPJ preenchidos, a
  identificação da empresa (Decreto 7.962/2013, art. 2º; com os dados de agora).
- **Painel:** Configurações → Páginas legais do site (só quem tem `configuracao:editar`): situação
  dos três, aviso de que o site não oferece pagamento enquanto falta publicar algum, avisos dos
  campos (faltando na Empresa, desatualizados, texto que cita o Beds24 — só aviso, porque o advogado
  pode exigir nomear o fornecedor), formulário com prévia, "Copiar o texto" e publicação com
  confirmação; histórico com versão, data, autor, **quantos aceites cada versão teve** e o link para
  ver no site.

## Aceite no pagamento

**O hóspede, passo a passo:**
1. Ao segurar as datas, nada a marcar; o formulário diz "Usamos seus dados só para a sua reserva,
   como explica a Política de privacidade" (link para a versão em vigor). É o aviso de transparência
   da LGPD; a base legal é a própria reserva (LGPD, art. 7º, V), não consentimento.
2. No "Gerar Pix" (e no "Gerar outro Pix"), enquanto a cotação não aceitou as versões em vigor: o
   resumo da Política de cancelamento, a data-limite desta reserva ("o reembolso integral vale para
   pedidos de cancelamento até 23h59 de dd/mm/aaaa (horário de Brasília)" ou "esta reserva já está a
   menos de N dias da entrada…"), a caixa obrigatória "Li e aceito os Termos de uso e a Política de
   cancelamento, e li a Política de privacidade" (cada um com o link da versão, numa aba nova) e,
   escondidas, as três versões que a página mostrou.
3. Já aceitas: só a linha "Você aceitou os Termos de uso (versão N), a Política de cancelamento
   (versão N) e leu a Política de privacidade (versão N) em dd/mm às hh:mm". Na reserva confirmada, a
   mesma linha (do aceite do pagamento que confirmou) e a data-limite.

**Tabela `aceites_site`:** organização, cotação, reserva, as três versões, origem (`pix` ou
`cartao`) e `aceito_em`. Única por cotação + versões (gravar duas vezes o mesmo aceite é uma linha e
uma auditoria). Chaves estrangeiras sem apagar em cascata: o aceite é prova. `pagamentos.aceite_id`
guarda o aceite que valia quando a tentativa foi criada (nulo nas tentativas de antes do M7.4).

**Travas:** publicar toma só a trava exclusiva da chave do documento. A fase 1 do Pix já segura
imóvel → reserva → cotação → tentativas → devoluções e só depois toma as travas **compartilhadas**
dos três documentos, nesta ordem: termos → privacidade → cancelamento. Nunca se toma trava de
configuração antes das travas de linha num caminho do pagamento; o aceite avulso
(`registrarAceiteDoHospede`) trava a cotação primeiro. O tempo-limite de espera de 15 s vale também
aqui ("ocupado").

**Versão nova publicada depois do aceite:**

| Situação | Resultado |
|---|---|
| Página aberta, hóspede marca com a v1, Diego publica a v2 antes do envio | `aceite_mudou`: nada é gravado; a página recarrega com a v2 e a caixa. |
| v1 aceita, Pix pendente e válido, v2 publicada | O mesmo Pix é mostrado de novo, com o aceite da v1. Nada é pedido. |
| v1 aceita, Pix vencido, v2 publicada, "Gerar outro Pix" | `aceite_pendente`: a caixa volta com a v2; o aceite novo é outra linha, a tentativa nova aponta para ele e a antiga continua com a v1. |
| Pagamento aprovado depois (aviso, página, rotina, "Conferir agora", aprovação tardia) | Nunca confere aceite. O `aceite_id` do pagamento que confirmou diz qual política vale. |
| Outro aparelho ("Continuar o pagamento") | O aceite é da cotação: o aparelho herda, e só aceita de novo se as versões mudaram (sempre depois de ter o cookie do pedido). |
| Nada publicado | `podeCobrar` recusa (`sem_paginas_legais`) e o site segue pela conversa; a fase 1 recusa como "não oferecido", como segunda linha de defesa. |
| Reserva confirmada à mão pela equipe | Sem aceite. A política do site vale para reservas pagas pelo site; as fechadas pelo WhatsApp são decisão de Diego (abaixo). |

## Dados pessoais

- `aceites_site` guarda só ids, números de versão, origem e a hora. A auditoria do aceite
  (`cotacao.aceitar_paginas_legais`, na reserva) não tem usuário, nome nem e-mail: só "termos v1,
  privacidade v1, cancelamento v1 (pix)". A ação devolve só "ok" ou o erro. Teste: depois de um fluxo
  completo com o provedor falso, nenhuma dessas linhas tem o e-mail ou o nome do hóspede.
- **IP não é guardado.** A pessoa é a da reserva (nome e e-mail dados ao segurar as datas) e a
  autorização é o cookie assinado da cotação, que só quem tem o e-mail obtém. O IP traria deveres de
  guarda da LGPD sem acrescentar prova. **Em aberto para Diego e o advogado:** guardar um resumo
  (hash) do IP no aceite.

## Trava do pagamento

`podeCobrar` (`pagamentos/oferta.ts`) só libera cobrar com as três páginas publicadas, conferido
depois da chave "Oferecer pagamento no site" e antes da conta no Mercado Pago. O texto do motivo
aparece na aba Pagamento no site, em Integrações e nas páginas do site (que seguem pela conversa).
`provedorDeConferencia` não muda: conferir, cancelar e devolver nunca dependem das páginas legais.
Depois do deploy, as prévias da Vercel só voltam a oferecer o Pix quando as três forem publicadas no
banco das prévias (que é separado do de produção).

## Para o M8.2c — feito em 10/10/2026

Desenho e regra completos em `PAGAMENTO-SITE.md`, seção "Cancelamento pela política (M8.2c)".

- A devolução de um pagamento segue a Política de cancelamento **da versão aceita naquele
  pagamento**: `pagamentos.aceite_id` → `aceites_site.versao_cancelamento` → `regras` da versão
  (`politicaDoPagamento`, que devolve as regras inteiras), nunca a versão em vigor no dia do cancelamento.
  Pagamento sem aceite (de antes de 9/10): o sistema não calcula; a equipe decide e escreve o motivo (quando
  a SCL cancela, sempre integral).
- O prazo é o de `prazoDoReembolso(checkin, dias, hoje)`: último dia = entrada − dias (datas do
  calendário no fuso do imóvel), até 23h59. Vale o momento em que a SCL **recebeu** o pedido.
- O arrependimento de 7 dias conta do `aprovadoEm` do pagamento (exclui o dia do pagamento e inclui o
  último, Código Civil, art. 132; `DIAS_ARREPENDIMENTO`, da lei, não editável), com devolução integral mesmo
  dentro dos N dias. **O limite "até o horário de entrada" virou regra da versão**,
  `regras.arrependimentoAteEntrada` (a regra pura `decidirPelaPolitica` a lê; ausente = sim):
  - no formulário da Política de cancelamento, a caixa "O arrependimento vale só até o horário de entrada
    (como no texto-base). Desmarque só se o advogado tirar esse limite do texto — e ajuste o texto junto.",
    que abre com o valor da versão em vigor (`regrasComPadrao`: a v1, sem o campo, abre **marcada**), então
    publicar a v2 por outro motivo não tira o limite sem querer; o texto-base também traz o limite;
  - mudar só a caixa já cria uma versão nova (entra na auditoria do que mudou);
  - publicar é recusado quando a caixa está desmarcada e o texto ainda tem a frase-base "até o horário de
    entrada no dia do check-in": "Você desmarcou o limite do arrependimento, mas o texto ainda diz que ele vale
    até o horário de entrada no dia do check-in: ajuste a seção "Direito de arrependimento" ou marque a caixa."

  O limite continua a confirmar com o advogado (abaixo).
- **O botão em Minha reserva foi feito como pedido, não como cancelamento:** "Pedir o cancelamento" (para a
  reserva paga pelo site, do mesmo e-mail, antes do horário de entrada, com "Hóspede pode pedir o cancelamento
  em Minha reserva" ligado em Configurações → Pagamento no site — vem ligado). O horário do servidor fica
  registrado na hora e a página confirma na hora, com a data e a hora (art. 5º, § 4º); a equipe recebe um
  e-mail e faz o cancelamento no painel, com a devolução pela política. O hóspede nunca move dinheiro.
- **O e-mail de recibo do pedido** ("Cancelamento: pedido recebido", com a data e a hora em que recebemos), o
  da decisão e o da devolução feita estão prontos como mensagens do M9.2 (Configurações → Modelos de
  mensagem), mas só saem quando Diego ligar as mensagens ao hóspede. **É preciso ligar antes do pagamento de
  verdade** (confirmação por escrito, art. 5º, § 4º, e resposta em até 5 dias, art. 4º, parágrafo único). Até
  lá, a ficha da reserva mostra cada mensagem pronta para copiar, com "Mensagem enviada ao hóspede", e o
  Início avisa os pedidos esperando (atenção depois de 24 horas ou a 3 dias da entrada).
- **Texto-base:** a seção "Como pedir o cancelamento" da Política de cancelamento ganhou, depois do primeiro
  parágrafo: "Se preferir, use o botão "Pedir o cancelamento" em Minha reserva, no site: o horário do pedido
  fica registrado na hora." A versão publicada não muda sozinha: Diego publica a v2 (GUIA, seção 6).

## Para o M8.2d — feito em 10/10/2026

Desenho e regra completos em `PAGAMENTO-SITE.md`, seção "Alteração de reserva paga (M8.2d)".

- **Alteração para um valor menor** (a pergunta de 9/10, abaixo e no GUIA): **respondida pelo padrão, a
  confirmar por Diego** (★ decisão 1 do M8.2d). A diferença segue as regras de cancelamento da versão aceita no
  pagamento, como um cancelamento naquele momento: dentro do prazo do integral (ou do arrependimento), é devolvida;
  fora dele, fica retida e é dividida como uma reserva normal. **Refinamento:** os prazos contam da entrada original
  **ou da nova, a que vier primeiro** (`entradaQueConta`), e não só da original como diz o texto-base publicado
  ("contando os dias a partir da data de entrada original"): contar só da original deixaria uma estadia adiantada
  ser cancelada com devolução integral no meio da estadia. Adiar nunca reabre o prazo; adiantar o fecha. O mesmo
  vale para um cancelamento depois da alteração, e "a estadia começou" conta da entrada de agora. A frase para a v2
  da política está no GUIA (seção 6, item 42).
- **Pagamento da diferença (aumento), aceite (D11):** a reserva continua na Política de cancelamento aceita no
  pagamento que a confirmou. A caixa do pagamento da diferença diz "Li e aceito os Termos (versão T) e li a
  Privacidade (versão P). A sua reserva continua na Política de cancelamento versão N, aceita em dd/mm." (com o
  resumo e o prazo da política da reserva) e só aparece quando as versões em vigor ainda não foram aceitas na
  cotação; `aceites_site` grava `{ termos: T, privacidade: P, cancelamento: N }` (`aceiteVigenteTravado` com
  `cancelamentoDaReserva`, aceito só quando N é a versão do primeiro pagamento). Aceitar a versão N+1, que não vai
  valer para a reserva, confundiria o hóspede. Reserva paga antes do aceite das páginas legais (sem versão aceita):
  a caixa de sempre, com a política em vigor, como o domínio confere.
- **Arrependimento:** o pagamento da diferença não abre outro prazo de 7 dias; toda decisão de política da reserva
  (alteração e cancelamento) conta o arrependimento da aprovação do primeiro pagamento. A confirmar com o advogado
  (abaixo).
- **Devolução de parte do valor só depois da liberação do pagamento:** a devolução da diferença (e o restante de um
  pagamento já devolvido em parte) só é pedida ao Mercado Pago depois que ele libera o pagamento; o hóspede vê "será
  pedida quando o Mercado Pago liberar o pagamento (previsto para dd/mm)", nunca "já pedimos". Isso se afasta do
  texto-base publicado ("Pedimos a devolução ao Mercado Pago logo depois de confirmar o cancelamento" e, no
  arrependimento, "pedimos a devolução imediatamente"): ★ decisão 11 de Diego; a frase para a v2 está no GUIA (item
  42); o caso do arrependimento vai ao advogado.
- **Texto-base:** a seção "Alteração de datas" da Política de cancelamento já dizia que a diferença menor segue a
  política e que a alteração só vale confirmada por escrito; o rascunho no código não mudou nesta entrega. Para a v2,
  Diego troca "contando os dias a partir da data de entrada original" por "contando os dias a partir da data de
  entrada original ou da nova, a que vier primeiro" e cola as duas frases do GUIA (item 42). A versão publicada não
  muda sozinha.

## Para o M8.2b (cartão) — feito em 9/10/2026

- O formulário do cartão usa a mesma `BlocoAceite` e manda as mesmas versões escondidas. Com o aceite
  pendente, a caixa aparece sozinha e o formulário do Mercado Pago só carrega depois de marcada: o
  hóspede nunca digita o cartão antes de aceitar. A caixa aparece em toda situação em que o Pix ou o
  cartão podem ser oferecidos (inclusive Pix esgotado, Pix aguardando e desafio do banco), pela mesma
  lista que decide a oferta (`ESTADOS_QUE_PAGAM`).
- A fase 1 do cartão chama `aceiteVigenteTravado(tx, org, { cotacaoId, reservaId }, aceite, "cartao",
  agora)` depois das travas da cotação, como o Pix, e grava `aceite_id` na tentativa.
- O aceite é único por cotação e versões (`aceites_site_unico`): um cartão depois de um Pix aceito com
  as mesmas versões reaproveita a linha, que fica com `origem = 'pix'`. O que o M8.2c lê é o
  `aceite_id` da tentativa, não a origem.
- `registrarAceiteDoHospede` existe para um aceite fora da criação do pagamento, na ordem certa das
  travas.
- O texto-base da Política de privacidade passou a dizer, na linha do pagamento, o que o cartão guarda:
  "no cartão, também a bandeira, o número de parcelas, o valor pago com os juros e o resultado da
  verificação do banco, nunca o número do cartão". A versão publicada não muda sozinha: Diego publica uma
  versão nova antes de ligar o cartão.

## Posição sobre o arrependimento de 7 dias

- **O que a lei diz:** o Código de Defesa do Consumidor (art. 49) dá 7 dias para desistir de compras
  feitas fora do estabelecimento comercial, com devolução imediata de tudo o que foi pago "a qualquer
  título", com correção. O decreto do comércio eletrônico (Decreto nº 7.962/2013, art. 5º) regula
  esse direito nas compras pela internet e não abre exceção para hospedagem. O prazo foi contado como
  manda o Código Civil (art. 132): exclui o dia do pagamento e inclui o último dia.
- **O debate:** parte dos tribunais e dos autores limita ou afasta o arrependimento em serviços com
  data marcada (turismo, hotel, eventos), porque o fornecedor segura a data e pode não conseguir
  vender de novo. Há decisões nos dois sentidos. Não existe na lei uma exceção específica para
  hospedagem.
- **A regra de 24 horas** é da ANAC (Resolução nº 400/2016, art. 11) e vale só para passagens aéreas
  compradas com 7 dias ou mais de antecedência. Não se aplica a hospedagem e por isso não aparece no
  texto do hóspede.
- **A posição do texto:** o hóspede pode desistir em até 7 dias depois do pagamento e recebe tudo de
  volta, mesmo quando esses 7 dias caem dentro dos 14 dias antes da entrada. É a leitura mais segura,
  porque segue a letra da lei e o decreto.
- **Um limite acrescentado, a confirmar:** o arrependimento vale até o início da estadia (horário de
  entrada). Depois disso o serviço já está sendo prestado, e desistir no meio da estadia pedindo tudo
  de volta tende a ser visto como abuso. Se o advogado preferir sem esse limite, basta tirar a frase.
- **O risco para a SCL:** só aparece nas reservas pagas a menos de 21 dias da entrada (14 + 7). Nelas,
  o hóspede pode desistir até a hora da entrada e receber tudo, e talvez não dê tempo de alugar as
  noites de novo. Se pesar, a alternativa (com mais risco jurídico) é uma regra mais restritiva para
  reservas de última hora; seria uma versão nova da política, valendo só para reservas novas.

## Pontos a conferir com o contador e o advogado

**O Código de Defesa do Consumidor vale aqui?**
- Os termos descrevem a estadia como locação para temporada (Lei do Inquilinato, Lei nº 8.245/1991,
  art. 48, até 90 dias). O STJ tem entendimento antigo de que o Código não se aplica à locação regida
  pela Lei do Inquilinato; mas, quando uma empresa administra e vende estadias com serviços (limpeza,
  atendimento, chegada), os tribunais costumam ver relação de consumo com a empresa. Os textos
  assumem que o Código vale, por segurança.
- Conferir: (a) se "locação para temporada" é a melhor descrição ou se a atividade pode ser vista
  como meio de hospedagem (Lei nº 11.771/2008, cadastro no Cadastur); (b) se a frase "recebe em nome
  do proprietário" combina com o que o contador confirmou (só a comissão é receita da SCL); (c) se o
  site deve limitar as estadias a 90 dias.

**Sem devolução com menos de 14 dias**
- Ficar com 100% pode ser questionado como cláusula abusiva (Código de Defesa do Consumidor, art. 51,
  IV) ou multa excessiva (Código Civil, art. 413), principalmente se a SCL alugar as mesmas noites
  para outra pessoa. As plataformas usam políticas parecidas, mas as decisões variam.
- Saída a avaliar (não está no texto): devolver o valor das noites que forem alugadas de novo.
- O texto trata como "sem devolução" o não comparecimento, a chegada atrasada e a saída antecipada.
  Confirmar.

**A taxa do Mercado Pago**
- O texto diz só que a devolução é integral, sem desconto de taxas (decisão de 7/10). No
  arrependimento, devolver tudo é obrigatório ("valores pagos a qualquer título"), então a taxa fica
  com a SCL de qualquer jeito.
- Conferir no primeiro reembolso em teste se o Mercado Pago devolve a taxa no reembolso total e,
  com o cartão, o que acontece com os juros do parcelamento pagos pelo hóspede (item 18 de "A conferir
  no sandbox", em `PAGAMENTO-SITE.md`).

**O que o sistema precisa ter antes de vender (Decreto 7.962/2013)**
- Identificação da empresa no site (art. 2º): razão social, CNPJ, endereço e e-mail preenchidos em
  Configurações → Empresa (publicar é recusado se o texto usa um que falta; o rodapé mostra os dados).
- Resumo do contrato antes da compra, com destaque para o que limita direitos (art. 4º, I): o resumo
  da política, junto da caixa de aceite. **Feito.**
- Confirmação imediata e o contrato disponível para guardar (art. 4º, III e IV): a página da cotação
  confirma com as versões aceitas, e cada versão tem uma página fixa. **Falta:** o e-mail de
  confirmação da reserva, ligado antes do pagamento de verdade (os e-mails ao hóspede estão
  desligados até Diego ligar).
- A data-limite do reembolso integral: mostrada antes do pagamento e na página da reserva confirmada.
  **Feito** (no e-mail de confirmação, quando ele for ligado).
- Arrependimento "pela mesma ferramenta usada para contratar" (art. 5º, § 1º): **feito no M8.2c** — o
  botão "Pedir o cancelamento" em Minha reserva, além do e-mail e do WhatsApp. Conferir com o advogado se
  um pedido (que a equipe executa) basta.
- Confirmação imediata do pedido de arrependimento (art. 5º, § 4º) e resposta em até 5 dias (art.
  4º, parágrafo único): na tela, **feita no M8.2c** (data e hora do pedido); por escrito, o e-mail "pedido
  recebido" está pronto e **falta ligar** as mensagens ao hóspede; fora do horário da equipe, pelo menos uma
  resposta automática no e-mail.

**Alteração de reserva (M8.2d)**
- A redução seguindo a política, contando da entrada original ou da nova, a que vier primeiro (o texto publicado
  diz "da data de entrada original"): conferir se a regra e a frase da v2 bastam.
- O pagamento da diferença não abre outro arrependimento de 7 dias (conta do primeiro pagamento): conferir.
- A devolução de parte do valor pedida ao Mercado Pago só depois da liberação do pagamento, inclusive numa redução
  dentro dos 7 dias do arrependimento (a lei fala em devolução imediata): conferir se o aviso ao hóspede ("será
  pedida quando o Mercado Pago liberar o pagamento, previsto para dd/mm") basta.

**Privacidade (LGPD)**
- Encarregado: indicar o nome (campo novo em Configurações → Empresa) ou confirmar se a SCL pode usar
  a dispensa para agentes de pequeno porte (Resolução CD/ANPD nº 2/2022, art. 11). Mesmo com a
  dispensa, é preciso um canal de contato; o texto usa o e-mail da empresa.
- Prazo de guarda: hoje o sistema guarda os contatos das reservas para sempre. A política diz que os
  dados são apagados ou anonimizados quando terminam os prazos legais; isso precisa virar uma regra
  (por exemplo, tantos anos depois da saída) e uma rotina.
- Pedidos de acesso, correção e exclusão: sem tela; o caminho é o e-mail, com resposta completa em
  até 15 dias (art. 19).
- Dados fora do Brasil: Vercel, Neon e o serviço de e-mail são empresas de fora, e a região dos
  servidores não está registrada no projeto. Conferir as regiões nas contas (os dois primeiros
  oferecem São Paulo) e a base da transferência (art. 33, IX, e as cláusulas-padrão da ANPD,
  Resolução CD/ANPD nº 19/2024).
- Marco Civil da Internet (Lei nº 12.965/2014, art. 15): site comercial deve guardar os registros de
  acesso (IP, data e hora) por 6 meses, em sigilo. Hoje o sistema usa o IP só por cerca de um dia, e o
  que a Vercel guarda depende do plano. Se for o caso, abrir um item.
- Fornecedores: a política nomeia Mercado Pago, Vercel e Neon e descreve sem nome o serviço de e-mail
  e o sistema de gestão de reservas (o sistema de canais não é citado, decisão do M5.9). O advogado
  pode pedir os nomes. Trocar um fornecedor nomeado pede versão nova.
- Contabilidade: a política diz que dados podem ir para a contabilidade quando a lei exigir.
  Confirmar se acontece na prática.
- Documentos da portaria: não ficam no sistema; as cópias que passam pelo WhatsApp ou pelo e-mail da
  equipe também precisam de uma regra para apagar.
- Formulários de proprietários: a caixa de autorização é obrigatória, mas o sistema não registra a
  autorização (data e versão do texto). Pela LGPD, quem prova o consentimento é a empresa.
  **Mudou em 15/10/2026 (M7.14).** Antes: o pedido de contato (M7.7) e o cadastro do marketplace (M12.3) só
  aceitavam o envio com a caixa marcada, mas guardavam apenas os dados e a hora do envio, sem a autorização. Depois:
  cada envio guarda, na mesma gravação, a data e a hora em que a caixa foi marcada, a versão do texto e o texto exato
  que a pessoa viu (no pedido de contato, com o nome da empresa daquele momento), montado pelo servidor a partir de um
  lugar só (`app/src/proprietarios/autorizacao.ts`); se o texto mudou depois que a página abriu, o envio é recusado e
  a pessoa vê o texto novo para marcar de novo. Os envios de antes ficam sem registro, e o painel diz isso ("Sem
  registro"), sem palpite. Motivo: esta falha (a empresa precisa conseguir provar o consentimento). Objetivo: ter a
  prova sem mudar o texto da caixa nem a política. Continua para o advogado: se é preciso guardar também o IP ou o
  navegador de quem marcou (hoje não se guarda nenhum dos dois, como no aceite do hóspede, em "Dados pessoais").
- Cookies: só os necessários, sem análise de audiência nem publicidade, por isso sem faixa pedindo
  autorização. Se entrar uma ferramenta de análise ou de anúncio, a política e o site mudam antes.

**Outros pontos que são decisão de Diego**
- Idade mínima de 18 anos para reservar.
- Encerrar a estadia por violação grave das regras (festa, mais pessoas que o reservado): não está no
  texto; se entrar, com destaque.
- Reservas diretas fechadas pelo WhatsApp: seguem a mesma política (mandar o link na conversa) ou não.
- Alteração para um valor menor: o texto propõe que a diferença siga as regras de cancelamento,
  contando da entrada original (M8.2d). Confirmar. **Respondida pelo padrão em 10/10/2026 (M8.2d), a confirmar
  por Diego:** sim, contando da entrada original ou da nova, a que vier primeiro (seção "Para o M8.2d", acima).
- O número de dias do reembolso integral entra no texto pelo campo da política; o prazo de 7 dias do
  arrependimento é da lei e fica escrito no texto.

## Fora deste item

- E-mail de confirmação com os links das versões (os e-mails ao hóspede estão desligados; M9).
- Botão de arrependimento em Minha reserva: feito no M8.2c como pedido ("Pedir o cancelamento").
- Rotina de prazo de guarda dos dados do hóspede.
- Guarda de 6 meses dos registros de acesso (Marco Civil).
- Registro do consentimento nos formulários dos proprietários. **Feito em 15/10/2026 no M7.14** (data, hora, versão e
  texto exato da caixa, nos dois formulários; ver "Formulários de proprietários", em "Pontos a conferir"). O IP e o
  navegador continuam fora, à espera do advogado.
- O cartão (feito no M8.2b, 9/10/2026, com a mesma caixa e a mesma conferência).
- Lista das versões aceitas em Minha reserva (a página `/reservar/<código>` já mostra).
- Mapa do site e robots. As páginas pessoais e internas (cotação, Minha reserva, convite, entrada, painel, portal, equipe e as etapas do cadastro do proprietário, inclusive a do código, que mostra o e-mail da pessoa) já saem dos buscadores desde o M7.10 (14/10/2026), pelo cabeçalho do `next.config.ts`; falta a decisão de Diego sobre as páginas públicas.
- Rascunho guardado e "despublicar" (D6 e D12).
