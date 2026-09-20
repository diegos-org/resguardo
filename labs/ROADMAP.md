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
