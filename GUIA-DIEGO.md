# Guia do Diego — tudo sobre o SCL 2.0 num lugar só

> Documento escrito para você, sem precisar ler código. É atualizado a cada PR.
> **Última atualização:** 23/09/2026, PR do item M1.2 (login com Google).

---

## 1. Resumo em 30 segundos

- **O que é:** o novo sistema de gestão da Sua Casa Leblon (painel interno, financeiro,
  portal do proprietário, portal do hóspede, site com reserva direta e integrações com
  Beds24, Mercado Pago e WhatsApp).
- **Onde está:** tudo neste repositório do GitHub, `al-life/scl-reconstrucao`.
- **Quem constrói:** o Claude, por meio de uma rotina automática a cada 3 horas e das
  conversas com você.
- **Quem decide:** você. Nada entra no sistema sem o seu **merge**.
- **Está em uso?** **Não.** Só vai ser usado "para valer" quando tudo estiver pronto
  (marco M11).

---

## 2. Onde estamos

| Etapa | O que entrega | Situação |
|---|---|---|
| M0 Fundação | Base do app, banco de dados, layout, publicação na Vercel | 🟡 só falta a Vercel |
| M1 Acesso | Login (Google/código por e-mail), convites, permissões | 🟡 em andamento |
| M2 Cadastros | Imóveis, proprietários, contratos e comissões | ⚪ aguardando |
| M3 Reservas | Reservas, calendário central, leitura do Beds24 | ⚪ aguardando |
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
4. **Você faz o merge** quando o CI estiver verde. Pode ser pelo app do GitHub no
   celular. Não precisa entender o código: a descrição do PR explica.
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

1. **Mergear os PRs abertos** quando o CI estiver verde.
2. **Vercel + Neon** (uns 5 minutos, dá para fazer pelo computador):
   1. Entre em vercel.com → *Add New… → Project* → escolha `al-life/scl-reconstrucao`.
   2. Em **Root Directory**, escolha `app`. Clique em *Deploy*.
   3. No projeto criado: *Storage* (ou *Integrations*) → **Neon** → conecte sua conta
      Neon. Isso cria a variável `DATABASE_URL` automaticamente.
   4. Me avise aqui na conversa: eu confiro se o site de homologação abriu.
3. **Login com Google** (uns 10 minutos, junto com a Vercel):
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
4. **Beds24:** gere a chave de API. **Não cole no chat.** Coloque nas configurações do
   ambiente do Claude Code (menu do ambiente no topo da sessão → *Edit* → variável
   `BEDS24_API_KEY`) e também na Vercel (*Settings → Environment Variables*).
5. **Meta Business:** comece a verificação da empresa, porque ela demora.

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
