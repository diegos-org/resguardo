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
| M0.4 | Layout base do painel (menu lateral, cabeçalho, filtro global de imóveis/período reutilizável) com identidade SCL | a fazer | M0.2 |
| M0.5 | Deploy de homologação na Vercel conectado ao Neon (branch de banco `homolog`) | bloqueado | Diego: conectar repo na Vercel e Neon (ver "Ações de Diego") |

### M1 — Acesso e permissões

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M1.1 | Modelo: organização, usuário, papel (admin, operação, proprietário, hóspede), vínculo usuário↔proprietário↔imóvel; autorização deny-by-default no servidor (portar ideias de `prototipos/scl-gestao-demo/access-policy.mjs`) | a fazer | M0.3 |
| M1.2 | Login com Google (Auth.js) para equipe interna; lista de e-mails autorizados | a fazer | M1.1 |
| M1.3 | Login por código enviado por e-mail (uso único, validade, limite de tentativas) — provedor de e-mail com adaptador trocável; em teste, e-mails ficam em memória | a fazer | M1.2 |
| M1.4 | Convite de proprietário: token único, validade, uso único, revogação, aceite registrado | a fazer | M1.3 |
| M1.5 | Log de auditoria (quem alterou o quê, quando) usado por todos os módulos | a fazer | M1.1 |

### M2 — Cadastros

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M2.1 | Imóveis: ID interno SCL, nome público (Studio…), código (102, 103, 303, 399, 403, Búzios), flag `publico` (Búzios = false), fuso, capacidade, endereço | a fazer | M1.1, M0.4 |
| M2.2 | Proprietários e representantes (dados sensíveis só no banco, nunca no Git); vínculo com imóveis | a fazer | M2.1 |
| M2.3 | Contratos de gestão com vigência: gestão completa 15%/85%, online 10%, regra 102/303/399 → 15/85 a partir de 01/01/2027; marketplace como tipo separado (fórmula pendente) | a fazer | M2.2 |
| M2.4 | IDs externos: mapeamento imóvel ↔ Beds24 / Airbnb / Booking | a fazer | M2.1 |
| M2.5 | Script de carga inicial (seed) com dados fictícios para homologação | a fazer | M2.3 |

### M3 — Reservas e calendário

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M3.1 | Modelo de reserva: canal, datas, hóspede (mínimo necessário), valores brutos/taxas/líquido, estados, ID interno + ID externo | a fazer | M2.4 |
| M3.2 | Cliente Beds24 API v2 **somente leitura** (reservas, bloqueios, preços) com adaptador falso para testes | a fazer | M3.1 |
| M3.3 | Sincronização Beds24 → banco: idempotente, agendada (cron Vercel), registro de divergências | bloqueado | M3.2 + Diego: chave API Beds24 no ambiente |
| M3.4 | Calendário central: todas as unidades, por imóvel, reservas/bloqueios/limpezas/manutenção, filtros global e local | a fazer | M3.1, M0.4 |
| M3.5 | Lista de reservas com filtros e detalhe da reserva | a fazer | M3.1 |
| M3.6 | Importação manual (CSV) de reservas como alternativa enquanto Beds24 não estiver ligado | a fazer | M3.1 |

### M4 — Financeiro (ledger)

Requisitos: `requisitos/operations/FINANCEIRO-PORTAIS.md`, `requisitos/product/FINANCE-COSTS-SETTLEMENT.md`.
**Não copiar cálculo do sistema antigo.**

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M4.1 | Ledger: lançamentos imutáveis (bruto, taxa do canal, líquido, comissão SCL, direito do proprietário, recebimento, adiantamento, liquidação, estorno); estados previsto/realizado/conciliado/pendente | a fazer | M3.1, M2.3 |
| M4.2 | Motor de cálculo de comissão por contrato e vigência, com testes de arredondamento, estadia entre meses, cancelamento parcial | a fazer | M4.1 |
| M4.3 | Despesas: da empresa × do proprietário, categorias editáveis (arquivar em vez de apagar), comprovante opcional | a fazer | M4.1 |
| M4.4 | Adiantamentos e compensações (ex.: reparo de R$ 4.000 adiantado) sem dupla cobrança | a fazer | M4.3 |
| M4.5 | Ajustes/divergências com motivo "não identificado" e evidência | a fazer | M4.1 |
| M4.6 | Dashboard da empresa (receitas próprias, despesas, 1–2 gráficos) | a fazer | M4.2, M4.3 |
| M4.7 | Aba Apartamentos: tabela por imóvel com resultado da empresa, comissões, despesas, acertos | a fazer | M4.2, M4.4 |
| M4.8 | Teste de consistência: mesma reserva = mesmos totais em dashboard, aba Apartamentos, portal e PDF | a fazer | M5.3 |

### M5 — Portal do proprietário

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M5.1 | Portal: filtros ano/mês/imóvel, mês atual marcado como parcial, navegação ±9 meses | a fazer | M1.4, M4.2 |
| M5.2 | Tabela de reservas + calendário clicável + rodapé com saldo, credor/devedor e Pix (copiar) | a fazer | M5.1 |
| M5.3 | PDF do relatório no modelo aprovado (duas páginas, cores SCL; ver `requisitos/operations/RELATORIOS-PROPRIETARIOS.md`) | a fazer | M5.2 |
| M5.4 | Envio mensal por e-mail do fechamento (depois de conciliado) | a fazer | M5.3, M1.3 |

### M6 — Operação

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M6.1 | Limpezas: gerar no dia do checkout; estados pedida/confirmada/realizada; profissional; custo | a fazer | M3.4 |
| M6.2 | Manutenção: pedido, orçamento, aprovação de Diego, execução, custo e responsável (empresa/proprietário) | a fazer | M4.3 |
| M6.3 | Agenda diária (20h, próximos 5 dias, Rio e Búzios separados) enviada para a equipe | a fazer | M6.1 |
| M6.4 | Documentos de portaria (só 403): checklist de pedidos, sem armazenar documentos no Git | a fazer | M3.5 |
| M6.5 | Rotinas recorrentes (manutenção quinzenal, faxinas semanal, lembrete mensal) | a fazer | M6.2 |

### M7 — Site público no novo app

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M7.1 | Migrar `prototipos/scl-publico` para o app (home, catálogo 5 imóveis, página, galeria, consulta) lendo imóveis do banco | a fazer | M2.1 |
| M7.2 | Disponibilidade e cotação reais a partir das reservas/preços sincronizados | a fazer | M7.1, M3.3 |
| M7.3 | Fotos reais (upload privado → Vercel Blob) quando Diego liberar os direitos de uso | bloqueado | Diego: autorizar fotos |

### M8 — Reserva direta e pagamento

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M8.1 | Cotação persistida, revalidação e hold com controle de concorrência | a fazer | M7.2 |
| M8.2 | Mercado Pago em **sandbox**: checkout, webhook assinado, idempotência, reconciliação | bloqueado | M8.1 + Diego: credenciais de teste Mercado Pago |
| M8.3 | Criação da reserva no Beds24 após pagamento confirmado (escrita) | bloqueado | M8.2 + autorização explícita de escrita |

### M9 — Portal do hóspede e mensagens

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M9.1 | Portal do hóspede: acesso por código/magic link ao contato já associado; dados da própria reserva | a fazer | M1.3, M3.1 |
| M9.2 | Mensagens programadas (confirmação, check-in D-2 10h, checkout D-1 14h, agradecimento D+3 10h), jobs idempotentes | a fazer | M9.1 |

### M10 — WhatsApp (Meta Cloud API)

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M10.1 | Webhook de mensagens WhatsApp → caixa de entrada no painel, ligada a reserva/interessado | bloqueado | Diego: app Meta Business + número verificado |
| M10.2 | Respostas pelo painel, modelos aprovados (templates) para mensagens programadas | bloqueado | M10.1 |
| M10.3 | Assistente de resposta sugerida (Claude) com revisão humana antes do envio | a fazer | M10.1 |

### M11 — Entrada em produção

| ID | Item | Estado | Depende de |
|---|---|---|---|
| M11.1 | Carga de dados reais (imóveis, proprietários, contratos, histórico financeiro conferido) | bloqueado | Tudo acima + Diego |
| M11.2 | Domínio (Cloudflare) e e-mail transacional | bloqueado | Diego |
| M11.3 | Checklist de segurança, backup do Neon, go-live | bloqueado | M11.1 |

## Ações de Diego (o que destrava o quê)

1. **Revisar e mergear PRs** — tudo depende disso.
2. **Vercel:** importar o repositório `al-life/scl-reconstrucao` na Vercel, *root directory* `app`, e ligar a integração Neon. (destrava M0.5)
3. **Chave API Beds24** → colocar como variável `BEDS24_API_KEY` nas configurações do ambiente do Claude e na Vercel; nunca no chat nem no Git. (destrava M3.3)
4. **Meta / WhatsApp Business:** iniciar a verificação da empresa no Meta Business — leva dias. (destrava M10)
5. **Mercado Pago:** credenciais de *teste*. (destrava M8.2)
6. **Fórmula do marketplace:** confirmar quando lembrar. (refina M2.3)

## Pendências de decisão (não bloqueiam o início)

- Competência × caixa no financeiro; base de cálculo da comissão.
- Inclusão de Búzios no sistema interno (modelado com `publico = false` até decidir).
- Avaliações próprias × só Airbnb.
