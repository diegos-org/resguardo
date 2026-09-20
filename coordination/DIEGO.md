# Decisão de Diego — mobile-first e página sem transbordamento, 20/09/2026

Prioridade alta, reafirmada diretamente por Diego: hóspedes usarão predominantemente celular; proprietários e Diego também devem operar pelo celular, salvo funções específicas. Beleza, legibilidade, desempenho e usabilidade devem ser concebidos primeiro para toque/telas pequenas, mantendo boa adaptação ao desktop. Não tratar mobile como acabamento posterior.

Critério de aprovação: página encaixada na largura disponível desde o primeiro carregamento, sem zoom manual ou arrasto lateral para alcançar conteúdo. Rolagem vertical normal é esperada; não espremer a página inteira na altura de uma tela. Carrosséis podem rolar dentro de sua própria área, sem alargar o documento. Não mascarar defeitos cortando conteúdo com overflow hidden global. Preservar zoom e ampliação de texto acessíveis.

Na próxima validação prática de Sage/Lia, conferir home, catálogo, cada imóvel, consulta e demo de checkout: larguras 320, 360, 390, 430, 768, 1024 e 1440 px, retrato/paisagem e Fold aberto/fechado quando disponível. Conferir carregamento inicial e após imagens/fontes, troca de imóvel, mensagens longas/erros, calendário aberto, recibo e teclado virtual. Documento não deve exceder a largura do viewport (tolerância de arredondamento de 1 px); campos, botões, calendário e WhatsApp não podem esconder conteúdo ou ações. Verificar toque, foco, tamanho de texto e zoom, além de screenshots. Emulação não equivale a teste em aparelho real: registrar aparelhos/navegadores efetivamente usados, incluindo Safari iOS e Chrome Android quando disponíveis.

Aplicar o mesmo requisito aos futuros portais e painel, sem implementar esses módulos agora. Este registro é requisito de produto e roteiro de validação, não alegação de correção/teste já realizado. Não altera a vez dos agentes nem autoriza merge/publicação. Diego não precisa fazer nada agora.

---

# Regra operacional nova — checagem horária e PRs

A coordenação não depende mais de esperar três horas completas. Rivers já foi alterado para **checar o repo a cada hora** e só trabalhar quando realmente for sua vez.

Lia e Sage devem adotar o mesmo padrão nas próprias rotinas quando possível: checar de hora em hora; se não for a vez deles, ficam quietos. Se houver handoff novo, trabalham.

Quando houver PR realmente pronto para você:
- o repo deve marcar **DIEGO REVIEW REQUIRED**;
- você recebe um aviso curto;
- Lia pode reforçar pelo WhatsApp se esse canal estiver disponível;
- ninguém deve te chamar para merge se houver conflito ou se ainda faltar validação.

---

# Índice rápido de Diego — materiais que existem


Quando quiser encontrar alguma coisa sem lembrar o caminho:
- **Estado humano do projeto:** este arquivo, `coordination/DIEGO.md`
- **Referências visuais antigas / Labs por projeto:** `labs/VISUAL-REFERENCES.md`
- **Fotos e vídeos dos apartamentos:** `media/CATALOG.md` e futuramente `media/apartments/<apartamento>/`
- **Crescimento, Instagram, retorno, cupons e indicação:** `growth/ROADMAP.md`
- **Ideias experimentais (WhatsApp/Twilio, preview etc.):** `labs/ROADMAP.md`
- **Arquitetura de páginas/filtros:** `product/ARCHITECTURE-NOTES.md`


A equipe deve manter esses índices legíveis para você. Nada em Labs vira implementação só por estar documentado.


---


# Sage terminou — 20/09/2026, rodada das 15h15


O código já pode ser revisado por todos no [PR #1](https://github.com/al-life/scl-reconstrucao/pull/1). O site que você estava vendo no Mac continua intacto. Compartilhei uma cópia limpa, com os mesmos fluxos e imagens provisórias no lugar das fotos, porque os direitos delas ainda não estão documentados para envio. Os 22 testes dessa cópia passaram.


Nada foi colocado em produção nem incorporado à versão principal. Consultas funcionam apenas como caixa local; reserva, pagamento Mercado Pago, e-mail e conta do hóspede ainda não funcionam de verdade.


A próxima é Lia, conforme a ordem proposta por Rivers. Ela já pode ler o código; para testar a interface, precisa rodá-lo no próprio ambiente. O GitHub sozinho não cria um endereço de preview. Esse limite está explicado no [handoff](handoffs/2026-09-20-1515-sage-para-lia.md), para ninguém confundir acesso ao código com site publicado. Rivers também já pode revisar o resultado.


Você não precisa configurar nenhuma conta ou pagar nada agora. Se quiser acelerar, pode avisar Lia que o PR e o handoff estão prontos. Se ela não tiver como executar a cópia, vamos registrar isso e escolher um preview apropriado com você. Próxima rotina Sage: 18h15 BRT. Esta rodada aconteceu porque Rivers entregou trabalho novo; não foi repetição da anterior.


---


## Rivers terminou — 20/09/2026, rodada antecipada


A boa notícia: Sage fez trabalho útil e os testes locais passaram. A trava agora não é produto; é **compartilhamento**. O código que ele mexeu ainda está só no ambiente local dele, então mandar Lia agora seria fazê-la procurar uma coisa que ela não consegue ver.


Por isso eu mudei a ordem desta volta: **Sage vai de novo primeiro**, mas com uma missão curta — colocar no GitHub apenas a parte limpa e necessária desse trabalho, numa branch/PR de construção, sem segredos, dados de hóspedes, produção ou entulho antigo. Depois disso, Lia entra e testa o fluxo de verdade pelo navegador.


Mercado Pago continua escolhido por você, mas não vamos integrar pagamento antes de termos a base compartilhada, cotação/revalidação e estados mínimos bem definidos. Isso evita construir cobrança em cima de chão movediço.


### O que você precisa fazer agora
Se quiser acelerar, mande ao Sage:
**“Rivers terminou. Leia o novo handoff Rivers → Sage no repo e pode começar.”**


Você não precisa passar nenhuma instrução técnica além disso.


---


## Sage terminou — 20/09/2026, rodada antecipada


Você pode chamar o **Rivers**. Li a entrega da Lia e avancei sem refazer o site: alinhei a galeria do 399 e montei uma demonstração separada de checkout com imóvel, datas, hóspedes e total detalhado. Testei também preço mudando, datas indisponíveis, falha e cotação expirada. Tudo nela é fictício e nenhum botão cobra. Os 22 testes do projeto passaram.


Seu pedido de aviso foi incluído: ao encerrar cada rodada, Sage sempre escreve nesta conversa para você acionar Rivers. Rotina ativa a cada três horas, às 15h15, 18h15, 21h15 e assim por diante, no horário de São Paulo. Como você antecipou esta rodada, a de hoje às 15h15 só será ignorada se ainda for a mesma tarefa já concluída. As próximas não mudam. Nenhuma rotina extra de conversa foi criada.

---

## Lia — 20/09/2026, rodada17h
Li a entrega de Sage e parte do código do PR#1. A leitura confirma que a demonstração não habilita cobrança e que uma disponibilidade desconhecida não vira reserva. Ainda não consegui executar a cópia: o acesso ao GitHub funciona no navegador, mas a obtenção dos arquivos para o ambiente de testes falhou. Portanto, não estou chamando essa etapa de validada; os22 testes continuam sendo os que Sage relatou.

Deixei em LIA.md os limites e quatro fluxos para a conferência prática. Sage/Rivers podem preparar uma cópia local acessível; se precisarmos de preview remoto, combinamos antes, sem contratar ou publicar automaticamente. Não houve alteração de produção, merge, integração ou envio de dados reais. A próxima janela de Sage continua18h15. [Handoff Lia](handoffs/2026-09-20-1700-lia-para-sage.md).


## Lia — validação independente, 20/09/2026, rodada manual após Sage17h43

A cópia do PR1 já abriu no meu ambiente. Os22 testes passaram aqui; o bloqueio inicial de portas locais foi resolvido pela aprovação normal de execução, sem publicar o site. Usei somente dados fictícios.

Conferi no navegador: consulta com protocolo local, convite que apenas registra interesse, troca102→403 preservando datas/hóspedes e os quatro cenários de checkout (preço alterado, indisponível, falha e expiração), sempre sem pagamento. Nas63 combinações de9páginas com larguras320/360/390/430/768/1024/1440 não houve largura excedente; calendário aberto320px também coube e foi inspecionado visualmente.

Isso é validação de prévia, não aprovação de produção: faltam aparelhos reais, teclado virtual, zoom/ampliação de texto e verificação visual completa após mídia final. Fotos continuam marcadores, disponibilidade real/pagamento/e-mail/portal inexistem. Nenhum código alterado, merge ou publicação.

Próximo: Rivers consolidar o escopo de aceite do PR de construção e encaminhar a Sage a complementação mobile. Não estou solicitando merge enquanto esse aceite estiver pendente. Diego não precisa configurar nem contratar nada para essa rodada.
