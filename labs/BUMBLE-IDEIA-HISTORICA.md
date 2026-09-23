# Fonte recuperada do PR5

Trecho preservado do commit 0ff4fe1dbc63f49529817d61209eed1ec688337f. Ideia histórica, sem implementação ou autorização de ação em canais por esta recuperação. Não compete com a recuperação prioritária de SCL e SongKeep.

## LAB — Bumble Helper / “Bambu HR”

### Hipótese
Criar um assistente pessoal privado para reduzir o trabalho repetitivo e ruim de apps de relacionamento, sem substituir Diego nas conversas que realmente importam.

O sistema aprende preferências declaradas e exemplos visuais, entende padrões de atração e rejeição difíceis de traduzir em palavras, aplica o estilo de humor/criatividade de Diego nas primeiras interações e faz **handoff cedo** quando encontra uma conversa com potencial real.

### Entrada de preferências
O perfil do assistente pode combinar:
- preferências explícitas;
- coisas que Diego não quer;
- exemplos positivos/negativos;
- fotos de referência para padrões visuais difíceis de verbalizar;
- tom de conversa;
- nível de humor;
- criatividade;
- assuntos que funcionam;
- assuntos que devem ser evitados;
- sinais de compatibilidade/incompatibilidade;
- regras de segurança e limites pessoais.

A imagem funciona como exemplo contextual, não como desculpa para inferir atributos sensíveis ou fazer avaliações degradantes sobre pessoas.

### Fluxo desejado
1. Assistente filtra perfis segundo preferências aprovadas.
2. Quando houver match/conversa, faz apenas as primeiras trocas curtas.
3. O objetivo não é manter relacionamento em nome de Diego; é eliminar conversa morta e identificar sinais reais de reciprocidade.
4. Quando a conversa atingir um limiar de interesse, interrompe a autonomia e entrega para Diego com contexto compacto.
5. Exemplo de alerta:
   - “Potencial real. Já há reciprocidade e caminho natural para convite. Assume daqui.”
6. Diego continua a conversa pessoalmente.

### Regra de identidade
Não construir um agente que finja indefinidamente ser Diego.

A proposta é **pré-triagem + aquecimento curto + handoff humano**, com histórico claro do que foi enviado. O ponto valioso é poupar atrito, não terceirizar a relação.

### Aprendizado
O sistema pode registrar:
- perfis que Diego aprovou/rejeitou;
- diferenças entre previsão do assistente e decisão real;
- aberturas aprovadas;
- respostas que funcionaram;
- intensidade de humor apropriada;
- momento correto de fazer handoff.

Preferências aprendidas só viram regra estável depois de evidência suficiente ou aprovação explícita de Diego.

### Integração futura
O inbox unificado pessoal/operacional já é uma frente separada; **não criar outro inbox para este Lab**.

Se o hub de comunicação suportar Bumble no futuro, o Helper pode aparecer como mais um agente/canal dentro dele, entregando apenas conversas qualificadas para Diego.

### Não fazer agora
- não abrir nova frente enquanto Café Aguado / Disco 4 e SCL 2.0 estiverem exigindo foco;
- não construir automação de login/browser frágil como fundação sem necessidade;
- não guardar material íntimo desnecessário;
- não coletar mais dados do que o necessário;
- não transformar ranking de pessoas em pontuação “objetiva”;
- não conversar longamente em nome de Diego.

### Gatilho para retomar
Retomar quando:
- o inbox/hub pessoal já tiver arquitetura utilizável ou um conector oficial permitir integração razoável;
- Diego continuar achando útil a ideia depois da empolgação inicial;
- houver tempo para um protótipo privado sem sequestrar música ou SCL.

### Status
**Ideia embrionária preservada.**
Boa o suficiente para não esquecer; cedo demais para virar projeto.
