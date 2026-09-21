# SCL 2.0 — Beds24 / Onboarding de Proprietários e Canais

Este documento registra o desenho desejado de integração com Beds24. Nada aqui deve ser tratado como implementado sem validação prática.

## Objetivo

Usar Beds24 como camada de PMS/channel manager sem expor a experiência Beds24 ao proprietário sempre que for possível oferecer fluxo próprio da Sua Casa Leblon.

## O que foi confirmado na documentação oficial

### Airbnb
Beds24 permite:
- conectar contas Airbnb;
- importar listings;
- criar listings;
- mapear listings existentes;
- sincronizar preços, disponibilidade, conteúdo e reservas.

Airbnb não permite que co-hosts façam a conexão API em nome do owner. Para isso, o host/proprietário precisa autorizar.

Beds24 documenta dois caminhos:
1. subconta temporária para o proprietário fazer a conexão;
2. para operações maiores, botão externo **“Connect with Airbnb Account”**, permitindo autorização sem que o proprietário precise entrar no painel Beds24.

### Booking.com
O fluxo oficial é diferente:
- conexão é iniciada no extranet Booking.com;
- Beds24 é escolhido como Connectivity Provider;
- depois property ID, rooms e rate plans são mapeados no Beds24.

Esse fluxo deve ser tratado separadamente do Airbnb; não presumir que o mesmo botão/UX serve para todos os canais.

### White-label
Beds24 oferece:
- branding customizável;
- private label em certos produtos;
- API;
- programa reseller/white-label channel manager.

Isso abre espaço para uma página própria da Sua Casa Leblon que orquestre onboarding e esconda o máximo possível da implementação Beds24.

---

## Fluxo futuro no portal do proprietário

### Cliente já cadastrado / operação assistida
1. proprietário aceita convite SCL;
2. acessa seu portal;
3. vê apartamentos já associados;
4. seção “Canais e anúncios” mostra status Airbnb / Booking / outros;
5. quando necessário, botão próprio conduz autorização externa;
6. usuário volta ao portal SCL após conclusão;
7. sistema mostra estado da conexão e eventuais pendências.

### Proprietário marketplace / auto-onboarding
1. cria conta;
2. cria imóvel/anúncio;
3. configura dados;
4. escolhe “Já anuncio em outra plataforma” ou “Criar anúncio novo”;
5. se já existir:
   - conectar/importar Airbnb;
   - iniciar fluxo Booking.com apropriado;
   - outros canais quando suportados;
6. SCL/Beds24 importa e mapeia o que for permitido;
7. usuário revisa informações antes da ativação.

## Regra de UX

A experiência deve parecer Sua Casa Leblon.

Não mentir sobre quem processa a integração quando houver tela/autorização legal de terceiro, mas evitar mandar o usuário navegar em Beds24 quando não houver necessidade.

---

## Piloto inicial

Antes de entregar a proprietários externos:

### Beds24
Decisão de Diego21/9: seis imóveis sob operação, mas somente os cinco do Rio compõem o catálogo público SCL. Búzios fica fora das partes públicas e dos resultados; inclusão no sistema interno ainda em decisão. O registro local19/9 contém seis importados no Beds24, sem sincronização ativada. Importação não equivale à decisão de inclusão no produto. Ver [consolidação operacional](../operations/CONSOLIDACAO-2026-09-21.md).

### Validação profunda
Usar primeiro **os dois apartamentos de Diego** como piloto para validar:
- cadastro;
- import/mapping;
- calendário;
- disponibilidade;
- tarifas;
- mensagens quando aplicável;
- reservas;
- cancelamentos/modificações;
- relatórios;
- portal do proprietário;
- permissões;
- conciliação.

Só depois convidar Leonardo, Luciana e Vilmar.

## Critério de saída do piloto

Antes de onboarding externo:
- sem associação de proprietário errada;
- calendários coerentes;
- ausência de overbooking por configuração;
- relatórios compreensíveis;
- permissões corretas;
- fluxo de conexão de canal testado;
- erros documentados;
- rollback/manual fallback conhecido.

---

## Relatórios do proprietário

Portal deve permitir gerar relatório por filtro.

Filtros possíveis:
- período;
- apartamento;
- canal;
- tipo de movimento;
- status;
- receitas;
- despesas/ajustes;
- reservas.

### PDF
Permitir:
- exportação PDF conforme filtros atuais;
- fechamento mensal padronizado;
- histórico de relatórios;
- download pelo portal.

Relatório mensal também pode ser enviado por e-mail como canal formal, mas deve continuar disponível no sistema.

### Conteúdo mínimo do fechamento mensal
- reservas;
- receita;
- repasses já feitos por plataformas;
- comissão da empresa;
- ajustes;
- despesas específicas do apartamento;
- conciliação;
- saldo final;
- credor/devedor;
- comprovantes quando aplicável.

---

## Cuidados técnicos

- Beds24 não é fonte de verdade para identidade/autorização do proprietário no SCL.
- Nosso banco deve manter relação usuário → owner → property → permissions.
- IDs Beds24/Airbnb/Booking ficam como integrações externas.
- webhooks/eventos devem ser idempotentes;
- mudanças de mapping precisam de auditoria;
- nunca expor chaves/tokens no frontend;
- não ativar sync bidirecional até verificar preço/inventário;
- Booking e Airbnb têm fluxos diferentes e devem ser testados separadamente.

## Próxima implementação

Quando Beds24 entrar nesta fase:
1. mapear API/capacidades contratadas;
2. criar modelo de integração por property;
3. preparar piloto dos dois apartamentos de Diego;
4. depois desenhar página SCL de canais/anúncios;
5. só então abrir onboarding para proprietários.
