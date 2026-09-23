# SCL 2.0 — Labs / Roadmap

Este arquivo guarda ideias promissoras que **não são prioridade imediata**. Entrar aqui não significa que algo será implementado; significa apenas que vale preservar, investigar e amadurecer sem desviar o trabalho principal.

## LAB — WhatsApp como canal operacional e de atendimento

### Hipótese
Usar WhatsApp como canal de resposta rápida para hóspedes e, possivelmente, como canal complementar de coordenação interna entre Diego, Rivers, Lia e Sage.

### Por que pode valer a pena
- atendimento a hóspedes pode exigir resposta quase imediata;
- computer use abrindo WhatsApp periodicamente não é suficiente para incidentes urgentes;
- webhook/API permite receber eventos em tempo real;
- o canal pode complementar app interno e sistema web.

### Opção técnica em estudo
**Twilio + WhatsApp Business Platform**.

Twilio oferece envio/recebimento de mensagens WhatsApp e entrega mensagens recebidas ao sistema por webhook. Em produção, autenticação, assinatura dos webhooks, templates, janela de atendimento e regras da Meta precisam ser respeitadas.

### Princípio de arquitetura
Não transformar WhatsApp em nova fonte de verdade.

Preferência:
- sistema/banco = estado canônico;
- GitHub = código, decisões técnicas e histórico de construção;
- app interno = operação estruturada;
- WhatsApp = canal de entrada/saída rápida e alertas;
- mensagens relevantes devem poder ser refletidas no sistema.

Evitar manter quatro cópias independentes do mesmo estado. Duplicação só quando for útil para visibilidade e resiliência.

### Possíveis usos futuros
1. Hóspede relata problema urgente → webhook → triagem/agente → resposta ou escalonamento.
2. Alerta operacional urgente → WhatsApp para responsável.
3. Confirmações e notificações permitidas pelas regras da plataforma.
4. Canal interno de equipe/assistentes, caso identidade, roteamento e prevenção de loops estejam bem resolvidos.

### Salvaguardas mínimas antes de produção
- validação de assinatura de webhook;
- idempotência;
- registro de quem enviou/recebeu;
- separação entre mensagem de hóspede e mensagem interna;
- evitar PII desnecessária nos logs;
- política de retenção;
- fallback se WhatsApp/Twilio falhar;
- controle para impedir loops entre agentes;
- aprovação humana para ações sensíveis;
- nenhum segredo em repositório.

### Não fazer agora
- comprar número só para experimentar;
- depender de WhatsApp para estado canônico;
- construir integração antes de termos fluxo principal estável;
- substituir o app interno por WhatsApp.

### Gatilho para retomar
Retomar quando o SCL 2.0 tiver:
- base compartilhada e deploy de homologação;
- modelo mínimo de atendimento/reserva;
- necessidade real de resposta em tempo quase real.

---

## LAB — Preview / homologação contínua

Objetivo futuro: GitHub → Vercel → preview acessível no celular, com Neon para dados de homologação e Cloudflare para subdomínio de desenvolvimento.

Diego deve precisar apenas de aprovações/autenticações inevitáveis (2FA, domínio, contas). O restante deve ser automatizado e documentado.

---

## Regra dos Labs

Labs existem para guardar boas ideias sem sequestrar o roadmap principal.
Uma ideia sai de Labs quando:
1. resolve um problema real observado;
2. tem benefício claro;
3. custo/risco estão entendidos;
4. entra numa fatia pequena e executável.


---

## LAB — Split automático de pagamentos / repasses

Objetivo futuro: permitir que reservas diretas distribuam automaticamente valores entre empresa e proprietário, reduzindo conciliação manual.

Investigar:
- Mercado Pago e alternativas;
- split/subcontas;
- KYC;
- chargebacks;
- estornos;
- cancelamentos;
- taxas;
- regras fiscais/contratuais;
- reconciliação e auditoria.

Não implementar agora. Primeiro estabilizar reserva direta, pagamento, modelo financeiro e conciliação manual correta.


---

## LAB — Hub pessoal-operacional / “Finanças” evoluído

### Hipótese
O projeto originalmente estreito de “Finanças” pode ser o embrião de algo muito maior: um **hub pessoal-operacional** para organizar vida, projetos, dinheiro, arquivos, decisões e pendências.

Não é prioridade atual. Registrar para amadurecer sem abrir nova frente.

### O que esse produto poderia ser
Um sistema central que reúne:
- projetos;
- dinheiro;
- agenda;
- arquivos;
- decisões;
- referências;
- pendências;
- vida prática;
- memória de contexto;
- automações;
- acompanhamento de progresso.

Possíveis módulos:
- Sua Casa Leblon;
- Disco 4 / carreira musical;
- vida financeira;
- administrativo pessoal;
- documentos;
- tarefas;
- comunicação;
- arquivos e acervos.

A ideia não é criar “um Notion gigante”, e sim um sistema que entenda contexto, preserve histórico e ajude a coordenar trabalho real.

### Princípio
Labs não pode virar desculpa para adiar SCL 2.0 ou Disco 4.
Retomar quando houver espaço real e uma necessidade clara que justifique produto próprio.

---

## LAB — Workflow de lançamento musical

### Hipótese
Quando uma faixa estiver próxima de lançamento, a mesma lógica de coordenação pode organizar todo o pacote de lançamento sem exigir um aplicativo global novo.

Fluxo possível:
1. áudio/master;
2. capa;
3. vídeo/clipes;
4. material profissional de divulgação;
5. textos de release;
6. pitch para playlists/imprensa;
7. biografia/contexto da faixa;
8. formatos para redes sociais;
9. anúncios;
10. narrativa de lançamento;
11. calendário;
12. assets por plataforma.

### Regra de narrativa
A comunicação pode destacar os elementos mais interessantes da história real, mas não inventar personagem, trajetória ou fatos.
Boa narrativa ≠ ficção.

### Café Aguado às 8
Se a demo recuperada evoluir bem e virar próximo single, este workflow pode ser usado como primeiro caso de teste.

---

## Futuro dos Labs na AL Life

Enquanto SCL 2.0 está em construção, Labs pode ficar neste repo para ideias relacionadas ou próximas.

Quando houver massa crítica:
- separar Labs geral da AL Life em projeto/repositório próprio;
- manter no SCL apenas Labs diretamente ligados ao produto/empresa;
- projetos como Giro Temporada podem continuar próximos enquanto forem extensões naturais do ecossistema SCL.

### Filosofia
Os projetos podem evoluir em paralelo, mas foco aumenta quando um deles estiver perto de entrega.


---

## Carreira musical — documentação operacional a preservar

Quando a carreira musical ganhar projeto próprio, migrar estes itens para lá. Até então, ficam registrados no Labs geral.

### Mapa de palco / stage plot
Manter documentação pronta e fácil de exportar para contratação de shows.

Prever versões por formação:
- solo voz + violão;
- duo/trio, se houver;
- banda completa, quando aplicável.

Conteúdo:
- posição de músicos;
- instrumentos;
- entradas/canais;
- microfones/DI;
- retornos;
- energia;
- necessidades de palco;
- patch list;
- observações técnicas;
- contato responsável;
- versão/data.

Ideal futuro: gerar PDF técnico limpo + versão resumida para envio rápido.

### Contatos relevantes da carreira
Criar CRM simples e útil para:
- casas de show;
- festivais;
- produtores;
- bookers;
- estúdios;
- engenheiros/técnicos de áudio;
- músicos;
- assessoria/imprensa;
- rádios/playlists/canais;
- fotógrafos;
- videomakers;
- designers;
- selos/distribuição;
- fornecedores relevantes.

Para cada contato, quando possível:
- nome;
- empresa/local;
- função;
- cidade;
- contato;
- origem da relação;
- última conversa;
- contexto;
- próximos passos;
- grau de relevância;
- observações.

Não virar CRM burocrático: o objetivo é conseguir responder rapidamente “quem eu conheço que pode ajudar nisso?”.


---

## LAB — Logic Companion / interface musical determinística

### Insight central
O objetivo **não é automatizar o Logic com uma IA livre operando a DAW**.

O produto desejado é uma **interface própria, muito mais intuitiva e prazerosa**, que usa o Logic como motor de áudio por baixo e aplica diretamente parâmetros, presets e ações previamente definidos/testados.

Em outras palavras:
- Logic continua sendo engine;
- plugins bons continuam sendo processamento;
- o novo produto vira a camada de experiência;
- IA pode ajudar a sugerir/configurar, mas não precisa “fuçar” livremente na sessão.

### Tese
Trocar:
**“agente controla Logic e decide o que mexer”**

por:
**“humano escolhe uma intenção musical numa interface simples → sistema executa uma transformação determinística já conhecida”**.

Exemplos conceituais:
- Voz íntima
- Voz mais à frente
- Violão mais aberto
- Refrão cresce
- Menos brilho
- Mais cola
- Textura discreta
- Slap vocal
- Secar ambiência

Cada ação aponta para parâmetros previamente mapeados:
- plugin;
- parâmetro;
- valor/faixa;
- automação;
- bus/send;
- cadeia;
- preset;
- condição de aplicação.

### Vantagem
- previsibilidade;
- reversibilidade;
- menos erro;
- menos comportamento autônomo indesejado;
- interface pensada para músico, não engenheiro;
- preserva o poder do Logic sem exigir que Diego viva dentro da interface dele.

### Não é necessariamente uma DAW nova
A primeira versão deve ser tratada como **control surface / companion app do Logic**.
Só virar DAW própria se, no futuro, houver motivo concreto para substituir também o motor, timeline, áudio, edição e plugin hosting.

### Papel da IA
IA pode:
- explicar;
- recomendar ponto de partida;
- ajudar a mapear parâmetros;
- analisar áudio;
- criar/ajustar receitas;
- aprender preferências.

Mas a execução principal pode continuar determinística e auditável.

### Princípio de segurança criativa
Nenhuma ação invisível ou irreversível.
Toda transformação deve ser:
- explícita;
- previsível;
- comparável A/B;
- desfazível;
- documentada.

### Produto potencial
Este conceito pode absorver parte significativa dos antigos projetos de “automação do Logic” e talvez seja o núcleo do futuro super-estúdio, se a tese se provar boa.


---

## LAB — Voz na home pública

Hipótese:
Adicionar um widget pequeno e opcional na home/reserva com algo como:
**“Prefere tirar suas dúvidas por voz? Fale com a gente.”**

Objetivo:
- ajudar hóspede a escolher imóvel;
- tirar dúvidas do bairro;
- explicar diferenças entre apartamentos;
- responder por voz quando isso reduzir fricção.

Princípios:
- não abrir sozinho;
- não competir com busca/reserva;
- fácil de fechar;
- voz com identidade agradável, sem caricatura;
- piloto primeiro em homologação;
- medir uso, qualidade e conversão antes de manter.

ElevenLabs é candidato natural por já suportar agente de voz e widget.

---

## LAB — WhatsApp instantâneo com agente

### Nova preferência
Twilio deixa de ser a opção preferida neste momento.

Comparar prioritariamente:

### ElevenLabs + WhatsApp Business
Capacidades confirmadas:
- texto;
- voice notes;
- transcrição de áudio;
- resposta em áudio;
- mídia;
- chamadas inbound/outbound;
- integração por conta WhatsApp Business.

Limitações atuais relevantes:
- sem human handoff nativo ainda;
- sem suporte a WhatsApp Flows;
- número não pode estar simultaneamente ativo em outro provedor/app WhatsApp Business padrão no fluxo atual;
- Meta pode cobrar separadamente templates/chamadas, além do uso ElevenLabs.

### Meta Business Agent
Meta lançou Business Agent e Business Agent Platform em 2026 para atendimento personalizado em WhatsApp/Messenger.

Investigar:
- disponibilidade no Brasil;
- elegibilidade da conta SCL;
- custos;
- integração com sistemas próprios;
- memória/contexto;
- supervisão humana;
- ferramentas/webhooks;
- tratamento de áudio;
- limites e políticas.

### Papel futuro da Lia
Lia pode continuar como supervisora/QA/operadora de exceções, enquanto atendimento instantâneo fica com agente integrado em tempo real.

Não implementar por pressa.
Decidir depois de teste comparativo em homologação.

---

## Histórico — transcrição de áudios da Lia

Em 20/09/2026 Diego decidiu habilitar ElevenLabs para permitir que Lia transcreva áudios recebidos no WhatsApp e consiga tratar mensagens de voz operacionalmente.

Isso é ferramenta de trabalho da Lia, não arquitetura canônica do produto.
Registrar apenas como histórico operacional.


---

## Registro de decisão — Twilio / ElevenLabs / Meta

### Por que Twilio entrou
Twilio apareceu como solução natural para:
- receber WhatsApp por webhook;
- responder via API;
- permitir integração instantânea sem depender de computer use periódico.

### Por que deixou de ser preferência atual
Com o avanço das opções:
- ElevenLabs passou a oferecer integração direta com WhatsApp, voz, transcrição e agente conversacional;
- Meta Business Agent passou a merecer estudo como opção nativa do próprio ecossistema WhatsApp;
- Twilio adiciona uma camada intermediária que pode não ser necessária.

Conclusão atual:
- **Twilio não está descartado tecnicamente**;
- apenas deixou de ser primeira opção;
- reavaliar se surgir requisito que ElevenLabs/Meta não cubram melhor.

A razão desta nota é histórica: preservar por que uma solução entrou e por que saiu da preferência.

---

## LAB — ElevenLabs como ferramenta de apresentação de produto

Além de voz/atendimento, ElevenLabs pode ser útil para materiais de divulgação de produtos AL Life.

Possíveis usos:
- narração de vídeo de apresentação;
- demonstração guiada;
- vídeo comercial de Giro Temporada;
- onboarding;
- explicadores;
- voice-over para conteúdo social;
- versões multilíngues quando fizer sentido.

Hipótese:
Uma boa interface + boa voz + roteiro claro pode elevar bastante a percepção de produto, especialmente em materiais de venda e onboarding.

Não usar como ferramenta de “melhoria musical” por padrão; esse caso deve ser avaliado separadamente e não é sua força principal hoje.


---

## LAB — Coordenação por evento / webhook entre agentes

### Problema
As rodadas atuais duram poucos minutos. Checagem horária reduz ociosidade, mas ainda pode deixar até ~1h entre handoffs.

### Arquitetura candidata
1. agente termina e grava handoff no GitHub com próximo agente explícito;
2. GitHub emite webhook/evento;
3. coordenador mínimo deduplica por identificador do handoff;
4. tenta acionar a conversa/tarefa do próximo agente;
5. checagem horária permanece como fallback.

### Ponto conhecido
GitHub → webhook é simples.

### Gargalo real
Ainda não está comprovado que uma ferramenta externa possa acordar uma conversa existente específica de Rivers/Lia/Sage no ChatGPT/Work.

Sage relatou que seu ambiente Codex possui capacidade de enviar mensagem para outra tarefa, mas isso ainda não foi validado entre estes três contextos e não implica que um webhook externo possa chamar a mesma função.

### Caminho que NÃO deve virar infraestrutura
Automatizar navegador para:
- entrar na conta pessoal de Diego;
- usar sessão/cookies/2FA;
- enviar mensagens fingindo ser Diego.

Mesmo se tecnicamente possível, isso é:
- frágil;
- difícil de auditar;
- mistura identidade humana e agente;
- suscetível a mudanças de UI;
- arriscado para loops e autoria.

Só reconsiderar se existir mecanismo oficial/autorizado que preserve identidade do agente e trilha de auditoria.

### Prova de conceito recomendada
- handoff fictício;
- um único emissor;
- uma única conversa destino;
- uma única mensagem;
- sem mudar estado real do projeto;
- confirmar deduplicação e ausência de loop.

Se funcionar por canal oficial, automatizar o próximo agente.
Se não funcionar, manter checagem horária + antecipação manual de Diego.

### Não fazer
- criar quarta IA interpretando handoffs;
- duplicar fonte de verdade;
- usar login humano como ponte de automação.

## Recuperação do PR5 — 22/09/2026
[Ideia Bumble preservada](BUMBLE-IDEIA-HISTORICA.md), sem ativação ou nova frente de implementação.
