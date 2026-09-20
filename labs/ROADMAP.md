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
