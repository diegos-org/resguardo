import { sql } from "drizzle-orm";
import { boolean, customType, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { FontePrecos } from "@/imoveis/fonte-precos";
import type { PeriodicidadeRepasse } from "@/repasses/periodicidade";

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
 * `documento` hoje é só "como_funciona"; as páginas legais do site (M7.4) poderão usar a mesma tabela.
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

export const TIPOS_MENSAGEM_HOSPEDE = ["confirmacao", "checkin", "checkout", "agradecimento"] as const;
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
  },
  (t) => [index("cadastros_marketplace_org").on(t.organizacaoId, t.situacao, t.criadoEm), index("cadastros_marketplace_email").on(t.email)],
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
