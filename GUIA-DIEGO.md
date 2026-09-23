# Guia do Diego — tudo sobre o SCL 2.0 num lugar só

> Documento escrito para você, sem precisar ler código. É atualizado a cada PR.
> **Última atualização:** 23/09/2026, PR do item M3.5 (tela de reservas).

---

## 1. Resumo em 30 segundos

- **O que é:** o novo sistema de gestão da Sua Casa Leblon (painel interno, financeiro,
  portal do proprietário, portal do hóspede, site com reserva direta e integrações com
  Beds24, Mercado Pago e WhatsApp).
- **Onde está:** tudo neste repositório do GitHub, `al-life/scl-reconstrucao`.
- **Quem constrói:** o Claude, por meio de uma rotina automática a cada 3 horas e das
  conversas com você.
- **Quem decide:** você. Por enquanto o Claude faz os merges sozinho (com CI verde e revisão
  automática sem pendências), por sua autorização; você pode revogar quando quiser.
- **Está em uso?** **Não.** Só vai ser usado "para valer" quando tudo estiver pronto
  (marco M11).

---

## 2. Onde estamos

| Etapa | O que entrega | Situação |
|---|---|---|
| M0 Fundação | Base do app, banco de dados, layout, publicação na Vercel | 🟡 só falta a Vercel |
| M1 Acesso | Login (Google/código por e-mail), convites, permissões | 🟡 em andamento |
| M2 Cadastros | Imóveis, proprietários, contratos e comissões | 🟡 falta só a carga de teste (M2.5) |
| M3 Reservas | Reservas, calendário central, leitura do Beds24 | 🟡 em andamento |
| M4 Financeiro | Lançamentos, comissões, despesas, dashboard, aba Apartamentos | ⚪ aguardando |
| M5 Portal do proprietário | Relatórios, saldos, PDF | ⚪ aguardando |
| M6 Operação | Limpezas, manutenção, agenda diária | ⚪ aguardando |
| M7 Site público | Site novo com disponibilidade real | ⚪ aguardando |
| M8 Reserva direta | Pagamento pelo Mercado Pago | ⚪ aguardando |
| M9 Portal do hóspede | Acesso do hóspede e mensagens automáticas | ⚪ aguardando |
| M10 WhatsApp | Caixa de entrada do WhatsApp no painel | ⚪ aguardando |
| M11 Produção | Dados reais, domínio, entrada em uso | ⚪ aguardando |

**Itens já prontos (na `main`):**
- M0.1: repositório limpo, plano único (ROADMAP) e regras para o Claude.
- M0.2: esqueleto do aplicativo, com testes automáticos.
- M0.3: conexão com o banco de dados (Neon) e banco de teste automático.
- M0.4: **painel interno com menu e filtro global** (imóveis + mês/ano). Todas as seções
  aparecem no menu, marcadas como "em construção" até ganharem conteúdo. Funciona no
  celular: o menu vira uma faixa que desliza para o lado.
- M1.1: **quem pode ver e fazer o quê.** Existem quatro papéis:
  - **admin** (você): pode tudo;
  - **operação** (equipe): reservas, calendário, limpezas, manutenção e mensagens, mas **não vê o financeiro**;
  - **proprietário**: só **lê** (imóvel, reservas, calendário e financeiro), e **só dos imóveis dele**. Representantes
    autorizados veem o mesmo que o proprietário que representam;
  - **hóspede**: sem acesso por enquanto (o portal do hóspede é o M9).

  O vínculo proprietário ↔ imóvel é sempre cadastrado explicitamente, nunca deduzido por e-mail ou CPF.
  Tudo o que não está permitido é bloqueado.
- M1.2: **login com Google.** O painel só abre para quem entra com uma conta Google
  cadastrada (admin ou operação). Seu e-mail vira administrador automaticamente no
  primeiro login (configurado na Vercel, fora do GitHub). Tem botão "Sair" no topo.
- M2.1: **cadastro de imóveis** em Painel → Imóveis: código (102, 403, buzios…), nome
  comercial, bairro, endereço, capacidade, quartos, banheiros, descrição, se **aparece no site**
  e se está **em operação**. O filtro global do painel passa a usar essa lista. Búzios deve ser
  cadastrado com "Aparece no site" desmarcado. Só o admin cadastra/edita; a equipe só consulta.
- M1.5: **histórico de alterações.** Toda mudança fica registrada com quem fez, quando e o
  que mudou (ex.: "Diego alterou · Nome: Studio A → Studio B"). Aparece embaixo da ficha de
  cada imóvel e vai valer para todos os módulos (reservas, financeiro…). O histórico não pode
  ser apagado pelo sistema.
- M2.2: **cadastro de proprietários** em Painel → Proprietários: nome/razão social, pessoa
  física ou jurídica, CPF/CNPJ (conferido automaticamente), e-mail, telefone, endereço,
  **chave Pix**, observações e **quais imóveis são dele**. Cada proprietário pode ter
  **representantes autorizados** (cônjuge, financeiro, procurador), com opção "recebe cópia dos
  relatórios". Essa área é **só do admin** (tem dados pessoais); na lista o CPF aparece
  mascarado (•••.•••.247-25) e o histórico nunca grava CPF nem Pix por extenso.
- M2.3: **contratos de gestão com data de início e fim**, na ficha de cada imóvel: gestão
  completa (sugestão 15%), gestão online (10%) ou marketplace (fórmula ainda a definir).
  Mudou o percentual? Encerra-se o contrato atual e cria-se um novo a partir da data nova —
  assim reservas antigas continuam com a regra da época (ex.: 102, 303 e 399 voltando a
  15/85 em 01/01/2027 = novo contrato começando nessa data). O sistema não deixa dois
  contratos valerem no mesmo dia. Só o admin mexe em contratos.
- M2.4: **canais de cada imóvel** — na ficha do imóvel, os números dele no Beds24, Airbnb e
  Booking. É por aí que, quando ligarmos o Beds24, o sistema vai saber a qual imóvel cada
  reserva pertence. Um mesmo número não pode ficar ligado a dois imóveis.
- M3.1: **base das reservas e bloqueios** (ainda sem tela — a lista e o calendário vêm nos
  próximos itens). Cada reserva tem código SCL próprio (ex.: SCL-7K2QXM), origem (Airbnb,
  Booking, site, direta), entrada/saída, hóspedes, valores (bruto, taxa do canal, líquido — o
  líquido pode ficar "desconhecido" em vez de inventado) e situação. Quando o Beds24 for
  ligado, rodar a sincronização duas vezes não duplica nada, e toda mudança vinda de lá fica
  no histórico. O sistema também já sabe detectar **overbooking** (duas reservas no mesmo
  imóvel no mesmo dia).
- M3.5: **tela de Reservas** no painel: lista filtrada pelo filtro do topo (imóveis + mês/ano),
  com código, imóvel, origem, entrada, saída, noites, hóspede, valor e situação; aviso em
  vermelho se houver overbooking; opção de mostrar canceladas; **"Nova reserva"** para lançar
  à mão (reservas diretas/WhatsApp); ficha de cada reserva com botão de cancelar e histórico.
  A equipe de operação vê as reservas, mas **não vê valores**.

A lista completa e detalhada, item por item, está em [ROADMAP.md](ROADMAP.md).

---

## 3. Como o trabalho acontece

1. A **rotina automática** roda a cada 3 horas nesta conversa do Claude Code. Ela pega o
   próximo item do ROADMAP, programa, testa e abre um **PR** no GitHub.
2. Cada PR tem no título o código do item (ex.: `[M1.2] Login com Google`) e uma
   descrição em português com: *O que muda / Como conferir / Testes / Limites*.
3. Dois robôs conferem cada PR automaticamente:
   - **CI** (GitHub Actions): roda todos os testes. Verde = passou.
   - **Codex**: revisão automática de código. O Claude corrige o que ele apontar.
4. **O Claude faz o merge** (autorizado por você em 23/09, até o sistema estabilizar), mas só
   quando o CI está verde, a revisão do Codex terminou sem pendências e não há conflito.
   Você continua podendo ler cada PR — a descrição explica em português o que mudou — e
   pode pedir para voltar a ser você quem faz o merge a qualquer momento.
5. Pode haver até **3 PRs abertos** ao mesmo tempo esperando seu merge.

**Onde ver o sistema:** assim que a Vercel estiver conectada (seção 6), cada PR ganha um
link de *preview*, e a `main` fica publicada num endereço fixo de homologação. O painel
fica em `/painel`.

**Se quiser acompanhar ou pedir algo:** abra esta conversa no app Claude (área *Code*)
e escreva normalmente.

---

## 4. Onde encontrar cada coisa no GitHub

| Pasta ou arquivo | O que tem | Precisa ler? |
|---|---|---|
| `GUIA-DIEGO.md` | Este guia | ✅ sim |
| `ROADMAP.md` | Plano completo, item por item, com o que falta | Se quiser detalhe |
| `requisitos/` | Suas decisões de negócio, escritas e organizadas por tema | Só para conferir regras |
| `requisitos/operations/FINANCEIRO-PORTAIS.md` | Regras do financeiro e dos portais | Quando chegarmos no M4/M5 |
| `app/` | **O sistema novo** (código) | ❌ não |
| `app/drizzle/` | Histórico das mudanças no banco de dados | ❌ não |
| `prototipos/` | Protótipos antigos (site e gestão), só como referência | ❌ não |
| `arquivo/` | Papelada dos agentes antigos (Rivers, Lia, Sage...), guardada como histórico | ❌ não |
| `CLAUDE.md` | Regras que o Claude segue ao programar | ❌ não |
| `.github/workflows/` | Configuração dos testes automáticos (CI) | ❌ não |

---

## 5. Contas e serviços

| Serviço | Para que serve | Situação | O que falta |
|---|---|---|---|
| **GitHub** (`al-life/scl-reconstrucao`) | Guarda o código e o histórico | ✅ conectado | — |
| **Claude Code** | Programa o sistema; rotina a cada 3h | ✅ ativo | — |
| **Codex** (revisor automático) | Revisa cada PR | ✅ ativo no repositório | — |
| **Neon** | Banco de dados (Postgres) | 🟡 sua conta existe e está paga | Ligar à Vercel (item abaixo) |
| **Vercel** | Publica o sistema na internet (homologação e depois produção) | ⚪ não conectado | Importar o repositório (seção 6) |
| **Beds24** | Channel manager (Airbnb/Booking), reservas e calendário | 🟡 conta criada | Gerar a chave de API (seção 6) |
| **Mercado Pago** | Pagamentos da reserva direta | ⚪ não conectado | Credenciais de *teste*, mais adiante (M8) |
| **Meta / WhatsApp Business** | Atendimento pelo WhatsApp da empresa | ⚪ não conectado | Verificação da empresa no Meta Business (demora dias) |
| **Google Cloud (login)** | Botão "Entrar com Google" | ⚪ não configurado | Criar credenciais OAuth (seção 6) |
| **Cloudflare** | Domínio e e-mail | ⚪ não conectado | Só no final (M11) |

**Onde ficam senhas e chaves:** nunca no GitHub e nunca no chat. Elas ficam nas
configurações da Vercel e nas configurações do ambiente do Claude Code (variáveis de
ambiente).

---

## 6. O que você precisa fazer agora

1. **Vercel + Neon** (uns 5 minutos, dá para fazer pelo computador):
   1. Entre em vercel.com → *Add New… → Project* → escolha `al-life/scl-reconstrucao`.
   2. Em **Root Directory**, escolha `app`. Clique em *Deploy*.
   3. No projeto criado: *Storage* (ou *Integrations*) → **Neon** → conecte sua conta
      Neon. Isso cria a variável `DATABASE_URL` automaticamente.
   4. Me avise aqui na conversa: eu confiro se o site de homologação abriu.
2. **Login com Google** (uns 10 minutos, junto com a Vercel):
   1. Em console.cloud.google.com → crie um projeto "SCL" → *APIs e serviços → Tela de
      consentimento OAuth* (tipo "Externo", nome "Sua Casa Leblon").
   2. *Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web*.
      Em "URIs de redirecionamento autorizados" coloque
      `https://SEU-ENDERECO.vercel.app/api/auth/callback/google` (o endereço que a Vercel der).
   3. Na Vercel, em *Settings → Environment Variables*, crie:
      `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET` (os dois valores que o Google mostrar),
      `AUTH_SECRET` (qualquer texto longo e aleatório, ex.: gerado em 1password ou similar) e
      `ADMIN_EMAILS` = seu e-mail do Google.
   4. Faça *Redeploy* e entre em `/entrar`. Se travar em algum passo, me chame que eu guio.
3. **Beds24:** gere a chave de API. **Não cole no chat.** Coloque nas configurações do
   ambiente do Claude Code (menu do ambiente no topo da sessão → *Edit* → variável
   `BEDS24_API_KEY`) e também na Vercel (*Settings → Environment Variables*).
4. **Meta Business:** comece a verificação da empresa, porque ela demora.

---

## 7. Decisões pendentes (sem pressa, não travam o trabalho)

- Fórmula da comissão do **marketplace**: você não lembrava; quando lembrar, me conte.
- **Competência × caixa** no financeiro: se a receita conta no mês da estadia ou no mês
  do recebimento.
- **Búzios** no sistema interno: por ora entra cadastrado, mas fora do site público.
- **Avaliações**: só no Airbnb ou também próprias.

---

## 8. Glossário rápido

- **Repositório:** a "pasta" do projeto no GitHub, com todo o histórico.
- **Branch:** uma cópia paralela onde uma mudança é preparada sem mexer no principal.
- **PR (pull request):** o pedido para juntar uma branch ao principal. É onde você revisa.
- **Merge:** aceitar o PR. A mudança passa a fazer parte da versão principal (`main`).
- **CI:** os testes automáticos que rodam em cada PR. Verde = tudo certo.
- **Deploy / publicar:** colocar o sistema no ar (na Vercel).
- **Homologação:** versão de teste no ar, com dados fictícios, antes da versão real.
- **Migração de banco:** um arquivo que cria ou altera tabelas do banco de dados de
  forma controlada.
