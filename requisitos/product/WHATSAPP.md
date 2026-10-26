# Recebimento do WhatsApp (M10.1a): desenho

## Mudança de caminho (25 e 26/10/2026)

Registro de Diego, 25 e 26/10. O resto deste documento é o desenho de 17/10 e continua valendo para o recebimento (M10.1a); onde ele fala do final 0322, da coexistência e do Embedded Signup, vale o que está aqui. Neste documento, o número antigo continua escrito como "final 0322" e o novo como "final 0021"; nenhum id da Meta, token ou chave entra aqui.

| | |
|---|---|
| **Antes (17/10)** | Preservar o WhatsApp Business manual do final 0322 e conectar por coexistência (Embedded Signup v4, QR code), com sincronização de histórico e contatos nas 24 h. |
| **Agora (25/10)** | O número do sistema é o final 0021: número novo, só do sistema (o pessoal de Diego também tem final 0021, mas é outro número), dedicado à Cloud API, sem aplicativo no celular, sem coexistência, sem Embedded Signup e sem sincronização de histórico ou contatos. O final 0322 sai do plano. |
| **Motivo** | O final 0322 estava vinculado a mais de um aplicativo na Meta e isso travava tudo. |
| **Objetivo final** | A caixa de entrada e os envios pelo SCL. |

**Chave do app:** colada por engano no chat em 25/10; a variável foi atualizada na Vercel no mesmo dia (conferido em 26/10) e falta Diego confirmar que é a redefinida na Meta. Nada disso vai para o Git.

**Estado em 26/10** (conferido pelo Claude na produção, sem segredos; o relato técnico do Antigravity, ferramenta externa que Diego usou de 23 a 26/10, bate): `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET` configurados no Production da Vercel; o endereço do webhook do sistema passou na verificação da Meta (o `GET` de verificação responde certo). O número final 0021 saiu do celular de Diego ao ser registrado na Cloud API (ele validou pela Meta e precisou desconectar o aplicativo): é o esperado sem coexistência, o número não fica no aplicativo e na API ao mesmo tempo; para voltar ao celular seria preciso tirá-lo da API; de agora em diante o número vive só no sistema. O recebimento está desligado: `WHATSAPP_RECEBIMENTO` não está em "ligada" no Production, então cada aviso da Meta recebe 503 e a Meta tenta de novo por até 7 dias; nada se perdeu ainda, mas nada foi guardado (zero mensagens, zero avisos e zero contadores no banco de produção). Os ids da Meta (conta e número) ainda não foram colados em Integrações; sem eles o sistema recusa avisos de número desconhecido. Não existe push nem e-mail por mensagem nova: hoje o sistema só avisa por e-mail sobre a conta (desconectada, aguardando reconexão ou suspensa pela Meta); o alerta por mensagem nova entra no M10.2, puxado por Diego em 26/10, e, com a categoria, no M10.3a. Enviar ainda não existe (M10.2): enquanto não existir, ninguém responde hóspede por esse número pelo sistema. Receber não depende da análise da Meta; enviar para qualquer número, sim. Ordem para passar a receber (guia, seção 6, item 55): (1) Integrações, "Identificação na Meta": o id da conta (WABA) e o id do número; (2) Vercel, Production: `WHATSAPP_RECEBIMENTO=ligada` (só Diego liga); (3) Redeploy, ou esperar o merge seguinte; (4) mensagem de outro celular para o número e olhar Painel → Mensagens. O M10.1a de hoje já suporta isso.

**Token permanente (Diego, 26/10):** Diego já tem o token permanente da conta do WhatsApp (usuário do sistema da Meta), guardado com ele, nunca colado no chat. Nome combinado da variável: `WHATSAPP_ACCESS_TOKEN`, na Vercel, Production, tipo Sensitive; Diego coloca quando puder, e o código só passa a ler esse nome no M10.1b e no M10.2. Sem a variável, nada é chamado na Meta. Tem de ser o token permanente de "usuário do sistema" (Configurações do negócio na Meta → Usuários do sistema → Gerar token, com a conta do WhatsApp como ativo e as permissões `whatsapp_business_messaging` e `whatsapp_business_management`); o token da página "Configuração da API" dura 24 h e não serve.

### O que vale e o que sai do M10.1b
- **Vale:** o token só no servidor; reconexão com aviso no painel (`aguardando_reconexao` e o aviso de desconexão do M10.1a) quando a Meta invalidar o token (o token permanente de usuário do sistema não vence: não há renovação); nunca senha digitada por script na Meta; a leitura dos cinco campos e a gravação idempotente do M10.1a (`history` e `smb_app_state_sync` continuam lidos de forma segura, mas nunca pedidos); a inscrição da conta no app escreve na Meta e continua pedindo a linha de autorização explícita no `ROADMAP.md`.
- **Entra:** o token permanente de um "usuário do sistema" da Meta, lido pelo nome `WHATSAPP_ACCESS_TOKEN`, guardado só na Vercel, no Production (nunca no banco em claro; sem a variável, nada é chamado na Meta); a leitura da situação do número; a inscrição da conta do WhatsApp (WABA) no app.
- **Sai:** a tela "Conectar WhatsApp" (Embedded Signup v4), a troca do código pelo token, a chave `WHATSAPP_CONEXAO`, os pedidos de sincronização de contatos e histórico, a ordem desses pedidos (11.1), a decisão entre histórico síncrono e pedaços pendentes, o id da configuração do Embedded Signup e a medição do lote de 5.000 (T26) como pré-requisito.
- **Depende de Diego:** `WHATSAPP_ACCESS_TOKEN` na Vercel, os ids em Integrações, ligar `WHATSAPP_RECEBIMENTO`, o teste com uma mensagem de outro celular, a confirmação da chave secreta redefinida e a linha de autorização para a inscrição da conta (WABA) no app (sem ela, o M10.1b para antes dessa etapa); a análise da Meta só segura o envio, não o recebimento.

### Esboço do M10.2 (envio) e do M10.3 (sugestão com o Claude), combinado em 26/10
Hoje o sistema só recebe; nada é enviado pela Meta. Ordem combinada: primeiro a sugestão com alerta (categoria B), depois o envio sozinho (categoria A). O desenho de cada item vem antes de construir; isto é o esboço.
- **M10.2, envio pelo painel:** pela Cloud API com o token permanente (`WHATSAPP_ACCESS_TOKEN`), atrás de `WHATSAPP_ENVIO=ligada`, que só Diego liga; resposta livre só dentro de 24 h da última mensagem do hóspede, fora disso só modelo aprovado pela Meta; **"envio com um toque":** quem recebe o alerta (o e-mail simples do M10.2 ou, depois, o do M10.3a com a categoria) abre o link da conversa, e enviar exige o login de Diego no celular (ninguém envia só com o link); registro de entrega (`statuses`, na coluna `situacao` de `whatsapp_mensagens`, já prevista em §3.1, migração 0073) e prevenção de mensagem repetida. **Escreve na Meta:** linha de autorização explícita de Diego no `ROADMAP.md` necessária antes de construir, como no M10.1b; sempre atrás de `WHATSAPP_ENVIO=ligada`. O "de acordo" de 26/10 foi para a ordem (sugestão antes do envio sozinho), não para a escrita; a autorização está pedida em "Pendências de decisão" do `ROADMAP.md`. **Quem é dono do alerta por e-mail:** o M10.2 traz o envio pelo painel e o e-mail simples a cada mensagem nova (só o imóvel, as datas e o link da conversa, sem categoria; nada do texto do hóspede nem o telefone, o conteúdo fica atrás do login), puxado por Diego na noite de 26/10 para logo depois do M3.11c; o M10.3a traz a classificação, a sugestão e o alerta com a categoria.
- **M10.3, assistente de sugestão:** Diego autorizou em 26/10 mandar as mensagens dos hóspedes ao Claude para gerar sugestões ("pode, claro, sempre foi a ideia"). A chave da Anthropic fica na Vercel, criada e colocada por Diego, nunca no chat; sem ela, nada é chamado. Adaptador com versão falsa para testes; nenhum teste usa rede. Custo estimado em 26/10: uns 3 a 5 centavos de dólar por sugestão no modelo mais forte, 10 a 15 dólares por mês com 300 mensagens; menos com a parte fixa (o Guia de Atendimento) guardada em memória (cache de prompt) e com um modelo menor se a qualidade aguentar: o Claude testa os dois e mostra o resultado antes de escolher.
  - **Categoria B** (interessados, cotações, negociação, exceções, dúvidas sem certeza): sugestão imediata e alerta por e-mail só com imóvel, datas, categoria e link; Diego aprova e envia (M10.3a).
  - **Categoria A** (dúvidas operacionais de reserva confirmada: Wi-Fi, horários, regras da casa, endereço): envio sozinho só depois de alguns dias só com a categoria B, só em conversa ligada a reserva confirmada, dentro das 24 h, só nos assuntos de uma lista que Diego edita no painel; senha do Wi-Fi e endereço nunca vão para número não conferido (M10.3b). Diego: "de acordo". O M10.3b escreve na Meta e precisa da mesma linha de autorização explícita do M10.2, sempre atrás de `WHATSAPP_ENVIO=ligada` e da chave própria dele. A divisão em M10.3a e M10.3b é planejamento do Claude (um PR por parte), na ordem que Diego combinou.
- **No instante em que a mensagem chega:** o `after()` da rota `POST /api/whatsapp`, que hoje já dispara o e-mail da conta desconectada depois do 200, passa a disparar a sugestão e o alerta assim que uma mensagem recebida em tempo real (`messages`, origem `tempo_real`) for gravada; a gravação continua síncrona e antes do 200, e uma falha na sugestão nunca faz a Meta reenviar (pedido técnico do Antigravity em 26/10, aceito).
- **Regras de segurança nas duas categorias:** ao Claude vai só o texto das mensagens da conversa e o contexto da reserva que a sugestão precisa, sem nome completo, telefone, documento ou dado de pagamento (o detalhe fica no desenho do M10.3); a Política de privacidade cita a Anthropic, publicada por Diego antes de ligar o M10.3a; o e-mail do alerta traz só imóvel, datas, categoria e o link (nada do texto do hóspede nem o telefone), e o conteúdo fica atrás do login; o prazo de guarda da sugestão e do custo (texto, valor) é definido no desenho do M10.3; nenhuma sugestão é enviada sem o login de Diego (B) ou sem a lista de assuntos e a reserva confirmada (A); tudo registrado (sugerido, aprovado, enviado, custo); botão de desligar no painel; nenhum disparo real até as chaves ligadas por Diego e a linha de autorização para escrever na Meta.

---

**Situação:** desenho de 17/10/2026, revisado no mesmo dia por três críticas (segurança, correção e formato da Meta: 35 apontamentos, todos aplicados) e com os acréscimos de Diego (repassando a revisão do Codex) e da revisão de Diego e Mia, também de 17/10. Base: `main` em `b554cfa` (PR #156), atualizada depois com o PR #157.
- **M10.1a (recebimento): entregue em 17/10/2026 na branch `claude/m10-1a-whatsapp-recebimento`; na `main` desde 17/10 (PR #158).** Nada escreve na Meta. Nada chega ao painel até os ids em Integrações e a chave `WHATSAPP_RECEBIMENTO=ligada`, que só Diego liga; desde 25/10 isso não espera o M10.1b (ver "Mudança de caminho" no topo). Onde a construção mudou o desenho, o registro está na própria regra, marcado **Implementação (17/10)**.
- **M10.1b (conexão):** `bloqueado` (seção 11). **M10.2 (envios):** `bloqueado` no M10.1b (seção 12). **M10.3 (sugestão de resposta pelo Claude):** continua dependendo do M10.1 (o conjunto), sem mudança. **Atualizado em 25 e 26/10:** ver "Mudança de caminho" no topo (M10.1b redesenhado para o número dedicado; M10.2 com o envio pela Cloud API; M10.3 dividido em M10.3a e M10.3b).

**Fontes:**
- o código da branch (caminhos relativos a `app/src/`, salvo indicação);
- as páginas públicas da Meta sobre a Cloud API, lidas sem rede a partir de cópias feitas no desenho: a visão geral dos webhooks, "Create a webhook endpoint", as referências de `messages` (e de cada tipo de mensagem, entre eles `system`, `unsupported`, `reaction` e `edit`), `smb_message_echoes`, `history`, `smb_app_state_sync` e `account_update`, a página do BSUID (o id de usuário), a de coexistência e a do Embedded Signup.

Nenhuma chamada foi feita à Meta.

**Legenda:**
- **[não confirmado]:** a Meta não mostra exemplo; o sistema lê do jeito mais seguro e conta o que não reconhece.
- **Implementação (17/10):** a regra mudou na construção; o registro diz o que era e por quê.
- Sem marca: conferido no código da branch.

**Regras deste documento:** nenhum id real da Meta (app, conta, número), nenhum telefone real, e o número da empresa só como "final 0322". Os ids e telefones de exemplo são os fictícios das páginas da Meta e dos testes (`whatsapp/testes.ts`).

---

## 1. Objetivo, decisões de 17/10 e o que fica de fora

### Objetivo
As conversas do WhatsApp da empresa aparecem no painel, ligadas às reservas e aos interessados, sem perder mensagem e sem tirar o número do WhatsApp Business do celular. A coexistência da Meta permite isso: o número final 0322 continua no aplicativo do celular, e a Meta manda ao sistema, por avisos assinados, o que chega e o que a empresa responde pelo celular.

O M10.1a é a primeira parte: **recebe e guarda, sem falar com a Meta.** Entra:
1. a rota `GET/POST /api/whatsapp` (verificação do endereço e avisos assinados), atrás de `WHATSAPP_RECEBIMENTO=ligada` (seção 2);
2. a leitura pura dos cinco campos que o app assina (`messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`), com validação estrita de forma e tamanho (seção 4);
3. a gravação idempotente e síncrona, antes do 200, nas tabelas da migração 0073 (seções 3 e 5);
4. a caixa de entrada `/painel/mensagens` e a conversa `/painel/mensagens/[id]`, só de leitura (seção 7);
5. o vínculo da conversa com reserva, cotação, pedido de contato, cadastro pelo site ou proprietário: só sugestão, confirmação à mão (seção 6);
6. os avisos da conta (desconexão, espera de reconexão, suspensão) no Início, em Integrações e por e-mail, sem dado pessoal (seção 5.7);
7. a configuração em Configurações → Integrações → WhatsApp: os ids da Meta e "Quem vê as conversas" (seção 3.2);
8. a rotina de hora em hora `/api/cron/whatsapp` (seção 5.8);
9. a barreira de rede dos testes estendida aos domínios da Meta e a varredura `semDadosPessoais` estendida (seção 8).

### Decisões de Diego em 17/10/2026
1. Aprovada só a primeira parte (M10.1a): receber e testar com mensagens fictícias. A conexão real fica no M10.1b, que continua `bloqueado`. Nada escreve na Meta. Nenhum parceiro pago.
2. As conversas ficam visíveis só para o admin (Diego) por enquanto; o acesso da operação será definido depois. É uma **configuração editável** com padrão "só o admin" (seção 3.2), não uma regra fixa no código. Nenhum texto do sistema, deste desenho ou do guia diz que "admin e operação veem" como padrão.
3. Telas da Meta vistas por Diego: "Configurações do negócio: Conectado" e "Gerenciador do WhatsApp: Offline". A origem da conta é desconhecida. Isso não muda o M10.1a.
4. O número final 0322 continua no WhatsApp Business do celular (coexistência). Os ids da Meta nunca vão para o Git, para textos de PR ou para documentos: ficam em Configurações (no banco) ou na Vercel.

Acréscimos do mesmo dia, que valem como requisito:
- de Diego, repassando a revisão do Codex: o teste obrigatório de que a operação, com o padrão, não vê nada em nenhuma superfície (seção 7.1); os grupos e o objetivo dos envios seguintes, sem envio agora (seção 12);
- da revisão de Diego e Mia: a tela Mensagens como proposta de direção visual (seção 7.3), a conferência na prévia só com dados fictícios (seção 7.3), conexão, tokens e custo (seção 11.3), "sem duplicar ao retomar" (seção 5.9) e o registro sobre o Estadia em "Decisões registradas" do `ROADMAP.md`.

### Registro da decisão
| | |
|---|---|
| **Antes** | O M10.1 estava `bloqueado` por "Diego: app Meta Business + número verificado", e o guia de 8/10 dizia que o número que entra sai do aplicativo WhatsApp do celular. |
| **Agora (17/10)** | O M10.1 foi dividido em M10.1a (recebimento, sem depender da Meta; feito neste PR) e M10.1b (conexão, `bloqueado`). O número final 0322 fica no celular (coexistência). Só o admin vê as conversas por padrão, numa configuração editável. O M10.2 passa a depender do M10.1b. |
| **Motivo** | A coexistência permite manter o número no WhatsApp Business do celular, e o recebimento pode ser construído e testado sem a Meta. Diego aprovou só a primeira parte. |
| **Objetivo final** | Todas as conversas do WhatsApp da empresa no painel, ligadas às reservas e aos interessados, sem perder mensagem e sem tirar o número do celular. |

O registro também está abaixo da tabela do M10 no `ROADMAP.md` e no item 4 da seção 6 do `GUIA-DIEGO.md`.

### Fica de fora do M10.1a
- **M10.1b (`bloqueado`):** a tela "Conectar WhatsApp" (Embedded Signup v4), a troca do código pelo token, a inscrição do app na conta (`POST /<WABA>/subscribed_apps`), os pedidos de sincronização (contatos e histórico), a leitura da situação do número (`is_on_biz_app`, `platform_type`), a chave `WHATSAPP_CONEXAO=ligada`, a guarda do token, os campos "id do app", "id da configuração do Embedded Signup" e "versão da Graph API" na configuração, e o adaptador `whatsapp/provedor.ts` com a versão real e a falsa. Nada disso existe agora, nem como esqueleto: o M10.1a não usa adaptador porque não fala com a Meta (seção 11).
- **M10.2:** resposta pelo painel, modelos aprovados, `statuses[]` das mensagens enviadas pela API, `WHATSAPP_ENVIO=ligada`. A coluna `whatsapp_mensagens.situacao` já existe, nula, para não precisar de migração depois. Download de mídia, se um dia for desejado, também fica lá (seção 12).
- **M10.3:** sugestão de resposta pelo Claude.
- Marcar como lida na Meta ou mandar confirmação de leitura (é escrita). "Lida" é só estado interno.
- Equipe de limpeza como candidata do vínculo (não há coluna; pergunta 1 da seção 10).
- Parceiro pago (BSP). Se Diego escolher esse caminho no M10.1b, o formato e a assinatura podem mudar; a leitura dos avisos só se reaproveita se o parceiro repassar no formato da Cloud API.
- Mensagens de grupo: a coexistência não sincroniza grupos (T24 e seção 12).

---

## 2. Rota

`app/api/whatsapp/route.ts`, no runtime Node padrão, com `dynamic = "force-dynamic"` e `maxDuration = 60`. O endereço de produção mora num lugar só: `ENDERECO_PRODUCAO`, em `sistema/ambiente.ts`, de onde saem o endereço do aviso do Mercado Pago (`pagamentos/integracao.ts`, mesmo valor de antes) e o do WhatsApp (`ENDERECO_WEBHOOK_WHATSAPP`, em `whatsapp/integracao.ts`, terminado em `/api/whatsapp`), que Integrações mostra com o botão "Copiar endereço". Na troca de domínio (M11.2), muda uma linha. Nas prévias, o endereço não recebe nada.

### 2.1 Ambiente (`whatsapp/ambiente.ts`)
Deny-by-default: variável ausente ou com valor inesperado desliga. Nenhum valor sai daqui para a tela ou para um registro.
- **`WHATSAPP_RECEBIMENTO`:** só `ligada` liga o POST. Quem liga é Diego. **Implementação (17/10):** o valor é aparado antes de comparar, como a `BEDS24_ESCRITA`; o desenho comparava sem aparar.
- **`WHATSAPP_APP_SECRET`:** a chave secreta do app; assina cada aviso. Sem ela, nenhum aviso é aceito.
- **`WHATSAPP_VERIFY_TOKEN`:** a senha de verificação, que a Meta manda na URL do GET. Precisa de pelo menos 32 caracteres (`TOKEN_MINIMO`), já aparada; abaixo disso o GET responde 403 e Integrações mostra "curta demais (mínimo 32 caracteres)". Motivo: o registro de acessos da Vercel guarda o endereço com a consulta (o Sentry não guarda: `urlQueryParams: false`). A frase do guia está na seção 11.2.
- As três ficam só no ambiente Production da Vercel (o quadro "Onde fica cada coisa" de Integrações diz isso).

### 2.2 Assinatura (`whatsapp/assinatura.ts`)
- Cabeçalho `x-hub-signature-256` no formato `sha256=<64 hex>`, com teto de 100 caracteres antes da regex; hex em maiúsculas é aceito e comparado em minúsculas (T20). Qualquer outra forma (sem prefixo, `sha1=`, 63 ou 65 hex) é recusada.
- HMAC-SHA256 com o segredo sobre os **bytes crus** do corpo, antes de qualquer decodificação, comparado em tempo constante. O mesmo JSON com outro espaçamento já não confere (teste com um vetor fixo em `whatsapp/fixtures/corpo-assinado.json`).
- A senha de verificação é comparada pelos resumos sha256 dos dois lados (mesmo tamanho sempre, como `pagamentos/limites.ts`); tamanhos diferentes não lançam.
- `hub.challenge` só com `[A-Za-z0-9_-]`, de 1 a 128 caracteres.
- `pagamentos/assinatura.ts` (Mercado Pago) não muda.

### 2.3 GET (verificação), nesta ordem
Nunca toca o banco e não depende de `WHATSAPP_RECEBIMENTO` (T2): a Meta verifica ao salvar o endereço, antes de o recebimento ser ligado.
1. Sem senha de verificação, ou curta: 403.
2. `hub.mode` diferente de `subscribe`: 403.
3. Senha que não confere: 403.
4. `hub.challenge` ausente ou fora do formato: 400.
5. 200, com o challenge no corpo, `text/plain; charset=utf-8` e `cache-control: no-store`.

As respostas de erro não têm corpo.

### 2.4 POST (avisos), nesta ordem
Todas as respostas sem corpo e com `cache-control: no-store`.
1. Chave desligada: **503**, sem ler o corpo e sem banco (T1). A Meta reenvia por até 7 dias.
2. Sem segredo, ou cabeçalho ausente ou malformado: **401**, sem ler o corpo, sem banco e sem contar (T3).
3. Leitura com teto de 4 MB (`lib/corpo-limitado.ts`, o mesmo helper que o aviso do Mercado Pago passou a usar): o teto vale pelo `Content-Length` declarado (só quando é um número inteiro; `1e9` e `0x1F4` são ignorados e a leitura confere) e pela leitura em partes, que para e cancela ao passar. Acima: **413**, sem banco e sem contar (T4). Leitura que lança: **400**.
4. Só agora o banco.
5. Assinatura que não confere: soma 1 em `assinaturas_recusadas` (falha da soma é ignorada) e **401**.
6. Dali em diante, tudo num `try` só (a decodificação estrita, a leitura do aviso, a gravação e a conta do ilegível), para nenhuma exceção sair para o Next, que imprimiria a mensagem no registro da Vercel e a mandaria ao Sentry com o contexto do pedido:
   - corpo ilegível (UTF-8 inválido, JSON quebrado, forma fora do esperado): soma 1 em `ilegiveis`, grava o último aviso válido e **200** (T5);
   - legível: `receberAviso` grava tudo numa transação (seção 5); os e-mails da conta saem depois da resposta, em `after()`, e um erro ali vai para o Sentry à parte;
   - qualquer erro: `avisarErroDoServidor(erro, "aviso-whatsapp")`, que troca a mensagem antes do Sentry, e **500**; a Meta reenvia, e a gravação é idempotente.
7. **200**.

Nada do corpo, dos cabeçalhos, do segredo ou da senha é registrado, e não há `console` na rota. Depois da leitura do corpo, os únicos `await` fora do `try` são a soma da assinatura recusada e o aviso do `catch`.

### 2.5 Retenção
Uma constante só: `GUARDAR_EVENTOS_DIAS = 90`, em `lib/retencao.ts`, a mesma dos eventos do Mercado Pago (`pagamentos/eventos.ts` reexporta). Vale para `whatsapp_eventos` e `whatsapp_avisos_dia` (seção 5.8). Conversas e mensagens não são apagadas sozinhas (T12).

---

## 3. Tabelas e configuração

### 3.1 Migração 0073 (`app/drizzle/0073_m10_1a_whatsapp.sql`)
Idempotente como a 0067 a 0072 (o banco das prévias é compartilhado e as migrações entram por hash): `CREATE TABLE IF NOT EXISTS`, cada FK e cada CHECK num bloco `DO $$ … IF NOT EXISTS`, índices com `IF NOT EXISTS`. Mudança depois do primeiro push com prévia só por `ADD COLUMN IF NOT EXISTS` no mesmo arquivo: o `CREATE TABLE IF NOT EXISTS` não acrescenta coluna. Listas fechadas ficam como texto sem CHECK de lista, com os valores em `whatsapp/regras.ts` (o `schema.ts` importa só os tipos); CHECK só para a estrutura. Os 26 nomes de restrição e índice escritos na migração (11 chaves estrangeiras, 6 CHECKs, 9 índices) têm até 63 caracteres, e o teste os mede na migração, não no catálogo (o Postgres corta o nome em silêncio). Se o M8.3c entrar antes com outra 0073, quem entra depois renumera num commit novo, nunca editando a 0073 do outro.

Telefone (`wa_id`), BSUID, nomes, texto e `wamid` só existem em `whatsapp_contatos` e `whatsapp_mensagens`. Nenhuma tabela guarda mídia, url, id de mídia, `sha256`, nome de arquivo, coordenadas, contato compartilhado ou `system.body`.

**`whatsapp_conta`:** a situação que os avisos escrevem. Uma linha por organização, criada no primeiro aviso; sem linha, a conta conta como "não conectada".

| Coluna | Para quê |
|---|---|
| `organizacao_id` | Chave |
| `situacao` | `nao_conectada` (padrão), `conectada`, `aguardando_reconexao`, `desconectada` ou `suspensa` |
| `ultimo_evento`, `motivo`, `iniciado_por` | O código do último evento aplicado, o motivo da desconexão e quem a iniciou (`USER`, o próprio aplicativo; `SYSTEM`, a Meta) |
| `situacao_em` | A hora da Meta do último evento aplicado: só um evento mais novo muda a situação |
| `conectado_em` | `PARTNER_ADDED`: começa o prazo de 24 h para pedir contatos e histórico (M10.1b) |
| `sincronizacao_contatos`, `sincronizacao_historico` | `nao_pedida` (padrão), `pedida` (só o M10.1b grava), `recebendo`, `concluida` ou `recusada` |
| `contatos_recebidos_em` | O último aviso de agenda aceito, mesmo que tudo nele tenha sido descartado: a Meta não manda sinal de fim da agenda |
| `progresso_historico` | O maior `progress` recebido (CHECK `whatsapp_conta_progresso`: nulo ou de 0 a 100) |
| `atualizado_em` | |

**`whatsapp_contatos`:** a conversa (um cliente do WhatsApp da empresa).

| Coluna | Para quê |
|---|---|
| `id`, `organizacao_id` | |
| `bsuid` | O `user_id` da Meta: a chave principal da identidade (T15) |
| `wa_id` | Só dígitos, com DDI: a segunda chave, opcional |
| `nome_perfil` | O nome do perfil do WhatsApp |
| `nome_agenda`, `nome_agenda_em` | O nome na agenda do celular, só de quem já tem conversa (T11) |
| `ultima_mensagem_em` | Qualquer mensagem, de qualquer origem: ordena a lista |
| `ultima_recebida_em` | Só `recebida` em tempo real, menos o aviso de troca de identidade ("sem resposta" e "não lida") |
| `ultima_enviada_em` | Só as enviadas em tempo real (a resposta pelo celular conta) |
| `lida_ate` | Estado interno; nada é marcado como lido na Meta |
| `conflito_identidade` | "Confira o contato" (T15) |
| `reserva_id`, `cotacao_id`, `pedido_contato_id`, `cadastro_marketplace_id`, `proprietario_id` | O vínculo confirmado, no máximo um. As FKs de pedido e cadastro têm nome próprio (`whatsapp_contatos_pedido_contato_fk`, `whatsapp_contatos_cadastro_fk`): o automático passaria de 63 caracteres |
| `vinculo_confirmado_por` (`on delete set null`), `vinculo_confirmado_em` | Quem confirmou e quando |
| `criado_em`, `atualizado_em` | |

Índices e restrições:
- únicos parciais `whatsapp_contatos_wa_id` (`organizacao_id`, `wa_id`) e `whatsapp_contatos_bsuid` (`organizacao_id`, `bsuid`), cada um só com o valor não nulo;
- `whatsapp_contatos_ultima` em `(organizacao_id, ultima_mensagem_em DESC NULLS LAST)`, a ordem da lista. **Implementação (17/10):** o desenho tinha o índice crescente; conferido no PGlite que, com ele, a lista ("mais recente primeiro, conversa sem mensagem no fim", `order by ultima_mensagem_em desc nulls last`) lia a tabela inteira e ordenava, e que na ordem da lista o índice é usado;
- `whatsapp_contatos_reserva` e `whatsapp_contatos_cotacao`, parciais, só com o valor não nulo (a limpeza de cotações consulta pela segunda, seção 6.6);
- CHECK `whatsapp_contatos_identidade`: `wa_id` ou `bsuid` não nulo;
- CHECK `whatsapp_contatos_wa_id_digitos`: `wa_id` nulo ou de 6 a 20 dígitos (a mesma forma `FORMA_WA_ID` de `whatsapp/telefone.ts`, que o parser usa);
- CHECK `whatsapp_contatos_um_vinculo`: no máximo um alvo, e ter um alvo anda junto com `vinculo_confirmado_em`. Não há coluna de "sugestão": a sugestão é calculada na hora (T7).

**`whatsapp_mensagens`:**

| Coluna | Para quê |
|---|---|
| `id`, `organizacao_id`, `contato_id` | |
| `wamid` | O id da mensagem na Meta, tratado como dado pessoal (T19) |
| `direcao` | `recebida`, `enviada_celular` (resposta pelo WhatsApp Business do celular) ou `enviada_painel` (só no M10.2) |
| `origem` | `tempo_real` ou `historico` |
| `tipo` | `texto`, `imagem`, `audio`, `video`, `documento`, `figurinha`, `localizacao`, `contato`, `nao_suportada`, `sistema`, `outro`, `pendente` ou `midia_pendente` |
| `texto` | Só o texto e a legenda |
| `anexo_mime` | Só o tipo do anexo |
| `resposta_a` | O `context.id` (a mensagem respondida), sem exigir formato |
| `enviada_em` | O `timestamp` da Meta |
| `recebida_em` | |
| `editada_em`, `apagada_em` | A hora da edição aplicada; a hora do apagamento |
| `reacao`, `reacao_em` | O emoji da reação (nulo = sem reação ou retirada) |
| `situacao` | Só para as enviadas pelo painel (M10.2); nula aqui |

Índices e restrições: único `whatsapp_mensagens_wamid` (`organizacao_id`, `wamid`); `whatsapp_mensagens_contato` (`contato_id`, `enviada_em`); CHECK `whatsapp_mensagens_apagada_sem_texto` (apagada tem texto vazio: o apagamento é absorvente); CHECK `whatsapp_mensagens_wamid_tamanho` (de 1 a 256 caracteres, o `LIMITE_WAMID`).

**`whatsapp_eventos`:** um por bloco processado, sem nada do corpo.

| Coluna | Para quê |
|---|---|
| `id`, `organizacao_id` | |
| `campo` | Um dos cinco campos |
| `tipo`, `motivo` | No `account_update`, o código do evento e o motivo validados; senão vazio |
| `chave` | Só no `account_update`: `account_update:<event>:<entry.time em segundos>:<reason ou ->:<ban_state ou ->`. Nunca leva `wamid`, telefone, BSUID ou id da Meta (a organização já identifica a conta) |
| `itens` | Linhas novas ou alteradas do bloco |
| `resultado` | `gravado`, `repetido` (havia o que aplicar e nada mudou) ou `ignorado` (nada aproveitável) |
| `ocorrido_em`, `recebido_em` | O `entry.time` do evento de conta; a hora da gravação |
| `avisar_por_email`, `email_aviso_em`, `email_resultado` | O e-mail da conta: se pede, quando saiu (só o envio confirmado) e o último resultado (`enviado`, `sem-email`, `sem-correio` ou `falhou`) |

Índices: único parcial `whatsapp_eventos_chave` (`organizacao_id`, `chave`) só com a chave não vazia; `whatsapp_eventos_recebido` (`recebido_em`), para a limpeza.

**`whatsapp_avisos_dia`:** como `pagamentos_avisos_dia`, sem organização (a assinatura inválida chega antes de saber de quem é). Por dia de São Paulo: `assinaturas_recusadas`, `ilegiveis`, `outra_conta`, `desconhecidos`, `ignorados` e `ultimo_valido_em`. Não há contador de corpo grande: o 413 responde antes de autenticar e não toca o banco (T4).

### 3.2 Configuração "whatsapp" (`whatsapp/configuracao.ts`)
No armazém de configurações, chave `whatsapp`, sem migração e com a auditoria automática `configuracao.whatsapp` (T8, T23). Só `configWhatsapp` interpreta o valor.
- **`wabaId` e `numeroId`:** os ids da Meta (a conta do WhatsApp Business e o número), editados em Configurações → Integrações → WhatsApp, formulário "Identificação na Meta". São números do painel de desenvolvedores, não senhas; ficam só no banco, nunca no Git. A forma é `ID_META` (de 1 a 25 dígitos), em `whatsapp/regras.ts`, para o parser puro não importar o banco.
- **`quemVeConversas`:** `so_admin` (padrão) ou `admin_e_operacao` (decisão 2 de Diego, T9). Editado só por quem tem `configuracao:editar` (hoje, só o admin), no formulário "Quem vê as conversas". Quem decide o acesso é `whatsapp/acesso.ts`, que lê daqui (seção 7.1).
- Sem `appId` no M10.1a: nada aqui usa o id do app (a assinatura usa o segredo). O M10.1b o acrescenta na mesma chave, sem migração, junto com o que a conexão precisar.
- **Lado seguro:** id fora de `ID_META` vira nulo; "quem vê" fora da lista vira `so_admin`; chave desconhecida é descartada.
- **As duas gravações seguem o mesmo molde**, para uma não apagar a outra: numa transação, a trava da chave e o valor atual relido debaixo dela, depois a gravação com o atual mais os campos novos. A gravação dos ids toma antes uma trava global (`whatsapp:waba`) e recusa a WABA que já é de outra organização (`waba_de_outra_empresa`, "Esta conta do WhatsApp já está ligada a outra empresa no sistema."). Nada mudou: `sem_mudanca`, sem gravar nem auditar.
- **Implementação (17/10):** a gravação dos ids ganhou o resultado `id_invalido`: o domínio também confere os ids, apara os espaços, trata o texto vazio como "apagar" e recusa qualquer outra coisa (texto torto, campo que não veio, número, arquivo, objeto) sem gravar, para um valor torto nunca virar "apagar" em silêncio. A tela mostra "Use só números (até 25 dígitos).".
- **A dona da conta:** `organizacaoDaConta` acha a organização pela WABA e `organizacaoDoNumero` (só para o histórico recusado sem envelope, seção 4.4) pelo número. As duas só aceitam **exatamente uma** organização; nenhuma ou mais de uma dão nulo e o bloco conta em `outra_conta`. **Implementação (17/10):** a busca só conta o campo gravado como texto (`jsonb_typeof = 'string'`), o mesmo critério de `configWhatsapp`, e id de entrada fora da forma devolve nulo sem consultar.

---

## 4. Leitura dos avisos

`whatsapp/aviso.ts`, função pura `lerAviso`: sem banco, sem rede, sem relógio e sem `console`, e importa só `whatsapp/regras.ts` e `whatsapp/telefone.ts`. Recebe o JSON já conferido pela assinatura e devolve os blocos (um por `change`) com o que a gravação usa. O que não serve é descartado e contado: `desconhecidos` (forma que o sistema não reconhece: avisar em vez de supor) ou `ignorados` (forma conhecida que de propósito não se guarda: grupos, status, eventos sem efeito). Quem decide se o bloco é da nossa conta é `whatsapp/receber.ts` (seção 5.1).

Nunca sai da leitura: `url`, id de mídia, `sha256`, `filename`, coordenadas e endereço da localização, os dados de um contato compartilhado, `system.body` (traz nomes e os dois telefones), `referral`, `identity_key_hash`, `username` e os BSUID "pai" (`parent_user_id`, `previous_parent_user_id`). Da mídia, só o tipo, o mime e a legenda.

### 4.1 Validação estrita
| Valor | Regra | Fora da regra |
|---|---|---|
| `object` | `whatsapp_business_account` (única exceção: o histórico recusado sem envelope, 4.4) | Corpo ilegível |
| `entry` | Lista não vazia, sem teto próprio (a Meta agrupa até 1.000 atualizações por POST, página "Create a webhook endpoint"); `entry[].id` em `ID_META` e com `changes` | Entrada descartada, `desconhecidos` +1 |
| `field` | Um dos cinco campos, com `value` objeto | Bloco descartado, `desconhecidos` +1 |
| Itens do corpo | Até `LIMITE_ITENS` (50.000), somando entradas, blocos, contatos, mensagens, ecos, status, erros, agenda, pedaços e conversas do histórico e as mensagens delas | Corpo inteiro ilegível (nunca cortado em parte) |
| `timestamp`, `entry.time`, `metadata.timestamp` | Texto de até 12 dígitos ou inteiro, em segundos, entre 2009 e 2100 | Item descartado, `desconhecidos` +1 |
| `wa_id`, `from`, `to`, `phone_number`, `threads[].id` | "+" opcional e de 6 a 20 dígitos (`FORMA_WA_ID`), guardado só com os dígitos | Tratado como ausente |
| BSUID (`user_id`, `from_user_id`, `to_user_id`, `previous_user_id`) | Duas letras maiúsculas, ponto, "ENT." opcional e de 1 a 128 letras e números | Tratado como ausente |
| `wamid` (`id`, `original_message_id`, `reaction.message_id`) | ASCII imprimível, de 1 a 256 caracteres (não depende do prefixo `wamid.`) | Item descartado, `desconhecidos` +1 |
| `context.id` | A mesma regra do `wamid` | `resposta_a` nulo |
| `text.body`, `caption` | Até 8.192 caracteres | A mensagem vira `outro`, sem texto, `desconhecidos` +1 (T25) |
| `profile.name`, `full_name`, `first_name` | Aparado, até 256 caracteres, sem caractere de controle | Ignorado |
| `mime_type` | Tipo e subtipo em minúsculas, com `codecs` opcional | `anexo_mime` nulo |
| `emoji` | De 1 a 32 caracteres; ausente ou `""` é a reação retirada | Reação descartada, `desconhecidos` +1 |
| `metadata.phone_number_id` | `ID_META`; **obrigatório** em `messages`, `smb_message_echoes`, `history` e `smb_app_state_sync` (T18) | Bloco descartado, `desconhecidos` +1 (nunca aceito) |
| `metadata.display_phone_number` | Telefone, só os dígitos | Sem ele, o que depende do número da empresa não decide (4.4) |
| `progress`, `phase`, `chunk_order` | Inteiro de 0 a 100; de 0 a 2; maior ou igual a 0 | Ignorado; nulo; nulo |

Uma mensagem sem `wa_id` e sem BSUID válidos é descartada (`desconhecidos` +1). A exceção é a mensagem `system`, cuja identidade é a anterior da troca (4.2).

**Implementação (17/10):** casos que o desenho não listava contam como `desconhecidos`: `system.type` desconhecido, `action` de agenda desconhecida, lista em formato errado e contato sem identidade. A contagem do que não chegou a virar bloco (entrada, campo ou bloco descartado) fica no aviso, e não num bloco; `receber.ts` soma as duas.

### 4.2 Campo `messages` (direção `recebida`, origem `tempo_real`)
- `contacts[]`: `profile.name`, `wa_id` (pode faltar) e `user_id`. O resto do contato é ignorado.
- Identidade da mensagem: o `from` (telefone) e o `from_user_id` (BSUID), com o contato do bloco. O contato casa pelo mesmo `user_id`; senão, pelo `wa_id` com chave em comum com o `from` (`chavesDoWaId`, seção 6.1: a Meta avisa nas páginas de text, unsupported e reaction que o id do usuário e o telefone nem sempre batem, como "+" na frente ou o celular brasileiro sem o nono dígito). O `wa_id` do contato casado vale mais que o telefone da mensagem; o BSUID da mensagem vale mais que o do contato.
- **Implementação (17/10), contato único:** o desenho casava pelo contato único "com um só contato no bloco". Agora isso vale só para o par da Meta, um contato e **um item** no bloco (`messages` mais `message_echoes`), e só se o BSUID do contato não contradiz o da mensagem. Com mais itens, a mensagem que não casa fica com o próprio telefone e o próprio BSUID: sem isso, uma mensagem sem nada em comum ficaria com a identidade de outra pessoa.
- **Implementação (17/10), perfil:** o nome do perfil só passa ao bloco quando o contato tem algum item aceito (mensagem, edição ou apagamento com o mesmo BSUID ou chave em comum). O contato de uma mensagem de grupo, de um `unsupported` de evento, de uma reação ou de um item descartado não vira conversa e não deixa telefone nem nome guardados.
- **Implementação (17/10), "recebida" da própria empresa:** uma recebida cujo `from` tem chave em comum com o número da empresa (`metadata.display_phone_number`) é descartada (`desconhecidos` +1). No tempo real não acontece; no histórico seria a mídia mandada pelo celular da empresa chegando depois, sem dizer para quem foi (4.4).
- `group_id` presente: `ignorados` +1, nada guardado (T24).
- Por `type`:
  - `text`: tipo `texto` com o `text.body`;
  - `image`, `video`, `document`: `imagem`, `video`, `documento`, com a legenda como texto e o mime; `audio` e `sticker`: `audio` e `figurinha`, com o mime. Nunca `url`, `id`, `sha256` ou `filename`;
  - `location`: `localizacao`, sem nada; `contacts`: `contato`, sem nada;
  - `unsupported`: se o `unsupported.type` é um evento sobre outra mensagem (`edit`, `reaction`, `pin`, `keep_in_chat`, `poll_update`; o exemplo oficial é justamente `edit`), não vira linha e soma `ignorados`; qualquer outro valor, ou ausente (131051 e 131060), vira `nao_suportada`, sem texto;
  - `system`: tipo `sistema`, sem texto, mais uma troca de identidade. Pela referência (messages/system, atualizada em 11/8/2026) e pela página do BSUID, essa mensagem não traz `contacts` nem `from_user_id`; o `user_changed_user_id` também não traz `from` e, em geral, nem `system.wa_id`; o BSUID antigo vem em `system.previous_user_id` ("omitted when unavailable"). Troca de número (`user_changed_number`): a anterior é o `from` com o `previous_user_id`, a nova é o `system.wa_id` com o `system.user_id`. Troca de BSUID (`user_changed_user_id`): a anterior é o `system.wa_id` (ou o `from`) com o `previous_user_id`, a nova é o mesmo telefone com o `system.user_id`. Sem identidade anterior: nada, `desconhecidos` +1. A linha `sistema` fica na conversa da identidade anterior. **Implementação (17/10):** troca cuja identidade nova vem vazia não é emitida; só a linha `sistema` fica;
  - `button`, `interactive`, `order`: `outro`, sem texto;
  - `reaction`: reação (alvo e emoji, ou retirada), sem linha própria. **Implementação (17/10):** a reação não exige a identidade do cliente;
  - `edit`: edição do `edit.original_message_id`, com o `edit.message` lido pelas mesmas regras de tipo. Só há exemplo de imagem; a edição de texto é **[não confirmado]** e lida do mesmo jeito. O `edit.message.context` é ignorado (os exemplos trazem `context.id: "M0"`, que não é um `wamid`): a edição nunca muda `resposta_a`. **Implementação (17/10):** edição ilegível (tipo desconhecido, ou texto acima de 8.192 caracteres) não se aplica e conta em `desconhecidos`, porque aplicá-la como `outro` apagaria o texto que a mensagem tem;
  - `revoke`: apagamento do `revoke.original_message_id`;
  - `media_placeholder`: `midia_pendente`;
  - outro valor: `outro`, `desconhecidos` +1 (T25).
- `context.id` vira `resposta_a`. `statuses[]` e `value.errors[]` somam `ignorados`, sem conteúdo guardado.

### 4.3 Campo `smb_message_echoes` (direção `enviada_celular`, origem `tempo_real`)
- `message_echoes[]` com os mesmos tipos de 4.2. A identidade do cliente é o `to` com o `to_user_id` (mais o `contacts[]`, que só aparece com BSUID); o `from` é o número da empresa e é ignorado.
- Sem `to` e sem `to_user_id`: descartada, `desconhecidos` +1.
- Edição e apagamento feitos pela empresa chegam aqui, com direção `enviada_celular`.
- Tipos no eco além de text, image, video, document, revoke e edit são **[não confirmado]** (referência de smb_message_echoes) e lidos de forma genérica.

### 4.4 Campo `history` (origem `historico`)
Três formatos:
- **a) Conversas em `history[].threads`.** O pedaço traz `metadata` (`phase`, `chunk_order`, `progress`; fica o maior `progress` do bloco, e só ele decide o fim, em 100). A identidade da conversa é o `threads[].id` (telefone; na forma de BSUID é **[não confirmado]**) com `context.wa_id` e `context.user_id`. A direção de cada mensagem, nesta ordem, nunca pela presença de `to` e nunca "recebida" por exclusão:
  1. `from` com chave em comum com a conversa (`threads[].id` ou `context.wa_id`): recebida;
  2. `from` com chave em comum com o número da empresa (`metadata.display_phone_number`): enviada pelo celular. A chave em comum é tolerância: a documentação não diz que o número da empresa venha em outra forma, mas o celular brasileiro sem o nono dígito não pode virar "Cliente";
  3. `from_user_id` igual ao BSUID da conversa: recebida (inclusive sem `from`);
  4. nada casa: descartada, `desconhecidos` +1.

  **Implementação (17/10):** no desenho, o `from_user_id` vinha junto com o `from` no passo 1. Agora o `from` decide antes: a página do BSUID diz só que `from_user_id` "será o BSUID do usuário", sem dizer se aparece também na mensagem da empresa (**[não confirmado]**), e um `from` da empresa nunca pode virar "recebida" por causa dele. Com o número da empresa inválido, só as mensagens cuja direção não dá para saber são descartadas; as que vêm do telefone do cliente continuam como recebidas. `history_context.status` é ignorado; edição e apagamento seguem 4.2, com origem `historico`.
- **b) Mídia que chega depois** (`value.messages[]` ou `value.message_echoes[]` no campo `history`): lida como 4.2 ou 4.3, com origem `historico`. A referência de history marca a mídia mandada pela empresa como `media_placeholder` com `from` da empresa; o exemplo da mídia tardia só mostra o `from` do cliente, então a mídia tardia da empresa é **[não confirmado]** e cai na regra da "recebida da própria empresa" (4.2): fica a linha `midia_pendente` da conversa, "ver no celular".
- **c) Histórico recusado:** `history[].errors[]` com `code` 2593109 marca o histórico como recusado; outro código soma `desconhecidos`. A referência mostra esse aviso **sem o envelope** (só `messaging_product`, `metadata` e `history[].errors`); o envelope completo com `field: "history"` é **[não confirmado]**. A leitura aceita os dois. Sem envelope, a tolerância é estreita: `messaging_product` igual a `whatsapp`, `phone_number_id` válido, cada pedaço só com erros e pelo menos um 2593109; o bloco sai com o número e sem WABA, e `receber.ts` acha a organização pelo número (3.2). Qualquer outra coisa sem envelope continua ilegível. O pedido de histórico só pode ser feito uma vez: perder a recusa deixaria "Histórico: pedido" para sempre.

### 4.5 Campo `smb_app_state_sync` (agenda do celular)
- `state_sync[]` com `type: "contact"`: `contact.full_name` ou `contact.first_name` (nunca `contact.name`), `contact.phone_number` (pode faltar) e `contact.user_id`; `action` `add` (inclui edição) ou `remove` (sem nome); `metadata.timestamp` em texto ou número.
- Outro `type` e item sem identidade: `ignorados` +1 (não é erro, só não serve). **Implementação (17/10):** `add` sem nome válido também soma `ignorados`, porque a agenda só serve para dar o nome.

### 4.6 Campo `account_update`
- `value.event` em `EVENTOS_CONTA` (`PARTNER_ADDED`, `PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED`, `ACCOUNT_RECONNECTED`, `ACCOUNT_DELETED`, `PARTNER_APP_UNINSTALLED`, `DISABLED_UPDATE`, `ACCOUNT_RESTRICTION`, `ACCOUNT_VIOLATION`) vira evento de conta. Os eventos documentados que não mudam nada aqui (`EVENTOS_CONTA_SEM_EFEITO`: `PARTNER_APP_INSTALLED`, esperado já na conexão, e os outros da referência atualizada em 2/10/2026) somam `ignorados`; fora das duas listas, `desconhecidos`.
- As WABA do bloco são o `entry.id` e o `value.waba_info.waba_id`, sem repetir (T17). Cobre os dois formatos documentados: o da referência (o `entry.id` do parceiro e o `waba_info`) e o da página de coexistência (`PARTNER_REMOVED` com o `entry.id` igual à WABA, sem `waba_info`, com `disconnection_info`).
- A hora é o `entry.time` (número ou texto); sem ela, `desconhecidos`.
- `disconnection_info.reason` em `MOTIVOS_DESCONEXAO` (senão nulo), `initiated_by` em `USER` ou `SYSTEM` (senão nulo), `ban_info.waba_ban_state` em `SCHEDULE_FOR_DISABLE`, `DISABLE` ou `REINSTATE` (senão nulo). `owner_business_id`, `phone_number`, `restriction_info` e `violation_info` não são lidos.

---

## 5. Idempotência e ordem

### 5.1 Orquestração (`whatsapp/receber.ts`)
1. Para cada WABA distinta do aviso, a organização dona (uma consulta por WABA, guardada durante a chamada); o bloco sem WABA (só o histórico recusado sem envelope) acha a organização pelo número.
2. Por bloco: sem dona (nenhuma ou mais de uma organização), ou não aceito por ela, soma 1 em `outra_conta` e não grava nada. Os quatro campos de mensagem exigem o número configurado igual ao do bloco (T18: sem número configurado, nada de mensagem é aceito, e Integrações avisa); o `account_update` dispensa o número e é aceito se alguma das WABA do bloco for a configurada (T17).
3. Uma transação só: a gravação de cada organização, na ordem do corpo, e no fim os contadores do dia com o último aviso válido. Se a transação falhar, nada fica (nem os contadores), a rota responde 500 e a Meta reenvia (T6).
4. Devolve os eventos de conta novos e aplicados que pedem e-mail (seção 5.7).

### 5.2 Gravação (`whatsapp/gravar.ts`), nesta ordem
Por bloco, na ordem do corpo: (1) conversas; (2) trocas de identidade; (3) mensagens; (4) edições; (5) apagamentos; (6) reações; (7) agenda; (8) histórico; (9) evento de conta; (10) resumo das conversas tocadas; (11) um `whatsapp_eventos` por bloco que não é de conta. Telefone, BSUID, nomes, texto e `wamid` vão sempre como parâmetro, e nenhuma mensagem de erro lançada leva dado nenhum.

A garantia de "uma linha só" são os índices únicos da 0073 (`wamid`, `wa_id` e BSUID por organização, chave do evento de conta). A ordem estável das travas entre entregas paralelas (identidades, `wamid`, id da conversa) só reduz o impasse; se o Postgres desfizer uma das transações (40P01), a rota responde 500 e a Meta reenvia. O PGlite dos testes roda as transações em fila: a corrida é testada injetando a linha da "outra entrega" entre a busca e o insert.

### 5.3 Conversas e identidade (passos 1 e 2)
- **Passo 1:** junta as identidades do bloco (perfis, mensagens, edições, apagamentos e a identidade **anterior** de cada troca), numa busca em lote pelo BSUID e por todas as variantes do `wa_id` (`chavesDoWaId`: o celular brasileiro com e sem o nono dígito acha a mesma conversa), decide em memória e cria as que faltam num insert em lote (`on conflict do nothing`, sem alvo: cobre os dois únicos parciais). As que outra entrega criou no meio são relidas pelas duas buscas, e o ramo "achou" vale de novo; se nem assim achar, a gravação lança (500, a Meta reenvia). O nome do perfil é gravado quando muda e não é vazio.
- **Trava da criação (revisão do Codex, 17/10):** antes do primeiro bloco, a gravação toma uma trava de transação por identidade do corpo: uma por BSUID e uma por telefone na forma única (a mesma com e sem o nono dígito), numa instrução só e na ordem do hash. Sem ela, duas entregas paralelas do mesmo cliente, uma com o nono dígito e outra sem, achariam as duas "nenhuma conversa" e criariam duas, porque os índices únicos só cobrem o `wa_id` exato.
- **Achou uma linha:** completa o campo que falta (o `wa_id` só se nenhuma outra linha da organização tem aquele `wa_id` ou uma variante dele; o mesmo para o BSUID). Se a busca pelo BSUID e a pelo `wa_id` acham linhas diferentes, as duas ganham `conflito_identidade` e fica a do BSUID: nunca fundir (T15).
- **Acréscimo ao desenho, dentro de T15 (Implementação, 17/10):** quando a conversa é achada pelo telefone, mas já tem **outro** BSUID, ela também ganha `conflito_identidade`: pode ser outra pessoa com o mesmo número. O desenho só marcava conflito entre duas linhas diferentes. A mensagem fica nessa conversa, e a tela mostra "Confira o contato".
- **A identidade nova de uma troca no mesmo bloco (Implementação, 17/10):** a Meta junta até 1.000 atualizações por POST, então a troca e a primeira mensagem da identidade nova podem vir juntas. Se a identidade nova ainda não é de nenhuma outra conversa, as mensagens e o perfil dela ficam na conversa da anterior (um "apelido", também em cadeia: A para B e B para C caem todos na conversa de A, sem ciclo), e o passo 2 troca a identidade dessa conversa. Sem isso, a identidade nova ganharia conversa própria e o passo 2 sempre a acharia "em outra conversa", com conflito falso. Se ela já é de outra conversa, não há apelido: as mensagens ficam nessa conversa, e o passo 2 marca o conflito nas duas.
- **Passo 2, trocas (em ordem de hora):** acha a conversa pela identidade anterior (o `user_changed_number` sem `from` acha só pelo BSUID antigo); se a nova já é de outra conversa, as duas ganham o conflito e nada muda; senão a conversa passa a ter a identidade nova, e campo nulo na nova não apaga o da conversa (a troca de BSUID mantém o `wa_id`; a de número sem BSUID novo mantém o BSUID).

### 5.4 Mensagens (passo 3): precedência por posto (T16)
Insert em lotes de 500, ordenado pelo `wamid`, sem repetir `wamid` no lote (fica o de maior posto e, no empate, o primeiro: o Postgres recusa um `on conflict do update` que toca a mesma linha duas vezes). No mesmo `wamid`, o posto de cada tipo (`POSTO_DO_TIPO`, escrito também em SQL): `pendente` 0; `midia_pendente` e `nao_suportada` 1; conteúdo 2. A linha só muda quando o novo sobe de posto ou quando o histórico vira tempo real. Isso garante:
- repetição (inclusive do mesmo provisório) e eco do mesmo `wamid` viram uma linha só e não voltam como alteradas: o bloco sai `repetido`;
- o conteúdo só sobe, nunca desce: uma 131060 em tempo real reenviada depois do conteúdo não apaga o texto nem o tipo (só a origem passa a `tempo_real`);
- o tempo real nunca volta a ser histórico: o histórico depois de uma 131060 em tempo real traz o conteúdo e mantém `tempo_real`;
- `resposta_a` e `anexo_mime` não são apagados por um aviso que não os traz. **Implementação (17/10):** quando o tipo sobe, o mime fica o novo **ou**, se o novo não traz, o que já estava (o desenho trocava pelo novo, o que apagaria o mime);
- o provisório `pendente` ganha a hora verdadeira da original; a apagada continua sem texto; a editada mantém o texto da edição; a conversa da linha nunca muda.

### 5.5 Edições, apagamentos e reações (passos 4 a 6)
- **Edição** (em ordem de hora): só a mais nova que a aplicada, sobre mensagem não apagada, troca o texto; o provisório mantém o tipo provisório até a original chegar; o mime só muda se a edição traz um. Edição mais velha, repetida ou sobre apagada: nada muda. Original inexistente: uma linha provisória `pendente` com o texto da edição, na conversa de quem mandou; a original tardia mantém o texto editado e ganha o tipo.
- **Apagamento:** absorvente (o CHECK da 0073 garante): o texto some e nada depois o devolve. Original inexistente: linha provisória `pendente` sem texto. **Implementação (17/10):** só atualiza a linha ainda não apagada, para o reenvio sair `repetido`.
- **Reação:** a mais nova vale (retirada = sem emoji); a mais velha não volta. Não cria linha e não mexe em "sem resposta" nem em "não lida". Mensagem que o sistema não tem (por exemplo, enviada pela API): `ignorados` +1.

### 5.6 Agenda e histórico (passos 7 e 8)
- **Agenda (T11):** só dá o nome de quem já tem conversa, achada pelo BSUID e, sem ele, pelo `wa_id` com as variantes. Quem não tem conversa é descartado sem rastro: nada é criado nem contado, e a conversa criada depois não ganha o nome. Por conversa vale o item mais novo (`add` grava o nome, `remove` limpa), e só se for mais novo que o gravado. Todo bloco de agenda aceito marca `contatos_recebidos_em` e põe `sincronizacao_contatos` em `recebendo` se estava não pedida ou pedida. **Implementação (17/10):** a agenda casa só pelas variantes do `wa_id` (`chavesDoWaId`), sem `chavesDeTelefone`: o exemplo da Meta manda o número com o código do país, e `chavesDeTelefone` aplicado a um número estrangeiro sem "+" geraria uma chave brasileira falsa.
- **Histórico:** o progresso fica no maior recebido (pedaços fora de ordem não importam: as mensagens são idempotentes); 100 marca `concluida`; antes disso, `recebendo` se estava não pedido ou pedido. A recusa (2593109) marca `recusada`, salvo se já `concluida`.

### 5.7 Eventos de conta e e-mail (passo 9, `whatsapp/situacao.ts`, `whatsapp/avisos.ts`)
O evento é gravado uma vez só (a chave dá a idempotência: repetido não grava, não muda a situação e não pede e-mail de novo). O que cada evento faz (`efeitoDoEvento`, puro):

| Evento | Situação | E-mail |
|---|---|---|
| `PARTNER_ADDED` | `conectada`, com `conectado_em` (começa o prazo de 24 h) | não |
| `PARTNER_REMOVED`, `ACCOUNT_DELETED`, `PARTNER_APP_UNINSTALLED` | `desconectada`, com motivo e quem iniciou | sim |
| `ACCOUNT_OFFBOARDED` | `aguardando_reconexao` | sim |
| `ACCOUNT_RECONNECTED` | `conectada`, sem motivo | não |
| `DISABLED_UPDATE` com `DISABLE` ou `SCHEDULE_FOR_DISABLE` | `suspensa` | sim |
| `DISABLED_UPDATE` com `REINSTATE` | `conectada` | não |
| `ACCOUNT_RESTRICTION`, `ACCOUNT_VIOLATION`, `DISABLED_UPDATE` sem estado | não muda (o evento fica registrado e aparece em Integrações) | não |

- A situação só muda se o evento é mais novo que o último aplicado (empate: vale o que vem depois no corpo). A linha da conta é criada antes da trava, para duas entregas paralelas não lerem a mesma situação "de antes". Se a situação mudou, a auditoria `whatsapp.conta.situacao` sai só com códigos (situação e motivo, antes e depois) e sem autor (o sistema). Evento velho, não aplicado, não manda e-mail. **Implementação (17/10):** `efeitoDoEvento` devolve também o motivo e quem iniciou, que ficam nulos quando a conta volta a "conectada" (a regra do `ACCOUNT_RECONNECTED` num lugar só); a gravação do evento ficou em `gravar.ts`, para `situacao.ts` continuar puro (as telas importam os rótulos dele).
- **E-mail (T21):** vai ao e-mail da empresa (Configurações → Empresa), por `avisarEquipePorEmail`, e não a cada usuário admin. A rota manda depois da resposta (`after()`); a rotina repete o que ficou pendente por até 7 dias (`REPETIR_EMAIL_DIAS`), com a mesma chave (`whatsapp-conta:<id do evento>`: o provedor não manda duas vezes). O resultado de cada tentativa fica em `email_resultado`; só o envio confirmado grava `email_aviso_em` e encerra as tentativas. **Implementação (17/10):** a gravação do resultado só vale enquanto o evento não tem envio confirmado: o `after()` e a rotina podem tentar o mesmo evento ao mesmo tempo, e a recusa da segunda chamada, gravada depois do envio da primeira, apagaria um e-mail que saiu.
- **Textos do e-mail** (só o evento: código, motivo, hora da Meta; nunca id da Meta, número, nome, telefone ou trecho de conversa):
  - desconexão, assunto **"WhatsApp desconectado do sistema"**: "A Meta avisou em {dia e hora} (horário de Brasília) que o WhatsApp da empresa foi desconectado do sistema. Motivo informado: {motivo ou "motivo não informado pela Meta"}{", pelo próprio aplicativo" ou ", pela Meta"}. As mensagens novas não chegam ao painel até a conexão ser refeita. O WhatsApp no celular continua funcionando. Veja em Configurações → Integrações → WhatsApp.";
  - `ACCOUNT_OFFBOARDED`, assunto **"WhatsApp aguardando reconexão"**: "A Meta avisou em {dia e hora} (horário de Brasília) que o WhatsApp da empresa foi registrado em outro aparelho ou reinstalado. A reconexão costuma ser automática em alguns minutos. Se não voltar, veja em Configurações → Integrações → WhatsApp.";
  - suspensão, assunto **"Conta do WhatsApp suspensa pela Meta"**: "A Meta avisou em {dia e hora} (horário de Brasília) que a conta do WhatsApp da empresa foi suspensa ou está programada para suspensão. Veja em Configurações → Integrações → WhatsApp."
  - **Implementação (17/10):** `whatsapp_eventos` não guarda quem iniciou a desconexão. O trecho "pelo próprio aplicativo" ou "pela Meta" sai da conta, e só quando a conta mostra este evento como o último aplicado (mesmo código e mesma hora da Meta); senão é omitido, sem palpite.
- **Rótulos** (em `whatsapp/situacao.ts`): situação ("Não conectado", "Conectado", "Aguardando reconexão", "Desconectado", "Suspenso"); motivo da desconexão ("a conta foi desconectada do sistema", "a conta deixou de ser WhatsApp Business", "o número da empresa foi trocado no aplicativo", "um aparelho vinculado ficou cerca de 30 dias sem uso", "o celular principal ficou cerca de 14 dias sem abrir o WhatsApp Business", "o número foi registrado de novo no aplicativo"); evento ("Conectado ao sistema", "Desconectado do sistema", "Registrado em outro aparelho", "Reconectado", "Conta apagada", "App do sistema removido da conta", "Mudança de suspensão da conta", "Restrição na conta", "Violação de regra registrada pela Meta").

### 5.8 Resumo, eventos, contadores e rotina (passos 10 e 11, `whatsapp/contadores.ts`, `whatsapp/cron.ts`)
- **Resumo das conversas tocadas:** uma instrução por lote de conversas, a partir das mensagens novas ou alteradas: a última mensagem (qualquer uma), a última recebida e a última enviada em tempo real. Só avança (`greatest`): idempotente. Reação, edição e apagamento não passam por aqui. **Implementação (17/10):** a mensagem `sistema` (troca de número ou de BSUID) atualiza a última mensagem, mas não a última recebida: não deixa a conversa "sem resposta" nem "não lida".
- **Um `whatsapp_eventos` por bloco que não é de conta**, com o campo, os itens e o resultado. **Implementação (17/10):** `ignorado` quando nada se aproveitou (agenda sem conversa, `unsupported` de evento, só grupo ou status, reação sem alvo); `repetido` quando havia o que aplicar e nada mudou; `itens` conta também conversas criadas, completadas, marcadas e renomeadas.
- **Contadores do dia:** um upsert atômico por chamada, no dia de São Paulo, com a coluna de cada contador numa lista fechada; `ultimo_valido_em` só avança.
- **Rotina de hora em hora** (`/api/cron/whatsapp`, aos 17 minutos, `vercel.json`; entrada "whatsapp" em `sistema/automacoes.ts`, ativa): exige o `CRON_SECRET` e só roda no deploy de produção (fora dele responde 403). Apaga os eventos e os dias com mais de 90 dias, guardando o último dia com aviso válido, e repete o e-mail pendente (até 50 por volta, os mais antigos primeiro, `EMAILS_POR_VOLTA`). Resumo só com números: "{n} aviso(s) antigo(s) apagado(s); {m} e-mail(s) da conta enviado(s); {f} falhou(aram); {s} sem e-mail da empresa; {c} sem o e-mail do sistema" ({n} conta só os eventos apagados). Só o e-mail que **falhou** vira falha da rotina (`ErroDeRotina` com `email_nao_enviado`); sem o e-mail da empresa ou sem o e-mail do sistema é configuração que falta, fica no resumo e em Integrações, e virar erro faria um aviso no Sentry a cada hora por 7 dias. **Implementação (17/10):** outro erro da rotina é embrulhado num `ErroDeRotina` com texto fixo ("a rotina parou no meio; roda de novo na próxima hora", motivo `rotina_interrompida`), como na rotina de cotações, para Sistema nunca guardar a mensagem crua do banco.

### 5.9 Sem duplicar ao retomar
Uma retomada depois de queda do sistema, de reenvio da Meta ou de reconexão da conta **nunca duplica conversa nem mensagem**: a mensagem é única por organização e `wamid`, a conversa é única por organização e BSUID e por organização e `wa_id` (com as variantes do nono dígito), e o evento de conta é único pela chave de códigos e hora da Meta. A dona da conta sai só dos ids configurados em Integrações (3.2, exatamente uma organização), nunca de palpite. O que vem do histórico depois do tempo real (ou o contrário) cai na mesma linha pela precedência por posto (5.4).

### 5.10 Medição do lote grande (T26)
Lote de histórico com 5.000 mensagens fictícias, no PGlite em memória (que não mostra o custo das idas e voltas ao Neon), em 100, 250 e 500 conversas: 16 consultas na transação nos três casos, 10 inserts de mensagens (lotes de 500) e entre 700 e 800 ms. O número de consultas não cresce com o número de conversas. Um POST com muitos blocos de uma mensagem cada faz cerca de 5 consultas por bloco, porque cada bloco passa por todos os passos antes do seguinte; isso só vai ser medido de verdade no M10.1b.

---

## 6. Vínculo

### 6.1 Telefone (`whatsapp/telefone.ts`, puro)
Uma regra só para comparar o `wa_id` de uma conversa (já com DDI, só dígitos) com um telefone digitado num cadastro (texto livre) e com outro `wa_id`.
- `chavesDeTelefone(texto)`: com "+" ou "00", o DDI é explícito, e um DDI diferente de 55 vale como veio (estrangeiro só casa com DDI explícito). Sem eles, saem os zeros à esquerda; 10 ou 11 dígitos são Brasil, 12 ou 13 começando com 55 também, outro tamanho não compara. No Brasil, DDD de 11 a 99; celular de 9 dígitos começando com 9 e celular antigo de 8 dígitos começando de 6 a 9 viram as duas chaves (com e sem o nono dígito); fixo (2 a 5) vira uma.
- `chavesDoWaId(waId)`: um `wa_id` brasileiro (55, com 12 ou 13 dígitos) vira as variantes da regra acima; outro fica como veio. Há candidato quando as duas listas têm alguma chave em comum (`temChaveEmComum`). `ultimos8` dá o pré-filtro em SQL; `formatarWaId` mostra o número na tela da conversa.
- O nome do perfil **nunca** é sinal (`requisitos/operations/ORIENTACOES-OPERACIONAIS.md`). Conversa só com BSUID: só por código ou à mão. `site/site.ts` (`numeroWhatsapp`) não muda.

### 6.2 Códigos
- Reserva: `codigosDeReservaNoTexto` (`reservas/regras.ts`). Cotação: `codigosDeCotacaoNoTexto`, com o mesmo alfabeto do código da cotação. **Implementação (17/10):** o código da cotação passou para um módulo puro, `site/codigo-cotacao.ts`, que `site/cotacoes.ts` reexporta: assim o vínculo lê os códigos sem importar o módulo que grava cotações e reservas.
- O texto é lido em maiúsculas (pega "scl-7k2qxm"). Das 200 mensagens mais recentes, não apagadas, com texto, recebidas ou enviadas pelo celular (`mensagemComCodigo`, a mesma regra para a conversa e para a ficha): até 5 códigos por mensagem e 20 por conversa.

### 6.3 Candidatos (`whatsapp/vinculo.ts`)
- Começa por `exigirVerConversas`; conversa de outra organização dá nulo. As sugestões são calculadas na hora (T7) e nunca guardadas; **nada se confirma sozinho**.
- Cada tipo de alvo exige também a permissão de ler o alvo (T10, `PERMISSAO_DO_ALVO`): reserva e cotação, `reserva:ler`; pedido de contato e cadastro pelo site, `proprietario:editar`; proprietário, `proprietario:ler`. Com a configuração liberada, a operação vê só reserva e cotação.
- **Pelo código:** a reserva pelo código, em qualquer estado (o rótulo diz "cancelada"); a cotação pelo código, e a cotação que virou reserva sugere a reserva (motivo "código da cotação que virou esta reserva", `alvoDaCotacao`, a mesma regra no vínculo pelo código e no vínculo confirmado).
- **Pelo telefone** (só conversa com `wa_id`): pré-filtro pelos 8 últimos dígitos e conferência pelas chaves em comum. Reserva não cancelada com saída a partir de hoje menos 365 dias (as em curso e futuras primeiro, pela entrada; depois as passadas, da mais recente para a mais antiga); pedido de contato; cadastro pelo site; proprietário; representante (sugere o proprietário dele).
- Junta os motivos do mesmo alvo; o alvo atual da conversa sai da lista; código antes de telefone, depois por tipo (reserva, cotação, pedido, cadastro, proprietário), empate pelo rótulo; até 10, o resto vira "e mais {n}".
- **Rótulos** (sem telefone): "Reserva {código} · {imóvel} · {entrada} a {saída} · {hóspede}{ · cancelada}" (sem o hóspede quando o nome está vazio); "Cotação {código} · {imóvel} · {entrada} a {saída}"; "Pedido de contato de {nome} ({data})"; "Cadastro pelo site de {nome} ({data})"; "Proprietário {nome}". Links: a ficha da reserva, a lista de pedidos de contato, a de cadastros pelo site e a ficha do proprietário; a cotação não tem link. Motivos na tela: "código da reserva na conversa", "código da cotação na conversa", "código da cotação que virou esta reserva", "mesmo telefone do hóspede", "mesmo telefone do pedido de contato", "mesmo telefone do cadastro pelo site", "mesmo telefone do proprietário", "mesmo telefone de um representante".
- **Implementação (17/10):** proprietários inativos e pedidos arquivados entram nas sugestões; o pré-filtro da ficha também procura os códigos das cotações que viraram aquela reserva.

### 6.4 Confirmar e desfazer
- `confirmarVinculo`, `vincularPorCodigo` e `desfazerVinculo` começam por `exigirVerConversas` e pela permissão do tipo do alvo; numa transação, travam a conversa da organização; o alvo precisa existir na organização (não precisa estar entre os candidatos: vale a busca manual). **Implementação (17/10):** tipo de alvo fora da lista dá `AcessoNegado`; a cotação que já virou reserva (inclusive depois de a tela mostrar a sugestão) vincula à reserva.
- Já vinculada a outro alvo: `ja_vinculada` (desfazer primeiro, de propósito). Mesmo alvo: `vinculada`, sem gravar de novo. Desfazer exige a permissão do tipo do alvo atual: a operação não desfaz o vínculo a um proprietário feito pelo admin.
- Grava só as colunas do vínculo da conversa (o alvo, quem confirmou e quando; desfazer zera tudo). **Nunca** grava telefone ou nome em reserva, cotação, pedido, cadastro, proprietário ou representante; `whatsapp/vinculo.ts` não importa nada que grave nesses cadastros.
- Auditoria `whatsapp.conversa.vincular` e `whatsapp.conversa.desvincular`, na entidade `whatsapp_conversa` (nunca `reserva`: o histórico da ficha mostraria a conversa a quem não pode vê-la), com `mudancas` só de "tipo:id".

### 6.5 Erro de banco sem dado pessoal
Na drizzle-orm, um erro de consulta traz os parâmetros na mensagem ("Failed query: … params: …"), e numa página ou ação o Next imprime a mensagem inteira no registro da Vercel (a limpeza de `observabilidade/limpeza.ts` só vale para o Sentry). As consultas do vínculo e das conversas levam telefone, chaves de telefone, os 8 últimos dígitos, código e texto como parâmetro. Por isso toda função exportada de `whatsapp/vinculo.ts` e `whatsapp/conversas.ts` que consulta o banco passa por `semDadosNoErro`, que relança o erro sem a mensagem (`erroParaOAviso`: ficam o tipo, o SQLSTATE e a pilha, também na cadeia de `cause`) e deixa `AcessoNegado` passar como está.

### 6.6 Limpeza de cotações (T22)
A limpeza de 30 dias de `site/cotacoes.ts` não apaga cotação vinculada a uma conversa: a chave estrangeira não deixaria, e o vínculo é histórico.

---

## 7. Telas e acesso

### 7.1 A checagem num lugar só (`whatsapp/acesso.ts`)
- `podeVerConversasCom(sessao, quemVe)`, pura: precisa de `mensagem:ler` na política; o admin vê sempre; a operação só com `admin_e_operacao`; proprietário, limpeza e hóspede nunca (não têm `mensagem:ler`), com qualquer valor; sessão inválida, papel desconhecido ou valor torto, não vê.
- `podeVerConversas(db, sessao)` lê a configuração da organização da sessão só quando ela decide (o admin e quem nunca veria não consultam nada); `exigirVerConversas` lança `AcessoNegado("ACAO_NAO_PERMITIDA")`.
- Usada em: as duas páginas de mensagens, todas as consultas de `whatsapp/conversas.ts` e `whatsapp/vinculo.ts`, todas as ações de `whatsapp/acoes.ts`, o layout (menu), o Início e a ficha da reserva. Nenhum outro lugar decide quem vê conversa. `acesso/politica.ts` não muda.
- **Teste obrigatório (Diego, 17/10):** com o padrão `so_admin`, a operação, que tem `mensagem:ler` na política, **não** abre `/painel/mensagens` (vê só o aviso, sem nenhuma consulta às tabelas do WhatsApp), não abre `/painel/mensagens/[id]`, não vê o bloco "Conversa no WhatsApp" na ficha (e `conversasDaReserva` não é chamada), não vê a linha de conversas sem resposta no Início (a contagem devolve 0 sem consultar), não vê "Mensagens" no menu e não consegue chamar nenhuma ação (as quatro dão `AcessoNegado`, sem chamar o domínio e sem gravar). Um teste por superfície, com "operação com o padrão só o admin" no nome. Proprietário e limpeza são negados do mesmo jeito, com qualquer valor. Com `admin_e_operacao`, a operação passa a ver, com só reserva e cotação nos candidatos.

### 7.2 Menu
`secoesPara(papel, ocultar)` e a propriedade `ocultar` do `Menu`: o layout do painel passa `["mensagens"]` a quem não vê as conversas. A seção "Mensagens" tem a descrição "Caixa de entrada do WhatsApp." e o marco M10.1a.

### 7.3 Caixa de entrada (`/painel/mensagens`)
- Quem não vê recebe só o título "Mensagens" e o aviso **"As conversas do WhatsApp estão visíveis só para o administrador. Quem muda isso é o administrador, em Configurações → Integrações → WhatsApp."**, sem ler nada.
- Cabeçalho **"Mensagens"** e **"Conversas do WhatsApp da empresa. Tudo o que aparece aqui também está no celular. Para responder, use o celular: a resposta pelo painel chega numa próxima etapa."**
- Avisos no topo (`AvisosWhatsapp`, componente de servidor, também em Integrações), que recebem só a situação, o motivo, a hora, o prazo das 24 h e se o recebimento está ligado (este só para quem tem `configuracao:editar`), nunca os ids da Meta nem os eventos da conta: recebimento desligado ("Só o Diego liga, na Vercel (WHATSAPP_RECEBIMENTO)."), não conectado ("As conversas aparecem aqui depois da conexão, que será feita no dia combinado."), conexão caída, aguardando reconexão, suspensa, prazo das 24 h correndo e, sempre, **"Fotos, áudios, vídeos, documentos e localizações aparecem como “ver no celular”: o sistema não baixa anexos. Mensagens vindas de aparelhos vinculados que a Meta não suporta podem não chegar aqui."** **Implementação (17/10):** a hora da conexão do aviso do prazo é calculada do próprio prazo (menos as 24 h), sem outra leitura.
- Filtros **"Todas"**, **"Sem resposta"** e **"Sem vínculo"** (outro valor vale "Todas"); imóvel, ano e mês são ignorados (as conversas não são por imóvel). 50 por página, da mais recente para a mais antiga, com "Mostrando {a}–{b} de {total}." e "Anteriores"/"Seguintes".
- Cada linha: o nome (da agenda, senão do perfil, senão "Contato sem nome"), a prévia (até 80 caracteres), a hora e os selos **"Não lida"**, **"Sem resposta"**, o vínculo ("Reserva SCL-…", "Cotação COT-…", "Pedido de contato", "Cadastro pelo site", "Proprietário") ou **"Sem vínculo"**, e **"Confira o contato"** no conflito. A lista não mostra o telefone.
- **Estados, cada um com teste:** vazio ("Nenhuma conversa ainda." e "Nenhuma conversa neste filtro."); carregando (`loading.tsx`, só o esqueleto e "Carregando as conversas…"; na conversa, "Carregando a conversa…"); erro (o `app/painel/error.tsx` de sempre, que não mostra detalhe do erro); sem acesso (o aviso acima).
- **Direção visual (revisão de Diego e Mia, 17/10):** esta é a tela principal da entrega e a proposta de direção visual para Diego avaliar no computador e no celular, no visual do painel (tokens do M7.5, nenhuma cor fixa). Na largura de celular (360 px), nada rola para o lado: nomes e prévias cortam com reticências e os selos quebram linha. As outras telas do painel não mudam nesta entrega: só depois de Diego aprovar esta. A conferência na prévia é do orquestrador, depois do PR aberto: só dados fictícios no banco das prévias (montados pela gravação com os valores fictícios dos testes, nunca pela rota com segredo real), fotos em 1280 px e 390 px nos estados com conversas, vazio e sem acesso, e os dados fictícios apagados depois ou deixados marcados como fictícios.

### 7.4 Conversa (`/painel/mensagens/[id]`)
- Sem acesso, o mesmo aviso; id inválido ou conversa de outra empresa, 404.
- Cabeçalho: o nome; **"WhatsApp: {número formatado}"** ou **"Contato com nome de usuário, sem número"**; o link "← Mensagens". No conflito: **"Este contato pode ser o mesmo de outra conversa (o WhatsApp trocou o número ou a identificação). Confira no celular antes de vincular."**
- As 200 mensagens mais recentes, em ordem de envio, abrindo na mais recente: **"Cliente"** ou **"Enviada pelo celular"**, a hora, o conteúdo (o texto, ou o rótulo do tipo: "Foto — ver no celular", "Áudio — ver no celular", "Vídeo — ver no celular", "Documento — ver no celular", "Figurinha — ver no celular", "Localização — ver no celular", "Contato compartilhado — ver no celular", "Mensagem que o sistema não consegue mostrar — ver no celular", "Mensagem de um tipo que o sistema não mostra — ver no celular", "Mensagem ainda não recebida pelo sistema — ver no celular", "Anexo ainda não recebido — ver no celular"; a legenda vem depois do rótulo), "(editada às {hora})", "Mensagem apagada", "Reação: {emoji}" e "do histórico" quando veio da sincronização. O aviso de troca de identidade ("Aviso do WhatsApp: o contato mudou de número ou de identificação") sai centralizado, sem balão. Mais de 200: "Mostrando as 200 mensagens mais recentes.". Sem caixa de resposta.
- Marcar como lida: um componente cliente chama a ação uma vez, depois de aberta (nunca no carregamento do servidor: o link pode pré-carregar); `lida_ate` nunca passa de agora e nunca volta. Responder pelo celular também tira o "Não lida".
- **Vínculo** (`PainelVinculo`, componente de servidor; o único cliente é o `BotaoConfirmar`. **Implementação (17/10):** o desenho permitia um componente cliente; o de servidor é mais seguro, e o rótulo de cada sugestão vira link quando ela tem um): confirmado, **"Vinculada por {nome ou "usuário removido"} em {dia e hora} a: {rótulo}."** (até 17/10 era "Vinculada a {rótulo} por {nome} em {dia e hora}."; mudou na conferência da prévia porque o rótulo da reserva termina na situação dela, e "cancelada por Fulano" dava a entender que a pessoa cancelou), com "Abrir" só quando há link e **"Desfazer vínculo"** só quando pode desfazer, com a pergunta "Desfazer o vínculo desta conversa com {rótulo}? A conversa continua guardada."; sem vínculo, **"Sugestões de vínculo"** com "Vincular" em cada uma, "e mais {n}" e, sem sugestão, **"Nenhuma sugestão. O sistema sugere pelo código da reserva (SCL-…) ou da cotação (COT-…) escrito na conversa e pelo telefone; nunca vincula sozinho."**; a busca "Código da reserva ou da cotação" com "Procurar e vincular"; sempre, **"O vínculo não copia o telefone nem o nome para a reserva ou para nenhum cadastro."**
- **Quem vê a conversa e não lê o alvo** (a operação, quando liberada, diante de um vínculo a proprietário, pedido ou cadastro feito pelo admin): só o rótulo genérico ("um proprietário", "um pedido de contato", "um cadastro pelo site"; `ROTULO_GENERICO_DO_ALVO` em `whatsapp/regras.ts`), sem nome, sem data, sem link e sem "Desfazer vínculo".
- Resultado das ações, só por chave conhecida: "Conversa vinculada.", "Vínculo desfeito.", "Esse código não está no formato SCL-XXXXXX ou COT-XXXXXXXX.", "Nenhuma reserva ou cotação com esse código.", "Não encontramos esse cadastro. Atualize a página.", "Esta conversa já está vinculada. Desfaça o vínculo antes de escolher outro."
- O histórico da conversa (`whatsapp_conversa`) no fim, lido só depois de a conversa existir na organização, com os verbos "vinculou a conversa do WhatsApp" e "desfez o vínculo da conversa do WhatsApp"; o vínculo aparece só pelo tipo ("uma reserva"), sem o id gravado na auditoria.

### 7.5 Ações (`whatsapp/acoes.ts`)
- Vincular, vincular pelo código, desfazer e marcar como lida: sessão, `exigirVerConversas`, validação (id, lista fechada; o `organizacaoId` do formulário é ignorado), domínio (que confere tudo de novo), revalidação e redirecionamento com a chave do resultado (marcar como lida não redireciona). **Implementação (17/10):** as ações do vínculo revalidam o painel inteiro, para cobrir a ficha da reserva.
- Os dois formulários de configuração exigem `configuracao:editar` no próprio arquivo (nada de `configuracoes/acoes.ts`), revalidam o layout (o menu e o Início mudam) e respondem "Salvo.", "Nada mudou.", "Use só números (até 25 dígitos).", "Esta conta do WhatsApp já está ligada a outra empresa no sistema." ou "Escolha uma das opções.". Um campo de id que não veio no envio dá "Use só números (até 25 dígitos)." e não chama o domínio.

### 7.6 Ficha da reserva
Só para quem vê as conversas: o bloco **"Conversa no WhatsApp"**, depois das páginas legais aceitas, com cada conversa confirmada ("{nome} · última mensagem {dia e hora}", as 3 últimas prévias com "Cliente" ou "Celular" e a hora, e "Abrir a conversa"; até 3 conversas) e **"{n} conversa(s) com sugestão de vínculo a esta reserva: confirme na caixa de entrada."**, com o link para "Sem vínculo". Sem nada, o bloco não aparece. A linha "Contato" da ficha não muda.

### 7.7 Início
- **"{n} conversa(s) do WhatsApp sem resposta."**, com o link para o filtro "Sem resposta". A página passa o número de `contarConversasSemResposta(db, sessao)`, que decide o acesso e devolve 0 sem consultar; o dashboard não consulta as conversas (quem reaproveitar `carregarDashboard`, como o MCP, não tem como mostrar a contagem a quem não pode).
- Para quem tem `configuracao:editar`, os avisos de atenção da conta, com o link para Integrações: "A conexão do WhatsApp com o sistema caiu: as mensagens novas não chegam ao painel.", "O WhatsApp está aguardando reconexão (troca de aparelho ou reinstalação).", "A Meta suspendeu ou vai suspender a conta do WhatsApp." Nenhum texto leva nome, telefone ou trecho.

### 7.8 Configurações → Integrações → WhatsApp
- `situacaoDoWhatsapp` (`whatsapp/integracao.ts`), a mesma que Sistema usa. A página passa ao componente (de servidor) a situação já lida e se é prévia, **nunca o ambiente**. Os componentes de Integrações, dos avisos, da lista, da conversa, do vínculo e da ficha são de servidor. Os únicos componentes cliente recebem só o necessário: o formulário dos ids, os dois ids; o de "quem vê", o valor atual; o botão de copiar, o endereço; o de marcar como lida, o id da conversa e a hora; o `BotaoConfirmar`, a pergunta já montada. Se um deles recebesse o ambiente ou a situação inteira, o React mandaria variáveis e ids da Meta ao navegador. A regra está num teste.
- Conteúdo: título **"WhatsApp (Meta)"**; os mesmos avisos da caixa de entrada; "Recebimento: ligado" ou "Recebimento: desligado (WHATSAPP_RECEBIMENTO não está como ligada na Vercel)"; "Senha de verificação (WHATSAPP_VERIFY_TOKEN): configurada", "falta" ou "curta demais (mínimo 32 caracteres)"; "Chave secreta do app (WHATSAPP_APP_SECRET): configurada" ou "falta" (nunca o valor); a situação da conta, com o motivo e a data; o prazo das 24 h, quando corre; "Contatos da agenda: {rótulo}", com `recebendo` mostrado como "recebidos (último em {dia e hora})", porque a agenda não tem sinal de fim; "Histórico: {rótulo} ({progresso}%)" (rótulos: "não pedido", "pedido", "recebendo", "concluído", "recusado no celular"); "Último aviso válido: {dia e hora}" ou "nenhum ainda"; "Hoje: {a} recusado(s) pela assinatura, {c} ilegível(is), {d} de outra conta ou número, {e} não reconhecido(s), {f} ignorado(s) (grupos, confirmações de entrega e avisos sem efeito)."; sem número configurado, "Falta o id do número: os avisos de mensagem estão sendo recusados e contados como de outra conta."; "Endereço para colar no app da Meta:" com "Copiar endereço"; na prévia, "Esta é uma prévia de teste: o endereço do WhatsApp só funciona na produção. Aqui, use só ids fictícios no formulário ‘Identificação na Meta’."
- **"Últimos avisos da conta"** (os 10 mais recentes): "{dia e hora} — {evento}{: motivo}" e o resultado do e-mail, um texto por causa, nunca um palpite: "e-mail enviado"; "e-mail não enviado: falta o e-mail da empresa em Configurações → Empresa"; "e-mail não enviado: o e-mail do sistema (Resend) não está configurado"; "e-mail não enviado: o envio falhou; nova tentativa de hora em hora"; "e-mail ainda não enviado"; e, acrescentado na revisão da rotina (17/10), "e-mail não enviado: passaram 7 dias sem conseguir; não há nova tentativa" (o prazo é o mesmo da rotina, `inicioDasTentativas`, num lugar só). Sem aviso: "Nenhum aviso da conta recebido ainda."
- **"Identificação na Meta":** "Id da conta do WhatsApp Business (WABA)" e "Id do número (phone number id)", sem "Id do app"; ajuda "Números do painel de desenvolvedores da Meta. Não são senhas. Ficam só aqui, no banco do sistema."
- **"Quem vê as conversas":** "Só o admin (padrão)" e "Admin e operação". Todo envio de "Admin e operação" passa pela confirmação **"A operação vai passar a ver todas as conversas do WhatsApp, inclusive com proprietários e interessados. Confirmar?"**; voltar para "só o admin" não pergunta. Texto fixo: **"Proprietários e equipe de limpeza nunca veem as conversas."**
- O quadro "Onde fica cada coisa" ganhou a linha do WhatsApp: as duas variáveis secretas só no Production, `WHATSAPP_RECEBIMENTO=ligada` que só Diego liga, e os ids aqui.

### 7.9 Sistema
`servicoWhatsapp` (`sistema/servicos.ts`), a mesma linha em Integrações e em Sistema: "configurado" só com a senha de verificação de 32 caracteres ou mais, a chave secreta, o recebimento ligado e os dois ids; o detalhe diz o que falta e o último aviso válido, nunca um valor. Sem a situação lida (banco fora), "Situação não conferida nesta abertura". A linha fixa "planejado" saiu.

### 7.10 Usuários e histórico
- A tabela de permissões de Configurações → Usuários ganhou, logo abaixo de "Ver mensagens", a linha **"Ver as conversas do WhatsApp"** (com "muda em Configurações → Integrações → WhatsApp"), calculada por `podeVerConversasCom` para cada papel. "Ver mensagens" continua marcada para a operação, porque vem da política (`mensagem:ler`), que não muda; a linha de baixo é a que vale para as conversas: com o padrão, só o admin.
- `HistoricoAlteracoes` mostra frases com verbo: "alterou a configuração do WhatsApp", "vinculou a conversa do WhatsApp", "desfez o vínculo da conversa do WhatsApp", "mudou a situação da conta do WhatsApp", e os campos "Vínculo", "Situação", "Motivo", "Quem vê as conversas", "Id da conta (WABA)" e "Id do número". Só o histórico da conversa tem tela no M10.1a; os rótulos da configuração e da conta servem à leitura da auditoria e estão no teste do componente.

---

## 8. Privacidade

### 8.1 O que nunca sai do banco
- `whatsapp_contatos` e `whatsapp_mensagens` guardam telefone (`wa_id`), BSUID, nomes, texto e `wamid`, com o acesso da seção 7.1. Nada disso vai para log, Sentry, auditoria, eventos, contadores, execuções das rotinas, e-mail, chave de repetição, mensagem de erro, Git ou PR.
- Anexos e áudios não são baixados nem transcritos. Nada é marcado como lido na Meta.
- O `wamid` é tratado como dado pessoal (T19): provavelmente carrega o telefone em base64 (não confirmado; conferir no primeiro aviso real, sem copiá-lo para fora do banco).

### 8.2 Erros
- Na rota, só `avisarErroDoServidor(erro, rotina)`, que troca a mensagem antes do Sentry, com o `try` único da seção 2.4.
- Nas telas e ações, `semDadosNoErro` (seção 6.5).
- Nenhum `console.*` em `whatsapp/*` nem nas duas rotas. `ErroDeRotina` só com motivos da lista fechada.

### 8.3 Limpeza do Sentry (`observabilidade/limpeza.ts`)
Rede de segurança; a garantia é nunca pôr esses valores num erro. Três marcadores novos, sem mudar os casos que já existiam:
- o `wamid` (`wamid.` mais base64) vira `[id]`, antes da regra dos endereços (o base64 pode ter "/");
- o BSUID (duas letras, ponto, "ENT." opcional e de 8 a 128 letras e números) vira `[id]`, depois do e-mail e antes dos números soltos;
- o `wa_id` brasileiro sem o nono dígito (55, DDD e 8 dígitos começando de 6 a 9) vira `[telefone]`.

Limites conhecidos, registrados no teste:
- um texto com a forma do BSUID, como "AB.Componente", também vira `[id]`: só perde detalhe, nunca expõe dado;
- **o `wa_id` estrangeiro como a Meta manda, só com dígitos e sem "+", não vira marcador** (não tem forma de telefone brasileiro; com "+", vira). Estender o marcador mascararia qualquer número técnico de 11 dígitos. A garantia continua sendo nunca pôr o `wa_id` num erro.

### 8.4 Varredura `semDadosPessoais`
`pagamentos/testes.ts` passa a varrer também `whatsapp_eventos`, `whatsapp_avisos_dia`, `whatsapp_conta` e `execucoes_automacao` (a suíte inteira passou com a varredura estendida). `whatsapp_contatos` e `whatsapp_mensagens` ficam de fora de propósito. `whatsapp/testes.ts` traz os canários fictícios e `semDadosPessoaisWhatsapp`; o teste de privacidade (`whatsapp/privacidade.test.ts`) usa o Sentry de verdade com transporte falso e espiões em todo o console, e nada capturado tem os canários, o corpo, o cabeçalho ou o segredo de teste.

### 8.5 Barreira de rede dos testes
`beds24/barreira-de-rede.ts`, no mesmo lugar, com uma lista só de domínios bloqueados: `beds24.com` e, para a Meta, `facebook.com`, `facebook.net` (SDK do Embedded Signup, M10.1b), `fbsbx.com` (mídia), `whatsapp.com` e `whatsapp.net`. O teste que tentar sai com "Teste tentou acessar a Meta (WhatsApp) pela rede (<host>)"; a frase do Beds24 não muda. Domínios parecidos (`notfacebook.com`, `facebook.com.example.org`) passam.

---

## 9. Decisões técnicas (T1 a T26)

Tomadas por padrão no desenho de 17/10 e conferidas no código. Onde a construção mudou algo, a linha diz.

| # | Decisão | Motivo |
|---|---|---|
| T1 | POST com a chave desligada responde 503, sem ler o corpo e sem banco | A Meta reenvia por até 7 dias: uma pausa curta não perde nada. Acima de 7 dias, perde (limite no guia) |
| T2 | O GET de verificação não depende da chave | A Meta verifica ao salvar o endereço, antes de Diego ligar o recebimento |
| T3 | Sem cabeçalho, cabeçalho malformado ou sem segredo: 401 sem contar; assinatura que não confere conta em `assinaturas_recusadas` | Ruído sem cabeçalho não toca o banco |
| T4 | Corpo acima de 4 MB: 413 sem banco e sem contar | O teto documentado é 3 MB ("Webhook payloads can be up to 3 MB") e a Vercel recusa acima de 4,5 MB antes da função: contar antes de autenticar deixaria qualquer pedido anônimo sujar o quadro. Até 17/10 o desenho contava `corpo_grande` |
| T5 | Assinatura válida com corpo ilegível: 200 e conta `ilegiveis` | Evita 7 dias de reenvio de algo que nunca vai ser lido |
| T6 | Gravação síncrona numa transação antes do 200; falha dá 500; `after()` só para o e-mail | Não existe API para buscar avisos antigos: o aviso é o próprio dado |
| T7 | Sugestões de vínculo não são guardadas: calculadas na hora | Uma regra num lugar, sem estado velho; nada se confirma sozinho |
| T8 | Configuração na chave `whatsapp` do armazém (ids e quem vê), sem migração e com auditoria; o que o webhook escreve fica em `whatsapp_conta` | Padrão do projeto (M8.2a, M8.3a) |
| T9 | "Quem vê": `so_admin` (padrão) ou `admin_e_operacao`; admin sempre; proprietário, limpeza e hóspede nunca; valor torto vale `so_admin` | Decisão 2 de Diego; lado seguro |
| T10 | Sem permissão nova: quem vê a conversa pode vincular; cada tipo de alvo exige a permissão do alvo | Evita mexer em `acesso/politica.ts`; liberada à operação, ela vê só reserva e cotação |
| T11 | Agenda: só o nome de quem já tem conversa, em `nome_agenda`; nunca cria conversa nem guarda telefone de quem não conversa | Até Diego decidir (pergunta 5). Consequência: a agenda que chega antes da conversa se perde, e o pedido só pode ser feito uma vez; por isso o M10.1b pede o histórico antes (risco 14) |
| T12 | Mensagens e conversas sem apagamento automático; eventos e contadores apagados depois de 90 dias (guardando o último dia com aviso válido) | A guarda das conversas está pendente com o advogado (pergunta 4 da seção 10); eventos e contadores usam o mesmo prazo dos eventos do Mercado Pago |
| T13 | "Sem resposta" conta só o tempo real; a resposta pelo celular conta; reação, edição e apagamento não contam | Coexistência: Diego responde pelo celular. **Implementação (17/10):** a mensagem `sistema` (troca de identidade) também não deixa "sem resposta" nem "não lida" |
| T14 | Mídia: só o tipo e o mime; nunca url, id de mídia, `sha256` ou nome de arquivo; localização e contato compartilhado sem conteúdo; `system.body` nunca guardado | Privacidade; "ver no celular" |
| T15 | BSUID é a chave principal; `wa_id` a segunda, opcional. Troca de identidade sem fusão: colidiu, as duas conversas ganham o conflito | Avisar em vez de supor. **Implementação (17/10):** também ganha o conflito a conversa achada pelo telefone que já tem outro BSUID (5.3) |
| T16 | `unsupported` (131051, 131060) e `media_placeholder` gravam tipos provisórios, substituídos pelo conteúdo no mesmo `wamid`, pela precedência por posto (só sobe; o tempo real nunca volta a histórico); edição ou apagamento antes da original cria a linha provisória; `unsupported` de evento não vira linha | Não confirmado se a Meta reenvia o mesmo `wamid`; a regra cobre os dois casos |
| T17 | `account_update` aceito se o `entry.id` ou o `waba_info.waba_id` for a WABA configurada | O `entry.id` pode ser o do parceiro (referência) ou a própria WABA (página de coexistência) |
| T18 | Os quatro campos de mensagem exigem `phone_number_id` presente e igual ao configurado; sem número configurado, contam em `outra_conta`, com aviso em Integrações | Avisar em vez de supor |
| T19 | `wamid` tratado como dado pessoal | Provavelmente carrega o telefone; só em `whatsapp_mensagens` |
| T20 | Hex do cabeçalho aceito em maiúsculas ou minúsculas | Não documentado; sem custo |
| T21 | E-mail da conta para o e-mail da empresa, por `avisarEquipePorEmail`, e não a cada admin | Uma regra só de destinatário dos avisos internos (M7.7, M8.2c). Difere da palavra "admin" da análise (pergunta 2) |
| T22 | Cotação vinculada não é apagada pela limpeza de 30 dias | Senão a chave estrangeira faria a limpeza falhar a cada rodada |
| T23 | A auditoria `configuracao.whatsapp` guarda os ids da Meta em claro | Só no banco, visível só ao admin; não são segredo nem dado pessoal; nunca no Git |
| T24 | Mensagens de grupo e `statuses[]` são ignoradas e contadas em `ignorados` | Grupos não sincronizam; status só existem para envio pela API (M10.2) |
| T25 | Tipo de mensagem desconhecido vira `outro` ("ver no celular") e soma `desconhecidos`; campo desconhecido só soma | Não perder que a mensagem existiu |
| T26 | Sem `maxDuration` acima de 60 s; insert em lotes de 500, buscas e resumo em lote | Medido no PGlite (5.10); a Meta recomenda o contrário para o histórico (risco 1): a escolha entre síncrono e pedaços pendentes é dependência do M10.1b |

---

## 10. Riscos e perguntas

**Riscos** (nenhum bloqueia o M10.1a)
1. **Tamanho dos lotes de histórico** frente ao teto de 4 MB e aos 60 s da função: só se mede na primeira sincronização. Um lote grande demais se percebe pelo "Histórico: recebendo" sem avanço e pelo último aviso válido parado. A Meta recomenda, na referência de history e na página de coexistência: "a single webhook could potentially describe thousands of messages, so capture its contents first, then process the contents asynchronously". Antes de pedir a sincronização no M10.1b, decidir entre manter síncrono, com o tempo medido no lote de 5.000 (5.10), ou guardar o pedaço numa tabela de pedaços pendentes (só no banco, com o mesmo acesso de `whatsapp_mensagens`, apagada depois de processada) e processar em `after()` ou na rotina. Essa decisão é dependência da linha do M10.1b. No M10.1a, ninguém pede histórico.
2. **`wamid` com o telefone em base64** (provável, não confirmado): tratado como dado pessoal (T19).
3. **131060 reenviada com o mesmo `wamid`?** Não confirmado; a regra dos tipos provisórios cobre os dois casos.
4. **Formato da edição de texto e tipos no eco** além de text, image, video, document, revoke e edit: não confirmados; leitura genérica e "ver no celular".
5. **`entry.id` dos eventos de parceiro** no caso de Diego: pode ser o do parceiro ou a própria WABA; T17 cobre os dois, e os dois formatos estão nos testes. Os eventos documentados sem efeito contam como ignorados, não como "não reconhecidos".
6. **Caminho por parceiro (BSP)** no M10.1b pode mudar formato e assinatura.
7. **Chave desligada por mais de 7 dias** perde avisos (limite da Meta).
8. **O Beds24 guarda só um telefone por reserva** (`beds24/normalizar.ts`): quando o hóspede tem dois, o do WhatsApp pode ter ficado de fora; o vínculo por telefone falha e sobra o código ou a busca manual.
9. **`execucoes_automacao` na varredura** podia quebrar testes de outros módulos: a suíte inteira passou, então ela ficou.
10. **Colisão com o M8.3c:** a 0073 (seção 3.1) e os arquivos que os dois itens tocam: `vercel.json` (crons), `sistema/automacoes.ts`, `app/api/cron/avisos-de-erro.test.ts`, o tipo das chaves de `configuracoes/armazem.ts`, a lista de `semDadosPessoais`, `sistema/servicos.ts` e o quadro "Onde fica cada coisa" de Integrações. Ao trazer a `main` com o M8.3c, juntar as duas entradas em cada um e rodar a suíte inteira.
11. **Sugestões reversas na ficha** (`upper(texto) like '%código%'`) varrem as mensagens da organização: aceitável no volume atual; índice de texto se crescer.
12. **Mudança da 0073 depois do primeiro push com prévia:** só com `ADD COLUMN IF NOT EXISTS` (3.1).
13. **Reenvio do e-mail** depende do Resend e do e-mail da empresa preenchido; sem eles, o aviso fica no Início e em Integrações, com a causa certa, e a rotina não vira erro no Sentry (só "falhou" vira).
14. **Ordem dos pedidos de sincronização (M10.1b):** a Meta apresenta os contatos como passo 1 e o histórico como passo 2 (Embedded Signup, "Synchronizing WhatsApp Business app data"), e cada pedido só pode ser feito uma vez. Com T11, quase toda a agenda chegaria antes das conversas do histórico e se perderia. Por isso o M10.1b pede o histórico primeiro e só pede os contatos depois do histórico concluído ou recusado, ainda dentro das 24 h, com folga (se o histórico não terminar, pede os contatos assim mesmo). A documentação não diz que a ordem é obrigatória: conferir na Meta antes.
15. **Senha de verificação no registro da Vercel:** a Meta manda o `hub.verify_token` na URL do GET, e o registro de acessos da Vercel guarda o endereço. Mitigação: mínimo de 32 caracteres e a frase do guia (11.2).

**Perguntas para Diego** (registradas no guia; o padrão vale até a resposta)
1. Equipe de limpeza como candidata do vínculo pelo telefone? Padrão: não.
2. E-mail da conta desconectada: o e-mail da empresa (padrão, T21) ou o de cada usuário admin?
3. Conversas trazidas pelo histórico devem contar como "sem resposta"? Padrão: não (T13).
4. Retenção das conversas (com o advogado)? Padrão: sem apagamento automático.
5. Contatos da agenda do celular: só o nome de quem já conversa (padrão, T11) ou nada? O pedido da agenda só pode ser feito uma vez; para não perder os nomes, o M10.1b pede o histórico antes (risco 14). Se a Meta exigir a ordem dela, com o padrão os nomes de quem ainda não tem conversa no sistema se perdem.
6. Ao liberar à operação, inclusive as conversas com proprietários e interessados? Hoje a opção libera tudo; separar por tipo de conversa seria outro item.
7. Para o M10.1b: o caminho na Meta (Tech Provider no próprio app ou parceiro), a origem da conta e a data combinada.

---

## 11. O que depende da Meta

Para **ativar** o recebimento, não para construir (o M10.1a vai para a produção com a chave desligada, e o GET de verificação já responde quando Diego salvar o endereço):
- o caminho: Tech Provider no app de Diego ou um parceiro;
- a verificação da empresa (no caminho Tech Provider) e a configuração do Facebook Login for Business;
- a assinatura dos cinco campos no app (`messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`);
- o endereço (o de Integrações) e a senha de verificação salvos no app; a chave secreta do app na Vercel;
- o app da Meta em **modo Live**. A visão geral dos webhooks avisa, na solução de problemas: "Make sure your app is in Live mode; some webhooks will not be sent if your app is in Dev mode";
- a data combinada para o QR code (a conexão por coexistência) e para as 24 h de sincronização que vêm depois dela.

### 11.1 A ordem dos pedidos de sincronização (M10.1b)
O M10.1b pede o histórico (`history`) primeiro e só pede os contatos (`smb_app_state_sync`) depois de `sincronizacao_historico` em `concluida` ou `recusada`, ainda dentro das 24 h, com folga antes do fim; se o histórico não terminar, pede os contatos assim mesmo. Motivo: com T11, a agenda que chega antes das conversas se perderia, e o pedido não pode ser refeito (risco 14). A ordem inversa à apresentada pela Meta não está documentada como permitida nem como proibida: conferir antes. Antes de pedir o histórico, decidir entre gravação síncrona e pedaços pendentes (risco 1).

### 11.2 A senha de verificação
A frase do guia, para Diego: **"Gere um valor aleatório só para isso, com pelo menos 32 caracteres (nunca uma senha usada em outro lugar): a Meta manda esse valor no endereço, e ele aparece no registro de acessos da Vercel."**

### 11.3 Conexão, tokens e custo (M10.1b)
- Antes de qualquer conexão: confirmar a elegibilidade (a coexistência para o próprio app ou para o parceiro), as permissões pedidas e o custo.
- O token de acesso pode expirar ou ser revogado: prever renovação e reconexão, com aviso no painel. A situação `aguardando_reconexao` e o aviso de desconexão do M10.1a já cobrem o lado do recebimento.
- Nunca senha digitada por script numa tela da Meta, nem promessa de sessão que não expira.
- O token só no servidor, nunca no banco em claro sem a decisão sobre a guarda do token, que é parte do M10.1b.
- O M10.1b escreve na Meta (inscrição do app, pedidos de sincronização): precisa de uma linha de autorização explícita no `ROADMAP.md` antes. Acrescenta o id do app na chave `whatsapp`, sem migração.

---

## 12. Depois do M10.1a: envios

Só registro (Diego, 17/10, repassando a revisão do Codex); nada de envio agora. Vale também no texto da linha do M10.2 do `ROADMAP.md`, que continua `bloqueado`.
- **Os grupos continuam como hoje.** A coexistência não sincroniza grupos (T24): a API não substitui o envio das agendas nos grupos do Rio e de Búzios.
- **Prioridade dos envios:** conversas individuais e envios operacionais (check-in, check-out, lembretes, pedido de documentos e portaria, quando o destino for individual).
- **Destino grupo:** continua o fluxo assistido de hoje: a mensagem pronta com o link do WhatsApp, para Diego abrir e encaminhar; quando houver acesso autorizado ao Mac, abrir a conversa certa com o texto pronto para ele enviar.
- **Nunca** mandar documentos ou dados de hóspedes para destinatário não conferido.
- **Etapa própria**, seguindo as regras atuais da Meta para consentimento, janela de atendimento e modelos aprovados, com registro de entrega e prevenção de mensagem repetida.
- **Nenhum disparo real** até um item do `ROADMAP.md` autorizar. A aprovação de 17/10 é só preparar e testar o recebimento.
