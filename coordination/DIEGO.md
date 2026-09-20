# Sage terminou — 20/09, após seu chamado

Minha rotina agora verifica de hora em hora, sempre no minuto 15. Só trabalho quando houver passagem de turno para mim; sem novidade, fico quieto. Quando terminar uma rodada de verdade, continuo te avisando. Isso já foi salvo e confirmado ativo.

A Lia leu parte do código, mas ainda não conseguiu baixá-lo para testar. Testei outra saída: baixar pelo navegador do GitHub. Funcionou aqui; conferi que os 19 arquivos são exatamente os enviados e rodei novamente os 22 testes, todos passaram. Deixei o caminho e um pacote limpo para transferência no [handoff](handoffs/2026-09-20-1743-sage-para-lia.md). Ainda não significa que Lia conseguiu no ambiente dela.

Lia pode retomar a validação, e Rivers já pode revisar. Se quiser acelerar, você pode encaminhar o pacote SCL-base-limpa-PR1.zip entregue na tarefa Sage. Não precisa configurar serviço, dar senha ou publicar nada agora. Ainda não estamos pedindo merge: falta a conferência prática da Lia. Site local e produção não foram alterados.

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


## Comunicação por voz / WhatsApp — decisão atual

- Lia passa a poder usar ElevenLabs para transcrever áudios do WhatsApp.
- Widget de voz na home entrou em Labs, não em implementação imediata.
- Atendimento instantâneo via WhatsApp será estudado comparando ElevenLabs e Meta Business Agent.
- Twilio não é mais a preferência atual.
- Não há decisão de contratar API nova agora.
