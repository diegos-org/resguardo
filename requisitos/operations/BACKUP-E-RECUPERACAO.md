# Backup e recuperação

Registro de como o SCL é protegido contra perda do repositório, da conta ou do banco, por que
foi feito assim e como recuperar. Decidido por Diego em 3/10/2026 ("essa reconstrução nasceu
com princípio zero de segurança"). Linguagem simples; sem código além do nome dos arquivos.

**Regra de privacidade deste documento e do repositório inteiro:** nenhum dado da conta de
backup aparece aqui — nem nome de usuário, nem nome do repositório, nem e-mail. Fica só o
registro de que o backup existe, como funciona e por quê. Os dados ficam com o Diego, no
gerenciador de senhas.

## 1. O que está protegido e o que não está

| O quê | Onde vive | Como está protegido | Situação |
|---|---|---|---|
| Código, documentação, histórico de decisões | GitHub (`al-life/scl-reconstrucao`) | Espelho automático em **outra conta** do GitHub, a cada 3 dias, guardando todas as versões (M0.7) | Pronto no repositório; Diego ativa na conta separada |
| Dados reais (reservas, proprietários, financeiro) | Neon (projeto `scl-sistema`, branch `main`) | Restauração por ponto no tempo do próprio Neon | **Só 1 dia** de histórico e **nenhum snapshot** (conferido em 3/10). Proposta na seção 5 |
| Chaves e senhas do sistema | Variáveis da Vercel | Não têm backup automático e não devem ter cópia em lugar nenhum além do gerenciador de senhas | Diego guarda uma cópia no gerenciador de senhas |
| Configuração da Vercel, do Beds24, do Google (login) | Painéis de cada serviço | Reconstruível a partir deste guia e do `GUIA-DIEGO.md` | Documentado |

Dados reais **nunca** vão para o GitHub (regra do `CLAUDE.md`), inclusive para o repositório
de backup. Por isso o backup do banco é assunto do Neon, não do Git.

## 2. Contra o que o espelho do repositório protege

- Perda da senha ou da conta principal do GitHub, ou bloqueio da conta.
- Invasão da conta principal: quem invade não encontra nenhum caminho até o backup.
- Repositório apagado, branch apagada ou histórico reescrito por engano ou por má-fé.
- Erro grave de uma ferramenta automática (Claude, Codex) que apague ou reescreva algo.

Não protege contra: dados do banco (seção 5) e indisponibilidade do GitHub em si (os dois
repositórios estão no GitHub; um clone local ocasional cobre isso, se um dia for preciso).

## 3. Como o espelho funciona

O desenho é **puxar, não empurrar**: a conta de backup busca o repositório principal; o
repositório principal não sabe que o backup existe.

1. **Conta separada do GitHub**, com e-mail, senha e 2FA próprios, códigos de recuperação no
   gerenciador de senhas. Nela, um repositório **privado**.
2. **Token só de leitura** criado na conta principal (fine-grained), restrito ao repositório
   `scl-reconstrucao`, permissão *Contents: Read-only*, com validade de até 1 ano. É a única
   ponte entre as contas e fica guardado como segredo dentro do repositório de backup.
3. **Robô agendado** no repositório de backup (arquivo original em `infra/backup/espelho-github.yml`
   deste repositório; copiado para `.github/workflows/backup.yml` lá). A cada 3 dias, às 03:17
   de Brasília, e quando acionado à mão:
   - baixa **todas** as branches e tags da origem;
   - grava no repositório de backup sob o prefixo `espelho/` (ex.: `espelho/main`), **sem
     nunca apagar nem reescrever**: branch apagada na origem continua lá; branch reescrita na
     origem fica como estava (a versão nova fica guardada na tag datada da rodada);
   - cria uma tag `backup/AAAA-MM-DD-HHMM` apontando para um **retrato** da rodada: um commit
     com os arquivos da `main` daquele momento, que tem como "pais" o retrato anterior e
     **todas** as pontas da origem (cada branch e cada tag) e, como mensagem, o **inventário**:
     cada branch e tag da origem com o seu commit, e tudo o que o backup guarda. A branch
     `backup-marcos` aponta sempre para o último retrato: é a linha do tempo dos retratos e a
     base da comparação. Assim nada do que o inventário cita fica solto para o Git limpar. É
     um ponto de restauração imutável por rodada e a lista do que existia naquele dia. Como o
     Git guarda o histórico inteiro, **todas as versões ficam**, indefinidamente;
   - uma branch ou tag **reescrita** na origem (branch cujo commit anterior deixou de ser
     antepassado; tag que mudou de objeto) é guardada tal como está sob
     `recusadas/<data>/...`, uma vez por reescrita, para o objeto exato (inclusive uma tag
     anotada) continuar alcançável; a versão antiga continua em `espelho/...`. Essa gravação
     vem antes da tag do dia e do ponteiro (que entram juntos, ou nenhum): a base de
     comparação nunca avança sem que o que ela cita esteja guardado. O inventário anota o
     objeto exato de cada cópia; se uma for apagada do backup, a rodada seguinte avisa e a
     regrava a partir da origem só se a origem ainda tiver exatamente aquele objeto (senão,
     diz que a cópia se perdeu, em vez de rotular outro objeto com a data antiga). Uma ref
     apagada na origem e recriada depois com outro conteúdo também conta como reescrita;
   - no push do espelho, só a recusa por divergência da origem é aceita (e vira aviso
     amarelo), e só para refs que a base já conhecia ou que foram tratadas como reescritas
     na rodada; qualquer outra recusa (regra do repositório, falha do servidor, ref
     desconhecida) para a rodada antes de avançar a base, porque o espelho pode ter ficado
     incompleto;
   - compara com o inventário do retrato anterior e **falha, o que gera e-mail para a conta
     de backup**, quando algo sumiu da origem, foi reescrito na origem ou sumiu do próprio
     backup (inclusive uma tag `backup/`, mesmo a mais nova, e a branch `backup-marcos`; se
     todos os marcos sumirem, avisa também). Cada ocorrência avisa **uma vez só** (o
     inventário novo já reflete a mudança); enquanto a origem continuar divergente de uma
     branch guardada, as rodadas seguintes só mostram um aviso amarelo, sem falhar. Se a tag
     do dia não puder ser gravada (duas rodadas no mesmo minuto, ou uma regra do repositório
     recusou), a rodada falha com a mensagem. Se o robô não conseguir ler o que o backup já
     guarda, a rodada para antes de gravar qualquer coisa, para não tomar o vazio por base.
4. **Proteção extra no repositório de backup** (rulesets: proibido apagar branches ou tags e
   reescrever histórico, para todo mundo, inclusive o robô). **Só existe em repositório privado
   com plano pago do GitHub (Pro ou superior).** No plano Free, fica a proteção do próprio
   robô: ele nunca apaga nem reescreve e avisa quando o backup perde algo. A trava cobre a
   mais só o erro manual de quem tem acesso à conta de backup, que é só o Diego.

Testado em 3/10 rodando o script exato do robô contra repositórios locais, vinte e cinco rodadas:
origem só com `main`; novas branches e tags; origem avança; origem apaga uma branch (o backup
a mantém e avisa uma vez); nada muda (sem aviso repetido); origem reescreve uma branch e uma
tag anotada (o backup mantém as versões antigas em `espelho/`, guarda as novas em
`recusadas/<data>/`, a ponta nova fica alcançável pelo retrato, avisa uma vez); nada muda (só
o aviso amarelo); alguém apaga uma branch no backup (avisa uma vez); alguém apaga uma tag
`backup/` antiga (avisa uma vez); alguém apaga a tag `backup/` mais nova (avisa uma vez); nada
muda; alguém apaga a branch `backup-marcos` (avisa e recria); nada muda; rodada repetida no
mesmo minuto (falha com a mensagem); alguém apaga todas as tags `backup/` e o ponteiro
(avisa); nada muda; uma regra do destino recusa uma branch (a rodada falha e a base não
avança); tag apagada na origem e recriada com outro conteúdo (reescrita, com cópia exata);
backup inacessível (a rodada para antes de gravar). Também: a cópia `recusadas/` da tag
anotada apagada do backup é avisada e regravada quando a origem ainda tem o objeto, e dada
como perdida quando a origem já mudou de novo; e as tags do backup não voltam para a origem
nem se duplicam com o prefixo.

### Por que assim

- **Direção puxar:** se a conta principal for invadida, o invasor não encontra senha, nome
  ou endereço do backup — ele simplesmente não está lá. Se o token vazar, só permite **ler**
  o código e é revogado em um clique.
- **Sem `--mirror`:** um espelho exato copiaria também as exclusões e as reescritas, isto é,
  copiaria o estrago. Aqui só se acrescenta.
- **Tags datadas:** restaurar "como estava em tal dia" sem depender de nenhuma branch.
- **Prefixo `espelho/`:** separa o conteúdo copiado do próprio robô (que vive na `main` do
  repositório de backup) e evita qualquer conflito de nomes.

## 4. Como recuperar

**Ver como estava em uma data:** no repositório de backup, abrir a lista de tags e escolher
`backup/AAAA-MM-DD-HHMM`: são os arquivos da `main` daquele dia, legíveis ali mesmo, no
navegador. A mensagem do commit lista as branches e tags que a origem tinha naquele dia, com
o commit de cada uma, e todas elas continuam alcançáveis a partir dessa tag. A branch
`backup-marcos` percorre todos os retratos, do mais novo ao primeiro.

**Recriar o repositório principal** (perda da conta ou do repositório):

1. Criar um repositório novo (na conta que for) e importar a partir do repositório de backup
   — pelo GitHub (*Import repository*) ou por um clone local.
2. A branch `espelho/main` do backup vira a `main` do repositório novo; as outras
   `espelho/<nome>` voltam ao nome original se forem necessárias.
3. Reconectar a Vercel ao repositório novo (mesmo projeto; só muda a origem do código) e o
   Codex/Claude Code, se forem continuar.
4. Criar um token novo só de leitura na conta nova e trocar o segredo no repositório de backup,
   para o robô seguir copiando.

Quem faz isso precisa saber o endereço do repositório de backup, que está só com o Diego.

## 5. Banco de dados (Neon) — situação e proposta

Conferido em 3/10/2026, só leitura, pelo conector do Neon:

| Item | Hoje | O que o plano permite |
|---|---|---|
| Plano | Launch | — |
| Restauração por ponto no tempo (histórico) | **1 dia** | até 7 dias no Launch |
| Snapshots (cópias congeladas) | **nenhum**, sem agendamento | agendamento diário/semanal, com retenção configurável |
| Branches | `main` (produção) e `preview` (testes dos PRs) | — |

Risco de hoje: um erro percebido depois de 24 horas (dado apagado por engano, migração ruim,
sincronização errada) não tem mais para onde voltar.

Proposta (a decidir por Diego; mexe no custo de armazenamento, pequeno para o tamanho atual do
banco, que é de poucos megabytes):

1. **Histórico de 7 dias** na branch `main`.
2. **Snapshot diário** com retenção de algumas semanas, e um semanal com retenção maior,
   para ter pontos fixos além dos 7 dias.
3. Mais adiante (M11.3), uma **cópia fora do Neon**: um despejo cifrado do banco guardado
   num lugar privado (nunca no GitHub). Precisa de uma conta de armazenamento e de uma chave
   de cifra guardada no gerenciador de senhas. Fica para quando houver dados reais em volume.

Essas mudanças são feitas no Neon, não no código; quando Diego autorizar, ficam registradas
aqui com a data.

## 6. Rotina de manutenção (Diego)

- **Mensal:** abrir a aba *Actions* do repositório de backup e conferir que a última rodada
  está verde. Rodada vermelha = ler a mensagem: ela diz exatamente o que sumiu ou foi
  reescrito, e onde (é aviso, não perda), ou que o token venceu. Aviso amarelo de "refs
  recusadas" = a origem continua divergente de uma branch guardada; o backup segue íntegro.
- **Anual (antes da validade do token):** gerar um token novo só de leitura na conta principal
  e trocar o segredo `ORIGEM_TOKEN` no repositório de backup. A data de validade fica anotada
  no gerenciador de senhas junto com o token.
- **Nunca:** colar o token em chat, e-mail, Git ou tela do sistema; dar ao token qualquer
  permissão além de leitura do repositório; apontar o robô para uma conta que alguém mais
  acesse.

## 7. Histórico

- 3/10/2026 — Diego decide ter backup automático do repositório a cada 3 dias, em conta
  separada do GitHub, guardando todas as versões, sem nenhuma referência à conta de backup no
  repositório principal. Pede também avaliação do backup do Neon. Robô, documentação e passo a
  passo entregues no M0.7; ativação pelo Diego.
