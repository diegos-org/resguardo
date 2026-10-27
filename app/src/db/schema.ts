import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, customType, date, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  DetalheOperacaoBeds24,
  EscoposLidosBeds24,
  EsperadoBeds24,
  LidoBeds24,
  ModoOperacaoBeds24,
  MotivoAcompanhamentoBeds24,
  PedidoBeds24,
  SituacaoAcompanhamentoBeds24,
  SituacaoOperacaoBeds24,
  TipoOperacaoBeds24,
} from "@/beds24/reservas-site-regras";
import type { RespostaBeds24 } from "@/beds24/tipos";
import type { FontePrecos } from "@/imoveis/fonte-precos";
import type { CodigoDevolucao, ModoTresDS, StatusTresDS } from "@/pagamentos/provedor";
import type {
  CodigoCausaContestacao,
  DadosDoEvento,
  DocumentacaoDaContestacao,
  EstadoConhecidoContestacao,
  FonteEventoContestacao,
  OrigemContestacao,
  OrigemValorContestacao,
  QuemArcaContestacao,
  SituacaoContestacao,
  SituacaoPagamentoAntes,
  TipoContestacao,
  TipoEventoContestacao,
} from "@/pagamentos/contestacao-regras";
import type { PeriodicidadeRepasse } from "@/repasses/periodicidade";
import type { SituacaoDisponibilidade } from "@/site/disponibilidade";
import type {
  CampoAviso,
  Direcao,
  EventoConta,
  IniciadoPor,
  MotivoDesconexao,
  Origem,
  ResultadoEmail,
  ResultadoEvento,
  Sincronizacao,
  SituacaoConta,
  TipoMensagem,
} from "@/whatsapp/regras";

/**
 * Esquema do banco (Drizzle). Novas tabelas entram aqui e geram migração com
 * `npm run db:generate`. Nunca editar migração já mergeada.
 */

const criadoEm = () => timestamp("criado_em", { withTimezone: true }).notNull().defaultNow();

/** Configurações gerais do sistema (chave → valor JSON). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Acesso (M1.1): organização → usuários → proprietários → imóveis
// ---------------------------------------------------------------------------

/** limpeza: profissional de limpeza com acesso próprio pelo celular (M6.6): só as limpezas dela. */
export const PAPEIS = ["admin", "operacao", "proprietario", "hospede", "limpeza"] as const;
export type Papel = (typeof PAPEIS)[number];
export const papelEnum = pgEnum("papel", PAPEIS);

/** Empresa que opera o sistema (hoje, só a Sua Casa Leblon). */
export const organizacoes = pgTable("organizacoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  criadoEm: criadoEm(),
});

/** Pessoa que entra no sistema. O papel define o que ela pode fazer. */
export const usuarios = pgTable(
  "usuarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    /** Vazio só para quem entra com usuário e senha, sem e-mail (equipe, M6.8). */
    email: text("email").notNull(),
    nome: text("nome").notNull(),
    papel: papelEnum("papel").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    /** Sessões abertas antes disso não valem mais (e-mail trocado, acesso devolvido, senha redefinida). */
    sessaoValidaDesde: timestamp("sessao_valida_desde", { withTimezone: true }),
    /** Usuário para entrar com senha (M6.8), em minúsculas; null = sem usuário (entra pelo e-mail). */
    login: text("login"),
    /** Senha (M6.8) só como hash scrypt (`acesso/senha.ts`); null = não entra com senha. */
    senhaHash: text("senha_hash"),
    /** Senha definida pela empresa (provisória): a tela da equipe sugere trocar. */
    senhaProvisoria: boolean("senha_provisoria").notNull().default(false),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("usuarios_email_unico").on(sql`lower(${t.email})`).where(sql`${t.email} <> ''`), uniqueIndex("usuarios_login_unico").on(t.login)],
);

/**
 * Tentativas erradas de senha por usuário digitado (M6.8), exista ele ou não: depois de muitas, espera. A chave é o
 * que foi digitado, normalizado — assim a resposta é a mesma para quem existe e para quem não existe.
 */
export const tentativasLogin = pgTable("tentativas_login", {
  chave: text("chave").primaryKey(),
  erros: integer("erros").notNull().default(0),
  bloqueadoAte: timestamp("bloqueado_ate", { withTimezone: true }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Código de login enviado por e-mail (M1.3). Guarda só o HMAC do código, nunca o código.
 * Uso único (`usadoEm`), validade curta (`expiraEm`) e limite de tentativas.
 */
export const codigosLogin = pgTable(
  "codigos_login",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** E-mail normalizado; códigos do portal do hóspede (M9.1) vêm como "hospede:<e-mail>". */
    email: text("email").notNull(),
    codigoHash: text("codigo_hash").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    tentativas: integer("tentativas").notNull().default(0),
    usadoEm: timestamp("usado_em", { withTimezone: true }),
    /** Substituído por um código mais novo, esgotado ou usado: não vale mais. */
    invalidadoEm: timestamp("invalidado_em", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [index("codigos_login_email").on(t.email, t.criadoEm)],
);

/**
 * Imóvel. `codigo` é o identificador curto usado pela operação (102, 403, buzios…);
 * `nome` é o nome comercial exibido ao público (ex.: "Studio …").
 */
export const imoveis = pgTable(
  "imoveis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    codigo: text("codigo").notNull(),
    nome: text("nome").notNull(),
    /** Aparece no site público e na busca. Búzios = false. */
    publico: boolean("publico").notNull().default(false),
    /** Em operação. Imóvel inativo some das listas, mas o histórico fica. */
    ativo: boolean("ativo").notNull().default(true),
    bairro: text("bairro").notNull().default(""),
    cidade: text("cidade").notNull().default("Rio de Janeiro"),
    endereco: text("endereco").notNull().default(""),
    fuso: text("fuso").notNull().default("America/Sao_Paulo"),
    capacidade: integer("capacidade"),
    quartos: integer("quartos"),
    banheiros: integer("banheiros"),
    descricao: text("descricao").notNull().default(""),
    /**
     * M7.17: frase de abertura da casa no site (acima da descrição, no cartão da vitrine e na prévia do link). Só do SCL:
     * escrita na ficha do imóvel, nenhuma importação a preenche. Vazia = nada aparece (o cartão usa a descrição).
     */
    frase: text("frase").notNull().default(""),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("imoveis_codigo_por_org").on(t.organizacaoId, t.codigo)],
);

/** Referência manual do anúncio externo; não é o estado sincronizado da OTA. */
export const anuncios = pgTable("anuncios", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  imovelId: uuid("imovel_id").notNull().references(() => imoveis.id, { onDelete: "cascade" }),
  canal: text("canal").notNull(),
  situacao: text("situacao").notNull().default("nao_conferido"),
  url: text("url").notNull().default(""),
  titulo: text("titulo").notNull().default(""),
  descricao: text("descricao").notNull().default(""),
  fotos: jsonb("fotos").$type<string[]>().notNull().default([]),
  precoBase: integer("preco_base"),
  conferidoEm: timestamp("conferido_em", { withTimezone: true }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  versao: integer("versao").notNull().default(1),
}, (t) => [uniqueIndex("anuncios_imovel_canal").on(t.imovelId, t.canal)]);

export const TIPOS_PESSOA = ["fisica", "juridica"] as const;
export const tipoPessoaEnum = pgEnum("tipo_pessoa", TIPOS_PESSOA);

/**
 * Proprietário formal (pessoa física ou jurídica). Documento, contato e Pix são dados
 * sensíveis: ficam só no banco, visíveis apenas para quem tem `proprietario:ler` (admin).
 */
export const proprietarios = pgTable("proprietarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  nome: text("nome").notNull(),
  tipo: tipoPessoaEnum("tipo").notNull().default("fisica"),
  /** CPF ou CNPJ, só dígitos. */
  documento: text("documento").notNull().default(""),
  email: text("email").notNull().default(""),
  telefone: text("telefone").notNull().default(""),
  endereco: text("endereco").notNull().default(""),
  chavePix: text("chave_pix").notNull().default(""),
  observacoes: text("observacoes").notNull().default(""),
  ativo: boolean("ativo").notNull().default(true),
  /** M4.10: como quer receber (mensal, quinzenal, semanal, assim que disponível); null = padrão do tipo de contrato (Configurações → Repasses). */
  periodicidadeRepasse: text("periodicidade_repasse").$type<PeriodicidadeRepasse>(),
  criadoEm: criadoEm(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Representante autorizado de um proprietário (cônjuge, procurador, responsável
 * financeiro). Não vira coproprietário por aparecer aqui.
 */
export const representantes = pgTable("representantes", {
  id: uuid("id").primaryKey().defaultRandom(),
  proprietarioId: uuid("proprietario_id").notNull().references(() => proprietarios.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  /** Ex.: "cônjuge", "financeiro", "procurador". */
  relacao: text("relacao").notNull().default(""),
  email: text("email").notNull().default(""),
  telefone: text("telefone").notNull().default(""),
  /** Recebe cópia dos relatórios mensais. */
  recebeRelatorios: boolean("recebe_relatorios").notNull().default(false),
  criadoEm: criadoEm(),
});

/** Quais imóveis pertencem a quais proprietários (cada imóvel tem UM proprietário). */
export const proprietarioImoveis = pgTable(
  "proprietario_imoveis",
  {
    proprietarioId: uuid("proprietario_id").notNull().references(() => proprietarios.id, { onDelete: "cascade" }),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id, { onDelete: "cascade" }),
    criadoEm: criadoEm(),
  },
  // Um proprietário por imóvel (decisão de Diego, 24/09): o dinheiro vai para uma conta só.
  (t) => [primaryKey({ columns: [t.proprietarioId, t.imovelId] }), uniqueIndex("proprietario_imoveis_um_dono").on(t.imovelId)],
);

/**
 * Quais usuários agem em nome de quais proprietários (o próprio dono ou um
 * representante autorizado). Vínculo explícito — nunca inferido por e-mail/CPF.
 */
export const proprietarioUsuarios = pgTable(
  "proprietario_usuarios",
  {
    proprietarioId: uuid("proprietario_id").notNull().references(() => proprietarios.id, { onDelete: "cascade" }),
    usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id, { onDelete: "cascade" }),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.proprietarioId, t.usuarioId] })],
);

/**
 * Convite de proprietário para o portal (M1.4). O link leva um token aleatório; o banco
 * guarda só o hash. Uso único (`aceitoEm`), validade (`expiraEm`) e revogação.
 */
export const convites = pgTable(
  "convites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    proprietarioId: uuid("proprietario_id").notNull().references(() => proprietarios.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    criadoPor: uuid("criado_por").references(() => usuarios.id),
    criadoEm: criadoEm(),
    aceitoEm: timestamp("aceito_em", { withTimezone: true }),
    aceitoPor: uuid("aceito_por").references(() => usuarios.id),
    revogadoEm: timestamp("revogado_em", { withTimezone: true }),
    revogadoPor: uuid("revogado_por").references(() => usuarios.id),
  },
  (t) => [uniqueIndex("convites_token").on(t.tokenHash), index("convites_proprietario").on(t.proprietarioId)],
);

/**
 * Aceite de um documento pelo proprietário (M5.6): quem (usuário do portal, em nome de qual proprietário),
 * quando e qual versão. Só inclusão: uma versão nova do documento pede um aceite novo; os antigos ficam.
 * `documento` hoje é só "como_funciona"; as páginas legais do site (M7.4) têm a própria tabela, `aceites_site` (o hóspede não tem usuário).
 */
export const aceitesDocumento = pgTable(
  "aceites_documento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    documento: text("documento").notNull(),
    versao: integer("versao").notNull(),
    proprietarioId: uuid("proprietario_id").notNull().references(() => proprietarios.id, { onDelete: "cascade" }),
    usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id),
    aceitoEm: timestamp("aceito_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("aceites_documento_unico").on(t.documento, t.versao, t.proprietarioId, t.usuarioId), index("aceites_documento_proprietario").on(t.organizacaoId, t.proprietarioId)],
);

// ---------------------------------------------------------------------------
// Auditoria (M1.5): registro só de inclusão de quem mudou o quê e quando
// ---------------------------------------------------------------------------

export const auditoria = pgTable(
  "auditoria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    /** Quem fez. Null = o próprio sistema (sincronização, rotina agendada…). */
    usuarioId: uuid("usuario_id").references(() => usuarios.id),
    /** Ex.: "imovel.criar", "imovel.editar". */
    acao: text("acao").notNull(),
    entidade: text("entidade").notNull(),
    entidadeId: text("entidade_id").notNull(),
    /** Campos alterados: { campo: [antes, depois] }. */
    mudancas: jsonb("mudancas").notNull().default({}),
    criadoEm: criadoEm(),
  },
  (t) => [index("auditoria_entidade").on(t.organizacaoId, t.entidade, t.entidadeId, t.criadoEm)],
);

// ---------------------------------------------------------------------------
// Contratos de gestão (M2.3): percentuais com vigência, por imóvel
// ---------------------------------------------------------------------------

export const TIPOS_CONTRATO = ["gestao_completa", "gestao_online", "marketplace"] as const;
export type TipoContrato = (typeof TIPOS_CONTRATO)[number];
export const tipoContratoEnum = pgEnum("tipo_contrato", TIPOS_CONTRATO);

/**
 * Contrato de gestão de um imóvel. Vale de `inicio` até `fim` (inclusive; null = sem fim).
 * Percentual em pontos-base (1500 = 15,00%) para evitar arredondamento.
 * Mudança de regra = novo contrato com nova vigência; nunca recalcular o passado.
 */
export const contratos = pgTable(
  "contratos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    tipo: tipoContratoEnum("tipo").notNull(),
    /** Comissão da empresa em pontos-base. Null só para marketplace com fórmula pendente. */
    comissaoBp: integer("comissao_bp"),
    inicio: date("inicio", { mode: "string" }).notNull(),
    fim: date("fim", { mode: "string" }),
    observacoes: text("observacoes").notNull().default(""),
    /** M5.5: o proprietário pode bloquear datas de uso próprio (e liberá-las) pelo portal enquanto este contrato vale. */
    proprietarioBloqueia: boolean("proprietario_bloqueia").notNull().default(true),
    criadoEm: criadoEm(),
  },
  (t) => [index("contratos_imovel_inicio").on(t.imovelId, t.inicio)],
);

// ---------------------------------------------------------------------------
// IDs externos (M2.4): imóvel ↔ Beds24 / Airbnb / Booking
// ---------------------------------------------------------------------------

export const CANAIS = ["beds24", "airbnb", "booking"] as const;
export type Canal = (typeof CANAIS)[number];
export const canalEnum = pgEnum("canal", CANAIS);

/**
 * Identificador de um imóvel num sistema externo. O ID interno SCL continua sendo a
 * identidade do imóvel; estes são só referências. Um ID externo aponta para um único
 * imóvel. `detalhe` guarda o sub-identificador quando existe (ex.: roomId no Beds24).
 */
export const idsExternos = pgTable(
  "ids_externos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id, { onDelete: "cascade" }),
    canal: canalEnum("canal").notNull(),
    idExterno: text("id_externo").notNull(),
    detalhe: text("detalhe").notNull().default(""),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("ids_externos_unico").on(t.organizacaoId, t.canal, t.idExterno, t.detalhe)],
);

// ---------------------------------------------------------------------------
// Reservas e bloqueios (M3.1)
// ---------------------------------------------------------------------------

export const ORIGENS_RESERVA = ["airbnb", "booking", "site", "direta", "outro"] as const;
export type OrigemReserva = (typeof ORIGENS_RESERVA)[number];
export const origemReservaEnum = pgEnum("origem_reserva", ORIGENS_RESERVA);

export const ESTADOS_RESERVA = ["pendente", "confirmada", "cancelada", "consulta", "pedido"] as const;
export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];
export const estadoReservaEnum = pgEnum("estado_reserva", ESTADOS_RESERVA);

/**
 * Quem recebe o pagamento do canal: "split" = o canal paga a parte do proprietário direto a
 * ele (não gera dívida da empresa); "empresa" = a empresa recebe tudo e deve a parte dele.
 * null = ainda não confirmado (o motor deixa o acerto pendente ou usa a regra da origem).
 */
export const RECEBIMENTOS_RESERVA = ["split", "empresa"] as const;
export type RecebimentoReserva = (typeof RECEBIMENTOS_RESERVA)[number];
export const recebimentoReservaEnum = pgEnum("recebimento_reserva", RECEBIMENTOS_RESERVA);

/**
 * Reserva. `codigo` é o código público SCL (não é credencial). `fonte`+`idFonte` identificam
 * a reserva no sistema que a trouxe (ex.: beds24 / 12345678) — a sincronização é idempotente
 * por esse par. Valores em centavos; `valorLiquido` null = ainda não conhecido.
 * Dados do hóspede: só o necessário para a operação.
 */
export const reservas = pgTable(
  "reservas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    codigo: text("codigo").notNull(),
    origem: origemReservaEnum("origem").notNull(),
    estado: estadoReservaEnum("estado").notNull().default("confirmada"),
    checkin: date("checkin", { mode: "string" }).notNull(),
    checkout: date("checkout", { mode: "string" }).notNull(),
    hospedes: integer("hospedes"),
    hospedeNome: text("hospede_nome").notNull().default(""),
    hospedeEmail: text("hospede_email").notNull().default(""),
    /**
     * E-mail do hóspede cadastrado/corrigido à mão no painel (M9.1): a partir daí a sincronização
     * (planilha, Beds24) não troca mais o e-mail — senão uma correção feita para tirar o acesso
     * de alguém seria desfeita na próxima importação.
     */
    hospedeEmailManualEm: timestamp("hospede_email_manual_em", { withTimezone: true }),
    hospedeTelefone: text("hospede_telefone").notNull().default(""),
    /** Cidade/país informados pelo hóspede — nunca inferidos. */
    hospedeOrigem: text("hospede_origem").notNull().default(""),
    moeda: text("moeda").notNull().default("BRL"),
    valorBruto: integer("valor_bruto"),
    taxaCanal: integer("taxa_canal"),
    valorLiquido: integer("valor_liquido"),
    recebimento: recebimentoReservaEnum("recebimento"),
    fonte: text("fonte").notNull().default("manual"),
    idFonte: text("id_fonte").notNull().default(""),
    /** Identidade Beds24, inclusive quando a reserva nasceu de uma planilha. */
    beds24Id: text("beds24_id"),
    /** Data original informada pela fonte; nunca substituir pela data de importação. */
    reservadaEm: timestamp("reservada_em", { withTimezone: true }),
    /** Código da reserva no canal (ex.: HMXXXX do Airbnb). */
    codigoCanal: text("codigo_canal").notNull().default(""),
    observacoes: text("observacoes").notNull().default(""),
    canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
    /** Quando passou a confirmada (M9.2: a mensagem de confirmação sai a partir daí). Vazio se não está confirmada. */
    confirmadaEm: timestamp("confirmada_em", { withTimezone: true }),
    /**
     * Reserva não confirmada que já movimentou dinheiro fica "em conferência" (M4.8) até alguém da
     * equipe dar por resolvida (depois do ajuste manual). Volta a vazio quando a situação muda.
     */
    conferenciaResolvidaEm: timestamp("conferencia_resolvida_em", { withTimezone: true }),
    /**
     * O cálculo atual não bate com lançamentos que já movimentaram dinheiro (o motor não mexe neles):
     * a reserva fica em conferência, qualquer que seja a situação, até o cálculo voltar a bater ou
     * alguém dar por resolvida (M4.8).
     */
    divergenciaEm: timestamp("divergencia_em", { withTimezone: true }),
    /** O cálculo divergente que ficou em conferência (M4.8): outro cálculo divergente reabre a conferência. */
    divergenciaCalculo: text("divergencia_calculo"),
    /**
     * Centavos que ficaram com a empresa de uma reserva CANCELADA sem devolução (M8.2c, política de cancelamento): o motor
     * divide esse valor como uma reserva normal. null = nada retido. Só o cancelamento pela política grava.
     */
    valorRetido: integer("valor_retido"),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reservas_codigo").on(t.organizacaoId, t.codigo),
    uniqueIndex("reservas_fonte").on(t.organizacaoId, t.fonte, t.idFonte).where(sql`${t.idFonte} <> ''`),
    uniqueIndex("reservas_beds24").on(t.organizacaoId, t.beds24Id),
    index("reservas_imovel_periodo").on(t.imovelId, t.checkin, t.checkout),
  ],
);

/**
 * Quem recebe o pagamento, por imóvel e por canal (Diego, 24/09): vale para todas as
 * reservas desse imóvel naquele canal, a menos que a própria reserva diga outra coisa.
 * Sem linha aqui, vale o padrão do sistema (Airbnb = split; demais = empresa).
 */
export const recebimentoPorCanal = pgTable(
  "recebimento_por_canal",
  {
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id, { onDelete: "cascade" }),
    origem: origemReservaEnum("origem").notNull(),
    recebimento: recebimentoReservaEnum("recebimento").notNull(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.imovelId, t.origem] })],
);

/** Bloqueio de calendário (manutenção, uso do proprietário, bloqueio de canal…). Fim exclusivo, como o checkout. */
export const bloqueios = pgTable(
  "bloqueios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    inicio: date("inicio", { mode: "string" }).notNull(),
    fim: date("fim", { mode: "string" }).notNull(),
    motivo: text("motivo").notNull().default(""),
    fonte: text("fonte").notNull().default("manual"),
    idFonte: text("id_fonte").notNull().default(""),
    /** M5.5: titular (proprietário) que fez o bloqueio pelo portal — só ele libera. Nulo nos bloqueios da equipe e do Beds24. */
    proprietarioId: uuid("proprietario_id").references(() => proprietarios.id),
    criadoEm: criadoEm(),
  },
  (t) => [
    uniqueIndex("bloqueios_fonte").on(t.organizacaoId, t.fonte, t.idFonte).where(sql`${t.idFonte} <> ''`),
    index("bloqueios_imovel_periodo").on(t.imovelId, t.inicio, t.fim),
  ],
);

/**
 * Cotação do site (M8.1): o que o visitante viu (datas, pessoas, valor por partes e situação), com código
 * público. "Segurar as datas" cria um pedido de reserva (`reservas`, estado `pedido`, origem `site`) ligado
 * aqui, que ocupa o calendário até `holdAte`; depois vence sozinho. Estados: aberta → segurada → convertida
 * (equipe confirmou) | expirada (venceu) | cancelada (equipe cancelou); aberta → desatualizada (valor ou
 * disponibilidade mudaram na hora de segurar).
 */
export const ESTADOS_COTACAO = ["aberta", "segurada", "expirada", "convertida", "desatualizada", "cancelada"] as const;
export type EstadoCotacao = (typeof ESTADOS_COTACAO)[number];
export const cotacoes = pgTable(
  "cotacoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    /** Código público da cotação (ex.: COT-7K3M9QX2); não é credencial. */
    codigo: text("codigo").notNull(),
    estado: text("estado").notNull().default("aberta"),
    checkin: date("checkin", { mode: "string" }).notNull(),
    checkout: date("checkout", { mode: "string" }).notNull(),
    hospedes: integer("hospedes").notNull(),
    noites: integer("noites").notNull(),
    /** Situação mostrada ao visitante quando a cotação foi feita: disponivel ou a_confirmar. */
    situacao: text("situacao").notNull(),
    /** Valor por partes, em centavos, como mostrado (diárias e total nunca nulos numa cotação gravada). */
    diarias: integer("diarias").notNull(),
    limpeza: integer("limpeza").notNull(),
    hospedeExtra: integer("hospede_extra").notNull(),
    /** Soma das partes (preço cheio, o que o proprietário pediria na OTA); `total` = valor cheio − desconto. */
    valorCheio: integer("valor_cheio").notNull(),
    /** Desconto único do site (M12.1), em centavos, como calculado na hora da cotação. */
    desconto: integer("desconto").notNull().default(0),
    total: integer("total").notNull(),
    /** Leitura do Beds24 mais antiga usada na decisão (null = sem leitura em alguma data). */
    leituraEm: timestamp("leitura_em", { withTimezone: true }),
    /** Pedido de reserva criado ao segurar as datas. */
    reservaId: uuid("reserva_id").references(() => reservas.id),
    /** Até quando as datas ficam seguradas; depois o pedido vence sozinho. */
    holdAte: timestamp("hold_ate", { withTimezone: true }),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadaEm: timestamp("atualizada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cotacoes_codigo").on(t.organizacaoId, t.codigo), index("cotacoes_imovel_estado").on(t.imovelId, t.estado)],
);

/** Observação do calendário externo; não é cotação nem autorização de venda. */
export const beds24Calendario = pgTable("beds24_calendario", {
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
  data: date("data", { mode: "string" }).notNull(),
  livres: integer("livres"),
  preco: integer("preco"),
  minimoNoites: integer("minimo_noites"),
  maximoNoites: integer("maximo_noites"),
  /** `override` do calendário Beds24 ("none", "blackout", "noCheckIn"…); null = não informado. */
  bloqueio: text("bloqueio"),
  /** Quarto Beds24 lido: a observação só descreve o imóvel enquanto este for o quarto vinculado. */
  roomId: text("room_id"),
  observadoEm: timestamp("observado_em", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.organizacaoId, t.imovelId, t.data] })]);

/** Execuções por organização, sem payloads do provedor nem contato de hóspedes. */
export const beds24Execucoes = pgTable("beds24_execucoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  iniciadoEm: timestamp("iniciado_em", { withTimezone: true }).notNull().defaultNow(),
  terminadoEm: timestamp("terminado_em", { withTimezone: true }),
  situacao: text("situacao").notNull().default("executando"),
  resumo: text("resumo").notNull().default(""),
  divergencias: jsonb("divergencias").$type<string[]>().notNull().default([]),
}, t => [index("beds24_execucoes_org").on(t.organizacaoId, t.iniciadoEm)]);

// ---------------------------------------------------------------------------
// Financeiro — ledger (M4.1)
// ---------------------------------------------------------------------------

export const TIPOS_LANCAMENTO = [
  "receita_bruta", // valor bruto da reserva
  "taxa_canal", // taxa cobrada pelo Airbnb/Booking/gateway (negativa)
  "comissao", // comissão SCL sobre a reserva
  "direito_proprietario", // parte do proprietário na reserva
  "recebimento", // dinheiro que efetivamente entrou (extrato)
  "repasse", // empresa pagou ao proprietário
  "despesa_empresa", // custo próprio da empresa
  "despesa_proprietario", // despesa atribuída ao proprietário
  "adiantamento", // empresa pagou algo devido pelo proprietário
  "reembolso", // proprietário devolveu adiantamento
  "ajuste", // correção/ajuste de canal (motivo obrigatório)
  "devolucao", // dinheiro que voltou ao hóspede (saída; `montante` = o que saiu, `valor` 0) — M8.2c
] as const;
export type TipoLancamento = (typeof TIPOS_LANCAMENTO)[number];
export const tipoLancamentoEnum = pgEnum("tipo_lancamento", TIPOS_LANCAMENTO);

export const ESTADOS_LANCAMENTO = ["previsto", "realizado", "conciliado", "pendente"] as const;
export type EstadoLancamento = (typeof ESTADOS_LANCAMENTO)[number];
export const estadoLancamentoEnum = pgEnum("estado_lancamento", ESTADOS_LANCAMENTO);

/**
 * Categoria de despesa (M4.3), editável pelo admin. Não se apaga categoria usada: arquiva-se
 * (`ativa = false`), e ela some das opções novas mas continua nos lançamentos antigos.
 */
export const categoriasDespesa = pgTable(
  "categorias_despesa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    nome: text("nome").notNull(),
    ativa: boolean("ativa").notNull().default(true),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("categorias_despesa_nome").on(t.organizacaoId, sql`lower(${t.nome})`)],
);

/**
 * Lançamento financeiro. IMUTÁVEL: nunca é editado nem apagado — correção é feita com um
 * estorno (novo lançamento com valores invertidos apontando para o original). Só o estado
 * (previsto → realizado → conciliado / pendente) muda, e com auditoria.
 *
 * `valor`: efeito no resultado, em centavos com sinal (receita +, custo −).
 * `efeitoSaldo`: efeito no acerto empresa ↔ proprietário (+ = empresa deve ao proprietário,
 * − = proprietário deve à empresa). É o que responde "quem deve quanto para quem".
 */
export const lancamentos = pgTable(
  "lancamentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").references(() => imoveis.id),
    proprietarioId: uuid("proprietario_id").references(() => proprietarios.id),
    reservaId: uuid("reserva_id").references(() => reservas.id),
    tipo: tipoLancamentoEnum("tipo").notNull(),
    descricao: text("descricao").notNull(),
    valor: integer("valor").notNull(),
    efeitoSaldo: integer("efeito_saldo").notNull().default(0),
    /** Mês/dia a que o fato pertence (competência). */
    competencia: date("competencia", { mode: "string" }).notNull(),
    /** Dia em que o dinheiro entrou/saiu, quando houver. */
    dataCaixa: date("data_caixa", { mode: "string" }),
    estado: estadoLancamentoEnum("estado").notNull().default("previsto"),
    /** manual | motor | sincronizacao | importacao */
    origem: text("origem").notNull().default("manual"),
    /** Chave de idempotência de quem gerou (ex.: "reserva:<id>:comissao"). */
    chaveOrigem: text("chave_origem").notNull().default(""),
    /** Despesas (M4.3): categoria, fornecedor/recebedor e referência do comprovante. */
    categoriaId: uuid("categoria_id").references(() => categoriasDespesa.id),
    fornecedor: text("fornecedor").notNull().default(""),
    comprovante: text("comprovante").notNull().default(""),
    /**
     * Valor de face do fato quando difere do efeito no resultado — ex.: despesa do
     * proprietário (R$ 800 de reparo) tem `valor` 0 para a empresa, mas `montante` 80000.
     */
    montante: integer("montante"),
    /** Despesa do proprietário: quem tira o dinheiro do bolso ("empresa" | "proprietario"). */
    pagoPor: text("pago_por"),
    estornoDe: uuid("estorno_de"),
    criadoPor: uuid("criado_por").references(() => usuarios.id),
    criadoEm: criadoEm(),
  },
  (t) => [
    uniqueIndex("lancamentos_chave_origem").on(t.organizacaoId, t.chaveOrigem).where(sql`${t.chaveOrigem} <> ''`),
    uniqueIndex("lancamentos_estorno_unico").on(t.estornoDe).where(sql`${t.estornoDe} is not null`),
    index("lancamentos_competencia").on(t.organizacaoId, t.competencia),
    index("lancamentos_proprietario").on(t.proprietarioId, t.competencia),
    index("lancamentos_reserva").on(t.reservaId),
  ],
);

// ---------------------------------------------------------------------------
// Sistema (M1.6): registro das automações (quando rodou, se deu certo, resumo)
// ---------------------------------------------------------------------------

export const execucoesAutomacao = pgTable(
  "execucoes_automacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Identificador da automação (ex.: "recalculo-deploy"). */
    nome: text("nome").notNull(),
    iniciadoEm: timestamp("iniciado_em", { withTimezone: true }).notNull().defaultNow(),
    terminadoEm: timestamp("terminado_em", { withTimezone: true }),
    ok: boolean("ok"),
    /** Resumo legível (sem dados pessoais nem segredos). */
    resumo: text("resumo").notNull().default(""),
  },
  (t) => [index("execucoes_automacao_nome").on(t.nome, t.iniciadoEm)],
);

// ---------------------------------------------------------------------------
// Configurações (M1.7): um lugar só para cada regra/texto editável da organização
// ---------------------------------------------------------------------------

/**
 * Configuração da organização por chave ("empresa", "regras_financeiras", "textos_site").
 * O formato de cada valor é validado no código (`src/configuracoes`), e o resto do sistema
 * lê daqui — nada de uma segunda cópia da mesma regra.
 */
export const configuracoes = pgTable(
  "configuracoes",
  {
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    chave: text("chave").notNull(),
    valor: jsonb("valor").notNull(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoPor: uuid("atualizado_por").references(() => usuarios.id),
  },
  (t) => [primaryKey({ columns: [t.organizacaoId, t.chave] })],
);

/**
 * Modelo de mensagem (M1.7) com variáveis como {hospede} e {checkin}. As mensagens
 * programadas (M9.2) e o WhatsApp (M10) usam estes modelos. Arquivar em vez de apagar.
 */
export const modelosMensagem = pgTable(
  "modelos_mensagem",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    nome: text("nome").notNull(),
    /** Quando é usado (texto livre, ex.: "2 dias antes do check-in, 10h"). */
    quando: text("quando").notNull().default(""),
    texto: text("texto").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("modelos_mensagem_nome").on(t.organizacaoId, sql`lower(${t.nome})`)],
);

// ---------------------------------------------------------------------------
// Cadastro completo do imóvel (M2.6): endereço, camas, comodidades, regras da casa,
// horários, taxas, regras de venda e preço. Dinheiro em centavos.
// ---------------------------------------------------------------------------

export const imoveisDetalhes = pgTable("imoveis_detalhes", {
  imovelId: uuid("imovel_id").primaryKey().references(() => imoveis.id),
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  cep: text("cep").notNull().default(""),
  complemento: text("complemento").notNull().default(""),
  estado: text("estado").notNull().default(""),
  /** Quantidade por tipo de cama: { casal: 1, solteiro: 2 }. */
  camas: jsonb("camas").$type<Record<string, number>>().notNull().default({}),
  comodidades: jsonb("comodidades").$type<string[]>().notNull().default([]),
  regrasCasa: text("regras_casa").notNull().default(""),
  aceitaAnimais: boolean("aceita_animais").notNull().default(false),
  permiteFumar: boolean("permite_fumar").notNull().default(false),
  permiteFestas: boolean("permite_festas").notNull().default(false),
  /** "HH:MM" */
  checkinAPartirDe: text("checkin_a_partir_de").notNull().default("15:00"),
  checkoutAte: text("checkout_ate").notNull().default("11:00"),
  taxaLimpeza: integer("taxa_limpeza"),
  hospedeExtraValor: integer("hospede_extra_valor"),
  /** Cobra hóspede extra a partir deste número de hóspedes (inclusive). */
  hospedeExtraAPartirDe: integer("hospede_extra_a_partir_de"),
  estadiaMinima: integer("estadia_minima"),
  estadiaMaxima: integer("estadia_maxima"),
  /** Dias de antecedência mínima para a entrada (0 = pode entrar hoje). */
  antecedenciaMinima: integer("antecedencia_minima"),
  /** Até quantos dias à frente aceita reservas. */
  janelaMaxima: integer("janela_maxima"),
  /** Dias da semana permitidos (0 = domingo … 6 = sábado). Vazio = todos. */
  diasChegada: jsonb("dias_chegada").$type<number[]>().notNull().default([]),
  diasSaida: jsonb("dias_saida").$type<number[]>().notNull().default([]),
  precoBase: integer("preco_base"),
  precoDinamico: boolean("preco_dinamico").notNull().default(false),
  precoMinimo: integer("preco_minimo"),
  precoMaximo: integer("preco_maximo"),
  /** Fonte de preços do imóvel (M3.9): scl (automáticos), beds24 (o SCL só lê) ou manual (cadastro sem ajustes). */
  fontePrecos: text("fonte_precos").$type<FontePrecos>().notNull().default("scl"),
  /** Pisos (centavos) da diária final nas faixas de última hora (M3.7); null = não cadastrado. */
  pisoUltimaHora1: integer("piso_ultima_hora_1"),
  pisoUltimaHora2: integer("piso_ultima_hora_2"),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Exceção por período (M2.6): preço da noite e/ou estadia mínima diferentes entre `inicio` e
 * `fim` (noites, inclusive) — ex.: Réveillon, Carnaval. Períodos do mesmo imóvel não se sobrepõem.
 */
export const imoveisPeriodos = pgTable(
  "imoveis_periodos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    nome: text("nome").notNull(),
    inicio: date("inicio", { mode: "string" }).notNull(),
    fim: date("fim", { mode: "string" }).notNull(),
    precoNoite: integer("preco_noite"),
    estadiaMinima: integer("estadia_minima"),
    criadoEm: criadoEm(),
  },
  (t) => [index("imoveis_periodos_imovel").on(t.imovelId, t.inicio)],
);

// ---------------------------------------------------------------------------
// Adiantamentos (M4.4): como cada adiantamento ao proprietário é quitado, sem dupla cobrança
// ---------------------------------------------------------------------------

export const FORMAS_QUITACAO = ["reembolso", "compensacao", "empresa_assume"] as const;
export type FormaQuitacao = (typeof FORMAS_QUITACAO)[number];

/**
 * Quitação (total ou parcial) de um adiantamento. A soma das quitações ativas nunca passa do
 * valor do adiantamento. `reembolso`: o proprietário devolveu (gera lançamento de reembolso);
 * `compensacao`: descontado no repasse mensal (M4.9, sem lançamento próprio — o repasse já
 * paga o saldo líquido); `empresa_assume`: a empresa absorveu o custo (gera ajuste).
 * Desfazer = marcar `desfeitaEm` e estornar o lançamento gerado.
 */
export const quitacoesAdiantamento = pgTable(
  "quitacoes_adiantamento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    adiantamentoId: uuid("adiantamento_id").notNull().references(() => lancamentos.id),
    forma: text("forma").$type<FormaQuitacao>().notNull(),
    valor: integer("valor").notNull(),
    data: date("data", { mode: "string" }).notNull(),
    lancamentoId: uuid("lancamento_id").references(() => lancamentos.id),
    /** Contestação cuja resolução ("empresa assume") gerou esta quitação — desfazer reabre essa. */
    contestacaoId: uuid("contestacao_id"),
    /** Repasse mensal (M4.9) em que o valor foi descontado — só se desfaz estornando o repasse. */
    repasseId: uuid("repasse_id"),
    nota: text("nota").notNull().default(""),
    /** Chave do envio do formulário: o mesmo envio repetido (clique duplo, reenvio) não duplica. */
    chave: text("chave"),
    criadoPor: uuid("criado_por").references(() => usuarios.id),
    criadoEm: criadoEm(),
    desfeitaEm: timestamp("desfeita_em", { withTimezone: true }),
  },
  (t) => [
    index("quitacoes_adiantamento_adiantamento").on(t.adiantamentoId),
    uniqueIndex("quitacoes_adiantamento_chave").on(t.adiantamentoId, t.chave),
  ],
);

/** Contestação do proprietário sobre um adiantamento: enquanto aberta, ele não é cobrado. */
export const contestacoesAdiantamento = pgTable(
  "contestacoes_adiantamento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    adiantamentoId: uuid("adiantamento_id").notNull().references(() => lancamentos.id),
    motivo: text("motivo").notNull(),
    /** Quanto estava em aberto ao contestar: é o máximo que "empresa assume" absorve por esta contestação. */
    valor: integer("valor").notNull(),
    abertaEm: timestamp("aberta_em", { withTimezone: true }).notNull().defaultNow(),
    resolvidaEm: timestamp("resolvida_em", { withTimezone: true }),
    /** "mantida" (volta a cobrar) | "empresa_assume" */
    resolucao: text("resolucao"),
    notaResolucao: text("nota_resolucao").notNull().default(""),
  },
  (t) => [uniqueIndex("contestacao_aberta_unica").on(t.adiantamentoId).where(sql`${t.resolvidaEm} is null`)],
);

// ---------------------------------------------------------------------------
// Ajustes e divergências (M4.5): diferença encontrada, registrada no dia, sem inventar
// ---------------------------------------------------------------------------

export const ORIGENS_AJUSTE = ["airbnb", "booking", "site", "banco", "mercado_pago", "proprietario", "empresa", "outra", "desconhecida"] as const;
export type OrigemAjuste = (typeof ORIGENS_AJUSTE)[number];

/**
 * Ocorrência de ajuste/divergência. Motivo ou valor desconhecidos ficam registrados como
 * desconhecidos ("Ajuste de reserva — motivo não identificado"; valor null, sem lançamento),
 * com a evidência consultada, e ficam pendentes até serem esclarecidos. A origem só é
 * afirmada quando `origemComprovada`. Com valor, há um lançamento "ajuste" ligado
 * (situação "pendente" até esclarecer; "realizado" depois).
 */
export const ajustes = pgTable(
  "ajustes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    data: date("data", { mode: "string" }).notNull(),
    imovelId: uuid("imovel_id").references(() => imoveis.id),
    reservaId: uuid("reserva_id").references(() => reservas.id),
    proprietarioId: uuid("proprietario_id").references(() => proprietarios.id),
    /** Explicação conhecida; vazio = motivo não identificado. */
    motivo: text("motivo").notNull().default(""),
    origem: text("origem").$type<OrigemAjuste>().notNull().default("desconhecida"),
    origemComprovada: boolean("origem_comprovada").notNull().default(false),
    /** Fontes consultadas (extrato, painel do canal, conversa com o hóspede…). */
    evidencia: text("evidencia").notNull().default(""),
    /** Referência do comprovante privado (link/nome), nunca o arquivo no Git. */
    comprovante: text("comprovante").notNull().default(""),
    /** Centavos com sinal; null = valor ainda desconhecido. */
    valor: integer("valor"),
    /** "empresa" (resultado da empresa) ou "proprietario" (acerto com o proprietário). */
    afeta: text("afeta").notNull().default("empresa"),
    /** Efeito escolhido (entrada/saída; crédito/débito) — guardado mesmo sem valor conhecido. */
    direcao: text("direcao").notNull().default("empresa_saida"),
    esclarecidoEm: timestamp("esclarecido_em", { withTimezone: true }),
    lancamentoId: uuid("lancamento_id").references(() => lancamentos.id),
    criadoPor: uuid("criado_por").references(() => usuarios.id),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ajustes_org_data").on(t.organizacaoId, t.data)],
);

export const SITUACOES_REPASSE = ["a_pagar", "pago", "estornado"] as const;
export type SituacaoRepasse = (typeof SITUACOES_REPASSE)[number];
/** "por_fora" (M4.11): acerto feito fora do sistema, antes do início dele — já pago, sem Pix nem e-mail; só marca o que não pode entrar de novo. */
export const TIPOS_REPASSE = ["fechamento", "antecipado", "por_fora"] as const;
export type TipoRepasse = (typeof TIPOS_REPASSE)[number];
export const SITUACOES_EMAIL_REPASSE = ["pendente", "enviado", "incerto"] as const;
export type SituacaoEmailRepasse = (typeof SITUACOES_EMAIL_REPASSE)[number];
/** Requisição de e-mail de um repasse, guardada na tentativa para a retomada repetir exatamente a mesma (mesma chave de idempotência). */
export type PedidoEmailRepasse = { para: string; copias: string[]; assunto: string; texto: string; anexoArquivoId: string | null; /** Versão em HTML (M5.7); pedidos antigos não têm. */ html?: string };

/** Arquivo guardado no banco (M4.10): comprovante do Pix de um repasse. Privado: só o painel e o dono baixam. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const arquivos = pgTable("arquivos", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  nome: text("nome").notNull(),
  /** Tipo do conteúdo (application/pdf, image/png, image/jpeg). */
  tipo: text("tipo").notNull(),
  tamanho: integer("tamanho").notNull(),
  conteudo: bytea("conteudo").notNull(),
  criadoPor: uuid("criado_por").references(() => usuarios.id),
  criadoEm: criadoEm(),
});

/**
 * Extrato oficial de um canal guardado por imóvel e mês (M5.7): o PDF que o canal emitiu (Airbnb, Booking…), subido pela
 * equipe em Financeiro → Repasses antes do fechamento, vai no fim do relatório do e-mail como emitido. O arquivo fica em
 * `arquivos` (privado, como o comprovante do Pix). Um por imóvel, mês ("AAAA-MM") e canal; subir de novo substitui.
 */
export const extratosCanal = pgTable(
  "extratos_canal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id, { onDelete: "cascade" }),
    /**
     * Favorecido do extrato: o proprietário cujo relatório o anexa. Um imóvel que troca de dono no meio do mês tem
     * dois relatórios; o extrato de um nunca vai no do outro (cada um sobe o seu, com as páginas dele).
     */
    proprietarioId: uuid("proprietario_id").notNull().references(() => proprietarios.id, { onDelete: "cascade" }),
    /** Mês de competência do relatório, "AAAA-MM". */
    mes: text("mes").notNull(),
    /** Canal emissor (origem da reserva: airbnb, booking, outro). */
    canal: text("canal").notNull(),
    arquivoId: uuid("arquivo_id").notNull().references(() => arquivos.id),
    /** Páginas a copiar para o relatório ("1-2, 4"); vazio = todas. */
    paginas: text("paginas").notNull().default(""),
    criadoPor: uuid("criado_por").references(() => usuarios.id),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("extratos_canal_unico").on(t.organizacaoId, t.imovelId, t.proprietarioId, t.mes, t.canal), index("extratos_canal_mes").on(t.organizacaoId, t.mes)],
);

/**
 * Foto real de um imóvel (M7.3, liberado por Diego em 7/10/2026): subida pela equipe na ficha do imóvel, guardada em
 * `arquivos` (como o comprovante e o extrato — fora do Git, sem conta nova). A ordem decide a galeria do site; a
 * primeira é a capa (cartão do site, página do imóvel e capa do relatório mensal). O site só mostra as fotos de imóvel
 * público; sem foto, continua o quadro "foto em breve", nunca uma imagem genérica.
 */
export const fotosImoveis = pgTable(
  "fotos_imoveis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    /** A foto grande (galeria da página do imóvel), já reduzida no navegador antes de subir. */
    arquivoId: uuid("arquivo_id").notNull().references(() => arquivos.id),
    /** A versão pequena (cartões do site, miniaturas e capa do relatório); sem ela, vale a grande. */
    miniaturaId: uuid("miniatura_id").references(() => arquivos.id),
    /** Posição na galeria (0 = capa). */
    ordem: integer("ordem").notNull(),
    /** Texto curto que descreve a foto (vira o texto alternativo no site); vazio = "Foto de {imóvel}". */
    legenda: text("legenda").notNull().default(""),
    criadoPor: uuid("criado_por").references(() => usuarios.id),
    criadoEm: criadoEm(),
  },
  (t) => [index("fotos_imoveis_imovel").on(t.imovelId, t.ordem), uniqueIndex("fotos_imoveis_arquivo").on(t.arquivoId), uniqueIndex("fotos_imoveis_miniatura").on(t.miniaturaId)],
);

/**
 * Repasse ao proprietário. `fechamento` (M4.9): o fechamento de um mês, por competência, com os
 * valores gravados como foram calculados; um ativo por proprietário e mês. `antecipado` (M4.10):
 * repasse programado ou avulso com o que ficou disponível até o dia anterior — um adiantamento
 * vinculado às reservas que o compõem (`repasse_itens`), descontado pelo fechamento porque entra no
 * acerto como lançamento "repasse". Os lançamentos do livro têm a chave `repasse:<id>:<imóvel>[:<mês>]`.
 */
export const repasses = pgTable(
  "repasses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    proprietarioId: uuid("proprietario_id").notNull().references(() => proprietarios.id),
    tipo: text("tipo").$type<TipoRepasse>().notNull().default("fechamento"),
    /** Fechamento: primeiro dia do mês fechado. Antecipado: primeiro dia do mês da data do repasse. */
    mes: date("mes", { mode: "string" }).notNull(),
    /** Data do repasse (fechamento: o dia do fechamento seguinte ao mês fechado, dia 2 por padrão; antecipado: o dia em que foi gerado). */
    data: date("data", { mode: "string" }).notNull(),
    /** Saldo do acerto no fim do mês, antes do repasse (positivo: a empresa devia). */
    saldo: integer("saldo").notNull(),
    /** Adiantamentos descontados neste repasse. */
    descontado: integer("descontado").notNull(),
    /** Adiantamentos contestados, que ficaram de fora (não descontados). */
    contestado: integer("contestado").notNull(),
    /** Valor transferido ao proprietário. */
    valor: integer("valor").notNull(),
    /** M4.10, fechamento: parte da competência que ficou fora (dinheiro ainda não com a empresa); vai para o repasse seguinte. */
    foraDoFechamento: integer("fora_do_fechamento").notNull().default(0),
    /**
     * M8.2e, fechamento: do `foraDoFechamento`, a parte presa por disputa do pagamento (reserva em conferência) e as linhas da
     * disputa que esperam junto (com sinal), gravadas no fechamento. null = fechamento de antes (a divisão é refeita pela
     * linha do tempo, `foraPorDisputaDoFechamento`).
     */
    foraPresaDisputa: integer("fora_presa_disputa"),
    foraSeguradoJunto: integer("fora_segurado_junto"),
    /** M4.10, fechamento: partes já disponíveis com noites fora do mês fechado, pagas neste repasse como adiantamento vinculado. */
    antecipado: integer("antecipado").notNull().default(0),
    situacao: text("situacao").$type<SituacaoRepasse>().notNull().default("a_pagar"),
    dataPagamento: date("data_pagamento", { mode: "string" }),
    /** M4.10: identificador da transação Pix (ou nota) e/ou arquivo do comprovante do banco. */
    comprovante: text("comprovante").notNull().default(""),
    comprovanteArquivoId: uuid("comprovante_arquivo_id").references(() => arquivos.id),
    /** M4.10: e-mail ao proprietário com o comprovante e as reservas (sai uma vez, depois de pago com comprovante). */
    emailSituacao: text("email_situacao").$type<SituacaoEmailRepasse>().notNull().default("pendente"),
    emailEm: timestamp("email_em", { withTimezone: true }),
    emailPara: text("email_para").notNull().default(""),
    /** Chave de idempotência usada na última tentativa de e-mail (uma retomada repete exatamente esta chave). */
    emailChave: text("email_chave").notNull().default(""),
    /** Quando a última tentativa de envio começou (token da reivindicação e janela de 15 min); `emailEm` guarda a primeira. */
    emailTentativaEm: timestamp("email_tentativa_em", { withTimezone: true }),
    /** O pedido exato da última tentativa (destinatários, assunto, texto, anexo): a retomada repete isto, não as linhas atuais. */
    emailPedido: jsonb("email_pedido").$type<PedidoEmailRepasse>(),
    /** Chave Pix do proprietário no momento do pagamento (o e-mail e o histórico mostram a que foi usada, não a atual). */
    chavePixPaga: text("chave_pix_paga").notNull().default(""),
    /** Antecipado avulso pedido pelo proprietário no portal (null = programado ou gerado no painel). */
    pedidoEm: timestamp("pedido_em", { withTimezone: true }),
    motivoEstorno: text("motivo_estorno").notNull().default(""),
    criadoPor: uuid("criado_por").references(() => usuarios.id),
    criadoEm: criadoEm(),
    estornadoEm: timestamp("estornado_em", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("repasses_um_por_mes").on(t.proprietarioId, t.mes).where(sql`${t.estornadoEm} is null and ${t.tipo} = 'fechamento'`),
    uniqueIndex("repasses_um_antecipado_por_dia").on(t.proprietarioId, t.data).where(sql`${t.estornadoEm} is null and ${t.tipo} = 'antecipado'`),
    index("repasses_org_mes").on(t.organizacaoId, t.mes),
  ],
);

/**
 * Parte de reserva que compõe um repasse (M4.10): o lançamento "direito_proprietario" de um mês de
 * competência, pago (inteiro) por este repasse. Vínculo único enquanto o repasse vale: o mesmo
 * lançamento nunca compõe dois repasses; estornar o repasse libera os itens (`liberadoEm`).
 */
export const repasseItens = pgTable(
  "repasse_itens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    repasseId: uuid("repasse_id").notNull().references(() => repasses.id),
    lancamentoId: uuid("lancamento_id").notNull().references(() => lancamentos.id),
    reservaId: uuid("reserva_id").notNull().references(() => reservas.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    /** Mês de competência da parte ("AAAA-MM-01"). */
    competencia: date("competencia", { mode: "string" }).notNull(),
    valor: integer("valor").notNull(),
    criadoEm: criadoEm(),
    liberadoEm: timestamp("liberado_em", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("repasse_itens_lancamento_unico").on(t.lancamentoId).where(sql`${t.liberadoEm} is null`),
    index("repasse_itens_repasse").on(t.repasseId),
    index("repasse_itens_reserva").on(t.reservaId),
  ],
);

export const ESTADOS_MANUTENCAO = ["pedida", "orcada", "aprovada", "realizada", "recusada", "cancelada"] as const;
export type EstadoManutencao = (typeof ESTADOS_MANUTENCAO)[number];

/**
 * Manutenção (M6.2): pedido → orçamento → aprovação de Diego (com quem paga) → execução →
 * custo lançado como despesa (M4.3). Receber orçamento não autoriza executar.
 */
export const manutencoes = pgTable(
  "manutencoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    titulo: text("titulo").notNull(),
    descricao: text("descricao").notNull().default(""),
    estado: text("estado").$type<EstadoManutencao>().notNull().default("pedida"),
    /** Quem vai fazer (orçamento). */
    fornecedor: text("fornecedor").notNull().default(""),
    /** Centavos; null = sem orçamento ainda. */
    orcamento: integer("orcamento"),
    /** Definido por Diego na aprovação; null = a definir (nunca por suposição). */
    responsavel: text("responsavel").$type<"empresa" | "proprietario">(),
    /** Proprietário que paga, gravado na aprovação (se o imóvel mudar de dono depois, não passa para o novo). */
    proprietarioId: uuid("proprietario_id").references(() => proprietarios.id),
    aprovadaPor: uuid("aprovada_por").references(() => usuarios.id),
    aprovadaEm: timestamp("aprovada_em", { withTimezone: true }),
    dataRealizada: date("data_realizada", { mode: "string" }),
    /** Despesa lançada com o custo final (livro de lançamentos). */
    despesaId: uuid("despesa_id").references(() => lancamentos.id),
    /** M12.4: feita pelo proprietário por conta própria (marketplace) — sem custo para a empresa, nunca entra no fluxo de lançar custo. */
    semCusto: boolean("sem_custo").notNull().default(false),
    observacao: text("observacao").notNull().default(""),
    criadoPor: uuid("criado_por").references(() => usuarios.id),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("manutencoes_org_estado").on(t.organizacaoId, t.estado), index("manutencoes_imovel").on(t.imovelId)],
);

/** Profissional de limpeza (M6.1), editável no painel. Não se apaga quem já fez limpeza: arquiva-se. */
export const profissionaisLimpeza = pgTable(
  "profissionais_limpeza",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    nome: text("nome").notNull(),
    telefone: text("telefone").notNull().default(""),
    observacoes: text("observacoes").notNull().default(""),
    ativo: boolean("ativo").notNull().default(true),
    /** Acesso próprio pelo celular (M6.6): o usuário (papel "limpeza") desta profissional. */
    usuarioId: uuid("usuario_id").references(() => usuarios.id),
    /**
     * Cidades da agenda que ela vê no acesso próprio (M6.8: Búzios só Búzios, Rio só Rio), com o nome da cidade como
     * no cadastro dos imóveis. Vazio = nenhuma: a tela avisa que falta escolher, nunca mostra todas.
     */
    cidades: jsonb("cidades").$type<string[]>().notNull().default([]),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("profissionais_limpeza_nome").on(t.organizacaoId, sql`lower(${t.nome})`), uniqueIndex("profissionais_limpeza_usuario").on(t.usuarioId)],
);

export const ESTADOS_LIMPEZA = ["pedida", "confirmada", "realizada", "cancelada"] as const;
export type EstadoLimpeza = (typeof ESTADOS_LIMPEZA)[number];

/**
 * Limpeza (M6.1). A de reserva nasce "pedida" no dia do checkout; confirmar e realizar são
 * registros separados (agendar não comprova execução). Uma por reserva.
 */
export const limpezas = pgTable(
  "limpezas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    /** Reserva cujo checkout gerou a limpeza; null = limpeza avulsa. */
    reservaId: uuid("reserva_id").references(() => reservas.id),
    data: date("data", { mode: "string" }).notNull(),
    estado: text("estado").$type<EstadoLimpeza>().notNull().default("pedida"),
    profissionalId: uuid("profissional_id").references(() => profissionaisLimpeza.id),
    /** Centavos; null = custo ainda não informado. */
    custo: integer("custo"),
    /** M12.4: feita pelo proprietário por conta própria (marketplace), custo 0 de propósito; reabrir limpa a marca e o custo. */
    semCusto: boolean("sem_custo").notNull().default(false),
    observacao: text("observacao").notNull().default(""),
    /** Cancelada à mão (não pela reserva): a sincronização não a reabre. */
    canceladaManual: boolean("cancelada_manual").notNull().default(false),
    /** Despesa da empresa com o custo desta limpeza (livro de lançamentos). */
    despesaId: uuid("despesa_id").references(() => lancamentos.id),
    confirmadaEm: timestamp("confirmada_em", { withTimezone: true }),
    realizadaEm: timestamp("realizada_em", { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("limpezas_uma_por_reserva").on(t.reservaId).where(sql`${t.reservaId} is not null`),
    index("limpezas_org_data").on(t.organizacaoId, t.data),
  ],
);

/**
 * Documentos de portaria (M6.4): só a lista de controle por reserva — datas dos pedidos, quantos
 * hóspedes já mandaram documento, encaminhamento e entrega. Nenhum documento, número ou foto é
 * guardado aqui (nem no Git): eles ficam no canal privado.
 */
export const portariaChecklists = pgTable("portaria_checklists", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  reservaId: uuid("reserva_id")
    .notNull()
    .unique()
    .references(() => reservas.id),
  avisoInicialEm: date("aviso_inicial_em", { mode: "string" }),
  segundoPedidoEm: date("segundo_pedido_em", { mode: "string" }),
  pedidoFinalEm: date("pedido_final_em", { mode: "string" }),
  /** Quantos hóspedes já mandaram documento (só a contagem). */
  documentosRecebidos: integer("documentos_recebidos").notNull().default(0),
  /** Destinatário da portaria conferido antes de encaminhar (o contato fica em referência restrita). */
  destinatarioConferido: boolean("destinatario_conferido").notNull().default(false),
  encaminhadoEm: date("encaminhado_em", { mode: "string" }),
  entregaConfirmadaEm: date("entrega_confirmada_em", { mode: "string" }),
  /** Datas da estada quando foi encaminhado: se a reserva mudar de data, é preciso encaminhar de novo. */
  encaminhadoCheckin: date("encaminhado_checkin", { mode: "string" }),
  encaminhadoCheckout: date("encaminhado_checkout", { mode: "string" }),
  /** Imóvel da reserva quando a lista foi mexida: se a reserva mudar de imóvel, destinatário e envio valem de novo do zero. */
  imovelId: uuid("imovel_id").references(() => imoveis.id),
  /** Hóspedes da reserva ("nome|quantidade") quando a lista foi mexida: se mudarem, documentos e envio recomeçam. */
  hospedesReferencia: text("hospedes_referencia"),
  /** Pendência concreta (falha de entrega, dúvida de correspondência…); vazio = nenhuma. */
  pendencia: text("pendencia").notNull().default(""),
  criadoEm: criadoEm(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Rotinas recorrentes (M6.5): tarefas que se repetem (conferência semanal das faxinas,
// consulta quinzenal de manutenção, lembrete mensal…), editáveis no painel.
// ---------------------------------------------------------------------------

export const FREQUENCIAS_ROTINA = ["semanal", "quinzenal", "mensal", "anual"] as const;
export type FrequenciaRotina = (typeof FREQUENCIAS_ROTINA)[number];

export const rotinas = pgTable(
  "rotinas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    titulo: text("titulo").notNull(),
    descricao: text("descricao").notNull().default(""),
    frequencia: text("frequencia").$type<FrequenciaRotina>().notNull(),
    /** Próxima vez que a rotina vence. */
    proximaData: date("proxima_data", { mode: "string" }).notNull(),
    /** Data de referência do ritmo (a informada no cadastro): o fim de mês continua no fim de mês. */
    ancora: date("ancora", { mode: "string" }).notNull(),
    /** Arquivada = não aparece mais como pendente; o histórico fica. */
    ativa: boolean("ativa").notNull().default(true),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rotinas_org_ativa").on(t.organizacaoId, t.ativa)],
);

/** Cada vez que uma rotina foi feita (ou pulada, com motivo): uma por vencimento. */
export const rotinaExecucoes = pgTable(
  "rotina_execucoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    rotinaId: uuid("rotina_id")
      .notNull()
      .references(() => rotinas.id),
    /** Vencimento que esta execução cobre. */
    prevista: date("prevista", { mode: "string" }).notNull(),
    /** Dia em que foi feita (ou em que se decidiu pular). */
    feitaEm: date("feita_em", { mode: "string" }).notNull(),
    pulada: boolean("pulada").notNull().default(false),
    observacao: text("observacao").notNull().default(""),
    usuarioId: uuid("usuario_id").references(() => usuarios.id),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("rotina_execucoes_prevista").on(t.rotinaId, t.prevista)],
);

// ---------------------------------------------------------------------------
// Mensagens programadas ao hóspede (M9.2): um registro por mensagem (reserva + tipo + datas),
// gravado antes de chamar o provedor — é ele que impede mandar a mesma mensagem duas vezes.
// ---------------------------------------------------------------------------

/**
 * Do cancelamento de reserva paga pelo site (M8.2c): pedido recebido, decisão e devolução feita (que serve também à
 * devolução de uma alteração). Da alteração (M8.2d): a proposta (em qualquer direção) e a confirmação.
 */
export const TIPOS_MENSAGEM_HOSPEDE = [
  "confirmacao",
  "checkin",
  "checkout",
  "agradecimento",
  "cancelamento_recebido",
  "cancelamento_decidido",
  "devolucao_concluida",
  "alteracao_proposta",
  "alteracao_confirmada",
] as const;
export type TipoMensagemHospede = (typeof TIPOS_MENSAGEM_HOSPEDE)[number];
/** enviando: pedido em curso (se ficar assim, não se sabe se saiu); incerto: sem confirmação do provedor. */
export const ESTADOS_ENVIO_HOSPEDE = ["enviando", "enviado", "falhou", "incerto"] as const;
export type EstadoEnvioHospede = (typeof ESTADOS_ENVIO_HOSPEDE)[number];

export const mensagensHospede = pgTable(
  "mensagens_hospede",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    reservaId: uuid("reserva_id").notNull().references(() => reservas.id),
    tipo: text("tipo").$type<TipoMensagemHospede>().notNull(),
    /** Datas da reserva a que a mensagem se refere: mudou a data, é outra mensagem. */
    referencia: text("referencia").notNull(),
    estado: text("estado").$type<EstadoEnvioHospede>().notNull(),
    tentativas: integer("tentativas").notNull().default(1),
    para: text("para").notNull(),
    /** Nome do modelo usado (o modelo pode ser editado ou arquivado depois). */
    modeloNome: text("modelo_nome").notNull(),
    erro: text("erro").notNull().default(""),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mensagens_hospede_unica").on(t.reservaId, t.tipo, t.referencia), index("mensagens_hospede_org").on(t.organizacaoId, t.criadoEm)],
);

// ---------------------------------------------------------------------------
// Cadastro público do marketplace (M12.3): o proprietário confirma o e-mail, manda os dados dele
// e do imóvel, e fica "pendente" até a equipe revisar. Aprovar cria o proprietário, o imóvel (não
// público) e o convite do portal; nada é publicado sem essa revisão.
// ---------------------------------------------------------------------------

export const SITUACOES_CADASTRO = ["pendente", "aprovado", "recusado"] as const;
export type SituacaoCadastro = (typeof SITUACOES_CADASTRO)[number];
export const ANUNCIO_CADASTRO = ["ja_anuncio", "novo"] as const;
export type AnuncioCadastro = (typeof ANUNCIO_CADASTRO)[number];

export type ImovelCadastro = {
  nome: string;
  bairro: string;
  cidade: string;
  endereco: string;
  capacidade: number;
  quartos: number | null;
  banheiros: number | null;
  descricao: string;
};

export const cadastrosMarketplace = pgTable(
  "cadastros_marketplace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    /** E-mail confirmado por código antes do envio. */
    email: text("email").notNull(),
    nome: text("nome").notNull(),
    tipo: tipoPessoaEnum("tipo").notNull().default("fisica"),
    telefone: text("telefone").notNull(),
    imovel: jsonb("imovel").$type<ImovelCadastro>().notNull(),
    anuncio: text("anuncio").$type<AnuncioCadastro>().notNull(),
    /** Links dos anúncios que já existem (Airbnb, Booking…), quando "já anuncio". */
    links: jsonb("links").$type<string[]>().notNull().default([]),
    situacao: text("situacao").$type<SituacaoCadastro>().notNull().default("pendente"),
    motivoRecusa: text("motivo_recusa").notNull().default(""),
    decididoEm: timestamp("decidido_em", { withTimezone: true }),
    decididoPor: uuid("decidido_por").references(() => usuarios.id),
    proprietarioId: uuid("proprietario_id").references(() => proprietarios.id),
    imovelId: uuid("imovel_id").references(() => imoveis.id),
    criadoEm: criadoEm(),
    /**
     * Autorização da caixa obrigatória do formulário (M7.14, 15/10/2026): `autorizadoEm` é quando o envio com a caixa
     * marcada chegou ao servidor (relógio do servidor, igual a `criadoEm`; a hora do clique no navegador não é guardada);
     * com a versão e o texto exato da caixa, montado pelo servidor (`proprietarios/autorizacao.ts`), no mesmo insert do
     * envio. Os três juntos ou nenhum; nenhum = enviado antes deste item (o painel avisa, sem palpite). Sem IP nem navegador.
     */
    autorizadoEm: timestamp("autorizado_em", { withTimezone: true }),
    autorizacaoVersao: integer("autorizacao_versao"),
    autorizacaoTexto: text("autorizacao_texto"),
  },
  (t) => [
    index("cadastros_marketplace_org").on(t.organizacaoId, t.situacao, t.criadoEm),
    index("cadastros_marketplace_email").on(t.email),
    // Registro da autorização inteiro ou nenhum (M7.14); "is not null" explícito porque um CHECK que dá null passa.
    check(
      "cadastros_marketplace_autorizacao",
      sql`(${t.autorizadoEm} is null and ${t.autorizacaoVersao} is null and ${t.autorizacaoTexto} is null) or (${t.autorizadoEm} is not null and ${t.autorizacaoVersao} is not null and ${t.autorizacaoTexto} is not null and ${t.autorizacaoVersao} > 0 and ${t.autorizacaoTexto} <> '')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Pedido de contato para a gestão completa (M7.7): o proprietário deixa os dados na página
// "Anuncie seu imóvel" do site e a equipe responde por e-mail ou WhatsApp. Não cria conta,
// proprietário nem imóvel; fica "novo" até a equipe marcar como respondido ou arquivar.
// ---------------------------------------------------------------------------

export const SITUACOES_PEDIDO_CONTATO = ["novo", "respondido", "arquivado"] as const;
export type SituacaoPedidoContato = (typeof SITUACOES_PEDIDO_CONTATO)[number];

export const pedidosContatoProprietario = pgTable(
  "pedidos_contato_proprietario",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    nome: text("nome").notNull(),
    /** Normalizado (minúsculas, sem espaços nas pontas). Não é confirmado por código. */
    email: text("email").notNull(),
    telefone: text("telefone").notNull(),
    bairro: text("bairro").notNull(),
    cidade: text("cidade").notNull(),
    /** 0 = studio; null = não informou. */
    quartos: integer("quartos"),
    /** Já anuncia em alguma plataforma? null = não informou. */
    anunciaHoje: boolean("anuncia_hoje"),
    mensagem: text("mensagem").notNull().default(""),
    situacao: text("situacao").$type<SituacaoPedidoContato>().notNull().default("novo"),
    /** Nota interna da equipe (nunca aparece para a pessoa). */
    nota: text("nota").notNull().default(""),
    criadoEm: criadoEm(),
    decididoEm: timestamp("decidido_em", { withTimezone: true }),
    decididoPor: uuid("decidido_por").references(() => usuarios.id, { onDelete: "set null" }),
    /**
     * Autorização da caixa obrigatória do formulário (M7.14, 15/10/2026): `autorizadoEm` é quando o envio com a caixa
     * marcada chegou ao servidor (relógio do servidor, igual a `criadoEm`; a hora do clique no navegador não é guardada);
     * com a versão e o texto exato da caixa, montado pelo servidor (`proprietarios/autorizacao.ts`), no mesmo insert do
     * envio. Os três juntos ou nenhum; nenhum = enviado antes deste item (o painel avisa, sem palpite). Sem IP nem navegador.
     */
    autorizadoEm: timestamp("autorizado_em", { withTimezone: true }),
    autorizacaoVersao: integer("autorizacao_versao"),
    autorizacaoTexto: text("autorizacao_texto"),
  },
  (t) => [
    index("pedidos_contato_proprietario_org").on(t.organizacaoId, t.situacao, t.criadoEm),
    // Tetos do formulário público: por e-mail em 24 h e no total por hora.
    index("pedidos_contato_proprietario_email").on(t.organizacaoId, t.email, t.criadoEm),
    index("pedidos_contato_proprietario_criado").on(t.organizacaoId, t.criadoEm),
    // Registro da autorização inteiro ou nenhum (M7.14); "is not null" explícito porque um CHECK que dá null passa.
    check(
      "pedidos_contato_proprietario_autorizacao",
      sql`(${t.autorizadoEm} is null and ${t.autorizacaoVersao} is null and ${t.autorizacaoTexto} is null) or (${t.autorizadoEm} is not null and ${t.autorizacaoVersao} is not null and ${t.autorizacaoTexto} is not null and ${t.autorizacaoVersao} > 0 and ${t.autorizacaoTexto} <> '')`,
    ),
  ],
);


/** Registros efetivamente alterados por execução; gravados na mesma transação da importação. */
export const beds24ExecucaoReservas = pgTable("beds24_execucao_reservas", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  execucaoId: uuid("execucao_id").notNull().references(() => beds24Execucoes.id),
  reservaId: uuid("reserva_id").notNull().references(() => reservas.id),
  tipo: text("tipo").$type<"adicionada" | "alterada" | "cancelada">().notNull(),
}, t => [uniqueIndex("beds24_execucao_reserva_unica").on(t.execucaoId, t.reservaId), index("beds24_execucao_reservas_org").on(t.organizacaoId, t.execucaoId)]);

// ---------------------------------------------------------------------------
// Envio de calendário e preços ao Beds24 (M3.7): histórico privado antes/depois
// ---------------------------------------------------------------------------

/** Uma execução de envio (manual, simulação ou automática), sem payload do provedor. */
export const beds24Envios = pgTable("beds24_envios", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  iniciadoEm: timestamp("iniciado_em", { withTimezone: true }).notNull().defaultNow(),
  terminadoEm: timestamp("terminado_em", { withTimezone: true }),
  /** "simulacao" não grava nada no Beds24. */
  modo: text("modo").$type<"simulacao" | "envio">().notNull(),
  automatica: boolean("automatica").notNull().default(false),
  situacao: text("situacao").notNull().default("executando"),
  resumo: text("resumo").notNull().default(""),
  avisos: jsonb("avisos").$type<string[]>().notNull().default([]),
  noitesEnviadas: integer("noites_enviadas").notNull().default(0),
  noitesConfirmadas: integer("noites_confirmadas").notNull().default(0),
  noitesDivergentes: integer("noites_divergentes").notNull().default(0),
  /** Impressão (tipo + hash truncado) da credencial Beds24 usada nesta execução — nunca a credencial: o veredito por imóvel só vale enquanto a credencial for esta. */
  credencial: text("credencial").notNull().default(""),
}, t => [index("beds24_envios_org").on(t.organizacaoId, t.iniciadoEm)]);

/** Antes/depois de cada noite enviada: regra usada e resultado da conferência. */
export const beds24EnvioNoites = pgTable("beds24_envio_noites", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  envioId: uuid("envio_id").notNull().references(() => beds24Envios.id),
  imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
  data: date("data", { mode: "string" }).notNull(),
  precoAntes: integer("preco_antes"),
  precoEnviado: integer("preco_enviado"),
  minimoAntes: integer("minimo_antes"),
  minimoEnviado: integer("minimo_enviado"),
  maximoEnviado: integer("maximo_enviado"),
  bloqueioAntes: text("bloqueio_antes"),
  bloqueioEnviado: text("bloqueio_enviado"),
  regra: text("regra").notNull().default(""),
  resultado: text("resultado").$type<"enviado" | "confirmado" | "divergente" | "falhou">().notNull(),
  detalhe: text("detalhe").notNull().default(""),
}, t => [index("beds24_envio_noites_envio").on(t.envioId), index("beds24_envio_noites_imovel").on(t.organizacaoId, t.imovelId, t.data)]);

/** Imóveis incluídos em cada execução (mesmo sem noite a enviar): o "último envio" por imóvel lê daqui, não das noites. */
export const beds24EnvioImoveis = pgTable("beds24_envio_imoveis", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  envioId: uuid("envio_id").notNull().references(() => beds24Envios.id),
  imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
  /** Par propriedade/quarto do Beds24 que esta execução validou para o imóvel: veredito só vale enquanto o vínculo for este. */
  propertyId: text("property_id").notNull().default(""),
  roomId: text("room_id").notNull().default(""),
  /**
   * Por que este imóvel ficou de fora nesta execução (quarto inacessível à credencial, moeda, leitura, escrita recusada).
   * Nasce "pendente" e só fica vazio quando a execução termina com o imóvel incluído: execução interrompida nunca vale como sucesso.
   */
  falha: text("falha").notNull().default(""),
}, t => [index("beds24_envio_imoveis_imovel").on(t.organizacaoId, t.imovelId), index("beds24_envio_imoveis_envio").on(t.envioId)]);

/** Último valor que o SCL enviou por noite: idempotência e liberação só do que o SCL bloqueou. */
export const beds24CalendarioEnviado = pgTable("beds24_calendario_enviado", {
  organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
  imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
  data: date("data", { mode: "string" }).notNull(),
  preco: integer("preco"),
  minimo: integer("minimo"),
  maximo: integer("maximo"),
  bloqueio: text("bloqueio"),
  /** Restrição que o Beds24 tinha antes do blackout do SCL (noCheckIn etc.), devolvida na reabertura. */
  bloqueioAnterior: text("bloqueio_anterior"),
  /** Quarto Beds24 que recebeu o envio: a posse de um bloqueio vale só para esse quarto; vínculo trocado descarta o estado. */
  roomId: text("room_id"),
  enviadoEm: timestamp("enviado_em", { withTimezone: true }).notNull(),
  confirmado: boolean("confirmado").notNull().default(false),
  envioId: uuid("envio_id").references(() => beds24Envios.id),
}, t => [primaryKey({ columns: [t.organizacaoId, t.imovelId, t.data] })]);

// ---------------------------------------------------------------------------
// Pagamento no site (M8.2a): tentativas de pagamento, devoluções e avisos do provedor.
// Nada de CPF, e-mail ou nome do pagador; nada de resposta crua do provedor.
// ---------------------------------------------------------------------------

/**
 * Situação local de uma tentativa. `criando` = gravada antes da chamada ao provedor; `incerta` = a chamada
 * caiu e não se sabe se a order existe. As outras vêm sempre de uma leitura do provedor (nunca do relógio).
 */
export const SITUACOES_PAGAMENTO = ["criando", "incerta", "pendente", "aprovado", "recusado", "cancelado", "expirado", "devolvido", "devolvido_parcial", "contestado"] as const;
export type SituacaoPagamento = (typeof SITUACOES_PAGAMENTO)[number];
/**
 * O que foi feito do dinheiro aprovado: confirmou a reserva, pagou a diferença de uma alteração aplicada (M8.2d), foi
 * devolvido pelo provedor, devolvido por fora, ou (só no pagamento sem reserva) voltou ao pagador por uma disputa
 * perdida (M8.2e).
 */
export const DESFECHOS_PAGAMENTO = ["reserva", "alteracao", "devolucao", "por_fora", "contestacao"] as const;
export type DesfechoPagamento = (typeof DESFECHOS_PAGAMENTO)[number];
/**
 * `substituida` (M8.2d): devolução de uma alteração que nunca chegou ao Mercado Pago e foi absorvida pela devolução de um
 * cancelamento integral. Não compromete nada, nunca é enviada e fica no histórico.
 */
export const SITUACOES_DEVOLUCAO = ["pedida", "confirmada", "recusada", "por_fora", "substituida"] as const;
export type SituacaoDevolucao = (typeof SITUACOES_DEVOLUCAO)[number];
export const RESULTADOS_EVENTO_PAGAMENTO = ["pendente", "aplicado", "ignorado", "desconhecido", "erro"] as const;
export type ResultadoEventoPagamento = (typeof RESULTADOS_EVENTO_PAGAMENTO)[number];
/**
 * Etapa de um cartão ainda `pendente` (M8.2b): o banco pediu a verificação ao hóspede (desafio 3DS), o Mercado Pago está
 * analisando (in_review) ou processando em segundo plano. A situação local continua `pendente`; a etapa só muda texto,
 * prazo das datas, intervalo de leitura e o que dá para cancelar.
 */
export const ETAPAS_CARTAO = ["desafio", "analise", "processando"] as const;
export type EtapaCartao = (typeof ETAPAS_CARTAO)[number];
/** Quem pediu ao provedor o cancelamento de uma tentativa: o hóspede (trocou de forma ou de cartão), o sistema ou a equipe. */
export const QUEM_CANCELA_PAGAMENTO = ["hospede", "sistema", "equipe"] as const;
export type QuemCancelaPagamento = (typeof QUEM_CANCELA_PAGAMENTO)[number];

/**
 * Aceite das páginas legais do site (M7.4): o hóspede marca "li e aceito" antes de gerar o pagamento. Uma linha por
 * aceite, com as versões dos três documentos e quando. Só inclusão. Sem dado pessoal: a pessoa é a da reserva
 * (cotação → reserva), e o IP não é guardado (a autorização é o cookie assinado do pedido).
 */
export const aceitesSite = pgTable(
  "aceites_site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    cotacaoId: uuid("cotacao_id").notNull().references(() => cotacoes.id),
    reservaId: uuid("reserva_id").notNull().references(() => reservas.id),
    versaoTermos: integer("versao_termos").notNull(),
    versaoPrivacidade: integer("versao_privacidade").notNull(),
    versaoCancelamento: integer("versao_cancelamento").notNull(),
    /** Onde a caixa foi marcada: "pix" (M7.4) ou "cartao" (M8.2b). */
    origem: text("origem").$type<"pix" | "cartao">().notNull(),
    aceitoEm: timestamp("aceito_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("aceites_site_unico").on(t.cotacaoId, t.versaoTermos, t.versaoPrivacidade, t.versaoCancelamento),
    index("aceites_site_reserva").on(t.reservaId),
    index("aceites_site_organizacao").on(t.organizacaoId, t.aceitoEm),
  ],
);

/**
 * Uma tentativa de pagamento (uma order do provedor, que aceita uma transação). `valor` é o que enviamos
 * (= `cotacoes.total`, ou a diferença de uma alteração da reserva, M8.2d); `valorPago` só para mostrar. `taxa` = valor − líquido, numa leitura só. A liberação
 * prevista não libera nada; o recebimento no livro só nasce com o sinal explícito do provedor ou à mão.
 * Copia e cola e imagem do Pix são apagados quando o Pix vence ou é pago.
 */
export const pagamentos = pgTable(
  "pagamentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    cotacaoId: uuid("cotacao_id").notNull().references(() => cotacoes.id),
    reservaId: uuid("reserva_id").notNull().references(() => reservas.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    /** Ambiente do provedor quando a tentativa foi criada (na parte a, sempre "teste"). */
    ambiente: text("ambiente").$type<"teste" | "producao">().notNull(),
    forma: text("forma").$type<"pix" | "cartao">().notNull(),
    /** `external_reference` (scl-<id>), única por organização. */
    referencia: text("referencia").notNull(),
    /** Chave de idempotência da criação, gravada antes da chamada. */
    chaveIdempotencia: text("chave_idempotencia").notNull(),
    situacao: text("situacao").$type<SituacaoPagamento>().notNull().default("criando"),
    /** Id da order no provedor (ORD…). */
    idProvedor: text("id_provedor"),
    /** `live_mode` lido do provedor; null = não informado. */
    aoVivo: boolean("ao_vivo"),
    /** "status/status_detail" do provedor (só códigos curtos). */
    detalheProvedor: text("detalhe_provedor").notNull().default(""),
    valor: integer("valor").notNull(),
    valorPago: integer("valor_pago"),
    taxa: integer("taxa"),
    liquido: integer("liquido"),
    liberacaoPrevistaEm: timestamp("liberacao_prevista_em", { withTimezone: true }),
    liberacaoConfirmadaEm: timestamp("liberacao_confirmada_em", { withTimezone: true }),
    /** Quem confirmou a liberação: o provedor (sinal explícito) ou a equipe (à mão). */
    liberacaoOrigem: text("liberacao_origem").$type<"provedor" | "manual">(),
    pixCopiaECola: text("pix_copia_e_cola"),
    pixImagem: text("pix_imagem"),
    pixLink: text("pix_link"),
    pixExpiraEm: timestamp("pix_expira_em", { withTimezone: true }),
    /** Primeira leitura do provedor com a situação aprovada. */
    aprovadoEm: timestamp("aprovado_em", { withTimezone: true }),
    consultadoEm: timestamp("consultado_em", { withTimezone: true }),
    financeiroConsultadoEm: timestamp("financeiro_consultado_em", { withTimezone: true }),
    desfecho: text("desfecho").$type<DesfechoPagamento>(),
    desfechoMotivo: text("desfecho_motivo"),
    /** null = o sistema. */
    desfechoPor: uuid("desfecho_por").references(() => usuarios.id, { onDelete: "set null" }),
    desfechoEm: timestamp("desfecho_em", { withTimezone: true }),
    /** Aprovado sem reserva: o motivo (código), gravado na mesma transação da aprovação. Depois disso só a equipe decide. */
    motivoSemReserva: text("motivo_sem_reserva"),
    /** Códigos de aviso (lista fechada em pagamentos/situacoes.ts). */
    avisos: jsonb("avisos").$type<string[]>().notNull().default([]),
    /**
     * Aceite das páginas legais que valia quando esta tentativa foi criada; M8.2c calcula a devolução pela política
     * dessa versão. Null só nas tentativas de antes do M7.4.
     */
    aceiteId: uuid("aceite_id").references(() => aceitesSite.id),
    // --- Cartão (M8.2b). Nunca BIN, últimos dígitos, titular, documento, token ou o id do aparelho.
    /** Parcelas enviadas (1 a 36), atualizadas pela leitura só com valor válido; null no Pix. */
    parcelas: integer("parcelas"),
    /** payment_method_id (visa, master, elo…), atualizado pela leitura. */
    bandeira: text("bandeira"),
    /** Verificação do banco (3DS) pedida: retrato do painel na criação. */
    tresDS: text("tres_ds").$type<ModoTresDS>(),
    /** Último resultado da verificação do banco lido do provedor (lista fechada, maiúsculo). */
    tresDSStatus: text("tres_ds_status").$type<StatusTresDS>(),
    /** Só com a situação `pendente`; null nas outras. */
    etapaCartao: text("etapa_cartao").$type<EtapaCartao>(),
    /** Endereço do desafio 3DS (https de domínio do Mercado Pago); apagado quando a etapa deixa de ser `desafio`. */
    desafioUrl: text("desafio_url"),
    /** Prazo das datas dado pela extensão única de cartão em análise/processando (preenchido = a cotação já usou a extensão). */
    prazoAnaliseAte: timestamp("prazo_analise_ate", { withTimezone: true }),
    /** O pedido trouxe um id de aparelho válido (o id em si nunca é guardado). */
    comDispositivo: boolean("com_dispositivo"),
    /** Primeira vez que a tentativa saiu de "em andamento" para recusado, cancelado ou expirado (qualquer forma). */
    encerradoEm: timestamp("encerrado_em", { withTimezone: true }),
    /** Quem pediu ao provedor o cancelamento desta tentativa (gravado na fila do cancelamento, só se vazio). */
    cancelamentoPor: text("cancelamento_por").$type<QuemCancelaPagamento>(),
    /** Esta tentativa de cartão encerrada conta no disjuntor de recusas (decidido uma vez, na transição que a encerra). */
    contaNoDisjuntor: boolean("conta_no_disjuntor").notNull().default(false),
    /** Id numérico do pagamento na Payments API (as contestações chegam por ele, no M8.2e). */
    idPagamentoProvedor: text("id_pagamento_provedor"),
    /**
     * Centavos do custo do "parcelamento sem acréscimo" cobrado da SCL (financing_fee que não é do comprador), da última
     * leitura da Payments API que o trouxe; null = não lido. Com ele > 0 a taxa não entra sozinha (aviso `parcelas_sem_juros`).
     */
    custoParcelasVendedor: integer("custo_parcelas_vendedor"),
    // --- O que a última leitura da order mostrou das devoluções (M8.2c): só valores, nunca dado pessoal.
    /** Centavos já devolvidos (`Cobranca.devolvido`) na última leitura que bateu com a tentativa. */
    devolvidoLido: integer("devolvido_lido").notNull().default(0),
    /** A última leitura que bateu mostrou devolução em andamento (`Cobranca.devolucaoEmAndamento`). */
    devolucaoEmAndamentoLida: boolean("devolucao_em_andamento_lida").notNull().default(false),
    /** Primeira leitura com a situação `devolvido` (gravada uma vez só): o dia em que o dinheiro voltou ao hóspede. */
    devolvidoVistoEm: timestamp("devolvido_visto_em", { withTimezone: true }),
    // --- Alteração de reserva paga (M8.2d)
    /** A alteração cuja diferença esta tentativa cobra (vive na cotação original); null = a tentativa da própria reserva. */
    alteracaoId: uuid("alteracao_id").references((): AnyPgColumn => alteracoesReserva.id),
    /**
     * Centavos que o painel do Mercado Pago devolveu fora do sistema e que a equipe reconheceu numa decisão (o restante de um
     * pagamento já devolvido em parte). Só cresce, sob a trava, auditado.
     */
    devolvidoForaReconhecido: integer("devolvido_fora_reconhecido").notNull().default(0),
    // --- Contestação (M8.2e)
    /** A última busca tardia de contestações deste pagamento (uma por semana), reservada por `UPDATE … RETURNING` antes da chamada. */
    contestacoesBuscadasEm: timestamp("contestacoes_buscadas_em", { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pagamentos_referencia").on(t.organizacaoId, t.referencia),
    uniqueIndex("pagamentos_id_provedor").on(t.organizacaoId, t.idProvedor).where(sql`${t.idProvedor} is not null`),
    // Só um pagamento confirma cada reserva: os outros só podem ser devolvidos.
    uniqueIndex("pagamentos_um_desfecho_reserva").on(t.reservaId).where(sql`${t.desfecho} = 'reserva'`),
    // Só um pagamento paga a diferença de cada alteração (M8.2d).
    uniqueIndex("pagamentos_um_desfecho_alteracao").on(t.alteracaoId).where(sql`${t.desfecho} = 'alteracao'`),
    index("pagamentos_alteracao").on(t.alteracaoId).where(sql`${t.alteracaoId} is not null`),
    index("pagamentos_busca_id_provedor").on(t.idProvedor),
    index("pagamentos_cotacao").on(t.cotacaoId, t.criadoEm),
    index("pagamentos_reserva").on(t.reservaId),
    index("pagamentos_situacao").on(t.organizacaoId, t.situacao),
    index("pagamentos_criado").on(t.organizacaoId, t.criadoEm),
    // Limite geral de cartões por hora e disjuntor de recusas (M8.2b).
    index("pagamentos_cartao_org_criado").on(t.organizacaoId, t.criadoEm).where(sql`${t.forma} = 'cartao'`),
  ],
);

/**
 * Disjuntor do cartão (M8.2b): cada vez que as recusas passam do limite, uma linha. Aberto ⇔ `religado_em` vazio e
 * (`ate` vazio ou no futuro). Só contas, horários e quem religou: nenhum IP, e-mail ou dado de cartão.
 */
export const disjuntoresCartao = pgTable(
  "disjuntores_cartao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    abertoEm: timestamp("aberto_em", { withTimezone: true }).notNull(),
    /** Até quando o cartão fica desligado; null = só religando à mão (20 em 24 h ou terceiro disparo em 24 h). */
    ate: timestamp("ate", { withTimezone: true }),
    /** Recusas contadas na janela quando disparou. */
    recusas: integer("recusas").notNull(),
    /** "30min" ou "24h": qual janela disparou. */
    janela: text("janela").$type<"30min" | "24h">().notNull(),
    reincidente: boolean("reincidente").notNull().default(false),
    religadoEm: timestamp("religado_em", { withTimezone: true }),
    religadoPor: uuid("religado_por").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [index("disjuntores_cartao_org").on(t.organizacaoId, t.abertoEm)],
);

// ---------------------------------------------------------------------------
// Cancelamento de reserva paga pelo site (M8.2c): o pedido (do hóspede em Minha reserva ou registrado pela equipe), o
// retrato da política aceita no pagamento, a decisão e o acerto. Listas fechadas aqui; colunas de texto sem CHECK, como
// as do M8.2a. Nenhum dado pessoal: as notas (até 300) passam por `textoSemDadosPessoais`.
// ---------------------------------------------------------------------------

/** pedido: aguarda a equipe; cancelada: decidida (não volta atrás); descartado: o pedido não vale (fica no histórico). */
export const SITUACOES_CANCELAMENTO = ["pedido", "cancelada", "descartado"] as const;
export type SituacaoCancelamento = (typeof SITUACOES_CANCELAMENTO)[number];
/** Por onde o pedido chegou; `site` = o hóspede em Minha reserva (o horário é o do servidor, travado). */
export const CANAIS_PEDIDO_CANCELAMENTO = ["site", "whatsapp", "email", "telefone", "presencial", "outro"] as const;
export type CanalPedidoCancelamento = (typeof CANAIS_PEDIDO_CANCELAMENTO)[number];
export const QUEM_CANCELA_RESERVA = ["hospede", "empresa", "nao_comparecimento"] as const;
export type QuemCancelaReserva = (typeof QUEM_CANCELA_RESERVA)[number];
export const MOTIVOS_CANCELAMENTO_EMPRESA = ["imovel_sem_condicoes", "forca_maior", "outro"] as const;
export type MotivoCancelamentoEmpresa = (typeof MOTIVOS_CANCELAMENTO_EMPRESA)[number];
/** Motivo da devolução integral por exceção (lista fechada; a nota vai em `motivo_decisao` e nunca ao hóspede nem ao proprietário). */
export const MOTIVOS_EXCECAO = ["erro_da_scl", "forca_maior", "cortesia_comercial", "saude_ou_familia", "outro"] as const;
export type MotivoExcecao = (typeof MOTIVOS_EXCECAO)[number];
/** O que a decisão final dá ao hóspede: tudo de volta ou nada (a devolução de parte do valor é do M8.2d). */
export const DIREITOS_CANCELAMENTO = ["integral", "nenhum"] as const;
export type DireitoCancelamento = (typeof DIREITOS_CANCELAMENTO)[number];
/** O que a política diz (calculado), antes de qualquer decisão da equipe. */
export const CALCULOS_CANCELAMENTO = ["integral", "nenhum", "sem_politica"] as const;
export type CalculoCancelamento = (typeof CALCULOS_CANCELAMENTO)[number];
/**
 * A base da decisão do cancelamento. `contestacao` (M8.2e): "Cancelar a reserva contestada", a rota sem decisão pela política
 * e sem devolução pelo sistema (o dinheiro volta ao titular pela disputa, se ele ganhar).
 */
export const BASES_CANCELAMENTO = ["prazo", "arrependimento", "empresa", "excecao", "sem_politica", "fora_do_prazo", "estadia_iniciada", "nao_comparecimento", "contestacao"] as const;
export type BaseCancelamento = (typeof BASES_CANCELAMENTO)[number];

export const cancelamentosReserva = pgTable(
  "cancelamentos_reserva",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    reservaId: uuid("reserva_id").notNull().references(() => reservas.id),
    /** O pagamento que confirmou a reserva (desfecho 'reserva'). */
    pagamentoId: uuid("pagamento_id").notNull().references(() => pagamentos.id),
    situacao: text("situacao").$type<SituacaoCancelamento>().notNull().default("pedido"),
    /** Quando a SCL recebeu o pedido (o que a política conta). Hóspede pelo site: relógio do servidor (travado). */
    pedidoRecebidoEm: timestamp("pedido_recebido_em", { withTimezone: true }).notNull(),
    /** O momento registrado pela equipe, quando o financeiro o corrigiu ao cancelar (auditado). */
    pedidoRegistradoOriginalEm: timestamp("pedido_registrado_original_em", { withTimezone: true }),
    motivoMomento: text("motivo_momento").notNull().default(""),
    /** null quando a SCL cancela ou no não comparecimento. */
    canal: text("canal").$type<CanalPedidoCancelamento>(),
    quemCancela: text("quem_cancela").$type<QuemCancelaReserva>().notNull().default("hospede"),
    motivoEmpresa: text("motivo_empresa").$type<MotivoCancelamentoEmpresa>(),
    motivoExcecao: text("motivo_excecao").$type<MotivoExcecao>(),
    /** Onde está o pedido (ex.: "WhatsApp da empresa, 14h10"); até 300; validado sem dados pessoais. */
    nota: text("nota").notNull().default(""),
    /** Nota obrigatória da exceção ou da decisão sem política; até 300; validada. Nunca vai ao hóspede nem ao proprietário. */
    motivoDecisao: text("motivo_decisao").notNull().default(""),
    /** Quem registrou o pedido; null = o hóspede, em Minha reserva. */
    pedidoPor: uuid("pedido_por").references(() => usuarios.id, { onDelete: "set null" }),
    // --- Retrato da política e da decisão (preenchido ao cancelar; nunca muda depois)
    politicaVersao: integer("politica_versao"),
    diasReembolsoIntegral: integer("dias_reembolso_integral"),
    arrependimentoAteEntrada: boolean("arrependimento_ate_entrada"),
    integralAte: date("integral_ate", { mode: "string" }),
    arrependimentoAte: date("arrependimento_ate", { mode: "string" }),
    entradaEm: timestamp("entrada_em", { withTimezone: true }),
    calculado: text("calculado").$type<CalculoCancelamento>(),
    direito: text("direito").$type<DireitoCancelamento>(),
    base: text("base").$type<BaseCancelamento>(),
    /** O que o hóspede pagou (valorPagoNaOrder) e o que a decisão devolve (0 ou o pago). */
    valorPago: integer("valor_pago"),
    valorADevolver: integer("valor_a_devolver"),
    canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
    canceladaPor: uuid("cancelada_por").references(() => usuarios.id, { onDelete: "set null" }),
    /** Componentes de resultado lançados (fase 1, sempre junto com o cancelamento). */
    resultadoLancadoEm: timestamp("resultado_lancado_em", { withTimezone: true }),
    /** Espelhos lançados no mês do cancelamento (algo já tinha movimentado dinheiro): o motor não recalcula mais a reserva. */
    espelhado: boolean("espelhado").notNull().default(false),
    /** Componentes de caixa lançados (devolução realizada; na retenção, nada a lançar). */
    caixaLancadoEm: timestamp("caixa_lancado_em", { withTimezone: true }),
    /** M8.3: datas reabertas nas OTAs (à mão até o M8.3; o M8.3 grava sozinho). */
    otaLiberadaEm: timestamp("ota_liberada_em", { withTimezone: true }),
    otaLiberadaPor: uuid("ota_liberada_por").references(() => usuarios.id, { onDelete: "set null" }),
    /** Mensagens ao hóspede (copiadas e enviadas pela equipe, ou enviadas pelo M9.2; por null = o sistema). */
    hospedeAvisadoPedidoEm: timestamp("hospede_avisado_pedido_em", { withTimezone: true }),
    hospedeAvisadoPedidoPor: uuid("hospede_avisado_pedido_por").references(() => usuarios.id, { onDelete: "set null" }),
    hospedeAvisadoDecisaoEm: timestamp("hospede_avisado_decisao_em", { withTimezone: true }),
    // A chave estrangeira desta e da seguinte tem nome próprio (abaixo): o nome automático passaria dos 63 caracteres do Postgres.
    hospedeAvisadoDecisaoPor: uuid("hospede_avisado_decisao_por"),
    hospedeAvisadoDevolucaoEm: timestamp("hospede_avisado_devolucao_em", { withTimezone: true }),
    hospedeAvisadoDevolucaoPor: uuid("hospede_avisado_devolucao_por"),
    descartadoEm: timestamp("descartado_em", { withTimezone: true }),
    descartadoPor: uuid("descartado_por").references(() => usuarios.id, { onDelete: "set null" }),
    descarteMotivo: text("descarte_motivo").notNull().default(""),
    /** Pedido pelo site descartado: só como desistência do hóspede, com o canal e a hora da desistência. */
    desistenciaCanal: text("desistencia_canal").$type<CanalPedidoCancelamento>(),
    desistenciaEm: timestamp("desistencia_em", { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Um pedido ou cancelamento ativo por reserva; os descartados ficam (nunca são apagados).
    uniqueIndex("cancelamentos_reserva_um_ativo").on(t.reservaId).where(sql`${t.situacao} in ('pedido', 'cancelada')`),
    foreignKey({ columns: [t.hospedeAvisadoDecisaoPor], foreignColumns: [usuarios.id], name: "cancelamentos_reserva_hospede_avisado_decisao_por_fk" }).onDelete("set null"),
    foreignKey({ columns: [t.hospedeAvisadoDevolucaoPor], foreignColumns: [usuarios.id], name: "cancelamentos_reserva_hospede_avisado_devolucao_por_fk" }).onDelete("set null"),
    index("cancelamentos_reserva_org").on(t.organizacaoId, t.situacao),
    index("cancelamentos_reserva_reserva").on(t.reservaId),
  ],
);

// ---------------------------------------------------------------------------
// Alteração de reserva paga pelo site (M8.2d): datas, pessoas ou valor, só antes da entrada. A linha guarda o antes e o
// depois, a cotação das datas novas (retrato), a diferença, o retrato da política (na redução), o prazo das datas
// seguradas e o gancho do M8.3. Listas fechadas aqui; colunas de texto sem CHECK, como as do M8.2a. Nenhum dado
// pessoal: as notas (até 300) passam por `textoSemDadosPessoais`. Nunca é apagada.
// ---------------------------------------------------------------------------

/** segurada → aplicada (final) | expirada (o prazo das datas passou) | desistida (a equipe desistiu). */
export const SITUACOES_ALTERACAO = ["segurada", "aplicada", "expirada", "desistida"] as const;
export type SituacaoAlteracao = (typeof SITUACOES_ALTERACAO)[number];
export const QUEM_PEDE_ALTERACAO = ["hospede", "empresa"] as const;
export type QuemPedeAlteracao = (typeof QUEM_PEDE_ALTERACAO)[number];
/** Por onde o pedido do hóspede chegou (a alteração é sempre preparada pela equipe, no painel). */
export const CANAIS_PEDIDO_ALTERACAO = ["whatsapp", "email", "telefone", "presencial", "outro"] as const;
export type CanalPedidoAlteracao = (typeof CANAIS_PEDIDO_ALTERACAO)[number];
/** De onde veio o valor novo: a cotação do site, o valor atual mantido, ou um valor digitado pela equipe. */
export const ORIGENS_VALOR_ALTERACAO = ["cotacao", "mantido", "digitado"] as const;
export type OrigemValorAlteracao = (typeof ORIGENS_VALOR_ALTERACAO)[number];
/** Motivo do valor mantido ou digitado (lista fechada; a nota vai em `motivo_valor_nota`). */
export const MOTIVOS_VALOR_ALTERACAO = ["alteracao_pela_scl", "cortesia_comercial", "erro_da_scl", "acordo_com_hospede", "preco_a_confirmar", "outro"] as const;
export type MotivoValorAlteracao = (typeof MOTIVOS_VALOR_ALTERACAO)[number];
/** A cotação das datas novas (retrato; nunca recalculado depois, nem ao aplicar). `leituraEm` em ISO. */
export type CotacaoDaAlteracao = {
  diarias: number | null;
  limpeza: number | null;
  hospedeExtra: number | null;
  valorCheio: number | null;
  desconto: number;
  total: number | null;
  situacao: SituacaoDisponibilidade;
  leituraEm: string | null;
};
/** Centavos de um mês do financeiro da reserva, por componente. */
export type ComponentesDaAlteracao = { bruto: number; taxa: number; comissao: number; parte: number };
/** Antes, depois e diferença do financeiro, por componente e mês (o que o motor lançou ao aplicar). */
export type ResultadoDaAlteracao = { meses: { mes: string; antes: ComponentesDaAlteracao; depois: ComponentesDaAlteracao }[] };

export const alteracoesReserva = pgTable(
  "alteracoes_reserva",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    reservaId: uuid("reserva_id").notNull().references(() => reservas.id),
    /** A cotação original da reserva (as tentativas da diferença vivem nela). */
    cotacaoId: uuid("cotacao_id").notNull().references(() => cotacoes.id),
    /** O pagamento que confirmou a reserva (desfecho 'reserva'): a política da reserva é a dele. */
    pagamentoId: uuid("pagamento_id").notNull().references((): AnyPgColumn => pagamentos.id),
    situacao: text("situacao").$type<SituacaoAlteracao>().notNull().default("segurada"),
    quemPede: text("quem_pede").$type<QuemPedeAlteracao>().notNull().default("hospede"),
    motivoEmpresa: text("motivo_empresa").$type<MotivoCancelamentoEmpresa>(),
    /** Quando a SCL recebeu o pedido (o que a política conta numa redução). */
    pedidoRecebidoEm: timestamp("pedido_recebido_em", { withTimezone: true }).notNull(),
    /** null quando a SCL propõe. */
    canal: text("canal").$type<CanalPedidoAlteracao>(),
    /** Onde está o pedido; até 300; validada sem dados pessoais. */
    nota: text("nota").notNull().default(""),
    // --- Antes (retrato da reserva ao preparar) e depois
    checkinAntes: date("checkin_antes", { mode: "string" }).notNull(),
    checkoutAntes: date("checkout_antes", { mode: "string" }).notNull(),
    hospedesAntes: integer("hospedes_antes"),
    /** `reservas.valor_bruto` ao preparar (o dinheiro que fica com a reserva). */
    valorAntes: integer("valor_antes").notNull(),
    checkinDepois: date("checkin_depois", { mode: "string" }).notNull(),
    checkoutDepois: date("checkout_depois", { mode: "string" }).notNull(),
    hospedesDepois: integer("hospedes_depois").notNull(),
    /** O preço novo (cotação, mantido ou digitado). */
    valorDepois: integer("valor_depois").notNull(),
    origemValor: text("origem_valor").$type<OrigemValorAlteracao>().notNull(),
    motivoValor: text("motivo_valor").$type<MotivoValorAlteracao>(),
    motivoValorNota: text("motivo_valor_nota").notNull().default(""),
    cotacao: jsonb("cotacao").$type<CotacaoDaAlteracao>().notNull(),
    /** valor_depois − valor_antes (com sinal). */
    diferenca: integer("diferenca").notNull(),
    /** A data de entrada de que a política conta: a menor entre a da cotação original e a atual (`entradaQueConta`). */
    entradaDaPolitica: date("entrada_da_politica", { mode: "string" }).notNull(),
    /** Noites novas (fora da estadia de antes): um intervalo [início, fim), ou nenhum. */
    noitesNovasInicio: date("noites_novas_inicio", { mode: "string" }),
    noitesNovasFim: date("noites_novas_fim", { mode: "string" }),
    /** Até quando as datas novas ficam seguradas (`regras.site.minutosHoldAlteracao`, estendido pelo pagamento da diferença). */
    holdAte: timestamp("hold_ate", { withTimezone: true }),
    /** A reserva-pedido que segura as noites novas (fonte 'alteracao'). */
    holdReservaId: uuid("hold_reserva_id").references(() => reservas.id),
    // --- Retrato da política (só na redução; nunca muda depois)
    politicaVersao: integer("politica_versao"),
    diasReembolsoIntegral: integer("dias_reembolso_integral"),
    arrependimentoAteEntrada: boolean("arrependimento_ate_entrada"),
    integralAte: date("integral_ate", { mode: "string" }),
    arrependimentoAte: date("arrependimento_ate", { mode: "string" }),
    calculado: text("calculado").$type<CalculoCancelamento>(),
    direito: text("direito").$type<DireitoCancelamento>(),
    base: text("base").$type<BaseCancelamento>(),
    motivoExcecao: text("motivo_excecao").$type<MotivoExcecao>(),
    /** Nota obrigatória da exceção ou da decisão sem política; até 300; validada. */
    motivoDecisao: text("motivo_decisao").notNull().default(""),
    /** 0 ou −diferença (na redução). */
    valorADevolver: integer("valor_a_devolver"),
    /** Assinatura da prévia aceita ao segurar (o "Aplicar" de uma segurada confere a assinatura da aplicação). */
    assinatura: text("assinatura").notNull(),
    taxaDepois: integer("taxa_depois"),
    resultado: jsonb("resultado").$type<ResultadoDaAlteracao>(),
    aplicadaEm: timestamp("aplicada_em", { withTimezone: true }),
    /** null = aplicada pelo pagamento da diferença. */
    aplicadaPor: uuid("aplicada_por").references(() => usuarios.id, { onDelete: "set null" }),
    /** Aplicada pela aprovação da diferença depois do prazo das datas (com as noites ainda livres). */
    aplicadaTardia: boolean("aplicada_tardia").notNull().default(false),
    expiradaEm: timestamp("expirada_em", { withTimezone: true }),
    desistidaEm: timestamp("desistida_em", { withTimezone: true }),
    desistidaPor: uuid("desistida_por").references(() => usuarios.id, { onDelete: "set null" }),
    desistenciaMotivo: text("desistencia_motivo").notNull().default(""),
    /** M8.3: bloqueio das OTAs atualizado (à mão até o M8.3; o M8.3 grava sozinho). */
    otaAtualizadaEm: timestamp("ota_atualizada_em", { withTimezone: true }),
    otaAtualizadaPor: uuid("ota_atualizada_por").references(() => usuarios.id, { onDelete: "set null" }),
    /** Mensagens ao hóspede (copiadas e enviadas pela equipe, ou enviadas pelo M9.2; por null = o sistema). */
    hospedeAvisadoPropostaEm: timestamp("hospede_avisado_proposta_em", { withTimezone: true }),
    // As chaves estrangeiras destas três têm nome próprio (abaixo), como no cancelamento.
    hospedeAvisadoPropostaPor: uuid("hospede_avisado_proposta_por"),
    hospedeAvisadoConfirmacaoEm: timestamp("hospede_avisado_confirmacao_em", { withTimezone: true }),
    hospedeAvisadoConfirmacaoPor: uuid("hospede_avisado_confirmacao_por"),
    hospedeAvisadoDevolucaoEm: timestamp("hospede_avisado_devolucao_em", { withTimezone: true }),
    hospedeAvisadoDevolucaoPor: uuid("hospede_avisado_devolucao_por"),
    criadaPor: uuid("criada_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Uma alteração com as datas seguradas por reserva; as outras ficam (nunca são apagadas).
    uniqueIndex("alteracoes_reserva_uma_segurada").on(t.reservaId).where(sql`${t.situacao} = 'segurada'`),
    uniqueIndex("alteracoes_reserva_hold").on(t.holdReservaId).where(sql`${t.holdReservaId} is not null`),
    index("alteracoes_reserva_org").on(t.organizacaoId, t.situacao),
    index("alteracoes_reserva_reserva").on(t.reservaId),
    foreignKey({ columns: [t.hospedeAvisadoPropostaPor], foreignColumns: [usuarios.id], name: "alteracoes_reserva_avisado_prop_por_fk" }).onDelete("set null"),
    foreignKey({ columns: [t.hospedeAvisadoConfirmacaoPor], foreignColumns: [usuarios.id], name: "alteracoes_reserva_avisado_conf_por_fk" }).onDelete("set null"),
    foreignKey({ columns: [t.hospedeAvisadoDevolucaoPor], foreignColumns: [usuarios.id], name: "alteracoes_reserva_avisado_dev_por_fk" }).onDelete("set null"),
  ],
);

// ---------------------------------------------------------------------------
// Contestação do pagamento no site (M8.2e): a disputa (contestação no cartão, MED do Pix ou reclamação no Mercado
// Pago), lida pela order, pela Chargebacks API e pela Payments API, ou registrada pela equipe; a decisão de quem arca, o
// resultado (sempre confirmado pela equipe, C1) e o caixa. "Contestação" aqui é sempre a do pagamento (a dos
// adiantamentos, M4.4, é outra). Listas fechadas em pagamentos/contestacao-regras.ts; colunas de texto sem CHECK, como as
// do M8.2a. Nenhum dado pessoal: só ids do Mercado Pago, códigos, valores, datas e notas validadas (até 300). Toda
// gravação acontece sob `travarCotacao`. Nunca apagada.
// ---------------------------------------------------------------------------

export const contestacoesPagamento = pgTable(
  "contestacoes_pagamento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    pagamentoId: uuid("pagamento_id").notNull().references(() => pagamentos.id),
    /** A reserva cujo dinheiro está em disputa (pagamento com desfecho `reserva` ou `alteracao`); null no pagamento sem reserva. */
    reservaId: uuid("reserva_id").references(() => reservas.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    // --- Identificação
    tipo: text("tipo").$type<TipoContestacao>().notNull(),
    origem: text("origem").$type<OrigemContestacao>().notNull(),
    /** O caso da Chargebacks API (o `case_id` da order): só algarismos, até 20. */
    idCaso: text("id_caso"),
    /** A contestação na order (CBK…). */
    idContestacao: text("id_contestacao"),
    /** O `transaction_id` da contestação (PAY…): só pista, nunca casa sozinho. */
    idTransacao: text("id_transacao"),
    /** 1; uma disputa ganha reaberta ("Conferir o aviso") ganha a rodada seguinte, numa linha nova com a mesma identificação. */
    rodada: integer("rodada").notNull().default(1),
    /** Segunda disputa no mesmo pagamento com outra ainda não final: não segura nada até "Confirmar que é outra disputa". */
    duplicataPossivel: boolean("duplicata_possivel").notNull().default(false),
    confirmadaOutraEm: timestamp("confirmada_outra_em", { withTimezone: true }),
    confirmadaOutraPor: uuid("confirmada_outra_por").references(() => usuarios.id, { onDelete: "set null" }),
    // --- Situação
    situacao: text("situacao").$type<SituacaoContestacao>().notNull().default("aberta"),
    /** A do pagamento antes da primeira linha não final dele: para onde ele volta se a SCL ganhar. */
    situacaoPagamentoAntes: text("situacao_pagamento_antes").$type<SituacaoPagamentoAntes>().notNull(),
    // --- Leitura
    /** O último estado conhecido (`in_process`, `settled`, `reimbursed`); o desconhecido nunca o sobrescreve. */
    estadoLido: text("estado_lido").$type<EstadoConhecidoContestacao>(),
    /** O código cru curto, inclusive o desconhecido. */
    codigo: text("codigo"),
    /** `coverage_applied`: pela página atual do Mercado Pago, o resultado (o sentido está a conferir). */
    coberturaAplicada: boolean("cobertura_aplicada"),
    coberturaElegivel: boolean("cobertura_elegivel"),
    /** `reason_id` (só algarismos) e o código do motivo (`reason` só quando é um código: nunca o texto livre). */
    motivoId: text("motivo_id"),
    motivoCodigo: text("motivo_codigo"),
    /** Centavos em disputa; null = ilegível (o valor em risco usa o pago, com o aviso). */
    valor: integer("valor"),
    valorOrigem: text("valor_origem").$type<OrigemValorContestacao>().notNull(),
    /** O derivado (`valorEmRisco`), gravado sob a trava a cada mudança: é o que a regra da conferência em SQL lê. */
    valorEmRisco: integer("valor_em_risco").notNull().default(0),
    /** Primeira vez vista ou registrada. */
    abertaEm: timestamp("aberta_em", { withTimezone: true }).notNull(),
    abertaNoProvedorEm: timestamp("aberta_no_provedor_em", { withTimezone: true }),
    documentacao: text("documentacao").$type<DocumentacaoDaContestacao>(),
    documentacaoPrazo: timestamp("documentacao_prazo", { withTimezone: true }),
    /** "Documentos enviados no painel do Mercado Pago" (auditado). */
    documentosEnviadosEm: timestamp("documentos_enviados_em", { withTimezone: true }),
    documentosEnviadosPor: uuid("documentos_enviados_por").references(() => usuarios.id, { onDelete: "set null" }),
    /** Retrato da verificação do banco do pagamento na abertura. */
    tresDSStatus: text("tres_ds_status").$type<StatusTresDS>(),
    aoVivo: boolean("ao_vivo"),
    consultadaEm: timestamp("consultada_em", { withTimezone: true }),
    /** O início da chamada da última leitura aplicada (uma leitura iniciada antes é descartada). */
    lidaEm: timestamp("lida_em", { withTimezone: true }),
    /** `date_last_updated` do caso (uma leitura com data mais antiga é descartada). */
    atualizadoNoProvedorEm: timestamp("atualizado_no_provedor_em", { withTimezone: true }),
    proximaLeituraEm: timestamp("proxima_leitura_em", { withTimezone: true }),
    falhasLeitura: integer("falhas_leitura").notNull().default(0),
    /** Os avisos desta disputa (`AVISOS_DE_CONTESTACAO`); `pagamentos.avisos` leva a união deles. */
    avisos: jsonb("avisos").$type<string[]>().notNull().default([]),
    /** A nota do registro pela equipe (validada). */
    notaRegistro: text("nota_registro").notNull().default(""),
    // --- Decisão de quem arca
    causa: text("causa").$type<CodigoCausaContestacao>(),
    quemArca: text("quem_arca").$type<QuemArcaContestacao>(),
    /** Nota obrigatória da decisão (até 300, validada); nunca vai ao proprietário. "Mudar quem arca" não a apaga. */
    decisaoNota: text("decisao_nota").notNull().default(""),
    /** A nota "por que mudar" da mudança mais recente ("Mudar quem arca"; até 300, validada); nunca vai ao proprietário. */
    decisaoMudancaNota: text("decisao_mudanca_nota").notNull().default(""),
    /** Explicação ao proprietário (opcional, até 300, validada): no extrato, no PDF e no e-mail, ao lado da causa. */
    explicacaoProprietario: text("explicacao_proprietario").notNull().default(""),
    decisaoPor: uuid("decisao_por").references(() => usuarios.id, { onDelete: "set null" }),
    decisaoEm: timestamp("decisao_em", { withTimezone: true }),
    /** 0 = sem decisão; sobe a cada mudança (e a cada "Atualizar o valor segurado"). */
    decisaoVersao: integer("decisao_versao").notNull().default(0),
    /** O retrato da divisão (D e C, as partes efetivas da reserva), congelado na decisão. */
    baseParteProprietario: integer("base_parte_proprietario"),
    baseComissao: integer("base_comissao"),
    /** O valor em risco usado na versão em vigor e a divisão em vigor. */
    exposicao: integer("exposicao"),
    parteProprietario: integer("parte_proprietario"),
    parteScl: integer("parte_scl"),
    // --- Resultado (confirmado pela equipe)
    /** A data do resultado informada. */
    resultadoEm: date("resultado_em", { mode: "string" }),
    resultadoPor: uuid("resultado_por").references(() => usuarios.id, { onDelete: "set null" }),
    resultadoNota: text("resultado_nota").notNull().default(""),
    valorPerdido: integer("valor_perdido"),
    /** Quanto deste pagamento nunca entrou na conta (o Mercado Pago não liberou). */
    liquidoNaoEntrou: integer("liquido_nao_entrou"),
    /** O dia em que o Mercado Pago debitou. */
    debitoEm: date("debito_em", { mode: "string" }),
    /** Tarifa do Mercado Pago pela disputa (despesa da SCL), quando houver. */
    tarifa: integer("tarifa"),
    /** Os lançamentos definitivos feitos (a guarda de idempotência da perdida). */
    definitivoEm: timestamp("definitivo_em", { withTimezone: true }),
    /** A nota do "Encerrar sem efeito". */
    encerradaNota: text("encerrada_nota").notNull().default(""),
    /** "Conferir o aviso" (`contestacao_resultado_mudou` numa linha final). */
    avisoConferidoEm: timestamp("aviso_conferido_em", { withTimezone: true }),
    avisoConferidoPor: uuid("aviso_conferido_por").references(() => usuarios.id, { onDelete: "set null" }),
    avisoConferidoNota: text("aviso_conferido_nota").notNull().default(""),
    // --- Caixa
    /** O retido em vigor (previsto até "Confirmar o débito do Mercado Pago"; realizado depois). */
    retidoLancamentoId: uuid("retido_lancamento_id").references(() => lancamentos.id),
    retidoConfirmadoEm: timestamp("retido_confirmado_em", { withTimezone: true }),
    retidoConfirmadoPor: uuid("retido_confirmado_por").references(() => usuarios.id, { onDelete: "set null" }),
    /** A nota do "Confirmar o débito do Mercado Pago" (obrigatória quando o valor difere do valor em risco; sem dado pessoal). */
    debitoNota: text("debito_nota").notNull().default(""),
    /** Ganha: o retido realizado que voltou. */
    voltaLancamentoId: uuid("volta_lancamento_id").references(() => lancamentos.id),
    /** Perdida: o caixa final. Chave estrangeira com nome próprio (abaixo): o automático passaria dos 63 caracteres. */
    caixaFinalLancamentoId: uuid("caixa_final_lancamento_id"),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Casamento e idempotência: um caso e um CBK por pagamento e rodada, e uma disputa sem identificação não final por pagamento.
    uniqueIndex("contestacoes_pagamento_caso").on(t.pagamentoId, t.idCaso, t.rodada).where(sql`${t.idCaso} is not null`),
    uniqueIndex("contestacoes_pagamento_cbk").on(t.pagamentoId, t.idContestacao, t.rodada).where(sql`${t.idContestacao} is not null`),
    uniqueIndex("contestacoes_pagamento_sem_id")
      .on(t.pagamentoId)
      .where(sql`${t.idCaso} is null and ${t.idContestacao} is null and ${t.situacao} in ('aberta', 'a_confirmar')`),
    index("contestacoes_pagamento_situacao").on(t.organizacaoId, t.situacao),
    index("contestacoes_pagamento_leitura").on(t.proximaLeituraEm).where(sql`${t.situacao} in ('aberta', 'a_confirmar')`),
    index("contestacoes_pagamento_reserva").on(t.reservaId),
    index("contestacoes_pagamento_pagamento").on(t.pagamentoId),
    foreignKey({ columns: [t.caixaFinalLancamentoId], foreignColumns: [lancamentos.id], name: "contestacoes_pagamento_caixa_final_fk" }),
  ],
);

/**
 * A linha do tempo de uma disputa ("registro de cada evento"): o que o sistema leu (`usuario_id` null) e o que a equipe
 * fez. `antes` e `depois` só com códigos, datas e centavos (nunca notas). Nunca apagada, ao contrário de
 * `eventos_pagamento` (que some em 90 dias e não se liga ao pagamento).
 */
export const eventosContestacao = pgTable(
  "eventos_contestacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contestacaoId: uuid("contestacao_id").notNull().references(() => contestacoesPagamento.id),
    fonte: text("fonte").$type<FonteEventoContestacao>().notNull(),
    tipo: text("tipo").$type<TipoEventoContestacao>().notNull(),
    antes: jsonb("antes").$type<DadosDoEvento>(),
    depois: jsonb("depois").$type<DadosDoEvento>(),
    /** null = o sistema. */
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
    em: timestamp("em", { withTimezone: true }).notNull().defaultNow(),
    /** A ordem de gravação (os eventos de uma mesma ação têm o mesmo `em`): a linha do tempo desempata por ela. */
    ordem: integer("ordem").generatedAlwaysAsIdentity(),
  },
  (t) => [index("eventos_contestacao_contestacao").on(t.contestacaoId, t.em)],
);

/**
 * De onde veio a devolução: `sem_reserva` (M8.2a: pagamento aprovado que não confirmou a reserva), `cancelamento`
 * (M8.2c: reserva cancelada pela política) ou `alteracao` (M8.2d: a diferença de uma alteração, pela política). A
 * coluna é texto livre de propósito: um banco de preview compartilhado pode ter origens que esta versão não conhece, e
 * quem lê ignora essas linhas.
 */
export const ORIGENS_DEVOLUCAO = ["sem_reserva", "cancelamento", "alteracao"] as const;
export type OrigemDevolucao = (typeof ORIGENS_DEVOLUCAO)[number];

/**
 * Devolução de um pagamento: pelo provedor (pedida → confirmada/recusada) ou feita por fora. Desde o M8.2d, várias por
 * pagamento (a da alteração, a do cancelamento, o restante de uma devolvida a menos), com no máximo uma pedida por vez.
 */
export const devolucoesPagamento = pgTable(
  "devolucoes_pagamento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    pagamentoId: uuid("pagamento_id").notNull().references(() => pagamentos.id),
    motivo: text("motivo").notNull(),
    /** O que esta devolução devolve (centavos pagos); nunca muda depois do primeiro envio, salvo a integral de um pagamento intocado. */
    valor: integer("valor").notNull(),
    situacao: text("situacao").$type<SituacaoDevolucao>().notNull().default("pedida"),
    /** Pedidos enviados ao provedor (`chaveAtual`, gravada antes). Chave nova a cada pedido, salvo depois de resposta incerta. */
    tentativas: integer("tentativas").notNull().default(0),
    /**
     * Pedidos recusados ou sem resposta clara do provedor (a resposta incerta conta; "aguarde" — devolução em andamento ou
     * espera pedida pelo Mercado Pago — não conta): depois de 3, relida a order, a devolução fica recusada (aviso).
     */
    falhas: integer("falhas").notNull().default(0),
    chaveAtual: text("chave_atual"),
    /**
     * O pedido com `chaveAtual` pode ter sido aceito (resposta incerta) ou foi aceito (pedida/confirmada, à espera de a
     * order mostrar): o próximo envio repete a MESMA chave (o provedor nunca devolve duas vezes pela mesma chave). Chave
     * nova só depois de uma recusa clara ou de um pedido novo da equipe. Desliga quando a leitura confirma.
     */
    chaveEmDuvida: boolean("chave_em_duvida").notNull().default(false),
    /**
     * O provedor ACEITOU o pedido com `chaveAtual` (pedida/confirmada): daí em diante nada se envia de novo (nem com outra
     * chave, nem num pedido novo da equipe); só a leitura da order confirma. Desliga quando a leitura confirma.
     */
    chaveAceita: boolean("chave_aceita").notNull().default(false),
    proximaTentativaEm: timestamp("proxima_tentativa_em", { withTimezone: true }),
    idProvedor: text("id_provedor"),
    confirmadaEm: timestamp("confirmada_em", { withTimezone: true }),
    porForaData: date("por_fora_data", { mode: "string" }),
    porForaValor: integer("por_fora_valor"),
    porForaNota: text("por_fora_nota").notNull().default(""),
    /** Taxa que o provedor não devolveu (valor informado pela equipe, conferido no Mercado Pago); null = ainda não informado. */
    taxaPerdida: integer("taxa_perdida"),
    despesaLancamentoId: uuid("despesa_lancamento_id").references(() => lancamentos.id),
    autorId: uuid("autor_id").references(() => usuarios.id, { onDelete: "set null" }),
    // --- M8.2c
    /** Ver `ORIGENS_DEVOLUCAO`; as linhas antigas (M8.2a) ficam `sem_reserva` pelo padrão. */
    origem: text("origem").notNull().default("sem_reserva"),
    /** O cancelamento que pediu esta devolução (origem `cancelamento`). Chave estrangeira com nome próprio (abaixo): o automático passaria de 63 caracteres. */
    cancelamentoId: uuid("cancelamento_id"),
    /** O lançamento `devolucao` (saída do caixa), quando houve. */
    saidaLancamentoId: uuid("saida_lancamento_id").references(() => lancamentos.id),
    /**
     * Quem confirmou: uma leitura da order, a equipe (devolução vista no painel do Mercado Pago) ou, desde o M8.2e, a disputa
     * do pagamento perdida que a substituía (`contestacao`: o dinheiro voltou ao hóspede pela disputa).
     */
    confirmadaPor: text("confirmada_por").$type<"leitura" | "equipe" | "contestacao">(),
    /** Nota obrigatória da confirmação pela equipe (até 300, validada sem dados pessoais). */
    confirmadaNota: text("confirmada_nota").notNull().default(""),
    /** Soma das devoluções confirmadas na leitura que confirmou; null = a leitura não trouxe a lista de devoluções. */
    valorConfirmado: integer("valor_confirmado"),
    /** Último código de `devolver` (lista fechada `CODIGOS_DEVOLUCAO`); null = nenhum. */
    ultimoCodigo: text("ultimo_codigo").$type<CodigoDevolucao>(),
    /** A equipe registrou que o painel do Mercado Pago recusou a devolução (libera a devolução por fora no cartão). */
    recusaNoPainelEm: timestamp("recusa_no_painel_em", { withTimezone: true }),
    recusaNoPainelPor: uuid("recusa_no_painel_por").references(() => usuarios.id, { onDelete: "set null" }),
    recusaNoPainelNota: text("recusa_no_painel_nota").notNull().default(""),
    /** "Parar a devolução pedida" (passou do prazo de leitura do Mercado Pago). */
    paradaEm: timestamp("parada_em", { withTimezone: true }),
    paradaNota: text("parada_nota").notNull().default(""),
    // --- M8.2d
    /** A alteração que pediu esta devolução (origem `alteracao`). */
    alteracaoId: uuid("alteracao_id").references(() => alteracoesReserva.id),
    /** A devolução que esta completa (o restante de uma que o Mercado Pago devolveu a menos). Chave estrangeira com nome próprio (abaixo). */
    origemDevolucaoId: uuid("origem_devolucao_id"),
    /** Os avisos desta devolução (lista fechada em pagamentos/situacoes.ts); `pagamentos.avisos` leva a união deles. */
    avisos: jsonb("avisos").$type<string[]>().notNull().default([]),
    /** O caixa desta devolução ficou acertado (saída lançada, ou nada a lançar): a guarda de idempotência. */
    caixaLancadoEm: timestamp("caixa_lancado_em", { withTimezone: true }),
    /** Taxa do Mercado Pago atribuída ao principal devolvido aqui, congelada na primeira vez que dá para calcular. */
    taxaAtribuida: integer("taxa_atribuida"),
    /** O formato do corpo enviado com `chave_atual` (true = corpo vazio, integral): todo reenvio com a chave usa o mesmo. */
    corpoIntegral: boolean("corpo_integral"),
    // --- M8.2e
    /**
     * A disputa do pagamento que substitui esta devolução (pedida sem aceite ou recusada quando a disputa abriu): o
     * dinheiro volta ao hóspede pela disputa. O vínculo fica no histórico quando a substituição acaba. Chave estrangeira com
     * nome próprio (abaixo).
     */
    contestacaoId: uuid("contestacao_id"),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // M8.2d: várias devoluções por pagamento. O banco continua sendo a guarda mais forte contra devolver duas vezes:
    // uma principal sem reserva por pagamento, uma por cancelamento e pagamento, uma por alteração e pagamento, um
    // restante por devolução e uma pedida por pagamento.
    uniqueIndex("devolucoes_pagamento_sem_reserva").on(t.pagamentoId).where(sql`${t.origem} = 'sem_reserva' and ${t.origemDevolucaoId} is null`),
    uniqueIndex("devolucoes_pagamento_do_cancelamento").on(t.cancelamentoId, t.pagamentoId).where(sql`${t.cancelamentoId} is not null and ${t.origemDevolucaoId} is null`),
    uniqueIndex("devolucoes_pagamento_da_alteracao").on(t.alteracaoId, t.pagamentoId).where(sql`${t.alteracaoId} is not null and ${t.origemDevolucaoId} is null`),
    uniqueIndex("devolucoes_pagamento_restante").on(t.origemDevolucaoId).where(sql`${t.origemDevolucaoId} is not null`),
    uniqueIndex("devolucoes_pagamento_uma_pedida").on(t.pagamentoId).where(sql`${t.situacao} = 'pedida'`),
    index("devolucoes_pagamento_pagamento").on(t.pagamentoId),
    index("devolucoes_pagamento_situacao").on(t.organizacaoId, t.situacao),
    foreignKey({ columns: [t.cancelamentoId], foreignColumns: [cancelamentosReserva.id], name: "devolucoes_pagamento_cancelamento_id_fk" }),
    foreignKey({ columns: [t.origemDevolucaoId], foreignColumns: [t.id], name: "devolucoes_pagamento_origem_devolucao_fk" }),
    foreignKey({ columns: [t.contestacaoId], foreignColumns: [contestacoesPagamento.id], name: "devolucoes_pagamento_contestacao_id_fk" }),
    index("devolucoes_pagamento_contestacao").on(t.contestacaoId).where(sql`${t.contestacaoId} is not null`),
  ],
);

/**
 * Aviso (webhook) do provedor com assinatura válida. Repetição (mesmo request-id, ts e id) não é processada.
 * Só ids e códigos; apagado depois de 90 dias. A organização é preenchida quando a tentativa é achada.
 */
export const eventosPagamento = pgTable(
  "eventos_pagamento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").references(() => organizacoes.id),
    tipo: text("tipo").notNull().default(""),
    acao: text("acao").notNull().default(""),
    dataId: text("data_id").notNull(),
    requestId: text("request_id").notNull().default(""),
    ts: text("ts").notNull().default(""),
    /** `live_mode` do corpo (não é assinado; serve de alarme). */
    aoVivo: boolean("ao_vivo"),
    recebidoEm: timestamp("recebido_em", { withTimezone: true }).notNull().defaultNow(),
    resultado: text("resultado").$type<ResultadoEventoPagamento>().notNull().default("pendente"),
    processadoEm: timestamp("processado_em", { withTimezone: true }),
  },
  // A repetição só se reconhece com request-id ou ts: sem os dois, cada aviso é um evento (nunca se fundem).
  (t) => [uniqueIndex("eventos_pagamento_unico").on(t.requestId, t.ts, t.dataId).where(sql`${t.requestId} <> '' or ${t.ts} <> ''`), index("eventos_pagamento_recebido").on(t.recebidoEm)],
);

/** Contas agregadas dos avisos por dia (São Paulo): assinaturas recusadas e o último aviso válido. Nenhum dado do pedido. */
export const pagamentosAvisosDia = pgTable("pagamentos_avisos_dia", {
  dia: date("dia", { mode: "string" }).primaryKey(),
  assinaturasRecusadas: integer("assinaturas_recusadas").notNull().default(0),
  ultimoValidoEm: timestamp("ultimo_valido_em", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Reserva paga do site no Beds24 (M8.3, desenho em requisitos/product/RESERVA-SITE-BEDS24.md): o acompanhamento de cada
// reserva do site e a fila/histórico das operações. Listas fechadas em beds24/reservas-site-regras.ts; colunas de texto
// sem CHECK, como as do M8.2. Nenhum dado pessoal nem valor: só códigos, ids do Beds24, quarto, datas, número de pessoas,
// situação e a impressão da credencial (nunca a credencial). O id final do Beds24 mora num lugar só,
// `reservas.beds24_id`; até a fase 3 ele fica na operação.
// ---------------------------------------------------------------------------

/**
 * Acompanhamento: uma linha por reserva do site que o M8.3 acompanha. Nasce pela rotina (chave pronta e imóvel ligado),
 * pela marca manual ou por "Deixar à mão". `versao` sobe a cada intenção nova (chaves `<tipo>:<reservaId>:<versao>`).
 */
export const beds24ReservasSite = pgTable(
  "beds24_reservas_site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    reservaId: uuid("reserva_id").notNull().references(() => reservas.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    /** O quarto onde a reserva foi (ou vai ser) criada: atualizar e cancelar vão sempre a ele. Vazio antes da primeira intenção. */
    propertyId: text("property_id"),
    roomId: text("room_id"),
    /** `impressaoCredencialBeds24` da criação, nunca a credencial em si. */
    credencial: text("credencial").notNull().default(""),
    /** `reservas.codigo` (ex.: SCL-7K2QXM), a marca gravada no Beds24. */
    referencia: text("referencia").notNull(),
    situacao: text("situacao").$type<SituacaoAcompanhamentoBeds24>().notNull().default("pendente"),
    motivo: text("motivo").$type<MotivoAcompanhamentoBeds24>(),
    versao: integer("versao").notNull().default(0),
    /** O que o SCL quer no Beds24, e a assinatura dele (a régua compara a de agora com esta). */
    esperado: jsonb("esperado").$type<EsperadoBeds24>(),
    assinaturaEsperada: text("assinatura_esperada"),
    /** A última leitura do Beds24 (só uma leitura mais nova sobrescreve); serve para detectar divergência, nunca para decidir o envio. */
    lido: jsonb("lido").$type<LidoBeds24>(),
    lidoEm: timestamp("lido_em", { withTimezone: true }),
    /** A última conferência que bateu. */
    conferidaEm: timestamp("conferida_em", { withTimezone: true }),
    /** Marca do aviso "reserva paga": `por` nulo = o sistema; preenchido = a marca manual (D8). */
    otaFechadaEm: timestamp("ota_fechada_em", { withTimezone: true }),
    otaFechadaPor: uuid("ota_fechada_por").references(() => usuarios.id, { onDelete: "set null" }),
    /** Falhas antes do POST e o atraso até a próxima. */
    tentativas: integer("tentativas").notNull().default(0),
    proximaTentativaEm: timestamp("proxima_tentativa_em", { withTimezone: true }),
    /** Contador próprio da incerteza: "Tentar de novo" não zera. */
    buscasSemConclusao: integer("buscas_sem_conclusao").notNull().default(0),
    avisadaEm: timestamp("avisada_em", { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("beds24_reservas_site_reserva").on(t.organizacaoId, t.reservaId)],
);

/**
 * Uma operação (criar, atualizar, cancelar, vincular ou ensaio; real ou simulação). A chave dá a idempotência; no
 * máximo uma operação ativa (pendente, enviando, incerta) por reserva. `iniciado_em` vem do relógio do banco; `enviado_em`
 * é gravado logo antes do POST e `beds24_id` logo depois da resposta, antes da fase 3. `erro` é sempre uma mensagem segura.
 */
export const beds24ReservasOperacoes = pgTable(
  "beds24_reservas_operacoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    /** Nulo no ensaio. */
    reservaId: uuid("reserva_id").references(() => reservas.id),
    /** Nulo na simulação e no ensaio. Chave estrangeira com nome próprio (abaixo): o automático passaria de 63 caracteres. */
    acompanhamentoId: uuid("acompanhamento_id"),
    tipo: text("tipo").$type<TipoOperacaoBeds24>().notNull(),
    chave: text("chave").notNull(),
    modo: text("modo").$type<ModoOperacaoBeds24>().notNull(),
    situacao: text("situacao").$type<SituacaoOperacaoBeds24>().notNull().default("pendente"),
    /** Resumo do que foi ou seria enviado: quarto, datas, pessoas, situação e referência. */
    pedido: jsonb("pedido").$type<PedidoBeds24>(),
    /** Ids das alterações `aplicada` sem a marca das OTAs, lidos na fase 1 (só esses são marcados depois). */
    alteracoes: jsonb("alteracoes").$type<string[]>().notNull().default([]),
    /** Leituras do Beds24 antes e depois, nos mesmos campos. */
    antes: jsonb("antes").$type<LidoBeds24>(),
    depois: jsonb("depois").$type<LidoBeds24>(),
    beds24Id: text("beds24_id"),
    credencial: text("credencial").notNull().default(""),
    /** null = a rotina. */
    autorId: uuid("autor_id").references(() => usuarios.id, { onDelete: "set null" }),
    tentativas: integer("tentativas").notNull().default(0),
    iniciadoEm: timestamp("iniciado_em", { withTimezone: true }).notNull().defaultNow(),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
    respondidoEm: timestamp("respondido_em", { withTimezone: true }),
    terminadoEm: timestamp("terminado_em", { withTimezone: true }),
    erro: text("erro").notNull().default(""),
    /**
     * M8.3c (migração 0074): a classificação da resposta do Beds24 ao POST (desenho 3.8; lista fechada `RESPOSTAS_BEDS24`),
     * que decide a saída da incerteza na volta seguinte. Nula antes do POST. O `erro` é o texto fixo dela, nunca o do Beds24.
     */
    resposta: text("resposta").$type<RespostaBeds24>(),
    /** M8.3c: detalhes seguros de forma fechada (`DetalheOperacaoBeds24`: o id sugerido, as duplicadas, o bloqueio achado, o que o ensaio observou). */
    detalhe: jsonb("detalhe").$type<DetalheOperacaoBeds24>().notNull().default({}),
  },
  (t) => [
    uniqueIndex("beds24_reservas_operacoes_chave").on(t.organizacaoId, t.chave),
    uniqueIndex("beds24_reservas_operacoes_uma_ativa").on(t.reservaId).where(sql`${t.situacao} in ('pendente', 'enviando', 'incerta')`),
    index("beds24_reservas_operacoes_situacao").on(t.organizacaoId, t.situacao, t.iniciadoEm),
    index("beds24_reservas_operacoes_beds24").on(t.organizacaoId, t.beds24Id).where(sql`${t.beds24Id} is not null`),
    // M8.3c: o último 403 ou 401 de reservas em Integrações (`ultimaRecusaDeReservas`), também do ensaio, sem acompanhamento.
    index("beds24_reservas_operacoes_resposta").on(t.organizacaoId, t.resposta, t.respondidoEm).where(sql`${t.resposta} is not null`),
    foreignKey({ columns: [t.acompanhamentoId], foreignColumns: [beds24ReservasSite.id], name: "beds24_reservas_operacoes_acompanhamento_fk" }),
  ],
);

/**
 * O estado da rotina das reservas do site no Beds24 por organização (M8.3c, migração 0074; desenho 4.5, 7 e 9). Não é
 * configuração editável (essa é a `reservas_beds24`, com auditoria): é estado operacional, escrito pela rotina e pelo botão
 * de Integrações — a última leitura dos escopos (só nomes de escopo e a impressão da credencial, nunca a credencial) e as
 * marcas de tempo da conferência contínua. Nenhum dado pessoal nem valor.
 */
export const beds24ReservasRotina = pgTable("beds24_reservas_rotina", {
  organizacaoId: uuid("organizacao_id").primaryKey().references(() => organizacoes.id),
  /** A avaliação dos escopos lida em GET /authentication/details (`EscoposLidosBeds24`); null = nunca lida. */
  escopos: jsonb("escopos").$type<EscoposLidosBeds24>(),
  /** `impressaoCredencialBeds24` da credencial que leu os escopos: outra credencial = sem leitura válida. */
  escoposCredencial: text("escopos_credencial").notNull().default(""),
  escoposLidosEm: timestamp("escopos_lidos_em", { withTimezone: true }),
  /** A última leitura por `modifiedFrom` que concluiu (4.5): a próxima lê desde 15 min antes. */
  conferenciaEm: timestamp("conferencia_em", { withTimezone: true }),
  /** A última releitura por id que concluiu (de hora em hora). */
  releituraEm: timestamp("releitura_em", { withTimezone: true }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// M10.1a: WhatsApp (recebimento; desenho em requisitos/product/WHATSAPP.md). Não guarda mídia, url, id de mídia, sha256,
// nome de arquivo, coordenadas, contato compartilhado nem system.body. Listas fechadas em whatsapp/regras.ts; colunas de
// texto sem CHECK de lista, como as do M8.2 e do M8.3; CHECK só para a estrutura. Telefone (`wa_id`), BSUID, nomes, texto
// e `wamid` só existem em `whatsapp_contatos` e `whatsapp_mensagens`; eventos, contadores e a situação da conta não levam
// nenhum dado pessoal. Nada aqui escreve na Meta.
// ---------------------------------------------------------------------------

/**
 * Situação da conta do WhatsApp da organização, escrita só pelos avisos (`account_update`, histórico, agenda). Uma linha
 * por organização, criada no primeiro aviso; sem linha = "não conectada". A configuração editável (ids da Meta e quem vê
 * as conversas) mora no armazém `configuracoes`, chave "whatsapp".
 */
export const whatsappConta = pgTable(
  "whatsapp_conta",
  {
    organizacaoId: uuid("organizacao_id").primaryKey().references(() => organizacoes.id),
    situacao: text("situacao").$type<SituacaoConta>().notNull().default("nao_conectada"),
    ultimoEvento: text("ultimo_evento").$type<EventoConta>(),
    motivo: text("motivo").$type<MotivoDesconexao>(),
    iniciadoPor: text("iniciado_por").$type<IniciadoPor>(),
    /** Hora da Meta (`entry.time`) do último evento aplicado: só um evento mais novo muda a situação. */
    situacaoEm: timestamp("situacao_em", { withTimezone: true }),
    /** PARTNER_ADDED: começa o prazo de 24 h para pedir os contatos e o histórico (M10.1b). */
    conectadoEm: timestamp("conectado_em", { withTimezone: true }),
    sincronizacaoContatos: text("sincronizacao_contatos").$type<Sincronizacao>().notNull().default("nao_pedida"),
    /** Último aviso de agenda aceito, mesmo que tudo nele tenha sido descartado: a Meta não manda sinal de fim. */
    contatosRecebidosEm: timestamp("contatos_recebidos_em", { withTimezone: true }),
    sincronizacaoHistorico: text("sincronizacao_historico").$type<Sincronizacao>().notNull().default("nao_pedida"),
    /** Maior `progress` recebido do histórico (0 a 100). */
    progressoHistorico: integer("progresso_historico"),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("whatsapp_conta_progresso", sql`${t.progressoHistorico} is null or (${t.progressoHistorico} between 0 and 100)`)],
);

/**
 * A conversa: um cliente do WhatsApp da empresa. O BSUID (`user_id`) é a chave principal; o `wa_id` (só dígitos, com DDI)
 * é a segunda, opcional. Troca de identidade não funde conversas: se colidir, as duas ficam com `conflito_identidade`.
 * O vínculo (reserva, cotação, pedido de contato, cadastro pelo site ou proprietário) é no máximo um e só existe
 * confirmado à mão: ter um alvo e ter `vinculo_confirmado_em` andam juntos (CHECK). Sugestões não são guardadas.
 */
export const whatsappContatos = pgTable(
  "whatsapp_contatos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    waId: text("wa_id"),
    bsuid: text("bsuid"),
    nomePerfil: text("nome_perfil").notNull().default(""),
    /** Só de quem já tem conversa (agenda do celular, `smb_app_state_sync`); nunca cria conversa. */
    nomeAgenda: text("nome_agenda").notNull().default(""),
    nomeAgendaEm: timestamp("nome_agenda_em", { withTimezone: true }),
    /** Qualquer mensagem, de qualquer origem: ordena a lista. */
    ultimaMensagemEm: timestamp("ultima_mensagem_em", { withTimezone: true }),
    /** Só `recebida` em tempo real ("sem resposta" e "não lida"; o histórico não conta). */
    ultimaRecebidaEm: timestamp("ultima_recebida_em", { withTimezone: true }),
    /** Só `enviada_*` em tempo real (a resposta pelo celular conta). */
    ultimaEnviadaEm: timestamp("ultima_enviada_em", { withTimezone: true }),
    /** Estado interno: nada é marcado como lido na Meta. */
    lidaAte: timestamp("lida_ate", { withTimezone: true }),
    conflitoIdentidade: boolean("conflito_identidade").notNull().default(false),
    reservaId: uuid("reserva_id").references(() => reservas.id),
    cotacaoId: uuid("cotacao_id").references(() => cotacoes.id),
    /** Chaves estrangeiras com nome próprio (abaixo): o automático passaria de 63 caracteres. */
    pedidoContatoId: uuid("pedido_contato_id"),
    cadastroMarketplaceId: uuid("cadastro_marketplace_id"),
    proprietarioId: uuid("proprietario_id").references(() => proprietarios.id),
    vinculoConfirmadoPor: uuid("vinculo_confirmado_por").references(() => usuarios.id, { onDelete: "set null" }),
    vinculoConfirmadoEm: timestamp("vinculo_confirmado_em", { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_contatos_wa_id").on(t.organizacaoId, t.waId).where(sql`${t.waId} is not null`),
    uniqueIndex("whatsapp_contatos_bsuid").on(t.organizacaoId, t.bsuid).where(sql`${t.bsuid} is not null`),
    // Na ordem da lista (mais recente primeiro, conversa sem mensagem no fim): só assim o índice serve à ordenação.
    index("whatsapp_contatos_ultima").on(t.organizacaoId, t.ultimaMensagemEm.desc().nullsLast()),
    index("whatsapp_contatos_reserva").on(t.reservaId).where(sql`${t.reservaId} is not null`),
    // A limpeza de cotações de 30 dias (site/cotacoes.ts) não apaga a cotação vinculada: consulta por esta coluna.
    index("whatsapp_contatos_cotacao").on(t.cotacaoId).where(sql`${t.cotacaoId} is not null`),
    foreignKey({ columns: [t.pedidoContatoId], foreignColumns: [pedidosContatoProprietario.id], name: "whatsapp_contatos_pedido_contato_fk" }),
    foreignKey({ columns: [t.cadastroMarketplaceId], foreignColumns: [cadastrosMarketplace.id], name: "whatsapp_contatos_cadastro_fk" }),
    // "is not null" explícito porque um CHECK que dá null passa.
    check("whatsapp_contatos_identidade", sql`${t.waId} is not null or ${t.bsuid} is not null`),
    check("whatsapp_contatos_wa_id_digitos", sql`${t.waId} is null or ${t.waId} ~ '^[0-9]{6,20}$'`),
    check(
      "whatsapp_contatos_um_vinculo",
      sql`num_nonnulls(${t.reservaId}, ${t.cotacaoId}, ${t.pedidoContatoId}, ${t.cadastroMarketplaceId}, ${t.proprietarioId}) <= 1 and ((num_nonnulls(${t.reservaId}, ${t.cotacaoId}, ${t.pedidoContatoId}, ${t.cadastroMarketplaceId}, ${t.proprietarioId}) = 1) = (${t.vinculoConfirmadoEm} is not null))`,
    ),
  ],
);

/**
 * Uma mensagem (recebida, ou enviada pelo celular). Única por organização e `wamid` (tratado como dado pessoal): repetição,
 * eco e histórico do mesmo `wamid` viram uma linha só. Só texto e legenda; da mídia, só o tipo e o mime. Apagada não tem
 * texto (CHECK). `situacao` só existe para as enviadas pelo painel (M10.2) e fica nula aqui.
 */
export const whatsappMensagens = pgTable(
  "whatsapp_mensagens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    contatoId: uuid("contato_id").notNull().references(() => whatsappContatos.id),
    wamid: text("wamid").notNull(),
    direcao: text("direcao").$type<Direcao>().notNull(),
    origem: text("origem").$type<Origem>().notNull(),
    tipo: text("tipo").$type<TipoMensagem>().notNull(),
    texto: text("texto").notNull().default(""),
    anexoMime: text("anexo_mime"),
    /** `context.id` (a mensagem respondida), sem exigir formato. */
    respostaA: text("resposta_a"),
    /** `timestamp` da Meta. */
    enviadaEm: timestamp("enviada_em", { withTimezone: true }).notNull(),
    recebidaEm: timestamp("recebida_em", { withTimezone: true }).notNull().defaultNow(),
    /** Hora da edição aplicada (só uma edição mais nova muda o texto). */
    editadaEm: timestamp("editada_em", { withTimezone: true }),
    apagadaEm: timestamp("apagada_em", { withTimezone: true }),
    /** Emoji da reação; null = sem reação (ou retirada). */
    reacao: text("reacao"),
    reacaoEm: timestamp("reacao_em", { withTimezone: true }),
    situacao: text("situacao"),
  },
  (t) => [
    uniqueIndex("whatsapp_mensagens_wamid").on(t.organizacaoId, t.wamid),
    index("whatsapp_mensagens_contato").on(t.contatoId, t.enviadaEm),
    // Apagamento é absorvente: nada depois devolve o texto.
    check("whatsapp_mensagens_apagada_sem_texto", sql`${t.apagadaEm} is null or ${t.texto} = ''`),
    // 256 = LIMITE_WAMID (whatsapp/regras.ts).
    check("whatsapp_mensagens_wamid_tamanho", sql`char_length(${t.wamid}) between 1 and 256`),
  ],
);

/**
 * Um bloco (`change`) processado, sem nada do corpo: campo, quantos itens mudaram e o resultado; nos eventos de conta,
 * o código, o motivo, a hora da Meta e o e-mail. A `chave` (só `account_update`) dá a idempotência e nunca leva wamid,
 * telefone, BSUID nem id da Meta: `account_update:<event>:<entry.time>:<reason ou ->:<ban_state ou ->`. Apagado depois
 * de 90 dias.
 */
export const whatsappEventos = pgTable(
  "whatsapp_eventos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    campo: text("campo").$type<CampoAviso>().notNull(),
    /** Código do evento de conta validado, ou vazio. */
    tipo: text("tipo").$type<EventoConta | "">().notNull().default(""),
    motivo: text("motivo").$type<MotivoDesconexao>(),
    chave: text("chave").notNull().default(""),
    /** Linhas novas ou alteradas do bloco. */
    itens: integer("itens").notNull().default(0),
    resultado: text("resultado").$type<ResultadoEvento>().notNull(),
    /** `entry.time` do account_update. */
    ocorridoEm: timestamp("ocorrido_em", { withTimezone: true }),
    recebidoEm: timestamp("recebido_em", { withTimezone: true }).notNull().defaultNow(),
    avisarPorEmail: boolean("avisar_por_email").notNull().default(false),
    /** Só com o e-mail enviado; sem ele, a rotina tenta de novo. */
    emailAvisoEm: timestamp("email_aviso_em", { withTimezone: true }),
    /** Último resultado do envio (Integrações mostra a causa certa de um e-mail não enviado). */
    emailResultado: text("email_resultado").$type<ResultadoEmail>(),
  },
  (t) => [uniqueIndex("whatsapp_eventos_chave").on(t.organizacaoId, t.chave).where(sql`${t.chave} <> ''`), index("whatsapp_eventos_recebido").on(t.recebidoEm)],
);

/**
 * Contas agregadas dos avisos do WhatsApp por dia (São Paulo), como `pagamentos_avisos_dia`: sem organização (a
 * assinatura inválida chega antes de saber de quem é) e sem nenhum dado do aviso. Apagadas depois de 90 dias, menos o
 * último dia com aviso válido.
 */
export const whatsappAvisosDia = pgTable("whatsapp_avisos_dia", {
  dia: date("dia", { mode: "string" }).primaryKey(),
  assinaturasRecusadas: integer("assinaturas_recusadas").notNull().default(0),
  ilegiveis: integer("ilegiveis").notNull().default(0),
  outraConta: integer("outra_conta").notNull().default(0),
  desconhecidos: integer("desconhecidos").notNull().default(0),
  ignorados: integer("ignorados").notNull().default(0),
  ultimoValidoEm: timestamp("ultimo_valido_em", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// M3.11a: cópia datada da leitura do Beds24 e preço importado por noite (desenho em
// requisitos/product/FONTE-UNICA-PRECOS.md, 3.1 e 3.2). Só preço, mínimo, máximo, unidades e bloqueio: nada de hóspede.
// ---------------------------------------------------------------------------

/**
 * Por que a cópia foi guardada: o botão "Guardar uma cópia agora", antes de a importação do Beds24 (M3.3) apagar a
 * leitura, antes de a simulação ou o envio (M3.7) a regravarem, e ao aprovar uma importação de preços.
 */
export const MOTIVOS_COPIA_CALENDARIO = ["manual", "antes_da_leitura", "antes_da_simulacao", "antes_do_envio", "importacao"] as const;
export type MotivoCopiaCalendario = (typeof MOTIVOS_COPIA_CALENDARIO)[number];
/** Uma noite copiada: os campos da leitura (`beds24_calendario`), sem a hora de cada uma. Dinheiro em centavos. */
export type NoiteCopiada = { data: string; preco: number | null; minimo: number | null; maximo: number | null; livres: number | null; bloqueio: string | null };

/**
 * Cópia datada da leitura do calendário de um imóvel, de um quarto. Só inclusão: nenhum caminho do código altera ou apaga
 * (calendario/copias.ts). `assinatura` = SHA-256 do quarto e das noites em ordem de data (`assinaturaDaLeitura`); a cópia
 * igual à última do imóvel e do quarto não é gravada de novo. `lido_em` = a hora da leitura mais nova entre as noites.
 * Quarto nulo: as observações antigas, de antes de a leitura guardar o quarto.
 */
export const beds24CalendarioCopias = pgTable(
  "beds24_calendario_copias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** A ordem de gravação (as cópias de uma mesma transação têm o mesmo `criado_em`): a última cópia é a de maior ordem. */
    ordem: integer("ordem").generatedAlwaysAsIdentity(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    roomId: text("room_id"),
    motivo: text("motivo").$type<MotivoCopiaCalendario>().notNull(),
    /** null = o sistema (a importação automática, a rotina do envio). */
    autorId: uuid("autor_id").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    lidoEm: timestamp("lido_em", { withTimezone: true }).notNull(),
    noites: integer("noites").notNull(),
    assinatura: text("assinatura").notNull(),
    dados: jsonb("dados").$type<NoiteCopiada[]>().notNull(),
  },
  (t) => [index("beds24_calendario_copias_imovel").on(t.organizacaoId, t.imovelId, t.ordem), check("beds24_calendario_copias_noites", sql`${t.noites} > 0`)],
);

/**
 * Preço importado do Beds24 por noite (a camada do M3.11a). Vale só com a fonte "preços automáticos do SCL": abaixo do
 * período com preço e dos eventos e feriadões, acima do preço base (motor.ts). O mínimo importado entra no lugar da
 * "semana normal". `copia_id` = a cópia da leitura usada na aprovação. Uma noite por imóvel.
 */
export const precosImportados = pgTable(
  "precos_importados",
  {
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id),
    data: date("data", { mode: "string" }).notNull(),
    preco: integer("preco").notNull(),
    minimoNoites: integer("minimo_noites"),
    copiaId: uuid("copia_id").notNull().references(() => beds24CalendarioCopias.id),
    criadoEm: criadoEm(),
    /** null = o sistema. */
    autorId: uuid("autor_id").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.organizacaoId, t.imovelId, t.data] }),
    check("precos_importados_preco", sql`${t.preco} > 0`),
    check("precos_importados_minimo", sql`${t.minimoNoites} is null or (${t.minimoNoites} between 1 and 365)`),
  ],
);

// ---------------------------------------------------------------------------
// Reserva direta confirmada no SCL e as OTAs (M3.11b, desenho em requisitos/product/SO-DISPONIBILIDADE.md, 8): a reserva
// que não nasce no Beds24 (WhatsApp, indicação) tem as datas fechadas lá à mão, como bloqueio, e a equipe marca aqui.
// Nunca `beds24_reservas_site`: o envio do M8.3c lê aquela tabela para decidir o que escrever no Beds24, e a reserva direta
// nunca pode entrar nessa fila. Só ids e horas: nenhum dado pessoal nem valor.
// ---------------------------------------------------------------------------

/**
 * As marcas manuais das OTAs de uma reserva direta (uma linha por reserva, criada pela primeira marca): "Datas fechadas
 * nas OTAs" (`fechadas_em`/`por`) tira o aviso "feche as datas"; cancelada depois disso, "Datas reabertas nas OTAs"
 * (`reabertas_em`/`por`) tira o "reabra as datas". Fechar de novo (a reserva confirmada outra vez) regrava a linha e zera a
 * reabertura. `por` nulo só se o usuário for apagado.
 */
export const reservasDiretasOtas = pgTable(
  "reservas_diretas_otas",
  {
    reservaId: uuid("reserva_id").primaryKey().references(() => reservas.id),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    fechadasEm: timestamp("fechadas_em", { withTimezone: true }).notNull(),
    fechadasPor: uuid("fechadas_por").references(() => usuarios.id, { onDelete: "set null" }),
    reabertasEm: timestamp("reabertas_em", { withTimezone: true }),
    reabertasPor: uuid("reabertas_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reservas_diretas_otas_organizacao").on(t.organizacaoId)],
);
