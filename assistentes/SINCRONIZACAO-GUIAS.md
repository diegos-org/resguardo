# Sincronização dos dois guias humanos de Diego

Autorização direta de Diego, 21/09/2026: exceção de cópia local atualizada para somente:
1. assistentes/DIEGO-E-SEUS-AGENTES.md → Diego/DIEGO-E-SEUS-AGENTES.md.
2. assistentes/GUIA-DO-DIEGO.md → Diego/GUIA-SCL-DO-DIEGO.md.

Origem compartilhada: repositório privado al-life/scl-reconstrucao. Esta exceção não replica documentos privados/operacionais, bancos, ZIPs ou todos os repositórios. O restante continua seguindo suas regras próprias.

## Versão e publicação
Versão atual dos dois guias inicialmente no PR #16, branch rivers-coordenacao-20260921-1848. Até merge humano, main não é a versão atual desses arquivos. Guia SCL veio do PR #14, commit 41d7a005, com adendo de sincronização; conteúdo de papéis preservado. Ao atualizar no #14 ou outra branch, reconciliar as duas linhas explicitamente.
Após merge, preferir main se contiver a versão escolhida. Detectar novas mudanças por arquivo/ancestralidade e comparação de conteúdo, não simplesmente por PR de número maior ou data mais recente.
Se duas branches trouxerem alterações divergentes, preservar ambas, manter última cópia verificada e marcar conflito; nunca escolher silenciosamente uma.

## Cópia local
Pasta humana desta entrega: outputs/Diego na tarefa Rivers que criou o guia. O registro local SYNC-STATE.json contém caminho completo, repo, caminho remoto, ref/commit, SHA-256 e data de verificação de cada arquivo. SOMENTE os dois guias são cópias vivas; os pacotes anteriores da Lia continuam snapshots históricos e não devem ser sobrescritos.
SINCRONIZACAO.md explica o estado local. Copiar conteúdo UTF-8 integral, verificar igualdade/hash, escrever de forma atômica e preservar versão anterior quando substituir. O registro de sincronização fica separado para o conteúdo local ser igual ao GitHub.

## Atualização imediata e recuperação
Quem alterar um guia deve publicar por PR, reler a versão remota e atualizar a cópia local no mesmo trabalho, se tiver acesso. Releitura imediata de versões e comparação antes de gravar evitam atropelar outra execução.
Uma rotina horária nesta tarefa confere as duas cópias e recupera atualizações que outro agente não conseguiu copiar. Fica em silêncio em verificações normais; avisa apenas conflito, falha nova, ação humana ou mudança que exija atenção. Agenda/funcionamento real ficam registrados localmente, sem promessa de sincronização instantânea ou execução com computador/aplicativo indisponíveis.
Não alterar rotinas de atendimento ou engenharia para instalar esta conferência.

## Edição local e conflitos
Usar o hash-base salvo: local igual à base e remoto mudou → preservar anterior, copiar remoto, verificar e atualizar estado; remoto igual à base e local mudou → preservar edição e publicar por branch/PR, reler, manter indicação “PR pendente”; ambos mudaram → comparar com a base e só reconciliar alterações não conflitantes com evidência, caso contrário pedir decisão com ambas preservadas.
Nunca enviar automaticamente arquivos vizinhos ou conteúdo privado; esta autorização vale apenas aos dois documentos sanitizados. Nenhum merge automático, force push, criação de credencial ou ajuste de ruleset.
Na primeira execução, se não houver base confiável, preservar os dois lados e escolher somente a versão explicitamente designada nesta entrega. Falta de rede/acesso → conservar cópia e marcar desatualização possível, sem apagar nem alegar sincronização.


## Migração Gabi — 21/09/2026
Proposta em `docs/gabi-coordination-migration-20260921`, dependente do #16. O #17 atualiza a ficha SongKeep no cadastro; o #14 mantém outra linha do guia SCL. Reconciliar mudanças por conteúdo/ancestralidade antes de promover uma cópia, preservando todas as fichas e decisões. As duas cópias humanas da tarefa Rivers não foram alteradas nesta migração e sua atualização está **PENDENTE**. A rotina de sincronização deve preservar a última versão verificada até a reconciliação, registrar commit/hashes e depois confirmar igualdade dos dois lados. A migração não desativa essa rotina nem transfere atendimento.
