/**
 * Beds24 (M3.2/M3.7) — tipos INTERNOS, já normalizados. O resto do sistema só enxerga isto;
 * o formato da API fica isolado em `http.ts` e `normalizar.ts`. São duas escritas, cada uma com
 * o seu contrato e a sua chave, independentes nos dois sentidos: o calendário (preço,
 * mínimo/máximo e bloqueio por noite — M3.7, `EscritorBeds24`), atrás de `BEDS24_ESCRITA=ligada`,
 * e as reservas pagas pelo site (M8.3c, `EscritorReservasBeds24`: criar, atualizar e cancelar,
 * nunca apagar), atrás de `BEDS24_ESCRITA_RESERVAS=ligada` (`escritaReservasBeds24Pronta`).
 */
export type EstadoBeds24 = "confirmada" | "pendente" | "cancelada" | "bloqueio" | "consulta" | "pedido";
export type CanalBeds24 = "airbnb" | "booking" | "direta" | "outro";

export type ReservaBeds24 = {
  idExterno: string;
  propertyId: string;
  roomId: string;
  estado: EstadoBeds24;
  checkin: string;
  checkout: string;
  hospedes: number | null;
  nome: string;
  email: string;
  telefone: string;
  /** Centavos; null = não informado. */
  valorBruto: number | null;
  comissaoCanal: number | null;
  canal: CanalBeds24;
  /** Código no canal (ex.: HM… do Airbnb), quando vier. */
  codigoCanal: string;
  modificadoEm: string | null;
  reservadaEm?: string | null;
  /**
   * M8.3: o código da reserva do SCL (SCL-XXXXXX) que marca o registro como uma reserva paga pelo site criada pelo
   * sistema: o info item `SCL` ou, como reforço, o código solto no nome ou nas notas. null = sem marca legível (inclusive
   * quando a leitura não pediu os info items, ou quando há mais de um código e não dá para saber qual vale).
   */
  referenciaScl: string | null;
  /**
   * M8.3c: de onde veio a `referenciaScl` — o info item `SCL` ("info") ou o código solto no nome ou nas notas ("texto").
   * Só a marca do info item adota e cancela duplicada (desenho 3.5 e 4.3): o código nas notas de uma reserva de OTA não
   * faz dela uma reserva do SCL. null sem marca.
   */
  marcaFonte: "info" | "texto" | null;
  /**
   * M8.3c (desenho 5.2, "Para o M8.3c"): a marca existe mas não dá para ler — dois códigos diferentes na mesma fonte, ou um
   * info item `SCL` com um texto que não é um código válido (ou sem texto). Separado de "sem marca": o ambíguo é desviado
   * com aviso, nunca importado nem adotado. Com ele, `referenciaScl` é sempre null.
   */
  marcaAmbigua: boolean;
  /** M8.3: registro do ensaio do SCL (info item `SCL-ENSAIO`): nunca vira reserva nem bloqueio. */
  ensaio: boolean;
  /**
   * M8.3c: o texto do info item `SCL-ENSAIO` quando é um id de operação (uuid) — para "Conferir o ensaio" achar o ensaio que
   * ficou sem id na resposta. null sem o info item, com outro texto ou com dois ids diferentes.
   */
  ensaioOperacaoId: string | null;
  /**
   * M8.3c: a origem pela API informada pelo Beds24 (`apiSource`), curta e só com caracteres seguros (letras, números,
   * espaço, ponto, dois-pontos, barra, sublinhado e hífen); null ausente ou fora disso. Entra na regra do ocupante exato
   * (desenho 3.8, item 5).
   */
  origemApi: string | null;
};

export type DiaCalendario = {
  roomId: string;
  data: string;
  /**
   * Unidades livres; null = o Beds24 não informou (NUNCA tratar como disponível). Negativo = overbooking: mais reservas
   * que unidades (M8.3c; o Beds24 informa assim, desenho 4.4) — conta como noite fechada, como o zero.
   */
  livres: number | null;
  /** Centavos; null = sem preço informado. */
  preco: number | null;
  minimoNoites: number | null;
  maximoNoites: number | null;
  /** `override` do calendário ("none", "blackout", "noCheckIn"…); null = não informado. */
  bloqueio: string | null;
};

export type QuartoBeds24 = { propertyId: string; roomId: string; nome: string; moeda?: string };

/** Linha recebida que não passou na validação: nunca vira dado, vira divergência. */
export type Divergencia = { origem: "reserva" | "calendario" | "quarto"; id: string; motivo: string };

export type Lido<T> = { itens: T[]; divergencias: Divergencia[]; lidoEm: string };

export type FiltroReservas = {
  chegadaDe?: string;
  chegadaAte?: string;
  saidaDe?: string;
  ids?: string[];
  modificadasDesde?: string;
  propertyIds?: string[];
  /** M8.3: só as reservas deste quarto (`roomId`). */
  quarto?: string;
  /**
   * M8.3: só as reservas com entrada neste dia (`arrivalFrom` = `arrivalTo`, explícitos: sem filtro de chegada, o Beds24
   * só devolve as reservas futuras). Vale no lugar de `chegadaDe`/`chegadaAte`.
   */
  chegadaExata?: string;
  /** M8.3: busca por texto do Beds24 (`searchString`), para achar a marca no nome. */
  pesquisa?: string;
  /** M8.3: pede os info items (`includeInfoItems=true`), onde mora a marca do SCL. Sem isto, `referenciaScl` só sai do nome ou das notas. */
  incluirInfo?: boolean;
};
export type FiltroCalendario = { roomIds: string[]; inicio: string; fim: string };

/** Contrato de leitura. Implementações: HTTP (real) e falsa (testes/desenvolvimento). */
export interface LeitorBeds24 {
  reservas(f: FiltroReservas): Promise<Lido<ReservaBeds24>>;
  calendario(f: FiltroCalendario): Promise<Lido<DiaCalendario>>;
  quartos(): Promise<Lido<QuartoBeds24>>;
}

/**
 * O que a credencial pode fazer (M8.3, prontidão; GET /authentication/details), só leitura. O formato dos escopos na
 * resposta ainda está "a confirmar" com o Beds24: o que não estiver no formato "nível:recurso" conhecido vai para
 * `ilegiveis` e nunca conta como em ordem.
 */
export type CredencialBeds24 = {
  /** Escopos lidos, em minúsculas (ex.: "read:bookings", "write:inventory"); null = a resposta não trouxe uma lista que dê para ler. */
  escopos: string[] | null;
  /** Itens da lista fora do formato conhecido (texto curto, só para mostrar na tela). */
  ilegiveis: string[];
  lidoEm: string;
};

/**
 * Leitura dos escopos da credencial (M8.3). Contrato à parte de `LeitorBeds24`: só a prontidão das reservas precisa dele.
 * Implementações: HTTP (real) e falsa.
 */
export interface LeitorCredencialBeds24 {
  credencial(): Promise<CredencialBeds24>;
}

/** Valores de `override` do calendário Beds24 que o SCL sabe ler e escrever. */
export const BLOQUEIOS_BEDS24 = ["none", "blackout", "exception", "noCheckIn", "noCheckOut", "noCheckInOrCheckOut"] as const;
/**
 * Bloqueio por noite enviado ao Beds24: "blackout" fecha a noite; "none" reabre o que o SCL fechou;
 * os demais devolvem a restrição que já existia no Beds24 antes do bloqueio do SCL.
 */
export type BloqueioEnvio = (typeof BLOQUEIOS_BEDS24)[number];
export const ehBloqueioEnvio = (b: unknown): b is BloqueioEnvio => typeof b === "string" && (BLOQUEIOS_BEDS24 as readonly string[]).includes(b);
/** Faixa de noites [from, to] (inclusive) com os mesmos valores. Campo ausente = não alterar. */
export type FaixaEnvio = { from: string; to: string; preco?: number; minimo?: number; maximo?: number; bloqueio?: BloqueioEnvio };
export type EnvioCalendario = { roomId: string; faixas: FaixaEnvio[] };
export type ResultadoEscrita = { roomId: string; ok: boolean; erro: string };

/**
 * Contrato de escrita (M3.7): só o calendário por noite. Nunca cria/altera reservas.
 * Só sai do ambiente com `BEDS24_ESCRITA=ligada` (ver `escritorDoAmbiente`).
 */
export interface EscritorBeds24 {
  escreverCalendario(itens: EnvioCalendario[]): Promise<ResultadoEscrita[]>;
}

// ---------------------------------------------------------------- escrita de reservas (M8.3c, desenho 3.7 e 3.8)

/** A marca gravada no info item da reserva criada: o código da reserva do SCL (`SCL`) ou o id da operação do ensaio (`SCL-ENSAIO`). */
export type MarcaDaGravacao = { tipo: "reserva"; codigo: string } | { tipo: "ensaio"; operacaoId: string };

/**
 * Um item de `POST /bookings` (um por chamada; desenho 3.6). Só quarto, datas, pessoas, situação e a marca: nunca nome,
 * e-mail, telefone, notas nem valor (D1 e D2). A atualização nunca troca o quarto; o cancelamento muda a situação para
 * `cancelled` e nunca apaga (não há DELETE).
 */
export type ItemGravacaoReserva =
  | { tipo: "criar"; quarto: string; chegada: string; saida: string; hospedes: number; marca: MarcaDaGravacao }
  | { tipo: "atualizar"; id: string; chegada: string; saida: string; hospedes: number }
  | { tipo: "cancelar"; id: string };

/**
 * A classificação da resposta do Beds24 a um item (desenho 3.8): lista fechada, gravada em
 * `beds24_reservas_operacoes.resposta`. Fica aqui, no contrato do cliente (o HTTP e o falso classificam pela mesma função,
 * `classificarGravacaoReserva`); as decisões sobre cada uma ficam nas regras do envio.
 * - `criada`: criação com HTTP 2xx, `success: true` e id legível;
 * - `modificada`: atualização ou cancelamento com `success: true` (o id é o enviado);
 * - `sem_id`: sucesso sem a prova — criação com `success: true` sem id legível, ou `success: true` dentro de um 429 (o 429
 *   com a lista tem sucesso duvidoso). Nunca repete sozinho: o Beds24 disse que gravou;
 * - `recusada_disponibilidade` e `recusada`: `success: false` ou `errors` no item (com e sem mensagem de disponibilidade).
 *   "Success being false does not necessarily mean that nothing has changed": a busca decide;
 * - `http_4xx`: outro 4xx (400, 404, 409, 422…), fora 401, 403 e 429 — conta como recusa;
 * - `tempo`, `rede`, `http_5xx` e `formato` (resposta que não é JSON nem a lista de itens): a busca decide;
 * - `limite`: HTTP 429 com corpo que não é a lista de itens, ou o 429 do pedido do token (pedir token também gasta
 *   crédito) — o pedido não foi processado;
 * - `http_403`: sem permissão de escrever reservas; `http_401`: 401 repetido depois da renovação, ou o pedido do token (o
 *   inicial ou a renovação) recusado com HTTP 4xx fora o 429 — o pedido não foi processado;
 * - `nao_enviado`: nada chegou a ser processado pelo Beds24 — o pedido do token (o inicial ou a renovação depois do
 *   primeiro 401, que não foi processado) caiu por rede, tempo ou 5xx, ou o pedido nem saiu (item inválido, cabeçalho
 *   inválido, o prazo da operação já acabado).
 */
export const RESPOSTAS_BEDS24 = [
  "criada", "modificada", "sem_id", "recusada_disponibilidade", "recusada", "http_4xx",
  "tempo", "rede", "http_5xx", "formato", "limite", "http_403", "http_401", "nao_enviado",
] as const;
export type RespostaBeds24 = (typeof RESPOSTAS_BEDS24)[number];

/**
 * O `erro` das operações de reserva: um texto FIXO por código de resposta (desenho 3.8), nunca o texto livre do Beds24 — a
 * recusa de disponibilidade pode trazer dados de outra reserva. Vazio nos dois sucessos.
 */
export const TEXTOS_DE_ERRO_BEDS24: Record<RespostaBeds24, string> = {
  criada: "",
  modificada: "",
  sem_id: "O Beds24 respondeu que gravou, mas sem a prova (sem o id da reserva, ou junto com o limite de uso): a busca confere.",
  recusada_disponibilidade: "O Beds24 recusou por falta de disponibilidade nas datas.",
  recusada: "O Beds24 recusou o pedido (success: false ou erro no item).",
  http_4xx: "O Beds24 recusou o pedido (HTTP 4xx).",
  tempo: "O Beds24 não respondeu a tempo: a busca confere se a reserva foi gravada.",
  rede: "Falha de rede ao falar com o Beds24: a busca confere se a reserva foi gravada.",
  http_5xx: "O Beds24 respondeu com erro do servidor (HTTP 5xx): a busca confere se a reserva foi gravada.",
  formato: "Resposta do Beds24 em formato inesperado: a busca confere se a reserva foi gravada.",
  limite: "Limite de uso do Beds24 atingido (HTTP 429): o pedido não foi processado.",
  http_403: "Beds24 recusou a escrita (HTTP 403): a credencial não tem permissão de escrever reservas. Gere um novo convite com a escrita de reservas.",
  http_401: "Beds24 recusou a credencial (HTTP 401) mesmo depois de renovar o token: confira o refresh token e os escopos.",
  nao_enviado: "Nada foi processado pelo Beds24: o token não pôde ser obtido ou o pedido não saiu.",
};

/**
 * O que a gravação deixa ver, para o ensaio registrar (desenho 12, itens 1 e 11): só nomes, nunca valores — a chave do id
 * dentro de `new` (e as chaves que `new` trouxe, para quando o id não for achado) e os nomes dos cabeçalhos de crédito que
 * vieram.
 */
export type ObservadoNaGravacao = { chaveDoId: string | null; chavesEmNew: string[]; cabecalhosDeCredito: string[] };

/**
 * A resposta de um item, já classificada. `beds24Id` só nos dois sucessos (na criação, o id lido; na atualização e no
 * cancelamento, o enviado). `http` é o status da última resposta (null sem resposta). `creditoRestante` vem dos cabeçalhos
 * de crédito (null sem eles). `erro` é o texto fixo de `TEXTOS_DE_ERRO_BEDS24`.
 */
export type RespostaGravacaoReserva = {
  resposta: RespostaBeds24;
  beds24Id: string | null;
  http: number | null;
  erro: string;
  creditoRestante: number | null;
  observado?: ObservadoNaGravacao;
};

/**
 * Contrato de escrita de RESERVAS (M8.3c), separado de `EscritorBeds24`: o escritor do calendário nunca tem estes métodos.
 * Só sai do ambiente com a escrita de reservas pronta (`clienteDeReservasDoAmbiente`). `gravarReservas` nunca lança: todo
 * desfecho (rede, tempo, HTTP, formato) volta classificado. `prepararToken` obtém ou renova o token ANTES de o trabalhador
 * gravar `enviado_em` (desenho 3.6): a falha dele é falha antes do POST.
 */
export interface EscritorReservasBeds24 {
  prepararToken(): Promise<void>;
  gravarReservas(item: ItemGravacaoReserva): Promise<RespostaGravacaoReserva>;
}

export class ErroBeds24 extends Error {
  constructor(
    motivo: string,
    readonly tipo: "configuracao" | "rede" | "tempo" | "http" | "formato",
    /** O status HTTP, quando a falha é uma resposta (por exemplo, a renovação do token recusada); sem ele, não houve resposta. */
    readonly status?: number,
  ) {
    super(motivo);
    this.name = "ErroBeds24";
  }
}

