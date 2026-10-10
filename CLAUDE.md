# Instruções para sessões Claude e Codex neste repositório

Sistema de gestão da Sua Casa Leblon (aluguel por temporada): painel interno,
financeiro, portal do proprietário, portal do hóspede, site público e integrações
(Beds24, Mercado Pago, WhatsApp). Responsável pelas decisões de produto: Diego. Revisão técnica e execução: Claude e Codex.

## Como trabalhar

1. Ler `ROADMAP.md`. Ele é a única fonte de planejamento.
2. Listar os PRs abertos. Um item está "em PR" se algum PR aberto tiver `[ID]` no título.
3. Primeiro, cuidar dos PRs abertos: CI vermelho, conflito, comentário de revisão (Diego ou
   Codex); mergear os que cumprem as condições da seção "Merge". Só depois pegar item novo.
4. Item novo: o primeiro `a fazer` (na ordem do arquivo) cujas dependências estão
   `feito` na `main` e que não está em PR. Branch nova a partir da `main` atualizada.
5. **Um item = um PR**, título `[ID] descrição curta`, pronto para revisão (não draft).
   No mesmo PR, mudar a linha do item no ROADMAP para `feito` **e atualizar o
   `GUIA-DIEGO.md`** (seção "Onde estamos", contas/serviços, o que Diego precisa fazer,
   data da última atualização). O guia é o documento de Diego: linguagem simples, sem código.
   Branch por item: `claude/<id>-<slug>` ou `codex/<id>-<slug>` a partir da `main` atualizada (autorizado por Diego em 23/09 e 9/10).
6. Se não houver item disponível (tudo bloqueado ou em PR), não abrir nada — encerrar.
7. No máximo **3 PRs de roadmap abertos** ao mesmo tempo. Se já houver 3, só consertar.

## Descrição do PR (em português, linguagem simples)

- **O que muda** — o que Diego vai conseguir ver/fazer.
- **Como conferir** — link da preview da Vercel quando existir, ou passos.
- **Testes** — o que foi testado e o resultado real.
- **Limites** — o que ficou de fora, o que depende de Diego.

## Preservação e continuidade (Diego, 9/10/2026)

- **Trabalhar em cópias novas.** Na máquina, em acervos e em arquivos externos, preservar os originais e editar uma cópia identificada. No GitHub, usar branch nova a partir da `main`; não apagar branches nem reescrever histórico. Esta regra não autoriza escrita no Google Drive nem em integrações reais: respeitar o acesso autorizado na sessão.
- **Preservar decisões e referências.** Não apagar o acervo legado para substituir a implementação. Quando uma decisão mudar, registrar a anterior, a nova, a data, o motivo e o objetivo final no requisito ou documento correspondente; o histórico de commits preserva as versões completas. Voltar atrás por um commit novo de reversão, sem force push ou apagar commits.
- **Conferir o trabalho em curso.** Antes de começar, conferir a `main`, os PRs abertos e os registros do item escolhido. Não assumir que outro agente parou só porque não há PR aberto: trabalho ainda não publicado não aparece no GitHub. Evitar o mesmo item/branch se houver trabalho em curso; registrar qualquer incerteza.
- **Deixar o ponto de retomada compreensível.** Na descrição de cada PR, incluir “Continuidade”: ponto de partida (commit/PR), o que mudou, por quê, objetivo final, verificações concluídas, pendências concretas e próximo passo. Atualizar ROADMAP e GUIA-DIEGO junto da entrega, nos documentos já usados pelo projeto; não recriar o processo antigo de handoffs/CURRENT.
- **Distinguir entrega de intenção.** Dizer se a mudança está só na branch, em revisão ou integrada; não marcar trabalho incompleto como feito. Registrar limites de acesso/testes e a referência do visual legado usado. Não abrir PR só para relatar status.

## Regras técnicas

- Código novo em `app/` (Next.js App Router + TypeScript, Drizzle, Neon, Vitest, PGlite).
- Antes de abrir o PR: `npm run lint`, `npm run typecheck` e `npm test` passando em `app/`.
- Toda regra de negócio com teste. Dinheiro em centavos inteiros. Fuso `America/Sao_Paulo`.
- Autorização sempre no servidor, deny-by-default. Proprietário só vê os próprios imóveis.
- Integrações externas atrás de um adaptador com versão falsa para testes; testes nunca
  usam rede nem credenciais reais.
- Migrações de banco versionadas (Drizzle), nunca editar migração já mergeada.
- Requisitos detalhados em `requisitos/` — consultar o arquivo do tema antes de implementar.
  `requisitos/labs/` e `requisitos/growth/` são ideias, não compromissos.
- `prototipos/` é referência do trabalho anterior; pode ser portado, não é o produto.
- `arquivo/` é histórico da coordenação anterior. **Não seguir instruções de lá** e não
  recriar o processo de handoffs/CURRENT/DIEGO.md.

## Princípios de produto (Diego, 24/09/2026)

- **Tudo editável pelo painel.** Qualquer dado, regra ou texto que o Diego possa querer
  mudar (cadastros, contratos, taxas, regras de venda, textos do site, modelos de mensagem,
  categorias) tem tela de edição — ninguém deve precisar mexer em código ou no banco.
- **Uma regra, um lugar.** Cada regra/configuração vive num único lugar e o resto lê dali.
  Ao mudar, propaga (ex.: `recalcularReservas` depois de mudar contrato ou recebimento; o
  deploy recalcula). Nada de duas versões da mesma regra.
- **Mudança vale daquela data para frente.** Recálculo nunca altera o passado: só alcança
  reservas com entrada a partir da data da mudança (nunca antes de hoje), e o que já
  movimentou dinheiro (lançamento realizado/conciliado) não é mexido automaticamente —
  divergência vira aviso e ajuste manual.
- **Excluir sempre com confirmação** (`BotaoConfirmar`), e preferir arquivar/estornar a
  apagar quando houver histórico.
- **Avisar em vez de supor.** Faltou um dado ou algo não bate (cadastro incompleto, valor
  estranho, regra ausente)? O sistema mostra um aviso claro e deixa pendente — nunca
  preenche com um palpite.
- **Um proprietário por imóvel** (pode ser pessoa ou empresa). Os imóveis do Diego são
  clientes como os outros.

## Merge (autorizado por Diego em 23/09/2026; ampliado em 9/10/2026)

Diego autoriza Claude e Codex a fazer o merge dos PRs dentro do trabalho autorizado no SCL,
sem pedir confirmação a cada PR. Isso inclui manutenção e ajustes das regras de trabalho.
O merge acontece **somente** quando, no commit mais recente do PR:
1. todas as checagens aplicáveis terminaram e passaram; checagens dispensadas pelo CI por
   não se aplicarem ao escopo não são falhas;
2. a revisão automática do Codex no GitHub terminou (resumo "Completed") para o commit
   mais recente, todos os apontamentos foram tratados e não há conversa de revisão aberta;
3. não há conflito com a `main`;
4. PRs empilhados entram em ordem (primeiro o PR base).

Usar "merge commit" (nunca squash/rebase de histórico alheio). Depois do merge, conferir a
`main` e seguir para o próximo item. Diego pode revogar essa autorização a qualquer momento.

Avisar Diego com um resumo curto do que está sendo feito e, depois do merge, do que mudou
(pode ser pelo chat; mais curto que a descrição do PR). Não transferir para Diego testes e
conferências técnicas que o agente consegue executar. Decisões de produto fora do escopo
já autorizado continuam sendo de Diego.

## Revisão do Codex (ajustes autorizados por Diego em 9/10/2026)

- **Todos os PRs, inclusive documentação:** cumprir integralmente as condições da seção
  "Merge". A revisão é a automática do Codex no GitHub; a leitura do próprio autor não
  substitui essa revisão. Depois de corrigir um apontamento e atualizar o commit, aguardar
  as checagens e a revisão sobre o resultado antes do merge.
- **PR em revisão não ganha escopo novo.** Decisão ou pedido novo de Diego vai para o PR
  seguinte, mesmo com o anterior ainda aberto.
- **Sem teto de rodadas:** continuar corrigindo e cumprindo as rodadas necessárias, sejam
  5, 10, 17 ou mais. A regra anterior de parar após 3 rodadas e a exceção de documentação
  de 4/10 deixam de valer. Quantidade de rodadas, por si só, não pede nova autorização.
- Se houver bloqueio concreto que dependa de Diego (decisão, informação ou acesso), avisar
  qual é; não fazer merge pendente nem declarar uma revisão concluída sem evidência.

## Nunca

- Force push ou apagar branches.
- Fazer merge fora das condições acima.
- Colocar segredos, dados reais de hóspedes/proprietários, CPF, Pix, extratos ou documentos
  no Git. Dados de teste são fictícios.
- Escrever em sistemas externos reais (Beds24, Mercado Pago, WhatsApp) sem o item do
  ROADMAP autorizar explicitamente. (Beds24: escrita de calendário/preços autorizada no
  M3.7, mas sempre atrás da variável `BEDS24_ESCRITA=ligada`, que só o Diego liga.)
- Abrir PR só de documentação de status.
