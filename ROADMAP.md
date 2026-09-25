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
| M0.5 | Deploy de homologação na Vercel conectado ao Neon (branch de banco `homolog`); migrações aplicadas no build (`vercel-build`, já pronto) | bloqueado | Diego: conectar repo na Vercel e Neon (ver "Ações de Diego") |
| M0.6 | Referência do sistema antigo: levantar as telas e capacidades do sistema antigo (arquivo que o Diego vai mandar) e cruzar com este ROADMAP, sem copiar dados reais | bloqueado | Diego: mandar o arquivo do sistema antigo |

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
| M2.3 | Contratos de gestão com vigência: gestão completa 15%/85%, online 10%, regra 102/303/399 → 15/85 a partir de 01/01/2027; marketplace como tipo separado (fórmula pendente) | feito | M2.2 |
| M2.4 | IDs externos: mapeamento imóvel ↔ Beds24 / Airbnb / Booking | feito | M2.1 |
| M2.5 | Script de carga inicial (seed) com dados fictícios para homologação | feito | M2.3 |
| M2.6 | Cadastro completo do imóvel: endereço completo, camas/comodidades, regras da casa, horários de entrada/saída, taxas (limpeza, hóspede extra), regras de venda (estadia mínima/máxima com exceções por período, antecedência, dias de chegada/saída), preço base e preço dinâmico (liga/desliga); tudo editável no painel (Diego 24/09) | feito | M2.1 |
| M2.7 | Quem recebe o pagamento por imóvel e por canal (Airbnb, Booking, site, direta/WhatsApp); um proprietário por imóvel; confirmação ao excluir; recálculo automático quando a regra muda | feito | M4.2 |
| M2.9 | Aba Anúncios: por imóvel, o anúncio em cada canal (Airbnb, Booking, site) — situação, link, título, descrição, fotos, preço base — e alerta quando os canais estiverem diferentes | a fazer | M2.6, M3.3 |

### M3 — Reservas e calendário

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M3.1 | Modelo de reserva: canal, datas, hóspede (mínimo necessário), valores brutos/taxas/líquido, estados, ID interno + ID externo | feito | M2.4 |
| M3.2 | Cliente Beds24 API v2 **somente leitura** (reservas, bloqueios, preços) com adaptador falso para testes | feito | M3.1 |
| M3.3 | Sincronização Beds24 → banco: idempotente, agendada (cron Vercel), registro de divergências; reconhecer como a mesma reserva a que já veio por planilha (M3.6), pela origem + código do canal | bloqueado | M3.2 + Diego: chave API Beds24 no ambiente |
| M3.4 | Calendário central: todas as unidades, por imóvel, reservas/bloqueios/limpezas/manutenção, filtros global e local | feito | M3.1, M0.4 |
| M3.5 | Lista de reservas com filtros e detalhe da reserva | feito | M3.1 |
| M3.6 | Importação manual (CSV) de reservas como alternativa enquanto Beds24 não estiver ligado | feito | M3.1 |
| M3.7 | **SCL como fonte oficial de calendário e preços** (Diego, 24/09): bloqueios, preços, estadia mínima e regras editados no SCL são enviados ao Beds24 e dele às OTAs; mudanças que chegarem do Beds24 são conferidas contra o SCL. Escrita autorizada por Diego, mas só é ligada (variável `BEDS24_ESCRITA=ligada`) depois de testada em um imóvel escolhido por ele | a fazer | M3.3, M2.6 |

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

### M5 — Portal do proprietário

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M5.1 | Portal: filtros ano/mês/imóvel, mês atual marcado como parcial, navegação ±9 meses | feito | M1.4, M4.2 |
| M5.2 | Tabela de reservas + calendário clicável + rodapé com saldo, credor/devedor e Pix (copiar) | feito | M5.1 |
| M5.3 | PDF do relatório no modelo aprovado (duas páginas, cores SCL; ver `requisitos/operations/RELATORIOS-PROPRIETARIOS.md`) | feito | M5.2 |
| M5.4 | Envio mensal por e-mail do fechamento no dia 1º do mês seguinte (depois de conciliado) | feito | M5.3, M1.3 |
| M5.5 | Proprietário edita o calendário do próprio imóvel no portal (bloqueio de uso próprio, liberar datas, conforme permissão do contrato); a mudança entra no SCL e segue para o Beds24/OTAs pelo M3.7 | a fazer | M5.1, M3.7 |

### M6 — Operação

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M6.1 | Limpezas: gerar no dia do checkout; estados pedida/confirmada/realizada; profissional; custo | feito | M3.4 |
| M6.2 | Manutenção: pedido, orçamento, aprovação de Diego, execução, custo e responsável (empresa/proprietário) | feito | M4.3 |
| M6.3 | Agenda diária (20h, próximos 5 dias, Rio e Búzios separados) enviada para a equipe | feito | M6.1 |
| M6.4 | Documentos de portaria (só 403): checklist de pedidos, sem armazenar documentos no Git | feito | M3.5 |
| M6.5 | Rotinas recorrentes (manutenção quinzenal, faxinas semanal, lembrete mensal) | feito | M6.2 |
| M6.6 | Equipe de limpeza: acesso próprio pelo celular (agenda, marcar faxina feita) e aviso por WhatsApp quando o M10 estiver ligado (e-mail enquanto isso) | feito | M6.1, M1.3 |

### M7 — Site público no novo app

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M7.1 | Migrar `prototipos/scl-publico` para o app (home, catálogo 5 imóveis, página, galeria, consulta) lendo imóveis do banco; textos do site editáveis no painel | feito | M2.1 |
| M7.2 | Disponibilidade e cotação reais a partir das reservas/preços sincronizados | a fazer | M7.1, M3.3 |
| M7.3 | Fotos reais (upload privado → Vercel Blob) quando Diego liberar os direitos de uso | bloqueado | Diego: autorizar fotos |

### M8 — Reserva direta e pagamento

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M8.0 | Rever a decisão de 24/09 sobre o recebimento do site (hoje: **empresa recebe e repassa**, que continua valendo até Diego decidir outra coisa), a pedido de Diego: split automático (Mercado Pago marketplace ou Stripe Connect, como no Airbnb) × empresa recebe e repassa; comparar taxas, estorno, chargeback e impostos — comparação e recomendação (manter) em `requisitos/product/RECEBIMENTO-SITE.md` | bloqueado | Diego: escolher o modelo (e confirmar impostos com o contador) |
| M8.1 | Cotação persistida, revalidação e hold com controle de concorrência | a fazer | M7.2 |
| M8.2 | Pagamento no provedor escolhido no M8.0 (Mercado Pago, se confirmado) em **sandbox**: checkout, webhook assinado, idempotência, reconciliação, **confirmação só com hold valendo** (a aprovação do pagamento vira reserva apenas se o hold do M8.1 ainda estiver ativo, conferido na mesma transação; aprovação que chega depois de o hold vencer: se as datas ainda estiverem livres, o sistema tenta segurá-las de novo na mesma transação e, conseguindo, confirma; senão — ou em qualquer outro caso — não cria reserva: o pagamento fica registrado, gera aviso e segue para devolução ao hóspede ou resolução manual registrada; nenhuma aprovação fica sem desfecho), registro de quando o provedor **libera o dinheiro** de cada pagamento, com o repasse ao proprietário daquela reserva **segurado até a liberação** (padrão, salvo decisão de Diego de adiantar ou receber na hora), devolução ao hóspede (pela **política de cancelamento do site** que Diego definir: reembolso total, parcial ou nenhum conforme a antecedência, e quem arca com a taxa do pagamento que não volta; sem política, o sistema não calcula reembolso sozinho — só registra o pedido e avisa; a devolução feita gera no financeiro lançamentos por componente — valor devolvido, taxa do pagamento que não volta, comissão e parte do proprietário —, idempotentes e conciliados, sem mexer nos lançamentos já realizados) **alteração de reserva paga** (datas ou preço): **toda mudança de datas** — mesmo sem diferença de valor — revalida a disponibilidade e segura as novas datas com o hold do M8.1, que expira e libera as datas se a alteração não for concluída; quando a alteração **reduz** o valor, a devolução parcial só é pedida ao provedor **depois** de a alteração estar confirmada e aplicada (novas datas seguradas), então nunca há devolução sem alteração; quando **aumenta**, pagamento da diferença que chega depois de o hold vencer segue a mesma regra da aprovação tardia (tenta um novo hold na mesma transação; sem ele, a alteração não é aplicada e o valor pago volta ao hóspede ou vai para resolução manual registrada); se o valor mudar, cobrança da diferença ao hóspede (novo pagamento) ou devolução parcial pelo provedor, idempotente; a alteração só é confirmada (e só vai ao Beds24 no M8.3) depois que as datas estiverem seguradas e, se o valor aumentar, a diferença estiver paga — até lá a reserva segue como estava e aparece um aviso; se o valor diminuir, a devolução vem logo depois da confirmação; ao confirmar, o financeiro recebe **lançamentos de diferença por componente** (valor bruto, taxa do pagamento, comissão e parte do proprietário — cada um só com a diferença entre o novo e o anterior, no tipo certo), idempotentes (uma chave por alteração) e conciliados com o provedor, sem mexer nos lançamentos já realizados/conciliados nem somar o total de novo; e **contestação (chargeback)**: eventos de disputa registrados com situação, aviso e reserva em conferência até a decisão da disputa. **Quem arca com a contestação perdida (SCL, proprietário ou na proporção) é decisão de Diego** (pendente): até ela existir, o sistema registra e avisa, sem descontar de ninguém automaticamente; com a regra definida, a contestação gera no financeiro lançamentos idempotentes para quem arca (SCL, proprietário ou cada um na sua proporção): débito pendente durante a disputa, estornado se a SCL ganhar e definitivo se perder — na parte do proprietário, o desconto fica segurado no repasse durante a disputa (no split, onde pode não haver repasse, a parte dele é recuperada por reversão/débito na conta conectada, quando o provedor permitir, ou vira valor a receber do proprietário, com aviso e compensação no próximo pagamento a ele); na parte da SCL, entra como perda da empresa. **Se o M8.0 escolher split**, o M8.2 inclui a integração do split em si (não fica pronto com um checkout comum): ligar a conta de cada proprietário no provedor (autorização e renovação), comissão da SCL e parte do proprietário em cada pagamento, estorno dividido entre as partes e conciliação por conta conectada. Antes de implementar: confirmar com o provedor (documentação/suporte) as regras de taxa, estorno parcial e contestação — em especial no split, quanto sai de cada parte; e, se for split, a **verificação de identidade (KYC) de cada proprietário** no provedor (pessoa física e empresa aceitas, documentos, conta ativa, renovação da autorização) confirmada com pelo menos um proprietário real antes de começar | bloqueado | M8.0, M8.1 + Diego: credenciais de teste do provedor escolhido |
| M8.3 | Reserva do site no Beds24 (escrita, atrás de `BEDS24_ESCRITA=ligada`): criar após pagamento confirmado e **cancelar/atualizar quando a reserva paga for cancelada ou alterada** (idempotente; alteração só depois de confirmada no M8.2 — novas datas seguradas e, se o valor aumentar, diferença paga), com conferência de que o Beds24 ficou igual ao SCL | bloqueado | M8.2 + autorização explícita de escrita |

### M9 — Portal do hóspede e mensagens

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M9.1 | Portal do hóspede: acesso por código/magic link ao e-mail do hóspede (e-mail no cadastro de todos); dados da própria reserva | feito | M1.3, M3.1 |
| M9.2 | Mensagens programadas (confirmação, check-in D-2 10h, checkout D-1 14h, agradecimento D+3 10h), jobs idempotentes; modelos de mensagem editáveis no painel | feito | M9.1 |

### M10 — WhatsApp (Meta Cloud API)

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M10.1 | Webhook de mensagens WhatsApp → caixa de entrada no painel, ligada a reserva/interessado | bloqueado | Diego: app Meta Business + número verificado |
| M10.2 | Respostas pelo painel, modelos aprovados (templates) para mensagens programadas | bloqueado | M10.1 |
| M10.3 | Assistente de resposta sugerida (Claude) com revisão humana antes do envio | a fazer | M10.1 |

### M12 — Marketplace (expansão: dono faz a operação física, SCL faz o online)

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M12.1 | Fórmula de cobrança do marketplace: hóspede paga menos que na OTA, proprietário ganha mais e a SCL também ganha — proposta em `requisitos/product/MARKETPLACE-PRECIFICACAO.md` (3 modelos); tela de simulação com percentuais editáveis | bloqueado | Diego: escolher o modelo |
| M12.2 | Motor de cálculo e repasse do contrato marketplace; forma de recebimento própria do marketplace (split automático, recomendado em `requisitos/product/RECEBIMENTO-SITE.md`, ou empresa recebe e repassa), decidida junto com o M12.1 — independente da escolha do M8.0 para o site atual. Se for split, antes de implementar valem as mesmas confirmações do M8.2: regras do provedor (taxa, estorno parcial, cancelamento, contestação e quanto sai de cada parte), verificação de identidade (KYC) com pelo menos um proprietário real, e as decisões de Diego sobre contestação e política de cancelamento. **Se for split, o M12.2 inclui a integração do split em si** (não fica pronta só com o cálculo) e **tudo o que o M8.2 exige do pagamento vale igualmente aqui**, adaptado à divisão entre as partes — em especial: ligar a conta de cada proprietário no provedor (autorização e renovação), checkout com a comissão da SCL em cada pagamento, avisos assinados do provedor processados de forma idempotente (chave do evento do provedor: aviso repetido não duplica movimento nem ação), estorno dividido entre as partes (pela política de cancelamento, com os mesmos lançamentos por componente no financeiro do M8.2 — valor devolvido, taxa que não volta, comissão e parte do proprietário —, idempotentes e conciliados), contestação conforme a decisão de Diego sobre quem arca (até ela existir, só registra e avisa, como no M8.2), alteração de reserva paga com o mesmo comportamento do M8.2 (hold das novas datas, diferença cobrada ou devolvida dividida entre as partes, lançamentos de diferença por componente), e conciliação por proprietário. O checkout do marketplace usa a cotação persistida, a revalidação de disponibilidade e o hold do M8.1 (dois hóspedes não pagam as mesmas datas nem uma cotação vencida), com a mesma regra do M8.2 na aprovação: só vira reserva com o hold valendo (conferido na mesma transação); aprovação tardia tenta um novo hold e, sem ele, vai para devolução ou resolução manual registrada — nada segue para o Beds24 sem reserva confirmada. **Se for empresa recebe e repassa**, o marketplace reusa o pagamento do M8.2 **quando o M8.2 tiver sido feito nesse mesmo modelo**; se o M8.2 tiver sido feito com split, o M12.2 implementa aqui o caminho sem split, com todas as exigências do M8.2 (checkout, avisos assinados, liberação do dinheiro, devolução, contestação e conciliação, com as mesmas confirmações do provedor e decisões de Diego) — não fica pronto só com o cálculo. **Nos dois casos**, a reserva paga do marketplace vai para o Beds24 com o mesmo comportamento do M8.3 (criar, atualizar, cancelar e conferir, idempotente, atrás de `BEDS24_ESCRITA=ligada` e com autorização explícita de escrita) — reusando o M8.3 se ele já existir ou implementando o equivalente aqui —, para o calendário das OTAs do proprietário não continuar vendendo as datas | a fazer | M12.1, M4.2, M8.1; M8.2 só se o marketplace for sem split **e** o M8.2 tiver sido feito sem split (para reusar) |
| M12.3 | Auto-cadastro do proprietário marketplace: cria conta, cadastra o imóvel (M2.6), escolhe "já anuncio"/"anúncio novo", revisão antes de publicar | feito | M1.4, M2.6 |
| M12.4 | Portal do proprietário marketplace: calendário, preços e regras de venda, limpeza/manutenção por conta própria. Bloqueio, preço ou regra editado pelo proprietário só vale se chegar às OTAs (senão o Airbnb/Booking continua vendendo as datas), então depende do M3.7; o preço do proprietário depende do modelo do M12.1 | a fazer | M12.3, M5.1, M3.7, M12.1 |

### M11 — Entrada em produção

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M11.1 | Carga de dados reais (imóveis, proprietários, contratos, histórico financeiro conferido) | bloqueado | Tudo acima + Diego |
| M11.2 | Domínio (Cloudflare) e e-mail transacional | bloqueado | Diego |
| M11.3 | Checklist de segurança, backup do Neon, go-live | bloqueado | M11.1 |

## Ações de Diego (o que destrava o quê)

1. **Revisar e mergear PRs** — por enquanto o Claude faz os merges (autorizado em 23/09).
2. **Vercel:** importar o repositório `al-life/scl-reconstrucao` na Vercel, *root directory* `app`, e ligar a integração Neon. (destrava M0.5)
3. **Chave API Beds24 (leitura e escrita)** → variável `BEDS24_API_KEY` no ambiente do Claude e na Vercel; nunca no chat nem no Git. A escrita só é usada quando o M3.7 for ligado. (destrava M3.3 e M3.7)
4. **Meta / WhatsApp Business:** iniciar a verificação da empresa no Meta Business — leva dias. (destrava M10)
5. **Pagamento do site:** credenciais de *teste* do provedor escolhido no M8.0 (Mercado Pago, se for a escolha). (destrava M8.2)
6. **Modelo do marketplace:** escolher entre os modelos propostos (ou ajustar). (destrava M12.1)
7. **Booking:** criar os anúncios (o Beds24 pode criar a partir dos dados já importados do Airbnb — ver guia). 
9. **E-mail do sistema (Resend):** conta e domínio. (liga o login por código e os convites por e-mail)
10. **Recebimento do site:** dizer se mantém a decisão de 24/09 ("empresa recebe e repassa", recomendado) ou muda para split automático, e confirmar com o contador a tributação só sobre a comissão — ver `requisitos/product/RECEBIMENTO-SITE.md`. (destrava M8.0 e orienta o M8.2)

## Pendências de decisão (não bloqueiam o início)

- Competência × caixa no financeiro.
- Búzios: fica no sistema interno para controle (decidido 24/09); se entra no site público, a decidir.
- Avaliações próprias × só Airbnb.
- Contestação de cartão (chargeback) perdida numa reserva do site: quem arca — SCL, proprietário ou os dois na proporção (vai no contrato). Não impede fazer o M8.2 em sandbox (sem a regra, só registra e avisa); precisa estar decidido antes de ligar o pagamento de verdade.
- Política de cancelamento das reservas do site: reembolso total, parcial ou nenhum conforme a antecedência, e quem arca com a taxa do pagamento que não volta. Mesma regra: não impede o M8.2 em sandbox; precisa estar decidida antes de ligar o pagamento de verdade.
- Cartão com recebimento em 30 dias numa reserva do site: repassar ao proprietário só quando o provedor liberar o dinheiro, a SCL adiantar, ou usar recebimento na hora (taxa maior). Mesma regra: antes do pagamento de verdade; sem decisão, o repasse dessa reserva espera a liberação.

## Decisões registradas

- 24/09 (Diego): comissão sobre o valor que o canal repassa (depois da taxa do canal);
  estadia entre meses rateada igualmente por noite (valor total, com limpeza); Airbnb faz
  split automático (proprietário recebe direto); Booking/site/direta: empresa recebe tudo e
  repassa uma vez por mês. (Para o site, Diego pediu para rever com a opção de split: M8.0;
  até lá, vale esta.)
- 24/09 (Diego): quem recebe é configurável por imóvel e por canal (padrão: Airbnb split);
  um proprietário por imóvel (pessoa ou empresa); imóveis do Diego são clientes normais;
  tudo editável pelo painel, uma regra num lugar só, exclusão com confirmação.
- 24/09 (Diego): o SCL é a fonte oficial de calendário e preços e escreve no Beds24 (M3.7);
  proprietário edita o calendário no portal e a mudança segue pelo SCL (M5.5); repasse e
  relatório mensal no dia 1º do mês seguinte; e-mail obrigatório no cadastro de proprietários
  (e usado no de hóspedes).
- 24/09 (Diego): mudança de regra vale daquela data para frente — o passado (e o dinheiro
  que já movimentou) nunca é recalculado.
