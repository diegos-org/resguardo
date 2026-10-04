# Instruções para sessões Claude neste repositório

Sistema de gestão da Sua Casa Leblon (aluguel por temporada): painel interno,
financeiro, portal do proprietário, portal do hóspede, site público e integrações
(Beds24, Mercado Pago, WhatsApp). Dono e único revisor: Diego.

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
   Branch por item: `claude/<id>-<slug>` a partir da `main` (autorizado por Diego em 23/09).
6. Se não houver item disponível (tudo bloqueado ou em PR), não abrir nada — encerrar.
7. No máximo **3 PRs de roadmap abertos** ao mesmo tempo. Se já houver 3, só consertar.

## Descrição do PR (em português, linguagem simples)

- **O que muda** — o que Diego vai conseguir ver/fazer.
- **Como conferir** — link da preview da Vercel quando existir, ou passos.
- **Testes** — o que foi testado e o resultado real.
- **Limites** — o que ficou de fora, o que depende de Diego.

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

## Merge (autorizado por Diego em 23/09/2026, até o sistema estabilizar)

O Claude faz o merge dos PRs de roadmap **somente** quando, no commit mais recente do PR:
1. o CI está todo verde;
2. a revisão do Codex terminou (resumo "Completed") e não há conversa de revisão aberta;
3. não há conflito com a `main`;
4. PRs empilhados entram em ordem (primeiro o PR base).

Usar "merge commit" (nunca squash/rebase de histórico alheio). Depois do merge, conferir a
`main` e seguir para o próximo item. Diego pode revogar essa autorização a qualquer momento.

PR de manutenção que não é item do ROADMAP (dependências, CI): o Claude só mergeia com
autorização expressa de Diego para aquele PR.

## Revisão do Codex (ajustes autorizados por Diego em 4/10/2026)

- **PR só de documentação** (sem mudança em `app/`): uma rodada completa do Codex é
  obrigatória. Depois dela, só apontamento **P1** trava o merge; P2 e P3 são corrigidos,
  respondidos e resolvidos, e o PR pode ser mergeado sem esperar nova rodada completa — o
  Codex revisa o resultado na `main` pelo PR seguinte. Em PR com código, as quatro condições
  da seção "Merge" valem integralmente.
- **PR em revisão não ganha escopo novo.** Decisão ou pedido novo de Diego vai para o PR
  seguinte, mesmo com o anterior ainda aberto.
- **Teto:** se um PR passar de 3 rodadas do Codex, o Claude avisa Diego antes de continuar
  sozinho.

## Nunca

- Force push ou apagar branches.
- Fazer merge fora das condições acima.
- Colocar segredos, dados reais de hóspedes/proprietários, CPF, Pix, extratos ou documentos
  no Git. Dados de teste são fictícios.
- Escrever em sistemas externos reais (Beds24, Mercado Pago, WhatsApp) sem o item do
  ROADMAP autorizar explicitamente. (Beds24: escrita de calendário/preços autorizada no
  M3.7, mas sempre atrás da variável `BEDS24_ESCRITA=ligada`, que só o Diego liga.)
- Abrir PR só de documentação de status.
