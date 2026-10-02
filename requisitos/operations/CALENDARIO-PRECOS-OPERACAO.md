# Calendário, preços e duração — regras operacionais

Consolidação solicitada por Diego em 1/10/2026. Origem: decisões diretas de 15, 18 e 19/9 registradas no protocolo local de calendário, comparadas com ROADMAP, CLAUDE.md, decisões operacionais e código atual da main `73f14d89f7fd616ada889ca175730ab42dba28b0`. Somente regras; reservas, contatos e resultados financeiros individuais ficam fora do Git.

## Fonte e estado de implantação

- Prevalece a direção de 24/9: **SCL como fonte oficial**, enviando calendário/preços ao Beds24 e às OTAs pelo M3.7, após implementação, teste em imóvel escolhido e ativação expressa por Diego. Essa é a direção do sistema; em 1/10 Diego pediu expressamente esta rodada diretamente pelo Beds24 enquanto o painel não efetua escrita.
- Em 1/10, M3.7 ainda consta a fazer. O PR 73/M3.3 é importação somente leitura. Código, credencial ou quarto mapeado não provam envio ativo de tarifas.
- Para a rodada de 1/10, usar o Beds24 já conectado, verificar o que efetivamente envia e conferir resultado no Airbnb. Não editar preços paralelamente no Airbnb nem ativar a integração futura do painel. Evitar dois responsáveis escrevendo no mesmo calendário.
- Comparar sempre registros locais, requisitos vigentes, configurações atuais e últimas decisões de Diego. Preservar decisões novas; não copiar um arquivo antigo por cima de regra melhor. Propostas de agentes não viram aprovação por terem data recente.
- Este documento consolida requisitos operacionais; não afirma que o motor já os implementa nem que a plataforma já os salvou. A fonte futura dos valores configuráveis será o painel, conforme o princípio de uma regra em um lugar.

## Escopo e rotina

Cinco imóveis do Leblon: 102 Inteligente, 103 Boutique, 303 Quadra Praia, 399 Orgânico vigente e 403 Mezanino. Anúncios antigos e Ipanema excluídos. Casa Búzios separada, sem replicar preços dos estúdios ou incluí-la no catálogo público.

Revisão ampla sob pedido de Diego, aproximadamente mensal, cobrindo horizonte móvel de nove meses. Conferir cobertura anterior e novas datas, revalidando também eventos e lacunas já cobertos. Não declarar nove meses conferidos se apenas uma parte foi lida.

Checagem breve, quando atendimento/revisão estiver autorizado: hoje e amanhã, depois próximos sete dias; Búzios próximos 30 dias. Essa definição não cria nem reativa automação.

Preservar reservas e bloqueios intencionais. Uma autorização antiga para liberar bloqueios não se aplica a novos bloqueios. Não inferir disponibilidade da ausência de registros.

## Duração e disponibilidade

- Horizonte móvel: nove meses, conferir anúncio por anúncio.
- Semana normal: domingo–quinta mínimo 1 noite; sexta e sábado mínimo 2 noites.
- Check-in e checkout em qualquer dia da semana.
- Máximo 27 noites; pedidos superiores dependem de avaliação, não aprovação automática.
- Conferir se mínimo na interface é da entrada ou de todas as noites; registrar a semântica antes de traduzir a regra entre sistemas.
- Pedidos para o próprio dia são aceitos para avaliação manual e confirmação da limpeza. Não habilitar reserva instantânea no mesmo dia nem afirmar limpeza pronta por esta regra.

## Feriadões

Feriados nacionais e estaduais do RJ, Corpus Christi e a exceção expressa de 9 de julho/SP para ambos os destinos. Excluir feriados municipais. Outros feriados de origem dos hóspedes dependem de aprovação. Confirmar datas anuais e abrangência em fonte confiável.

| Dia do feriado | Janela inclusiva | Mínimo |
|---|---|---:|
| Quinta | Quarta anterior a domingo | 3 |
| Sexta | Quinta anterior a domingo | 3 |
| Segunda | Sexta anterior a segunda | 3 |
| Terça | Sexta anterior a terça | 3 |

Quarta, sábado ou domingo não ativam uma janela extra. Se dois feriados prolongarem o mesmo intervalo (quinta/sexta seguido de segunda/terça), unir as janelas sem interrupção. Preço de teste no Leblon: 2×B.

## Temporada e eventos

- Alta temporada: 15/12 ao último dia de fevereiro, estendendo até Quarta-feira de Cinzas quando ela cair em março. Preço Leblon 2×B. Não estender ao fim de semana seguinte por inferência.
- Réveillon: 25/12–1/1 inclusivos, mínimo 5 noites, Leblon 4×B. Depois de reserva de cinco noites que ocupe o período principal, rever sobras; datas livres de 25–27/12 voltam ao mínimo semanal. Reprecificação dessas sobras não foi definida: não baixar preço automaticamente.
- Carnaval: segunda-feira da semana anterior à terça-feira de Carnaval até Cinzas, inclusivos; é a segunda três dias antes da quinta que inicia o período principal. Mínimo 5, Leblon 4×B. Confirmar datas anuais. Rever sobras após reserva.
- Rock in Rio: Leblon 3×B; sem novo mínimo de noites. Búzios excluído. Confirmar edição, dias efetivos e noites abrangidas; não importar datas de outro ano.
- Multiplicadores não acumulam: usar o maior aplicável. Carnaval dentro da alta = 4×B, nunca 8×B.
- Nas datas especiais, preço fixo manual substitui o Preço Inteligente naquela noite. Não desligar o recurso global nem elevar seu teto global por consequência.

## Base, preços existentes e pisos

B é a referência geral confirmada do anúncio antes do acréscimo, não a diária já multiplicada. Diego reconfirmou em 1/10/2026 **B=R$450 nos quatro estúdios e B=R$800 no 303** para o cálculo dos multiplicadores. Essa decisão não significa que todas as diárias específicas sejam iguais à base. Conferir intervenções e descontos existentes antes de aplicar, preservando a referência original.

As tarifas manuais de evento podem ultrapassar o teto do Preço Inteligente: essa exceção foi aprovada, preservando o teto geral. Não limitar silenciosamente o preço especial ao teto nem mudar o teto para acomodá-lo.

Os valores são diárias antes de taxas/limpeza/descontos, não receita líquida nem preços validados por pesquisa de mercado. Não aumentar redução manual de Diego sem conhecer a decisão.

## Última hora — teste aprovado

| Antecedência da noite (fuso local) | Redução sobre referência original | Piso estúdios | Piso 303 |
|---|---:|---:|---:|
| D−7 a D−3 | 15% | R$350 | R$700 |
| D−2 a D0 | 25% | R$300 | R$650 |

Preço = maior entre piso aprovado e referência original × (1−percentual). Guardar a referência antes da primeira redução. Ao passar para 25%, recalcular sobre ela; nunca reduzir novamente o preço que já recebeu 15%. Os pisos registrados são limites, não alvos obrigatórios nem valores a recalcular automaticamente se B mudar.

Conferir promoções, descontos por duração, hóspedes com avaliações excelentes e outros descontos antes de aplicar. Não desligar benefícios existentes sem autorização. Se a referência original ou a combinação efetiva for desconhecida, registrar pendência, sem inventar uma base. Eventos grandes não recebem automaticamente o piso de semana normal; essa exceção continua pendente.

## Sobras entre reservas

Regra aprovada para todos os seis imóveis e para eventos: em cada data de entrada, mínimo ajustado = menor entre mínimo aplicável e noites consecutivas livres até a próxima reserva/bloqueio válido. Exemplo: sobram três noites num período com mínimo cinco → mínimos 3, 2, 1 nas respectivas entradas. Não liberar todo o período com uma noite indistintamente.

Sábado livre após checkout com sexta ocupada pode ter mínimo 1, conferindo exceções especiais. Aplicar também a sobras de hoje, mantendo avaliação manual e limpeza. A redução do mínimo não autoriza desconto ou desbloqueio.

## Búzios — regra própria

Piloto antigo de 2×/4× sobre 450 não autoriza novas replicações. Em 18/9, Diego orientou preservar os limites gerais então registrados (450/2.500), com revisão própria. Referência relatada de cerca de 3.000/noite para Réveillon anterior e Carnaval desejado não é tarifa aprovada para novas datas.

Próximos 30 dias: registrar noites reservadas, livres e impedimentos de duração/antecedência. Antes de reduzir, resolver a incidência adicional de 15% para hóspedes com avaliações excelentes observada em setembro. Pisos históricos do teste eram 350/300; aplicar só após conferir as condições específicas e decisões posteriores. Alta temporada/feriadões continuam exigindo definição própria dos valores. Não prometer melhora de ranking por reduzir preço.

## Registro e verificação de cada rodada

1. Conferir fonte em vigor, autorização, anúncio atual e reservas/bloqueios.
2. Registrar intervalo, preço e mínimo anteriores, base original e regra usada.
3. Aplicar apenas noites disponíveis e mudanças autorizadas, sem alterar reservas confirmadas.
4. Salvar; reabrir/recarregar e conferir anúncio, datas e valores. Distinguir envio do salvamento e resultado confirmado.
5. Registrar cobertura de preços, mínimos e horizonte separadamente; registrar lacunas e próximo passo.
6. Manter log privado por data/anúncio para não duplicar reduções. No repositório somente metodologia e exemplos fictícios.

## Compatibilidade com o sistema atual e pendências

O arquivo `app/src/imoveis/regras-venda.ts`, conferido na main citada, aceita períodos explícitos, aplica o primeiro período correspondente e limita o valor ao mínimo/máximo com preço dinâmico ligado. Ainda não é um motor das regras acima: não calcula o maior multiplicador, os descontos de última hora com referência persistida, a semana normal por dia ou as sobras por disponibilidade. Essa diferença precisa ser tratada no desenvolvimento de M3.7 antes de usá-lo como automatismo; esta consolidação **não altera código nem libera escrita**.

Pendentes: tarifas próprias de eventos de Búzios; combinação de descontos adicionais; tratamento de última hora em grandes eventos; reprecificação de sobras de Réveillon/Carnaval; validação de mercado e definição de piso líquido. Nenhuma dessas lacunas deve ser preenchida por palpite.

O documento `requisitos/product/MARKETPLACE-PRECIFICACAO.md` trata de propostas para venda direta e divisão de receita. Foi preservado: não substitui estas regras de diárias e não constitui aprovação de novos percentuais.

## Tradução para a conexão Beds24 vigente

Segundo a documentação oficial consultada em1/10, o modo Limited inclui preços, disponibilidade e mínimos, além de configurações de preços. O nome não significa ausência de envio. Airbnb aplica o mínimo à data de entrada. Preço Inteligente não está disponível para anúncios conectados por API: preservar as regras históricas como origem, mas não presumir esse motor ativo na configuração atual. Conferir tarifas diárias, descontos e base de cada anúncio antes de traduzir regras. Referência: https://wiki.beds24.com/index.php/Airbnb_Mapping.


### Confirmação direta de Diego — 1/10/2026

Diego confirmou: base padrão do303 = R$800 e autorizou corrigir o R$1000 observado noBeds24. Não atribuiu origem ao valor divergente. Preservar tarifas especiais, reservas e intervenções manuais específicas. A gravação e a propagação devem ser verificadas e registradas separadamente.

## Limitação identificada na revisão do PR74

A função `precoDaNoite` atualmente limita também tarifas explícitas de eventos ao teto geral quando o preço dinâmico está ligado. Isso contradiz a exceção aprovada acima e pode reduzir uma cotação do simulador mesmo antes do M3.7. Antes de considerar essa regra implementada, é necessário corrigir a isenção dos preços explícitos de evento e testá-la, mantendo a limitação para as tarifas às quais ela realmente se aplica. Esta rodada documental não altera o motor, não aprova publicação nem comprova cotações corretas.

## Atualização de implementação — M3.7a, 2/10/2026

A prévia em `/painel/calendario/previa` compara o cadastro atual com observações já
importadas, por imóvel e intervalo (até 92 noites inclusivas). Exibe lacunas, horários,
ocupação local e diferenças conhecidas. Não faz consulta remota, não envia valores e não
valida preço final das OTAs. A semântica do mínimo mostrado pelo SCL é a data de entrada;
o mínimo observado do Beds24 ainda requer conferência das regras do canal.

Corrigida a limitação descrita acima: `precoDaNoite` preserva preços explícitos de períodos,
inclusive fora do piso/teto geral; somente o preço base passa pelos limites quando
habilitados. O simulador usa a mesma função. Nenhum preço de reserva ou canal é alterado.
As demais lacunas do motor e a proteção diária de piso/teto continuam pendentes no M3.7.

## Compatibilidade dos PRs73 e74

Conferência em 1/10: PR73 (`codex/m3.3-beds24-sincronizacao`, head `c583e8de7b9255b5e839eaefa02c6185457fbd50`) implementa leitura Beds24 → SCL. PR74 acrescenta esta documentação e uma seção no fim de `GUIA-DIEGO.md`. O único arquivo compartilhado é o guia; os trechos alterados no PR73 e a seção acrescentada no PR74 são distintos. Ambos partiam da mesma main `73f14d89f7fd616ada889ca175730ab42dba28b0` e estavam integráveis na consulta. Não substituir o guia inteiro pela cópia de outra branch. Após o primeiro merge humano, revalidar o diff do segundo contra a nova main; preservar ambos os conjuntos de mudanças. A inspeção documental não constitui revisão ou aprovação integral do código do PR73.

## Atendimento pela conexão — autorização de 1/10/2026

Diego autorizou incluir consultas e pedidos de todos os seis imóveis no Beds24. Configuração `Inquiry and Requests = Import all` salva e relida após recarga em 102, 103, 303, 399 e Búzios; 403 já estava nessa opção e foi reconferido. Foram preservados mapeamentos e modo Limited. Consultas não equivalem a reservas confirmadas e não devem ocupar inventário por inferência. A configuração não comprova que todo histórico antigo foi importado; conferir conversas, anexos e vínculo da reserva antes de responder. Não ativar respondedor automático nem duplicar mensagens programadas.

A caixa de mensagens e um histórico de reserva do Airbnb foram acessados no Beds24. Leitura confirmada; envio pela conexão ainda não testado nesta rodada. Enquanto houver lacunas, consultar o inbox original Airbnb para garantir cobertura. WhatsApp continua no aplicativo/Web vinculado; Diego informou que ainda não cadastrou Meta. Esta mudança não liga o importador Beds24 → SCL do PR73 nem cria rotinas no painel.

O mapeamento do403 foi conferido e as reservas existentes reconciliadas pela função oficial de importação, preservando o cadastro atual. Novas reservas, alterações e cancelamentos são previstos pela conexão; o próximo evento real ainda precisa ser observado para validar o fluxo automático. Não repetir importação manual como agendamento nem atribuir a falha anterior à duplicata sem evidência.


## Decisões e verificação complementares — 1/10/2026

Os pisos de última hora devem valer no valor final da diária após todos os descontos, inclusive semanal: estúdios350/300 e303700/650 nas respectivas faixas. Taxas e limpeza não compensam diária abaixo do piso. Exemplo:393×0,85×0,90=300,645, inferior ao piso350. Não ativar combinação que viole o limite. Antecedência da noite e antecedência do check-in não são automaticamente equivalentes; a tradução nativa precisa preservar essa semântica.

Diego autorizou substituir no399 a promoção19%/14dias pela regra15%/25% e desligar Preços Inteligentes, se ativos. Na interfaceAPI não houve interruptor ativo desligado; origem dos19% não comprovada. Atualização desta mesma rodada: no399, a promoção antiga foi zerada e as faixas nativas15%/25% foram ativadas; ver estado verificado abaixo. Automação com piso final continua pendente, não concluída.

Envio de mensagem porBeds24 foi posteriormente confirmado na conversa originalAirbnb. Isso valida os envios observados, não cobertura integral do histórico nem todos os anexos.

Regras de limpeza, porteiros e chaves, incluindo alternativa comum103/399, estão em [PORTARIA-CHAVES-LIMPEZA.md](PORTARIA-CHAVES-LIMPEZA.md). Contatos reais permanecem fora deste documento; cadastro restrito na nuvem ainda pendente.


## Retirada do desconto semanal e contingência — decisão direta de 1/10/2026

Diego autorizou retirar o desconto automático de 10% para estadias de sete ou mais noites dos anúncios em que estiver configurado. Reservas existentes são preservadas. Desconto mensal e outros benefícios não estão revogados por essa decisão. Aplicação anúncio por anúncio em andamento; não confundir autorização com confirmação de propagação.

Se o Beds24 não conseguir impor sozinho piso/teto depois de todas as combinações, Diego autorizou ativar as regras de desconto mesmo assim e registrar como pendência a implementação de **verificação e correção diária automatizada**. Os limites continuam sendo a regra desejada; podem ocorrer desvios enquanto essa proteção não estiver implementada e testada. Esta decisão supera a orientação anterior de aguardar trava final para ativar, mas não comprova que a automação já foi ligada.

A rotina pendente deve comparar tarifa original, preço enviado, descontos aplicáveis e resultado final; corrigir sem acumular reduções e guardar histórico, fonte e motivo. Teto geral não limita tarifas explícitas de eventos autorizados; não inventar teto novo nem reduzir um evento por engano. Respeitar reservas/bloqueios e o responsável único pela escrita (Beds24 nesta rodada, futuro SCL somente após implementação/ativação). Falta definir e validar execução na nuvem e leitura do resultado nas OTAs; documentação não equivale a rotina funcionando.


## Estado verificado e pendência executável — 1/10/2026

- Desconto semanal10%: removido e relido noBeds24 nos seis imóveis; Update retornouSuccess em todos. Consulta de conteúdo retornado peloAirbnb confirmou ausência de regra7dias em399 eBúzios. A respostaSuccess dos demais não substitui uma conferência independente do conteúdo final.
-399: DailyPrice2 aplica−15% na antecedência3–7 eDailyPrice3 aplica−25% na antecedência0–2, ambas vinculadas diretamente àDailyPrice1 do próprio imóvel. Airbnb habilitado, reservas existentes preservadas. Conteúdo retornado peloAirbnb confirma remoção da promoção antiga19%/14dias e do semanal; mensal15%/28dias mantido.
- PriceData do399 confirma que as faixas alteram as noites correspondentes. Isso confirma o cálculo preparado para exportação, não todas as cotações finais de hóspedes.
- A proteção final de piso/teto **não está implementada nem agendada**. Há desvios observados; ativação permitida pela contingência expressa deDiego. Não apresentar toda a precificação como concluída. Essa limitação permaneceu após a extensão das faixas aos demais imóveis descrita abaixo.

### Rotina diária a implementar

Responsável funcional: motor de preços doSCL, com execução na nuvem quando implementado; até lá, item pendente. Não criar um segundo escritor concorrente com oBeds24.

1. Ler a referência original persistida e as regras vigentes por imóvel/data, tarifa preparada noBeds24, descontos por duração/antecedência ainda vigentes nasOTAs e disponibilidade. Não assumir que salvar noBeds24 prova preço final noAirbnb.
2. Avaliar hoje, amanhã e próximos sete dias, além de alterações de regras que possam afetar o horizonte configurado. Executar no fusoAmerica/Sao_Paulo. Usar somente diárias livres; não alterar valores de reservas existentes nem liberar bloqueios.
3. Recalcular o resultado final após descontos, respeitando os pisos de cada faixa. Detectar referências ausentes, percentuais sobrepostos e regras conflitantes. Não reaplicar25% sobre preço já reduzido15%.
4. Validar teto vigente com fonte identificada; preservar exceções expressas de eventos. Se um limite ou o tratamento do evento estiver indefinido, registrar e avisar em vez de inventar uma correção.
5. Corrigir na fonte autorizada e de forma persistente: uma correção pontual que a regra nativa sobrescreverá de novo não basta. Se a combinação não puder ser representada no provedor, registrar conflito e a alternativa técnica necessária.
6. Reconsultar o destino e guardar antes/depois, regra, horário, tentativa e resultado em registro privado. Repetir uma execução não pode acumular cortes ou produzir mensagens duplicadas. AlertarDiego sobre falha, conflito sem solução ou desvio persistente; não afirmar conformidade quando a leitura falhar.

### Critérios para considerar a rotina pronta

Testar: passagemD−3→D−2; desconto de duração combinado; referência já reduzida; evento acima do teto geral autorizado; arredondamento; reserva/bloqueio; mudança concorrente; falha deAPI e repetição após interrupção. Exigir teste controlado, correção verificada na fonte e no destino, execução diária comprovada e histórico privado. Esta lista é uma pendência de implementação, não prova de testes executados.


## Extensão concluída aos demais imóveis — 1/10/2026

Por pedido direto deDiego, as faixas nativas de15% (D3–7) e25% (D0–2) também foram configuradas no102,103,303,403 eBúzios. O399 já estava configurado e não recebeu duplicatas. Cada par usa aDailyPrice1 do próprio imóvel, preservando as tarifas específicas de origem; não usa a base de outro imóvel nem acumula15% e25%. CanalAirbnb ativo, Direct/Agents desativados nas novas faixas, mínimo1 e máximo27.

Búzios recebeu os mesmos percentuais sobre suas próprias tarifas. A promoção antiga13%/14dias foi zerada, salva, relida e enviada comUpdateSuccess. Isso não transfere bases, multiplicadores de eventos ou limites dos estúdios para a casa.

Listas de regras reabertas confirmaram os dois percentuais e vínculo em cada imóvel. PriceData confirmou cálculo das faixas para envio aoAirbnb. O conteúdo retornado peloAirbnb confirmou ausência das promoções antigas de última hora e do semanal10% nos seis imóveis; mensal15%/28dias preservado. PriceData não equivale a verificação de todas as cotações finais de hóspedes.

A configuração solicitada está aplicada nos seis imóveis, mas **a proteção final e correção diária de piso/teto continuam pendentes**. Foram observadas diárias abaixo dos pisos nos apartamentos doLeblon; não foi feita correção automática nem criada tarefa de execução diária. A contingência autorizada continua explícita. Preservar os resultados e registros privados antes/depois; não declarar revisão ampla de nove meses concluída por ter configurado estas faixas.

Esta atualização está noPR74 e em cópia local conferida; main só receberá após merge humano. PR73 não foi alterado por esta configuração.
