# ROADMAP — SCL 2.0

Fonte única de planejamento. Cada item abaixo vira **um PR** com título `[ID] descrição`
(ex.: `[M1.2] Convite de proprietário`). As rotinas automáticas escolhem o próximo item
por esta lista; Diego revisa e faz o merge.

**Meta:** sistema completo, testado em homologação, antes de uso real. Nada é usado
"para valer" antes do marco M11.

## Legenda de estado

| Estado | Significado |
|---|---|
| `a fazer` | Pode ser pego se as dependências estiverem `feito` |
| `em PR` | Existe PR aberto com o ID no título (a rotina confere na lista de PRs) |
| `feito` | Mergeado na `main` |
| `bloqueado` | Depende de algo humano — o motivo está na coluna **Depende de** |

O estado `em PR` não é gravado aqui (evita PR só para mudar status). Quem implementa um
item muda a linha para `feito` **no próprio PR do item**.

## Stack decidido (23/09/2026)

- **Next.js** (App Router, TypeScript) em `app/` — um só aplicativo para painel interno,
  portais e site público.
- **Neon** (Postgres) como banco. **Drizzle ORM** + migrações versionadas.
- Testes: **Vitest**; banco de teste com **PGlite** (Postgres em memória), sem rede e
  sem credenciais.
- **Vercel** para homologação e produção.
- Dinheiro sempre em centavos inteiros. Fuso padrão `America/Sao_Paulo`.

## Marcos

### M0 — Fundação

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M0.1 | Limpeza do repositório, ROADMAP e CLAUDE.md (este PR) | feito | — |
| M0.2 | Esqueleto Next.js + TypeScript + lint + Vitest em `app/`; CI rodando lint, typecheck e testes | feito | M0.1 |
| M0.3 | Drizzle + Neon: conexão por `DATABASE_URL`, pasta de migrações, helper de teste com PGlite | feito | M0.2 |
| M0.4 | Layout base do painel (menu lateral, cabeçalho, filtro global de imóveis/período reutilizável) com identidade SCL | feito | M0.2 |
| M0.5 | Deploy de homologação na Vercel conectado ao Neon; migrações aplicadas no build (`vercel-build`). Na prática, a produção usa a branch `main` do Neon e as previews dos PRs usam a branch `preview` (bancos separados, conferido em 3/10); dado por fechado por Diego em 4/10 | feito | M0.3 |
| M0.6 | Referência do sistema antigo: levantar as telas e capacidades do sistema antigo (arquivo que o Diego vai mandar) e cruzar com este ROADMAP, sem copiar dados reais. Entregue em 4/10: Diego mandou o "acervo isolado" (museu do sistema de julho, dados fictícios, integrações desligadas); 37 telas percorridas e cruzadas com o plano em `arquivo/sistema-antigo/README.md` (inventário, tabela de cruzamento e lista de ideias para Diego decidir: reconciliação com o CSV do Airbnb, "recusado pelo dono" no marketplace, formulário público de cadastro no condomínio, exportação para o contador, recomendador de preço com dados de mercado, cupons, importação de extrato, papel convidado; prospecção e marketing anotados em growth). Nada do sistema antigo foi copiado; fotos reais e o repositório de julho ficaram de fora | feito | Diego mandou o acervo em 4/10 |
| M0.7 | Backup automático do repositório: robô de espelho em conta separada do GitHub (puxa a origem com token só de leitura, nunca apaga nem reescreve, tag datada a cada 3 dias, todas as versões guardadas); documentação de recuperação e passo a passo para o Diego ativar; situação do backup do Neon levantada | feito | M0.1 |
| M0.8 | CI mais rápido: banco de teste pré-migrado reaproveitado pelos arquivos de teste (mesmos testes, sem migrar 100 vezes) e PR só de documentação não roda a suíte do app | feito | M0.3 |

### M1 — Acesso e permissões

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M1.1 | Modelo: organização, usuário, papel (admin, operação, proprietário, hóspede), vínculo usuário↔proprietário↔imóvel; autorização deny-by-default no servidor (portar ideias de `prototipos/scl-gestao-demo/access-policy.mjs`) | feito | M0.3 |
| M1.2 | Login com Google (Auth.js) para equipe interna; lista de e-mails autorizados | feito | M1.1 |
| M1.3 | Login por código enviado por e-mail (uso único, validade, limite de tentativas) — provedor de e-mail com adaptador trocável; em teste, e-mails ficam em memória | feito | M1.2 |
| M1.4 | Convite de proprietário: token único, validade, uso único, revogação, aceite registrado | feito | M1.3 |
| M1.5 | Log de auditoria (quem alterou o quê, quando) usado por todos os módulos | feito | M1.1 |
| M1.6 | Área "Sistema" no painel: serviços ligados (banco, Beds24, e-mail, WhatsApp, Mercado Pago) com situação, automações/rotinas com última execução, e as regras em vigor (comissões, recebimento, contratos) com atalho para editar | feito | M1.2 |
| M1.7 | Configurações com sub-abas: empresa, usuários e permissões, integrações (Beds24, e-mail, WhatsApp, pagamento), regras financeiras, categorias, modelos de mensagem e textos do site — tudo editável | feito | M1.6 |

### M2 — Cadastros

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M2.1 | Imóveis: ID interno SCL, nome público (Studio…), código (102, 103, 303, 399, 403, Búzios), flag `publico` (Búzios = false), fuso, capacidade, endereço | feito | M1.1, M0.4 |
| M2.2 | Proprietários e representantes (dados sensíveis só no banco, nunca no Git); vínculo com imóveis | feito | M2.1 |
| M2.3 | Contratos de gestão com vigência: gestão completa 15%/85%, online 10%, regra 102/303/399 → 15/85 a partir de 01/01/2027; marketplace como tipo separado (fórmula decidida por Diego em 4/10 — modelo B em partes iguais —, implementada no M12.1) | feito | M2.2 |
| M2.4 | IDs externos: mapeamento imóvel ↔ Beds24 / Airbnb / Booking | feito | M2.1 |
| M2.5 | Script de carga inicial (seed) com dados fictícios para homologação | feito | M2.3 |
| M2.6 | Cadastro completo do imóvel: endereço completo, camas/comodidades, regras da casa, horários de entrada/saída, taxas (limpeza, hóspede extra), regras de venda (estadia mínima/máxima com exceções por período, antecedência, dias de chegada/saída), preço base e preço dinâmico (liga/desliga); tudo editável no painel (Diego 24/09) | feito | M2.1 |
| M2.7 | Quem recebe o pagamento por imóvel e por canal (Airbnb, Booking, site, direta/WhatsApp); um proprietário por imóvel; confirmação ao excluir; recálculo automático quando a regra muda | feito | M4.2 |
| M2.9 | Aba Anúncios: por imóvel, referências manuais de Airbnb/Booking (situação, link, título, descrição, links de fotos, preço base e conferência), dados atuais do site e alertas de diferenças entre valores conhecidos; edição administrativa com histórico | feito | M2.6, M3.3; não lê anúncios automaticamente nas OTAs, não publica conteúdo, fotos do site continuam no M7.3 |

### M3 — Reservas e calendário

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M3.1 | Modelo de reserva: canal, datas, hóspede (mínimo necessário), valores brutos/taxas/líquido, estados, ID interno + ID externo | feito | M2.4 |
| M3.2 | Cliente Beds24 API v2 **somente leitura** (reservas, bloqueios, preços), com renovação por `BEDS24_REFRESH_TOKEN`, teste manual de conexão no painel e adaptador falso para testes | feito | M3.1 |
| M3.3 | Sincronização Beds24 → banco: importação manual e cron diário opt-in, idempotência, calendário observado e divergências; reaproveita reserva de planilha por origem + código do canal | feito | M3.2; leitura de quartos confirmada por Diego em 28/09. Seis vínculos e primeira importação realizados por Diego em 1/10; conferência parcial das reservas, não auditoria integral; atualização diária não é disponibilidade para venda em tempo real |
| M3.4 | Calendário central: todas as unidades, por imóvel, reservas/bloqueios/limpezas/manutenção, filtros global e local | feito | M3.1, M0.4 |
| M3.5 | Lista de reservas com filtros e detalhe da reserva | feito | M3.1 |
| M3.6 | Importação manual (CSV) de reservas como alternativa enquanto Beds24 não estiver ligado | feito | M3.1 |
| M3.7a | Prévia de conferência por noite: cadastro SCL × última observação do Beds24, preço/mínimo, cobertura, horário, reservas e bloqueios; preservar preço explícito de período fora dos limites gerais | feito | M3.3, M2.6; etapa de preparação somente leitura, não é envio nem cotação final dos canais |
| M3.7 | **SCL como fonte oficial de calendário e preços** (Diego, 24/09; desde 4/10 a fonte de **preços** é escolhida por imóvel no M3.9 — a direção abaixo vale sempre para o calendário e, para os preços, só nos imóveis com preços automáticos da SCL ou digitados no portal; em imóvel com preços definidos no Beds24 pelo proprietário ou pela ferramenta dele, o SCL só lê e não sobrescreve; até o M3.9 existir, esse imóvel simplesmente não é marcado para envio): bloqueios, preços, estadia mínima e regras editados no SCL são enviados ao Beds24 e dele às OTAs; mudanças que chegarem do Beds24 são conferidas contra o SCL. Escrita autorizada por Diego, mas só é ligada (variável `BEDS24_ESCRITA=ligada`) depois de testada em um imóvel escolhido por ele | feito | M3.7a, M3.3, M2.6. Entregue em 2/10: regras operacionais editáveis (Configurações → Calendário e preços), motor de preço/mínimo (maior multiplicador, feriadões, última hora com piso por imóvel, sobras entre reservas), bloqueio manual no calendário, envio por imóvel com simulação, releitura do destino e histórico antes/depois, rotina diária opt-in. Nada sai sem `BEDS24_ESCRITA=ligada` (refresh token com escopo de inventário) e sem o imóvel marcado. **Teste no 103 ainda pendente de Diego** (403 como alternativa). Pendências do requisito que o motor não decide sozinho: tarifas próprias de Búzios, última hora em grandes eventos, reprecificação de sobras de Réveillon/Carnaval, cotação final nas OTAs (a releitura confirma só o que o Beds24 gravou) |
| M3.8 | Conferência das reservas importadas: consultas separadas de pedidos e fora da ocupação, data original, busca, situação, histórico completo, paginação e registros alterados por execução (pedido de Diego em 1/10) | feito | M3.3, M3.5; após publicar, reimportar para recuperar status/data dos registros existentes |
| M3.9 | Fonte de preços por imóvel, com explicação simples no painel e no portal do proprietário: (a) preços automáticos da SCL (regras do M3.7, enviados ao Beds24 e às OTAs); (b) preços definidos no Beds24 pelo proprietário ou por uma ferramenta de precificação dele (PriceLabs, Beyond Pricing etc.), que a SCL só lê; (c) preços digitados pelo proprietário no portal (enviados ao Beds24). A escolha define a direção do fluxo (SCL envia × SCL lê), passa a mandar sobre a direção global do M3.7 no que toca a preços (o envio do M3.7 não escreve preços em imóvel na opção (b); até este item existir, esse imóvel não é marcado para envio) e vale para o site, a cotação e o marketplace; o calendário é sempre sincronizado nos dois sentidos pelo Beds24 (inclusive por iCal para quem não liga as OTAs ao Beds24), porque a SCL não oferece API própria. Data sem preço na fonte escolhida vira aviso e fica indisponível para venda (nunca palpite). Preço "do Airbnb" só existe se estiver no Beds24: o preço inteligente do Airbnb não é legível de fora. Pedido de Diego em 4/10. Entregue em 4/10: campo **Fonte de preços** na ficha de cada imóvel (Preço e taxas), com explicação simples das três opções: *automáticos do SCL* (como antes), *definidos no Beds24* (o SCL só lê: o motor não calcula preço, o envio manda só mínimos, máximos e bloqueios, o site e a cotação usam o preço da leitura atual do Beds24 e noite sem preço lido fica "a confirmar", sem valor e sem poder segurar datas) e *digitados no cadastro* (preço base e períodos como estão, sem eventos, feriadões e última hora, enviados ao Beds24; a edição pelo proprietário no portal fica para o M12.4). O desconto do site (M12.1) vale por cima de qualquer fonte. A prévia de calendário mostra a fonte do imóvel e uma coluna "Site (≈)" para conferir a promessa de preço abaixo das plataformas; Configurações → Calendário marca na lista de envio os imóveis com preços do Beds24; o portal do proprietário mostra "De onde vêm os preços" | feito | M3.7, M7.2; o portal do marketplace (M12.4) usa esta escolha |

### M4 — Financeiro (ledger)

Requisitos: `requisitos/operations/FINANCEIRO-PORTAIS.md`, `requisitos/product/FINANCE-COSTS-SETTLEMENT.md`.
**Não copiar cálculo do sistema antigo.**

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M4.1 | Ledger: lançamentos imutáveis (bruto, taxa do canal, líquido, comissão SCL, direito do proprietário, recebimento, adiantamento, liquidação, estorno); estados previsto/realizado/conciliado/pendente | feito | M3.1, M2.3 |
| M4.2 | Motor de cálculo de comissão por contrato e vigência, com testes de arredondamento, estadia entre meses, cancelamento parcial | feito | M4.1 |
| M4.2c | Mudança de regra vale daquela data para frente: recálculo só alcança reservas com entrada a partir da data da mudança (nunca antes de hoje) e nunca mexe em lançamento que já movimentou dinheiro | feito | M4.2 |
| M4.3 | Despesas: da empresa × do proprietário, categorias editáveis (arquivar em vez de apagar), comprovante opcional | feito | M4.1 |
| M4.4 | Adiantamentos e compensações (ex.: reparo de R$ 4.000 adiantado) sem dupla cobrança | feito | M4.3 |
| M4.5 | Ajustes/divergências com motivo "não identificado" e evidência | feito | M4.1 |
| M4.6 | Dashboard inicial do painel (primeira tela): ocupação, receitas, comissões, despesas, próximas entradas/saídas, pendências e alertas, com gráficos e o filtro global | feito | M4.2, M4.3 |
| M4.7 | Aba Apartamentos: tabela de todos os imóveis com resultado da empresa, comissões, despesas e acertos, com filtros para escolher como ver (mês, intervalo, ano, imóveis, colunas) | feito | M4.2, M4.4 |
| M4.8 | Teste de consistência: mesma reserva = mesmos totais em dashboard, aba Apartamentos, portal e PDF | feito | M5.3 |
| M4.9 | Repasse mensal ao proprietário (Booking, site, direta): fechamento no fim do mês, valor a repassar já descontado de despesas/adiantamentos, Pix para copiar, marcar pago; feito no **dia 1º do mês seguinte** (Diego, 24/09: no último dia ainda pode entrar reserva) | feito | M4.4 |
| M4.10 | Extrato do proprietário e repasses por periodicidade: no portal, saldo **a liberar** (reserva confirmada, antes do check-in ou de o dinheiro estar com a empresa) e **disponível** — a condição de disponível depende de **quem recebe, conforme registrado na reserva** (M2.7: `empresa` ou `split`, com padrão por canal e por imóvel, nunca pelo nome do canal): reserva em que o canal paga o proprietário direto (`split`, padrão do Airbnb) não entra no repasse e aparece no extrato só como informação; reserva em que a empresa recebe (`empresa`, padrão de Booking, site e direta — inclusive um Airbnb configurado assim) entra e fica disponível depois do check-in **e** de o dinheiro estar com a empresa: para pagamento pelo provedor do site, a liberação registrada pelo M8.2; para os demais recebimentos, o lançamento de recebimento daquela reserva realizado e conciliado no ledger (M4.1); sem recebimento registrado fica a liberar, com aviso (nunca se repassa o que a empresa ainda não recebeu); reserva com quem recebe `a_confirmar` fica a liberar, com aviso, fora de qualquer repasse até alguém definir quem recebeu —, entradas por reserva e saídas por repasse, com histórico; o proprietário escolhe no portal como quer receber — **mensal no dia 1º (padrão e intervalo máximo)**, **quinzenal (dias 1 e 16)**, **semanal (às segundas-feiras)** ou **assim que disponível** (dia seguinte ao check-in com o dinheiro já liberado) — e pode pedir um repasse avulso; cada repasse programado reúne tudo o que ficou disponível até o dia anterior; **no dia 1º, fechamento mensal (M4.9) e repasse programado saem num único repasse, numa única transação por proprietário:** o fechamento paga a competência do mês fechado descontando os adiantamentos já feitos e, no mesmo repasse, entram como adiantamentos vinculados os valores já disponíveis com noites fora do mês fechado (ex.: reserva com check-in no último dia do mês para quem recebe assim que disponível), para que a reserva seja paga inteira como prometido; **a condição de disponível vale também para a parte do fechamento:** valores da competência cujo dinheiro ainda não está com a empresa (recebimento de Booking/direta não conciliado, liberação do provedor não ocorrida) ficam fora do repasse do dia 1º, passam para o repasse seguinte e aparecem no extrato como a liberar, com aviso — o fechamento de hoje (M4.9) soma toda a competência e só avisa sobre lançamentos previstos, então tanto o acréscimo das noites futuras quanto essa trava são trabalho deste item; todo repasse (programado, avulso ou fechamento) é gerado numa única transação por proprietário, com a mesma trava do fechamento, e cada valor disponível só pode compor um repasse (vínculo único e idempotente) — nada é pago duas vezes mesmo que duas rotinas rodem no mesmo dia; o dia da semana do semanal, os dois dias do quinzenal e o padrão por tipo de contrato são definidos no painel (uma regra, um lugar), e a data prevista aparece no extrato; o sistema gera o repasse a pagar na data e o pagamento sai pela equipe (manual) ou pelo lote diário (automático). Cada repasse fora do fechamento é um **adiantamento vinculado às reservas** que o compõem: o fechamento mensal (M4.9) continua por competência (noites do mês) e desconta esses adiantamentos, então nada é pago duas vezes; uma reserva que atravessa o mês é paga inteira no check-in, aparece como saldo negativo no fechamento do primeiro mês e se completa no seguinte, tudo visível no extrato. Cada repasse gera **e-mail ao proprietário** com o comprovante do Pix e a lista das reservas e valores (integral ou parcial). Pix manual pelo Diego no início: ao marcar pago, ele **anexa o comprovante** (arquivo do banco ou identificador da transação Pix), guardado em armazenamento privado e ligado ao repasse — o e-mail só sai com o comprovante registrado; sem ele, o repasse fica "pago sem comprovante", com aviso, e o e-mail espera (o marcar pago de hoje, M4.9, só guarda situação e data, então esse campo é trabalho deste item). Automático por API do banco ou do Mercado Pago depois, em lote diário, com o comprovante vindo do próprio provedor. Pedido de Diego em 4/10 **Entregue em 4/10/2026:** extrato no portal (parte de cada reserva por mês: paga pelo canal, a liberar com motivo, disponível, repassada), escolha da periodicidade no portal e no cadastro, padrão por tipo de contrato e dias em Configurações → Repasses; recebimento do canal registrado na página da reserva (condição única de disponível; o M4.4 e o M8.2 alimentam a mesma condição); repasse antecipado programado (rotina das 8h) e avulso (portal ou painel), um por proprietário por dia, cada parte num repasse só; fechamento do dia 1º só com o que está disponível (o resto fica para o seguinte, com aviso) e com as noites de meses seguintes já disponíveis como adiantamento lançado na competência delas; comprovante do Pix (identificador e/ou arquivo guardado no banco) ao marcar pago; e-mail do repasse com reservas e anexo, uma vez por repasse. O fechamento do dia 1º continua disparado por Diego no painel; o Pix em lote automático fica para quando houver API do banco ou do Mercado Pago | feito | M4.9, M5.2; o e-mail depende do Resend (ação 9); a elegibilidade vem de quem recebe (M2.7); a data de disponibilidade vem da liberação do provedor (M8.2) ou do lançamento de recebimento conciliado (M4.1) |

### M5 — Portal do proprietário

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M5.1 | Portal: filtros ano/mês/imóvel, mês atual marcado como parcial, navegação ±9 meses | feito | M1.4, M4.2 |
| M5.2 | Tabela de reservas + calendário clicável + rodapé com saldo, credor/devedor e Pix (copiar) | feito | M5.1 |
| M5.3 | PDF do relatório no modelo aprovado (duas páginas, cores SCL; ver `requisitos/operations/RELATORIOS-PROPRIETARIOS.md`) | feito | M5.2 |
| M5.4 | Envio mensal por e-mail do fechamento no dia 1º do mês seguinte (depois de conciliado) | feito | M5.3, M1.3 |
| M5.5 | Proprietário edita o calendário do próprio imóvel no portal (bloqueio de uso próprio, liberar datas, conforme permissão do contrato); a mudança entra no SCL e segue para o Beds24/OTAs pelo M3.7 | feito | M5.1, M3.7 |
| M5.6 | "Como funciona" para o proprietário: documento de consulta no portal (gestão total e marketplace: o que a SCL faz, comissão e taxas, quando e como ele recebe — a periodicidade que ele escolheu (mensal no dia 1º por padrão, quinzenal, semanal ou assim que disponível) e a regra de que uma reserva do site só fica disponível depois do check-in e da liberação do dinheiro pelo provedor (M4.10) —, relatórios, cancelamentos e, quando decididas, contestações), com texto editável no painel, versão datada e **aceite registrado** no convite/cadastro (quem, quando, qual versão); mudança de texto gera nova versão e pede novo aceite. Pedido de Diego em 4/10 | a fazer | M5.1, M12.3, M8.0, M4.10 (o documento descreve a periodicidade que o proprietário escolheu, que só existe com o M4.10) |

### M6 — Operação

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M6.1 | Limpezas: gerar no dia do checkout; estados pedida/confirmada/realizada; profissional; custo | feito | M3.4 |
| M6.2 | Manutenção: pedido, orçamento, aprovação de Diego, execução, custo e responsável (empresa/proprietário) | feito | M4.3 |
| M6.3 | Agenda diária (20h, próximos 5 dias, Rio e Búzios separados) enviada para a equipe | feito | M6.1 |
| M6.4 | Documentos de portaria (só 403): checklist de pedidos, sem armazenar documentos no Git | feito | M3.5 |
| M6.5 | Rotinas recorrentes (manutenção quinzenal, faxinas semanal, lembrete mensal) | feito | M6.2 |
| M6.6 | Equipe de limpeza: acesso próprio pelo celular (agenda, marcar faxina feita) e aviso por WhatsApp quando o M10 estiver ligado (e-mail enquanto isso) | feito | M6.1, M1.3 |
| M6.7 | Agenda por cidade e horários combinados (pedido de Diego em 2/10): Búzios lista todas as reservas dos próximos 30 dias; Rio mantém 5 dias com as limpezas por dia (limpeza já realizada sem uso posterior não volta) e as entradas/saídas/chaves em bloco separado; primeiro nome, nº de hóspedes, horários e telefone operacional em ambos. Ficha da reserva → "Horários combinados com o hóspede": pedido pendente e acordo confirmado (canal, referência, aceite explícito), com prioridade acordo → cadastro do imóvel → padrão da agenda; mudança de datas/imóvel exige novo acordo. Entregue em 3/10 (PR do Codex #81, levado à main pelo processo) | feito | M6.3 |

### M7 — Site público no novo app

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M7.1 | Migrar `prototipos/scl-publico` para o app (home, catálogo 5 imóveis, página, galeria, consulta) lendo imóveis do banco; textos do site editáveis no painel | feito | M2.1 |
| M7.2 | Disponibilidade e cotação reais a partir das reservas/preços sincronizados | feito | M7.1, M3.3 (e M3.7, de onde vêm os preços por noite). Entregue em 2/10: o site responde disponível / indisponível / a confirmar por noite (reservas e bloqueios do SCL + última leitura do Beds24 dentro da validade configurável; sem leitura nunca é "disponível") e mostra o valor (diárias do motor de calendário, limpeza, hóspede extra) na consulta e na página do imóvel; a mensagem do WhatsApp leva o valor como referência. Nada é gravado nem reservado: cotação persistida e hold são o M8.1; a validade da leitura depende da frequência da importação do Beds24 |
| M7.3 | Fotos reais (upload privado → Vercel Blob) quando Diego liberar os direitos de uso | bloqueado | Diego: autorizar fotos |
| M7.4 | Páginas legais do site: termos de uso, política de privacidade (LGPD) e política de cancelamento (quando Diego decidir), com texto editável no painel, versão datada e aceite registrado no checkout (obrigatório antes de vender pelo site); texto-base para Diego revisar com quem cuida do jurídico. Pedido de Diego em 4/10 | a fazer | M7.1, M8.1, M8.2 (o aceite é registrado no checkout do M8.2, então as páginas e o aceite entram depois de o checkout existir; o M8.2 só liga o pagamento de verdade com este item feito) |
| M7.5 | Identidade visual do site, dos portais e do painel conforme o estudo de 4/10 (capturas do agente "Sage" e do site de julho, guardadas em `prototipos/` quando Diego mandar): verdes mantidos; bege trocado por um off-white de papel; grão de papel só como textura sutil em fundos de seção e capa, nunca atrás de texto; busca translúcida com desfoque sobre a foto da capa; serifa nos títulos. Tokens de design (cores, fontes, espaçamentos) num lugar só, usados por site, portal do hóspede, portal do proprietário e painel — o painel com a mesma paleta e os mesmos padrões, apenas mais denso (tabelas e formulários compactos). Antes de mexer em tela: especificação curta em `requisitos/product/DESIGN.md` com os tokens e as capturas de referência | a fazer | M7.1, M5.1, M9.1; Diego: mandar as capturas e os arquivos do Sage (aprovado por Diego em 4/10) |

### M8 — Reserva direta e pagamento

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M8.0 | Rever a decisão de 24/09 sobre o recebimento do site (hoje: **empresa recebe e repassa**, que continua valendo até Diego decidir outra coisa), a pedido de Diego: split automático (Mercado Pago marketplace ou Stripe Connect, como no Airbnb) × empresa recebe e repassa; comparar taxas, estorno, chargeback e impostos — comparação e recomendação (manter) em `requisitos/product/RECEBIMENTO-SITE.md` | feito | Decidido por Diego em 4/10: mantém "empresa recebe e repassa" pelo Mercado Pago; o contador já confirmou que só a comissão é receita da SCL; repasse ao proprietário na periodicidade que ele escolher (M4.10), com a reserva do site disponível só depois do check-in e da liberação pelo provedor (ver "Decisões registradas") |
| M8.1 | Cotação persistida, revalidação e hold com controle de concorrência. Entregue em 3/10: a consulta do site grava a cotação (código público, valor por partes, situação) e abre a página dela; o visitante deixa o contato e "segura as datas" por N minutos (configurável, padrão 30) — vira um pedido de reserva (`pedido`, origem site) que ocupa o calendário, criado numa só transação com a trava do imóvel e reconferência de disponibilidade e valor (mudou → cotação desatualizada, nada gravado); a página revalida a cada abertura; pedido vence sozinho (rotina a cada 10 min) e a equipe confirma ou cancela no painel; freios: um pedido por e-mail e cinco por imóvel. Nada é pago nem escrito no Beds24 (M8.2/M8.3) | feito | M7.2 |
| M8.2 | Pagamento no provedor escolhido no M8.0 (Mercado Pago, decidido em 4/10) em **sandbox**: checkout no site com escolha entre **Pix** (QR code e código copia e cola com botão de copiar, na própria página; confirmação automática quando o aviso do provedor chega) e **cartão de crédito** (formulário no próprio checkout, dados do cartão tokenizados pelo componente do Mercado Pago — Checkout Bricks/Transparente, marca do Mercado Pago visível —, parcelamento **com os juros pagos pelo hóspede** — decisão de Diego em 4/10; a SCL não assume o "sem juros" —, com o número máximo de parcelas configurável no painel, padrão o máximo que o Mercado Pago permitir), pedido de Diego em 4/10, webhook assinado, idempotência, reconciliação, **confirmação só com hold valendo** (a aprovação do pagamento vira reserva apenas se o hold do M8.1 ainda estiver ativo, conferido na mesma transação; aprovação que chega depois de o hold vencer: se as datas ainda estiverem livres, o sistema tenta segurá-las de novo na mesma transação e, conseguindo, confirma; senão — ou em qualquer outro caso — não cria reserva: o pagamento fica registrado, gera aviso e segue para devolução ao hóspede ou resolução manual registrada; nenhuma aprovação fica sem desfecho), registro de quando o provedor **libera o dinheiro** de cada pagamento, com o repasse ao proprietário daquela reserva **segurado até a liberação** (decisão de Diego em 4/10: o repasse segue a periodicidade que o proprietário escolher no M4.10 — mensal no dia 1º por padrão e intervalo máximo, quinzenal, semanal ou assim que disponível — e uma reserva do site só fica **disponível** depois do check-in **e** da liberação do dinheiro pelo provedor, sem adiantamento pela SCL; o prazo de liberação depende da forma de pagamento e do plano do Mercado Pago, a confirmar nos termos vigentes antes do M8.2; o fluxo de hoje é só o fechamento mensal, por isso qualquer periodicidade menor depende do M4.10), **toda devolução** (cancelamento, alteração ou aprovação tardia) fica **pendente** até o provedor confirmar — recusa ou falta de resposta gera nova tentativa idempotente e, se persistir, aviso e resolução manual registrada; os lançamentos que dependem dela só são conciliados depois da confirmação; devolução ao hóspede (pela **política de cancelamento do site** que Diego definir: reembolso total, parcial ou nenhum conforme a antecedência, e quem arca com a taxa do pagamento que não volta; sem política, o sistema não calcula reembolso sozinho — só registra o pedido e avisa; a devolução feita gera no financeiro lançamentos por componente — valor devolvido, taxa do pagamento que não volta, comissão e parte do proprietário —, idempotentes e conciliados, sem mexer nos lançamentos já realizados) **alteração de reserva paga** (datas ou preço): **toda mudança de datas** — mesmo sem diferença de valor — revalida a disponibilidade e segura as novas datas com o hold do M8.1, que expira e libera as datas se a alteração não for concluída; quando a alteração **reduz** o valor, a devolução parcial só é pedida ao provedor **depois** de a alteração estar confirmada e aplicada (novas datas seguradas), então nunca há devolução sem alteração; quando **aumenta**, pagamento da diferença que chega depois de o hold vencer segue a mesma regra da aprovação tardia (tenta um novo hold na mesma transação; sem ele, a alteração não é aplicada e o valor pago volta ao hóspede ou vai para resolução manual registrada); se o valor mudar, cobrança da diferença ao hóspede (novo pagamento) ou devolução parcial pelo provedor, idempotente; a alteração só é confirmada (e só vai ao Beds24 no M8.3) depois que as datas estiverem seguradas e, se o valor aumentar, a diferença estiver paga — até lá a reserva segue como estava e aparece um aviso; se o valor diminuir, a devolução vem logo depois da confirmação e fica **pendente** até o provedor confirmar — recusa ou falta de resposta gera nova tentativa idempotente e, se persistir, aviso e resolução manual registrada; os lançamentos da devolução só são conciliados depois da confirmação do provedor; ao confirmar, o financeiro recebe **lançamentos de diferença por componente** (valor bruto, taxa do pagamento, comissão e parte do proprietário — cada um só com a diferença entre o novo e o anterior, no tipo certo), idempotentes (uma chave por alteração); os que dependem de dinheiro no provedor ficam pendentes e só são conciliados depois que o pagamento ou a devolução da diferença for confirmado, sem mexer nos lançamentos já realizados/conciliados nem somar o total de novo; e **contestação (chargeback)**: eventos de disputa registrados com situação, aviso e reserva em conferência até a decisão da disputa. **Quem arca com a contestação perdida (SCL, proprietário ou na proporção) é decisão de Diego** (pendente): até ela existir, o sistema registra e avisa, sem descontar de ninguém automaticamente; com a regra definida, a contestação gera no financeiro lançamentos idempotentes para quem arca (SCL, proprietário ou cada um na sua proporção): débito pendente durante a disputa, estornado se a SCL ganhar e definitivo se perder — na parte do proprietário, o desconto fica segurado no repasse durante a disputa (no split, onde pode não haver repasse, a parte dele é recuperada por reversão/débito na conta conectada, quando o provedor permitir, ou vira valor a receber do proprietário, com aviso e compensação no próximo pagamento a ele); na parte da SCL, entra como perda da empresa. **Se o M8.0 escolher split**, o M8.2 inclui a integração do split em si (não fica pronto com um checkout comum): ligar a conta de cada proprietário no provedor (autorização e renovação), comissão da SCL e parte do proprietário em cada pagamento, estorno dividido entre as partes e conciliação por conta conectada. Antes de implementar: confirmar com o provedor (documentação/suporte) as regras de taxa, estorno parcial e contestação — em especial no split, quanto sai de cada parte; e, se for split, a **verificação de identidade (KYC) de cada proprietário** no provedor (pessoa física e empresa aceitas, documentos, conta ativa, renovação da autorização) confirmada com pelo menos um proprietário real antes de começar | bloqueado | M8.1 + Diego: credenciais de teste do Mercado Pago (M8.0 decidido em 4/10); M4.10 antes de ligar repasse em periodicidade menor que a mensal; M7.4 (aceite das páginas legais no checkout) e as decisões pendentes (taxa, contestação, cancelamento) antes de ligar o pagamento de verdade, fora do sandbox |
| M8.3 | Reserva do site no Beds24 (escrita, atrás de `BEDS24_ESCRITA=ligada`): criar após pagamento confirmado e **cancelar/atualizar quando a reserva paga for cancelada ou alterada** (idempotente; alteração só depois de confirmada no M8.2 — novas datas seguradas e, se o valor aumentar, diferença paga), com conferência de que o Beds24 ficou igual ao SCL | bloqueado | M8.2 + autorização explícita de escrita |

### M9 — Portal do hóspede e mensagens

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M9.1 | Portal do hóspede: acesso por código/magic link ao e-mail do hóspede (e-mail no cadastro de todos); dados da própria reserva | feito | M1.3, M3.1 |
| M9.2 | Mensagens programadas (confirmação, check-in D-2 10h, checkout D-1 14h, agradecimento D+3 10h), jobs idempotentes; modelos de mensagem editáveis no painel | feito | M9.1 |

**Nota de planejamento solicitada por Diego:** M9.2 cobre mensagens por e-mail, opt-in (origens padrão site/direta), não comprova migração das automáticas Airbnb. Planejar a consolidação dos modelos por imóvel no sistema/site, conferindo textos ativos, campos, horários, canais e prevenção de duplicidade; validar destino e transição antes de substituir/desativar qualquer automação Airbnb. Sem nova fase, data ou ativação definida. Diretriz de chegada 399 e possível aplicação ao 103, com contatos/janelas ainda a conferir: [Guia Lia](requisitos/operations/GUIA-LIA-ATENDIMENTO.md). Prioridade atual: concluir atendimento e listas.

### M10 — WhatsApp (Meta Cloud API)

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M10.1 | Webhook de mensagens WhatsApp → caixa de entrada no painel, ligada a reserva/interessado | bloqueado | Diego: app Meta Business + número verificado |
| M10.2 | Respostas pelo painel, modelos aprovados (templates) para mensagens programadas | bloqueado | M10.1 |
| M10.3 | Assistente de resposta sugerida (Claude) com revisão humana antes do envio | a fazer | M10.1 |

### M12 — Marketplace (expansão: dono faz a operação física, SCL faz o online)

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M12.1 | Fórmula de cobrança do marketplace: hóspede paga menos que na OTA, proprietário ganha mais e a SCL também ganha — proposta em `requisitos/product/MARKETPLACE-PRECIFICACAO.md` (3 modelos); tela de simulação com percentuais editáveis; e a **regra única do desconto do hóspede no site** (o peso do hóspede do modelo B) aplicada à cotação do site (M7.2/M8.1) para qualquer contrato, gestão total inclusive — decisão de 4/10: um modelo por contrato, desconto do site igual para todos —, com valor cheio e desconto visíveis na cotação. Entregue em 4/10: **modelo B em partes iguais** implementado como regra única (margem = valor cheio × (taxa do Airbnb − taxa do pagamento), rateada em centavos pelos pesos hóspede/proprietário/SCL; a parte do hóspede é o desconto do site, a taxa do pagamento incide sobre o que o hóspede paga e a sobra fica com o proprietário); nova aba **Configurações → Marketplace e desconto do site** com taxas de referência (Airbnb 16%, Booking 15% só para comparação, pagamento 4%) e pesos (1/1/1) editáveis, com auditoria, e simulação ao vivo Airbnb × Booking × site a partir de diária, noites e limpeza; a consulta e a cotação do site mostram **valor cheio, desconto do site e total**, a cotação persistida guarda os três (mudar a regra depois não altera o que o visitante viu: a revalidação avisa que o valor mudou), o pedido de "segurar as datas" entra com o total com desconto e as mensagens ao WhatsApp dizem o desconto. O cálculo da divisão no financeiro do contrato marketplace é o M12.2 | feito | M7.2, M8.1. Decidido por Diego em 4/10: **modelo B em partes iguais** (a margem = taxa do Airbnb menos a taxa do pagamento, dividida igualmente entre desconto ao hóspede, ganho do proprietário e SCL), com os três pesos e as taxas de referência editáveis no painel, e a tela de simulação |
| M12.2 | Motor de cálculo e repasse do contrato marketplace (modelo B do M12.1, com os pesos do painel). **Forma de recebimento decidida por Diego em 4/10: empresa recebe e repassa, sem split**, com o extrato e as periodicidades do M4.10 — o split, sugerido em 24/09 em `requisitos/product/RECEBIMENTO-SITE.md`, foi descartado para o site e para o marketplace; as exigências dele (conta de cada proprietário no provedor, verificação de identidade, comissão em cada pagamento, estorno dividido, conciliação por conta conectada) saem deste item e, se um dia a ideia voltar, viram item novo. **Pagamento:** reusa o do M8.2 (checkout com Pix e cartão, avisos assinados do provedor processados de forma idempotente, registro da liberação do dinheiro, devolução e alteração de reserva paga pela política de cancelamento, contestação conforme a decisão de Diego, conciliação), aplicando o cálculo do marketplace em vez da comissão de gestão: desconto do hóspede pela regra única do site, taxa do pagamento, parte do proprietário e parte da SCL como lançamentos por componente no ledger, idempotentes. **Checkout:** usa a cotação persistida, a revalidação de disponibilidade e o hold do M8.1, com a mesma regra do M8.2 na aprovação (só vira reserva com o hold valendo, conferido na mesma transação; aprovação tardia tenta um novo hold e, sem ele, vai para devolução ou resolução manual registrada — nada segue para o Beds24 sem reserva confirmada). **Beds24:** a reserva paga do marketplace vai para o Beds24 com o comportamento do M8.3 (criar, atualizar, cancelar e conferir, idempotente, atrás de `BEDS24_ESCRITA=ligada` e com autorização explícita de escrita), reusando o M8.3, para o calendário das OTAs do proprietário não continuar vendendo as datas. **Escopo do cálculo:** só as reservas vendidas pelo site da SCL; as reservas que o proprietário do marketplace vende nas OTAs dele (importadas pelo Beds24) entram no calendário e no extrato **sem comissão da SCL** (decisão de Diego em 4/10: o modelo B vale só para o que o site vende — `requisitos/product/MARKETPLACE-PRECIFICACAO.md`); o repasse delas segue quem recebe (M2.7): `split`, só informação; `empresa`, valor integral no extrato e no repasse do M4.10, com a mesma condição de disponível; `a_confirmar`, fica a liberar com aviso, fora de qualquer repasse, até alguém definir quem recebeu. Antes de implementar: confirmar com o Mercado Pago as regras de taxa, estorno parcial e contestação (as mesmas do M8.2) e ter as decisões de Diego sobre contestação e política de cancelamento | a fazer | M12.1, M4.2, M4.10, M8.1, M8.2, M8.3 (decidido em 4/10: sem split, reusa o pagamento do site, o extrato com as periodicidades do M4.10 e a escrita no Beds24 do M8.3) |
| M12.3 | Auto-cadastro do proprietário marketplace: cria conta, cadastra o imóvel (M2.6), escolhe "já anuncio"/"anúncio novo", revisão antes de publicar | feito | M1.4, M2.6 |
| M12.4 | Portal do proprietário marketplace: calendário, preços e regras de venda, limpeza/manutenção por conta própria. Bloqueio, preço ou regra editado pelo proprietário só vale se chegar às OTAs (senão o Airbnb/Booking continua vendendo as datas), então depende do M3.7; o preço do proprietário depende do modelo do M12.1 | a fazer | M12.3, M5.1, M3.7, M3.9, M12.1 |

### M11 — Entrada em produção

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M11.1 | Carga de dados reais (imóveis, proprietários, contratos, histórico financeiro conferido) | bloqueado | Tudo acima + Diego |
| M11.2 | Domínio (Cloudflare) e e-mail transacional | bloqueado | Diego |
| M11.3 | Checklist de segurança, backup do Neon, go-live | bloqueado | M11.1 |

## Ações de Diego (o que destrava o quê)

1. **Revisar e mergear PRs** — por enquanto o Claude faz os merges (autorizado em 23/09).
2. **Vercel — feito:** repositório na Vercel (*root directory* `app`) com a integração Neon ligados por Diego (27/09); bancos de produção e de preview conferidos em 3/10; M0.5 fechado por Diego em 4/10.
3. **Beds24:** leitura de quartos confirmada por Diego em 28/09; quarto 403 duplicado removido por ele. Diego cadastrou e vinculou os seis imóveis e fez a primeira importação em 1/10. Diego confirmou o merge do M3.8 e uma nova importação em 2/10. Agosto/setembro podem estar incompletos: uma reserva antiga ausente no SCL também não foi encontrada por ele no Beds24; a causa histórica é hipótese, não auditoria concluída. A conferência de outubro em diante permanece pendente. Conferir reservas, bloqueios e avisos antes de ligar a rotina diária (requer `CRON_SECRET`). O mapeamento Airbnb → Beds24 não cria os vínculos Beds24 → SCL. Nenhuma importação real foi feita durante a implementação. O envio de calendário e preços (M3.7) está implementado e **desligado**: para o teste no 103, cadastrar regras/pisos, simular na prévia, ligar `BEDS24_ESCRITA=ligada` na Vercel com um refresh token que tenha o escopo de inventário, enviar e conferir no Beds24/Airbnb (ver guia, seção 6). Cotação e disponibilidade de venda dependem do M7.2.
4. **Meta / WhatsApp Business:** iniciar a verificação da empresa no Meta Business — leva dias. (destrava M10)
5. **Pagamento do site:** Conta Negócio do Mercado Pago no CNPJ da empresa (as credenciais de produção saem dela; conta pessoal não serve para a contabilidade da SCL) e credenciais de *teste* (provedor decidido em 4/10: Mercado Pago para Pix e cartão). (destrava M8.2)
6. **Modelo do marketplace — feito em 4/10:** modelo B em partes iguais, pesos editáveis no painel (M12.1 entregue em 4/10; o cálculo no financeiro é o M12.2).
7. **Preço no site abaixo das plataformas — decidido em 4/10:** última hora e desconto do site **acumulam** de propósito (exceção à regra "multiplicadores não acumulam", que continua valendo entre eventos e feriadões); a comunicação é genérica ("pague menos que no Airbnb"), sem garantia absoluta — exceção rara é aceitável, só se virar consistente a regra é repensada. Para o marketplace que define preço no Beds24, a promessa é garantida em três camadas: o desconto do site é aplicado sobre o preço lido do Beds24 (automático, M3.9), a cláusula do contrato marketplace (preços das OTAs vindos do Beds24 ou do SCL, preço inteligente do Airbnb desligado, sem promoção dentro das OTAs abaixo do preço do Beds24 — entra no M12.3/M12.4) e a conferência periódica com a coluna "Site (≈)" da prévia de calendário. Pesos do modelo B: Diego está avaliando 6/3/3 (SCL / hóspede / proprietário, ou 2/1/1 nos pesos); o padrão do sistema continua 1/1/1 até ele confirmar.
7. **Booking:** criar os anúncios (o Beds24 pode criar a partir dos dados já importados do Airbnb — ver guia). 
9. **E-mail do sistema (Resend):** conta e domínio. (liga o login por código e os convites por e-mail)
10. **Recebimento do site — feito em 4/10:** Diego manteve "empresa recebe e repassa" e o contador já confirmou a tributação só sobre a comissão — ver `requisitos/product/RECEBIMENTO-SITE.md`. Ficam para antes do pagamento de verdade: taxa do pagamento, contestação perdida e política de cancelamento ("Pendências de decisão").
11. **Backup do repositório (M0.7) — feito por Diego em 4/10:** conta separada, repositório privado, chave só de leitura na conta principal, chave de escrita na conta de backup, três segredos, primeira rodada verde e variável `BACKUP_INICIADO` (guia, seção 6, item 23). O backup do banco no Neon já foi ampliado em 3/10 com o "pode fazer" de Diego (7 dias de histórico, snapshots diário e semanal; guia, seção 6, item 23b).
12. **Forma de recebimento do marketplace — feito em 4/10:** empresa recebe e repassa, sem split, como o site, com o extrato e as periodicidades do M4.10. O M12.2 passa a depender do M8.2.

## Pendências de decisão (não bloqueiam o início)

- Competência × caixa no financeiro.
- Búzios: fica no sistema interno para controle (decidido 24/09); se entra no site público, a decidir.
- Avaliações próprias × só Airbnb.
- Contestação de cartão (chargeback) perdida numa reserva do site: quem arca — SCL, proprietário ou os dois na proporção (vai no contrato). Não impede fazer o M8.2 em sandbox (sem a regra, só registra e avisa); precisa estar decidido antes de ligar o pagamento de verdade.
- Política de cancelamento das reservas do site: reembolso total, parcial ou nenhum conforme a antecedência, e quem arca com a taxa do pagamento que não volta. Mesma regra: não impede o M8.2 em sandbox; precisa estar decidida antes de ligar o pagamento de verdade.

## Decisões registradas

- 24/09 (Diego): comissão sobre o valor que o canal repassa (depois da taxa do canal);
  estadia entre meses rateada igualmente por noite (valor total, com limpeza); Airbnb faz
  split automático (proprietário recebe direto); Booking/site/direta: empresa recebe tudo e
  repassa uma vez por mês. **Superada em 4/10 para o site e o marketplace:** a empresa continua
  recebendo e repassando, mas na periodicidade que o proprietário escolher (mensal no dia 1º por
  padrão e intervalo máximo; quinzenal; semanal; assim que disponível — M4.10); o split foi
  descartado (ver decisões de 4/10). Booking e diretas seguem a mesma régua do M4.10.
- 24/09 (Diego): quem recebe é configurável por imóvel e por canal (padrão: Airbnb split);
  um proprietário por imóvel (pessoa ou empresa); imóveis do Diego são clientes normais;
  tudo editável pelo painel, uma regra num lugar só, exclusão com confirmação.
- 24/09 (Diego): o SCL é a fonte oficial de calendário e preços e escreve no Beds24 (M3.7; desde
  4/10 a fonte de **preços** é escolhida por imóvel — M3.9 —, o calendário continua sempre pelo
  SCL/Beds24);
  proprietário edita o calendário no portal e a mudança segue pelo SCL (M5.5); repasse e
  relatório mensal no dia 1º do mês seguinte (desde 4/10, o dia 1º é o padrão e o intervalo
  máximo do repasse; o proprietário pode escolher periodicidade menor — M4.10); e-mail obrigatório no cadastro de proprietários
  (e usado no de hóspedes).
- 24/09 (Diego): mudança de regra vale daquela data para frente — o passado (e o dinheiro
  que já movimentou) nunca é recalculado.
- 2/10 (Diego): os seis imóveis nunca mudaram de proprietário, então a **data de início do
  contrato** de cada um é a data da **primeira reserva** daquele imóvel — a registrar na carga
  de dados reais (M11.1), não antes. **1/10/2026 é o marco oficial**: preços e reservas passam
  a valer pelo Beds24 e pelo sistema a partir dessa data; o histórico anterior à conexão do
  Airbnb ao Beds24 não vem pela API (limitação do canal) e fica fora da conferência.
- 3/10 (M5.5, pela decisão de 24/09): o bloqueio pelo portal é uma **permissão do contrato**
  (ligada por padrão; a empresa desliga contrato a contrato no painel); o proprietário só
  bloqueia de hoje em diante, nunca por cima de reserva, e só libera o que ele mesmo bloqueou
  — bloqueio da empresa ou do Beds24 é pedido à empresa.
- 3/10 (Diego): **backup automático do repositório** a cada 3 dias, em conta separada do
  GitHub, guardando todas as versões (nunca apaga). O repositório principal registra só que o
  backup existe, como funciona e por quê — nenhum dado da conta de backup, nem nome de usuário
  (`requisitos/operations/BACKUP-E-RECUPERACAO.md`). Banco (Neon): avaliar retenção e
  snapshots; cópia fora do Neon fica para o M11.3. **CI:** acelerar a suíte com banco de teste
  pré-migrado e não rodar a suíte do app em PR só de documentação (M0.8); não pular testes nem
  rodar só os "afetados".
- 4/10 (Diego): **recebimento do site** mantém "empresa recebe e repassa", pelo Mercado Pago
  (componentes de checkout no próprio site — Checkout Bricks/Transparente, com Pix e cartão, pedido de
  4/10; não a página externa do Checkout Pro); o contador já confirmou que só a comissão é receita da SCL (o restante é
  valor de terceiros que passa pela empresa). **Repasse ao proprietário:** na periodicidade que ele
  escolher no portal (mensal no dia 1º, padrão e intervalo máximo; quinzenal; semanal; ou
  assim que disponível), e uma reserva do site só fica disponível depois do check-in **e** da
  liberação do dinheiro pelo provedor, sem adiantamento pela SCL e sem trocar de plano só por
  isso (Pix é liberado na hora; cartão depende do plano do Mercado Pago, a confirmar antes do
  M8.2). Repasse fora do fechamento é adiantamento vinculado às reservas e o fechamento mensal
  o desconta; reserva que atravessa o mês é paga no check-in e se acerta no fechamento
  seguinte; cada repasse gera e-mail com comprovante e reservas; o portal mostra a data
  prevista (item M4.10). Diego pediu um documento "como funciona" para o proprietário (gestão total e
  marketplace, inclusive quando e como recebe) com aceite registrado, e as páginas legais do
  site com aceite no checkout: itens M5.6 e M7.4. **Provedor (4/10, depois da comparação rápida
  em `requisitos/product/RECEBIMENTO-SITE.md`):** Mercado Pago para Pix e cartão no M8.2, com as
  taxas padrão; propostas de outros provedores e troca só mais à frente, se compensar — não é
  obrigação (o provedor fica atrás de um adaptador). Pix direto pelo banco descartado por ora.
- 4/10 (Diego): **marketplace, modelo B em partes iguais**: a margem (taxa do Airbnb menos a
  taxa do pagamento) dividida igualmente entre desconto ao hóspede, ganho do proprietário e
  SCL; pesos e taxas de referência editáveis no painel (M12.1). Diego está testando os números
  no simulador e pode ajustar os pesos.
- 4/10 (Diego): **marketplace recebe como o site** (empresa recebe e repassa; sem split do
  Mercado Pago), com o extrato e as periodicidades do M4.10. **Um modelo por contrato, nunca
  por reserva:** no contrato de **gestão total**, a comissão do contrato vale em todos os
  canais, inclusive o site (sobre o valor líquido da taxa do pagamento); no **marketplace**, o
  modelo B vale só para o que o site vende e nada é cobrado sobre as reservas que o proprietário
  vende nas OTAs dele (decisão de 4/10, abaixo); o desconto do hóspede no site é regra única do
  site, igual para gestão total e marketplace. **Fonte de preços por imóvel** escolhida pelo
  proprietário, com explicação (M3.9): preços automáticos da SCL, preços do Beds24 (dele ou de
  uma ferramenta de precificação) ou preços digitados no portal; calendário sempre
  sincronizado pelo Beds24.
- 4/10 (Diego): **parcelamento no cartão do site**: sim, com os juros pagos pelo hóspede (a SCL
  não assume "sem juros"); número máximo de parcelas configurável no painel (M8.2). **Reservas
  que o proprietário do marketplace vende nas OTAs dele**: a SCL não cobra nada sobre elas — o
  modelo B vale só para o que o site vende (M12.2); se o dinheiro dessas reservas passar pela
  empresa (quem recebe = `empresa`, M2.7), é repassado integral pelo M4.10, sem comissão. Ideia de Diego para estudo, sem compromisso:
  assinatura modular (base + serviços opcionais, como o motor de preços) — registrada em
  `requisitos/growth/ROADMAP.md`.
