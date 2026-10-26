# "Só disponibilidade" por imóvel (M3.11b): desenho

Parte 2 da fonte única de preços (M3.11, `FONTE-UNICA-PRECOS.md`). Escrito em 26/10/2026 pelo Claude, a partir do ROADMAP
de 22/10 e da prioridade de Diego em 26/10 (mapeamento, sincronização e motor próprio primeiro). Um PR.

## 1. Objetivo e o que fica de fora

- **Objetivo:** uma quarta fonte de preços por imóvel, "só disponibilidade": o envio do calendário (M3.7) manda ao Beds24
  só os bloqueios feitos no SCL (fechar e reabrir). Preço, mínimo e máximo ficam onde o proprietário quiser (no Beds24 ou
  na ferramenta dele); o SCL só lê. Serve ao marketplace e a casos especiais.
- **Também:** a reserva direta confirmada no SCL (WhatsApp, indicação), que não nasce no Beds24, passa a ter o aviso "feche
  as datas no Beds24 como bloqueio", em qualquer fonte de preços, com a marca manual do M8.3b.
- **Fora:** fechar essas noites sozinho no envio (decisão pendente de Diego, ROADMAP "Pendências de decisão"); criar
  reserva no Beds24 por este caminho (a do site é o M8.3; as das OTAs chegam por elas); a lista "pronto para ligar" (M3.11c).
- Nada aqui escreve no Beds24 fora do envio já existente, atrás de `BEDS24_ESCRITA=ligada`.

## 2. A fonte nova

- Valor `so_disponibilidade` em `FONTES_PRECOS` (`imoveis/fonte-precos.ts`). A coluna `imoveis_detalhes.fonte_precos` é
  texto sem CHECK: **sem migração** para isto.
- **Painel:** nome "Só disponibilidade: o SCL envia só os bloqueios; preço e regras de venda ficam no Beds24". Explicação:
  "O SCL manda ao Beds24 só o que fechou e reabriu no SCL. Preço, estadia mínima e máxima ficam no Beds24 (pelo proprietário
  ou pela ferramenta dele); o SCL só lê. O site e a cotação vendem pelo preço e pelas regras lidas do Beds24; noite sem
  leitura recente fica indisponível para venda, nunca com um palpite."
- **Portal (M5.9: nunca citar o Beds24):** valor próprio em `FontePrecosPortal`, `so_disponibilidade`: nome "Só a
  disponibilidade pelo nosso sistema"; explicação: "Nosso sistema só fecha e reabre datas nos canais. Preço, estadia mínima
  e máxima ficam com você ou com a sua ferramenta de preços. O site vende pelo preço e pelas regras que você definiu;
  noite sem leitura recente fica indisponível, nunca com um palpite."
- A troca para esta fonte, e dela para outra, segue a regra do M3.9: espera a trava do Beds24 (`gravarNaOrdemDasTravas`).

## 3. Motor (`calendario/motor.ts`)

Com `fontePrecos === "so_disponibilidade"`:

- **Preço:** como na fonte "beds24": `precoEnviar = null`, `precoReferencia = null`, `fontePreco = "beds24"`,
  `precoFinalEsperado` = o lido do Beds24; motivo "Preço definido no Beds24 (o SCL só lê)". Sem última hora, sem pisos,
  sem a camada importada. Um só ponto decide "o preço é lido do Beds24": `precoLidoDoBeds24(fonte)` =
  `fonte === "beds24" || fonte === "so_disponibilidade"`, usado pelo motor, pelo site e pelas telas.
- **Mínimo:** `minimoEnviar = null`. `minimoRegra` e `livresSeguidas` continuam calculados (só para informação); o motivo
  do mínimo diz "mínimo definido no Beds24 (o SCL só lê)".
- **Máximo:** `maximoEnviar` passa a `number | null` em `LinhaPlano`; nulo só nesta fonte. A carga (`cargaDe`) omite o
  máximo quando nulo; a comparação com a leitura e com o último envio ignora o campo ausente, como já faz com preço e
  mínimo; `nadaAEnviar` considera o máximo; a `regra` escreve "máx. —". O aviso "mínimo acima do máximo" não se aplica.
- **Bloqueios:** iguais a hoje (fechar com "blackout", devolver a restrição anterior ao reabrir, posse encerrada). É a única
  coisa que vai ao Beds24 nesta fonte.
- **Avisos:** sem "Preço não cadastrado no SCL"; mantém "Sem preço lido do Beds24 para esta noite: fica indisponível para
  venda no site até a próxima leitura" e todos os avisos de disponibilidade (unidades livres com reserva no SCL,
  overbooking, blackout externo, 0 unidades sem reserva).
- **Ação da noite:** "sem_dados" quando não há bloqueio a enviar ou reabrir; "enviar" ou "igual" só pelo bloqueio.
- Registro (26/10, revisão 1): na `regra` de cada noite (gravada no histórico do envio e cortada em 300 caracteres) o
  motivo do mínimo nesta fonte é curto, "mín. — (definido no Beds24; o SCL só lê)"; a regra do SCL inteira fica em
  `motivoMinimo`, para a prévia. Antes, a `regra` levava o motivo completo ("… regra do SCL só para informação: …") e,
  com evento ou feriadão, o corte apagava o texto do bloqueio, a única coisa que vai nesta fonte. Objetivo: o histórico
  mostrar o que foi enviado.

## 4. Envio (`calendario/envio.ts`, M3.7)

- As faixas de envio levam só o bloqueio; `beds24_envio_noites` e `beds24_calendario_enviado` recebem preço, mínimo e
  máximo nulos (as colunas já aceitam nulo: sem migração).
- A conferência da leitura depois do envio (`igualAoLido`) ignora o máximo quando nulo, como já ignora preço e mínimo.
- A troca da fonte entre o plano e a escrita continua recusando a escrita do imóvel ("Fonte de preços alterada").
- Configurações → Calendário e preços, lista de envio: rótulo "(só disponibilidade: o SCL envia só os bloqueios do SCL)".
- Prévia (M3.7a): a frase da fonte diz que o SCL envia só os bloqueios; as colunas de preço, mínimo e máximo do SCL mostram
  "—" e a do Beds24 mostra o lido. A linha "Regras em vigor" diz que mínimo e máximo são definidos no Beds24 (a regra do
  SCL fica entre parênteses, só para informação) e, na tabela "Noites do envio escolhido", campo não enviado (nulo) mostra
  "—" em vez de "não informado" (revisão 1, 26/10).
- Registro (26/10, revisão 1): o aviso por imóvel "N noite(s) sem preço no SCL; o preço dessas noites não é enviado" deixa
  de sair quando o preço é lido do Beds24 (`precoLidoDoBeds24`: fontes "beds24" e "só disponibilidade"). Antes saía em
  todo envio da fonte "beds24" (M3.9), porque nela `precoReferencia` é sempre nulo. Motivo: nessas fontes o SCL não tem
  preço por regra, e o aviso que importa é o da noite sem leitura ("Sem preço lido do Beds24"), no plano. Teste na
  describe da fonte "beds24" em `calendario/envio.test.ts`.
- Registro (26/10, revisão 1): o aviso por imóvel "N noite(s) sem leitura anterior do Beds24; serão enviadas e conferidas
  pela releitura" passa a dizer quantas dessas noites o plano de fato envia ("M delas serão enviadas…" ou "nenhuma delas
  tem algo a enviar"). Antes contava toda noite sem leitura como "a enviar", o que nesta fonte é falso (noite sem leitura
  e sem bloqueio do SCL é "sem_dados") e, em qualquer fonte, ignorava a noite igual ao último envio confirmado.

## 5. Site e cotação (`site/disponibilidade.ts`, M7.2, M8.1)

- **Preço:** o lido do Beds24, como na fonte "beds24"; sem leitura atual (validade de Configurações → Calendário e preços,
  "site"), a noite fica "a confirmar", sem valor e sem segurar datas.
- **Mínimo e máximo da estadia:** os lidos do Beds24 na noite de entrada, quando a leitura é atual (a regra de venda é do
  proprietário). Sem leitura atual, a noite já não vende pelo preço. As sobras e a regra 6/10 do SCL não valem aqui.
  - Registro: na fonte "beds24" (M3.9) os mínimos continuam do SCL, porque o SCL os envia; nesta fonte o SCL não envia
    mínimo, então vale o lido. Motivo: uma regra, um lugar; a regra de venda fica com o proprietário.
  - Mínimo ou máximo nulo na leitura atual é "sem restrição": na API do Beds24, minStay e maxStay valem 1 ou mais, ou
    nulo quando não há restrição; 1 noite vende. É diferente da restrição de entrada/saída, em que "não informada" nunca
    vira disponível, porque ali o nulo é ausência de dado sobre a data e aqui é o próprio valor "sem mínimo". (Registro
    26/10, revisão 1; teste em `site/disponibilidade.test.ts`.)
- O desconto do site (M12.1) vale por cima, como nas outras fontes. Nenhum texto do site cita o Beds24.

## 6. Portal do proprietário (M12.4)

- `fontePrecosDoPortal`: `so_disponibilidade` → `so_disponibilidade` (nome e explicação da §2). O portal esconde os
  campos de preço como faz com "ferramenta".
- Períodos do portal: recusados nesta fonte, com a frase "Com só disponibilidade, preço e estadia mínima ficam com você ou
  com a sua ferramenta: aqui você só fecha e reabre datas." (avisar em vez de gravar algo que não seria enviado).
- Bloqueio de uso próprio (M5.5) continua: é o que esta fonte envia.
- Registro (26/10, revisão 1): os campos "Estadia mínima" e "Estadia máxima" do portal ficam só de leitura nesta fonte,
  com a nota "definida por você ou pela sua ferramenta de preços" (como o preço). Antes continuavam editáveis, mas não
  valiam em lugar nenhum (o site lê os dos canais e o envio não os manda): o proprietário digitaria um mínimo sem efeito.
  Avisar em vez de supor. Decisão de produto aberta para Diego: manter assim ou esconder os dois campos.

## 7. Painel

- Ficha do imóvel (`FormDetalhes`): a opção nova com a explicação; a linha dos preços importados (M3.11a) já diz que só
  valem com preços automáticos do SCL.
- Anúncios (`QuadroAnuncios`, `NOTAS_PRECO_SITE`): nota da fonte nova.
- Importação (M3.11a): o bloqueio "fonte" já recusa qualquer fonte diferente de "scl".
- Prévia e lista de envio: §4.

## 8. Reserva direta confirmada no SCL

- **Quem:** reserva com estado "confirmada", origem "direta" ou "outro", sem `beds24Id`, fonte diferente de "beds24" e de
  "site" (o pedido do site tem o M8.3b; a alteração do site, idem), com saída de hoje em diante. Em qualquer fonte de preços.
- **Aviso:** no Início, junto das tarefas das OTAs (`tarefasDasOtas`, caso novo `direta`), e no bloco "No Beds24" da ficha:
  "Reserva direta {código}: feche as datas de {entrada} a {saída} no Beds24 como bloqueio (não crie reserva lá)." Só o
  código SCL e as datas; nenhum valor nem dado do hóspede. O papel operação vê, como no M8.3b.
- **Marcas manuais:** "Datas fechadas nas OTAs" (quem e quando) tira o aviso; se a reserva marcada for cancelada, entra
  "Reserva direta {código} cancelada: reabra as datas de {entrada} a {saída} no Beds24", até a marca "Datas reabertas nas
  OTAs". As duas auditadas (`reserva.otas.datas_fechadas`, `reserva.otas.datas_reabertas`) e sob a trava da reserva.
- **Onde guardar:** tabela nova `reservas_diretas_otas` (migração 0076): `reserva_id` (chave, FK), `organizacao_id`,
  `fechadas_em`, `fechadas_por`, `reabertas_em`, `reabertas_por`. Não reaproveitar `beds24_reservas_site`: o envio do M8.3c
  lê aquela tabela para decidir o que escrever no Beds24, e uma reserva direta nunca pode entrar nessa fila.
- O envio do calendário não fecha essas noites sozinho (pendência de Diego). Nada escreve no Beds24.
- Registro (26/10, revisão 1), desvios da implementação em relação ao texto acima:
  - **Auditoria:** reutiliza os eventos `beds24.reserva.ota_fechada` e `beds24.reserva.ota_reaberta` (os mesmos da marca
    da reserva do site, D3 do M8.3b) em vez de `reserva.otas.datas_fechadas` e `reserva.otas.datas_reabertas`. Motivo: um
    ato humano, um nome; o histórico da reserva (`HistoricoAlteracoes`) já tem rótulo para eles. Objetivo: uma regra, um
    lugar.
  - **Texto da reabertura:** "Reserva direta {código} cancelada: reabra as datas de {entrada} a {saída} no Beds24 (mude o
    bloqueio para Cancelado; não apague)." A regra de sempre: nunca apagar.
  - **Travas:** a marca da direta trava só a reserva (`for no key update`) e a linha das marcas dela (`for update`); não
    toma a trava `beds24:<org>` nem a do imóvel, porque não ocupa noites nem toca no que o envio lê. A marca da reserva
    do site continua com as travas do M8.3b.
  - **Ficha:** o bloco "No Beds24" da reserva direta aparece sempre, com o aviso de que o sistema nunca a cria no Beds24;
    sem tarefa (já marcada, ou sem saída de hoje em diante), diz "Nada a fazer à mão nas OTAs para esta reserva agora."
  - **Imóvel sem vínculo com o Beds24** recebe a mesma tarefa, como a paga e a D3 do M8.3b. Se houver imóvel fora do
    Beds24, decidir num item seguinte se a tarefa exige vínculo (mesma regra para as três).
  - **Limite (pendência de Diego):** reserva direta com as datas alteradas depois da marca "Datas fechadas nas OTAs": a
    marca continua valendo, nenhuma tarefa aparece e o bloqueio no Beds24 fica com as datas antigas. Opções para um item
    seguinte: um caso `direta_alterada` ("mude as datas do bloqueio para X a Y") ou zerar a marca quando as datas de uma
    direta marcada mudam.

## 9. Testes

Com PGlite e a versão falsa do Beds24, sem rede; dados fictícios.

1. **Motor:** nesta fonte, preço, mínimo e máximo não vão; o preço esperado é o lido; o bloqueio do SCL fecha e reabre
   como hoje; sem bloqueio, "sem_dados"; sem leitura, o aviso do preço; nenhum aviso "preço não cadastrado"; a camada
   importada é ignorada; `regra` com "máx. —".
2. **Envio:** carga só com bloqueio; registros com preço, mínimo e máximo nulos; releitura confere só o bloqueio; a troca
   da fonte durante o envio recusa a escrita; a lista de envio mostra o rótulo.
3. **Site e cotação:** preço, mínimo e máximo lidos do Beds24; sem leitura atual, "a confirmar"; sobras do SCL não valem
   (reserva logo depois da entrada não rebaixa o mínimo lido; com a fonte scl a mesma sobra vale); mínimo e máximo nulos
   na leitura = sem restrição; desconto do site por cima; nenhum texto cita o Beds24.
4. **Portal:** nome e explicação sem Beds24; campos de preço escondidos; período recusado com a frase.
5. **Telas:** a opção na ficha; a nota em Anúncios; a prévia com "—" e a frase; a importação recusa pela fonte.
6. **Reserva direta:** o aviso no Início e na ficha; a marca tira o aviso; cancelada depois da marca pede reabrir; reserva
   do site, de OTA ou com `beds24Id` não entra; operação vê sem valores; outra organização não vê; auditoria; migração 0076
   idempotente; a tabela nova na varredura de dados pessoais.

## 10. Limites

- Importar de uma cópia antiga, lista "pronto" e ativação: M3.11c e item 18 das ações de Diego.
- Mínimo e máximo lidos do Beds24 valem para o site só nesta fonte; a fonte "beds24" continua como no M3.9.
- Depois do deploy, toda reserva direta já confirmada com saída de hoje em diante (origem "direta" ou "outro", inclusive
  as da planilha, fonte "csv") aparece no Início como "feche as datas" até a equipe marcar, uma vez só, mesmo as já
  bloqueadas no Beds24: nada nasce marcado sozinho. Se Diego não quiser as da planilha, é um ajuste nas listas de
  `beds24/reservas-site-regras.ts` (`ORIGENS_RESERVA_DIRETA`, `FONTES_FORA_DA_RESERVA_DIRETA`).
