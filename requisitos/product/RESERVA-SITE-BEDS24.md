# Reserva paga do site no Beds24 (M8.3): desenho

**Situação:** desenho revisado em 16/10/2026 depois de três críticas: dano real, concorrência e operação. Base: `origin/main` no commit `adca993` (16/10/2026).
- **M8.3a (base sem escrita): entregue em 16/10/2026 na branch `claude/m8-3a-base-reservas-beds24`, em revisão e ainda não integrado na `main`.** Nada escreve no Beds24. As mudanças de método da implementação estão registradas onde cada regra mora (5.2, 7, 8 e 10).
- **M8.3b e M8.3c:** a fazer (seção 13). **M8.3d:** `bloqueado` na resposta do suporte do Beds24, que Diego pede com a pergunta preparada pelo agente no M8.3c (seções 12 e 13).
- **Registro (17/10/2026, M8.3b).** Antes: as duas linhas acima diziam que o M8.3a estava "em revisão e ainda não integrado na `main`" e que o M8.3b estava "a fazer". Agora: o M8.3a está integrado na `main` desde 16/10/2026, pelo PR #154 (merge `baa6c55`). O M8.3b foi entregue em 17/10/2026 na branch `claude/m8-3b-tarefas-otas` e está em revisão (PR "[M8.3b] …"), ainda não integrado na `main`. O M8.3c continua a fazer. O M8.3b não escreve no Beds24, não usa a rede e não tem migração nova. Os registros da implementação estão em 6.1, 6.2, 6.4, 8, 11 e 13. O PR #146 (M13.1), citado abaixo e nas seções 1 e 13 como "ainda aberto" (na seção 1, com os commits `2727138` e `fde4722` fora da `main`), também já está na `main` (merge `65906f9`, 16/10/2026), antes do #154.
- **Registro (17/10/2026, M8.3c).** Antes: a linha acima dizia que o M8.3b estava "em revisão (PR "[M8.3b] …"), ainda não integrado na `main`" e que o M8.3c continuava a fazer. Agora: o M8.3b está integrado na `main` desde 17/10/2026, pelo PR #156 (merge `b554cfa`). O M8.3c foi entregue em 17/10/2026 na branch `claude/m8-3c-escrita-reservas` e está em revisão (PR "[M8.3c] Reserva do site no Beds24: escrita real (desligada)"), ainda não integrado na `main`. Ele escreve no Beds24 só no deploy de produção, com `BEDS24_ESCRITA_RESERVAS=ligada`, o refresh token novo com os 7 escopos, um ensaio conferido com essa credencial e um imóvel ligado; nada foi escrito no Beds24 de verdade (os testes usam a versão falsa, sem rede). A migração é a `0074_m8_3c_escrita_reservas_beds24.sql` (3.2). O M8.3d continua `bloqueado` na resposta do suporte, e a pergunta está pronta no `GUIA-DIEGO.md` (seção 6, item 51; 12). Os registros da implementação estão em 1, 2.4, 3.2 a 3.8, 4.1 a 4.5, 5.2, 6.1, 6.2, 6.3, 6.5, 7, 8, 9, 10, 11, 12, 13 e "Arquivos a mexer". Objetivo final, o mesmo: as datas das reservas pagas pelo site abrem e fecham nas OTAs sozinhas, sem venda dupla.
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

**Registro da implementação (M8.3c, 17/10/2026): a terceira exceção ao "fora do M8.3" do M3.7.**

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| Mudanças no envio de calendário (M3.7) | Ficavam de fora, com duas exceções: a ordem das travas (3.6) e a regra de "em andamento" (5.1). | Terceira exceção, só de leitura: `normalizarCalendario` (`beds24/normalizar.ts`) aceita `numAvail` negativo, o overbooking (4.4), em vez de descartar a faixa como "valores inválidos"; a noite conta como fechada (`livres <= 0` em `fechadaNaLeitura`, `site/disponibilidade.ts`), também no site; e o plano do calendário (`calendario/motor.ts`) ganha o aviso próprio "Beds24 informa unidades negativas (overbooking)…", com ou sem reserva no SCL. O aviso de "0 unidades" continua só para o zero sem reserva nem bloqueio no SCL. O envio do M3.7 continua sem criar, alterar nem cancelar reservas, e nada mais muda nele. Registro também em `requisitos/operations/CALENDARIO-PRECOS-OPERACAO.md`. | Descartado, o negativo esconderia o overbooking da conferência depois de cada escrita (4.4) e deixaria a noite vendida duas vezes aberta no site. Levar o aviso de "0 unidades" ao negativo não bastava: ele só sai sem reserva no SCL, e o caso principal do overbooking tem a nossa reserva. |

Objetivo final, o mesmo: o M3.7 continua sem escrever reservas; a leitura só deixa de esconder a noite vendida duas vezes.

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

**Registro da implementação (M8.3c, 17/10/2026).** Os motivos de configuração saem de uma função só, `motivoDeConfiguracaoDasReservas` (`beds24/reservas-site-rotina.ts`), usada pelo trabalhador, pela rotina, por Integrações, pelo Sistema e pelo Início. Ela devolve o primeiro que vale, nesta ordem, e diz o que para: `sem_credencial` (tudo); `escopo_excessivo` (nada é escrito); `escopo_fora_de_ordem` sem leitura válida (nada é escrito); `escopo_fora_de_ordem` lido (só as criações); `sem_ensaio` (só as criações); `marca_ilegivel` (só as criações). O texto simples de cada um é `textoDaConfiguracaoDasReservas`.

| | Antes (a tabela acima) | Agora (o código) | Motivo |
|---|---|---|---|
| `escopo_fora_de_ordem` | A linha "prontidão falhou" parava só as criações com o escopo faltando ou a resposta ilegível. | Dois casos. Sem leitura válida dos escopos com a credencial atual (nunca lida, lida com outra credencial, com mais de 26 h, ou a leitura do começo da volta falhou), **nada é escrito** nesta volta, como no `escopo_excessivo` (a tela: "as permissões da credencial atual não foram lidas nas últimas 26 horas (ou a leitura falhou); nada é escrito"). Com a leitura válida e escopo faltando ou ilegível, só as criações param, como antes. | Sem a leitura, não se sabe se há escopo a mais. Depois de uma troca de token, a volta cancelaria e atualizaria com uma credencial que pode ter `all:bookings` (7: "escopo a mais: nada é escrito"). |
| Quando os escopos são lidos | "Sob demanda e uma vez por dia na rotina" (7). | No **começo** da volta, antes de qualquer escrita, sempre que a leitura guardada não for da credencial atual ou tiver mais de 23 h (`precisaLerEscopos`); a leitura vale por 26 h (`leituraDosEscoposValida`) e fica em `beds24_reservas_rotina` (3.2). A recusa na leitura (429, 401, 403) para a volta inteira. | Lida depois das criações, a primeira volta depois do deploy ou da troca do token escreveria sem conferência; com 24 h exatas, as criações parariam uma volta por dia, quando a leitura completasse o dia. |
| Vínculo, quarto ou moeda | "Aviso de configuração. A reserva fica `pendente` com o motivo." | `sem_vinculo` é por imóvel e fica fora da função da empresa: a reserva fica `pendente`/`sem_vinculo`, sem contar tentativa e sem e-mail. A volta lê os quartos uma vez, antes da fase 1 (`quartoAcessivelEmBrl`, em `beds24/configuracao.ts`, a mesma regra da importação): sem o quarto acessível em BRL, a régua vira `parada`/`sem_vinculo` e nenhuma operação nasce; a operação que já estava na fila vira `superada`, sem POST, e a assinatura sai do acompanhamento (3.3). O Início mostra uma linha por imóvel, "envio de reservas parado no imóvel NNN: vínculo, quarto ou moeda" (com o link só para quem tem `configuracao:editar`), lida dos acompanhamentos `pendente`/`sem_vinculo`. | O vínculo é de cada imóvel (2.2 e 3.2). Com a operação nascendo e sendo superada a cada volta, a fila giraria sem fim. |
| Chave desligada, sem credencial ou pausa, com envio em curso | A rotina sai antes de qualquer trava; a exceção são as `enviando` ou `incerta` que sobraram, resolvidas só com leitura. | Igual, também para as `feita` e o ensaio vencido com o id (`haOperacaoEmCursoASair`), com o leitor de reservas (`leitorDeReservasDoAmbiente`, que nunca grava). Sem nada a resolver, sai sem trava, sem leitura e sem linha nova, e registra "Nada feito: <motivo>, e não há envio em curso a conferir." | A `feita` é um fato aceito pelo Beds24 que ainda não foi conferido (3.4). |

Objetivo final, o mesmo: nenhuma escrita de reservas com credencial diferente da combinada, e um aviso de configuração só, no lugar de um por reserva.

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

**Registro da implementação (M8.3c, 17/10/2026): a migração da escrita.**

| | Antes | Agora (o código) | Motivo |
|---|---|---|---|
| O que muda no banco | As duas tabelas da 0072, sem a classificação da resposta do Beds24 nem detalhes; os escopos lidos não eram guardados. | `app/drizzle/0074_m8_3c_escrita_reservas_beds24.sql`, idempotente como a 0067 a 0073 (`IF NOT EXISTS`, a chave estrangeira num bloco `DO $$`, `--> statement-breakpoint`): em `beds24_reservas_operacoes`, a coluna `resposta` (lista fechada `RESPOSTAS_BEDS24`, 3.8; nula antes do POST) com o índice parcial `beds24_reservas_operacoes_resposta`, e a coluna `detalhe` (jsonb, padrão `{}`, forma fechada lida por `detalheOperacaoBeds24`: o id sugerido, as duplicadas, o bloqueio achado, o que o ensaio observou, a incerteza encerrada pela equipe, o vínculo feito sem a marca e o botão que abriu ou concluiu a operação; sem dado pessoal nem valor); e a tabela `beds24_reservas_rotina`, uma linha por organização, com os escopos lidos (só nomes de escopo), a impressão da credencial que os leu (nunca a credencial) e as marcas de tempo da conferência contínua (4.5). A tabela nova, o resumo das execuções e os e-mails entram na varredura `semDadosPessoais`. | A saída da incerteza (3.8) precisa saber, na volta seguinte, se a resposta foi uma recusa ou tempo, rede ou 5xx, sem um código dentro do texto do `erro` (duas versões da mesma regra). O último 403 ou 401 vale também para o ensaio, que não tem acompanhamento. Os escopos e as marcas de tempo são estado operacional, não configuração editável: no JSON `reservasBeds24`, `mudar()` apagaria os campos que o parser não conhece, a rotina geraria auditoria diária sem autor e a trava da configuração entraria no caminho da fase 1. |
| O número | O plano do M8.3c previa `0073_m8_3c_…`. | `0074`. A `main` trouxe antes a `0073_m10_1a_whatsapp.sql` (M10.1a, PR #158, merge `878a8f0`); a do M8.3c saiu da 0073 e voltou como 0074 no merge `f4517c7`, gerada de novo pelo drizzle-kit sobre a 0073 da `main`, com o mesmo corpo. A 0073 da `main` não foi editada. O teste da migração (`db/migracoes.test.ts`) aplica até a 0074 sobre uma linha da 0072 e confere que rodar de novo não muda nada. | Nunca editar migração já mergeada (`CLAUDE.md`). |
| A hora do "Retomar" | — | Fica fora da migração, no JSON da configuração (`retomado`, 6.1). | É uma ação de Diego na pausa, com auditoria. |

Objetivo final, o mesmo: o histórico de cada operação conta o que foi enviado e o que o Beds24 respondeu, sem dado pessoal, e nenhuma migração mergeada muda.

### 3.3 Idempotência
- **Chaves:** `<tipo>:<reservaId>:<versao>`, com a `versao` do acompanhamento. Ela sobe na fase 1, sob a trava `beds24:<org>`, quando nasce uma intenção nova. As exceções:
  - ensaio: `ensaio:<uuid>`;
  - simulação: `simulacao:<reservaId>:<tipo>:<assinatura>:<simulação anterior>` (`primeira`, sem anterior). O tipo entra porque o mesmo estado pode ser simulado como criação e, depois de criada, como atualização: sem ele, a segunda simulação reaproveitaria a linha da primeira e diria "criar" (revisão do Codex, 16/10). A simulação anterior entra porque "repetida" quer dizer "igual à última simulação desta reserva": voltar a um estado já simulado (A→B→A) grava uma linha nova, que fica no topo do histórico da ficha; antes (16/10), a chave sem a anterior reaproveitava a linha de A e a ficha dizia "nada mudou desde a última simulação" com B no topo (varredura do M8.3a, 17/10). Dois cliques ao mesmo tempo continuam dando uma linha só. Com um envio real sem conclusão (`enviando`, `incerta`, ou o POST tentado sem o id do Beds24; ou o acompanhamento `em_envio`), nada é simulado (`envio_em_curso`): a simulação não diria "criar" de novo nem "nada a cancelar" sem saber o que o Beds24 gravou;
  - `assinatura` = sha256 truncado de `room_id|chegada|saida|hospedes|situacao`.
- **Operação ainda sem POST** (`enviado_em` nulo):
  - mesmo tipo: é atualizada no lugar (`pedido`, `esperado`, `alteracoes`), com a mesma chave;
  - tipo diferente: vira `superada` e nasce outra com versão nova. Por exemplo, uma `criar` cuja reserva foi cancelada. Uma `criar` só vira `superada` se a reserva deixar de precisar dela antes de qualquer POST.
- **Operação com POST tentado** (`enviado_em` preenchido): nunca é atualizada no lugar. A seguinte espera ela terminar.
- **Linha terminal** (`conferida`, `superada`, `divergente`, `recusada`, `conflito` ou `falhou`): nunca é retomada para uma intenção nova. "Tentar de novo" só reabre a mesma linha em `falhou`, `recusada` ou `conflito`, e só para a mesma intenção (mesma assinatura). Se o SCL mudou, nasce uma versão nova.
- **Inserção** com `on conflict (organizacao_id, chave) do nothing`, seguida da releitura da linha.
- **Busca primeiro.** Toda criação começa procurando a marca no Beds24 (3.5). Isso protege contra resposta perdida, queda do banco e restauração de backup.
- **[C] O Beds24 não tem chave de idempotência.** "idempot" não aparece na especificação, e `POST /bookings` sem `id` cria uma reserva nova (`yaml:378-381`).

**Registro da implementação (M8.3c, 17/10/2026).** O trabalhador fica em `beds24/reservas-site-envio.ts` (`abrirIntencao`, a fase 1); as regras puras da fila, em `beds24/reservas-site-regras.ts` (`passoDaFila`, `operacaoEmCurso`).

| | Antes (o texto acima e o 3.8) | Agora (o código) | Motivo |
|---|---|---|---|
| A volta a `pendente` depois de um POST tentado | 3.8: "se foi tempo, rede ou 5xx: volta a `pendente` com atraso"; e "Tentar de novo" reabria a mesma linha em `falhou`, `recusada` ou `conflito`, para a mesma intenção. | A linha com POST tentado nunca volta: ela fica `falhou` (com a `resposta` e o `enviado_em`) e nasce uma operação nova com `versao+1`, `pendente` e a mesma assinatura. O `limite` (429 sem a lista) e o `nao_enviado` (3.8) seguem o mesmo esquema, sem limpar `enviado_em`. "Tentar de novo" só reabre a mesma linha quando ela não teve POST (`falhou` antes do POST, ou `conflito`) e a assinatura é a mesma; com POST, ou com o SCL mudado, nasce a versão nova, com o `esperado` de agora. | A regra "operação com POST tentado nunca é atualizada no lugar" e o `enviado_em` como prova do POST: o desvio "e" da importação o lê (5.2). |
| A fila diante da régua | Não dizia. | Uma operação `pendente` sem POST passa pela régua na fase 1 (`passoDaFila`): a mesma ação, ou `sem_mudanca`, segue; outra ação: a antiga vira `superada` antes de nascer a nova, na mesma transação (senão o índice `uma_ativa` dá 23505); `cancelada_sem_beds24`: `superada`, e segue a cancelada antes de criar (6.3); `parada`/`sem_vinculo`: `superada`, e o acompanhamento `pendente`/`sem_vinculo`; qualquer outro "fora" (imóvel desligado, `manual`, `encerrada`, a estadia que terminou…): `superada` na mesma transação e **nunca** enviada, e o acompanhamento sai de `em_envio` para `pendente`; a pausa geral não muda nada (o passo 0 só lê). A régua roda antes de criar qualquer linha: a decisão `manual`/`anterior_a_ligar` cria o acompanhamento `manual`, sem quarto e sem operação. Com uma operação da reserva em curso (`enviando`, `incerta`, `feita`, ou `pendente` com POST: `operacaoEmCurso`), nenhuma intenção nova nasce (`esperar`). A `criar` superada sem POST tira a assinatura do acompanhamento (`assinaturaEsperada` nula). | Sem isso, uma `criar` à espera do atraso de uma falha sairia depois de o imóvel ser desligado (D6), e uma `pendente` parada barraria a marca manual, que recusa com operação ativa (6.4). Com a assinatura deixada no acompanhamento, a régua responderia `sem_mudanca` para sempre depois de o imóvel ser religado. |
| Os botões que reabrem o envio | 8: "Tentar de novo" e os outros botões, sem dizer como gravam. | "Tentar de novo", "Não existe, pode criar", "Reenviar o que está no SCL" e "Passar ao sistema" passam o acompanhamento a `pendente`, com o motivo nulo e `proxima_tentativa_em = agora`, na mesma transação da operação, e só enfileiram (`abrirIntencao` com `soEnfileirar` e `forcar`, que devolve `enfileirada`): nenhum botão põe uma operação em `enviando`, e a rotina envia em até 10 min. `forcar` não abre nada quando a régua não aponta a ação pedida e não zera as tentativas. | Sem o `pendente`, a régua responderia `aguardando_equipe` ou `divergente` à operação que a equipe autorizou. Com uma `enviando` aberta por um botão, a escrita da empresa toda ficaria travada por 6 min sem fase 2. |
| A operação de "Vincular" | `vincular`, id informado pela equipe (3.2). | Chave `vincular:<reservaId>:<versao+1>`, inserida já `conferida` ou `divergente` (nunca ativa: o índice `uma_ativa` já tem a `incerta` da criação), em três tempos (3.6). | |

Objetivo final, o mesmo: uma intenção, uma operação; e um POST nunca é repetido às cegas.

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

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| A operação até a fase 3 | `pendente` → `enviando` → `feita` → `conferida`… | A operação continua `enviando` até a fase 3: o UPDATE logo depois da resposta grava `beds24_id`, `resposta` e `respondido_em` sem mudar a situação. | `escritaBeds24EmAndamento` só enxerga `enviando`: uma `feita` antes da fase 3 deixaria a importação entrar no meio. |
| Onde `feita` aparece | Entre `enviando` e a conferência. | Só para o fato que o Beds24 aceitou e que ainda não foi conferido: a criação adotada pela importação (o passo 1 da volta termina); a criação aceita que não pôde ser relida (o id já gravado na reserva; a releitura seguinte conclui); o `atualizar` e o `cancelar` aceitos, quando a conferência depois não concluiu; o cancelamento aceito que espera a equipe cancelar no Beds24 uma duplicada nossa viva (`aguardando_equipe`/`duplicada`) ou um registro vivo com a marca que não é nosso (`aguardando_equipe`/`marca_em_registro_inesperado`), com "Conferir agora" repetindo a conferência (4.3); a criação cujo id não voltou com a credencial trocada ou o quarto sem acesso (`aguardando_equipe`/`sem_permissao`); e o ensaio entre "Criar o ensaio" e "Cancelar o ensaio" (8). A `feita` conta como "em curso" para a fila (3.3) e para o passo 0. | Terminal, a operação não teria mais o que reler, e o acompanhamento ficaria preso na equipe. |
| A situação terminal em cada resultado | Os resultados diziam só a situação do acompanhamento. | O conflito antes de criar ou de atualizar (as noites ocupadas, o bloqueio manual ou do SCL, sem disponibilidade): operação `conflito`. A busca que achou duplicada ou marca em registro inesperado: `divergente`, com os ids em `detalhe.duplicadas`. O ocupante exato numa `criar` nova: `divergente`, com `detalhe.candidato`, e o acompanhamento `aguardando_equipe`/`incerta`. A 5ª falha antes do POST (e o 5º `nao_enviado`): `falhou`, sem versão nova, e o acompanhamento `aguardando_equipe`/`falhas`. O "não achou" depois de uma recusa: `recusada`. Sem acesso antes do POST do `atualizar` ou do `cancelar` (o id não voltou, com a credencial trocada ou o quarto sem acesso): `falhou`, e o acompanhamento `aguardando_equipe`/`sem_permissao`, sem e-mail. Nada fica ativo: "Deixar à mão" e "Tentar de novo" valem. | Uma operação ativa barraria, pelo índice `uma_ativa`, o cancelamento seguinte e a marca manual. |
| A saída do `divergente` | O `divergente` só saía pela ação da equipe; a importação só gravava `conferida_em` quando a leitura voltava a bater (5.2). | Quando a leitura volta igual ao `esperado`, com a marca desta reserva, nenhuma operação ativa e a assinatura do SCL igual à do `esperado`, o `divergente` passa a `conferida`, com o motivo nulo e a auditoria `beds24.reserva.conferir`, e `ota_fechada_em` é refeito pelo sistema quando a divergência o tinha limpado (`conferirReservaLigada`, em `beds24/reservas-site-conferencia.ts`, a camada dona da situação `conferida`). Vale na conferência contínua (4.5) e em "Conferir agora". | Os consertos do desenho ("No Beds24, volte-a para Confirmado", seção 5; repor o info code, D11) não levariam a nada: a atualização ficaria suspensa e um `marca_ilegivel` pararia as criações para sempre. |
| `encerrada` | "A estadia terminou, ou o cancelamento foi conferido." | A volta encerra, num passo só de banco (`encerrarTerminadas`), todo acompanhamento fora de `manual` e `encerrada`, sem operação ativa nem `feita`, com a saída antes de hoje (São Paulo); o motivo é limpo, e o anterior fica na auditoria `beds24.reserva.encerrar`. O cancelamento conferido, com a marca das datas reabertas, também encerra. | Sem limitar à `conferida` (9): um `divergente` ou `marca_ilegivel` antigo pararia as criações para sempre. |
| O overbooking | Não dizia. | O acompanhamento continua `conferida`, com as marcas, e ganha o motivo `noites_ocupadas` (4.4). | `conflito` quer dizer "nada foi enviado" e suspenderia a atualização. |

Objetivo final, o mesmo: a situação diz à equipe o que o Beds24 tem e o que falta fazer, e nenhuma operação fica presa.

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

A busca "funcionou" quando a resposta é válida **e** a credencial lê a marca. O ensaio com a credencial atual prova a segunda parte (seção 8). Resposta válida quer dizer: nenhum registro em formato inválido, nenhum id repetido na mesma leitura e o registro que volta em mais de uma leitura (o do quarto e o da releitura por id, por exemplo) igual em todas; senão, qual cópia vale? (varredura do M8.3a, 17/10: antes, valia a primeira cópia, e a adoção dependia da ordem).

**Regras de adoção**, iguais no trabalhador, na importação e em "Vincular":
- existe **exatamente um** registro com a marca;
- a situação é `confirmed` ou `new`;
- `roomId` é o guardado (na criação, o do vínculo);
- chegada e saída são iguais às do `esperado`.

Com dois ou mais registros: `aguardando_equipe`, motivo `duplicada`, com os ids listados. Com qualquer diferença: `aguardando_equipe`, motivo `marca_em_registro_inesperado`. Nos dois casos, nenhum POST. Exigir `bookingTime >= iniciado_em` da primeira `criar`, com margem, fica **a confirmar** (fuso e formato). Até lá, essa regra não é usada.

`FiltroReservas` (`beds24/tipos.ts`) ganha `quarto`, `chegadaExata`, `pesquisa` e `incluirInfo`.

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| A marca que conta para adotar e para as duplicadas | A referência vinha do info item ou, como reforço, do código no nome ou nas notas, e as regras de adoção não olhavam o canal. | Só conta como "nosso" (`registroNossoBeds24`, em `beds24/reservas-site-regras.ts`) o registro com a marca do info item `SCL` (`ReservaBeds24.marcaFonte = 'info'`) e a origem que pode ser a do SCL (`origemPodeSerDoScl`): o canal direto, ou a origem pela API (`apiSource`, lida como `origemApi`) informada; nunca um canal nomeado (Airbnb, Booking), nem no canal nem na origem pela API (lida pela mesma `canalDe` da importação). Vale na adoção (trabalhador, importação e "Vincular"), nas duplicadas do cancelamento e no ocupante exato (3.8). A duplicada conta só os nossos; o código só no nome ou nas notas, ou num registro de OTA, é `marca_em_registro_inesperado` com o id dele, nunca adotado nem cancelado. O M8.3c grava a marca só no info item (D1; nada no nome nem em `notes`, até o suporte responder o item 6 da seção 12). | Uma reserva de OTA em que alguém anotou o código seria adotada e depois cancelada pelo sistema; e mudar a situação de uma reserva de canal pelo Beds24 libera o estoque sem cancelar na OTA: venda dupla. |
| A terceira via da origem | O plano do M8.3c previa também "o canal e a origem iguais aos que o ensaio válido observou". | Ficou de fora: a origem vale pelo canal direto ou pela origem pela API, sem canal nomeado. | Com "nunca canal nomeado" e "o canal desconhecido sem a origem pela API nunca basta" (`canalDe` põe nele Expedia, Vrbo e qualquer outro), essa via não acrescenta caso nenhum; e uma reserva da Airbnb com `apiSource` nas mesmas datas viraria "incerta" em vez de "possível venda dupla". Fica **[I]** até o ensaio registrar o canal e a origem que a reserva criada recebe (`detalhe.observado`; 12, item 9). |
| A marca ambígua | Dois códigos contavam como "sem marca"; o info item `SCL` com texto inválido era ignorado (5.2, "Para o M8.3c"). | `ReservaBeds24.marcaAmbigua` separa "ambígua" (dois códigos diferentes, ou o info item `SCL` presente com o texto ausente ou inválido, mesmo com um código válido nas notas) de "sem marca". `procurarReservaDoSite` não conclui com ela, e a importação a desvia com aviso. | 5.2: o registro ambíguo pode ser o nosso. |
| "A busca funcionou" | A resposta válida e a credencial que lê a marca, provada pelo ensaio. | O mesmo, no código: `ensaioValeParaCredencial` com a credencial usada e nenhum `marca_ilegivel` que conte (4.4). Sem isso, "não achou" não conclui e conta como busca sem conclusão. | |
| "Vincular" na duplicada | Com dois ou mais registros, `duplicada`, nenhum POST, e a equipe não tinha saída. | `vincularRegistro` (`beds24/reservas-site.ts`) aceita um dos ids listados quando a releitura mostra esse registro dentro das regras de adoção e os outros nossos em `cancelled` (a equipe os cancelou no Beds24); senão, recusa com a lista "cancele no Beds24 (não apague): …". Sem a marca, só quando a credencial não lê a marca (o `marca_ilegivel` que conta, ou sem ensaio válido para a credencial), com a segunda confirmação, a origem de cima e a frase "a marca não pôde ser lida com esta credencial" no `erro`; esse vínculo fica `divergente`/`marca_ilegivel` e nunca grava as marcas das OTAs. Com a credencial que lê a marca, um registro sem marca não é nosso: recusa. A auditoria é `beds24.reserva.adotar`, com o autor. | As regras contam os registros com a marca em todas as situações: sem esta saída, a duplicada nunca sairia. |
| `bookingTime` | "Exigir `bookingTime >= iniciado_em` fica a confirmar." | Continua sem uso; o ensaio só registra se ele voltou legível (12, item 15). | |

Objetivo final, o mesmo: o sistema só adota, muda ou cancela no Beds24 o registro que ele mesmo criou.

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

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| Fase 1 | Trava o imóvel e a reserva, aplica a régua e marca `enviando`. | A ordem de 3.3 (a régua antes de qualquer linha, a fila diante dela) e, no acompanhamento, `versao+1`, `esperado`, `assinatura_esperada`, `room_id`, `property_id`, `credencial` e `em_envio`. O `room_id` entra já na fase 1. Na `atualizar` e na `cancelar`, a operação nasce com o `beds24_id` já ligado (`reservas.beds24_id`). `iniciado_em` é o `now()` do banco também na atualização da linha. | Sem o quarto, `criadaPeloM83` daria uma atenção falsa assim que o id entrasse na operação. A queda e a incerteza da `atualizar` e da `cancelar` se resolvem pela releitura por id (3.8), nunca pela busca da criação. |
| A operação até a fase 3 | Logo depois da resposta, o UPDATE grava o `beds24_id`, a classificação e `respondido_em`. | O mesmo, sem mudar a situação: a operação continua `enviando` até a fase 3 (3.4). | |
| O token e o tempo antes do POST | "Logo antes do POST: confere a pausa de novo e grava `enviado_em`." | Antes do UPDATE de `enviado_em` (`antesDoPost`): a pausa e o imóvel relidos; o token obtido ou renovado (`prepararToken`, no contrato `EscritorReservasBeds24`, separado do escritor do calendário); e pelo menos 90 s restantes (`MINIMO_PARA_O_POST_MS`). A falha do token é falha antes do POST; sem os 90 s, a operação volta a `pendente` sem contar falha, e a volta para por tempo. O POST tem tempo-limite de 30 s; a fase 2, prazo de 120 s (`PRAZO_DA_FASE_2_MS`), levado ao `fetch` do cliente. | Uma renovação que caísse logo antes do POST seria classificada como tempo ou rede: a operação iria a `incerta`, esperaria 5 min e gastaria a única nova tentativa automática sem ter havido POST. |
| A adoção | Na fase 2 ("conferência antes, com a busca pela marca"). | A fase 2 só lê: o registro achado pela busca fica guardado, e a adoção (`adotarReservaCriada`, com a trava, uma transação e a reserva `for update`) roda na fase 3, antes das marcas. | A fase 3 grava o fato externo. |
| A reserva na fase 3 | "imóvel `no key update` → reserva `for update`". | `for update` só quando `reservas.beds24_id` muda (criação, adoção, vínculo); senão, `no key update`. Depois, o cancelamento (`for update`) e as alterações, em ordem de id (um teste confere a ordem pelas consultas). A fase 3 confere que a operação continua `enviando` com o `enviado_em` lido. | Um `FOR UPDATE` sem necessidade bloquearia o `FOR KEY SHARE` dos lançamentos (`pagamentos/travas.ts`). |
| Três tempos fora da fase 2 | Não dizia. | Todo caminho que lê o Beds24 fora da fase 2 (o passo 1 da volta, a cancelada antes de criar, a conferência contínua, os botões do ensaio, "Conferir agora", "Vincular" e "Passar ao sistema") roda em três tempos: uma transação curta valida e faz commit; a leitura corre sem transação aberta; outra transação curta toma a trava (`tentarTravaBeds24`, sem esperar), trava a reserva e revalida antes de gravar. Toda conclusão grava com a situação, o `enviado_em` e os campos do acompanhamento que foram lidos (situação, motivo, versão, contador e `atualizado_em`); com 0 linhas, é descartada. | Nunca há trava de imóvel ou de reserva aberta durante um `fetch`: o pagamento do site pega o imóvel com `lock_timeout` e responderia "ocupado". A Vercel pode entregar o mesmo disparo duas vezes, e o botão pode rodar junto com a rotina: sem a revalidação, duas conclusões seriam aplicadas à mesma operação. |
| A `enviando` vencida | Três casos (com `beds24_id`; sem ele e com `enviado_em`; sem `enviado_em`). | Mais dois: `atualizar` e `cancelar` com `enviado_em` saem só pela releitura por id (3.8); o ensaio vencido, com ou sem id, passa a `incerta` (`passarEnviandoVencidasAIncerta`), e só "Conferir o ensaio" o resolve (8). A vencida sem `enviado_em` volta a `pendente` e tira o acompanhamento de `em_envio` (`devolverVencidasSemPost`); esse passo e `encerrarTerminadas` só rodam com a trava livre. | O ensaio vencido com id ficaria `enviando` para sempre, e a regra "com `beds24_id`, fase 3" pede uma reserva, que o ensaio não tem. |
| Os módulos | `beds24/reservas-site.ts` (`enviarReservasDoSite`). | `beds24/reservas-site-envio.ts` (o trabalhador: as fases, a fila, criar, atualizar, cancelar, a saída do que está em curso e a cancelada antes de criar); `beds24/reservas-site-ocupacao.ts` (`classificarOcupantes`, `lerOcupantes`, `noitesNovas`); `beds24/reservas-site-rotina.ts` (o estado da rotina e o motivo de configuração); `beds24/reservas-site-conferencia.ts` (4.5); `beds24/reservas-site-avisos.ts` (o e-mail e o Início); `beds24/reservas-site-ensaio.ts` (8); `beds24/cron-reservas.ts` (9); `beds24/reservas-site-botoes.ts` (os botões da ficha). `quartoAcessivelEmBrl` fica em `beds24/configuracao.ts`, usada pela importação e pelo trabalhador. `reservas-site.ts` guarda a busca, a adoção (dividida em funções compartilhadas), `vincularRegistro` e a importação. | Uma regra, um lugar, sem o trabalhador importar a importação. |

Objetivo final, o mesmo: o fato externo nunca se perde, e nenhum impasse com o pagamento ou com o motor.

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

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| Onde mora a classificação | A tabela de resultados, sem lugar para guardar a classificação. | Na coluna `beds24_reservas_operacoes.resposta` (3.2), uma lista fechada de 14 códigos, `RESPOSTAS_BEDS24`, em `beds24/tipos.ts` (o tipo da resposta do cliente precisa deles; nas regras, o tipo criaria um ciclo e faria `http.ts` e `normalizar.ts` carregarem contratos e financeiro): `criada`; `modificada` (o sucesso do `atualizar` e do `cancelar`, com o id enviado); `sem_id`; `recusada_disponibilidade`; `recusada`; `http_4xx` (outro 4xx, fora 401, 403 e 429); `tempo`; `rede`; `http_5xx`; `formato`; `limite`; `http_403`; `http_401`; `nao_enviado`. O corpo do pedido e a classificação ficam em `beds24/normalizar.ts` (`corpoDaGravacaoReserva`, que valida antes de qualquer rede, e `classificarGravacaoReserva`), iguais no cliente HTTP (`ClienteReservasBeds24Http.gravarReservas`, que nunca lança) e na versão falsa. As duas escritas ficam separadas pelo tipo: o escritor do calendário não tem `gravarReservas`, e o cliente das reservas recusa `escreverCalendario` (teste 19). | Uma regra para o cliente de verdade e para os testes; a chave das reservas nunca liga o calendário, e o contrário também vale (2.4); e a saída da incerteza precisa saber, na volta seguinte, o que o POST respondeu. |
| O texto do erro | "Mensagem segura." | O `erro` é um texto fixo por código (`TEXTOS_DE_ERRO_BEDS24`), nunca o texto livre do Beds24. A recusa por disponibilidade é reconhecida pela mensagem, que não é guardada. | A recusa de disponibilidade pode trazer dados de outra reserva. |
| O 429 | "HTTP 429 com corpo que não é a lista de itens: volta a `pendente` e interrompe a volta." | Só o 429 sem a lista é `limite`: a operação vira `falhou` (com a `resposta` e o `enviado_em`) e nasce outra `pendente`, com `versao+1` e sem atraso; a volta para; não conta como falha. O 429 com a lista é classificado pelo item, como o 201 e o 200; o `success: true` dentro dele é `sem_id` (sucesso duvidoso). | Nunca se limpa `enviado_em`, a prova do POST (3.3 e 5.2). |
| O token e o 401 | "HTTP 401 repetido depois da renovação: `recusada`/`sem_permissao`." | No token (o inicial e a renovação depois do primeiro 401): o 4xx fora o 429 é `http_401` (`recusada`/`sem_permissao`, sem busca; a volta para); o 429 é `limite`; o 5xx, a rede, o tempo e o prazo já acabado antes de sair são `nao_enviado` (nada foi processado: a linha fica `falhou`, com o `enviado_em`, e nasce a versão nova, com o atraso das falhas). Também são `nao_enviado` o item inválido e o cabeçalho inválido, conferidos antes de qualquer rede. A mesma regra vale para as leituras da volta (`paradaPelaRecusa`): o 429 para por limite; outro 4xx, por falta de permissão; sem status ou com 5xx, não para. O prazo acabado antes de uma leitura lança o erro de configuração, sem chamar a rede. | O primeiro POST que voltou 401 não foi processado; o 429 do token também é limite de uso (pedir token gasta crédito). A renovação recusada também chega pela primeira leitura da volta. |
| `sem_id` | "`incerta`: procura antes de qualquer coisa", e a nova tentativa por tempo, rede ou 5xx. | Não achado, vai a `aguardando_equipe`/`incerta`, sem segundo POST; "Vincular" ou "Não existe, pode criar" ficam com a equipe. | O Beds24 disse que gravou; um segundo POST arriscaria a duplicata. |
| "No máximo uma nova tentativa por intenção" | Sem definição. | `jaHouveNovaTentativa`: existe, para a reserva, uma operação do mesmo tipo em `falhou`, com POST, com a resposta de tempo, rede, 5xx ou formato (qualquer uma), a mesma assinatura e sem `detalhe.encerradaPelaEquipe`. O `limite` e o `nao_enviado` não contam. O atraso da nova tentativa é o da próxima falha (`atrasoDaFalha(tentativas + 1)`), sem contar a tentativa: a incerteza não é falha. | Contar só a mesma resposta permitiria uma tentativa por tipo (tempo, depois rede, depois 5xx). |
| A saída do `atualizar` e do `cancelar` | Não havia: a saída era a da criação, com a busca e a adoção. | Só pela releitura por id (`saidaDaIncertezaPorId`): igual ao pedido, a fase 3, na hora; igual ao `antes` (o registro relido na fase 2) e 5 min depois de `enviado_em`: sem resposta legível, uma nova tentativa (a mesma regra de cima), depois de uma recusa, `recusada`, senão a equipe (`incerta`); sem o `antes` gravado, a equipe, depois de 5 min; não encontrado, `apagada_no_beds24` só com a credencial guardada igual à atual e o quarto acessível em BRL (`podeConcluirApagada`), senão `aguardando_equipe`/`sem_permissao`; outra coisa, `divergente` com o motivo; a releitura falhou, sem conclusão. A criação já aceita (a `feita`, ou a `enviando` vencida com o id) sai pela mesma releitura, sem os 5 min nem nova tentativa (`saidaDaFeitaPorId`). | A adoção só muda operações `criar` e exige `confirmada`: sem esta saída, toda atualização e todo cancelamento sem resposta ficariam `incerta` para sempre, e o índice `uma_ativa` barraria o seguinte. A recusa: sem ela, cada nova tentativa recusada abriria outra, sem fim. |
| O ocupante exato (item 5) | "o ocupante bate exatamente (quarto, chegada, saída, origem direta ou API)". | Um registro `confirmed` ou `new`, no mesmo quarto, com a mesma chegada e a mesma saída, sem marca legível, com a origem de 3.5, o único ocupante das noites e nunca o ensaio; e só com uma `criar` anterior desta reserva com POST e sem id (as respostas não processadas, `limite`, `nao_enviado`, `http_401` e `http_403`, não contam). Conferido antes de qualquer "não achou". Na saída da incerteza, `aguardando_equipe`/`incerta` com o id em `detalhe.candidato`, e a operação continua `incerta`. Numa `criar` nova (a versão nascida depois da incerteza), a operação vira `divergente` com o candidato. O id nunca vai para `beds24_id`. | Sem o POST anterior, uma reserva direta que a equipe criou à mão viraria "incerta"; sem a origem, uma venda dupla real deixaria de ser "possível venda dupla". |
| O contador da incerteza | "`buscas_sem_conclusao`; 'Tentar de novo' não zera." | Toda conclusão o zera (a adoção, a recusa, a divergência, a conferência, a nova versão); "Não existe, pode criar" e "Vincular" também; "Tentar de novo" continua sem zerar. Na terceira busca sem conclusão, `aguardando_equipe`/`incerta` (`buscaSemConclusaoBeds24`). O passo 1 da volta pula as reservas em `aguardando_equipe`: a equipe decide, e "Conferir agora" relê na hora. | O contador é da incerteza de agora. Reler a cada volta o que espera a equipe só gastaria créditos. |

Objetivo final, o mesmo: nunca duas reservas no Beds24 para a mesma reserva do SCL, e nenhuma incerteza sem saída.

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

**Registro da implementação (M8.3c, 17/10/2026).** A classificação é pura, `classificarOcupantes`, e a leitura é `lerOcupantes`, as duas em `beds24/reservas-site-ocupacao.ts`; o ensaio usa a mesma leitura.

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| A leitura das reservas que ocupam as noites | "as reservas do quarto em todas as situações menos `cancelled` e `inquiry`". | `chegadaDe: "1900-01-01"` explícito, `chegadaAte` = saída − 1, `saidaDe` = chegada + 1, o quarto e os info items; as noites que o M3.7 marcou como dele (`beds24_calendario_enviado`, blackout, o mesmo quarto) e os bloqueios do SCL vindos do Beds24 entram na classificação. | Sem o filtro de chegada, só vêm as reservas futuras **[C]** (`yaml:168`), e uma reserva que já começou não apareceria. |
| Leitura incompleta | Não dizia. | Nunca dá `livre`: com divergência na leitura, id repetido, a mesma noite duas vezes diferente ou uma noite faltando no calendário, a leitura não conclui (falha antes do POST, com o atraso das falhas). | `normalizarCalendario` descarta a faixa inteira com um valor inválido, e a reserva com situação desconhecida vai às divergências: juntas, concluiriam "nada" sobre uma noite ocupada. |
| Quarto e moeda (item 1) | "quarto acessível e moeda BRL". | A mesma regra da importação, num lugar só (`quartoAcessivelEmBrl`, em `beds24/configuracao.ts`), lida uma vez por volta, antes da fase 1. Sem ela, a reserva fica `pendente`/`sem_vinculo`, sem tentativa nem e-mail (2.4). | |
| A marca achada (item 2) | "Se achar, adota e não cria." | Achado nosso: a fase 3 adota e confere (sem a releitura do calendário, porque nada foi escrito). Duplicada, ou marca em registro que não bate: a operação vira `divergente`, com os ids em `detalhe.duplicadas`, e o acompanhamento `aguardando_equipe` com o motivo, sem POST. | |
| O resultado (item 3) | A lista. | `noites_ocupadas` (outra reserva): acompanhamento e operação em `conflito`, sem envio, e o e-mail "Possível venda dupla…". `bloqueio_manual`, `bloqueio_do_scl` e `sem_disponibilidade`: acompanhamento `aguardando_equipe` e operação `conflito`, sem envio e sem e-mail. O ocupante exato, só com as condições de 3.8. A reserva própria fica de fora pelo id (na atualização). Nada fica ativo, e o sistema nunca cancela, move nem reembolsa nada sozinho. | O e-mail é para o que pede alguém logo; o bloqueio e a falta de disponibilidade antes do POST não mandaram nada ao Beds24. |
| `checkAvailability` (item 4) | Segunda barreira. | Vai sempre `true` na criação. A recusa conhecida pela mensagem é `recusada_disponibilidade`; o formato real dela segue **a confirmar** (12, item 2): na dúvida, `recusada`. | |

Objetivo final, o mesmo: nada é criado sobre noites ocupadas, e a leitura que não se completou nunca vira "livre".

### 4.2 Antes de atualizar
- Confere só as **noites novas** (as que entram e não estavam no Beds24), com a mesma regra. A reserva do próprio SCL não conta como ocupante.
- **[I]** A API não confere disponibilidade na alteração: `checkAvailability` vale só para reserva nova. Por isso a leitura antes é obrigatória.
- Noites novas vendidas no meio por uma OTA viram `conflito`, e nada é enviado. Essa corrida já existe hoje: as noites novas só são conferidas ao preparar a alteração (`pagamentos/alteracao.ts:640`).
- O registro do id precisa ter a marca, situação `confirmed` ou `new` e o quarto guardado. Senão: `divergente`.
- Se a credencial foi trocada desde a criação, relê por id com a credencial nova antes de escrever. Sem acesso: `aguardando_equipe`, motivo `sem_permissao`.

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| A base das noites novas | "as que entram e não estavam no Beds24". | `noitesNovas(antes, pedido)`: as noites do pedido menos as do registro relido por id na fase 2 desta operação (a mesma leitura que confere a marca, a situação e o quarto); nunca o `esperado`, o `pedido` anterior nem o `lido` guardado. | Depois de uma `mudada_no_beds24`, um "Reenviar" com outra base não conferiria as noites que o Beds24 deixou livres, que podem ter sido vendidas numa OTA, e o Beds24 não confere a disponibilidade na alteração. |
| O registro relido | "a marca, `confirmed` ou `new` e o quarto guardado; senão `divergente`". | O mesmo, com o motivo: cancelado no Beds24, `cancelada_no_beds24`; outra situação ou outro quarto, `mudada_no_beds24`; sem a marca desta reserva, o motivo da marca (`marca_ilegivel` ou `mudada_no_beds24`). Nada é enviado. | |
| O id que não voltou | "Se a credencial foi trocada … Sem acesso: `aguardando_equipe`/`sem_permissao`." | `apagada_no_beds24` só com a credencial guardada no acompanhamento igual à atual e o quarto acessível em BRL (`podeConcluirApagada`, a mesma regra do cancelamento e da conferência contínua); senão, a operação vira `falhou` e o acompanhamento `aguardando_equipe`/`sem_permissao`, sem e-mail (nada saiu). | A troca de token para outra conta faria todos os ids sumirem. |
| Depois do POST | 4.4. | O sucesso é `modificada`; a releitura por id e a releitura do calendário das noites novas (o overbooking) vêm logo depois. O conflito das noites novas manda o e-mail "Possível venda dupla: a mudança da reserva … encontrou noites novas ocupadas por outra reserva no Beds24. O sistema não mudou as datas da reserva no Beds24." | A reserva já está no Beds24: o texto da criação ("O sistema não criou nada") estaria errado. |

Objetivo final, o mesmo: a mudança de datas nunca põe a reserva por cima de noites vendidas no meio.

### 4.3 Antes de cancelar
| O que a leitura do id mostra | O que o sistema faz |
|---|---|
| Registro `confirmed` ou `new`, no quarto guardado, com a marca | Cancela |
| Registro já `cancelled` | Só confere e marca |
| Registro não encontrado (apagado) | `divergente`, motivo `apagada_no_beds24`. Não marca: a equipe confere se as datas estão abertas. |
| `black` ou outro quarto | `divergente` |

**Duplicadas:** cancela também toda outra reserva com a mesma marca, `confirmed` ou `new`, no quarto guardado. Qualquer outra coisa vira aviso.

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| Quais duplicadas são canceladas | "toda outra reserva com a mesma marca, `confirmed` ou `new`, no quarto guardado". | Só as nossas (3.5: o info item `SCL` e a origem do SCL), vivas e no quarto guardado. Os ids vão para `detalhe.duplicadas` num UPDATE simples **antes** do primeiro POST, e para a auditoria. Um POST cada, e cada um conta no limite de 10 da volta; uma operação nunca é dividida, então uma volta pode passar de 10 POSTs. A resposta do registro principal decide o desfecho. | Uma reserva de OTA com o código no info item ou nas notas nunca é nossa: cancelá-la no Beds24 liberaria o estoque sem cancelar na OTA. |
| Antes de marcar as datas reabertas | "Cancela" e marca. | Antes de `ota_liberada_em` e de `encerrada` (também na retomada de uma queda entre dois POSTs), a releitura de todos os ids e uma busca nova pela marca no quarto não podem mostrar registro vivo com a marca. Com uma duplicada nossa viva: a operação fica `feita` e o acompanhamento `aguardando_equipe`/`duplicada`, com os ids. Com um registro vivo com a marca que não é nosso: `aguardando_equipe`/`marca_em_registro_inesperado`, com os ids, e o sistema nunca o cancela. "Conferir agora" repete a mesma conferência depois de a equipe cancelar no Beds24. | Marcar as datas reabertas com uma reserva viva fecharia as OTAs sem ninguém saber. |
| Registro não encontrado | `divergente`/`apagada_no_beds24`. | Só com a credencial guardada igual à atual e o quarto acessível em BRL; senão, `aguardando_equipe`/`sem_permissao`, sem mexer em `ota_fechada_em`. | A troca de token para outra conta, ou o imóvel sem acesso, faz todos os ids sumirem. |
| Registro já `cancelled` | "Só confere e marca". | Igual, sem POST, com as mesmas conferências antes da marca (os vivos com a marca e o bloqueio que sobrou) e sem auditoria de escrita. | |
| Datas mudadas por fora | Não dizia. | O registro nosso, confirmado e no quarto guardado, com outras datas: o cancelamento sai, e a conferência depois termina `divergente`/`mudada_no_beds24`, sem a marca das datas reabertas. | Nunca concluir em silêncio sobre um registro que mudou. |
| `black` ou outro quarto | `divergente`. | `divergente`/`mudada_no_beds24`, sem POST. | |
| O bloqueio que sobrou | 4.4: "a leitura confirma que não sobrou `black` nem blackout que não seja do SCL". | Conferido só nas noites a partir de hoje. Se sobrou, nada é marcado: o acompanhamento vira `manual`/`bloqueio_manual`, com as datas em `detalhe.bloqueio`, e a tarefa da cancelada diz "Mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague)", com as datas achadas, mesmo na reserva que o sistema criou (`reservas-site-tarefas.ts`); a marca "Datas reabertas nas OTAs" (M8.2c) fecha a tarefa. | Só as noites que ainda vão acontecer importam para reabrir as OTAs. |
| A auditoria | 3.6: `beds24.reserva.cancelar` na fase 3. | `beds24.reserva.atualizar` e `.cancelar` são gravadas uma vez só, logo depois do aceite (`auditarEscritaAceita`), com as datas e as pessoas de antes e de agora, ou com a situação e as duplicadas; a saída por id que conclui o aceite passa a operação a `feita`, para não auditar de novo. | O fato externo fica registrado mesmo quando a conferência depois não conclui. |

Objetivo final, o mesmo: as datas só voltam à venda nas OTAs quando nada do SCL ficou vivo no Beds24 sobre elas.

### 4.4 Depois de cada escrita
- Relê por id e compara quarto, entrada, saída, pessoas, situação (`confirmada` ou `cancelada`) e marca:
  - tudo igual: `conferida`, e as marcas de 6.3;
  - algo diferente: `divergente`, com aviso.
- Reserva nossa relida **sem a marca:** `divergente`, e o motivo de configuração `marca_ilegivel` para as criações novas.
- **Overbooking:** `livres < 0` na releitura do calendário vira aviso de atenção e e-mail **[C]** (`numAvail` "may be negative… if a room is overbooked", `yaml:5872`).
- **Antes de gravar `ota_liberada_em`:** a leitura confirma que não sobrou `black` nem blackout que não seja do SCL sobre as noites.
- A conferência mostra o que o Beds24 gravou, não o que a OTA mostra. **[C]** O envio às OTAs leva em média menos de 1 minuto (Channel_Manager_Capabilities:38, 46), com a ressalva de "within 24 hours if nothing else changes" (Cat:751-753).

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| O overbooking | "`livres < 0` na releitura do calendário vira aviso de atenção e e-mail". | Depois de cada escrita certa (na criação, todas as noites; na atualização, as novas), a releitura do calendário com `livres < 0` deixa o acompanhamento `conferida`, com as marcas e `ota_fechada_em`, e com o motivo `noites_ocupadas`: a atenção no Início e o e-mail de texto próprio, "O Beds24 informa overbooking nas noites de dd/mm a dd/mm da reserva SCL-XXXXXX, que o sistema criou: resolva com o hóspede ou com o canal." A atualização, o cancelamento e a conferência contínua seguem. O motivo volta a nulo quando "Conferir agora" relê o calendário com `livres >= 0` nas noites. `numAvail` negativo passa a ser lido (seção 1). | `conflito` quer dizer "nada foi enviado" (3.4) e suspenderia a atualização; a nossa reserva está certa. O texto da 4.1 ("O sistema não criou nada") estaria errado. |
| O calendário que não concluiu | Não dizia. | Com o registro relido certo e a leitura do calendário que falhou, a conferência fica sem conclusão (nunca `conferida` sem o calendário); a saída seguinte, ou "Conferir agora", lê de novo. | Avisar em vez de supor: concluir sem o calendário deixaria um overbooking sem aviso para sempre. |
| A releitura sem a marca | `divergente`, e `marca_ilegivel` para as criações novas. | O mesmo. Ao dar `divergente`, a volta reavalia a configuração na hora (`motivoDeConfiguracaoDasReservas`): com `marca_ilegivel`, as criações seguintes param na mesma volta. O `marca_ilegivel` só conta fora de `manual` e `encerrada` e com a saída a partir de hoje (`existeMarcaIlegivelQueConta`, a mesma regra no painel de Integrações). | Um `marca_ilegivel` de estadia já terminada não para as criações para sempre (a volta o encerra, 3.4). |
| A divergência e a marca das datas fechadas | 5: "`ota_fechada_em` volta a vazio se a divergência for de datas, situação ou quarto". | Vale também na conferência da criação, como na importação. Com só as pessoas, ou só a marca, diferentes, `ota_fechada_em` fica. | |
| A criação que não pôde ser relida | Não dizia. | A operação fica `feita`, com o id já gravado na reserva; a saída seguinte relê pelo id e faz a fase 3 que faltou. | |
| Antes de `ota_liberada_em` | "a leitura confirma que não sobrou `black` nem blackout" | 4.3 ("O bloqueio que sobrou"). | |

Objetivo final, o mesmo: o que o Beds24 gravou é conferido depois de cada escrita, e o overbooking vira atenção, nunca um "nada foi enviado".

### 4.5 Conferência contínua (não depende da importação)
- **A cada volta**, se houver acompanhamento `conferida` com saída a partir de hoje: um `GET /bookings` com `modifiedFrom` igual à última leitura menos 15 min. O leitor já aceita esse filtro (`beds24/http.ts:91-110`), e a criação também grava a hora de modificação **[C]** (`yaml:277-281`). A busca usa as propriedades dos acompanhamentos, todas as situações e `includeInfoItems=true`, e pega mudança e cancelamento feitos por fora.
- **De hora em hora:** releitura por id, em lotes de 50 (padrão de `sincronizacao.ts:67-69`), de todas as reservas `conferida` com saída a partir de hoje. Pega reserva apagada, que **[I]** não aparece em `modifiedFrom`.
- **A importação diária**, quando ligada, também confere (5.2), sem custo extra. Hoje ela está desligada em produção (2.4).
- O custo entra no limite de créditos (seção 9).

**Registro da implementação (M8.3c, 17/10/2026).** A conferência contínua é `conferirContinuamente`, em `beds24/reservas-site-conferencia.ts`, o passo 5 da volta (9).

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| Quem é acompanhado | "acompanhamento `conferida` com saída a partir de hoje". | `conferida` e `divergente`, com a saída a partir de hoje (São Paulo). | Para a saída do `divergente` que voltou a bater (3.4). |
| A leitura por `modifiedFrom` | "igual à última leitura menos 15 min". | A última leitura que **concluiu** menos 15 min; na primeira vez, agora menos 24 h. As marcas de tempo ficam em `beds24_reservas_rotina` (`conferencia_em` e `releitura_em`, 3.2) e só avançam quando a leitura conclui. | Uma leitura que falhou no meio não pode avançar a janela e perder uma mudança. |
| A releitura por id | De hora em hora, em lotes de 50. | Também quando a última leitura que concluiu tem mais de 24 h (ou nunca houve), porque a janela de `modifiedFrom` não volta além disso. `relerPorIds` é a mesma função da importação, extraída de `beds24/sincronizacao.ts`, com as mesmas proteções: o id repetido para tudo; o registro ilegível ou sem dono não conclui (e o ilegível não é pedido de novo na releitura). | Uma regra para a importação e para a conferência. |
| O id que não voltou | "Pega reserva apagada". | `apagada_no_beds24` só com a credencial guardada igual à atual e o quarto acessível em BRL (`podeConcluirApagada`, a regra do trabalhador); senão, `aguardando_equipe`/`sem_permissao`, sem mexer nas datas fechadas. | `conferirNaImportacao` com o registro nulo limparia a marca, e o Início mandaria a equipe fechar à mão as datas de reservas que existem. |
| O que o M8.3c acrescenta à regra da importação | Só a regra da importação (5.2). | O e-mail na transição para `divergente` (`conferirNaImportacao` zera `avisada_em` na transição, também na importação; o e-mail sai depois, pela rotina) e a saída do `divergente` para `conferida` (`conferirReservaLigada`, exportada também para "Conferir agora"). | Um e-mail anterior (o do overbooking, por exemplo) impediria o da divergência. |
| A gravação | Não dizia. | Em três tempos (3.6), por reserva, com a trava `beds24:<org>` sem esperar (ocupada, a conferência para e fica para a volta seguinte) e a revalidação antes de gravar. As janelas da importação e do envio diários valem antes de cada leitura e de cada gravação. | |
| Na volta | "O custo entra no limite de créditos." | Roda depois dos envios, também depois dos 10 POSTs, se ainda houver tempo; o 429, o 401 e o 403 param a volta. O passo 1 não tem a saída do `divergente`: a conferência contínua cobre na mesma volta. | |

Objetivo final, o mesmo: a mudança feita por fora no Beds24 vira aviso em minutos, mesmo com a importação automática desligada.

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
| b, registro sem dono na releitura (revisão do Codex, 16/10; varredura do M8.3a, 17/10) | Na releitura por id, um registro de um id que não foi pedido, legível ou em formato inválido, ou sem id legível, era ignorado; os ids pedidos que não voltaram legíveis eram conferidos como apagados. Em 16/10, o registro sem dono deixava sem conclusão só o lote dele (a releitura vai em lotes de 50). | Qualquer registro sem um id pedido no lote, legível ou não, em qualquer lote, deixa a releitura inteira sem conclusão: nenhum id que não voltou é conferido como apagado, e a importação dá um aviso só, além do aviso de cada reserva do site ligada ("não voltou na releitura, e a resposta trouxe registro que não foi pedido ou que não deu para ler"; não "formato inválido", que fica para o registro que voltou ilegível). | O registro ilegível pode ser qualquer um dos ids pedidos, inclusive de outro lote: o 555 pedido no lote 1, que volta no lote 2, não foi apagado. Contar a ausência como apagado fazia uma reserva do site ligada virar `apagada_no_beds24` e perder a marca das datas fechadas, com o registro lá. |
| Id repetido na leitura e na releitura (varredura do M8.3a, 17/10) | Só a leitura do período parava com um id repetido, e só com as duas cópias legíveis. Na releitura por id, a última cópia valia; com uma cópia legível e outra em formato inválido, a legível valia. | O mesmo id duas vezes, legível ou em formato inválido, na leitura do período ou em qualquer lote da releitura (um lote ou dois), para a importação inteira, sem aplicar nada, com a mensagem de sempre ("Consulta com IDs de reserva repetidos"). O id que voltou legível na leitura do período e volta de novo na releitura (sem ser pedido) também conta. O "?" de um registro sem id não conta como id. | Com duas cópias, não dá para saber qual vale: as duas ordens davam conclusões opostas (`conferida_em` gravado ou `cancelada_no_beds24` com a marca das datas fechadas limpa). Uma regra só para as duas leituras. |
| b, a marca do registro ligado (varredura do M8.3a, 17/10) | A conferência comparava só quarto, datas, pessoas e situação: o registro ligado sem a marca do SCL, ou com o código de outra reserva, ganhava `conferida_em`. | Sem marca legível (`referenciaScl` nulo: o info item apagado, a credencial que não lê os info items, ou dois códigos): nunca `conferida_em` e, quando o Beds24 deveria estar igual, `divergente` com `marca_ilegivel` (o painel passa a mostrar a marca como não legível, e as criações param, 4.4). Com o código de outra reserva ou a marca do ensaio: `mudada_no_beds24` (marca alterada, 3.4). Com as datas, a situação e o quarto iguais, a marca das datas fechadas fica. Com um envio a fazer ou em curso, só a leitura, como nas outras diferenças. | D11 ("a falta do info item numa reserva nossa conta como divergente"), 3.4 e 4.4. A importação diária também confere (4.5). |
| c, adoção com registro ilegível na leitura (varredura do M8.3a, 17/10) | A adoção contava só os registros legíveis com a marca: com um legível e outro ilegível (que pode ser outra cópia com a marca), adotava o legível. | Com qualquer registro que não deu para ler ou atribuir (ilegível ou sem dono) na leitura do período ou na releitura, a adoção não conclui: o registro com a marca é pulado, com aviso, e nada muda na reserva, na operação nem no acompanhamento. Os motivos mais certos vêm antes, com o texto deles: sem acompanhamento, duplicada, marca num registro que não bate e id de outra reserva. | A mesma regra da busca (3.5): um registro ilegível pode ser o nosso. "Exatamente um" não dá para conferir com um registro que não se lê. |
| b, ilegível numa leitura e legível noutra (varredura do M8.3a, 17/10) | O id ligado que voltava em formato inválido na leitura do período e legível na releitura era conferido pela cópia legível. | O id ligado a uma reserva do site que voltou em formato inválido em qualquer leitura desta importação não é conferido, mesmo com a outra leitura legível: o aviso de registro ilegível, e nada muda. Para os outros registros, a cópia legível da releitura continua valendo, como antes. | Qual cópia vale? A conferência é a que tem consequência (limpa a marca das datas fechadas, grava `divergente` ou `conferida_em`). |

Na importação, a conferência grava o fato (`lido`, `conferida_em`, `divergente` com o motivo, `ota_fechada_em` vazio quando a divergência é de datas, situação ou quarto). A adoção grava `reservas.beds24_id` e passa a operação de criação a `feita`. A situação `conferida` e as marcas das OTAs (6.3) ficam com o trabalhador do M8.3c.

**Para o M8.3c (varredura do M8.3a, 17/10).** Dois pontos que só valem com a escrita, porque no M8.3a nenhum código cria ensaio nem liga uma reserva do site a um registro do Beds24:
- **Ensaio não resolvido em e:** a operação de ensaio `enviando` ou `incerta`, ou com o POST tentado e sem o id, ainda não protege o quarto e as datas dela (`naoResolvidas` só lê operações de reserva do site). O M8.3c, que cria o ensaio, inclui o ensaio não resolvido em e, para o registro do ensaio sem a marca legível nunca ser importado (5.2 a).
- **Marca ambígua:** dois códigos diferentes na mesma fonte (dois info items `SCL`, ou o nome e as notas) contam hoje como "sem marca" (`referenciaScl` nulo, nunca um dos códigos). Um info item `SCL` com texto inválido é ignorado: vale o código do nome ou das notas, se houver um só; sem nenhum, conta como "sem marca". Um registro sem marca legível, sem vínculo e fora de uma criação não resolvida, é importado como um registro sem marca. O M8.3c separa "ambígua" (dois códigos, ou o info item `SCL` presente e ilegível) de "sem marca" e desvia o ambíguo com aviso.

**Registro da implementação (M8.3c, 17/10/2026).** Os dois pontos acima foram feitos.

| | Antes (o "Para o M8.3c") | Agora (o código) | Motivo |
|---|---|---|---|
| O ensaio não resolvido em e | O ensaio `enviando` ou `incerta`, ou com o POST tentado e sem o id, ainda não protegia o quarto e as datas dele. | `prepararDesvioNaImportacao` põe em e o quarto e as noites de todo ensaio não resolvido, com o aviso próprio, numa consulta separada (`ensaioNaoResolvidoNoBanco`, em `beds24/reservas-site.ts`, a mesma condição da regra pura `ensaioNaoResolvidoBeds24`): teve POST (`enviado_em`), não está fechado (`SITUACOES_ENSAIO_FECHADO`: `conferida`, `falhou`, `recusada`, `conflito` e `superada`) e o registro não foi relido como `cancelled` (`depois`). Entram a `feita` (entre os dois botões do ensaio), a `incerta`, a `divergente` e a `enviando`. A importação continua pulando o registro cujo id está numa operação de ensaio (a). A mesma regra vale para a guarda de um ensaio por vez e para Integrações (8). | A definição do plano do M8.3c, "sem `depois` cancelado", deixaria o ensaio que "Conferir o ensaio" fechou como "nada criado" não resolvido para sempre, e a guarda de um ensaio por vez impediria o "Ligar". Com "não terminal" em vez dela, um ensaio `divergente` com o registro vivo cairia fora de a e de e, e a importação o traria como reserva. |
| A marca ambígua | Contava como "sem marca". | `desvioNaImportacao` desvia o registro com a marca ambígua (`ReservaBeds24.marcaAmbigua`, 3.5), com aviso, e nunca o importa nem o adota. | |
| A adoção na importação | As regras de 3.5. | A regra nova de 3.5 (o info item e a origem do SCL), a mesma do trabalhador e de "Vincular" (`regraDeAdocao`). | Uma regra, um lugar. |
| A divergência na importação | Gravava o fato. | Também zera `avisada_em` na transição para um caso de e-mail (4.5). | |

Objetivo final, o mesmo: a importação nunca cria, sobrescreve nem esconde a reserva do site, nem traz o ensaio como reserva.

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

**Registro da implementação (M8.3b, 17/10/2026).** (A situação da entrega está no começo do documento e na seção 13.) Os pontos abaixo ficaram diferentes do texto acima ou mais precisos que ele. O objetivo final é o mesmo: uma função, um lugar, para o que a equipe faz à mão nas OTAs, e o aviso manual nunca ao lado de uma instrução contrária para a mesma reserva.

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| Assinatura | `tarefasDasOtas(db, org, agora)`. | `tarefasDasOtas(db, org, agora, env, { reservaIds? })`, em `beds24/reservas-site-tarefas.ts`. O `env` vem de quem chama: o Início passa `process.env`; `carregarDashboard` sem `env` usa `{}`, que deixa tudo à mão. `reservaIds` limita a leitura às reservas pedidas (a ficha). | O ambiente diz se o envio automático está ligado. A regra do M8.3 é o ambiente sempre explícito, e o lado seguro quando ele falta. A ficha usa a mesma função do Início, só para aquela reserva. |
| O que ela alimenta | Os três avisos do Início (paga, cancelada e alterada), o bloco da ficha, a carência e os textos. | Os avisos das OTAs no Início em quatro casos: paga, D3 (confirmada à mão sem pagamento pelo site, numa linha própria), cancelada e alterada. Mais a D3 cancelada pelo "Cancelar reserva" comum depois da marca (6.4 e 11). Também o bloco "No Beds24" da ficha e o texto do que fazer nos quadros do cancelamento e da alteração pagos pelo site. Os avisos antigos saíram de `pagamentos/consultas.ts` (paga e cancelada) e de `painel/dashboard.ts` (alterada). | A D3, decidida em 16/10, e "uma regra, um lugar". `pagamentos/*` continua sem importar `@/beds24/*` (3.1). |
| Quem vê | Quem tem `reserva:editar`. | Igual: admin e `operacao`, da empresa toda, sem valores em nenhum texto. Antes do M8.3b, o aviso da paga só aparecia para quem lê o financeiro. Proprietário, limpeza e hóspede não veem nada disso. | Como no texto acima. |
| Agrupamento no Início | Não dizia. Os avisos de antes eram uma linha por tipo: a da cancelada (M8.2c) e a da alterada (M8.2d) com os códigos; a da paga (M8.2a) só com o número ("N reserva(s) do site paga(s): feche as datas nas OTAs (no Beds24, como bloqueio)."). | A paga e a D3 agrupadas, uma linha cada, com até 5 códigos e "e mais N". A cancelada e a alterada, uma linha por reserva, com as datas dela. O link leva à ficha (uma reserva) ou à lista de reservas (várias). Ordem: atenção, depois o que a equipe faz à mão, depois os informativos. Os textos estão em 6.2. | No deploy aparecem de uma vez todas as pagas e D3 com a estadia por vir. O texto da cancelada e o da alterada levam as datas daquela reserva. Todo texto leva um código ou uma contagem, porque ele é a chave da lista no Início. |
| Linhas de atenção | Ficam em `avisosDeReservasNoBeds24` (6.5), com e-mail e o link `?beds24=atencao`. | No M8.3b, linhas mínimas dentro de `tarefasDasOtas`, porque o teste 18 precisa delas: conflito (possível venda dupla), divergente, aguardando a equipe, a reserva ligada a um registro do Beds24 que o sistema não criou, e as atrasadas, agrupadas. Os informativos: "N reserva(s) do site sendo enviadas pelo sistema: não feche à mão." e o da transição (bloqueio feito à mão sobre as noites, motivo `bloqueio_manual`, 6.6). Uma atenção tira todas as tarefas daquela reserva. O e-mail, o filtro `?beds24=atencao`, `avisosDeReservasNoBeds24` e a linha única de configuração ficam no M8.3c. | O M8.3b não escreve, então não há falha, recusa nem incerteza de envio a mostrar. Em produção hoje, sem o envio ligado, só aparecem as tarefas à mão. |
| Relógio da carência | 30 min "desde a intenção". | 30 min (`CARENCIA_ENVIO_RESERVA_MINUTOS`) desde a hora do fato: o pagamento que confirmou (`pagamentos.desfecho_em`, o mais antigo; na D3, `reservas.confirmada_em`), o cancelamento (`cancelamentos_reserva.cancelada_em`; na D3 cancelada, `reservas.cancelada_em`) ou a última alteração aplicada sem a marca (`max(aplicada_em)`). Sem a hora do fato, conta como atrasada. | Não há coluna com a hora da intenção, e guardar uma pediria migração. Sem a hora, avisar em vez de supor. |
| Depois de "Retomar" | Não dizia. | Limite: não há hora guardada do "Retomar" nem da intenção. Quando o envio volta, as tarefas cujo fato tem mais de 30 min vão direto a "atrasadas". O M8.3c pode guardar a hora. | O relógio é o do fato (linha acima). |
| Janela automática sem linha de acompanhamento | A tabela começa em `pendente` ou `em_envio`, com a linha já criada; pela 3.1, quem cria a linha é a rotina. | Sem linha, a paga com a chave pronta, sem pausa e com o imóvel ligado lê a régua da seção 2. Se a criação sairia (`criar`) ou a mesma intenção já espera o envio (`sem_mudanca`), ela conta como "sendo enviada" ou "atrasada", pelo relógio do fato; `ja_no_beds24` vira atenção; o resto fica à mão. No M8.3b isso é inalcançável em produção: ligar um imóvel exige o ensaio, que é do M8.3c. A janela só existe nos testes. | Nos minutos antes de a rotina criar a linha, a paga recém-confirmada não pode aparecer como "feche à mão": a equipe fecharia à mão o que o sistema vai criar. |
| A paga também alterada | Não dizia. | Os dois avisos aparecem. "Datas fechadas nas OTAs" e "Datas atualizadas nas OTAs" (a da alteração) são marcas independentes, e os bloqueios antigos nunca foram marcados. Exceção: quando o sistema está criando a reserva (a paga "sendo enviada" ou "atrasada", que só existe com o envio do M8.3c), a alteração não é outra tarefa, porque a criação leva as datas de agora. | Uma marca não esconde a tarefa da outra. A criação em curso já leva as datas novas. |
| A linha das atrasadas na ficha | "a ficha oferece 'Deixar à mão'". | A ficha diz "O envio desta reserva ao Beds24 está atrasado (mais de 30 minutos): confira o histórico abaixo antes de mexer à mão." Os botões "Deixar à mão", "Tentar de novo" e "Conferir agora" ficam no M8.3c. | Sem o envio, esses botões não teriam efeito. |

**A classificação, como foi implementada** (`classificarTarefa`, pura, nesta ordem):
1. Paga e D3 com a marca das datas fechadas (`ota_fechada_em`, da equipe ou do sistema), ou com o acompanhamento `conferida` ou `encerrada`: nada.
2. A paga criada pelo sistema (`criadaPeloM83`: o acompanhamento guarda o quarto e há um id do Beds24 ligado a ela), ainda sem a marca: nunca "feche como bloqueio", porque ela já está lá. Conflito, divergente ou aguardando a equipe, com qualquer motivo (até o de configuração, como a marca ilegível): a atenção. Senão, o sistema está nela ("sendo enviada" ou "atrasada").
3. Conflito, divergente ou aguardando a equipe, fora de configuração: só a atenção, nunca a tarefa manual.
4. D3, também a D3 cancelada: sempre à mão. Nunca vai ao envio, nem com a chave ligada (a régua responde `sem_pagamento`).
5. Um envio desta reserva sem conclusão (uma operação real `enviando` ou `incerta`, o POST tentado sem o id, ou o acompanhamento `em_envio`): o sistema está nele.
6. Motivo de configuração, acompanhamento `manual` ou `encerrada`: à mão.
7. O envio desligado pelo ambiente, pela chave, pela credencial ou pela pausa: à mão. O imóvel desligado deixa à mão só a criação (a paga).
8. A paga: a régua da seção 2 decide. A criação dá automática; a reserva ligada a um registro que o sistema não criou dá atenção; o resto, à mão.
9. A cancelada e a alterada: o sistema escreve na reserva que ele criou, e é dono da criação que ainda espera o envio (acompanhamento `pendente`, com o imóvel ligado). Essa criação leva as datas de agora e, cancelada antes, nunca sai. O bloqueio feito à mão é sempre da equipe.

Automática: "sendo enviada" até 30 minutos depois do fato; depois, "atrasada". Os cortes de data são os de antes, com hoje em São Paulo: a paga, a D3, a D3 cancelada e a cancelada com a saída depois de hoje; a alterada com a saída (de antes ou de agora) hoje ou depois (o aviso da alterada ainda aparece no dia da saída). Em produção hoje, com a chave e os imóveis desligados, tudo é à mão: só as tarefas manuais aparecem.

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o registro do M8.3b, acima) | Agora (o código) | Motivo |
|---|---|---|---|
| Relógio da carência depois de "Retomar" | Limite: não havia hora guardada do "Retomar" nem da intenção; quando o envio voltava, as tarefas com o fato de mais de 30 min iam direto a "atrasadas". O M8.3c poderia guardar a hora. | A configuração ganha `retomado: { em, por }` (`beds24/reservas-site-config.ts`), gravado por "Retomar" só quando havia pausa (sem pausa, nada muda; a retomada sem data legível não conta). A carência de 30 min (`CARENCIA_ENVIO_RESERVA_MINUTOS`) conta de `max(fato, retomado.em, ligadoEm do imóvel)`. Sem migração. | Logo depois de "Retomar", ou de ligar o imóvel, o sistema ainda vai enviar o que ficou parado: a equipe não deve ver "atrasada" nem "feche à mão" nesses minutos. |
| A chave ligada pela variável da Vercel | — | Continua sem hora registrada: a carência não conta dela. Limite registrado, sem efeito hoje (nenhum imóvel ligado). | A variável não passa pelo sistema; guardar a hora pediria outra fonte. |
| As linhas de atenção | Linhas mínimas dentro de `tarefasDasOtas` e `avisosDasTarefas`. | Saem de lá e passam a `avisosDeReservasNoBeds24` (6.5). `avisosDasTarefas` fica com as tarefas à mão e os informativos; uma atenção continua tirando as outras tarefas daquela reserva. | O aviso de atenção, o e-mail e o filtro saem de uma leitura só. |

Objetivo final, o mesmo: o aviso manual nunca aparece ao lado de uma instrução contrária, nem antes de o sistema ter tido tempo de enviar.

### 6.2 Textos por reserva
O texto depende de `reservas.beds24_id` e do acompanhamento, não da chave:
| Caso | Texto |
|---|---|
| Reserva criada pelo M8.3, cancelamento não enviado | "No Beds24, mude a reserva SCL-XXXXXX para Cancelado (não apague)." |
| Reserva criada pelo M8.3, alteração não enviada | "No Beds24, mude as datas da reserva SCL-XXXXXX para dd/mm a dd/mm." |
| Paga sem reserva no Beds24 | "Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs." |
| Fechada à mão como bloqueio, cancelada | "Mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague)." |
| Fechada à mão como bloqueio, alterada | "Mude as datas do bloqueio para dd/mm a dd/mm (não apague nem crie outro)." |

**Por que "não apague".** Um bloqueio apagado no Beds24 nunca sai do SCL: a ausência só gera o aviso "o registro anterior foi preservado" (`sincronizacao.ts:59-60`, `:71`). Só o que volta como `cancelled` sai (`:135-138`). Hoje, quem segue o texto "apague o bloqueio" deixa as noites fechadas no site para sempre. E uma reserva apagada não pode ser atualizada (Jomres_Plugin:79). **Esta correção vale já, com ou sem o envio ligado.** Desde o M8.3b (17/10/2026, em revisão), nenhum texto do painel diz mais "apague o bloqueio" (registro abaixo, "As linhas atualizadas"). Quem apagou um bloqueio antes disso, seguindo o texto antigo, pode ter deixado as noites fechadas no site: a importação só preserva o registro anterior.

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

**Registro da implementação (M8.3b, 17/10/2026).** (A situação da entrega está no começo do documento e na seção 13.) O objetivo final é o mesmo: o texto certo para cada reserva, num lugar só (`textoDaTarefa` e `avisosDasTarefas`, em `beds24/reservas-site-tarefas.ts`), sempre com "não apague". A correção do "não apague" vale já, com ou sem o envio ligado.

**Os textos usados no Início**, sem valores. "dd/mm a dd/mm" vem de `diaMesBr` da entrada e da saída, o mesmo [início, fim) que a importação guarda para os bloqueios.

| Caso | Texto no Início |
|---|---|
| Paga, à mão (agrupada) | "N reserva(s) do site paga(s) (SCL-…): feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs." |
| D3, à mão (agrupada, numa linha própria) | "N reserva(s) do site confirmada(s) à mão, sem pagamento pelo site (SCL-…): feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs." |
| Cancelada sobre o bloqueio feito à mão, e a D3 cancelada (uma linha por reserva) | "Reserva SCL-XXXXXX, cancelada: mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague)." |
| Alterada sobre o bloqueio feito à mão (uma linha por reserva) | "Reserva SCL-XXXXXX, alterada: mude as datas do bloqueio para dd/mm a dd/mm (não apague nem crie outro)." |
| Criada pelo sistema, cancelada ou alterada | Os textos da tabela do começo de 6.2, sem mudança: "No Beds24, mude a reserva SCL-XXXXXX para Cancelado (não apague)." e "No Beds24, mude as datas da reserva SCL-XXXXXX para dd/mm a dd/mm." Só aparecem quando o sistema criar reservas no Beds24 (M8.3c). |
| Atenção (uma linha por reserva) | Conflito: "Reserva SCL-XXXXXX: as noites estão ocupadas por outra reserva no Beds24 (possível venda dupla). Veja a ficha." Divergente: "Reserva SCL-XXXXXX está diferente no Beds24: veja a ficha." Aguardando a equipe: "Reserva SCL-XXXXXX aguarda a equipe no Beds24: veja a ficha." Ligada a outro registro: "Reserva SCL-XXXXXX está ligada a um registro do Beds24 que o sistema não criou: veja a ficha." |
| Atrasadas (agrupada) | "N reserva(s) do site com o envio ao Beds24 atrasado (SCL-…): confira na ficha." |
| Informativos | "N reserva(s) do site sendo enviadas pelo sistema: não feche à mão." e, por reserva, "Reserva SCL-XXXXXX: há um bloqueio feito à mão sobre as noites no Beds24, e o sistema não cria por cima: veja a ficha." |

**Na ficha**, no bloco "No Beds24", o texto por reserva é o da tabela do começo de 6.2, com uma frase a mais na D3: "Confirmada à mão, sem pagamento pelo site: esta reserva nunca vai ao Beds24 pelo sistema. Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs." Os outros textos do bloco:
- "O sistema está enviando esta reserva ao Beds24: não feche nem mude as datas à mão." (sendo enviada);
- "O envio desta reserva ao Beds24 está atrasado (mais de 30 minutos): confira o histórico abaixo antes de mexer à mão." (atrasada);
- "Nada a fazer à mão nas OTAs para esta reserva agora." (sem tarefa nem atenção).

Os quadros do cancelamento e da alteração pagos pelo site mostram o texto da tarefa desta reserva ao lado dos botões do M8.2c ("Datas reabertas nas OTAs") e do M8.2d ("Datas atualizadas nas OTAs"). Sem tarefa à mão, mostram um texto genérico: "Mude o bloqueio para Cancelado no Beds24 (não apague)." e "Mude as datas do bloqueio no Beds24 para as novas (não apague nem crie outro)."

**As linhas atualizadas** (a lista "Textos a revisar" acima; os números de linha são do commit `adca993`, e os trechos foram procurados pelo texto):

| Onde | Antes | Agora |
|---|---|---|
| `pagamentos/consultas.ts`, aviso da paga (M8.2a) | "N reserva(s) do site paga(s): feche as datas nas OTAs (no Beds24, como bloqueio)." Só para quem lê o financeiro, e nenhuma marca o tirava. | Saiu de lá. O texto da paga acima vem de `tarefasDasOtas` e some com a marca (6.4). |
| `pagamentos/consultas.ts`, aviso da cancelada (M8.2c) | "N reserva(s) do site cancelada(s) (SCL-…): reabra as datas nas OTAs (no Beds24, apague o bloqueio)." | Saiu de lá. Uma linha por reserva: "Reserva SCL-XXXXXX, cancelada: mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague)." |
| `painel/dashboard.ts`, aviso da alterada (M8.2d) | "N reserva(s) do site alterada(s) (SCL-…): mude o bloqueio nas OTAs (no Beds24, feche as novas datas e reabra as antigas)." | Saiu de lá. Uma linha por reserva: "Reserva SCL-XXXXXX, alterada: mude as datas do bloqueio para dd/mm a dd/mm (não apague nem crie outro)." |
| `pagamentos/cancelamento.ts`, as perguntas do cancelamento pela política (com e sem devolução) e do "Cancelar a reserva contestada" | "As datas voltam à venda no site; reabra-as nas OTAs (no Beds24, apague o bloqueio)." e, na sem devolução, "…reabra-as nas OTAs." | "As datas voltam à venda no site; nas OTAs, siga o aviso do Início (no Beds24, mude para Cancelado; não apague)." |
| `pagamentos/alteracao.ts`, as duas frases da alteração | "Depois de aplicada, mude o bloqueio no Beds24: feche as novas datas e reabra as antigas." e "Quando ele pagar, a alteração vale sozinha; depois, mude o bloqueio nas OTAs (no Beds24)." | "Depois de aplicada, mude as datas no Beds24 como o Início mostrar (no mesmo bloqueio: não apague nem crie outro)." e "Quando ele pagar, a alteração vale sozinha; depois, mude as datas no Beds24 como o Início mostrar (não apague nem crie outro)." |
| `components/reservas/CancelamentoSite.tsx` | "reabra as datas nas OTAs (no Beds24, apague o bloqueio)", e a pergunta "Confirmar que as datas desta reserva já foram reabertas nas OTAs (no Beds24, o bloqueio foi apagado)?" | O texto da tarefa (ou o genérico), e a pergunta "Confirmar que as datas desta reserva já foram reabertas nas OTAs (no Beds24, mudadas para Cancelado, sem apagar)?" |
| `components/reservas/AlteracaoSite.tsx` | "mude o bloqueio nas OTAs (no Beds24, feche as novas datas e reabra as antigas)", e a pergunta "Confirmar que o bloqueio desta reserva já foi mudado nas OTAs (no Beds24: novas datas fechadas, antigas reabertas)?" | O texto da tarefa (ou o genérico), e a pergunta "Confirmar que as datas desta reserva já foram mudadas nas OTAs (no Beds24, sem apagar nem criar outro)?" |
| Fora da lista: `pagamentos/contestacao-tela.ts` e `components/reservas/ReservaNoBeds24.tsx` | Na reserva cancelada pela disputa, "…Reabra as datas nas OTAs.". Na ficha, "Por enquanto, o sistema não escreve reservas no Beds24: feche e abra as datas à mão, como hoje." e o motivo `sem_pagamento` "(confirmada à mão: feche as datas à mão)". | "…Nas OTAs, siga o aviso do Início (no Beds24, mude para Cancelado; não apague)." Na ficha, as tarefas desta reserva, e o motivo `sem_pagamento` "(confirmada à mão: feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs)". |
| `GUIA-DIEGO.md` (os quatro trechos acima e o da D3 na seção 11), `requisitos/product/PAGAMENTO-SITE.md` e `requisitos/product/COTACAO-E-HOLD-SITE.md` | Os trechos listados acima e, no `COTACAO-E-HOLD-SITE.md`, a frase "Até o M8.3, as OTAs não sabem do hold…" (l.81, listada em "Arquivos a mexer"). | Corrigidos no mesmo PR, cada um com a versão anterior registrada no próprio documento. |

**A frase "o sistema faz isso sozinho; este aviso fica quando ele não consegue".** Antes: o texto acima a previa com a chave pronta, o imóvel ligado e uma situação automática. Agora: ela não aparece no M8.3b e fica para o M8.3c. Motivo: sem o trabalhador do M8.3c, nada é enviado sozinho, e a frase nunca seria verdade em produção; mostrá-la marcaria intenção como entrega. Objetivo final: com o envio ligado, o aviso diz que o sistema cuida e só fica quando ele não consegue.

**Registro da implementação (M8.3c, 17/10/2026): onde a frase aparece.** Antes: ficava para o M8.3c, e o texto acima só dizia "com a chave pronta, o imóvel ligado e uma situação automática". Agora: ela aparece só com essas três condições juntas, em dois lugares: na linha das atrasadas do Início e nos textos da ficha da atrasada e das atenções de falha, recusa e incerteza. Nunca nas tarefas à mão, no conflito nem na divergência, em que o sistema não vai fazer nada sozinho. Motivo: com o envio do M8.3c, ela passa a ser verdade nesses casos; nos outros, prometeria o que o sistema não faz. Objetivo final, o mesmo de cima. A tarefa da cancelada com o bloqueio feito à mão que sobrou (4.3) usa o texto do bloqueio ("Mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague)"), com as datas achadas, também na reserva que o sistema criou.

**A cancelada depois de uma alteração ainda não marcada** (precisão do texto "Fechada à mão como bloqueio, cancelada"). O bloqueio feito à mão fica onde a última marca o pôs. A marca de uma alteração ("Datas atualizadas nas OTAs") segue o texto da tarefa, que leva as datas da reserva naquela hora; a marca "Datas fechadas nas OTAs" (`ota_fechada_em`) também fecha as datas da reserva naquela hora (feita depois de uma alteração, o bloqueio nasceu nas datas novas; achado da revisão do Codex no PR #156). Por isso o texto da cancelada (e o da D3 cancelada) leva as datas de antes da primeira mudança de datas aplicada depois da última marca, das duas; sem marca nenhuma, as de antes da primeira mudança. Sem mudança de datas depois da última marca, leva as datas da reserva agora. Motivo: as datas do texto têm de ser as do bloqueio que está no Beds24, não as da reserva depois da alteração que a equipe ainda não fez.

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

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| Paga | `ota_fechada_em`, `por` nulo, quando a criação foi conferida. | O mesmo, só se a marca estiver vazia (a da equipe nunca é sobrescrita); a ficha diz "pelo sistema". | |
| "Já marcada" | "As duas funções devolvem `ok:false` quando a marca já existe. A fase 3 trata isso como sucesso." | A decisão sai do estado da linha, nunca do texto: antes de chamar `marcarOtaLiberada` ou `marcarOtaAtualizada`, a fase 3 relê `cancelamentos_reserva.ota_liberada_em` ou `alteracoes_reserva.ota_atualizada_em`; preenchida, é sucesso; `ok:false` com a marca vazia é um erro de verdade, que fica no `erro` da operação. A alteração marcada à mão entre as fases fica com a marca da equipe. Só os ids de `operacoes.alteracoes` lidos na fase 1 são marcados, nunca por horário. | As funções devolvem `ok:false` com texto também em outros casos. |
| Reserva cancelada antes de ser criada | Sem bloqueio nem marca, `marcarOtaLiberada` com `por` nulo; com bloqueio, o texto do que foi achado. | `cancelarAntesDeCriar` (`beds24/reservas-site-envio.ts`), em três leituras (o quarto, a busca da marca e os ocupantes, com as datas da reserva), nunca escreve no Beds24 sem a marca achada. Sem marca viva, sem bloqueio e sem ocupante exato: a marca, com `por` nulo, e `encerrada`. "Sem marca" só conclui com a busca que funcionou (3.5) e o quarto lido em BRL; os registros com a marca já `cancelled` contam como "sem marca viva". Se alguma `criar` da reserva teve POST, os ocupantes contam: o ocupante exato leva a `aguardando_equipe`/`incerta`, com o candidato, e sem marca. Com bloqueio: `manual`/`bloqueio_manual`, com `detalhe.bloqueio` na última `criar` e a tarefa "Mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague)". Com a marca: adota (preenchendo o quarto do acompanhamento, se faltava) e cancela na mesma volta, pelo fluxo de 4.3; com duplicada ou marca estranha, `aguardando_equipe` com o motivo e os ids, sem marca nem POST, e "Conferir agora" repete a leitura. A busca sem conclusão usa o mesmo contador da incerteza (na terceira, `aguardando_equipe`/`incerta`). A volta não relê as `aguardando_equipe` lidas depois do cancelamento nem as não criadas com `ota_liberada_em` já preenchida. | `marcarOtaLiberada` só confere o cancelamento: marcar sem conferir o Beds24 diria "Datas reabertas" com as datas fechadas nas OTAs. Reler a cada volta o que já foi lido ou marcado só gastaria créditos. |
| O cancelamento com o bloqueio que sobrou | 4.4. | 4.3 ("O bloqueio que sobrou"). | |

Objetivo final, o mesmo: o sistema marca sozinho só o que conferiu no Beds24, e o que a equipe marcou à mão nunca é apagado.

### 6.4 Marca manual "Datas fechadas nas OTAs" (D8)
- Botão na ficha (`reserva:editar`, `BotaoConfirmar`, auditado), para a reserva paga sem criação pelo M8.3 e para o caso da D3.
- Grava `ota_fechada_em/por` com o usuário e põe o acompanhamento em `manual`.
- É o sinal de que a equipe fechou à mão: o M8.3 nunca cria por cima (6.6).
- Segue a decisão de 10/10, "o aviso aparece sempre, até a marca da equipe (ou do M8.3)" (`requisitos/product/PAGAMENTO-SITE.md:1731-1741`).

**Registro da implementação (M8.3b, 17/10/2026).** (A situação da entrega está no começo do documento e na seção 13.) A D8 ficou com o padrão (seção 11): o botão existe. O objetivo final é o mesmo: a equipe diz ao sistema que fechou as datas à mão, o aviso some, e o sistema nunca cria por cima.
- **Onde:** o domínio é `marcarDatasFechadasNasOtas(db, sessao, reservaId, env, agora)`, em `beds24/reservas-site-tarefas.ts`; a ação é `marcarDatasFechadasNasOtasAcao`, em `beds24/acoes-reservas.ts`. O botão fica no bloco "No Beds24" da ficha, com `BotaoConfirmar`: "Confirmar que as datas desta reserva (dd/mm a dd/mm) já foram fechadas nas OTAs (no Beds24, como bloqueio)? Depois disso o sistema nunca cria esta reserva no Beds24." Ele só aparece quando a tarefa da reserva é a manual de fechar as datas (paga ou D3, à mão, sem operação real ativa dela) e para quem tem `reserva:editar`.
- **A ordem:** `reserva:editar` (deny-by-default, também no domínio); a trava `beds24:<org>` por `tentarTravaBeds24`, sem esperar (ocupada = recusa); depois o imóvel, a reserva e o acompanhamento (`travarReservaDoSite`); e a tarefa relida já com as travas. Não usa `esperarEnvioBeds24`, que recusaria por qualquer envio de calendário da empresa; a 3.6 recusa por reserva.
- **O que grava:** `ota_fechada_em` e `ota_fechada_por` (o usuário) e a situação `manual`. **O motivo fica vazio:** `ota_fechada_por` preenchido já identifica a marca manual. Se a linha já era `manual`, ela guarda o motivo que tinha.
- **A linha criada sem o quarto:** sem acompanhamento, a marca cria a linha (a empresa, a reserva, o imóvel, a referência com o código), sem o quarto e sem `esperado`. O quarto guardado é o sinal de "criada pelo sistema" (`criadaPeloM83`); com ele, a linha se pareceria com uma reserva criada pelo M8.3.
- **Auditoria:** `beds24.reserva.ota_fechada` (entidade `reserva`, com as mudanças `otaFechadaEm` e `situacaoNoBeds24`). O histórico da reserva mostra "marcou as datas fechadas nas OTAs", com a data e o autor. A ficha mostra "Datas fechadas nas OTAs: dd/mm/aaaa às hh:mm (marcado pela equipe)"; a marca do sistema (M8.3c) dirá "pelo sistema".
- **Depois da marca:** o aviso some do Início; o sistema nunca cria esta reserva no Beds24 (na paga, o "Simular" diz "a equipe cuida desta reserva à mão"; na D3, ele continua com o motivo `sem_pagamento`, porque a régua confere o pagamento antes do acompanhamento); a importação não apaga a marca (a linha manual não tem `esperado`).
- **As recusas** (voltam à ficha com a explicação):
  - "Há uma importação ou um envio do Beds24 em andamento. Aguarde alguns minutos e tente de novo." (a trava ocupada);
  - "Reserva do site não encontrada." (outra empresa, ou reserva que não é do site);
  - "As datas já foram marcadas como fechadas em dd/mm." (a segunda vez) e "As datas já foram marcadas como fechadas." (duas marcas ao mesmo tempo);
  - "O sistema está enviando esta reserva ao Beds24 (ou há um envio dela sem conclusão): espere a conferência e tente de novo." (há tarefa, mas não a manual: a carência do envio automático, a reserva criada pelo sistema, um envio dela em curso ou na fila);
  - "Esta reserva não tem datas a fechar à mão nas OTAs agora." (sem tarefa de fechar: o pedido com as datas seguradas, a cancelada, a estadia que já passou, o acompanhamento `conferida`, o conflito, a divergência, o aguardando a equipe).

**A marca "Datas reabertas nas OTAs" da D3 cancelada** (novo no M8.3b; seção 11, D3). Quando a equipe marcou as datas fechadas (a linha `manual` com `ota_fechada_em`) e depois cancela a reserva pelo "Cancelar reserva" comum, que não grava `cancelamentos_reserva`, o Início mostra "Reserva SCL-XXXXXX, cancelada: mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague)." até a equipe marcar.
- O domínio é `marcarDatasReabertasNasOtas`, com a mesma ordem de travas e de permissão; a ação é `marcarDatasReabertasNasOtasAcao`. O botão "Datas reabertas nas OTAs" fica na ficha, com `BotaoConfirmar`: "Confirmar que as datas desta reserva (dd/mm a dd/mm) já foram reabertas nas OTAs (no Beds24, o bloqueio mudado para Cancelado, sem apagar)?"
- Grava o acompanhamento `encerrada`, com o motivo vazio, e a auditoria `beds24.reserva.ota_reaberta` (a mudança `situacaoNoBeds24`, de `manual` para `encerrada`). O histórico mostra "marcou as datas reabertas nas OTAs"; a ficha, "Datas reabertas nas OTAs: marcado pela equipe (data e autor no histórico da reserva)". A tarefa some do Início. Não há coluna nova: a marca é a situação `encerrada`.
- Recusas: "Esta reserva não tem datas a reabrir à mão nas OTAs agora." e "As datas já foram marcadas como reabertas nas OTAs.", além da trava ocupada e da reserva não encontrada.
- A consulta não olha o pagamento: vale também para uma reserva paga marcada à mão e cancelada pelo botão comum, se isso acontecer. O cancelamento pela política continua com a marca própria do M8.2c (`cancelamentos_reserva.ota_liberada_em`).

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

**Registro da implementação (M8.3c, 17/10/2026).** O e-mail e o Início ficam em `beds24/reservas-site-avisos.ts`; a decisão de mandar e-mail, em `casoDeEmailBeds24` (`beds24/reservas-site-regras.ts`).

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| As linhas do Início | `avisosDeReservasNoBeds24` em `carregarDashboard`, na ordem: conflito, divergência, falhas/incerteza/recusa/atrasadas, transição; os problemas de configuração numa linha só. | `avisosDeReservasNoBeds24(db, org, agora, env, { verConfiguracao })`, chamada pelo Início no lugar das linhas de atenção de `tarefasDasOtas`. As linhas vêm direto da tabela dos acompanhamentos (`conflito`, `divergente`, `aguardando_equipe`, o `conferida` com `noites_ocupadas` e o `pendente`/`sem_vinculo` por imóvel), com o mesmo corte de data de `tarefasDasOtas` (a saída depois de hoje; na alterada, `greatest(checkoutAntes, checkoutDepois) >= hoje`), mais as tarefas e as atrasadas de `tarefasDasOtas`; uma linha por reserva. A ordem: 1. conflito, um código por linha; 2. divergência; 3. a linha única "Envio de reservas parado: <motivo>", só com a chave ligada no deploy de produção (o link para Integrações só para quem tem `configuracao:editar`; para a operação, o mesmo texto sem link); 4. falhas, incerteza, recusa, aguardando a equipe e atrasadas; 5. as tarefas à mão (`avisosDasTarefas`); 6. os informativos ("sendo enviadas" e a transição). | Lidas por `classificarTarefa`, uma divergência que mantém `ota_fechada_em` (só pessoas, ou só a marca) dava "nada" e sumia do Início. Sem o corte de data, as estadias terminadas ficariam no Início e no filtro para sempre. |
| Os links | "Os links levam a `/painel/reservas?beds24=atencao`." | A linha agrupada leva a `/painel/reservas?beds24=atencao`; a linha de uma reserva leva à ficha (a regra do M8.3b). | Para uma reserva só, a ficha é onde estão os botões. |
| O filtro | Não existia (8). | `reservasComAtencaoNoBeds24` sai da mesma leitura do aviso; a lista de reservas recebe os ids numa opção nova (`soIds`), para `reservas/` não importar `beds24/`; vale para qualquer período, como `cancelamento=pedido`, e inclui as canceladas. | Uma regra, um lugar: o aviso e o filtro nunca discordam. |
| Os casos do e-mail | Conflito; divergência apagada, mudada ou cancelada; overbooking; `recusada`; `falhas`; `marca_ilegivel`. | Os mesmos, numa função só, com as listas `MOTIVOS_DE_EMAIL_BEDS24` e `SITUACOES_DE_EMAIL_BEDS24`: o conflito (`conflito`/`noites_ocupadas`); o overbooking (`conferida`/`noites_ocupadas`, com texto próprio, 4.4); a divergência apagada, mudada ou cancelada no Beds24 e a marca ilegível (`divergente`); a recusa, só com a operação `recusada` (`sem_disponibilidade`, `recusada_pelo_beds24` ou `sem_permissao`); e a 5ª falha (`aguardando_equipe`/`falhas`). Não mandam: a falta de disponibilidade lida antes do POST (operação `conflito`: nada saiu), o `sem_permissao` da credencial trocada e o sem acesso antes do POST. | O e-mail é para o que pede alguém logo e foi decidido pelo que o Beds24 respondeu; o resto fica na atenção do Início. |
| Quando sai | Não dizia. | Sempre depois do commit da fase 3, nunca dentro de uma transação, pela rotina (no fim da volta, depois de todos os commits) e pelo botão (depois do commit dele). A transição zera `avisada_em`; o envio grava `avisada_em` só se a linha continua na mesma situação e no mesmo motivo; `falhou` deixa vazio, e a volta seguinte tenta de novo com a mesma chave; `sem-email` e `sem-correio` gravam (o Início continua mostrando). | O e-mail é rede. |
| Os textos | Os modelos da 4.1 e da seção 5. | Os mesmos, mais o do overbooking (4.4), o do conflito na atualização (4.2), o da recusa, o das 5 falhas ("Na ficha, 'Tentar de novo' envia na volta seguinte") e o da marca ilegível (que cita as Auto Actions, D11). Todos terminam com "Veja a ficha da reserva no painel (Reservas)." e vão ao e-mail da empresa; o hóspede e o proprietário nunca os recebem. | |

Objetivo final, o mesmo: a equipe sabe na hora o que pede alguém, sem dado do hóspede, e o aviso, o e-mail e o filtro saem do mesmo lugar.

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
- **não deu para ler** (`ilegivel`): a resposta não veio no formato conhecido, ou trouxe algum item fora dele, ou trouxe a validade da credencial (`validToken`) com qualquer valor que não seja o booleano `true` (por exemplo `"false"`; revisão do Codex de 16/10). Também fora de ordem. Nesse caso a tela não diz o que falta, porque o que parece faltar pode estar lá num formato desconhecido; ela mostra os itens fora do formato;
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

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima) | Agora (o código e o guia) | Motivo |
|---|---|---|---|
| Onde ficam os escopos lidos | "A prontidão lê `GET /authentication/details` sob demanda e uma vez por dia na rotina"; nada ficava guardado. | A leitura fica em `beds24_reservas_rotina` (3.2): a situação e os nomes dos escopos a mais, faltando e ilegíveis (nunca a credencial), com a impressão da credencial que os leu e a hora (`gravarEscoposLidos`). A rotina lê no começo da volta (2.4). O botão "Conferir os escopos" de Integrações passa a gravar também (antes, não gravava nada), só no deploy de produção, com a chave ligada e o refresh token, e recusa a credencial de outra organização. Integrações mostra os escopos guardados, a hora e se ainda valem para a credencial atual. | Uma leitura, um lugar, para a rotina, Integrações e o Sistema. |
| O 403 e o 401 | "Mensagem nova: 'a credencial não tem permissão de escrever reservas'" (3.8). | Os textos fixos de `TEXTOS_DE_ERRO_BEDS24` para `http_403` e `http_401`; Integrações mostra a última recusa (8). | |
| O guia | "o PR corrige para 'só a de leitura'". | Corrigido no `GUIA-DIEGO.md`, seção 6, item 3, com o registro do antes: no Preview, só a `BEDS24_API_KEY`; o refresh token e as chaves de escrita, só no Production. O passo a passo da troca (seção 6, item 51) segue a ordem de cima: a credencial nova, só no Production; a importação e o calendário; as Auto Actions (D11); a chave e "Conferir os escopos" (que só lê com a chave ligada); o ensaio; e o primeiro imóvel. | "Conferir os escopos" responde `chave_desligada` sem a chave: com ele antes da chave, Diego ficaria parado. |

Objetivo final, o mesmo: nenhuma escrita de reservas com credencial diferente da combinada, e o token de escrita só na produção.

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

**Registro da implementação (M8.3b, 17/10/2026).** Dos botões acima, só "Datas fechadas nas OTAs" entrou no M8.3b (6.4). Entrou também um botão que a tabela não previa: "Datas reabertas nas OTAs", para a reserva do site marcada como fechada e cancelada pelo "Cancelar reserva" comum (`reserva:editar`, `BotaoConfirmar`, auditoria `beds24.reserva.ota_reaberta`; 6.4 e 11). O "Simular" já tinha entrado no M8.3a. Os outros botões da tabela continuam no M8.3c e no M8.3d (seção 13).

As ações do servidor ficam em `beds24/acoes-reservas.ts`, com deny-by-default.

**Registro da implementação (M8.3a, 17/10/2026, varredura).** No resultado do "Simular": "nada mudou desde a última simulação" só quando a última simulação desta reserva é a mesma intenção (3.3); com um envio real sem conclusão, "Nada seria enviado" com o motivo `envio_em_curso`; e todo "Nada seria enviado" aparece com o estilo de aviso, não com o de sucesso (antes, 16/10, o cadastro faltando parecia uma simulação gravada). Em Integrações, a pausa geral passa a dizer o que ela para: só as reservas do site (o botão é "Pausar as reservas do site"); o envio de calendário e preços (`BEDS24_ESCRITA`) tem a própria chave e o próprio envio automático e não para com ela. Antes, os textos diziam "nada é escrito no Beds24" e "Pausar tudo".

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

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima e os registros do M8.3a e do M8.3b) | Agora (o código) | Motivo |
|---|---|---|---|
| Os botões da ficha | A tabela de cima; no M8.3b, só "Datas fechadas nas OTAs" e "Datas reabertas nas OTAs". | `beds24/reservas-site-botoes.ts` e as ações em `beds24/acoes-reservas.ts`, nesta ordem em todos: a sessão; a permissão na ação e de novo no domínio; a credencial da organização (`organizacaoBeds24`); fora do deploy de produção, nenhum botão lê o Beds24; os três tempos (3.6) em todo botão que lê o Beds24; a recusa com operação `enviando` ou `incerta` da reserva (salvo os da própria incerteza); e a conclusão revalidada sob a trava. **Conferir agora** (`reserva:editar`; rótulo acessível "Conferir agora no Beds24"): só lê, resolve a `enviando` vencida, a `incerta` e a `feita` pela mesma função do passo 1 (respeitando os 5 min), passa `divergente` a `conferida` (3.4), repete a conferência das duplicadas da cancelada (4.3) e a releitura do calendário do overbooking (4.4); nunca faz POST e nunca toca o ensaio; com a chave desligada no deploy de produção, lê com o leitor. **Tentar de novo** (`reserva:editar`, sem `BotaoConfirmar`): só para `falhou`, `recusada` ou `conflito`, 5 min depois do último `enviado_em`; recusa uma `criar` quando a reserva já tem id no Beds24 ou a última operação está `conferida`; não zera as buscas; só enfileira (3.3). **Deixar à mão** (`reserva:editar`, `BotaoConfirmar`): `manual`/`deixada_a_mao`, criando a linha sem o quarto, como a marca manual; a operação sem POST vira `superada`; vale também nas atenções em que a operação já é terminal (`duplicada`, `marca_em_registro_inesperado`, `bloqueio_manual`, `bloqueio_do_scl`, `sem_disponibilidade`). **Reenviar o que está no SCL** (`reserva:editar`, `BotaoConfirmar`): só na `divergente` com `mudada_no_beds24`; uma `atualizar` com versão nova, só enfileirada, com as noites novas da releitura da fase 2 (4.2); recusa `cancelada_no_beds24` (reativação, M8.3d) e `apagada_no_beds24`. **Não existe, pode criar** (`reserva:editar` + `configuracao:editar`, `BotaoConfirmar`): só na `incerta` da criação, 5 min depois de `enviado_em`; a incerta vira `falhou` com `detalhe.encerradaPelaEquipe`, e nasce a `criar` nova, só enfileirada; zera as buscas. **Já existe, vincular o id** (as duas permissões, `BotaoConfirmar`, com o campo do id): em três tempos, por `vincularRegistro` (3.5), com a operação `vincular` já `conferida` ou `divergente`; zera as buscas. **Passar ao sistema** (as duas permissões, `BotaoConfirmar`): só na `manual`/`anterior_a_ligar` sem `ota_fechada_por` (com ele, recusa: "a equipe marcou as datas fechadas à mão"); lê os ocupantes em três tempos e, sem bloqueio nem ocupante, passa o acompanhamento a `pendente` e enfileira. A ficha ganhou `maxDuration = 300` (`app/painel/reservas/[id]/page.tsx`). | O papel `operacao` não vê nem usa os botões de configuração (teste 38). "Passar ao sistema" com a marca manual criaria por cima do que a equipe fechou (6.4: "o M8.3 nunca cria por cima"). A ficha lê o Beds24 em "Conferir agora" e em "Vincular". |
| Integrações: a última recusa e os contadores | No M8.3a, a linha da credencial dizia só qual credencial existia, e os contadores não tinham link (registro acima). | A linha da credencial mostra a última recusa (`ultimaRecusaDeReservas`: o último `http_403` ou `http_401` das operações, inclusive do ensaio, pela hora da resposta, "com a credencial atual" ou "com uma credencial anterior"); a prontidão mostra os escopos guardados, com a hora e se valem, e o motivo de configuração ("Envio de reservas parado: …", `textoDaConfiguracaoDasReservas`); `marca_ilegivel` sai de `existeMarcaIlegivelQueConta` (4.4); os contadores de `conflito`, `divergente` e `aguardando_equipe` levam a `?beds24=atencao`; o texto de abertura deixou de dizer "por enquanto nada é escrito". A tabela de serviços de Integrações continua sem o motivo da parada (ele aparece na seção nova, e o Sistema mostra). | O que o M8.3a deixou para o M8.3c. A tabela de serviços ficou como estava para não conflitar com o M10.1a (PR #158), que mexia no mesmo arquivo. |
| O ensaio | Uma ação: cria, relê, procura, cancela e relê. | Os mesmos cinco passos, em dois botões, para Diego conferir as OTAs entre eles, mais um para a saída (`beds24/reservas-site-ensaio.ts`): **"Criar o ensaio"** (passos 1 a 3: a reserva de teste com `SCL-ENSAIO` e o id da operação, 1 pessoa, confirmada, `checkAvailability` e as notificações `false`; a releitura pelo id tem de voltar com a marca deste ensaio; a busca pelo quarto e pela chegada exata; ao fim, a operação fica `feita`, com o id e o observado, e a tela diz "Ensaio criado: confira no Beds24 e nas OTAs que as datas fecharam (cerca de 1 minuto); depois, Cancelar o ensaio"); **"Cancelar o ensaio"** (passos 4 e 5: muda para `cancelled`, nunca apaga, e relê; da `feita`, cancelado e relido, a operação vira `conferida`, e `registrarEnsaioReservasBeds24` grava o ensaio da credencial na mesma transação: só aí "Ligar" fica liberado); **"Conferir o ensaio"** (só leitura, 5 min depois do envio, para a `enviando` vencida, a `incerta`, a `divergente` e também a `feita`: com o id, relê; sem ele, procura pelo quarto e pela chegada e casa o id da operação no info item, `ReservaBeds24.ensaioOperacaoId`; achado e cancelado, fecha sem a conferência; achado e vivo, oferece "Cancelar o ensaio"; nada achado numa leitura que conclui, fecha como "nada criado"). Cada botão nas três fases (3.6), com a trava comum de todo POST (`antesDoPost`). Enquanto houver ensaio não resolvido (5.2), Integrações mostra "Ensaio criado e não cancelado: mude para Cancelado no Beds24 (não apague) e use Conferir o ensaio". | A D7 pede "criar, conferir nas OTAs e cancelar, com Diego acompanhando", e o envio às OTAs leva cerca de 1 minuto (4.4): numa ação de segundos, Diego não teria como conferir. Numa transação só, uma queda depois do POST deixaria no Beds24 uma reserva confirmada fechando as OTAs, sem rastro no SCL. "Conferir" também na `feita`: com a pausa ou a credencial trocada, "Cancelar o ensaio" não escreve, e a saída é mudar para Cancelado no Beds24 e conferir. |
| As travas do ensaio | "atrás das mesmas travas da seção 2". | Só o admin (no servidor, na ação e no domínio); a credencial da organização; a escrita pronta (`escritaReservasBeds24Pronta`; "Conferir o ensaio" só lê e vale também com a chave desligada); sem a pausa; os escopos em ordem, lidos na hora e gravados (no cancelamento, só o escopo a mais impede, como na 2.4); o imóvel ativo com vínculo único, o quarto acessível e a moeda BRL; as datas a partir de hoje e no máximo 7 noites; nenhuma reserva nem bloqueio do SCL nessas noites e as noites livres no Beds24 (`lerOcupantes`); a trava `beds24:<org>`, nenhuma outra escrita em andamento e nenhum ensaio não resolvido (o índice `uma_ativa` não cobre a operação sem reserva). | O ensaio fecha as datas nas OTAs enquanto existir: uma noite basta, e mais de 7 nunca. |
| A linha do ensaio | Não dizia. | O cancelamento usa a mesma operação: `iniciado_em` passa a ser o começo do cancelamento, o POST é identificado pela tentativa, e a resposta da criação é sobrescrita (a criação fica na auditoria `beds24.ensaio.criar`). O cancelado sem ter chegado à `feita` fecha como `falhou` "sem a conferência" e não libera "Ligar". O ensaio que parou antes do POST é encerrado pelo próximo "Criar" ou por "Conferir", nunca pela rotina. O que o ensaio observa fica em `detalhe.observado`, só nomes: a chave do id em `new` (e as chaves que vieram), os nomes dos cabeçalhos de crédito, o canal, a origem pela API e se `bookingTime` voltou legível (12). | Uma operação por ensaio, com o histórico na auditoria. |
| Limite do ensaio (decisão de Diego, se acontecer) | — | Com a credencial trocada para outra conta do Beds24 e um ensaio sem id não resolvido, "Conferir o ensaio" nunca conclui "nada criado", e esse ensaio impede um ensaio novo. A tela explica o caminho ("só o confere se a credencial de agora for da mesma conta"); uma saída manual seria decisão de produto. Registrado no guia. | Concluir "nada criado" com outra conta seria supor. |
| Sistema | No M8.3a, `situacao: "planejada", item: "M8.3c"`. | `situacao: "ativa", item: "M8.3c"` (`sistema/automacoes.ts`; o teste muda junto). A página Sistema mostra, só com a chave pronta e o banco no ar, a linha "envio de reservas parado: …", com o mesmo motivo de Integrações (`situacaoServicos` com `paradaDasReservas`). | A rota e o horário da seção 9 foram entregues. |
| Lista de reservas | O filtro `beds24=atencao` entrava no M8.3c. | Entrou (6.5): `beds24` entra nas chaves da lista, para os links não o descartarem. | |
| Hóspede e proprietário | Nada muda. | Nada muda: nenhum componente novo vai para o site ou o portal, e a mensagem que o proprietário pode ver no portal continua sem a palavra "Beds24". | |

Objetivo final, o mesmo: a equipe vê na ficha o que o sistema fez e decide o que ele não pode decidir; Diego faz o ensaio acompanhando as OTAs.

**Registro da implementação (M8.3c, 17/10/2026): o que os botões, o Início e o filtro acrescentaram ao plano.** O plano do M8.3c descrevia os botões da ficha, o Início e o filtro (plano 1.8, 1.14 e 1.15); o código seguiu o plano, com estas precisões:

| | Antes (o plano) | Agora (o código) | Motivo |
|---|---|---|---|
| Os botões que reabrem o envio | "Tentar de novo", "Reenviar o que está no SCL", "Não existe, pode criar" e "Passar ao sistema" pediam só a permissão e a situação. | Pedem também a escrita pronta (`escritaReservasBeds24Pronta`) e as reservas do site sem a pausa; sem isso, a ficha não mostra o botão e o domínio recusa com o motivo. | Com a escrita desligada ou pausada, a operação ficaria na fila sem sair e ainda barraria a marca manual da 6.4. |
| "Conferir agora" e a espera da equipe | A conferência tirava a reserva de `divergente`. | `conferirReservaLigada` também tira de `aguardando_equipe` com `sem_permissao` quando a releitura funciona, e grava na auditoria quem apertou o botão (na rotina, o autor continua nulo). "Conferir agora" só tira o motivo do overbooking quando as noites voltam a ter vaga; nunca o põe (quem põe é a rotina, depois de uma escrita, 4.4). | Sem isso, a reserva ficava presa sem nenhuma leitura que a tirasse dali. |
| "Vincular o id" | Na `incerta` da criação e nos motivos da equipe. | Só para a reserva confirmada. | A cancelada antes de ser criada já tem a saída da 6.3: "Conferir agora" relê a marca, o bloqueio e os ocupantes e encerra ou chama a equipe. |
| "Tentar de novo" depois das 5 falhas | Reabria o envio. | Reabre a mesma linha e não zera as tentativas do acompanhamento (fica em 5): a volta seguinte envia, e se falhar de novo a reserva volta à equipe com o e-mail. | O contador mostra quantas vezes já falhou; zerar esconderia o histórico. |
| O Início (6.5) | A linha "aguarda a equipe" sem o motivo; o imóvel parado não tinha regra de exibição. | A linha da equipe diz o motivo em palavras simples (por exemplo, "o Beds24 não mostrou as noites livres"); a linha "envio de reservas parado no imóvel …" (`sem_vinculo`, 2.4) aparece só com a chave ligada no deploy de produção, como a linha de configuração. | O motivo diz o que fazer; fora da produção, nada seria enviado de qualquer forma. |
| O filtro `?beds24=atencao` | As reservas das linhas de atenção. | As mesmas reservas de todas as linhas do Início, inclusive a transição e as atrasadas (`reservasComAtencaoNoBeds24` sai da mesma leitura de `avisosDeReservasNoBeds24`). | Uma regra, um lugar: o link do Início leva exatamente às reservas que ele conta. |
| A carência (6.1) | 30 minutos desde o fato. | Desde o mais tarde entre o fato, o "Retomar" e a ligação do imóvel (`inicioDaCarencia`); `TarefaOta.desde` passa a ser esse início. | Como no plano 1.8; a hora da chave ligada pela variável continua sem registro (limite). |
| O histórico da reserva | Sem rótulos para as auditorias novas. | `components/HistoricoAlteracoes.tsx` ganhou os rótulos das ações `beds24.reserva.*` dos botões e também de criar, atualizar, cancelar e encerrar. | O histórico mostrava o código cru da ação. |

Objetivo final, o mesmo: cada botão aparece só quando faz sentido para a reserva e para quem vê, e nenhum deixa uma operação sem saída.

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

**Registro da implementação (M8.3c, 17/10/2026).** A rotina é `executarCronReservasBeds24`, em `beds24/cron-reservas.ts`; a rota, `app/api/cron/beds24-reservas/route.ts`; o horário, `app/vercel.json` (`HORARIO_CRON_RESERVAS`).

| | Antes (o texto acima) | Agora (o código) | Motivo |
|---|---|---|---|
| A rota | Recusa sem `CRON_SECRET`; 403 sem o deploy de produção; `maxDuration = 300`. | 401 sem o `CRON_SECRET` certo; 403 sempre que `deployDeProducao` for falso, inclusive sem `VERCEL_ENV`; `maxDuration = 300` e `dynamic = "force-dynamic"`; no erro, `avisarErroDoServidor(erro, "reservas-beds24")` e 500 `{ok:false}`. A rota é o único lugar, além das ações do ensaio, que chama as fábricas (`clienteDeReservasDoAmbiente`, com o refresh token e nunca a `BEDS24_API_KEY`; `leitorDeReservasDoAmbiente`, que nunca grava): um cliente por volta, com o prazo de cada operação ligado ao `fetch`. | |
| A execução | `executarCronReservasBeds24(db, env)`. | `executarCronReservasBeds24(db, env, { cliente, leitor, correio, … })`: o cliente, o leitor e o correio chegam injetados e são obrigatórios (podem ser null), como em todo caminho de escrita; as fábricas, além da trava de ambiente, só criam o cliente no processo real (`NODE_ENV=production` e sem o Vitest). Fora do deploy de produção, nada: nem leitura, nem trava, nem linha nova, nem o registro da execução. | Nos testes, o `env` pode simular a produção inteira: a garantia é a injeção obrigatória, a condição do processo real e a barreira de rede. |
| As janelas | "uma volta nessas janelas não faz nada". | A volta dentro de uma janela fica registrada como sucesso ("Nada feito: janela da importação diária do Beds24" ou "do envio diário"), nunca como "não rodou". As janelas (`JANELAS_SEM_OPERACAO_NOVA_UTC`, objetos com o nome da janela, e `dentroDeJanela`, que diz qual) ficam em `beds24/reservas-site-regras.ts`, conferidas no começo da volta, antes de cada operação nova e de cada saída, e antes de cada leitura e gravação da conferência contínua. | "Não rodou" poria o selo de aviso no Sistema duas vezes por dia. Nas regras, e não na rotina, porque o trabalhador confere a janela e a rotina importa o trabalhador. |
| A precisão do cron | **[S]**: as janelas supõem que as rotinas diárias começam na hora. | Conferido no Neon de produção durante o M8.3c, só com horários e contagens: nos últimos 14 dias, a importação diária começou sempre às 9:15:33–34 UTC (14 execuções) e o envio diário às 10:00:15–16 UTC (14), cada um com até 0,2 s; nos últimos 7 dias, a rotina de 10 em 10 minutos dos pedidos do site rodou 1.007 vezes, sempre no minuto múltiplo de 10, entre os segundos 27 e 32, com até 2,2 s. O minuto 2 nunca coincide, e as janelas cobrem as duas rotinas diárias com folga. | |
| A ordem de cada volta | 0 a 5. | 0: a escrita não pronta (chave, refresh token) ou a pausa: só a saída do que está em curso, com o leitor (2.4). 1: os escopos no começo, quando precisa (2.4); a saída das operações `incerta`, `enviando` vencidas e `feita` (nunca o ensaio), em três tempos; e `encerrarTerminadas` (3.4). 2 a 4: `enviarReservasDoSite` (cancelar, atualizar, criar, com uma leitura de quartos por volta). 5: a conferência contínua (4.5), também depois dos 10 POSTs, se houver tempo. Por fim, depois de todos os commits, o e-mail à equipe (6.5). | O e-mail é rede e nunca roda dentro de uma transação. |
| Os limites | 10 operações; o primeiro 429, 401 ou 403; o crédito abaixo de 20; 150 s por operação; 240 s; um cliente. | Os mesmos (`LIMITE_DE_POSTS_POR_VOLTA`, `CREDITO_MINIMO_BEDS24`, `MINIMO_PARA_OPERACAO_MS`, `LIMITE_INTERNO_DA_VOLTA_MS`), mais: 90 s restantes depois do token, antes do POST (3.6); a fase 2 com prazo de 120 s; o POST com 30 s. Os 10 contam POSTs, com as duplicadas do cancelamento (4.3). O crédito lê os dois nomes de cabeçalho (com os dois, vale o menor); sem nenhum, segue, porque o 429 para a volta. | |
| Os atrasos e a 5ª falha | 10, 20, 40, 80 e 160 min; na 5ª, `aguardando_equipe`/`falhas`, com e-mail. | `ATRASOS_FALHA_MINUTOS` e `atrasoDaFalha` (que diz os minutos e se vai à equipe), só nas regras. Na 5ª falha antes do POST, e no 5º `nao_enviado`, a operação vira `falhou`, sem versão nova. | Uma fonte do atraso. |
| O resumo e a falha da volta | "resumo só de números". | Só números e códigos fixos, com o essencial primeiro, para caber em 500 caracteres (criadas, atualizadas, canceladas, conferidas, avisos, o motivo da parada e o que para a escrita). "Não rodou" só para a trava ocupada ou outra escrita em andamento. A volta é registrada como falha (o Sentry recebe só o tipo) com falha antes do POST, com a leitura dos escopos ou da conferência que falhou e com a credencial recusada (401 ou 403); o 429 não conta. | |
| O fim do acompanhamento | "depois da saída do hóspede, ou do cancelamento conferido". | Para toda situação fora de `manual` (3.4). | |
| O Sistema | "ativa", item "M8.3" (8). | "ativa", item "M8.3c" (8). | O item que liga a rotina. |

Objetivo final, o mesmo: a rotina acerta o Beds24 pelo estado do SCL sem atrapalhar a importação, o envio diário nem o pagamento.

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
   - `enviando` na janela dá "ocupada" com a mensagem certa;
   - respostas estranhas não concluem (varredura de 17/10): registro sem dono em outro lote da releitura; id repetido (legível duas vezes, legível e ilegível, em dois lotes, na leitura do período, e entre a leitura do período e a releitura); o ligado ilegível numa leitura e legível noutra; o registro ligado sem a marca ou com outro código (`marca_ilegivel`, `mudada_no_beds24`, sem `conferida_em`); a adoção com um registro ilegível ou sem dono na leitura, sem esconder os avisos de sem acompanhamento e de duplicada.
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
    - regras de adoção: `black` com o código; `cancelled` com o código; dois registros com a marca; hóspede já na casa;
    - não conclui com o mesmo id duas vezes numa leitura, nas duas ordens, nem com o mesmo registro diferente em duas leituras (17/10).
11. "Simular": zero `fetch`, operação `simulada`, nenhuma marca; A→B→A grava uma linha nova; com um envio real sem conclusão, nada é simulado (17/10).
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

**Registro da implementação (M8.3c, 17/10/2026): onde mora cada teste.** Todos com PGlite e a versão falsa, sem rede nem credencial real; os caminhos são relativos a `app/src/`.

| Teste | Onde |
|---|---|
| 19 (o HTTP com `fetch` simulado, as fábricas e a separação das escritas) | `beds24/reservas-site-escrita-http.test.ts`; a versão falsa que ocupa o calendário, o overbooking −1 e as opções, em `beds24/reservas-site-escrita-falso.test.ts` |
| 20, 21 (a criação), 26 (a integração), 33, 36 (a parte da criação) e o extra da fila | `beds24/reservas-site-envio-criar.test.ts` |
| 22, 23, 24, 25, a revalidação contra a conclusão dupla, o ensaio que a volta nunca toca e a variante do "Vincular" | `beds24/reservas-site-envio-incerteza.test.ts` |
| 21 (a atualização), 27, 28, 29, 30, 36 (a atualização e o cancelamento seguem), a ordem das travas na fase 3 e a D4 | `beds24/reservas-site-envio-atualizar-cancelar.test.ts` |
| 39 (com `livres` 0 e −1) | `beds24/reservas-site-regressao.test.ts`; a parte do −1 também em `site/disponibilidade.test.ts` e `calendario/motor.test.ts` |
| 31 | `beds24/reservas-site-conferencia.test.ts` |
| 32, 34 (a rotina: as janelas, os 150 s, os atrasos e a 5ª falha, o 401 repetido, o 429, o crédito, os escopos e o "não rodou"), os extras das prévias e do zero `fetch` numa volta inteira, e o `vercel.json` lido do disco | `beds24/cron-reservas.test.ts` |
| 34 (a rota) | `app/api/cron/beds24-reservas/route.test.ts` |
| 35 (estático e funcional) | `pagamentos/isolamento-beds24.test.ts` |
| 37 e a parte do ensaio do 38 | `beds24/reservas-site-ensaio.test.ts` |
| O e-mail (os textos, a chave, `avisada_em`, a falha e a nova tentativa) | `beds24/reservas-site-avisos.test.ts` |
| As regras puras (26 e 36, a parte pura; a fila, a incerteza, as janelas, os atrasos, os casos de e-mail e o ensaio) | `beds24/reservas-site-regras-escrita.test.ts`, `beds24/reservas-site-ocupacao.test.ts`, `beds24/reservas-site-rotina.test.ts` |
| A migração 0074 e as tabelas | `db/migracoes.test.ts`, `beds24/reservas-site-tabelas.test.ts` |
| 38 (os botões), 40, 21 (o "Reenviar"), a parte do Início dos 20, 24, 26 e 31, a carência depois de "Retomar", o filtro e os testes de tela da ficha | os testes do bloco da ficha, do Início e do filtro (`beds24/reservas-site-botoes`, `beds24/reservas-site-avisos`, `beds24/reservas-site-tarefas`, `components/reservas/ReservaNoBeds24`, `app/painel/page`, `app/painel/reservas`) |

**A versão falsa** (`beds24/falso.ts`) tem `gravarReservas` com o mesmo corpo e a mesma classificação do HTTP (`beds24/normalizar.ts`) e as opções do texto acima, mais `falharToken`, `responder429`, `responder429ComLista` e `origemDaCriada` (o `apiSource` da reserva criada). As reservas gravadas ocupam as unidades do calendário guardado na hora da gravação (podem deixar −1, o overbooking); o quarto tem de existir em `properties`; o `checkAvailability` recusa também a noite que o calendário não informa; `recusarDisponibilidade` vale para criar e atualizar; `perderRespostaReserva` e as falhas devolvem `tempo` ou `rede` em vez de lançar, como o HTTP.

**Os testes que mudaram junto**, cada um com o motivo num comentário: em `beds24/beds24.test.ts`, a comparação exata de `normalizarReserva`, o calendário (o −1 virou dado) e a lista de métodos; `beds24/reservas-site-leitura.test.ts` (a lista de métodos do falso e a marca ambígua); `beds24/reservas-site-config.test.ts` (o `retomado`); `beds24/reservas-site-painel.test.ts` e `beds24/acoes-reservas.test.ts` (a assinatura nova de "Conferir os escopos"); `beds24/reservas-site-busca.test.ts` (o registro de teste ganhou `apiSource`, sem o qual a adoção nova recusa); `beds24/autenticacao.test.ts` (o status no erro); `sistema/sistema.test.ts` e `app/painel/sistema/page.test.tsx` (a rotina `ativa`); `app/api/cron/avisos-de-erro.test.ts` e `avisos-sem-nomes.test.ts` (a rota nova); `components/configuracoes/AcaoReservasBeds24.test.tsx` e `app/painel/configuracoes/integracoes/page.test.tsx`; e os de `beds24/reservas-site-tarefas.test.ts` que mudam com a saída das atenções.

**A rede nos testes.** Antes, o plano de implementação do M8.3c dizia que as fábricas "só criam cliente com `NODE_ENV=production`, impossível no Vitest". Isso não vale com um `env` explícito, e o `PRONTO` dos testes tem `NODE_ENV: "production"`. Agora a garantia é a injeção obrigatória do cliente e do leitor em todo caminho de escrita (sem a fábrica como valor padrão), mais a condição do processo real nas fábricas (`process.env.NODE_ENV === "production"` e sem `process.env.VITEST`), mais a barreira de rede do `setupFiles`, que continua. `leitorDeCredencialDoAmbiente` ficou sem a condição do processo: ele só lê, e um teste existente espera que ele devolva o cliente com o `PRONTO`.

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
| **Agora** | Diego decidiu igual ao padrão: o pedido do site que a equipe confirma à mão, **sem** pagamento, **não** vai ao Beds24. Só vai a reserva **paga** pelo site. Esse pedido fica com o aviso "feche as datas" e a marca manual (6.4), que chegam no M8.3b (teste 17). A régua do M8.3a já o deixa de fora: a condição 2 de 2.1 pede um pagamento com `desfecho = 'reserva'`, e "Simular" na ficha responde `sem_pagamento` ("confirmada à mão: feche as datas à mão") (desde o M8.3b, 17/10/2026: "confirmada à mão: feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs"; registro em 6.2, "As linhas atualizadas"). |
| **Palavras de Diego** | Transcrição de voz, em que "Bats24" é o Beds24: "eu acho que tem que ir pro [Beds24] só depois de pago, resolvido pelo site". E, sobre a proposta, uma pergunta com ressalva: "A sua proposta, pelo visto, é igual a minha, né? A não ser que eu tenha entendido errado a ordem das coisas." O Claude respondeu na mesma conversa (16/10) que ele tinha entendido certo e que era igual à proposta: vai ao Beds24 só a reserva paga pelo site. **Antes** (no primeiro registro, também de 16/10), a citação parava em "é igual a minha" e não dizia que o Claude tinha confirmado; corrigida na revisão do M8.3a, para a pergunta não virar afirmação. |
| **Motivo** | No Airbnb, o hóspede tem 24 horas para pagar. Fechar as datas em todos os canais para um hóspede que depois não paga dá muito trabalho (a "trabalheira", nas palavras de Diego) e faz a empresa deixar de receber reservas naquelas datas. E o caso é raro, o que deixa aceitável cuidar dele à mão: "não vai ser um número grande de vezes que vai acontecer". |
| **Objetivo final** | O Beds24 e as OTAs só fecham sozinhos as datas de uma reserva com o pagamento feito pelo site. O pedido sem pagamento a equipe decide à mão, com o aviso. |
| **Efeito nas outras decisões** | Reforça a D9: as OTAs continuam abertas durante o hold, pelo mesmo motivo. O texto do guia da parte da cotação é corrigido no M8.3b, junto com os outros textos (seção 13). |
| **Onde mais está registrada** | No `ROADMAP.md`, na linha do M8.3 e em "Decisões registradas" (16/10); no `GUIA-DIEGO.md`, na seção da entrega do M8.3a e nas respostas da seção 7. É uma decisão nova, então não repete o registro da autorização de 16/10 (seção 1). |

### Registro da implementação da D3 e da D8 (M8.3b, 17/10/2026)
(A situação da entrega está no começo do documento e na seção 13.)

| | D3: o pedido confirmado à mão sem pagamento | D8: a marca manual |
|---|---|---|
| **Antes** | O registro de 16/10 previa, para o M8.3b, o aviso "feche as datas" e a marca manual (teste 17). A linha da tabela dizia que o cancelamento pelo painel, que não grava `cancelamentos_reserva`, precisaria de um gancho próprio só se Diego dissesse sim. | O padrão era criar a marca; "se Diego preferir sem ele, a mudança é registrada antes do M8.3b". |
| **Agora** | O aviso e a marca foram entregues (6.1, 6.2 e 6.4): uma linha própria no Início, separada da paga, com a mesma instrução e a mesma marca, e nunca vai ao envio, nem com a chave ligada. **A D3 cancelada pelo "Cancelar reserva" comum entrou no M8.3b:** quando a equipe tinha marcado as datas fechadas (a linha `manual` com `ota_fechada_em`), a reserva do site cancelada com a saída depois de hoje e sem o cancelamento pela política vira a tarefa "Reserva SCL-XXXXXX, cancelada: mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague).", até a marca "Datas reabertas nas OTAs" na ficha (6.4), que põe o acompanhamento em `encerrada`. A pergunta do "Cancelar reserva" avisa antes: "As datas foram marcadas como fechadas nas OTAs: depois de cancelar, no Beds24, mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague) e marque Datas reabertas nas OTAs aqui na ficha." (só com a marca das datas fechadas, o acompanhamento `manual` e a saída depois de hoje). Sem migração: o gancho é a situação `encerrada`. | Diego não respondeu até o M8.3b; valeu o padrão. O botão "Datas fechadas nas OTAs" foi entregue no M8.3b (6.4), e a coluna `ota_fechada_por` fica. |
| **Motivo** | Mesmo com a D3 "não entra no envio", a equipe fecha à mão as datas desse pedido. Se ele for cancelado pelo botão de sempre, alguém precisa reabrir as datas nas OTAs, e sem o aviso o bloqueio ficaria esquecido no Beds24 e as noites fechadas para sempre. | A decisão de 10/10 ("o aviso aparece sempre, até a marca da equipe (ou do M8.3)") pede uma marca que tire o aviso quando a equipe já fechou. |
| **Limites** | Sem a marca das datas fechadas, a D3 cancelada à mão não gera aviso: o sistema não sabe se a equipe fechou. As datas do texto são as da reserva agora (as datas marcadas não são guardadas), salvo depois de uma alteração registrada e ainda não marcada (6.2). Datas mudadas à mão na ficha depois da marca, sem alteração registrada, não são acompanhadas. | Se Diego disser depois que prefere sem o botão, o botão sai da ficha, com um registro novo aqui. A coluna `ota_fechada_por` fica: ela já guarda quem marcou cada reserva e separa a marca da equipe da do sistema (6.4); tirá-la apagaria esse histórico. A linha da tabela ("a coluna `ota_fechada_por` sai") valia só antes da entrega, quando a coluna ainda não guardava nenhuma marca. |
| **Objetivo final** | O mesmo de 16/10: o Beds24 e as OTAs só fecham sozinhos as datas da reserva paga pelo site; o pedido sem pagamento a equipe fecha e reabre à mão, sempre com o aviso e a marca. | A equipe diz ao sistema o que fez à mão, o aviso some, e o sistema nunca cria por cima. |

### Registro da implementação (M8.3c, 17/10/2026): D6, D7, D10 e D11
(A situação da entrega está no começo do documento e na seção 13.) Nenhuma decisão de Diego mudou: até ele responder, valem os padrões da tabela.

| | Antes | Agora | Motivo | Objetivo final |
|---|---|---|---|---|
| **D7, o ensaio** | O padrão: "o ensaio em Integrações … criar, conferir nas OTAs e cancelar, com Diego acompanhando"; a seção 8 listava os cinco passos em sequência, como uma ação só. | Os mesmos cinco passos em dois botões, "Criar o ensaio" e "Cancelar o ensaio", para Diego conferir as OTAs entre eles, mais "Conferir o ensaio" para o que parar no meio (8). A decisão não muda; se Diego preferir uma ação só, o guia deixa de pedir a conferência nas OTAs, e a mudança fica registrada aqui e na seção 8. | O envio às OTAs leva cerca de 1 minuto (4.4): numa ação de segundos, Diego não teria como conferir. | O primeiro teste real, com Diego vendo as OTAs fecharem e reabrirem. |
| **D6, os imóveis ligados** | Nenhum até Diego escolher, e só depois de um ensaio. | O mesmo, no código: "Ligar" só fica liberado depois do ensaio conferido com a credencial atual (`registrarEnsaioReservasBeds24`, gravado por "Cancelar o ensaio"); nenhum imóvel foi ligado. | | Diego escolhe quando cada imóvel passa ao sistema. |
| **D10, o token novo** | "A chave fica sem efeito até o token novo, com os escopos exatos da seção 7, só em Production, e o passo a passo da troca." | O passo a passo está no `GUIA-DIEGO.md`, seção 6, item 51 (passos 1 a 5), com os sete escopos em palavras simples, o Preview só com a leitura (seção 6, item 3) e a ordem chave antes de "Conferir os escopos" (7). | "Conferir os escopos" só lê com a chave ligada. | Nenhuma escrita com credencial diferente da combinada. |
| **D11, as Auto Actions** | "Lista para conferir", levada no M8.3c. | A lista está no guia, seção 6, item 51, passo 4: os e-mails internos, de proprietário e de limpeza com origem "All" ou "Direct"; as regras que põem ou tiram info codes, com o `SCL` (e o `SCL-ENSAIO`, do ensaio) excluído delas. A marca que some vira `marca_ilegivel` e para as criações (4.4), com e-mail que cita as Auto Actions. | | Nenhum e-mail indevido e nenhuma marca apagada por uma regra da conta. |

**Onde Diego vê.** No `GUIA-DIEGO.md`, seção 7, cada uma dessas decisões aponta para o passo do item 51 da seção 6; o `ROADMAP.md`, "Ações de Diego", item 17, também.

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

**Registro da implementação (M8.3c, 17/10/2026).**

| | Antes (o texto acima) | Agora | Motivo |
|---|---|---|---|
| A pergunta ao suporte | "O agente prepara a pergunta no M8.3c, explicada em português simples e com o texto pronto para colar, e a entrega a Diego no guia." | Pronta no `GUIA-DIEGO.md`, seção 6, item 51 ("A pergunta ao suporte do Beds24"): uma explicação curta em português, o texto para colar em inglês (a língua da documentação da API; Diego pode pedir só em português) e o que cada pergunta quer dizer, em português, na mesma ordem. Ela leva sempre os itens 4 e 5 (as duas primeiras perguntas); os itens que o ensaio não responde, 2, 3, 6, 7, 8, 10, 12, 13 e 14, mais o custo das chamadas do item 11; e, num parágrafo opcional, os que o ensaio também registra: 1, 9, os nomes dos cabeçalhos do item 11 e 15. O item 16 (IPs) fica para depois, como o texto diz. O texto não leva o número da conta, o convite nem o token. | O M8.3d depende dos itens 4 e 5; os outros fecham o que ainda está **a confirmar** sem esperar a escrita ligada. |
| O que o ensaio registra | "O ensaio com a credencial atual prova a segunda parte (seção 8)." | Em `detalhe.observado` da operação do ensaio, só nomes, nunca valores: a chave do id dentro de `new` e as chaves que vieram (item 1), o canal e a origem pela API da reserva criada (item 9), os nomes dos cabeçalhos de crédito vistos (item 11) e se `bookingTime` voltou legível (item 15). O preço gravado (item 8) não é registrado. | O preço é dado de valor da reserva; ele foi para as perguntas obrigatórias. |
| O que o código faz enquanto não há resposta | — | Tolera o desconhecido e fica no lado seguro: sem o id legível em `new`, a operação vira `incerta` e a busca resolve (item 1); a recusa do `checkAvailability` que não for reconhecida conta como `recusada` (item 2); sem os cabeçalhos de crédito, a volta segue, porque o 429 a para (item 11); a origem da reserva criada fica **[I]** (item 9, 3.5). O M8.3c grava a marca só no info item, sem nome nem `notes` (item 6, D1). | Avisar em vez de supor. |
| Equipe e proprietário barrados por alguns minutos | Não dizia. | Com uma operação `enviando` (no máximo 120 s de fase 2, e a janela de 6 min se o processo cair), `esperarEnvioBeds24` recusa bloqueio, vínculo e fonte de preços da empresa toda, com a mensagem que já existe (a do proprietário sem "Beds24", 5.1). Registrado no guia. | A trava "em andamento" é compartilhada com o M3.7 (5.1). |

Objetivo final, o mesmo: ligar a escrita sabendo o que o Beds24 faz em cada caso que ainda está a confirmar, e com Diego avisado do que muda para a equipe.

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
| **M8.3a: base sem escrita** (entregue em 16/10, em revisão; desde 16/10/2026, integrado na `main` pelo PR #154, merge `baa6c55`) | Migração 0072 (as duas tabelas); régua pura com a exclusão do marketplace; `escritaReservasBeds24Ligada/Pronta` (com `NODE_ENV`); configuração `reservasBeds24` (pausa, D6 e o registro do ensaio, sem o ensaio em si); prontidão só leitura (escopos); proteções da importação (desvio, recusa em `sincronizarReserva`, `escritaBeds24EmAndamento` com as mensagens certas); correção da ordem das travas em `imoveis/detalhes.ts`; `referenciaScl`; versão falsa ampliada; `procurarReservaDoSite` (leitura); "Simular" sem rede; bloco da ficha só leitura; Sistema e Integrações; "ocupada" registrada como "não rodou"; `setupFiles` que barra a rede; testes 1 a 13 | Nenhuma escrita. A importação passa a proteger reservas do site. | PR das decisões de 16/10 |
| **M8.3b: tarefas das OTAs num lugar só** (entregue em 17/10/2026 na branch `claude/m8-3b-tarefas-otas`, em revisão (PR [M8.3b]); ainda não integrado na `main`; desde 17/10/2026, integrado na `main` pelo PR #156, merge `b554cfa`) | `tarefasDasOtas`; o aviso da paga para quem edita reservas; marca manual (D8); aviso do caso D3; textos por reserva; "mude para Cancelado (não apague)"; guia corrigido (os cinco trechos listados em 6.2, "Textos a revisar", e na D3 da seção 11, procurados pelo texto: os números l.722, 824, 1002-1005, 1738-1741 e 3462 são do commit `adca993`); testes 14 a 18 | Vale já: a operação vê os avisos, a marca manual e os textos certos | M8.3a |
| **M8.3c: escrita real** (entregue em 17/10/2026 na branch `claude/m8-3c-escrita-reservas`, em revisão; ainda não integrado na `main`) | `gravarReservas` (HTTP e falso); rota e horários; janelas; três fases; idempotência e incerteza; conflito; criar, atualizar e cancelar; marcas automáticas; conferência contínua; aviso de atenção e e-mail; botões; ensaio; em Integrações, o último 403 ou 401 de reservas e o link dos contadores para a lista filtrada, com o filtro `beds24=atencao` na lista de reservas (os dois ficaram fora do M8.3a, registro na seção 8); o ensaio não resolvido no desvio e e a marca ambígua separada de "sem marca" (registro na 5.2); testes 19 a 40 | Só escreve com a chave, o token, o ensaio e um imóvel ligado | M8.3a, M8.3b |
| **M8.3d: depois do suporte do Beds24** | "Assumir no Beds24" e a reativação; testes 41 e 42 | Igual ao M8.3c | M8.3c e a resposta do suporte, que Diego pede com a pergunta preparada pelo agente no M8.3c (seção 12); por isso o M8.3d fica `bloqueado` no `ROADMAP.md` |

**Registro da implementação (M8.3b, 17/10/2026).** (A situação da entrega está no começo do documento e na linha do M8.3b na tabela acima.) Antes: a linha do M8.3b listava `tarefasDasOtas`, o aviso da paga para quem edita reservas, a marca manual (D8), o aviso da D3, os textos por reserva, o guia corrigido e os testes 14 a 18. Agora:
- **Entrou a mais:** a D3 cancelada pelo "Cancelar reserva" comum, com o aviso e a marca "Datas reabertas nas OTAs" (6.4 e 11); as linhas mínimas de atenção e os informativos dentro de `tarefasDasOtas` (6.1), que o teste 18 pede; o texto das OTAs nos quadros do cancelamento e da alteração da ficha (6.2); e o histórico da reserva em português para as marcas gravadas na reserva ("marcou as datas fechadas nas OTAs", "marcou as datas reabertas nas OTAs", "ligou a reserva ao registro do Beds24"). O rótulo "marcou o bloqueio mudado nas OTAs" também entrou (`components/HistoricoAlteracoes.tsx`), mas a marca da alteração é auditada na entidade `alteracao` (`pagamentos/alteracao.ts`), e nenhuma tela lê hoje o histórico dessa entidade: ela não aparece no histórico da reserva.
- **Passa ao M8.3c** (todos estão também na linha dele no `ROADMAP.md`): a frase "o sistema faz isso sozinho; este aviso fica quando ele não consegue" (6.2); `avisosDeReservasNoBeds24`, com a linha única de configuração, o e-mail à equipe e o filtro `?beds24=atencao` (6.5); os botões "Deixar à mão", "Tentar de novo" e "Conferir agora" (8); as marcas automáticas (6.3); e, se for preciso, a hora guardada da intenção, para a carência depois de "Retomar" (6.1). A linha `reservas-beds24` do Sistema continua `planejada`.
- **Sem mudança:** nada escreve no Beds24 nem usa a rede, e não há migração nova (0000 a 0072 intactas). Os testes 14 a 18 estão em `beds24/reservas-site-tarefas.test.ts` (com a classificação pura), e há testes da ficha, do Início, das ações, dos componentes e do histórico, todos com PGlite, sem rede e sem credencial real.
- **Arquivos:** além da lista do M8.3b em "Arquivos a mexer", o M8.3b mexeu em `beds24/reservas-site-config.ts` (`motivosDesligada` mudou para lá), `beds24/reservas-site-regras.ts` (`criadaPeloM83`), `beds24/reservas-site.ts` (`travarReservaDoSite` exportada), `beds24/reservas-site-painel.ts`, `components/reservas/ReservaNoBeds24.tsx`, `components/HistoricoAlteracoes.tsx`, `pagamentos/contestacao-tela.ts`, o Início (`app/painel/page.tsx`) e a ficha (`app/painel/reservas/[id]/page.tsx`).
- **Motivo:** o caso da D3 cancelada apareceu na implementação; sem ele, o bloqueio feito à mão ficaria esquecido no Beds24. O que passa ao M8.3c depende do envio, que o M8.3b não tem. **Objetivo final:** o mesmo da divisão: cada parte entra revisável, e a escrita só vem depois da base e das tarefas.

**Registro da implementação (M8.3c, 17/10/2026).** (A situação da entrega está no começo do documento e na linha do M8.3c na tabela acima.) Antes: a linha do M8.3c listava `gravarReservas`, a rota e os horários, as janelas, as três fases, a idempotência e a incerteza, o conflito, criar, atualizar e cancelar, as marcas automáticas, a conferência contínua, o aviso de atenção e o e-mail, os botões, o ensaio, a recusa e os contadores de Integrações com o filtro, o ensaio não resolvido e a marca ambígua (5.2) e os testes 19 a 40. Agora:
- **Entrou como previsto,** com os registros em 2.4, 3.2 a 3.8, 4.1 a 4.5, 5.2, 6.1 a 6.5, 7, 8, 9 e 10. Do que o M8.3b passou ao M8.3c, entraram a frase "o sistema faz isso sozinho; este aviso fica quando ele não consegue" (6.2), `avisosDeReservasNoBeds24` com a linha única de configuração, o e-mail e o filtro `?beds24=atencao` (6.5), os botões "Deixar à mão", "Tentar de novo" e "Conferir agora" (8), as marcas automáticas (6.3) e a hora guardada do "Retomar" para a carência (6.1). A linha `reservas-beds24` do Sistema passou a `ativa`.
- **Entrou a mais:** o overbooking lido (`numAvail` negativo) e o aviso dele no plano do calendário (a terceira exceção da seção 1); a migração `0074` com a tabela `beds24_reservas_rotina` (3.2); o "Conferir o ensaio" (8); e, no guia, a correção do Preview (7).
- **A migração** é a `0074_m8_3c_escrita_reservas_beds24.sql`, não a 0073 (3.2): a `main` trouxe antes a 0073 do WhatsApp (M10.1a, PR #158, merge `878a8f0`), e a do M8.3c foi renumerada no merge `f4517c7`, sem editar a 0073.
- **Fica para o M8.3d** (sem mudança): "Assumir no Beds24", a reativação, o "Criar agora" (6.6) e os testes 41 e 42. "Reenviar" recusa a `cancelada_no_beds24`.
- **Efeito em produção:** nada escreve sozinho. A escrita só sai com as quatro coisas juntas: `BEDS24_ESCRITA_RESERVAS=ligada`, que só Diego liga; o refresh token novo com os 7 escopos (D10); um ensaio conferido com essa credencial (D7); e um imóvel ligado (D6). Em 17/10 não havia nenhuma das quatro, e em produção há 0 reservas do site pagas (o pagamento só roda nas prévias, 2.4). Nas prévias, o M8.3c nunca lê nem escreve no Beds24. Com a chave desligada, a rotina roda de 10 em 10 minutos só para conferir que não há nada em curso, e registra "Nada feito".
- **Testes:** os da seção 10, com PGlite e a versão falsa, sem rede e sem credencial real. Nada foi escrito no Beds24 de verdade; a escrita real só vai ser vista no ensaio, por Diego.
- **Limites:** a hora em que a chave foi ligada na Vercel não é registrada (6.1); o ensaio sem id com a credencial trocada para outra conta não tem saída automática (8). (Antes, este item listava também o histórico da reserva sem rótulo em português para as auditorias novas; os rótulos entraram com os botões da ficha, registro da seção 8.)
- **Motivo e objetivo final:** os mesmos da divisão: cada parte entra revisável, e a escrita só liga depois da base, das tarefas e do passo a passo de Diego.

Cada PR atualiza a sua linha no `ROADMAP.md` e o `GUIA-DIEGO.md` (seção "Onde estamos", o que Diego precisa fazer, data). O M8.3c traz o passo a passo de ligar: token novo só em Production, Redeploy, prontidão, ensaio, ligar o primeiro imóvel, conferir. (Desde 17/10/2026, no `GUIA-DIEGO.md`, seção 6, item 51, com a importação e o calendário conferidos depois da troca, as Auto Actions da D11, a chave antes de "Conferir os escopos", o ensaio em dois botões, como pausar e desligar, e a pergunta ao suporte.)

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

**Registro da implementação (M8.3c, 17/10/2026): a lista real.** Antes: a lista acima. Agora (caminhos relativos a `app/src/`, salvo indicação):
- **Novos:** `app/drizzle/0074_m8_3c_escrita_reservas_beds24.sql` e `app/drizzle/meta/0074_snapshot.json`; `beds24/reservas-site-envio.ts` (o trabalhador, no lugar de `enviarReservasDoSite` em `reservas-site.ts`); `beds24/reservas-site-ocupacao.ts`; `beds24/reservas-site-rotina.ts`; `beds24/reservas-site-conferencia.ts`; `beds24/reservas-site-avisos.ts`; `beds24/reservas-site-ensaio.ts`; `beds24/reservas-site-botoes.ts`; `beds24/cron-reservas.ts`; `app/api/cron/beds24-reservas/route.ts`; e os testes da seção 10.
- **Alterados:** `beds24/tipos.ts`, `beds24/http.ts`, `beds24/autenticacao.ts`, `beds24/normalizar.ts`, `beds24/falso.ts` (o cliente de escrita, a classificação, a leitura da marca e do −1); `beds24/configuracao.ts` (`quartoAcessivelEmBrl`) e `beds24/sincronizacao.ts` (`relerPorIds`, a mesma regra); `beds24/reservas-site-regras.ts`, `beds24/reservas-site-config.ts` (`retomado`), `beds24/reservas-site.ts` (a busca com a marca ambígua, a adoção dividida, `vincularRegistro`, o ensaio no desvio "e", `avisada_em` na divergência), `beds24/reservas-site-tarefas.ts` (a cancelada com o bloqueio que sobrou, a carência, as atenções fora), `beds24/reservas-site-painel.ts` e `beds24/acoes-reservas.ts`; `db/schema.ts` e `app/drizzle/meta/_journal.json`; `calendario/motor.ts` e `site/disponibilidade.ts` (o overbooking, seção 1); `sistema/automacoes.ts`, `sistema/servicos.ts` e `app/painel/sistema/page.tsx`; `pagamentos/testes.ts` (`semDadosPessoais`); `components/configuracoes/ReservasSiteBeds24.tsx` e `components/configuracoes/AcaoReservasBeds24.tsx`; `components/reservas/ReservaNoBeds24.tsx` e `app/painel/reservas/[id]/page.tsx` (os botões e o `maxDuration`); `painel/dashboard.ts` e `app/painel/page.tsx` (o Início); `reservas/listagem.ts` e `app/painel/reservas/page.tsx` (o filtro); `app/vercel.json`.
- **Documentos:** `ROADMAP.md`, `GUIA-DIEGO.md`, este desenho e `requisitos/operations/CALENDARIO-PRECOS-OPERACAO.md`.
- **Não mexidos, como previsto:** `email/aviso-equipe.ts` (só o uso) e o código de `pagamentos/*` (lá, só mudou o auxiliar de testes `pagamentos/testes.ts`, e o teste novo `pagamentos/isolamento-beds24.test.ts`, o 35, confere que nenhum arquivo de `pagamentos/` importa `@/beds24/*`).

Motivo: o trabalhador ficou grande e foi dividido em módulos pelo que cada um decide (3.6), sem o trabalhador importar a importação. Objetivo final, o mesmo: cada regra num lugar só.

**M8.3d**
- `beds24/reservas-site.ts`, `beds24/acoes-reservas.ts`, a ficha.
