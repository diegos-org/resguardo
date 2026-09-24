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
 * Código de login enviado por e-mail (M1.3). Guarda só o HMAC do código, nunca o código.
 * Uso único (`usadoEm`), validade curta (`expiraEm`) e limite de tentativas.
 */
export const codigosLogin = pgTable(
  "codigos_login",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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

// ---------------------------------------------------------------------------
// Reservas e bloqueios (M3.1)
// ---------------------------------------------------------------------------

export const ORIGENS_RESERVA = ["airbnb", "booking", "site", "direta", "outro"] as const;
export type OrigemReserva = (typeof ORIGENS_RESERVA)[number];
export const origemReservaEnum = pgEnum("origem_reserva", ORIGENS_RESERVA);

export const ESTADOS_RESERVA = ["pendente", "confirmada", "cancelada"] as const;
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
    /** Código da reserva no canal (ex.: HMXXXX do Airbnb). */
    codigoCanal: text("codigo_canal").notNull().default(""),
    observacoes: text("observacoes").notNull().default(""),
    canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reservas_codigo").on(t.organizacaoId, t.codigo),
    uniqueIndex("reservas_fonte").on(t.organizacaoId, t.fonte, t.idFonte).where(sql`${t.idFonte} <> ''`),
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
    criadoEm: criadoEm(),
  },
  (t) => [
    uniqueIndex("bloqueios_fonte").on(t.organizacaoId, t.fonte, t.idFonte).where(sql`${t.idFonte} <> ''`),
    index("bloqueios_imovel_periodo").on(t.imovelId, t.inicio, t.fim),
  ],
);

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

/**
 * Repasse mensal ao proprietário (M4.9): o fechamento de um mês. Os valores ficam gravados como
 * foram calculados no fechamento; os lançamentos do livro (tipo "repasse") têm a chave
 * `repasse:<id>:<imóvel>`. Um repasse ativo por proprietário e mês.
 */
export const repasses = pgTable(
  "repasses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizacaoId: uuid("organizacao_id").notNull().references(() => organizacoes.id),
    proprietarioId: uuid("proprietario_id").notNull().references(() => proprietarios.id),
    /** Primeiro dia do mês fechado. */
    mes: date("mes", { mode: "string" }).notNull(),
    /** Saldo do acerto no fim do mês, antes do repasse (positivo: a empresa devia). */
    saldo: integer("saldo").notNull(),
    /** Adiantamentos descontados neste repasse. */
    descontado: integer("descontado").notNull(),
    /** Adiantamentos contestados, que ficaram de fora (não descontados). */
    contestado: integer("contestado").notNull(),
    /** Valor transferido ao proprietário. */
    valor: integer("valor").notNull(),
    situacao: text("situacao").$type<SituacaoRepasse>().notNull().default("a_pagar"),
    dataPagamento: date("data_pagamento", { mode: "string" }),
    motivoEstorno: text("motivo_estorno").notNull().default(""),
    criadoPor: uuid("criado_por").references(() => usuarios.id),
    criadoEm: criadoEm(),
    estornadoEm: timestamp("estornado_em", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("repasses_um_por_mes").on(t.proprietarioId, t.mes).where(sql`${t.estornadoEm} is null`),
    index("repasses_org_mes").on(t.organizacaoId, t.mes),
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
    observacao: text("observacao").notNull().default(""),
    criadoPor: uuid("criado_por").references(() => usuarios.id),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("manutencoes_org_estado").on(t.organizacaoId, t.estado), index("manutencoes_imovel").on(t.imovelId)],
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
  /** Pendência concreta (falha de entrega, dúvida de correspondência…); vazio = nenhuma. */
  pendencia: text("pendencia").notNull().default(""),
  criadoEm: criadoEm(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});
