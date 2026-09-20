



## Rodada inicial Lia — 20/9/2026, janela 14h15 BRT
- Verificado: protocolo, CURRENT, LIA, DIEGO e handoff inicial Rivers lidos. Repositório exibe Private; navegador autenticado permite leitura e editor. Conector desta sessão retornou Unknown tool em fetch e fetch_file; não confundir com acesso funcional de Rivers.
- Feito: primeira rodada manual, registro operacional preparado sem dados reais de hóspedes. Atendimento segue separado; não houve migração ou alteração de produção.
- Orientação direta de Diego: consultas podem receber informações gerais confirmadas sem código de reserva; códigos de entrada e detalhes sensíveis exigem vínculo validado.
- Checkout: para vendas diretas, levar ao site com link preenchido por imóvel/datas/ocupação, validar preço e disponibilidade no servidor. Não receber pagamento pelo WhatsApp. Diego prefere fortalecer o site mesmo com taxas; bônus por indicação ainda sem regra/valor aprovado. Não desviar reservas existentes de plataformas.
- Recomendação para Sage: propor contrato do link e demonstrar um fluxo com dados fictícios, revisão do total e falha por indisponibilidade; sem códigos, credenciais ou dados pessoais na URL. Não prometer recurso já pronto.
- Não decidido: fornecedor de pagamento, taxas concretas, política de bônus, migração, merge e publicação.
- Agendamento: criação separada a cada3h foi recusada pelo aplicativo porque esta conversa já tem um heartbeat de atendimento. Nenhuma nova rotina criada, atendimento preservado. Diego recebeu escolha entre integrar horários à atual ou criar conversa separada. Não inventar agendamento concluído.
- Próximo: Sage confirmar seu acesso e escopo técnico; Rivers resolver coordenação dos horários após decisão de Diego.
# LIA


## Papel
Execução operacional, validação prática e tarefas que dependam de navegador/interface.


## Antes de agir
Leia:
1. `/00-PROTOCOLO.md`
2. `coordination/CURRENT.md`
3. este arquivo
4. `coordination/DIEGO.md`
5. handoff mais recente


## Primeira missão
- Confirmar que você consegue ler e trabalhar neste repositório.
- Revisar o estado atual sem tocar produção.
- Registrar o que está realmente acessível.
- Avançar apenas o próximo passo concreto que faça sentido.
- Atualizar CURRENT, LIA, DIEGO e deixar handoff para Sage.


## Atenção
- Não reestruturar o sistema inteiro.
- Não trazer credenciais para o repo.
- Não confundir este workbench com produção.




## Referências compartilhadas permanentes
Além do protocolo/handoff, consulte quando o trabalho tocar nesses assuntos:
- `labs/VISUAL-REFERENCES.md` — histórico visual por projeto, incluindo referências positivas e negativas.
- `media/CATALOG.md` — catálogo de fotos/vídeos dos apartamentos.
- `growth/ROADMAP.md` — hipóteses de aquisição, retenção, referral, retorno e redes sociais.
- `labs/ROADMAP.md` — ideias experimentais como WhatsApp via API/webhook e homologação contínua.


Esses arquivos informam decisões; não autorizam implementação automática.



## Rodada Lia — 20/9/2026, 17h BRT
Leitura atual do protocolo, CURRENT/LIA/DIEGO e handoff Sage 2026-09-20-1515 concluída. PR #1, branch sage-base-publica-revisavel: 7 commits e 19 arquivos na revisão. Sem merge ou publicação.

Revisão estática parcial dos módulos availability, checkout-demo, inquiries e server e dos contratos/README: disponibilidade não configurada permanece UNKNOWN/canBook:false; demo isolada nunca habilita pagamento; cenários de preço alterado, expirado, indisponível e desconhecido têm respostas explícitas; consultas usam recibo próprio e repetição do mesmo conteúdo reutiliza protocolo, conflito retorna409. Isso é leitura do código, não teste executado por Lia.

Bloqueio de execução: Node está disponível no runtime local, mas obter a cópia via git falhou com “Could not resolve host: github.com”. Conector GitHub também retornou Unknown tool. Navegador autenticado funciona. Não contornei proteções nem solicitei nova permissão. Os22 testes relatados por Sage permanecem evidência de Sage; Lia não reexecutou e não verificou a interface ao vivo.

Próximo passo proposto para Sage/Rivers: disponibilizar cópia local revisável no ambiente da Lia ou combinar com Diego um preview de teste autorizado. Não publicar automaticamente. Conferir no navegador: 1) mudar imóvel preservando datas/hóspedes válidos; 2) checkout fictício em cada cenário; 3) retry da consulta sem duplicar; 4) convite mostra interesse registrado sem sugerir conta criada ou e-mail já enviado. Usar somente dados fictícios. Origem dos POST aceita localhost/127.0.0.1, portanto eventual preview remoto exige adaptação explícita e revisão, não apenas subir o servidor.

Sem parecer de aprovação do PR: validação prática pendente. Coordenação das rodadas já integrada ao heartbeat existente; a nota inicial sobre decisão de agendamento pendente é histórica e foi superada.
