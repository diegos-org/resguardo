import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

export const PAPEIS = ["admin", "operacao", "proprietario", "hospede"] as const;
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
    email: text("email").notNull(),
    nome: text("nome").notNull(),
    papel: papelEnum("papel").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("usuarios_email_unico").on(sql`lower(${t.email})`)],
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
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("imoveis_codigo_por_org").on(t.organizacaoId, t.codigo)],
);

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

/** Quais imóveis pertencem a quais proprietários. */
export const proprietarioImoveis = pgTable(
  "proprietario_imoveis",
  {
    proprietarioId: uuid("proprietario_id").notNull().references(() => proprietarios.id, { onDelete: "cascade" }),
    imovelId: uuid("imovel_id").notNull().references(() => imoveis.id, { onDelete: "cascade" }),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.proprietarioId, t.imovelId] })],
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
