# Migração de coordenação — Gabi — 21/09/2026

- **De:** Codex, implementando a decisão direta de Diego.
- **Para:** Rivers (revisão externa), Diego (merge/ativação) e futura tarefa Gabi (retomada).
- **Estado:** modelo aprovado, migração documental proposta, ativação NÃO REALIZADA.
- **Branch:** `docs/gabi-coordination-migration-20260921`.
- **Base:** PR #16 / `rivers-coordenacao-20260921-1848`, commit `55f15086e76c5a4cd3acec79dae978d974e64db8`.

## Feito
Protocolo passa a definir Gabi como agente operacional única em três fases contínuas: engenharia/análise/implementação; validação prática/browser/operação; coordenação/consolidação/atualização do estado. Criados memória e modelo de handoff por ciclo. Gabi não impersona agentes, não declara três revisões independentes e preserva evidências/contradições entre fases. Rivers passa a supervisor/revisor externo; Diego mantém decisões, merges e autorizações de produção/regras.

SAGE/LIA/RIVERS foram preservados integralmente, com aviso de transição. Protocolo, painéis e método anteriores estão no [snapshot](2026-09-21-pre-gabi-estado-anterior.md). Guias refletem o novo escopo sem absorver atendimento, Mia ou SongKeep. Ideia de perfil/comunicação de Diego ficou apenas em Labs.

## Verificado e limites
Leitura do protocolo e coordenação em main e no #16; consulta dos PRs abertos #5/#11/#13/#14/#15/#16/#17; leitura do handoff Sage de 20h15 no head #11 `50ec318e07e078f56ac180a11aff7827df415567`. Sua correção do retorno à estadia já foi entregue; a descrição relata CI verde e a validação visual segue pendente. Não repetir o plano desatualizado dos painéis anteriores. Nesta migração não foram executados testes funcionais/browser do produto nem confirmados acessos do ambiente futuro de Gabi.

Apenas documentação sanitizada. Nenhuma produção, deploy, secret, integração, ruleset, required status check, merge ou agenda alterados. Revisão externa de Rivers desta migração ainda PENDENTE. Conferir CI/diff do head publicado; não atribuir a ele o CI do #16.

## Dependências documentais
PR empilhado sobre #16 para preservar a coordenação mais recente sem incorporá-la silenciosamente em main. Após merge humano do #16, reconciliar com main, redirecionar este PR para main, revisar diff e CI do novo head e só então pedir merge humano desta migração. Não mergear esta proposta na branch do #16 automaticamente.

#17 atualiza a ficha SongKeep no cadastro: preservar/reconciliar essa alteração separada antes de merge/sincronização, sem regressão. #14 tem outra linha dos guias Lia/Mia: reconciliar sem voltar ao rodízio SCL. PRs de produto não são aprovados por este PR. As cópias humanas dos dois guias em `outputs/Diego` da tarefa Rivers permanecem **PENDENTES de sincronização** da migração até reconciliação explícita das linhas; preservar a última versão verificada. Nenhuma cópia local foi sobrescrita.

## Rotinas legadas a substituir no corte
Inventário abaixo é documental, não consulta atual aos agendadores. Confirmar IDs, tarefa/host e estado reais antes de alterar; não declarar rotinas pausadas só pela edição deste arquivo.

| Rotina / evidência histórica | Ação quando Gabi estiver pronta para assumir |
|---|---|
| Sage — `scl-sage-construtor-rodada-de-engenharia`; SAGE registra inicialmente 3h e depois checagem horária aos :15 | Pausar/desabilitar gatilhos de construção SCL, inclusive recorrências de 3h, checagens horárias e eventuais duplicatas/eventos. Confirmar execução em andamento e handoff final. |
| Lia — construção/validação SCL integrada ao heartbeat de atendimento, conforme LIA | Retirar/desabilitar somente o trecho/gatilho de rodadas do workbench e checagem de vez. Preservar atendimento e outras obrigações do heartbeat. Não desligar a automação inteira sem separar responsabilidades. ID a verificar. |
| Rivers — rodadas/checagens de coordenação operacional SCL, referidas como “Run Rivers coordination round” no guia | Pausar/desabilitar o rodízio antigo e versões 3h/horárias/eventos equivalentes. A supervisão externa passa a ter escopo próprio explícito, sem quarto executor. IDs/cadência reais a verificar. |
| Rivers — sincronizar guias de Diego, descrita no #16 como horária aos :45 | Preservar separadamente; não confundir com rodízio. Reconciliar versões e manter tratamento de conflitos. |

Não alterar rotinas de outros projetos nem atendimento/transferência Lia/Mia. Não foram enviados avisos externos a Sage/Lia/Rivers nesta migração; o handoff documenta a transição para leitura/revisão.

## Sequência de ativação, sem sobreposição
1. Diego revisa/mergeia a documentação na ordem das dependências. Registrar versão final adotada; merge documental não equivale à ativação.
2. Preparar uma tarefa Gabi com gatilhos ainda desabilitados. Confirmar plataforma/host, ID, acesso GitHub por branch/PR, runtime de testes, browser, canal de avisos e capacidade de manter memória por ciclo. Não presumir essas capacidades por existirem nesta sessão.
3. Ensaiar ciclo fictício ou somente leitura, incluindo bloqueio, contradição, interrupção/retomada, deduplicação e exclusão de concorrência. Sem escrita concorrente com legados. Rivers registra revisão externa do ensaio.
4. Diego aprova cadência ou mecanismo de evento oficial, escopo de supervisão e momento de corte. Event-driven só se mecanismo realmente testado/autorizado; não usar sessão/cookies humanos como ponte. Sem novidade, silêncio; avisar conclusão material, falha ou ação humana necessária.
5. Na janela de corte, impedir novos disparos legados, concluir/interromper com checkpoint as execuções em andamento, coletar handoffs finais e confirmar pausa dos componentes SCL da tabela. Registrar IDs reais, data/hora/fuso, último ciclo/head, pendências e responsável. Preservar cobertura de atendimento.
6. Confirmar que não há outro escritor operacional e só então habilitar o primeiro disparo autônomo Gabi. Registrar aceite, tarefa/agenda/evento, versão do protocolo e evidência de primeiro ciclo concluído. Atualizar GABI/CURRENT/DIEGO/guias. “Gabi ao vivo” significa esta confirmação, não apenas ter criado a tarefa.
7. Se a entrada falhar: pausar Gabi e registrar checkpoint/causa; Diego decide retorno temporário a um responsável legado identificado. Nunca reativar automaticamente as três agendas nem manter Gabi e legado escrevendo simultaneamente.

## Próxima execução e autorização humana restante
Antes do corte, responsáveis legados continuam nas frentes autorizadas, sem Gabi concorrente. Depois, Gabi confere PRs e handoffs atuais e assume pendências pelo modelo de três fases; Rivers revisa de fora. Diego ainda precisa dos merges documentais e da decisão de ativação/cadência/ambiente/corte após o ensaio. Nada exige aprovar deploy ou alterar regras administrativas para concluir esta migração.
