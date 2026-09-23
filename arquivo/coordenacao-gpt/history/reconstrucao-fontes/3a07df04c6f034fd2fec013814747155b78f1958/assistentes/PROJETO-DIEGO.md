# Sua Casa Leblon — arquivo do Diego

**Fotografia verificada em 21/09/2026, aproximadamente 21h BRT.** Este arquivo nasce em PR; até seu merge, é uma proposta atualizada sobre a main observada, não prova de migração implantada. Próxima revisão proposta: **23/09/2026 às 18h BRT**. Depois da data, sem nova verificação, considerar o retrato vencido.

## Onde estamos
A main privada está em `be0860e46be3c209152a2c5de2f1b042128503ad`, último merge #12. Contém workbench público e regras operacionais sanitizadas. Não é aplicação de produção. Várias entregas mais recentes estão em PRs; nenhum merge foi feito nesta migração.

**Progresso da migração: 0/5 marcos integralmente aceitos.** Documentação preparada; três tarefas cloud criadas e leitura GitHub relatada, mas sem teste de operação ou corte. Não existe percentual defensável do produto completo. O indicador conta gates, não esforço, documentos ou volume de código.

## Quem faz o quê — atual versus destino
- **Gabi:** destino aprovado = integradora cloud e guardiã da main. Tarefa criada, leitura GitHub confirmada pelo relatório dela; integração autônoma não ativa.
- **Sage:** builder e contraponto técnico permanece. Instância atual local, com rotina configurada; migração cloud futura possível, não realizada.
- **Lia Cloud:** criada para preparar atendimento imediato. Não testou Airbnb/WhatsApp nem recebeu atendimento.
- **Mia Cloud:** criada para preparar preços/calendário/configurações/revisão futura. Não assumiu serviços.
- **Lia original:** ainda local e responsável pela cobertura anterior. Destino = **Lia Local — Máquina e Recuperação**, a renomear no corte.
- **Rivers:** supervisor externo e revisor do processo. A sincronização de arquivos é uma função local explícita.
- **Diego:** decisões de produto, calendário, custo, corte e todos os merges.

Os três chats cloud receberam automaticamente o mesmo título **“Relatório de prontidão GitHub”** apesar dos títulos específicos pedidos. [Cadastro e IDs](DIEGO-E-SEUS-AGENTES.md) evitam confusão; renomeação visual ainda pendente. Isso não impede identificar os papéis, confirmados pelos prompts/respostas.

## Serviços e integrações
| Serviço | Evidência atual | Falta / próximo passo |
|---|---|---|
| GitHub SCL | Repositório privado, main/PRs lidos nesta execução; alterações propostas por PR | Merge humano e reconciliação dos PRs |
| Work Cloud Gabi/Lia/Mia | Tarefas criadas; relatórios de leitura GitHub recebidos | Runtime/browser Gabi; canais Lia; fontes/configuração Mia; ensaios e corte |
| Airbnb / WhatsApp | Rotina local configurada ACTIVE, horária; sucesso de canal não revalidado nesta execução | Validar acesso cloud e transferir índice privado/pendências sem duplicação |
| Beds24 | Etapa documentada; README do workbench exclui integração real | Login e reconciliação de inventário/preços; nenhum sync ativado por este trabalho |
| Booking | Preparação/mapeamento documentados | Conta/anúncios/contratos e piloto Rio; não declarar aberto |
| Cloudflare / e-mail | Fila documental | Inventário DNS/e-mail e teste autorizado; sem mudança de domínio |
| Mercado Pago | Demo fictícia na base; sem cobrança real | Conta/backend/webhook e ensaios autorizados |
| Neon / Vercel | Alvos de homologação na fila; atividade real não revalidada | Acesso e ambiente fictício; sem banco/deploy novo |
| Sites | Conector acessível; projeto privado registrado, sem versão/deploy | Painel HTML privado/local preparado; projeto Sites appgprj_6ab1c6c1d5b88191ac1cdc44c8271b50 sem publicação por proibição explícita de deploy |
| Backup/recuperação local | Papel definido | Nenhuma nova agenda nem restauração comprovada nesta migração |

“Configurado”, “relatado” e “testado agora” são estados diferentes. A tabela não audita todos os serviços pessoais de Diego.

## Main versus propostas abertas
- **#19 — docs: reconciliar guias de Diego entre Gabi e Constructor**: base `docs/gabi-coordination-migration-20260921`, rascunho; head `240908fd24bd`. Fora da main.
- **#18 — docs: migrar coordenação SCL para Gabi com supervisão externa de Rivers**: base `rivers-coordenacao-20260921-1848`, rascunho; head `7c078ce86c3e`. Fora da main.
- **#17 — docs: atualizar ficha SongKeep Constructor após aceite da entrada**: base `rivers-coordenacao-20260921-1848`, rascunho; head `7ec45b45a4f4`. Fora da main.
- **#16 — docs: coordenação Rivers, guia de agentes e continuidade local/nuvem**: base `main`, aberto; head `55f15086e76c`. Fora da main.
- **#15 — Iniciar demonstração interna de gestão e cadastro com pendências**: base `main`, rascunho; head `dfecfd0d707b`. Fora da main.
- **#14 — docs: relatórios, atendimento e preparação da divisão Lia/Mia**: base `main`, rascunho; head `2fe480b787b1`. Fora da main.
- **#13 — Registrar financeiro, conciliação e portais conforme decisões de Diego**: base `main`, rascunho; head `7d50db57df0f`. Fora da main.
- **#11 — Refinar site mobile e demonstrar fluxo de pagamento sem integrações reais**: base `main`, rascunho; head `50ec318e07e0`. Fora da main.
- **#5 — Registrar Bumble Helper no Labs**: base `main`, aberto; head `0ff4fe1dbc63`. Fora da main.

Esta migração consolida o conteúdo documental de #16/#18/#19 e a ficha SongKeep #17 já reconciliada em #19 em uma proposta diretamente sobre main, com novo desenho de papéis. Não fecha nem mergeia esses PRs; após aceite do substituto, Diego pode encerrar os superados preservando links/história. #14 requer reconciliação por assunto; #11/#13/#15 continuam frentes próprias. #5 é Labs independente. As dez branches sem PR aberto consultadas ficaram com ahead=0 em comparação à main; são história incorporada, não dez pendências novas.

## Roadmap e decisões
1. Rever arquitetura consolidada e incorporar por merge humano.
2. Validar cloud com ensaios, acessos próprios e responsável único; conservar rotina antiga enquanto faltar prova.
3. Fazer corte separado de construção, atendimento e prospectivo, com recuperação definida.
4. Retomar entregas materiais #11/#13/#15 e operação #14, sem PRs de status repetitivos.
5. Preparar integrações na ordem documentada, sem confundir homologação com produção.

[Marcos e checkpoints](../coordination/MARCOS.md): M0 23/09; M1 24/09; M2 25/09; M3 28/09; M4 30/09. Datas propostas para aprovação Diego + Rivers. Se perder checkpoint, revisar motivo e método antes de mudar data. Roadmap exige rationale, consulta aos afetados e aprovação dos dois.

**Próxima ação humana:** revisar o PR consolidado e os checkpoints; obter parecer externo de Rivers antes de aprovar calendário/corte. Não desligar Lia/Sage agora. Login de canais só quando a tarefa cloud indicar a necessidade concreta. Publicação privada do painel depende de autorização explícita de deploy.

## Desvios e limites
Main ainda atrasada em relação às propostas; nenhum agente cloud operacionalmente ativo; Sage continua local; Lia não renomeada; painel sem hospedagem; revisão independente desta migração pendente. Guias humanos antigos na tarefa Rivers não foram sobrescritos: usam outra linha de sincronização e precisam reconciliar a nova versão após aprovação.
[Contratos completos](../coordination/ARQUITETURA-OPERACIONAL.md) · [Plano de corte](../coordination/MIGRACAO-CLOUD.md) · [Inventário verificável](../coordination/evidence/2026-09-21-state.json).
