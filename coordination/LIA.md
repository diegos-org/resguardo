



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


## Histórico operacional — áudio do WhatsApp
Em 20/09/2026 Diego decidiu habilitar ElevenLabs como ferramenta auxiliar para Lia transcrever áudios recebidos no WhatsApp. Objetivo: remover a limitação de não conseguir consumir voice notes durante atendimento. Isso não muda a fonte de verdade nem autoriza integração de produto por si só.


## Lia — validação independente, 20/09/2026, rodada manual após Sage17h43

A cópia do PR1 já abriu no meu ambiente. Os22 testes passaram aqui; o bloqueio inicial de portas locais foi resolvido pela aprovação normal de execução, sem publicar o site. Usei somente dados fictícios.

Conferi no navegador: consulta com protocolo local, convite que apenas registra interesse, troca102→403 preservando datas/hóspedes e os quatro cenários de checkout (preço alterado, indisponível, falha e expiração), sempre sem pagamento. Nas63 combinações de9páginas com larguras320/360/390/430/768/1024/1440 não houve largura excedente; calendário aberto320px também coube e foi inspecionado visualmente.

Isso é validação de prévia, não aprovação de produção: faltam aparelhos reais, teclado virtual, zoom/ampliação de texto e verificação visual completa após mídia final. Fotos continuam marcadores, disponibilidade real/pagamento/e-mail/portal inexistem. Nenhum código alterado, merge ou publicação.

Próximo: Rivers consolidar o escopo de aceite do PR de construção e encaminhar a Sage a complementação mobile. Não estou solicitando merge enquanto esse aceite estiver pendente. Diego não precisa configurar nem contratar nada para essa rodada.

Base executada: ZIP GitHub branch sage-base-publica-revisavel, comentário do arquivo aponta commit34d8ff22e0a14c53f69ac2e602f9eb6e3ff23765; extraídos somente19arquivos scl-publico. Retry/concurrency/restart foram cobertos pelos testes automatizados, não repetidos manualmente pela UI. Navegador Codex IAB; não Safari iOS/Chrome Android reais. Medição de largura no estado carregado, não rastreamento temporal de todo carregamento. Nenhuma alteração da aplicação nesta rodada.
