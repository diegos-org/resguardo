# Reserva paga do site no Beds24 (M8.3): desenho

**Situação:** desenho revisado em 16/10/2026 depois de três críticas: dano real, concorrência e operação. Base: `origin/main` no commit `adca993` (16/10/2026).
- **M8.3a (base sem escrita): entregue em 16/10/2026 na branch `claude/m8-3a-base-reservas-beds24`, em revisão e ainda não integrado na `main`.** Nada escreve no Beds24. As mudanças de método da implementação estão registradas onde cada regra mora (5.2, 7, 8 e 10).
- **M8.3b e M8.3c:** a fazer (seção 13). **M8.3d:** `bloqueado` na resposta do suporte do Beds24, que Diego pede com a pergunta preparada pelo agente no M8.3c (seções 12 e 13).
- **D3 decidida por Diego em 16/10/2026**, igual ao padrão: só a reserva paga pelo site vai ao Beds24 (seção 11).
- **Antes:** esta linha dizia "este é só o desenho" e "Nada foi implementado", e as seções 1 e 13 previam o M8.3a a partir da `main` depois do merge do PR das decisões de 16/10. **Agora:** como esse PR (#146, M13.1) ainda está aberto, o M8.3a foi empilhado sobre ele e entra depois dele, na ordem dos PRs empilhados (`CLAUDE.md`, "Merge", item 4).

**Fontes:**
- o código da `main` (caminhos relativos a `app/src/`, salvo indicação);
- os requisitos;
- uma contagem no Neon de produção em 16/10, só com números e sem dados pessoais;
- a documentação pública do Beds24:
  - a especificação `beds24.com/api/v2/apiV2.yaml`, citada como `yaml:N`;
  - a wiki `wiki.beds24.com`, citada como `Cat:N` (linha N da página Category:API_V2) ou pelo nome da página.

Nenhuma chamada foi feita à API do Beds24.

**Legenda:**
- **[C]** confirmado na documentação pública do Beds24.
- **[I]** inferência.
- **[S]** suposição sobre o ambiente (Vercel, conta do Beds24), sem conferência.
- **a confirmar:** precisa ser conferido com o suporte do Beds24 ou no ensaio (seção 8) antes de ligar.
- Sem marca: conferido no código ou no banco.

---

## 1. Objetivo, decisão de 16/10 e o que fica de fora

### Objetivo
Uma reserva paga pelo site pode ser confirmada, cancelada ou alterada no SCL. Cada uma dessas mudanças vai ao Beds24: criar, cancelar ou atualizar. Depois o sistema relê o Beds24 para conferir que ficou igual e grava sozinho as marcas que hoje a equipe grava à mão. Resultado:
- o Airbnb e o Booking fecham e reabrem as datas sem trabalho manual;
- os três avisos das OTAs no Início somem quando não sobra nada a fazer.

O SCL continua dono da reserva: valor, financeiro, hóspede e situação. O Beds24 só espelha o quarto, as datas, o número de pessoas e a situação.

### Registro da decisão
O registro da decisão de 16/10 (opção B) já está na branch `claude/m13-1-mcp-e-decisoes`, nos commits `2727138` e `fde4722`, que ainda não estão na `main`. Ele cobre:
- a linha do M8.3 no `ROADMAP.md`: `a fazer`, atrás de `BEDS24_ESCRITA_RESERVAS=ligada`, com o registro do antes e do agora;
- o M12.2, que passa a citar a mesma chave;
- a seção "Nunca" do `CLAUDE.md`;
- o item 15 do `GUIA-DIEGO.md`.

Este desenho não repete esse registro, para não criar duas versões das mesmas linhas. O M8.3a parte da `main` depois do merge desse PR. No `ROADMAP.md`, ele muda só a divisão em M8.3a a M8.3d (seção 13) e o `feito` de cada parte entregue.

> **Registro (16/10/2026, na entrega do M8.3a).** As duas últimas frases acima eram o plano do desenho.
> - **Antes:** o M8.3a partia da `main` depois do merge desse PR; no `ROADMAP.md`, ele mudava só a divisão e o `feito`.
> - **Agora:** o M8.3a é a exceção da seção 13: foi empilhado sobre esse PR (#146), ainda aberto, e entra depois dele (registro no topo deste documento). No `ROADMAP.md`, além da divisão e do `feito`, ele registra a D3, decidida por Diego em 16/10 (seção 11), com uma frase na linha do M8.3 e uma entrada em "Decisões registradas"; põe o M8.3d como `bloqueado` na pergunta ao suporte do Beds24 (seções 12 e 13); e acrescenta o item 17 de "Ações de Diego" (as decisões em aberto da seção 11 e essa pergunta). O item 15, que é do registro da autorização, não muda.
> - **Motivo:** o #146 não foi integrado antes de o M8.3a ficar pronto; a D3 foi decidida depois deste desenho; e a pergunta ao suporte depende de Diego, dono da conta.
> - **Objetivo final, o mesmo:** cada registro num lugar só, sem duas versões das mesmas linhas.

| | |
|---|---|
| **Antes** | O M8.3 ficava atrás de `BEDS24_ESCRITA=ligada`, a chave do calendário (M3.7), e estava `bloqueado` esperando autorização. |
| **Agora (16/10, opção B)** | A escrita de reservas está autorizada atrás de uma chave própria, `BEDS24_ESCRITA_RESERVAS=ligada`, independente da `BEDS24_ESCRITA`. Só o Diego liga. Em 16/10 nenhuma das duas existia na Vercel. |
| **Motivo** | Cada escrita (calendário e reservas) liga e desliga sem depender da outra. As palavras de Diego estão no PR das decisões. |
| **Objetivo final** | As datas das reservas do site abrem e fecham nas OTAs sozinhas, sem venda dupla e sem trabalho manual. |

### Fica de fora do M8.3
- **Hold do M8.1 e reserva-pedido da alteração (M8.2d).** Nunca vão ao Beds24. Continua o risco de venda dupla durante o hold, registrado em `requisitos/product/COTACAO-E-HOLD-SITE.md` l.81-82: Pix pelo menos 30 min, cartão em análise até 60 min, alteração até 48 h.
- **Reservas de outras fontes** (Beds24, planilha, manual).
- **Pedido do site confirmado à mão sem pagamento** (D3, decidida por Diego em 16/10: seção 11). Não entra no envio. Ganha só o aviso e a marca manual (seção 6).
- **Marketplace.** A autorização de 16/10 vale para ele, mas a régua o exclui de forma explícita até o M12.2 (seção 2.1). A conta e a credencial do Beds24 do proprietário são assunto do M12.2.
- **Valor, fatura, pagamento e dados pessoais do hóspede** (seção 7).
- **Webhooks do Beds24 e o DELETE de reserva.**
- **Reativação** (de `cancelled` para `confirmed`) **e "Assumir no Beds24"** sobre um bloqueio feito à mão: ficam no M8.3d, depois da resposta do suporte do Beds24.
- **Mudanças no envio de calendário (M3.7).** Ele continua sem criar, alterar nem cancelar reservas (`requisitos/operations/CALENDARIO-PRECOS-OPERACAO.md` l.237). Exceções: a ordem das travas (3.6) e a regra de "em andamento" compartilhada (5.1). A trava de ambiente na escrita de calendário fica registrada como pendência (seção 12).
- **Ligar o pagamento real em produção.** É outro item. Hoje o pagamento só roda nas prévias (`pagamentos/ambiente.ts`, `producao_travada`).
- **Disparo logo depois do pagamento (`after()`).** Foi retirado do desenho (3.1).

---

## 2. Quando escrever

### 2.1 A régua (uma função, um lugar)
A função pura `reservaDoSiteParaBeds24(reserva, contexto)`, em `beds24/reservas-site-regras.ts`, decide se uma reserva entra. A reserva entra quando atende a todas as condições abaixo:
1. `reservas.fonte = 'site'`;
2. existe um pagamento com `desfecho = 'reserva'` para ela (índice `pagamentos_um_desfecho_reserva`, `db/schema.ts:1669`). Isso cobre:
   - a confirmação normal;
   - a aprovação tardia;
   - a reserva confirmada à mão que depois recebeu o pagamento do site (`desfechoMotivo: "confirmada_pela_equipe"`, `pagamentos/confirmacao.ts:115-136`);
3. o contrato vigente na data de entrada **não** é marketplace (`contratoVigente(...).tipo`, a mesma régua de `financeiro/motor.ts:196-198`). Senão, o motivo é `marketplace`. O M12.2 retira essa condição, e um teste a cobre;
4. o imóvel está ligado na configuração `reservasBeds24` (2.3);
5. a reserva foi confirmada depois de o imóvel ser ligado (`reservas.confirmadaEm >= ligadoEm`). Uma reserva confirmada antes, ou sem `confirmadaEm`, nasce `manual` com motivo `anterior_a_ligar`, pela regra "mudança vale daquela data para frente" (6.6).

| Ação | Quando |
|---|---|
| **Criar** | `estado = 'confirmada'` e `checkout > hoje` (America/Sao_Paulo), sem reserva no Beds24 ligada a ela. "Ligada" quer dizer: sem `reservas.beds24_id` e sem operação com `beds24_id`. |
| **Atualizar** | Existe reserva no Beds24 criada pelo M8.3, ela continua confirmada, `checkout >= hoje`, e a assinatura atual do SCL difere da assinatura do `esperado` da última intenção. A assinatura cobre quarto guardado, chegada, saída, pessoas e situação. **Não** se compara com o `lido`: o `lido` só serve para detectar divergência. Com o acompanhamento `divergente`, a atualização automática fica suspensa até a equipe agir (5.3). Nunca entra uma alteração `segurada`. |
| **Cancelar** | `estado = 'cancelada'`, com um `cancelamentos_reserva` em `situacao = 'cancelada'`, e reserva no Beds24 criada pelo M8.3. Segue também com o acompanhamento `divergente` e com o imóvel desligado no painel. Só a pausa geral faz o cancelamento parar. |

Nunca entram:
- o pedido ou hold (`estado = 'pedido'`);
- a reserva-pedido da alteração (`fonte = 'alteracao'`);
- o pagamento sem reserva;
- reservas de outras fontes;
- o marketplace, até o M12.2.

O M12.2 reusa as mesmas tabelas e funções.

### 2.2 A trava de ambiente (uma função)
`escritaReservasBeds24Pronta(env)` fica em `beds24/http.ts` e recebe o `env` sempre de forma explícita: o domínio não usa `process.env` como valor padrão. Ela nunca reaproveita `escritaBeds24Ligada` (l.195) nem `escritaBeds24Pronta` (l.217). Só vale com as quatro condições:
1. `deployDeProducao(env)` (`sistema/ambiente.ts:40`): exatamente `VERCEL_ENV=production`;
2. `env.NODE_ENV === "production"`. O `next dev` usa `development` e o Vitest usa `test`, então os dois ficam fora mesmo com `VERCEL_ENV` simulado. Os testes de rota já simulam `VERCEL_ENV=production` (`app/api/cron/beds24-envio/route.test.ts:7`, `app/api/cron/cotacoes/route.test.ts:16`);
3. `env.BEDS24_ESCRITA_RESERVAS?.trim() === "ligada"`;
4. `BEDS24_REFRESH_TOKEN` presente. O token de longa duração (`BEDS24_API_KEY`) só lê **[C]** (Cat:13, 558-565). Ele nunca habilita a escrita de reservas.

Depois do ambiente vêm as condições do painel (2.3): pausa geral desligada, prontidão em ordem e imóvel ligado. Por fim, as do imóvel:
- vínculo único e válido, pela mesma régua de `quartoVinculado` e `vinculoValidoParaEnvio` (`calendario/envio.ts:51-65`, :93-103);
- quarto acessível à credencial;
- moeda BRL.

**Proteção nos testes:** um `setupFiles` no `vitest.config.mts` derruba o teste em qualquer `fetch` para `*.beds24.com`. A sessão tem a credencial real no ambiente.

### 2.3 Configuração no painel: `reservasBeds24`
Fica gravada pelo armazém de configurações (`configuracoes/armazem`: `lerConfig`, `gravarConfig`, `travarConfig`, como a configuração `beds24` em `beds24/configuracao.ts:11-18`). Não precisa de migração. Só a função `lerConfigReservasBeds24` lê essa configuração. Ela **nunca** usa a lista `envio.imoveis` do M3.7 (`calendario/regras-config.ts`).

Conteúdo:
- **`pausado`**, com quem pausou e quando. É o freio geral, que vale na hora. Tirar a variável da Vercel só vale depois de uma publicação nova (`GUIA-DIEGO.md:2692`). A pausa é lida na fase 1 e de novo logo antes do POST.
- **`imoveis`**: a lista `[{ imovelId, ligadoEm, ligadoPor }]` (D6).
- **`ensaio`**: o último ensaio conferido, com a impressão da credencial, a data e a operação (8 e D7).

Regras:
- A edição fica em Integrações e exige `configuracao:editar`, com `BotaoConfirmar` e auditoria.
- Um imóvel só pode ser ligado depois de um ensaio conferido com a credencial atual. Trocar o token deixa as criações paradas (motivo `sem_ensaio`) até um ensaio novo.
- Com o imóvel desligado, só a criação para. A atualização e o cancelamento de uma reserva já criada pelo M8.3 seguem (proposta da D6).

### 2.4 O que acontece em cada combinação
| Ambiente | Chave | Credencial | Painel | Resultado |
|---|---|---|---|---|
| Prévia, `vercel dev`, computador, testes | qualquer | qualquer | qualquer | O M8.3 **nunca** escreve nem lê o Beds24. O botão "Simular" monta o pedido só com o banco e grava uma operação `simulada`. Sistema e Integrações avisam "credencial de escrita presente fora da produção" quando houver `BEDS24_REFRESH_TOKEN`. |
| Produção | ausente ou diferente de `ligada` | qualquer | qualquer | A rotina sai antes de qualquer trava, leitura ou linha nova. A única exceção: operações `enviando` ou `incerta` que sobraram de quando a chave estava ligada são resolvidas só com leitura, nunca com POST. Os avisos usam o texto por reserva (6.2). |
| Produção | `ligada` | ausente, ou só `BEDS24_API_KEY` | qualquer | Nada sai. Um aviso de configuração aparece em Integrações, no Sistema e numa linha do Início, e não um por reserva. |
| Produção | `ligada` | refresh token | pausa geral | Nada é escrito. As operações em curso são resolvidas só com leitura. |
| Produção | `ligada` | refresh token | prontidão falhou: `escopo_excessivo`, `escopo_fora_de_ordem` (escopo faltando ou resposta ilegível, seção 7), `sem_ensaio` ou `marca_ilegivel` | As criações param e vale um aviso de configuração só. Atualização e cancelamento de reservas já criadas seguem, salvo com `escopo_excessivo`; sem a permissão, o Beds24 recusa e o motivo vira `sem_permissao` (3.8). |
| Produção | `ligada` | refresh token | imóvel não ligado | Para aquele imóvel, vale como chave desligada: sem linha nova e sem aviso de atenção. Só o aviso manual de hoje. |
| Produção | `ligada` | refresh token | sem vínculo único, quarto inacessível ou moeda diferente de BRL | Aviso de configuração. A reserva fica `pendente` com o motivo. |
| Produção | `ligada` | refresh token | tudo certo | **Envio real** em três fases (3.6). |

`BEDS24_ESCRITA` (calendário) não interfere em nada desta tabela, e o contrário também vale.

> **Efeito prático hoje (fatos de 16/10):**
> - em produção há 0 reservas do site confirmadas e 0 pagamentos;
> - o pagamento só roda nas prévias. Mesmo mergeado e com a chave ligada, o M8.3 não tem o que enviar em produção até o pagamento real ser liberado. A exceção seria a D3, se Diego dissesse sim; ele decidiu em 16/10 que não (seção 11), então não há exceção;
> - a importação automática do Beds24 está **desligada** em produção. Nas 7 execuções diárias de 10/10 a 16/10, todas responderam "Sincronização automática desligada no painel" (contagem em `execucoes_automacao` no Neon de produção). Por isso o M8.3 faz a própria conferência (4.5) e não conta com a importação.

---

## 3. Como

### 3.1 Princípio: a rotina acerta o Beds24 pelo estado do SCL
Uma rotina lê o estado atual de cada reserva paga do site e acerta o Beds24. Ela não reage a cada evento.

**Por quê:**
- **Um lugar só.** Há pelo menos 8 portas que confirmam, cancelam ou alteram uma reserva, entre elas `confirmarPedidoPago`, a aprovação tardia, `confirmada_pela_equipe`, `gravarCancelamento`, `gravarCancelamentoContestado` e o núcleo da alteração.
- **Idempotente por natureza.** A rotina manda sempre o estado atual, nunca um delta. Isso cobre também a alteração feita em duas partes.
- **Mesmo padrão do M3.7:** intenção durável, depois a escrita externa, depois a releitura (`calendario/envio.ts:240-246`).

**O pagamento nunca falha por causa do Beds24.** Nenhum funil do pagamento importa o módulo do M8.3. Nada do M8.3 roda dentro de `aplicarNaTransacao` (`pagamentos/conferencia.ts:103-110`), de `pix.ts` ou de `cartao.ts`.

**Sem disparo por `after()`.** A rota do Mercado Pago tem `maxDuration = 60` (`app/api/pagamentos/mercadopago/route.ts:26`, `after` na l.123), e esse tempo é dividido com o processamento da order. Uma operação do M8.3 faz de 6 a 7 chamadas de até 30 s cada (`beds24/autenticacao.ts:24`, `http.ts:226`). Uma função cortada depois do POST deixaria uma operação `enviando` presa. Por isso:
- quem escreve é só o cron, com 300 s;
- o atraso de até 10 min fica coberto pela carência dos avisos (6.1);
- a ficha tem "Tentar de novo".

### 3.2 Tabelas novas: migração `app/drizzle/0072_m8_3_reservas_site_beds24.sql`
A última migração na `main` é `0071_m7_17_frase_do_imovel.sql`. O número muda se outro PR com migração entrar antes. Nunca editar uma migração já mergeada.

**`beds24_reservas_site`** guarda o acompanhamento: uma linha por reserva do site que o M8.3 acompanha. A linha nasce:
- pela rotina, com a chave pronta e o imóvel ligado;
- pela marca manual (6.4);
- por "Deixar à mão".

| Coluna | Para quê |
|---|---|
| `id` uuid pk; `organizacao_id`; `reserva_id` fk `reservas` | único `(organizacao_id, reserva_id)` |
| `imovel_id`, `property_id`, `room_id` | O quarto onde a reserva foi criada. Atualizar e cancelar vão sempre a ele. |
| `credencial` | `impressaoCredencialBeds24` da criação (`beds24/http.ts:203-214`), nunca a credencial em si |
| `referencia` | `reservas.codigo` (ex.: `SCL-7K2QXM`, `reservas/regras.ts:63`) |
| `situacao` | `pendente`, `em_envio`, `conferida`, `divergente`, `conflito`, `aguardando_equipe`, `manual` ou `encerrada` (3.4). "Desligada" não é gravada: a tela calcula. |
| `motivo` | Lista fechada, sem resposta crua do provedor e sem dado pessoal (abaixo da tabela). |
| `versao` int | Sobe a cada intenção nova (3.3) |
| `esperado` jsonb, `assinatura_esperada` | O que o SCL quer no Beds24: `{quarto, chegada, saida, hospedes, situacao}` |
| `lido` jsonb, `lido_em` | A última leitura do Beds24, com os mesmos campos. Só uma leitura mais nova sobrescreve. |
| `conferida_em` | A última conferência que bateu |
| `ota_fechada_em`, `ota_fechada_por` | Marca do aviso "reserva paga": `por` nulo = o sistema; preenchido = a marca manual (D8) |
| `tentativas`, `proxima_tentativa_em` | Falhas antes do POST e atraso |
| `buscas_sem_conclusao` | Contador próprio da incerteza. "Tentar de novo" não zera. |
| `avisada_em`, `criado_em`, `atualizado_em` | |

Os motivos são estes:
- **Configuração:** `sem_vinculo`, `sem_credencial`, `escopo_excessivo`, `escopo_fora_de_ordem`, `sem_ensaio`, `marca_ilegivel`.
- **Situação manual ou bloqueio:** `anterior_a_ligar`, `deixada_a_mao`, `bloqueio_manual`, `bloqueio_do_scl`.
- **Incerteza e recusa:** `incerta`, `duplicada`, `marca_em_registro_inesperado`, `sem_permissao`, `recusada_pelo_beds24`, `sem_disponibilidade`.
- **Conflito, falha e divergência:** `noites_ocupadas`, `falhas`, `mudada_no_beds24`, `cancelada_no_beds24`, `apagada_no_beds24`.

O id final do Beds24 mora num lugar só, `reservas.beds24_id` (`db/schema.ts:409`). Ele tem índice único por organização (`:442`), o que impede duas reservas do SCL de reivindicarem o mesmo registro. Até a fase 3, o id fica na operação (3.6).

**`beds24_reservas_operacoes`** guarda a fila e o histórico: uma linha por operação.

| Coluna | Para quê |
|---|---|
| `id`; `organizacao_id`; `reserva_id` (nulo no ensaio); `acompanhamento_id` (nulo na simulação e no ensaio) | |
| `tipo` | `criar`, `atualizar`, `cancelar`, `vincular` (id informado pela equipe) ou `ensaio` |
| `chave` | Idempotência, único `(organizacao_id, chave)` (3.3) |
| `modo` | `real` ou `simulacao` |
| `situacao` | `pendente`, `enviando`, `incerta`, `feita`, `conferida`, `divergente`, `conflito`, `recusada`, `falhou`, `superada` ou `simulada` |
| `pedido` jsonb | Resumo do que foi ou seria enviado: quarto, datas, pessoas, situação, referência. Sem nome real, e-mail, telefone nem valor. |
| `alteracoes` jsonb | Ids das alterações `aplicada` sem marca, lidos na fase 1 (6.3) |
| `antes`, `depois` jsonb | Leituras do Beds24 nos mesmos campos |
| `beds24_id` | Gravado logo depois da resposta, antes da fase 3 |
| `credencial`, `autor_id` (nulo = rotina) | |
| `tentativas`, `iniciado_em` (`now()` do banco), `enviado_em` (gravado logo antes do POST), `respondido_em`, `terminado_em`, `erro` (mensagem segura) | |

**Índices:**
- único `(organizacao_id, chave)`;
- único parcial `(reserva_id) where situacao in ('pendente','enviando','incerta')`: no máximo uma operação ativa por reserva;
- `(organizacao_id, situacao, iniciado_em)`;
- `(organizacao_id, beds24_id) where beds24_id is not null`.

As duas tabelas entram na varredura `semDadosPessoais` (`pagamentos/testes.ts:196`, lista em :197-210). Os testes de criação e cancelamento usam `semDadosDoHospede` (:227).

### 3.3 Idempotência
- **Chaves:** `<tipo>:<reservaId>:<versao>`, com a `versao` do acompanhamento. Ela sobe na fase 1, sob a trava `beds24:<org>`, quando nasce uma intenção nova. As exceções:
  - ensaio: `ensaio:<uuid>`;
  - simulação: `simulacao:<reservaId>:<tipo>:<assinatura>`. O tipo entra porque o mesmo estado pode ser simulado como criação e, depois de criada, como atualização: sem ele, a segunda simulação reaproveitaria a linha da primeira e diria "criar" (revisão do Codex, 16/10);
  - `assinatura` = sha256 truncado de `room_id|chegada|saida|hospedes|situacao`.
- **Operação ainda sem POST** (`enviado_em` nulo):
  - mesmo tipo: é atualizada no lugar (`pedido`, `esperado`, `alteracoes`), com a mesma chave;
  - tipo diferente: vira `superada` e nasce outra com versão nova. Por exemplo, uma `criar` cuja reserva foi cancelada. Uma `criar` só vira `superada` se a reserva deixar de precisar dela antes de qualquer POST.
- **Operação com POST tentado** (`enviado_em` preenchido): nunca é atualizada no lugar. A seguinte espera ela terminar.
- **Linha terminal** (`conferida`, `superada`, `divergente`, `recusada`, `conflito` ou `falhou`): nunca é retomada para uma intenção nova. "Tentar de novo" só reabre a mesma linha em `falhou`, `recusada` ou `conflito`, e só para a mesma intenção (mesma assinatura). Se o SCL mudou, nasce uma versão nova.
- **Inserção** com `on conflict (organizacao_id, chave) do nothing`, seguida da releitura da linha.
- **Busca primeiro.** Toda criação começa procurando a marca no Beds24 (3.5). Isso protege contra resposta perdida, queda do banco e restauração de backup.
- **[C] O Beds24 não tem chave de idempotência.** "idempot" não aparece na especificação, e `POST /bookings` sem `id` cria uma reserva nova (`yaml:378-381`).

### 3.4 Estados
**Operação:** `pendente` → `enviando` → `feita` → `conferida`, `divergente` ou `incerta`. Pode terminar também em `conflito`, `recusada`, `falhou` ou `superada`. `simulada` só existe fora da produção ou com a chave desligada.

**Acompanhamento** (o que a equipe vê):
| Situação | Significado |
|---|---|
| `pendente` | Há envio a fazer, com `proxima_tentativa_em`; ou está parado por um motivo de configuração |
| `em_envio` | Há uma operação `enviando` ou `incerta` |
| `conferida` | O Beds24 estava igual ao SCL na última leitura |
| `divergente` | O Beds24 está diferente (mudado, cancelado ou apagado por fora, outro quarto ou marca alterada). A atualização automática fica suspensa. |
| `conflito` | As noites estão ocupadas por outro registro. Nada foi enviado. |
| `aguardando_equipe` | Bloqueio manual, incerteza sem solução, marca em registro inesperado, duplicada, recusa, ou 5 falhas |
| `manual` | A equipe cuida à mão: anterior a ligar, "Deixar à mão" ou marca manual. O M8.3 não escreve. |
| `encerrada` | A estadia terminou, ou o cancelamento foi conferido |

Na tela, "desligada" é calculada: chave, pausa ou imóvel desligado, ou nenhuma linha.

### 3.5 A marca do SCL gravada no Beds24
**Marca principal:** `infoItems: [{ code: "SCL", text: "<reservas.codigo>" }]`. **[C]** O campo é aceito na criação (`yaml:3464-3656`) e lido com `includeInfoItems=true` (`yaml:298`). **A confirmar** com o suporte:
- que o info item é dado básico (escopo `bookings`, sem `bookings-personal`);
- o custo em créditos.

**Reconhecimento pela equipe no Beds24:**
- Pelo nome (`firstName: "Site"`, `lastName: "SCL-7K2QXM (não altere aqui)"`), **só se** o suporte confirmar que gravar o nome não exige escrita em `bookings-personal`. **[C]** Os dados pessoais exigem esse escopo também no POST (Cat:98-109), e o escopo inclui `POST /bookings/messages` (`API_V2.wiki:98-104`).
- Se exigir, a frase vai em `notes`: "Reserva paga pelo site SCL-7K2QXM: não altere aqui, mude pelo SCL". **A confirmar** que `notes` é básico e que nenhum modelo de e-mail do Beds24 o mostra.

**Ensaio:** info item `code: "SCL-ENSAIO"`, `text` = id da operação.

**Campos que não usamos:**
- `refererEditable`, que pode virar `referer` na leitura e mudar o canal (`canalDe`, `beds24/normalizar.ts:44-50`);
- `comments`.

**Na leitura:** `normalizarReserva` ganha `referenciaScl: string | null` e `ensaio: boolean`. A referência vem do info item `SCL` ou, como reforço, do padrão `/\bSCL-[A-HJ-NP-Z2-9]{6}\b/` no nome ou em `notes`. As leituras do M8.3 e da importação passam a pedir `includeInfoItems=true` (custo **a confirmar**).

**Como procurar** (`procurarReservaDoSite`):
1. `GET /bookings` com `roomId`, `arrivalFrom = arrivalTo = chegada`, todas as situações (`beds24/http.ts:98`) e `includeInfoItems=true`. A saída é filtrada no código. O filtro de chegada é explícito porque, por padrão, só vêm reservas futuras **[C]** (`yaml:168`). **A confirmar:** se o filtro explícito desliga esse padrão.
2. Se a marca também estiver no nome: `searchString=<codigo>` com `arrivalFrom=1900-01-01` (`yaml:289-293`).
3. Para uma reserva com id conhecido: releitura por id (`leitor.reservas({ ids, chegadaDe: "1900-01-01" })`, padrão de `beds24/sincronizacao.ts:69`).

A busca "funcionou" quando a resposta é válida **e** a credencial lê a marca. O ensaio com a credencial atual prova a segunda parte (seção 8).

**Regras de adoção**, iguais no trabalhador, na importação e em "Vincular":
- existe **exatamente um** registro com a marca;
- a situação é `confirmed` ou `new`;
- `roomId` é o guardado (na criação, o do vínculo);
- chegada e saída são iguais às do `esperado`.

Com dois ou mais registros: `aguardando_equipe`, motivo `duplicada`, com os ids listados. Com qualquer diferença: `aguardando_equipe`, motivo `marca_em_registro_inesperado`. Nos dois casos, nenhum POST. Exigir `bookingTime >= iniciado_em` da primeira `criar`, com margem, fica **a confirmar** (fuso e formato). Até lá, essa regra não é usada.

`FiltroReservas` (`beds24/tipos.ts`) ganha `quarto`, `chegadaExata`, `pesquisa` e `incluirInfo`.

### 3.6 As três fases e a ordem das travas
**Ordem única** para todo caminho que toca o Beds24 e o imóvel: `beds24:<org>` → imóvel → reserva → cancelamento → alterações. A importação, o envio, os bloqueios e o vínculo já seguem essa ordem (`beds24/trava.ts:10-19, 36-40`; `reservas/bloqueios.ts:66-69`; `canais/ids-externos.ts:53, 94`). Os funis do pagamento nunca tomam a trava do Beds24 (`pagamentos/travas.ts:2-8`).

**Exceção de hoje, corrigida no M8.3a.** `salvarDetalhes` e `salvarDetalhesComLeitura` (`imoveis/detalhes.ts:264-300`, esta última usada pelo portal) travam o imóvel com `FOR UPDATE` (`imovelDaOrg`, :232). Só depois esperam a trava do Beds24 (`esperarEnvioBeds24`, :306), quando a fonte de preços muda. Isso pode dar impasse com a importação ou com as fases do M8.3. A correção:
1. ler a fonte de preços sem trava;
2. se ela pode mudar, pegar `beds24:<org>` antes de travar o imóvel;
3. reconferir.

**Fase 1: transação curta, `lock_timeout` de 15 s.** Só começa se ainda couber o pior caso: 150 s restantes na função.
- `tentarTravaBeds24(tx, org)`. Se a trava estiver ocupada, sai e tenta na próxima volta.
- `escritaBeds24EmAndamento(tx, org)`: junta o envio de calendário `executando` (janela de 10 min, `trava.ts:13, 22-27`) e as operações de reserva `enviando` com `iniciado_em > now() - 6 min` (`JANELA_RESERVA_EM_ANDAMENTO`, com o relógio do banco). Os 6 minutos são o `maxDuration` de 300 s mais uma folga.
- Relê a configuração (pausa e imóvel ligado). Trava o imóvel (`no key update`) e depois a reserva (`no key update`).
- Aplica a régua. Calcula o `esperado` e a assinatura. Lê os ids das alterações `aplicada` sem marca.
- Insere a operação ou a atualiza no lugar (3.3). Marca `enviando`, com `iniciado_em = now()` e `tentativas + 1`. Commit.

**Fase 2: sem transação aberta, prazo próprio de 120 s** (AbortSignal com prazo).
- Conferência antes (seção 4), com a busca pela marca.
- Logo antes do POST: confere a pausa de novo e grava `enviado_em` num UPDATE simples, fora de transação (`where id = ? and situacao = 'enviando'`).
- Um POST por reserva. Não se usa o envio de várias reservas no mesmo POST, que o Beds24 aceita **[C]** (`yaml:411-433`).
- Logo depois da resposta, antes de qualquer trava, outro UPDATE simples grava na operação o `beds24_id` (se legível), a classificação (3.8) e `respondido_em`.
- Releitura por id.
- Se o processo cair antes do POST (`enviado_em` nulo), a volta seguinte devolve a operação a `pendente`, sem busca.

**Fase 3: transação curta.**
- Ordem das travas: `pg_advisory_xact_lock` de `beds24:<org>` com `lock_timeout` de 15 s → imóvel `no key update` → reserva `for update`. O `for update` é preciso porque `beds24_id` é chave única.
- Em `55P03` ou `40P01`, repete 2 ou 3 vezes dentro do tempo restante. O resultado já está gravado na operação.
- **Sempre grava o fato externo:** `reservas.beds24_id`, quando o POST criou a reserva; `lido`; e o resultado da operação.
- **Só as marcas `ota_*` e a situação `conferida`** dependem de a assinatura do SCL não ter mudado desde a fase 1. Se mudou, a fase grava o fato, deixa o acompanhamento `pendente` e põe a próxima operação na fila (cancelar ou atualizar) com `proxima_tentativa_em = agora`.
- `marcarOtaLiberada` e `marcarOtaAtualizada` são chamadas com o `tx` da fase 3, e "já marcada" conta como sucesso (6.3).
- Auditoria com `beds24.reserva.criar`, `.atualizar` ou `.cancelar`, sem contato.

**Operação `enviando` vencida** (mais de 6 min):
- com `beds24_id` gravado na operação: releitura por id (`GET /bookings?id=` **[C]**, `yaml:202-208`), sem depender da marca;
- sem `beds24_id` e com `enviado_em`: vira `incerta`;
- sem `enviado_em`: volta a `pendente`.

**Quem escreve no acompanhamento:** a rotina, os botões, "Conferir agora" e a importação. Todos pegam a trava `beds24:<org>` e recusam se houver operação `enviando` ou `incerta` da reserva.

### 3.7 Pedidos ao Beds24
O formato de `actions` está **a confirmar** (`yaml:3725-3758`).

**Criar [C]** (`POST /bookings`, lista; `roomId`, `arrival` e `departure` são obrigatórios, `yaml:3460-3463`; sucesso = HTTP 201, `yaml:550`):
```json
[{
  "roomId": 123456,
  "arrival": "2026-12-20",
  "departure": "2026-12-27",
  "status": "confirmed",
  "numAdult": 4,
  "numChild": 0,
  "infoItems": [{ "code": "SCL", "text": "SCL-7K2QXM" }],
  "actions": { "checkAvailability": true, "notifyGuest": false, "notifyHost": false }
}]
```
- O nome ou `notes` entram só conforme 3.5.
- `numAdult` = `reservas.hospedes`. O SCL só guarda o total (`db/schema.ts:389`).
- `notifyGuest` e `notifyHost` vão sempre `false`, de forma explícita: o valor padrão não está documentado. O padrão de `allowWebhooks` está **a confirmar**.

**Atualizar [C]** (`yaml:434-441`): `[{ "id": 98765, "arrival": "…", "departure": "…", "numAdult": 4 }]`. Nunca troca o quarto.

**Cancelar [C]** (`yaml:428-431`): `[{ "id": 98765, "status": "cancelled" }]`. Nunca `DELETE`: "Deleted bookings can not be updated" (página Jomres_Plugin:79).

### 3.8 Resposta, erros e incerteza
A resposta é uma lista na ordem do pedido, com `success`, `new`, `modified`, `errors` e `warnings` **[C]** (`yaml:3199-3260`). A chave do id dentro de `new` está **a confirmar** (`yaml:3204-3214`).

| Resultado | Operação |
|---|---|
| HTTP 201, `success: true` e id legível | `feita`, depois releitura |
| `success: true` sem id; `success: false` ou `errors` no item, inclusive mensagem de disponibilidade ou de limite de uso. "Success being false does not necessarily mean that nothing has changed" **[C]** (Cat:209-212). | `incerta`: procura antes de qualquer coisa |
| Tempo esgotado, erro de rede, HTTP 5xx, resposta que não é JSON | `incerta`: procura antes de qualquer coisa. Nunca repete na mesma volta. |
| HTTP 429 com corpo que não é a lista de itens | Volta a `pendente` e interrompe a volta. Não conta como falha. |
| HTTP 403 | `recusada`, motivo `sem_permissao`. Interrompe a volta. Mensagem nova: "a credencial não tem permissão de escrever reservas". A mensagem de hoje fala de inventário (`beds24/http.ts:60`). |
| HTTP 401 repetido depois da renovação (só o refresh token renova, `http.ts:54-59`). **[C]** Também aparece quando falta escopo (`API_V2.wiki:668-670`). | `recusada`, motivo `sem_permissao`, sem busca: o pedido não foi processado. Interrompe a volta. |

A volta usa um único cliente para ler e escrever, para não renovar o token a cada operação. Pedir token também gasta crédito (Cat:570-591).

**Saída da incerteza:**
1. A busca só conclui "não existe" depois de **5 minutos** desde `enviado_em`. O tempo-limite aborta só o nosso lado (`beds24/autenticacao.ts:24`); o servidor do Beds24 pode ainda gravar. A regra vale também para os botões.
2. Achou, pelas regras de adoção (3.5): adota o id e segue para a conferência.
3. Não achou, e a busca funcionou:
   - se a resposta tinha `success: false` ou `errors`: `recusada`. O acompanhamento vai a `aguardando_equipe`, motivo `sem_disponibilidade` (mensagem de disponibilidade) ou `recusada_pelo_beds24` (outra mensagem), com aviso de atenção e e-mail (6.5). **Nunca repete sozinho;**
   - se foi tempo, rede ou 5xx: volta a `pendente` com atraso. Há **no máximo uma** nova tentativa automática por intenção. Na segunda incerteza: `aguardando_equipe`, motivo `incerta`.
4. A busca não funcionou: `buscas_sem_conclusao + 1`. Na terceira: `aguardando_equipe`, motivo `incerta`. A operação continua `incerta` até a equipe decidir.
5. Sem marca legível, mas com POST tentado, e o ocupante bate exatamente (quarto, chegada, saída, origem direta ou API): `aguardando_equipe`, motivo `incerta`, com "Vincular o id NNN" já preenchido. Nunca vira "possível venda dupla".

**Botões da incerteza** (`reserva:editar` + `configuracao:editar`, `BotaoConfirmar`):
- **"Não existe, pode criar":** respeita os 5 minutos.
- **"Já existe, vincular o id ___":** relê o id e aplica as regras de adoção. Se a credencial não lê a marca, aceita quarto, datas e situação iguais com uma segunda confirmação. A frase "a marca não pôde ser lida com esta credencial" fica registrada na operação.

---

## 4. Conferência antes e depois

### 4.1 Antes de criar (fase 2)
1. **Quarto e credencial:** quarto acessível e moeda BRL (`beds24/sincronizacao.ts:47-52`).
2. **Marca:** procura (3.5). Se achar, adota e não cria.
3. **Quem ocupa as noites `[chegada, saida)`:** as reservas do quarto em todas as situações menos `cancelled` e `inquiry` (consulta não ocupa **[C]**, Setting/bookingsstatus), e o calendário do quarto com `livres` e o bloqueio da noite (`fechadaNaLeitura`, `site/disponibilidade.ts:61`). O resultado:
   - **`black`**, bloqueio de fonte beds24 no SCL, ou **blackout** que o M3.7 não marcou como dele em `beds24_calendario_enviado`: `aguardando_equipe`, motivo `bloqueio_manual` (transição, 6.6);
   - blackout do próprio M3.7, ou seja, um bloqueio do SCL sobre a reserva: `aguardando_equipe`, motivo `bloqueio_do_scl`;
   - **outra reserva** (OTA ou direta): `conflito`, motivo `noites_ocupadas`, salvo o caso 5 de 3.8. **Nada é criado.** Aviso de atenção e e-mail: "Possível venda dupla: as noites de dd/mm a dd/mm da reserva SCL-XXXXXX estão ocupadas por outra reserva. O sistema não criou nada. Resolva com o hóspede ou com o canal." O sistema nunca cancela, move nem reembolsa nada sozinho;
   - `livres` desconhecido (nulo) ou menor que 1, sem ocupante: `aguardando_equipe`, motivo `sem_disponibilidade`. **[I]** Pode ser data sem preço (página Introduction:25).
4. **Segunda barreira:** `checkAvailability: true` **[C]** (`yaml:3725-3758`). **A confirmar** se ela considera mínimo de noites e preço.

Sem a marca legível, a proteção contra duplicata é a leitura dos ocupantes junto com o `checkAvailability`. Por isso o ensaio é condição para criar (2.3).

### 4.2 Antes de atualizar
- Confere só as **noites novas** (as que entram e não estavam no Beds24), com a mesma regra. A reserva do próprio SCL não conta como ocupante.
- **[I]** A API não confere disponibilidade na alteração: `checkAvailability` vale só para reserva nova. Por isso a leitura antes é obrigatória.
- Noites novas vendidas no meio por uma OTA viram `conflito`, e nada é enviado. Essa corrida já existe hoje: as noites novas só são conferidas ao preparar a alteração (`pagamentos/alteracao.ts:640`).
- O registro do id precisa ter a marca, situação `confirmed` ou `new` e o quarto guardado. Senão: `divergente`.
- Se a credencial foi trocada desde a criação, relê por id com a credencial nova antes de escrever. Sem acesso: `aguardando_equipe`, motivo `sem_permissao`.

### 4.3 Antes de cancelar
| O que a leitura do id mostra | O que o sistema faz |
|---|---|
| Registro `confirmed` ou `new`, no quarto guardado, com a marca | Cancela |
| Registro já `cancelled` | Só confere e marca |
| Registro não encontrado (apagado) | `divergente`, motivo `apagada_no_beds24`. Não marca: a equipe confere se as datas estão abertas. |
| `black` ou outro quarto | `divergente` |

**Duplicadas:** cancela também toda outra reserva com a mesma marca, `confirmed` ou `new`, no quarto guardado. Qualquer outra coisa vira aviso.

### 4.4 Depois de cada escrita
- Relê por id e compara quarto, entrada, saída, pessoas, situação (`confirmada` ou `cancelada`) e marca:
  - tudo igual: `conferida`, e as marcas de 6.3;
  - algo diferente: `divergente`, com aviso.
- Reserva nossa relida **sem a marca:** `divergente`, e o motivo de configuração `marca_ilegivel` para as criações novas.
- **Overbooking:** `livres < 0` na releitura do calendário vira aviso de atenção e e-mail **[C]** (`numAvail` "may be negative… if a room is overbooked", `yaml:5872`).
- **Antes de gravar `ota_liberada_em`:** a leitura confirma que não sobrou `black` nem blackout que não seja do SCL sobre as noites.
- A conferência mostra o que o Beds24 gravou, não o que a OTA mostra. **[C]** O envio às OTAs leva em média menos de 1 minuto (Channel_Manager_Capabilities:38, 46), com a ressalva de "within 24 hours if nothing else changes" (Cat:751-753).

### 4.5 Conferência contínua (não depende da importação)
- **A cada volta**, se houver acompanhamento `conferida` com saída a partir de hoje: um `GET /bookings` com `modifiedFrom` igual à última leitura menos 15 min. O leitor já aceita esse filtro (`beds24/http.ts:91-110`), e a criação também grava a hora de modificação **[C]** (`yaml:277-281`). A busca usa as propriedades dos acompanhamentos, todas as situações e `includeInfoItems=true`, e pega mudança e cancelamento feitos por fora.
- **De hora em hora:** releitura por id, em lotes de 50 (padrão de `sincronizacao.ts:67-69`), de todas as reservas `conferida` com saída a partir de hoje. Pega reserva apagada, que **[I]** não aparece em `modifiedFrom`.
- **A importação diária**, quando ligada, também confere (5.2), sem custo extra. Hoje ela está desligada em produção (2.4).
- O custo entra no limite de créditos (seção 9).

---

## 5. Importação: reconhecer a reserva do site sem duplicar nem sobrescrever

### O problema de hoje (conferido no código)
Com `reservas.beds24_id` gravado, `sincronizarReserva` acha a reserva do site pelo id (`reservas/repositorio.ts:129-136`) e sobrescreve (`:188-218`):
- a origem: `site` vira `direta` ou `outro`;
- a situação, as datas e as pessoas;
- a taxa, o valor líquido, o contato e a data da reserva;
- e roda o motor de novo.

O ramo `black` cancela a reserva paga sem a política (`beds24/sincronizacao.ts:116-131`). Sem o id gravado, a importação cria uma **segunda** reserva, sem conferir sobreposição (`repositorio.ts:171-184`).

### 5.1 Trava "em andamento"
- A importação (`sincronizacao.ts:40`) e o envio de calendário (`calendario/envio.ts:272`) passam a chamar `escritaBeds24EmAndamento` no lugar de `envioEmAndamento`.
- As mensagens de "ocupada" dizem a causa, por exemplo "envio de reserva do site ao Beds24 em andamento". Hoje elas falam só de calendário (`sincronizacao.ts:39-40`, `trava.ts:29`).
- `esperarEnvioBeds24` (bloqueios, vínculo, fonte de preços) também respeita as operações de reserva. A mensagem que chega ao proprietário pelo bloqueio de uso próprio (`reservas/bloqueios.ts:39`) continua sem a palavra "Beds24".

### 5.2 Desvio em `aplicarRegistro`
O desvio fica no laço da importação (`sincronizacao.ts:78-83`), **antes** da conferência de vínculo (:80-81) e antes do ramo de bloqueio. Ele trata os casos nesta ordem:
- **a. Registro com a marca de ensaio:** pula, com o aviso "ensaio do SCL". Nunca cria.
- **b. Reserva do site com `reservas.beds24_id = b.idExterno`, ou operação com esse `beds24_id`:** chama `conferirNaImportacao`. **Nunca chama `sincronizarReserva`.**
  - Ela compara com o `esperado` e atualiza `lido` e `lido_em`.
  - Só grava `conferida_em` se não houver operação ativa e a assinatura do SCL for a do `esperado`.
  - Uma diferença vira `divergente`, com aviso no resultado da importação.
  - Origem, valores, taxa, valor líquido, hóspede, e-mail, situação, `confirmadaEm`, `reservadaEm` e o motor ficam intactos.
  - Vale mesmo se o vínculo do imóvel mudou depois da criação.
- **c. `b.referenciaScl` casa com uma reserva do site em acompanhamento, sem `beds24_id`, pelas regras de adoção (3.5):** chama `adotarReservaCriada(tx, …)`, a mesma função do trabalhador.
- **d. Tem `referenciaScl` sem correspondência:** aviso "registro marcado pelo SCL sem reserva correspondente". Com duas ou mais: aviso "reserva duplicada no Beds24 para SCL-XXXXXX". Nada é criado.
- **e. Sem marca legível, mesmo quarto, noites sobrepostas a uma reserva do site com criação não resolvida:** pula, com o aviso "aguardando a conferência de um envio de reserva". Nunca cria. "Não resolvida" quer dizer uma destas situações:
  - operação `criar` em `enviando`, de qualquer idade;
  - operação `incerta`;
  - `enviado_em` preenchido sem `beds24_id`;
  - acompanhamento `aguardando_equipe` com motivo `incerta`.

  Já com a trava, a importação pode passar uma `enviando` vencida para `incerta`.

**Registro da implementação (M8.3a, 16/10/2026).** Estes pontos do desvio e da conferência ficaram mais estreitos do que o texto acima (as linhas marcadas "revisão interna" vieram da revisão do próprio M8.3a, no mesmo dia). O objetivo final é o mesmo: a importação nunca cria nem sobrescreve a reserva do site e nunca esconde uma reserva de OTA por mais tempo que o necessário.

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| `black` com o código | c, d e e valiam para qualquer registro: um `black` com `SCL-XXXXXX` não seria importado. | Um `black` com o código, ou sobre uma criação não resolvida, segue o caminho dos bloqueios. A regra b continua antes de tudo: um `black` no id de uma reserva do site vira `divergente` e nunca cancela nada. | O M8.3 nunca cria um `black`. Um bloqueio com o código no nome é a equipe fechando as datas à mão (6.2 e 6.6), e a importação precisa vê-lo para fechar a pendência quando ele for cancelado. |
| e, registro já conhecido | Pulava qualquer registro sem marca sobreposto. | Pula só o registro que a importação criaria. O que o SCL já conhece (reserva ou bloqueio importado antes) segue e é atualizado. | Atualizar um registro conhecido não cria duplicata. Pular escondia, enquanto a criação não se resolvesse, por exemplo o cancelamento de uma reserva de OTA. |
| c e d, registro já conhecido (revisão interna, 16/10) | c e d valiam para todo registro com a marca que não fosse `black`, inclusive o que o SCL já conhecia. O `black` com o código cancelado no Beds24 (texto 6.2) voltava `cancelled`, caía em c ou d e nunca saía do SCL; a cópia de uma reserva de OTA que ganhou um código na nota e foi cancelada continuava confirmada. | O registro que o SCL já conhece segue o caminho normal sem aviso, como em e: a reserva importada (atualiza ou cancela a cópia) e o bloqueio importado que volta como bloqueio ou cancelado (o cancelado sai do SCL, com a remoção no histórico). Fica em c e d só o bloqueio importado que volta como reserva com a marca. A adoção conta os mesmos registros de antes (as regras de 3.5 seguem iguais às do trabalhador). | Não esconder o cancelamento de um bloqueio feito à mão nem o de uma reserva de OTA. O registro conhecido não é o que o M8.3 criou: esse está em b ou ainda é desconhecido. O bloqueio que vira reserva com a marca duplicaria no financeiro a reserva do site daquelas datas; ele continua virando aviso. |
| b, quando vira `divergente` | "Uma diferença vira `divergente`." | Vira `divergente` só quando o Beds24 deveria estar igual: acompanhamento `conferida` ou já `divergente`, sem operação ativa, e o Beds24 diferente também do que o SCL quer agora (revisão interna, 16/10). Nos outros casos (envio a fazer ou em curso, equipe decidindo, `manual`, `encerrada`, ou o SCL mudou depois do `esperado` e o Beds24 já está como o SCL quer), só a leitura é gravada. | Com uma intenção nova ainda não enviada, o Beds24 está diferente do `esperado` por definição. Marcar `mudada_no_beds24` nesse caso seria um alarme falso, inclusive quando a operação ainda não nasceu (chave desligada, pausa, antes da próxima volta) e a equipe seguiu o texto 6.2. Se o Beds24 difere também do que o SCL quer agora (cancelado, apagado ou outras datas), a mudança veio de fora e o alarme continua. |
| b, registro ilegível (revisão interna, 16/10) | O id ligado que não entrava na leitura era conferido como apagado, também quando ele voltava em formato inválido. | O id que volta em formato inválido (na leitura ou na releitura por id) não é conferido: nada muda no acompanhamento, e a importação avisa que a conferência não concluiu. `apagada_no_beds24` fica só para o registro não encontrado (4.3). | Avisar em vez de supor: o registro existe. Tratá-lo como apagado limpava a marca das datas fechadas e deixava um `divergente` errado gravado. |
| b, registro ilegível sem id (revisão do Codex, 16/10) | Na releitura por id, um registro em formato inválido cujo id não dava para ler (ou não era um dos pedidos) era ignorado; os ids pedidos que não voltaram legíveis eram conferidos como apagados. | Um registro ilegível sem um id pedido deixa o lote inteiro sem conclusão: nenhum id dele que não voltou legível é conferido como apagado, e a importação dá um aviso só, além do aviso de cada reserva do site ligada. | O registro ilegível pode ser qualquer um dos ids pedidos. Contar a ausência como apagado fazia uma reserva do site ligada virar `apagada_no_beds24` e perder a marca das datas fechadas, com o registro lá. |

Na importação, a conferência grava o fato (`lido`, `conferida_em`, `divergente` com o motivo, `ota_fechada_em` vazio quando a divergência é de datas, situação ou quarto). A adoção grava `reservas.beds24_id` e passa a operação de criação a `feita`. A situação `conferida` e as marcas das OTAs (6.3) ficam com o trabalhador do M8.3c.

### 5.3 Proteção em `sincronizarReserva`
`reservas/repositorio.ts`: se a fonte for `beds24` ou `csv` e a reserva encontrada tiver `fonte = 'site'`, a função devolve `{ ok: false, erros: { geral: "Reserva do site: os dados vêm do SCL; a diferença no Beds24 vira aviso." } }`. É a regra "fonte externa nunca muda reserva do site", num lugar só. Cobre também o ramo `black` (`sincronizacao.ts:121-122`). O M12.2 estende a regra.

### 5.4 Ids conhecidos e info items
- As reservas com `beds24_id` já entram em `conhecidos` e são relidas por id a cada importação (`sincronizacao.ts:61-64`: `fonte = 'beds24'` ou `beds24_id` não nulo). Não há mudança. Elas contam no limite de 2.000 (`:65`).
- As leituras da importação passam a pedir `includeInfoItems=true` (custo **a confirmar**).

### Se alguém mudar ou cancelar no Beds24 uma reserva do site
O SCL **nunca segue sozinho.** O que acontece:
- `divergente`, com motivo `mudada_no_beds24`, `cancelada_no_beds24` ou `apagada_no_beds24`;
- `ota_fechada_em` volta a vazio se a divergência for de datas, situação ou quarto;
- aviso de atenção e e-mail (6.5). Exemplo: "A reserva SCL-XXXXXX (paga pelo site) foi cancelada no Beds24, mas continua confirmada no SCL: as datas podem estar abertas nas OTAs. No Beds24, volte-a para Confirmado ou cancele pelo SCL, pela política." Para datas mudadas: "No Beds24 está de dd/mm a dd/mm; no SCL, de dd/mm a dd/mm."
- botão "Reenviar o que está no SCL" (`reserva:editar`, `BotaoConfirmar`), para datas e pessoas. É uma atualização normal, com a conferência antes. Para a reserva cancelada no Beds24, a reativação fica no M8.3d.

---

## 6. Tarefas das OTAs: avisos, textos, marcas e transição

### 6.1 Uma função para os três avisos
`tarefasDasOtas(db, org, agora)`, em `beds24/reservas-site-tarefas.ts`, é a única fonte:
- dos três avisos do Início: paga, cancelada e alterada;
- do bloco da ficha;
- da carência e dos textos.

Ela segue a régua da seção 2 e os mesmos cortes de data de hoje: paga e cancelada com `checkout > hoje`; alterada com `greatest(checkoutAntes, checkoutDepois) >= hoje` (`painel/dashboard.ts:369-394`).

**Quem vê:** quem tem `reserva:editar`. O aviso da paga sai de `avisosDePagamento` (`pagamentos/consultas.ts:1706-1713`, `:1798`), que hoje só quem tem `financeiro:ler` vê (`app/painel/page.tsx:37-51`; `painel/dashboard.ts:140-142`). O papel `operacao` tem `reserva:editar` sem `financeiro:ler` (`acesso/politica.ts:44-57`). O aviso não tem valores.

| Situação da reserva | O que o Início mostra |
|---|---|
| Sem acompanhamento; chave, pausa ou imóvel desligado; motivo de configuração; `manual` | O texto manual por reserva (6.2), até a marca |
| `pendente` ou `em_envio` há menos de 30 min desde a intenção | Informativo "N reserva(s) do site sendo enviadas pelo sistema: não feche à mão" |
| `pendente` ou `em_envio` há mais de 30 min | Linha de atenção "atrasadas" (6.5); a ficha oferece "Deixar à mão" |
| `conferida` | Nada: a marca foi gravada |
| `conflito`, `divergente`, `aguardando_equipe` (fora de configuração) | Só no aviso de atenção, com a instrução da ficha. Nunca "feche como bloqueio" sobre noites já ocupadas. |

Com isso, o aviso manual nunca aparece ao mesmo tempo que uma instrução contrária para a mesma reserva.

### 6.2 Textos por reserva
O texto depende de `reservas.beds24_id` e do acompanhamento, não da chave:
| Caso | Texto |
|---|---|
| Reserva criada pelo M8.3, cancelamento não enviado | "No Beds24, mude a reserva SCL-XXXXXX para Cancelado (não apague)." |
| Reserva criada pelo M8.3, alteração não enviada | "No Beds24, mude as datas da reserva SCL-XXXXXX para dd/mm a dd/mm." |
| Paga sem reserva no Beds24 | "Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs." |
| Fechada à mão como bloqueio, cancelada | "Mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague)." |
| Fechada à mão como bloqueio, alterada | "Mude as datas do bloqueio para dd/mm a dd/mm (não apague nem crie outro)." |

**Por que "não apague".** Um bloqueio apagado no Beds24 nunca sai do SCL: a ausência só gera o aviso "o registro anterior foi preservado" (`sincronizacao.ts:59-60`, `:71`). Só o que volta como `cancelled` sai (`:135-138`). Hoje, quem segue o texto "apague o bloqueio" deixa as noites fechadas no site para sempre. E uma reserva apagada não pode ser atualizada (Jomres_Plugin:79). **Esta correção vale já, com ou sem o envio ligado.**

A frase "o sistema faz isso sozinho; este aviso fica quando ele não consegue" só aparece com a chave pronta, o imóvel ligado e uma situação automática.

**Textos a revisar:**
- `pagamentos/consultas.ts:1798`, `:1857`;
- `painel/dashboard.ts:392`;
- `pagamentos/cancelamento.ts:784`, `:1332`;
- `pagamentos/alteracao.ts:813`, `:911`;
- `components/reservas/CancelamentoSite.tsx:318-320`;
- `components/reservas/AlteracaoSite.tsx:193`;
- `GUIA-DIEGO.md:722`, `:824`, `:1002-1005`, `:3462` (números do commit `adca993`; o guia cresce a cada PR, então valem os trechos abaixo, procurados pelo texto):
  - seção 2, "Alteração de reserva paga pelo site, em teste — M8.2d", item **OTAs** ("o Início avisa "mude o bloqueio nas OTAs (no Beds24, feche as novas datas e reabra as antigas)"");
  - seção 2, "Cancelamento de reserva paga pelo site, em teste — M8.2c", item **OTAs** ("reabra as datas nas OTAs (no Beds24, apague o bloqueio)");
  - seção 2, "Pagamento pelo site, em teste — M8.2a", item **A reserva confirma sozinha** ("Até o M8.3, o Início avisa "reserva do site paga: feche as datas nas OTAs"");
  - seção 6, item 44, passo 9, **OTAs, mensagens e página do hóspede** ("veja no Início "mude o bloqueio nas OTAs"");
- `requisitos/product/PAGAMENTO-SITE.md:1234`, `:1720`, `:3656`, com a versão anterior registrada.

### 6.3 Marcas gravadas pelo sistema
| Aviso | Marca | Quando o M8.3 grava |
|---|---|---|
| Paga | `beds24_reservas_site.ota_fechada_em` (`por` nulo) | Quando a criação foi conferida |
| Cancelada | `cancelamentos_reserva.ota_liberada_em/por` (`db/schema.ts:1784-1786`) | Quando o cancelamento foi conferido para uma reserva criada pelo M8.3, sem `black` nem blackout de fora sobrando sobre as noites. Chama `marcarOtaLiberada(tx, org, reservaId, null)` (`pagamentos/cancelamento.ts:1166-1183`). Cobre também "Cancelar a reserva contestada" e o não comparecimento (D4). |
| Alterada | `alteracoes_reserva.ota_atualizada_em/por` (`schema.ts:1923-1925`) | Quando a operação (criação ou atualização) foi conferida. Chama `marcarOtaAtualizada(tx, org, alteracaoId, null)` (`pagamentos/alteracao.ts:1501-1515`) exatamente para os ids guardados em `operacoes.alteracoes` na fase 1, inclusive a alteração só de pessoas. |

Duas regras de gravação:
- As marcas da alteração nunca são gravadas por horário. `aplicada_em` recebe o `agora` de quem chama (`alteracao.ts:1090`), e esse valor é calculado antes da releitura e das travas (`:1204-1214`).
- As duas funções devolvem `ok:false` quando a marca já existe. A fase 3 trata isso como sucesso.

**Reserva cancelada antes de ser criada** (`criar` virou `superada`): com a chave pronta, a rotina lê o Beds24 (busca da marca e ocupantes, 4.1).
- Não há bloqueio nem marca: `marcarOtaLiberada` com `por` nulo.
- Há bloqueio: o texto diz o que foi achado, por exemplo "há um bloqueio de dd/mm a dd/mm: mude para Cancelado".

### 6.4 Marca manual "Datas fechadas nas OTAs" (D8)
- Botão na ficha (`reserva:editar`, `BotaoConfirmar`, auditado), para a reserva paga sem criação pelo M8.3 e para o caso da D3.
- Grava `ota_fechada_em/por` com o usuário e põe o acompanhamento em `manual`.
- É o sinal de que a equipe fechou à mão: o M8.3 nunca cria por cima (6.6).
- Segue a decisão de 10/10, "o aviso aparece sempre, até a marca da equipe (ou do M8.3)" (`requisitos/product/PAGAMENTO-SITE.md:1731-1741`).

### 6.5 Aviso de atenção e e-mail
`avisosDeReservasNoBeds24`, para quem tem `reserva:editar`, entra em `carregarDashboard` (`painel/dashboard.ts:133-151`) com linhas separadas, nesta ordem:
1. conflito (venda dupla), por código, primeiro;
2. divergência;
3. falhas, incerteza, recusa e atrasadas;
4. transição (informativo).

Problemas de configuração viram uma linha só, "envio de reservas parado: <motivo>", com link para Integrações. Os links levam a `/painel/reservas?beds24=atencao`.

**E-mail à equipe** por `avisarEquipePorEmail` (`email/aviso-equipe.ts:13`) nestes casos:
- conflito;
- divergência por reserva apagada, mudada ou cancelada no Beds24;
- overbooking;
- `recusada`;
- `falhas`;
- `marca_ilegivel`.

A chave é `beds24-reserva:<reservaId>:<motivo>:<assinatura>`. O texto leva só o código SCL, o imóvel e as datas, nunca dados do hóspede.

### 6.6 Transição: reservas cujas datas a equipe fechou à mão
- **Confirmadas antes de o imóvel ser ligado:** nascem `manual`, motivo `anterior_a_ligar`, com os avisos e botões de hoje e sem aviso de atenção. A ficha oferece "Passar ao sistema" (`configuracao:editar`, `BotaoConfirmar`) só quando a leitura não mostra bloqueio sobre as noites.
- **Depois de ligado** (chave desligada por um tempo, ou pausa): o bloqueio manual detectado (4.1) leva a `aguardando_equipe`, motivo `bloqueio_manual`, como linha informativa. **O sistema não cria por cima e não apaga o bloqueio.** A ficha oferece:
  1. **"Deixar à mão":** vira `manual`, e os avisos e botões de hoje continuam;
  2. **"Assumir no Beds24"** (M8.3d, depois do suporte). Só aparece se as datas do bloqueio couberem dentro das da reserva; senão: "encurte o bloqueio para dd/mm a dd/mm". Os passos:
     1. relê e exige que o **único** ocupante seja aquele bloqueio;
     2. cria a reserva com a marca por cima, sem `checkAvailability`;
     3. confere;
     4. mostra "mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague)";
     5. a importação ou a conferência seguinte vê o bloqueio cancelado e fecha a pendência.

     **A confirmar:** se o Beds24 aceita reserva sobre `black` e o efeito de `overbookingProtection` **[C]** (`yaml:5119`; Setting/roomsoverbooking).
- **Se o Beds24 não aceitar:** a equipe muda o bloqueio para Cancelado e clica "Criar agora". O sistema confere de novo; se uma OTA vendeu no meio, vira `conflito`. Essa alternativa abre uma janela de minutos e não é o padrão (D5).
- `bloqueiosSemAReserva` (`calendario/envio.ts:108-122`) continua valendo para essas reservas.

---

## 7. Dados enviados ao Beds24 e o token

**Proposta (padrão D1/D2): nenhum dado pessoal e nenhum valor.**
| Enviado | Por quê |
|---|---|
| `roomId`, `arrival`, `departure`, `status` | Fecha e reabre as datas nas OTAs **[C]** ("POST /bookings… will close availability for those dates at all other booking sources", guia das OTAs:75-76) |
| `numAdult` = total, `numChild: 0` | Ocupação coerente. O SCL só guarda o total. |
| Info item `SCL` com o código; nome ou `notes` conforme 3.5 | A marca. O código é público e não é dado pessoal. |

**Não enviado:**
- nome real, e-mail, telefone, endereço, país, CPF, documento, dados de pagamento;
- `price`, `deposit`, `invoiceItems`, `commission`.

**Por quê:**
- **Minimização.** A Privacidade promete "só o necessário" (`configuracoes/paginas-legais-rascunho.ts` l.21), e "Dados fora do Brasil" não lista o sistema de reservas. **[I]** Sem dado pessoal, a política não precisa de versão nova.
- **Sem e-mail do hóspede no Beds24**, as Auto Actions não escrevem ao hóspede. As de origem "Direct" ou "All" valem para reservas da API **[C]** (Auto_Actions:117). Isso preserva o M5.9.
- **O financeiro é do SCL.** **[C]** O Beds24 não calcula preço de reserva criada pela API (Cat:717-719). **A confirmar** se ele grava 0. A importação não lê o valor da reserva do site (5.2).

**Escopos do token novo (D10).** O convite novo deve pedir exatamente estes sete (`ESCOPOS_OBRIGATORIOS_BEDS24`, em `beds24/reservas-site-regras.ts`):
- leitura e escrita em `bookings`: a escrita cria, muda e cancela; a leitura serve à importação e às releituras da conferência e da busca (3.6), que passam a usar esta credencial (`beds24/http.ts:182-184`);
- leitura em `bookings-personal`: a importação lê nome e e-mail (`normalizar.ts:92-94`). **[S]** O token atual tem essa leitura;
- leitura em `bookings-financial`, também para a importação;
- leitura em `properties`;
- leitura e escrita em `inventory`: a escrita para o envio do M3.7, a leitura para a releitura do calendário dele.

As duas leituras ao lado das escritas vêm explícitas. **[I]** Não está confirmado que a escrita dá a leitura: a documentação trata cada método como um escopo à parte (`API_V2.wiki:138`), e o exemplo da resposta lista `read:bookings` como item próprio (`yaml:3155-3197`). Pergunta ao suporte na seção 12, item 7.

E nunca:
- escrita nem `all` em `bookings-personal`, que dariam `POST /bookings/messages` (`API_V2.wiki:98-104`);
- `all` nem o método de apagar (`all:bookings` apaga, `API_V2.wiki:140`; apagar o item principal exige DELETE, `:157`);
- nenhum outro escopo, de leitura ou de escrita, fora dos sete.

**Conferência dos escopos.** A prontidão lê `GET /authentication/details` **[C]** (`yaml:3155-3197`) sob demanda e uma vez por dia na rotina, e compara com a lista exata acima:
- **a mais** (`escopo_excessivo`): qualquer escopo fora dos sete, o que inclui DELETE, `all`, escrita pessoal e qualquer outra leitura ou escrita. Nada é escrito, e Integrações mostra os escopos a mais;
- **faltando** (`incompleto`): falta qualquer um dos sete, a escrita de reservas inclusive. Conta como fora de ordem, e Integrações mostra o que falta;
- **não deu para ler** (`ilegivel`): a resposta não veio no formato conhecido, ou trouxe algum item fora dele. Também fora de ordem. Nesse caso a tela não diz o que falta, porque o que parece faltar pode estar lá num formato desconhecido; ela mostra os itens fora do formato;
- **em ordem**: os sete e nada além.

O motivo de configuração sai de um lugar só, `motivoDosEscoposBeds24`: a mais é `escopo_excessivo`; faltando ou não deu para ler é `escopo_fora_de_ordem` (2.4 e 3.2).

**A confirmar** o formato dos escopos na resposta. Se o suporte disser que a escrita em `bookings-personal` é indispensável, a regra passa por Diego.

*Mudanças de 16/10 (revisões do PR do M8.3a).*
- **Primeira, pela revisão do Codex.**
  - Antes, a conferência só barrava DELETE, `all` e escrita pessoal e só exigia a escrita de reservas. Uma credencial sem a leitura de dados pessoais ou de imóveis, ou sem a escrita de calendário, aparecia "em ordem", e também uma com outra escrita qualquer.
  - Depois, passou a exigir os cinco do convite e a barrar o que estivesse fora da lista, tolerando `read:bookings` e `read:inventory` "porque a escrita já dá essa leitura".
  - A situação `sem_escrita` deixou de existir: a falta da escrita de reservas aparece como `incompleto`, com `write:bookings` na lista do que falta.
- **Segunda, pela revisão interna.** A tolerância se apoiava numa suposição sem fonte.
  - Agora o convite pede as duas leituras explícitas, e a lista exata passa a ter sete escopos, sem exceção.
  - Com a resposta ilegível, a tela não diz mais o que falta.
  - A prontidão ganhou o motivo `escopo_fora_de_ordem`, para a falta e para a leitura ilegível. Antes, essas duas situações não tinham motivo na tabela 2.4.
- **Motivo das duas:** a lista do convite é exata (D10), e a prontidão só pode dizer "em ordem" para a credencial que o desenho pede, sem supor o que não foi conferido.
- **Objetivo:** nenhuma escrita de reservas com credencial diferente da combinada.

**A troca do token afeta tudo.**
- O refresh token tem prioridade também na importação e no envio (`beds24/http.ts:166-170`).
- Os escopos não mudam depois do convite (Cat:553-556).
- O portal só aceita veredito feito com a credencial atual (`portal/marketplace.ts:170-181`).

Passo a passo depois da troca: "Sincronizar agora", depois um envio de calendário (se estiver em uso), depois a prontidão, depois um ensaio novo.

**Só em Production.** O token novo vai só no ambiente Production da Vercel; a Preview fica só com a `BEDS24_API_KEY` de leitura. A escrita de calendário não tem trava de ambiente (`beds24/http.ts:223-227`; `calendario/acoes.ts:93`). `GUIA-DIEGO.md:2813-2814` manda pôr as variáveis do Beds24 na Preview para testar um PR; o PR corrige para "só a de leitura".

---

## 8. Painel

### Ficha da reserva
Em `app/painel/reservas/[id]/page.tsx`, só para reservas do site e só para a equipe. O componente novo `components/reservas/ReservaNoBeds24.tsx` mostra:
- a situação e o motivo, em linguagem simples;
- o id no Beds24, o quarto, a última conferência e o que foi lido;
- o histórico curto das operações.

O domínio devolve só códigos; os rótulos ficam no componente. O M12.2 cria os rótulos do portal sem citar o Beds24 ("nosso sistema", "os canais"), como já faz `portal/marketplace.ts:53-67`.

| Botão | Permissão | Regra |
|---|---|---|
| Conferir agora | `reserva:editar` | Só lê; respeita a trava |
| Tentar de novo | `reserva:editar` | Não zera `buscas_sem_conclusao`; respeita os 5 min |
| Simular | `reserva:editar` | Fora da produção ou com a chave desligada; sem rede |
| Deixar à mão; Datas fechadas nas OTAs; Reenviar o que está no SCL | `reserva:editar` | `BotaoConfirmar` |
| Não existe, pode criar; Vincular o id; Passar ao sistema; Assumir no Beds24 (M8.3d) | `reserva:editar` + `configuracao:editar` (hoje, só o admin) | `BotaoConfirmar`; teste de recusa para o papel `operacao` |

As ações do servidor ficam em `beds24/acoes-reservas.ts`, com deny-by-default.

### Configurações → Integrações
Em `app/painel/configuracoes/integracoes/page.tsx` (`configuracao:editar`):
- o texto de `ONDE.Beds24` (l.22) ganha a chave nova, os escopos de 7 e "só em Production".
- Seção nova "Reservas do site no Beds24":
  - a chave (ligada ou não, e como ligar) e o ambiente (só o deploy de produção);
  - a credencial (refresh token sim ou não; último 403 ou 401 de reservas);
  - a **prontidão**, só leitura e com `BotaoConfirmar`:
    - os escopos lidos;
    - o último ensaio com a credencial atual;
    - a marca legível;
    - a importação automática ligada ou não. Ela não é requisito, porque o M8.3 tem a conferência própria (4.5), mas a tela mostra que hoje ela está desligada;
  - a **pausa geral**;
  - os **imóveis ligados** (D6), com a data, só depois de um ensaio;
  - o **ensaio**: só o admin, `BotaoConfirmar`, atrás das mesmas travas da seção 2. Diego escolhe o imóvel e a data. O ensaio:
    1. cria uma reserva com a marca `SCL-ENSAIO`, sem reserva no SCL e sem financeiro;
    2. relê por id;
    3. procura pelo quarto e pelas datas, o que prova a marca e os escopos;
    4. cancela;
    5. relê de novo.

    O registro fica em `beds24_reservas_operacoes`, `tipo = ensaio`;
  - os contadores por situação, com link para a lista filtrada.

**Registro da implementação (M8.3a, 16/10/2026).** A conferência de completude do M8.3a achou dois pontos desta lista que ficaram de fora. Os dois passam ao M8.3c (seção 13). O objetivo final não muda: Integrações mostra a recusa da credencial e leva às reservas que pedem atenção.

| | Antes (o texto acima) | Agora (o M8.3a) | Motivo e onde entra |
|---|---|---|---|
| Último 403 ou 401 de reservas | A linha da credencial mostrava também o último 403 ou 401 de reservas. | A linha diz só se há refresh token, só o token direto (`BEDS24_API_KEY`, que só lê) ou nenhuma credencial. | No M8.3a não há escrita, então não há 403 nem 401 de reservas para mostrar. O M8.3c grava a recusa (3.8, motivo `sem_permissao`) e a mostra aqui. |
| Contadores por situação | Cada contador levava à lista de reservas filtrada. | "Reservas acompanhadas" mostra só os números por situação, sem link. | O filtro `beds24=atencao` da lista de reservas ainda não existe. O M8.3c cria o filtro junto com o aviso de atenção (6.5), que usa o mesmo link, e liga os contadores a ele. |

### Sistema
- **Serviços** (`sistema/servicos.ts:86-95`) mostra as duas chaves usando as funções, e não `env.BEDS24_ESCRITA` direto (l.92). Mostra também o aviso "credencial de escrita presente fora da produção".
- **Automações** (`sistema/automacoes.ts:18-35`) ganha uma linha nova: `{ id: "reservas-beds24", nome: "Reservas pagas do site no Beds24 (criar, atualizar, cancelar e conferir)", quando: "A cada 10 minutos, fora das janelas da importação e do envio diários, só no deploy de produção; escreve só com BEDS24_ESCRITA_RESERVAS=ligada e a configuração pronta; também na ficha", situacao: "ativa", item: "M8.3" }`.

  **Registro da implementação (M8.3a, 16/10/2026).** Antes: a linha entrava como `situacao: "ativa", item: "M8.3"`. Agora, no M8.3a: `situacao: "planejada", item: "M8.3c"`, com o mesmo `nome` e `quando`; o teste em `sistema/sistema.test.ts` fixa esses valores. Ela passa a `"ativa"` (e o teste muda junto) quando o M8.3c entregar a rota e o horário da seção 9. Motivo: no M8.3a não há rota nem cron, e "ativa" marcaria intenção como entrega. Até lá, "Simular" na ficha faz o papel da rotina, sem rede.
- **Rotinas diárias:** a importação e o envio que terminam "ocupada" passam a ser registrados como "não rodou: <causa>" (`beds24/cron.ts:16`, `beds24/cron-envio.ts:21`), e não como sucesso.

### Lista de reservas e lados de fora do painel
- **Lista de reservas:** filtro `beds24=atencao`. Entra no M8.3c (registro na parte de Integrações, acima).
- **Hóspede e proprietário:** nada muda. Nenhum texto do site, de Minha reserva, dos e-mails ou do portal cita o Beds24. Os testes atuais garantem isso (`app/hospede/page.test.tsx:166, 185`; `app/reservar/[codigo]/page.test.tsx:374, 441, 468`). O componente novo só é importado no painel.

---

## 9. Rotina

- **Rota nova** `app/api/cron/beds24-reservas/route.ts`:
  - recusa sem `CRON_SECRET`;
  - responde 403 sempre que `deployDeProducao` for falso, inclusive sem `VERCEL_ENV`. É diferente de `beds24-envio/route.ts:11`, que deixa passar sem `VERCEL_ENV`;
  - `maxDuration = 300`.
- **Horário:** `2,12,22,32,42,52 * * * *` em `app/vercel.json`. Não coincide com `*/10` (`cotacoes`), `15 9` (importação) nem `0 10` (envio).
- **Janelas sem operação nova:** de 9:05 a 9:30 UTC e de 9:50 a 10:15 UTC. São constantes ao lado do comentário dos horários; uma volta nessas janelas não faz nada. Com a janela de 6 min (3.6), uma operação iniciada às 9:04 deixa de contar como "em andamento" antes das 9:15. A importação e o envio diários nunca encontram "ocupada" por causa do M8.3.
- **Execução:** `executarCronReservasBeds24(db, env)` em `beds24/cron-reservas.ts`, dentro de `registrarExecucao(db, "reservas-beds24", …)`, com resumo só de números.
- **Ordem de cada volta:**
  0. chave desligada ou pausa: só resolve operações em curso com leitura e sai;
  1. resolve as operações `incerta` e as `enviando` vencidas;
  2. cancelamentos (reabrem datas: baixo risco);
  3. atualizações;
  4. criações;
  5. conferência contínua (4.5).
- **Limites:**
  - até 10 operações por volta;
  - para no primeiro 429, 401 ou 403;
  - para quando o crédito restante cair abaixo de 20. Os nomes dos cabeçalhos estão **a confirmar**: a wiki diz `x-five-min-limit-remaining`, a especificação diz `X-FiveMinCreditLimit-Remaining` (`yaml:8305-8325`);
  - uma operação só começa com 150 s restantes;
  - limite interno de 240 s;
  - um único cliente por volta.

  **[C]** São 100 créditos a cada 5 minutos por conta, divididos com a importação e o envio (Cat:570-591).
- **Atraso entre tentativas:** 10, 20, 40, 80 e 160 min, para falhas antes do POST (por exemplo, leitura falhou). Na 5ª falha: `aguardando_equipe`, motivo `falhas`, com aviso e e-mail. Conflito, divergência, recusa e incerteza não contam como falha: eles param e avisam na hora (3.8).
- **Fim do acompanhamento:** depois da saída do hóspede, ou do cancelamento conferido, vira `encerrada`.
- **Prévias:** o cron não roda. O botão "Simular" faz o papel dele.

---

## 10. Testes (Vitest + PGlite + versão falsa; sem rede nem credencial)

**Versão falsa** (`beds24/falso.ts`):
- novo `gravarReservas`, que cria, altera e cancela e registra método e corpo;
- reservas que ocupam unidades no calendário (hoje as duas coisas são independentes no falso);
- `checkAvailability` simulado;
- info items e a leitura com `includeInfoItems`;
- `/authentication/details`;
- opções `perderRespostaReserva`, `respostaSemId`, `gravarComSuccessFalse`, `recusarDisponibilidade`, `semMarcaNaLeitura`, `responder401Repetido`, `responder403` e `lento`.

**M8.3a**
1. `escritaReservasBeds24Pronta` é falsa nestes casos:
   - `VERCEL_ENV` `preview`, `development`, ausente ou estranho;
   - `NODE_ENV` `test` ou `development`, mesmo com `VERCEL_ENV=production`;
   - chave ausente, `"Ligada"` ou outro valor;
   - só com `BEDS24_API_KEY`.
2. Independência das chaves: só `BEDS24_ESCRITA=ligada` não habilita reservas; só `BEDS24_ESCRITA_RESERVAS=ligada` não habilita o calendário.
3. O `setupFiles` derruba o teste em qualquer `fetch` para `*.beds24.com`.
4. Régua: nunca entram hold, reserva-pedido, alteração `segurada`, pagamento sem reserva, outras fontes nem marketplace. Reserva confirmada antes de ligar o imóvel vira `manual`.
5. Configuração: ligar um imóvel exige ensaio conferido com a credencial atual. A pausa, a auditoria e `configuracao:editar` funcionam.
6. Importação:
   - reserva do site com `beds24_id` não muda (origem, situação, `confirmadaEm`, valor, taxa, valor líquido, hóspede, e-mail; o motor não roda), inclusive com o vínculo trocado;
   - `black` não cancela;
   - operação com `beds24_id` é reconhecida;
   - marca casada é adotada; marca sem correspondência e duplicada viram aviso; ensaio é pulado;
   - registro sem marca sobre criação não resolvida é pulado: `enviando` de 11 min, `incerta` e `aguardando_equipe`/`incerta`;
   - `enviando` na janela dá "ocupada" com a mensagem certa.
7. `sincronizarReserva` com fonte `beds24` ou `csv` nunca altera uma reserva `fonte = 'site'`.
8. Mudar a fonte de preços ao mesmo tempo que a importação não dá impasse (PGlite com duas conexões).

   **Registro da implementação (M8.3a, 16/10/2026).**
   - **Antes:** o método era o PGlite com duas conexões.
   - **Agora:** o teste (`imoveis/travas-beds24.test.ts`) usa uma conexão só e prova a causa do impasse: a trava `beds24:<org>` pedida com o imóvel já travado pela mesma transação. A cada pedido dessa trava, ele confere se o imóvel já estava travado (tem de não estar). Os casos:
     - `salvarDetalhes`;
     - `salvarDetalhesComLeitura`, a do portal, que nem pede a trava quando a fonte não muda;
     - a fonte mudada por outra gravação entre a leitura sem trava e a gravação: recomeça já com a trava do Beds24;
     - a troca da fonte ao mesmo tempo que a importação: as duas terminam.

     O primeiro caso falharia no código anterior, que travava o imóvel (`FOR UPDATE`) e só depois esperava a trava do Beds24 (3.6, "Exceção de hoje").
   - **Motivo:** o PGlite dos testes tem uma conexão só e serializa as transações (quem chega espera a outra terminar inteira). O impasse de duas conexões não acontece nele, e um teste com duas conexões passaria também no código errado. Conferir a ordem das travas prova a causa.
   - **Objetivo final, o mesmo:** a troca da fonte de preços nunca dá impasse com a importação, com o envio de calendário nem com as fases do M8.3.
9. `referenciaScl` sai do info item, do nome e de `notes`; o ensaio é reconhecido.
10. `procurarReservaDoSite`:
    - filtros: chegada explícita, todas as situações, `includeInfoItems`;
    - regras de adoção: `black` com o código; `cancelled` com o código; dois registros com a marca; hóspede já na casa.
11. "Simular": zero `fetch`, operação `simulada`, nenhuma marca.
12. Telas: as duas chaves aparecem; aviso de credencial fora da produção; prontidão; páginas do hóspede e do portal sem "Beds24"; as tabelas novas em `semDadosPessoais`.
13. Rotinas diárias: "ocupada" fica registrada como "não rodou".

**M8.3b**
14. O papel `operacao` (`reserva:editar` sem `financeiro:ler`) vê os três avisos; os cortes de data são os de hoje.
15. Textos por reserva: bloqueio contra reserva criada; "mude para Cancelado (não apague)".
16. Marca manual: grava o usuário, o aviso some, auditoria, `BotaoConfirmar`, acompanhamento vira `manual`.
17. D3: o pedido confirmado à mão sem pagamento aparece em "feche as datas" e nunca vai ao envio.
18. Carência: `pendente` há 10 min dá o informativo; há 31 min, a linha "atrasadas"; conflito aparece só na atenção.

**M8.3c**
19. HTTP com `fetch` simulado:
    - o corpo de criar, atualizar e cancelar (sem nome real, e-mail, telefone ou valor; avisos falsos);
    - nunca usa o método DELETE;
    - tempo esgotado não repete;
    - 401 renova e repete uma vez; 401 repetido dá `recusada`/`sem_permissao` e interrompe;
    - 403 dá a mensagem de reservas;
    - 429 interrompe.
20. Criação feliz:
    - grava `reservas.beds24_id`, operação `conferida` e `ota_fechada_em` com `por` nulo;
    - o aviso some;
    - o financeiro não muda.
21. Idempotência:
    - duas voltas fazem um POST só; dois trabalhadores ao mesmo tempo, também;
    - alteração aplicada antes do primeiro envio atualiza a operação no lugar;
    - datas A→B→A;
    - "Reenviar" depois de divergência para um estado já enviado.
22. Resposta perdida: fica `incerta`; a busca antes de 5 min não conclui; depois, adota; nunca há segunda criação.
23. Quedas e travas:
    - queda antes do POST volta a `pendente` sem busca;
    - queda depois, com `beds24_id` gravado na operação, leva à releitura por id;
    - trava ocupada e impasse na fase 3 levam a repetir e gravar.
24. `success:false` que gravou mesmo assim é adotado, nunca vira conflito. Recusa repetida no falso: um POST só, `recusada`, aviso e e-mail.
25. Sem marca legível:
    - o ocupante exato vira `incerta` com "Vincular" preenchido, nunca venda dupla;
    - a releitura sem marca dá `marca_ilegivel` e para as criações.
26. Conflito: reserva de OTA, blackout manual e `black` dão `conflito` ou `bloqueio_manual`. Nada é criado nem cancelado. O e-mail não tem dado pessoal.
27. Atualização:
    - noites novas atualizadas e conferidas;
    - só os ids guardados são marcados;
    - alteração com `agora` antigo, gravada depois da fase 1, não é marcada;
    - noites novas vendidas no meio dão `conflito`, sem envio;
    - alteração só de pessoas é marcada.
28. Cancelamento:
    - política, contestada e não comparecimento dão `cancelled`, conferido, `ota_liberada_em` com `por` nulo;
    - com `black` sobrando, não marca;
    - duplicadas são canceladas;
    - reserva apagada dá `divergente`.
29. Cancelamento gravado durante a fase 2 da criação: o id é gravado e o cancelamento vai na volta seguinte.
30. Cancelada antes de criar: `superada`; leitura sem bloqueio grava a marca; com bloqueio, mostra o texto.
31. Conferência contínua com a importação automática desligada: cancelar ou apagar no falso uma reserva `conferida` leva a `divergente`, `ota_fechada_em` vazia, aviso e e-mail.
32. Chave desligada depois de criar: nenhuma escrita; a `incerta` é resolvida só lendo; o texto cita a reserva SCL-XXXXXX.
33. A pausa é lida de novo logo antes do POST.
34. Rotina:
    - a rota responde 403 sem `VERCEL_ENV=production`, e exige `CRON_SECRET`;
    - as janelas são respeitadas;
    - até 10 operações por volta; 150 s mínimos; atraso e 5 falhas;
    - com o falso lento, a volta não inicia operação sem tempo para a fase 3.
35. O pagamento não depende do Beds24: com o falso falhando, o pagamento confirma; nada do M8.3 roda dentro de `aplicarNaTransacao`.
36. `escopo_excessivo`: nada é escrito. `escopo_fora_de_ordem` (faltando ou ilegível): as criações param, e a atualização e o cancelamento seguem.
37. Ensaio: cria, relê, procura, cancela e relê; a importação pula o registro; o ensaio libera a D6.
38. Os botões de configuração são recusados para o papel `operacao`.
39. Regressão: uma reserva criada pelo M8.3, com `livres = 0` observado, aceita a alteração que acrescenta uma noite no fim.
40. "Não existe, pode criar" respeita os 5 min; "Tentar de novo" não zera as buscas.

**M8.3d**
41. "Assumir no Beds24": só com o bloqueio como único ocupante e as datas cabendo; marca e conferência; texto "mude para Cancelado".
42. Reativação, conforme a resposta do suporte.

---

## 11. Decisões para Diego (com o padrão até ele decidir)

| # | Decisão | Padrão até decidir |
|---|---|---|
| D1 | Que dados do hóspede vão ao Beds24 | **Nenhum dado pessoal.** A marca vai no info item; o nome ou a nota "Site SCL-XXXXXX, não altere aqui" depende do suporte (3.5). |
| D2 | Mandar o valor | **Não.** O financeiro é só do SCL. |
| D3 | O pedido do site confirmado à mão **sem** pagamento entra no envio? Hoje é o único caso real em produção, e `GUIA-DIEGO.md:1738-1741` (no commit `adca993`; seção 2, "Site: cotação e "segurar as datas" — M8.1", item **O que ainda não acontece**: "o Airbnb/Booking só fecham as datas quando a reserva confirmada for enviada (M8.3)") prometia que sim. | **Decidida por Diego em 16/10/2026, igual ao padrão: não entra no envio.** Só vai ao Beds24 a reserva paga pelo site. Registro abaixo da tabela. A proposta, que era o padrão até ele decidir: **não entra no envio:** o ROADMAP e a autorização de 16/10 falam de reserva "paga". O guia é corrigido no PR, e o aviso "feche as datas" e a marca manual passam a valer para esse caso. Se Diego disser sim, a régua inclui a confirmação pela equipe (`reservas/repositorio.ts:417-486`), e o cancelamento pelo painel, que não grava `cancelamentos_reserva`, precisa de um gancho próprio. |
| D4 | Não comparecimento: reabrir as noites que sobram | **Cancela no Beds24**, como os outros cancelamentos |
| D5 | Transição (bloqueio feito à mão) | **Nada sozinho.** "Assumir" só no M8.3d, depois do suporte; até lá, "Deixar à mão". |
| D6 | Imóveis ligados no painel | **Nenhum** até Diego escolher, e só depois de um ensaio. Imóvel desligado para só a criação; a pausa geral para tudo. |
| D7 | Primeiro teste real (o Beds24 não tem sandbox **[C]**, Cat:755-757; o staging "does not fully mirror production" e não substitui) | **O ensaio em Integrações**, num imóvel e numa data sem procura que Diego escolher (proposta: o 103): criar, conferir nas OTAs e cancelar, com Diego acompanhando |
| D8 | Marca manual "Datas fechadas nas OTAs" | **Cria a marca**, como diz o texto de 10/10. Se Diego preferir não, a mudança fica registrada e a coluna `ota_fechada_por` sai. |
| D9 | Fechar as OTAs durante o hold | **Não**, como no ROADMAP. O risco continua registrado. |
| D10 | Token novo com escrita de reservas | A chave fica sem efeito até o token novo, com os escopos exatos da seção 7, só em Production, e o passo a passo da troca |
| D11 | Revisar as Auto Actions da conta antes de ligar | Lista para conferir: e-mails internos, de proprietário e de limpeza com origem "All" ou "Direct" (o modelo em Auto_Actions:2176-2190); regras que incluem ou apagam info codes (:325); excluir o info code `SCL` dessas regras (:126). A falta do info item numa reserva nossa conta como `divergente`. |

**Onde Diego vê estas decisões (16/10/2026, M8.3a).** No `GUIA-DIEGO.md`, seção 7 ("Preciso de você"), em linguagem simples, cada uma com o padrão; e no `ROADMAP.md`, "Ações de Diego", item 17. Sem resposta, vale o padrão, e o M8.3b e o M8.3c seguem com ele. D6, D7, D10 e D11 pedem um passo de Diego antes de ligar a escrita, no passo a passo do M8.3c. A D8 vira o botão do M8.3b; se Diego preferir sem ele, a mudança é registrada antes do M8.3b. Antes deste registro, só a D3 aparecia no guia.

### Registro da D3 (16/10/2026)
| | |
|---|---|
| **Antes** | A D3 estava em aberto, com o padrão "não entra no envio" (a proposta na linha da tabela). O guia, na parte da cotação (M8.1), dizia que o Airbnb e o Booking só fechariam as datas quando a reserva confirmada fosse enviada (M8.3), o que incluía o pedido confirmado à mão. |
| **Agora** | Diego decidiu igual ao padrão: o pedido do site que a equipe confirma à mão, **sem** pagamento, **não** vai ao Beds24. Só vai a reserva **paga** pelo site. Esse pedido fica com o aviso "feche as datas" e a marca manual (6.4), que chegam no M8.3b (teste 17). A régua do M8.3a já o deixa de fora: a condição 2 de 2.1 pede um pagamento com `desfecho = 'reserva'`, e "Simular" na ficha responde `sem_pagamento` ("confirmada à mão: feche as datas à mão"). |
| **Palavras de Diego** | Transcrição de voz, em que "Bats24" é o Beds24: "eu acho que tem que ir pro [Beds24] só depois de pago, resolvido pelo site". E, sobre a proposta, uma pergunta com ressalva: "A sua proposta, pelo visto, é igual a minha, né? A não ser que eu tenha entendido errado a ordem das coisas." O Claude respondeu na mesma conversa (16/10) que ele tinha entendido certo e que era igual à proposta: vai ao Beds24 só a reserva paga pelo site. **Antes** (no primeiro registro, também de 16/10), a citação parava em "é igual a minha" e não dizia que o Claude tinha confirmado; corrigida na revisão do M8.3a, para a pergunta não virar afirmação. |
| **Motivo** | No Airbnb, o hóspede tem 24 horas para pagar. Fechar as datas em todos os canais para um hóspede que depois não paga dá muito trabalho (a "trabalheira", nas palavras de Diego) e faz a empresa deixar de receber reservas naquelas datas. E o caso é raro, o que deixa aceitável cuidar dele à mão: "não vai ser um número grande de vezes que vai acontecer". |
| **Objetivo final** | O Beds24 e as OTAs só fecham sozinhos as datas de uma reserva com o pagamento feito pelo site. O pedido sem pagamento a equipe decide à mão, com o aviso. |
| **Efeito nas outras decisões** | Reforça a D9: as OTAs continuam abertas durante o hold, pelo mesmo motivo. O texto do guia da parte da cotação é corrigido no M8.3b, junto com os outros textos (seção 13). |
| **Onde mais está registrada** | No `ROADMAP.md`, na linha do M8.3 e em "Decisões registradas" (16/10); no `GUIA-DIEGO.md`, na seção da entrega do M8.3a e nas respostas da seção 7. É uma decisão nova, então não repete o registro da autorização de 16/10 (seção 1). |

---

## 12. Riscos e o que conferir antes de ligar

### Conferir com o suporte do Beds24 ou no ensaio
**Quem pergunta ao suporte (16/10/2026, M8.3a).** Diego, dono da conta do Beds24: o agente não escreve em sistemas de fora nem fala com o suporte em nome dele. O agente prepara a pergunta no M8.3c, explicada em português simples e com o texto pronto para colar, e a entrega a Diego no guia. Entram sempre os itens 4 e 5, de que o M8.3d depende, e os outros desta lista que ainda estiverem "a confirmar" e que o ensaio não responde. Diego envia e traz a resposta; o M8.3d fica `bloqueado` no `ROADMAP.md` até lá ("Ações de Diego", item 17). Antes deste registro, a seção 13 dizia só "a resposta do suporte", sem dizer quem a pedia.

1. Em que chave do `new` vem o id da reserva criada (`yaml:3204-3214`).
2. O formato da recusa do `checkAvailability`, e se ela considera mínimo de noites, preço ausente e bloqueios.
3. Que a alteração não confere disponibilidade **[I]**.
4. Reserva sobre `black` ou blackout, e o efeito de `overbookingProtection`.
5. O que acontece ao passar de `cancelled` para `confirmed`.
6. Se o info item é dado básico; se `notes` é básico e não aparece em modelos de e-mail; se gravar o nome exige escrita em `bookings-personal`.
7. Os escopos mínimos e o formato de `GET /authentication/details`. Em especial: a escrita em `bookings` e em `inventory` já dá a leitura? Se der e a resposta não listar a leitura, a lista do convite (7) perde as duas leituras, com registro.
8. Que preço fica gravado quando `price` não vai.
9. Que `channel`, `referer` e `apiSource` a reserva criada recebe (**[I]** `direct`).
10. O padrão de `notifyGuest`, `notifyHost` e `allowWebhooks`.
11. O custo das chamadas, inclusive com `includeInfoItems`, e os nomes reais dos cabeçalhos de crédito.
12. O que acontece quando `numAdult` passa do máximo do quarto.
13. O endereço da API: `beds24.com/api/v2` (wiki e `beds24/http.ts:35`) ou `api.beds24.com/v2` (página do marketplace).
14. Se `arrivalFrom` explícito desliga o filtro padrão de reservas futuras.
15. O fuso e o formato de `bookingTime`.
16. Lista de IPs permitidos no convite (`API_V2.wiki:70-74`): avaliar depois, se a Vercel oferecer IP fixo.

### Riscos conhecidos
- **Venda dupla durante o hold e a alteração segurada.** Continua, fora do M8.3.
- **Bloqueio do SCL sobre uma reserva já criada.** O M3.7 mandaria blackout sobre ela (aviso em `calendario/motor.ts:316`). O M8.3 detecta (`bloqueio_do_scl`); a reação do Beds24 está a confirmar.
- **Troca de credencial.** Invalida o ensaio e o veredito do portal (`portal/marketplace.ts:170-181`); as atualizações releem por id com a credencial nova.
- **Escrita de calendário sem trava de ambiente** (`beds24/http.ts:217-227`; `calendario/acoes.ts:93`). Ela aceita o token direto, que a wiki diz ser só leitura. Fica como **pendência para um item próprio do M3.7**: aplicar `deployDeProducao` e `NODE_ENV`. Até lá, a proteção é o token de escrita ficar só em Production (seção 7).
- **`next start` local com as variáveis da produção baixadas** (`vercel env pull`; **[S]**, a confirmar se o arquivo traz `VERCEL_ENV=production`). É o resíduo da trava de ambiente. Ninguém deve rodar o sistema assim; fica no guia.
- **Vínculo inválido em qualquer imóvel aborta a importação toda** (`sincronizacao.ts:43-46`). A conferência própria do M8.3 (4.5) continua.
- **Segundo escritor no Beds24.** O M8.3 escreve reservas, não calendário. Por isso a trava e o "em andamento" são compartilhados com o M3.7 (`requisitos/operations/CALENDARIO-PRECOS-OPERACAO.md` l.182).
- **Já tratado (sai da lista de riscos):** a disponibilidade calculada contra a própria reserva.
  - Na cotação da alteração, a leitura do Beds24 não conta nas noites da própria reserva (`site/disponibilidade.ts:121-122`, :176-181).
  - `noitesLivres` confere só as noites novas, com `excetoReservaIds` (`pagamentos/alteracao.ts:638-641`).
  - Fica o teste de regressão 39.

---

## 13. Divisão em PRs

Os PRs comparáveis foram grandes:
| PR | Arquivos | Linhas | Rodadas do Codex |
|---|---|---|---|
| #117 (M8.2a) | 144 | cerca de 49,7 mil | 31 |
| #126 (M8.2d) | 148 | 29,1 mil | 12 |
| #127 (M8.2e) | 120 | 32 mil | 25 |

O M8.2 foi dividido "para a revisão caber" (`ROADMAP.md:171`). O M8.3 é dividido do mesmo jeito, e a proteção da importação entra antes de qualquer escrita. Todos partem da `main` depois do merge do PR das decisões de 16/10. O M8.3a é a exceção: foi empilhado sobre esse PR (#146), ainda aberto, e entra depois dele (registro no topo deste documento).

| PR | Conteúdo | Efeito em produção | Depende de |
|---|---|---|---|
| **M8.3a: base sem escrita** (entregue em 16/10, em revisão) | Migração 0072 (as duas tabelas); régua pura com a exclusão do marketplace; `escritaReservasBeds24Ligada/Pronta` (com `NODE_ENV`); configuração `reservasBeds24` (pausa, D6 e o registro do ensaio, sem o ensaio em si); prontidão só leitura (escopos); proteções da importação (desvio, recusa em `sincronizarReserva`, `escritaBeds24EmAndamento` com as mensagens certas); correção da ordem das travas em `imoveis/detalhes.ts`; `referenciaScl`; versão falsa ampliada; `procurarReservaDoSite` (leitura); "Simular" sem rede; bloco da ficha só leitura; Sistema e Integrações; "ocupada" registrada como "não rodou"; `setupFiles` que barra a rede; testes 1 a 13 | Nenhuma escrita. A importação passa a proteger reservas do site. | PR das decisões de 16/10 |
| **M8.3b: tarefas das OTAs num lugar só** | `tarefasDasOtas`; o aviso da paga para quem edita reservas; marca manual (D8); aviso do caso D3; textos por reserva; "mude para Cancelado (não apague)"; guia corrigido (os cinco trechos listados em 6.2, "Textos a revisar", e na D3 da seção 11, procurados pelo texto: os números l.722, 824, 1002-1005, 1738-1741 e 3462 são do commit `adca993`); testes 14 a 18 | Vale já: a operação vê os avisos, a marca manual e os textos certos | M8.3a |
| **M8.3c: escrita real** | `gravarReservas` (HTTP e falso); rota e horários; janelas; três fases; idempotência e incerteza; conflito; criar, atualizar e cancelar; marcas automáticas; conferência contínua; aviso de atenção e e-mail; botões; ensaio; em Integrações, o último 403 ou 401 de reservas e o link dos contadores para a lista filtrada, com o filtro `beds24=atencao` na lista de reservas (os dois ficaram fora do M8.3a, registro na seção 8); testes 19 a 40 | Só escreve com a chave, o token, o ensaio e um imóvel ligado | M8.3a, M8.3b |
| **M8.3d: depois do suporte do Beds24** | "Assumir no Beds24" e a reativação; testes 41 e 42 | Igual ao M8.3c | M8.3c e a resposta do suporte, que Diego pede com a pergunta preparada pelo agente no M8.3c (seção 12); por isso o M8.3d fica `bloqueado` no `ROADMAP.md` |

Cada PR atualiza a sua linha no `ROADMAP.md` e o `GUIA-DIEGO.md` (seção "Onde estamos", o que Diego precisa fazer, data). O M8.3c traz o passo a passo de ligar: token novo só em Production, Redeploy, prontidão, ensaio, ligar o primeiro imóvel, conferir.

---

## Arquivos a mexer (por PR)

**M8.3a**
- `app/drizzle/0072_m8_3_reservas_site_beds24.sql`, mais o `meta` do drizzle-kit; `db/schema.ts` (`beds24ReservasSite`, `beds24ReservasOperacoes`).
- `beds24/tipos.ts`: tipos novos, `ReservaBeds24.referenciaScl` e `.ensaio`, campos de `FiltroReservas`.
- `beds24/http.ts`: as funções da chave e a leitura de info items e de `/authentication/details`.
- `beds24/normalizar.ts`, `beds24/falso.ts`.
- `beds24/reservas-site-regras.ts`, `beds24/reservas-site-config.ts`, `beds24/reservas-site.ts` (`procurarReservaDoSite`, `adotarReservaCriada`, `conferirNaImportacao`).
- `beds24/trava.ts`, `beds24/sincronizacao.ts`, `calendario/envio.ts`, `reservas/repositorio.ts`, `imoveis/detalhes.ts`.
- `beds24/cron.ts`, `beds24/cron-envio.ts`.
- `components/reservas/ReservaNoBeds24.tsx`, `app/painel/reservas/[id]/page.tsx`, `app/painel/configuracoes/integracoes/page.tsx`.
- `sistema/servicos.ts`, `sistema/automacoes.ts`.
- `pagamentos/testes.ts` (`semDadosPessoais`), `vitest.config.mts` e o setup.
- `ROADMAP.md`, `GUIA-DIEGO.md`.

**M8.3b**
- `beds24/reservas-site-tarefas.ts`; `pagamentos/consultas.ts`; `painel/dashboard.ts`.
- Os textos de `pagamentos/cancelamento.ts`, `pagamentos/alteracao.ts`, `CancelamentoSite.tsx`, `AlteracaoSite.tsx`.
- `beds24/acoes-reservas.ts` (marca manual).
- `GUIA-DIEGO.md`, `requisitos/product/PAGAMENTO-SITE.md` (l.1230-1236, 1717-1741, 3655-3659, com a versão anterior registrada), `requisitos/product/COTACAO-E-HOLD-SITE.md` l.81.

**M8.3c**
- `beds24/http.ts` (`gravarReservas`, mensagem do 403/401 de reservas), `beds24/falso.ts`, `beds24/reservas-site.ts` (`enviarReservasDoSite`), `beds24/acoes-reservas.ts`, `beds24/cron-reservas.ts`.
- `sistema/automacoes.ts`: a linha `reservas-beds24` passa a `"ativa"` (registro na seção 8).
- `app/api/cron/beds24-reservas/route.ts`, `app/vercel.json`.
- `painel/dashboard.ts` (`avisosDeReservasNoBeds24`), `email/aviso-equipe.ts` (uso).
- A ficha e Integrações (botões, ensaio, o último 403 ou 401 de reservas e o link dos contadores).
- `app/painel/reservas/page.tsx` (filtro `beds24=atencao`).
- `ROADMAP.md`, `GUIA-DIEGO.md`.

**M8.3d**
- `beds24/reservas-site.ts`, `beds24/acoes-reservas.ts`, a ficha.
