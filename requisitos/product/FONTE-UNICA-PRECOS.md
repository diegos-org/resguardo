# Fonte única de preços (M3.11)

**Situação:** desenho do M3.11a escrito em 22/10/2026, na branch `claude/m3-11a-copia-importacao-precos`. O M3.11b ("só
disponibilidade") e o M3.11c ("pronto para ligar") ganham as seções deles quando forem feitos. Decisão de Diego e
condição dele: `ROADMAP.md`, "Decisões registradas", 22/10.

## 1. Objetivo

O SCL vira o lugar onde se mudam preço, mínimo de noites e regras de venda; o Beds24 só repassa às OTAs. Antes de o
SCL mandar qualquer preço, os preços de hoje entram no SCL **sem mudar nada nas OTAs**. Diego troca aos poucos, criando
eventos, feriadões e períodos, e a simulação mostra o efeito antes de ligar.

## 2. O que existe hoje (produção, 22/10, só contagens)

- Seis imóveis, 270 noites lidas do Beds24 cada (de 7/10/2026 a 3/7/2027). A última leitura é de 7/10; nenhuma
  noite sem preço, nenhum `override`. O preço mais comum cobre só cerca de 30% das noites:
  - junho e julho têm um preço só (a baixa);
  - dezembro a fevereiro, quase fixo (a alta, de 1,6 a 2,3 vezes a baixa, conforme o imóvel);
  - março a maio e outubro a novembro mudam quase toda noite (15 a 22 valores por mês), com sexta e sábado mais caros.
- Mínimos: 1, 2, 3 e 5 noites. Máximo: um valor só por imóvel.
- No SCL, nada configurado: sem `imoveis_detalhes` (sem preço base, pisos ou fonte), sem períodos, sem
  `calendario_regras` (sem eventos, feriados ou lista de envio).
- **Limites do motor (M3.7):**
  - um evento só sobe o preço (multiplicador de 100 a 1000 centésimos) e o arredondamento raramente bate com um preço
    digitado;
  - não há preço por dia da semana;
  - o período fixo vence tudo, inclusive eventos criados depois;
  - o máximo de noites é um só por imóvel.

  Copiar cada trecho como período daria de 110 a 150 períodos por imóvel e travaria as regras futuras.

## 3. Desenho do M3.11a

### 3.1 Cópia datada da leitura

- Tabela nova `beds24_calendario_copias`, só de inclusão (nenhum caminho do código altera ou apaga):
  - colunas: organização, imóvel, quarto, motivo, quem (ou o sistema), quando, a hora da leitura mais nova copiada, o
    número de noites, a assinatura e as noites (JSON: data, preço, mínimo, máximo, unidades livres, bloqueio);
  - motivos: `manual`, `antes_da_leitura`, `antes_da_simulacao`, `antes_do_envio`, `importacao`.
- **A assinatura** é um SHA-256 das noites normalizadas e do quarto. Se for igual à da última cópia do imóvel, nenhuma
  cópia nova é gravada (devolve a última).
- **Quando:**
  - antes de a importação do Beds24 (M3.3) apagar a leitura anterior de cada imóvel;
  - antes de a simulação ou o envio (M3.7) regravarem a leitura (as duas fases do envio);
  - ao aprovar uma importação (§3.5), com a leitura usada;
  - pelo botão "Guardar uma cópia agora".

  Sempre na mesma transação que regrava, com o imóvel sem noites lidas pulando a cópia.
- Dado de preço não é dado pessoal; mesmo assim, nada de hóspede entra na cópia.

### 3.2 Preço importado por noite

- Tabela nova `precos_importados`:
  - colunas: organização, imóvel, data, preço (centavos, maior que zero), mínimo de noites (ou nulo), a cópia de
    origem, quando e quem;
  - chave: organização, imóvel e data.
- **Vale só com a fonte "preços automáticos do SCL"** (M3.9). Com "digitados no cadastro" ou "definidos no Beds24",
  o motor ignora a camada, e a tela avisa.
- **Preço da noite**, nesta ordem:
  1. período com preço;
  2. maior multiplicador de evento ou feriadão × preço base;
  3. **preço importado**;
  4. preço base (com os limites do preço dinâmico).

  Importado não sofre os limites do preço dinâmico, como o período. A última hora e os pisos valem por cima dele,
  como valem por cima do preço base.
- **Mínimo da entrada:**
  - período com mínimo vence;
  - senão, o maior entre o mínimo importado (no lugar da "semana normal"), o mínimo do cadastro e os dos eventos ou
    feriadões;
  - as sobras e a regra de 6/10 continuam iguais.
- **Fonte no plano:** "importado". Motivo: "Preço importado do Beds24 em {data}". No mínimo: "Mínimo importado do
  Beds24".
- **Resultado:** o que Diego criar no SCL passa por cima do preço importado naquelas noites, e o resto fica igual ao
  Beds24.

### 3.3 Proposta (função pura)

- **Entra:**
  - as noites lidas do imóvel, de hoje ao fim da leitura, só do quarto vinculado agora;
  - o cadastro atual;
  - as regras do calendário;
  - hoje.
- **Sai:**
  - **preço base proposto:** o preço que mais aparece entre os 25% de noites mais baratas (empate: o menor). Vale onde
    não houver preço importado, e é a base dos eventos;
  - **estadia máxima proposta:** a que mais aparece, com aviso se houver mais de uma;
  - **as noites a importar:** toda noite com preço, com o preço e o mínimo do Beds24. Noite sem preço não entra e vira
    aviso: "Sem preço no Beds24: o SCL usaria o preço base";
  - **sugestões de temporada, só texto, nada é criado sozinho:**
    - quando: trecho de 14 noites ou mais com o mesmo preço acima da base, em que um multiplicador inteiro de
      centésimos reproduz o preço exato;
    - texto: "De {início} a {fim}, o preço é {m}× a base: dá para criar um evento depois, em Configurações → Calendário
      e preços";
  - **resumo por mês:** noites, menor e maior preço e mínimos;
  - **a assinatura da leitura usada** (a mesma da §3.1).

### 3.4 Tela de revisão

- **Rota:** Configurações → Calendário e preços → "Importar preços do Beds24"
  (`/painel/configuracoes/calendario/importar`). Só com `configuracao:editar`.
- **Lista,** por imóvel:
  - código;
  - fonte de preços;
  - última leitura ("há N horas");
  - o que já foi importado ("N noites, de {d} a {d}, em {d} por {quem}", ou "Nada importado");
  - última cópia;
  - o link "Revisar".
- **Revisão** (`/painel/configuracoes/calendario/importar/[id]`), em textos curtos:
  - **Topo:** fonte, leitura e quarto, mais os avisos de bloqueio:
    - fonte diferente de SCL;
    - sem vínculo;
    - leitura vencida (pela validade de Configurações → Calendário e preços, "site", em horas): "A leitura do Beds24 tem
      mais de {n} horas. Leia de novo em Configurações → Integrações → Importar agora, e volte aqui.";
  - **Proposta:**
    - o preço base (proposto e atual, com a caixa "Usar como preço base", marcada se não houver um);
    - a estadia máxima (a mesma ideia);
    - as noites a importar;
    - as sugestões;
  - **Conferência:**
    - "Depois de aprovar, o SCL calcularia igual ao Beds24 em {x} de {y} noites." É o motor de verdade, com o
      cadastro proposto, a camada nova e as regras, pisos, reservas e bloqueios de hoje, comparado com a leitura;
    - em cada diferença, o motivo do plano (piso de última hora, período ou evento que vale por cima, mínimo de sobra);
  - **Por mês:** num `<details>`, noite a noite: data, preço no Beds24, preço do SCL, mínimo no Beds24, mínimo do SCL
    e diferença;
  - **Ações:**
    - "Aprovar e importar" (`BotaoConfirmar`);
    - "Guardar uma cópia agora";
    - depois de importar: "Desfazer a importação" (`BotaoConfirmar`).
- A tela de configuração do calendário ganha o link. Na ficha do imóvel (Preço e taxas) entra uma linha: "Preços
  importados do Beds24: {n} noites, até {d}. Eventos, feriadões e períodos valem por cima." com o link.
- A prévia do calendário (M3.7a) mostra o motivo novo sem mudança de tela.

### 3.5 Aprovar

Ação no servidor, negada por padrão.

1. **Permissões:** sessão do painel, `configuracao:editar` e `imovel:editar`, o imóvel da organização.
2. **Fonte:** precisa ser `scl`. Recusa: "A importação vale para preços automáticos do SCL. Mude a fonte na ficha do
   imóvel."
3. **Travas:** `esperarEnvioBeds24` (a trava `beds24:<org>`, na ordem única do M8.3), depois o imóvel travado.
4. **Releitura:** relê as noites e a hora da leitura com o imóvel travado.
   - Leitura vencida: recusa.
   - Assinatura diferente da revisada: "A leitura mudou desde que você abriu a revisão. Confira de novo."
5. **Cópia:** motivo `importacao`.
6. **Cadastro:** grava o preço base e a estadia máxima marcados. Cria `imoveis_detalhes` se não houver, pelo caminho
   do cadastro, com a auditoria dele.
7. **Camada:** apaga do imóvel só os importados de hoje em diante e grava as noites novas de hoje em diante. Os de
   antes de hoje ficam: a mudança vale daquela data para frente.
8. **Auditoria:**
   - ação `imovel.precos.importar`;
   - mudanças "preços importados do Beds24" (antes e depois, em número de noites e intervalo) e a cópia;
   - sem dado pessoal.

Repetir a aprovação com a mesma leitura dá o mesmo resultado.

### 3.6 Desfazer

Mesmas permissões e travas. Apaga os importados de hoje em diante, mantém as cópias e audita
`imovel.precos.desfazer_importacao`. O imóvel volta ao preço base e às regras.

### 3.7 Onde o preço importado aparece

O motor tem um caminho só (`planejarImovel`). Por ele, a camada vale para a prévia, a simulação e o envio do M3.7, e
para o site e a cotação (M7.2, M8.1). Nada que o hóspede lê cita o Beds24; o texto de motivo só aparece no painel.

## 4. Registro de desvios em relação ao ROADMAP de 22/10

- **Temporadas e eventos:**
  - **antes:** o M3.11a dizia "preço base, temporadas e eventos tirados dos trechos que fogem do preço base, e período
    fixo onde nada se encaixa";
  - **agora:** a camada "preço importado" e o preço base proposto; temporadas e eventos só como sugestão, nada é
    criado sozinho;
  - **motivo:** os limites do motor (§2). O período vence os eventos futuros, e seriam até 150 por imóvel. Evento não
    desconta e arredonda;
  - **objetivo:** cumprir a condição de Diego, nada mudar nas OTAs ao ligar, e deixar as regras dele valerem por cima,
    aos poucos.

### Ajustes da implementação (22/10), em relação às §3.1 a §3.4

- **Cópia por quarto:** a comparação é com a última cópia do mesmo imóvel e quarto. Imóvel com leitura de dois quartos
  guarda uma cópia de cada.
- **Tabelas:**
  - a coluna `ordem` (sequência) decide qual é a última cópia, mesmo com a mesma hora;
  - o quarto pode ficar vazio;
  - todo preço importado aponta para a cópia de onde veio;
  - o banco recusa cópia sem noites.
- **Leitura vencida:** basta uma noite usada ter sido lida fora da validade, não só a mais nova.
- **Proposta, casos de borda (sempre com aviso):**
  - preço zero não entra;
  - mínimo fora de 1 a 365 entra sem o mínimo, e vale o do SCL;
  - máximo fora de 1 a 365 fica fora da proposta;
  - empate na estadia máxima fica com a menor;
  - máximo proposto menor que o mínimo do cadastro;
  - noite sem preço não traz o mínimo.
- **Conferência:**
  - compara preço, mínimo e máximo, com o motivo da linha do plano;
  - sem conferência quando a fonte não é SCL;
  - as caixas "Usar como…" vêm marcadas quando o cadastro não tem o valor.
- **Entrada da proposta:** o cadastro (o mínimo entra só para o aviso) e, das regras, só a estadia máxima de hoje.

## 5. Testes do M3.11a

Com PGlite e a versão falsa do Beds24, sem rede.

1. **Motor:**
   - o período vence o importado;
   - evento e feriadão vencem o importado;
   - o importado vence a base;
   - noite sem importado usa a base;
   - o importado não sofre os limites do preço dinâmico;
   - última hora e pisos por cima do importado (as duas formas, "beds24" e "scl").
2. **Motor, mínimo:**
   - o importado substitui a semana normal;
   - o cadastro e os eventos maiores vencem;
   - o período com mínimo vence;
   - sobras e regra de 6/10 iguais.
3. **Motor, fontes:** com "manual" e "beds24", a camada é ignorada.
4. **`planejarImovel`:**
   - carrega a camada do intervalo;
   - a substituição da revisão não grava nada;
   - o site cota com o importado.
5. **Proposta:**
   - preço base pelo quartil (empate no menor);
   - máximo mais comum, com aviso;
   - noite sem preço;
   - só o quarto vinculado;
   - noites antes de hoje fora;
   - sugestões só quando o multiplicador reproduz exato e o trecho tem 14 noites ou mais;
   - assinatura estável e sensível a cada campo.
6. **Cópias:**
   - deduplicação;
   - a importação do M3.3 guarda a leitura anterior antes de apagar;
   - simulação e envio guardam antes de regravar;
   - nenhuma rota altera ou apaga cópia;
   - imóvel sem noites não gera cópia.
7. **Aprovar:**
   - operação recusada;
   - sem `imovel:editar`, recusada;
   - outra organização recusada;
   - fonte diferente de SCL recusada;
   - leitura vencida recusada;
   - assinatura diferente recusada;
   - grava a cópia, o cadastro marcado, a camada de hoje em diante e a auditoria;
   - os de antes de hoje ficam;
   - repetir dá o mesmo;
   - envio em curso: espera ou recusa como a troca da fonte.
8. **Desfazer:** só de hoje em diante, cópias mantidas, auditado; com outra organização recusado.
9. **Conferência na tela:** igual ao Beds24 depois de aprovar, numa leitura sem pisos; a diferença por piso aparece com
   o motivo.
10. **Telas:**
    - lista e revisão para o admin;
    - operação sem acesso;
    - os avisos de bloqueio;
    - a linha na ficha;
    - a prévia mostra o motivo.
11. **Privacidade:** as tabelas novas na varredura de dados pessoais.

## 6. Limites e o que fica para depois

- **Importar de uma cópia antiga:** fica para depois. A cópia guarda; a importação usa a leitura atual.
- **Fonte "digitados no cadastro":** sem camada. Fica para quando o marketplace pedir.
- **Disponibilidade:** a conferência das noites fechadas é o M3.11c; a reserva direta com o aviso "feche as datas" é o
  M3.11b.
- **Máximo de noites:** continua um só por imóvel.
- **Tamanho das cópias:**
  - a leitura muda todo dia, porque a janela anda;
  - por isso, sai perto de uma cópia por imóvel a cada leitura, simulação ou envio, com uns 25 KB cada;
  - se crescer demais, decidir com Diego quanto tempo guardar.
- **Na produção:** a leitura de 7/10 está vencida. Antes de revisar, Diego toca em "Importar agora" em Integrações, que
  só lê o Beds24.
