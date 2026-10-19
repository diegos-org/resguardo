import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { aplicarMigracoesPendentes, type Migracao } from "./migracoes";

let db: PGlite;
const executar = (sql: string, params?: unknown[]) => db.query(sql, params);
const registradas = async () => (await db.query<{ hash: string; created_at: string }>('select hash, created_at from "drizzle"."__drizzle_migrations" order by id')).rows;
const tabelas = async () => (await db.query<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.t);
const migracao = (sql: string, folderMillis: number): Migracao => ({ sql: [sql], folderMillis, hash: createHash("sha256").update(sql).digest("hex") });

beforeEach(async () => {
  db = new PGlite();
  // A partida do banco fica na preparação (prazo maior), não no corpo do teste: com a máquina ocupada, ela passa de 5 s.
  await db.waitReady;
});
afterEach(() => db.close());

describe("aplicação das migrações por hash (build da Vercel)", () => {
  it("aplica o que não está registrado, na ordem do journal, e registra como o Drizzle; rodar de novo não faz nada", async () => {
    const a = migracao("create table a (id int)", 100);
    const b = migracao("create table b (id int)", 200);
    expect(await aplicarMigracoesPendentes(executar, [a, b])).toBe(2);
    expect(await tabelas()).toEqual(["a", "b"]);
    expect((await registradas()).map((r) => [r.hash, Number(r.created_at)])).toEqual([[a.hash, 100], [b.hash, 200]]);
    expect(await aplicarMigracoesPendentes(executar, [a, b])).toBe(0);
  });

  it("banco de preview compartilhado: migração de outro branch já registrada com data maior não faz pular a que veio depois com data menor", async () => {
    const a = migracao("create table a (id int)", 100);
    // A de outro branch, aplicada antes, ficou registrada com data 300.
    const outra = migracao("create table outra (id int)", 300);
    await aplicarMigracoesPendentes(executar, [a, outra]);
    // O journal deste branch traz b (200) e c (250): o migrador do Drizzle pularia as duas (200 e 250 < 300); por hash, rodam.
    const b = migracao("create table b (id int)", 200);
    const c = migracao("alter table b add column nome text", 250);
    expect(await aplicarMigracoesPendentes(executar, [a, b, c, outra])).toBe(2);
    expect(await tabelas()).toEqual(["a", "b", "outra"]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from information_schema.columns where table_name = 'b'")).rows[0].n).toBe(2);
    expect((await registradas()).map((r) => Number(r.created_at))).toEqual([100, 300, 200, 250]);
  });

  it("migração que falha é desfeita inteira e não fica registrada; as anteriores ficam", async () => {
    const a = migracao("create table a (id int)", 100);
    const ruim: Migracao = { sql: ["create table b (id int)", "create table a (id int)"], folderMillis: 200, hash: "ruim" };
    await expect(aplicarMigracoesPendentes(executar, [a, ruim])).rejects.toThrow();
    expect(await tabelas()).toEqual(["a"]);
    expect((await registradas()).map((r) => r.hash)).toEqual([a.hash]);
  });

  it("as migrações reais do projeto aplicam do zero, e a 0053 (M12.4) é idempotente sobre um banco que já tem os objetos dela", async () => {
    const todas = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
    expect(await aplicarMigracoesPendentes(executar, todas)).toBe(todas.length);
    expect(await tabelas()).toEqual(expect.arrayContaining(["beds24_envio_imoveis", "repasse_itens", "arquivos"]));
    // Como no banco de preview: os objetos existem, mas a 0053 não está registrada (as antigas do branch é que criaram).
    // A 0053 é a 54ª da pasta (0000 a 0053); as migrações seguintes são normais, não precisam ser idempotentes.
    const m0053 = todas[53];
    expect(m0053.sql.join("\n")).toContain("beds24_envio_imoveis");
    await db.query('delete from "drizzle"."__drizzle_migrations" where hash = $1', [m0053.hash]);
    expect(await aplicarMigracoesPendentes(executar, todas)).toBe(1);
    expect((await registradas()).some((r) => r.hash === m0053.hash)).toBe(true);
  }, 120_000);

  it("a 0067 (M8.2c, cancelamento) aplica do zero e é idempotente: rodar as instruções dela de novo não muda nada", async () => {
    const todas = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
    expect(await aplicarMigracoesPendentes(executar, todas)).toBe(todas.length);
    const m0067 = todas[67];
    expect(m0067.sql.join("\n")).toContain('"cancelamentos_reserva"');
    const colunas = async () =>
      (
        await db.query<{ c: string }>(
          "select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public' and table_name in ('cancelamentos_reserva', 'devolucoes_pagamento', 'pagamentos', 'reservas') order by 1",
        )
      ).rows.map((r) => r.c);
    const restricoes = async () => (await db.query<{ n: string }>("select conname as n from pg_constraint where conname like 'cancelamentos_reserva%' or conname like 'devolucoes_pagamento%' order by 1")).rows.map((r) => r.n);
    const antes = { colunas: await colunas(), restricoes: await restricoes(), tabelas: await tabelas() };
    expect(antes.colunas).toEqual(expect.arrayContaining(["reservas.valor_retido", "pagamentos.devolvido_lido", "pagamentos.devolucao_em_andamento_lida", "pagamentos.devolvido_visto_em", "devolucoes_pagamento.origem", "devolucoes_pagamento.parada_nota"]));
    expect(antes.restricoes).toEqual(expect.arrayContaining(["cancelamentos_reserva_hospede_avisado_devolucao_por_fk", "devolucoes_pagamento_cancelamento_id_fk"]));
    // Nenhum nome passa dos 63 caracteres do Postgres (cortado, o "se não existe" da migração não o acharia).
    expect(antes.restricoes.every((n) => n.length <= 63)).toBe(true);
    // As instruções de novo, uma a uma, sobre o banco que já tem tudo (como no banco compartilhado das prévias).
    for (const instrucao of m0067.sql) await db.exec(instrucao);
    expect({ colunas: await colunas(), restricoes: await restricoes(), tabelas: await tabelas() }).toEqual(antes);
    expect((await db.query<{ v: string }>("select unnest(enum_range(null::tipo_lancamento))::text as v")).rows.map((r) => r.v)).toContain("devolucao");
    // E sem o registro dela: a migração inteira entra de novo sem erro.
    await db.query('delete from "drizzle"."__drizzle_migrations" where hash = $1', [m0067.hash]);
    expect(await aplicarMigracoesPendentes(executar, todas)).toBe(1);
  }, 120_000);

  it("a 0068 (M8.2d, alteração) aplica sobre dados do M8.2c, copia avisos e caixa para a devolução e é idempotente", async () => {
    const todas = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
    const m0068 = todas[68];
    expect(m0068.sql.join("\n")).toContain('"alteracoes_reserva"');
    // Até a 0067, com uma devolução por pagamento (o índice antigo), como num banco do M8.2c.
    expect(await aplicarMigracoesPendentes(executar, todas.slice(0, 68))).toBe(68);
    const um = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
    const { id: org } = (await um<{ id: string }>("insert into organizacoes (nome) values ('Org') returning id"))!;
    const { id: im } = (await um<{ id: string }>("insert into imoveis (organizacao_id, codigo, nome) values ($1, '101', 'Apto') returning id", [org]))!;
    const reserva = async (codigo: string) => (await um<{ id: string }>("insert into reservas (organizacao_id, imovel_id, codigo, origem, checkin, checkout) values ($1, $2, $3, 'direta', '2026-11-10', '2026-11-14') returning id", [org, im, codigo]))!.id;
    const cotacao = async (codigo: string, r: string) =>
      (await um<{ id: string }>(
        "insert into cotacoes (organizacao_id, imovel_id, codigo, checkin, checkout, noites, hospedes, diarias, limpeza, hospede_extra, valor_cheio, total, situacao, reserva_id) values ($1, $2, $3, '2026-11-10', '2026-11-14', 4, 2, 100000, 10000, 0, 110000, 110000, 'disponivel', $4) returning id",
        [org, im, codigo, r],
      ))!.id;
    const pagamento = async (cot: string, r: string, ref: string, avisos: string[]) =>
      (await um<{ id: string }>(
        "insert into pagamentos (organizacao_id, cotacao_id, reserva_id, imovel_id, ambiente, forma, referencia, chave_idempotencia, valor, situacao, desfecho, avisos) values ($1, $2, $3, $4, 'teste', 'pix', $5, $5, 110000, 'aprovado', 'reserva', $6::jsonb) returning id",
        [org, cot, r, im, ref, JSON.stringify(avisos)],
      ))!.id;
    // A: devolução de cancelamento com o caixa acertado e avisos de devolução (e um que não é de devolução) no pagamento.
    const ra = await reserva("SCL-A");
    const pa = await pagamento(await cotacao("COT-A", ra), ra, "scl-a", ["devolucao_a_menor", "taxa_perdida_desconhecida", "contestado"]);
    const { id: ca } = (await um<{ id: string }>("insert into cancelamentos_reserva (organizacao_id, reserva_id, pagamento_id, situacao, pedido_recebido_em, caixa_lancado_em) values ($1, $2, $3, 'cancelada', now(), '2026-10-05T12:00:00Z') returning id", [org, ra, pa]))!;
    const { id: da } = (await um<{ id: string }>("insert into devolucoes_pagamento (organizacao_id, pagamento_id, motivo, valor, situacao, origem, cancelamento_id) values ($1, $2, 'cancelamento', 110000, 'confirmada', 'cancelamento', $3) returning id", [org, pa, ca]))!;
    // B: devolução sem reserva, sem aviso de devolução no pagamento.
    const rb = await reserva("SCL-B");
    const pb = await pagamento(await cotacao("COT-B", rb), rb, "scl-b", ["contestado"]);
    const { id: db_ } = (await um<{ id: string }>("insert into devolucoes_pagamento (organizacao_id, pagamento_id, motivo, valor) values ($1, $2, 'sem reserva', 110000) returning id", [org, pb]))!;

    // Só até a 0068 (as seguintes têm o próprio teste).
    const ate0068 = todas.slice(0, 69);
    expect(await aplicarMigracoesPendentes(executar, ate0068)).toBe(1);
    const devolucoes = async () => (await db.query<{ id: string; avisos: string[]; caixa: Date | null }>('select id, avisos, caixa_lancado_em as caixa from devolucoes_pagamento order by criado_em, id')).rows;
    const linhas = new Map((await devolucoes()).map((d) => [d.id, d]));
    expect(linhas.get(da)).toMatchObject({ avisos: ["devolucao_a_menor", "taxa_perdida_desconhecida"], caixa: new Date("2026-10-05T12:00:00Z") });
    expect(linhas.get(db_)).toMatchObject({ avisos: [], caixa: null });
    const indices = async () => (await db.query<{ n: string }>("select indexname as n from pg_indexes where tablename in ('devolucoes_pagamento', 'pagamentos', 'alteracoes_reserva') order by 1")).rows.map((r) => r.n);
    expect(await indices()).not.toContain("devolucoes_pagamento_um_por_pagamento");
    expect(await indices()).toEqual(
      expect.arrayContaining([
        "devolucoes_pagamento_sem_reserva", "devolucoes_pagamento_do_cancelamento", "devolucoes_pagamento_da_alteracao", "devolucoes_pagamento_restante", "devolucoes_pagamento_uma_pedida",
        "pagamentos_um_desfecho_alteracao", "pagamentos_alteracao", "alteracoes_reserva_uma_segurada", "alteracoes_reserva_hold",
      ]),
    );
    const colunas = async () =>
      (await db.query<{ c: string }>("select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public' and table_name in ('alteracoes_reserva', 'devolucoes_pagamento', 'pagamentos') order by 1")).rows.map((r) => r.c);
    const restricoes = async () => (await db.query<{ n: string }>("select conname as n from pg_constraint where conname like 'alteracoes_reserva%' or conname like 'devolucoes_pagamento%' or conname like 'pagamentos%' order by 1")).rows.map((r) => r.n);
    const antes = { colunas: await colunas(), restricoes: await restricoes(), indices: await indices(), devolucoes: await devolucoes() };
    expect(antes.colunas).toEqual(expect.arrayContaining(["pagamentos.alteracao_id", "pagamentos.devolvido_fora_reconhecido", "devolucoes_pagamento.avisos", "devolucoes_pagamento.corpo_integral", "alteracoes_reserva.hold_ate"]));
    expect(antes.restricoes).toEqual(expect.arrayContaining(["alteracoes_reserva_avisado_prop_por_fk", "devolucoes_pagamento_origem_devolucao_fk", "pagamentos_alteracao_id_alteracoes_reserva_id_fk"]));
    expect(antes.restricoes.every((n) => n.length <= 63)).toBe(true);
    // Várias devoluções por pagamento, mas uma pedida por vez (o banco é a guarda mais forte).
    await db.query("update devolucoes_pagamento set situacao = 'pedida' where id = $1", [da]);
    await expect(db.query("insert into devolucoes_pagamento (organizacao_id, pagamento_id, motivo, valor, situacao, origem) values ($1, $2, 'outra', 100, 'pedida', 'alteracao')", [org, pa])).rejects.toThrow();
    await db.query("update devolucoes_pagamento set situacao = 'confirmada' where id = $1", [da]);
    // As instruções de novo, uma a uma (banco compartilhado das prévias): nada muda, nem as cópias.
    for (const instrucao of m0068.sql) await db.exec(instrucao);
    expect({ colunas: await colunas(), restricoes: await restricoes(), indices: await indices(), devolucoes: await devolucoes() }).toEqual(antes);
    await db.query('delete from "drizzle"."__drizzle_migrations" where hash = $1', [m0068.hash]);
    expect(await aplicarMigracoesPendentes(executar, ate0068)).toBe(1);
  }, 120_000);

  it("a 0069 (M8.2e, contestação) aplica sobre dados do M8.2d, guarda as regras de unicidade da disputa e é idempotente", async () => {
    const todas = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
    const m0069 = todas[69];
    expect(m0069.sql.join("\n")).toContain('"contestacoes_pagamento"');
    // Sem tipo novo no enum de lançamentos (cada arquivo roda numa transação; a origem é texto).
    expect(m0069.sql.join("\n")).not.toContain("ALTER TYPE");
    expect(await aplicarMigracoesPendentes(executar, todas.slice(0, 69))).toBe(69);
    const um = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
    const { id: org } = (await um<{ id: string }>("insert into organizacoes (nome) values ('Org') returning id"))!;
    const { id: im } = (await um<{ id: string }>("insert into imoveis (organizacao_id, codigo, nome) values ($1, '101', 'Apto') returning id", [org]))!;
    const { id: r } = (await um<{ id: string }>("insert into reservas (organizacao_id, imovel_id, codigo, origem, checkin, checkout) values ($1, $2, 'SCL-A', 'direta', '2026-11-10', '2026-11-14') returning id", [org, im]))!;
    const { id: cot } = (await um<{ id: string }>(
      "insert into cotacoes (organizacao_id, imovel_id, codigo, checkin, checkout, noites, hospedes, diarias, limpeza, hospede_extra, valor_cheio, total, situacao, reserva_id) values ($1, $2, 'COT-A', '2026-11-10', '2026-11-14', 4, 2, 100000, 10000, 0, 110000, 110000, 'disponivel', $3) returning id",
      [org, im, r],
    ))!;
    const { id: p } = (await um<{ id: string }>(
      "insert into pagamentos (organizacao_id, cotacao_id, reserva_id, imovel_id, ambiente, forma, referencia, chave_idempotencia, valor, situacao, desfecho) values ($1, $2, $3, $4, 'teste', 'cartao', 'scl-a', 'scl-a', 110000, 'contestado', 'reserva') returning id",
      [org, cot, r, im],
    ))!;
    const { id: dev } = (await um<{ id: string }>("insert into devolucoes_pagamento (organizacao_id, pagamento_id, motivo, valor, situacao, origem) values ($1, $2, 'cancelamento', 110000, 'recusada', 'cancelamento') returning id", [org, p]))!;

    // Só até a 0069 (as seguintes têm o próprio teste).
    const ate0069 = todas.slice(0, 70);
    expect(await aplicarMigracoesPendentes(executar, ate0069)).toBe(1);
    expect(await tabelas()).toEqual(expect.arrayContaining(["contestacoes_pagamento", "eventos_contestacao"]));
    // A linha antiga continua igual: sem busca tardia e sem disputa ligada.
    expect(await um("select contestacoes_buscadas_em as b from pagamentos where id = $1", [p])).toEqual({ b: null });
    expect(await um("select contestacao_id as c from devolucoes_pagamento where id = $1", [dev])).toEqual({ c: null });

    const contestacao = (campos: string, valores: string, params: unknown[]) =>
      db.query<{ id: string }>(
        `insert into contestacoes_pagamento (organizacao_id, pagamento_id, reserva_id, imovel_id, tipo, origem, situacao_pagamento_antes, valor_origem, aberta_em${campos}) values ($1, $2, $3, $4, 'chargeback', 'leitura', 'aprovado', 'leitura', now()${valores}) returning id`,
        [org, p, r, im, ...params],
      );
    // Uma disputa sem identificação não final por pagamento (a segunda é a mesma: o domínio responde "já está no quadro").
    const { rows: [semId] } = await contestacao("", "", []);
    await expect(contestacao("", "", [])).rejects.toThrow();
    expect(await um("select situacao, rodada, valor_em_risco as v, decisao_versao as d, avisos, duplicata_possivel as dup from contestacoes_pagamento where id = $1", [semId.id])).toEqual({ situacao: "aberta", rodada: 1, v: 0, d: 0, avisos: [], dup: false });
    // Encerrada, deixa outra sem identificação nascer.
    await db.query("update contestacoes_pagamento set situacao = 'sem_efeito' where id = $1", [semId.id]);
    await contestacao("", "", []);
    // Um caso (e um CBK) por pagamento e rodada; a reabertura é a rodada seguinte.
    const { rows: [caso] } = await contestacao(", id_caso, id_contestacao", ", $5, $6", ["234000062890459000", "CBK01"]);
    await expect(contestacao(", id_caso", ", $5", ["234000062890459000"])).rejects.toThrow();
    await expect(contestacao(", id_contestacao", ", $5", ["CBK01"])).rejects.toThrow();
    await contestacao(", id_caso, id_contestacao, rodada", ", $5, $6, 2", ["234000062890459000", "CBK01"]);
    // A linha do tempo e a devolução substituída se ligam à disputa.
    await db.query("insert into eventos_contestacao (contestacao_id, fonte, tipo, antes, depois) values ($1, 'order', 'aberta', null, $2::jsonb)", [caso.id, JSON.stringify({ situacao: "aberta" })]);
    // A ordem de gravação vem sozinha (a linha do tempo desempata por ela).
    await db.query("insert into eventos_contestacao (contestacao_id, fonte, tipo) values ($1, 'order', 'estado_lido')", [caso.id]);
    expect((await db.query<{ o: number }>("select ordem as o from eventos_contestacao where contestacao_id = $1 order by ordem", [caso.id])).rows.map((x) => x.o)).toEqual([1, 2]);
    // O fechamento antigo fica sem a divisão (null): ela é refeita pela linha do tempo.
    expect((await db.query<{ c: string }>("select column_name as c from information_schema.columns where table_name = 'repasses' and column_name like 'fora_%' order by 1")).rows.map((x) => x.c)).toEqual(["fora_do_fechamento", "fora_presa_disputa", "fora_segurado_junto"]);
    await db.query("update devolucoes_pagamento set contestacao_id = $1 where id = $2", [caso.id, dev]);
    await expect(db.query("update devolucoes_pagamento set contestacao_id = gen_random_uuid() where id = $1", [dev])).rejects.toThrow();

    const colunas = async () =>
      (await db.query<{ c: string }>("select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public' and table_name in ('contestacoes_pagamento', 'eventos_contestacao', 'devolucoes_pagamento', 'pagamentos') order by 1")).rows.map((x) => x.c);
    const restricoes = async () =>
      (await db.query<{ n: string }>("select conname as n from pg_constraint where conname like 'contestacoes_pagamento%' or conname like 'eventos_contestacao%' or conname like 'devolucoes_pagamento%' order by 1")).rows.map((x) => x.n);
    const indices = async () => (await db.query<{ n: string }>("select indexname as n from pg_indexes where tablename in ('contestacoes_pagamento', 'eventos_contestacao', 'devolucoes_pagamento') order by 1")).rows.map((x) => x.n);
    const linhas = async () => (await db.query("select id, situacao, id_caso, rodada from contestacoes_pagamento order by criado_em, id")).rows;
    const antes = { colunas: await colunas(), restricoes: await restricoes(), indices: await indices(), linhas: await linhas(), tabelas: await tabelas() };
    expect(antes.colunas).toEqual(
      expect.arrayContaining([
        "pagamentos.contestacoes_buscadas_em",
        "devolucoes_pagamento.contestacao_id",
        "contestacoes_pagamento.valor_em_risco",
        "contestacoes_pagamento.caixa_final_lancamento_id",
        "contestacoes_pagamento.debito_nota",
        "contestacoes_pagamento.decisao_mudanca_nota",
        "eventos_contestacao.depois",
        "eventos_contestacao.ordem",
      ]),
    );
    expect(antes.restricoes).toEqual(expect.arrayContaining(["devolucoes_pagamento_contestacao_id_fk", "contestacoes_pagamento_caixa_final_fk", "eventos_contestacao_contestacao_id_contestacoes_pagamento_id_fk"]));
    // Nenhum nome passa dos 63 caracteres do Postgres (cortado, o "se não existe" da migração não o acharia).
    expect(antes.restricoes.every((n) => n.length <= 63)).toBe(true);
    expect(antes.indices).toEqual(
      expect.arrayContaining([
        "contestacoes_pagamento_caso", "contestacoes_pagamento_cbk", "contestacoes_pagamento_sem_id", "contestacoes_pagamento_situacao", "contestacoes_pagamento_leitura",
        "contestacoes_pagamento_reserva", "eventos_contestacao_contestacao", "devolucoes_pagamento_contestacao",
      ]),
    );
    // As instruções de novo, uma a uma (banco compartilhado das prévias): nada muda.
    for (const instrucao of m0069.sql) await db.exec(instrucao);
    expect({ colunas: await colunas(), restricoes: await restricoes(), indices: await indices(), linhas: await linhas(), tabelas: await tabelas() }).toEqual(antes);
    await db.query('delete from "drizzle"."__drizzle_migrations" where hash = $1', [m0069.hash]);
    expect(await aplicarMigracoesPendentes(executar, ate0069)).toBe(1);
  }, 120_000);

  it("a 0070 (M7.14, autorização dos proprietários) aplica sobre pedidos e cadastros de antes sem preencher nada, recusa registro pela metade e é idempotente", async () => {
    const todas = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
    const m0070 = todas[70];
    expect(m0070.sql.join("\n")).toContain('"autorizacao_texto"');
    // Só até a 0070 (as seguintes terão o próprio teste): uma migração nova não muda as contas deste.
    const ate0070 = todas.slice(0, 71);
    expect(await aplicarMigracoesPendentes(executar, todas.slice(0, 70))).toBe(70);
    const um = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
    const { id: org } = (await um<{ id: string }>("insert into organizacoes (nome) values ('Org') returning id"))!;
    // Um pedido e um cadastro de antes do registro (dados fictícios).
    const pedido = (extra = "", valores = "", params: unknown[] = []) =>
      db.query<{ id: string }>(`insert into pedidos_contato_proprietario (organizacao_id, nome, email, telefone, bairro, cidade${extra}) values ($1, 'Pessoa Fictícia', 'pessoa@example.com', '(21) 90000-0000', 'Ipanema', 'Rio de Janeiro'${valores}) returning id`, [org, ...params]);
    const cadastro = (extra = "", valores = "", params: unknown[] = []) =>
      db.query<{ id: string }>(
        `insert into cadastros_marketplace (organizacao_id, email, nome, telefone, imovel, anuncio${extra}) values ($1, 'dona@example.com', 'Dona Fictícia', '(21) 90000-0001', '{"nome":"Apto","bairro":"Leblon","cidade":"Rio de Janeiro","endereco":"Rua Fictícia, 1","capacidade":2,"quartos":1,"banheiros":1,"descricao":""}'::jsonb, 'novo'${valores}) returning id`,
        [org, ...params],
      );
    const { rows: [p] } = await pedido();
    const { rows: [c] } = await cadastro();

    expect(await aplicarMigracoesPendentes(executar, ate0070)).toBe(1);
    const sql = "select autorizado_em as em, autorizacao_versao as v, autorizacao_texto as t from %s where id = $1";
    expect(await um(sql.replace("%s", "pedidos_contato_proprietario"), [p.id])).toEqual({ em: null, v: null, t: null });
    expect(await um(sql.replace("%s", "cadastros_marketplace"), [c.id])).toEqual({ em: null, v: null, t: null });
    // Os três juntos ou nenhum, nas duas tabelas (um CHECK que dá null passaria: por isso o "is not null" de cada um).
    const em = new Date("2026-10-15T15:00:00Z");
    for (const novo of [pedido, cadastro]) {
      await expect(novo(", autorizado_em", ", $2", [em])).rejects.toThrow();
      await expect(novo(", autorizado_em, autorizacao_versao", ", $2, 1", [em])).rejects.toThrow();
      await expect(novo(", autorizacao_versao, autorizacao_texto", ", 1, 'Texto fictício.'")).rejects.toThrow();
      await expect(novo(", autorizado_em, autorizacao_versao, autorizacao_texto", ", $2, 0, 'Texto fictício.'", [em])).rejects.toThrow();
      await expect(novo(", autorizado_em, autorizacao_versao, autorizacao_texto", ", $2, 1, ''", [em])).rejects.toThrow();
      await novo(", autorizado_em, autorizacao_versao, autorizacao_texto", ", $2, 1, 'Texto fictício.'", [em]);
    }

    const colunas = async () =>
      (await db.query<{ c: string }>("select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public' and table_name in ('pedidos_contato_proprietario', 'cadastros_marketplace') order by 1")).rows.map((x) => x.c);
    const restricoes = async () => (await db.query<{ n: string }>("select conname as n from pg_constraint where conname like '%_autorizacao' order by 1")).rows.map((x) => x.n);
    const antes = { colunas: await colunas(), restricoes: await restricoes(), tabelas: await tabelas() };
    expect(antes.colunas).toEqual(
      expect.arrayContaining([
        "pedidos_contato_proprietario.autorizado_em", "pedidos_contato_proprietario.autorizacao_versao", "pedidos_contato_proprietario.autorizacao_texto",
        "cadastros_marketplace.autorizado_em", "cadastros_marketplace.autorizacao_versao", "cadastros_marketplace.autorizacao_texto",
      ]),
    );
    expect(antes.restricoes).toEqual(["cadastros_marketplace_autorizacao", "pedidos_contato_proprietario_autorizacao"]);
    // As instruções de novo, uma a uma (banco compartilhado das prévias): nada muda.
    for (const instrucao of m0070.sql) await db.exec(instrucao);
    expect({ colunas: await colunas(), restricoes: await restricoes(), tabelas: await tabelas() }).toEqual(antes);
    await db.query('delete from "drizzle"."__drizzle_migrations" where hash = $1', [m0070.hash]);
    expect(await aplicarMigracoesPendentes(executar, ate0070)).toBe(1);
  }, 120_000);

  it("a 0071 (M7.17, frase de abertura) aplica sobre imóveis de antes com a frase vazia, sem texto preenchido, e é idempotente", async () => {
    const todas = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
    const m0071 = todas[71];
    expect(m0071.sql.join("\n")).toContain('"frase"');
    // Só até a 0071 (as seguintes terão o próprio teste): uma migração nova não muda as contas deste.
    const ate0071 = todas.slice(0, 72);
    expect(await aplicarMigracoesPendentes(executar, todas.slice(0, 71))).toBe(71);
    const { rows: [{ id: org }] } = await db.query<{ id: string }>("insert into organizacoes (nome) values ('Org') returning id");
    // Um imóvel de antes da frase, com descrição (dados fictícios).
    const { rows: [antigo] } = await db.query<{ id: string }>("insert into imoveis (organizacao_id, codigo, nome, descricao) values ($1, '403', 'Studio Fictício', 'Descrição fictícia. Segunda frase.') returning id", [org]);

    expect(await aplicarMigracoesPendentes(executar, ate0071)).toBe(1);
    const frase = async (id: string) => (await db.query<{ frase: string; descricao: string }>("select frase, descricao from imoveis where id = $1", [id])).rows[0];
    // Nada é copiado da descrição: a frase fica vazia até ser escrita no painel.
    expect(await frase(antigo.id)).toEqual({ frase: "", descricao: "Descrição fictícia. Segunda frase." });
    const { rows: [novo] } = await db.query<{ id: string }>("insert into imoveis (organizacao_id, codigo, nome) values ($1, '102', 'Outro Fictício') returning id", [org]);
    expect((await frase(novo.id)).frase).toBe("");
    await expect(db.query("update imoveis set frase = null where id = $1", [novo.id])).rejects.toThrow();

    const coluna = async () =>
      (await db.query<{ tipo: string; nulo: string; padrao: string }>("select data_type as tipo, is_nullable as nulo, column_default as padrao from information_schema.columns where table_name = 'imoveis' and column_name = 'frase'")).rows;
    const antes = { coluna: await coluna(), tabelas: await tabelas() };
    expect(antes.coluna).toEqual([{ tipo: "text", nulo: "NO", padrao: "''::text" }]);
    // A instrução de novo (banco compartilhado das prévias): nada muda, nem a frase já escrita.
    await db.query("update imoveis set frase = 'Frase fictícia.' where id = $1", [antigo.id]);
    for (const instrucao of m0071.sql) await db.exec(instrucao);
    expect({ coluna: await coluna(), tabelas: await tabelas() }).toEqual(antes);
    expect((await frase(antigo.id)).frase).toBe("Frase fictícia.");
    await db.query('delete from "drizzle"."__drizzle_migrations" where hash = $1', [m0071.hash]);
    expect(await aplicarMigracoesPendentes(executar, ate0071)).toBe(1);
    expect((await frase(antigo.id)).frase).toBe("Frase fictícia.");
  }, 120_000);

  it("a 0072 (M8.3a, reservas do site no Beds24) cria as duas tabelas vazias, com os únicos do desenho, nomes até 63 caracteres, e é idempotente", async () => {
    const todas = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
    const m0072 = todas[72];
    expect(m0072.sql.join("\n")).toContain('"beds24_reservas_operacoes"');
    // Só até a 0072 (as seguintes terão o próprio teste).
    const ate0072 = todas.slice(0, 73);
    expect(await aplicarMigracoesPendentes(executar, todas.slice(0, 72))).toBe(72);
    const { rows: [{ id: org }] } = await db.query<{ id: string }>("insert into organizacoes (nome) values ('Org') returning id");
    const { rows: [{ id: im }] } = await db.query<{ id: string }>("insert into imoveis (organizacao_id, codigo, nome) values ($1, '403', 'Studio Fictício') returning id", [org]);
    const { rows: [{ id: reserva }] } = await db.query<{ id: string }>("insert into reservas (organizacao_id, imovel_id, codigo, origem, checkin, checkout, fonte) values ($1, $2, 'SCL-7K2QXM', 'site', '2026-12-20', '2026-12-27', 'site') returning id", [org, im]);

    expect(await aplicarMigracoesPendentes(executar, ate0072)).toBe(1);
    // Nada nasce sozinho: nenhuma reserva de antes ganha acompanhamento ou operação.
    expect((await db.query<{ n: number }>("select (select count(*) from beds24_reservas_site) + (select count(*) from beds24_reservas_operacoes) as n")).rows[0].n).toBe(0);
    const restricoes = async () => (await db.query<{ n: string }>("select conname as n from pg_constraint where conname like 'beds24_reservas_%' order by 1")).rows.map((r) => r.n);
    const indices = async () => (await db.query<{ n: string }>("select indexname as n from pg_indexes where tablename like 'beds24_reservas_%' order by 1")).rows.map((r) => r.n);
    const antes = { restricoes: await restricoes(), indices: await indices(), tabelas: await tabelas() };
    expect(antes.tabelas).toEqual(expect.arrayContaining(["beds24_reservas_site", "beds24_reservas_operacoes"]));
    expect(antes.restricoes).toContain("beds24_reservas_operacoes_acompanhamento_fk");
    expect(antes.restricoes.every((n) => n.length <= 63)).toBe(true);
    expect(antes.indices).toEqual(expect.arrayContaining(["beds24_reservas_site_reserva", "beds24_reservas_operacoes_chave", "beds24_reservas_operacoes_uma_ativa", "beds24_reservas_operacoes_situacao", "beds24_reservas_operacoes_beds24"]));
    // Uma operação ativa por reserva; a chave é única por organização.
    await db.query("insert into beds24_reservas_operacoes (organizacao_id, reserva_id, tipo, chave, modo, situacao) values ($1, $2, 'criar', 'criar:r:1', 'real', 'enviando')", [org, reserva]);
    await expect(db.query("insert into beds24_reservas_operacoes (organizacao_id, reserva_id, tipo, chave, modo, situacao) values ($1, $2, 'cancelar', 'cancelar:r:2', 'real', 'pendente')", [org, reserva])).rejects.toThrow();
    await expect(db.query("insert into beds24_reservas_operacoes (organizacao_id, reserva_id, tipo, chave, modo, situacao) values ($1, $2, 'criar', 'criar:r:1', 'real', 'superada')", [org, reserva])).rejects.toThrow();
    // As instruções de novo (banco compartilhado das prévias): nada muda, nem a linha já gravada.
    for (const instrucao of m0072.sql) await db.exec(instrucao);
    expect({ restricoes: await restricoes(), indices: await indices(), tabelas: await tabelas() }).toEqual(antes);
    expect((await db.query("select 1 from beds24_reservas_operacoes")).rows).toHaveLength(1);
    await db.query('delete from "drizzle"."__drizzle_migrations" where hash = $1', [m0072.hash]);
    expect(await aplicarMigracoesPendentes(executar, ate0072)).toBe(1);
  }, 120_000);

  it("a 0073 (M10.1a, WhatsApp) cria as cinco tabelas vazias, com os únicos e CHECKs do desenho, nomes até 63 caracteres, e é idempotente", async () => {
    const todas = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
    const m0073 = todas[73];
    expect(m0073.sql.join("\n")).toContain('"whatsapp_mensagens"');
    // Só até a 0073 (as seguintes terão o próprio teste).
    const ate0073 = todas.slice(0, 74);
    expect(await aplicarMigracoesPendentes(executar, todas.slice(0, 73))).toBe(73);
    const um = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
    const { id: org } = (await um<{ id: string }>("insert into organizacoes (nome) values ('Org') returning id"))!;
    const { id: outra } = (await um<{ id: string }>("insert into organizacoes (nome) values ('Outra') returning id"))!;
    const { id: im } = (await um<{ id: string }>("insert into imoveis (organizacao_id, codigo, nome) values ($1, '403', 'Studio Fictício') returning id", [org]))!;
    const { id: reserva } = (await um<{ id: string }>("insert into reservas (organizacao_id, imovel_id, codigo, origem, checkin, checkout, fonte) values ($1, $2, 'SCL-7K2QXM', 'site', '2026-12-20', '2026-12-27', 'site') returning id", [org, im]))!;
    const { id: cotacao } = (await um<{ id: string }>(
      "insert into cotacoes (organizacao_id, imovel_id, codigo, checkin, checkout, noites, hospedes, diarias, limpeza, hospede_extra, valor_cheio, total, situacao) values ($1, $2, 'COT-7K3M9QX2', '2026-12-20', '2026-12-27', 7, 2, 100000, 10000, 0, 110000, 110000, 'disponivel') returning id",
      [org, im],
    ))!;

    expect(await aplicarMigracoesPendentes(executar, ate0073)).toBe(1);
    const TABELAS = ["whatsapp_avisos_dia", "whatsapp_conta", "whatsapp_contatos", "whatsapp_eventos", "whatsapp_mensagens"];
    const linhas = async () => (await db.query<{ t: string; n: number }>(TABELAS.map((t) => `select '${t}' as t, count(*)::int as n from ${t}`).join(" union all ") + " order by 1")).rows;
    // Nada nasce sozinho: nenhuma conversa, mensagem, evento, contador ou situação de conta para os dados de antes.
    expect((await linhas()).every((r) => r.n === 0)).toBe(true);
    const restricoes = async () =>
      (await db.query<{ n: string }>("select c.conname as n from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname like 'whatsapp_%' order by 1")).rows.map((r) => r.n);
    const indices = async () => (await db.query<{ n: string }>("select indexname as n from pg_indexes where tablename like 'whatsapp_%' order by 1")).rows.map((r) => r.n);
    const antes = { restricoes: await restricoes(), indices: await indices(), tabelas: await tabelas() };
    expect(antes.tabelas).toEqual(expect.arrayContaining(TABELAS));
    expect(antes.restricoes).toEqual(
      expect.arrayContaining([
        "whatsapp_contatos_pedido_contato_fk", "whatsapp_contatos_cadastro_fk", "whatsapp_mensagens_contato_id_whatsapp_contatos_id_fk",
        "whatsapp_contatos_vinculo_confirmado_por_usuarios_id_fk", "whatsapp_contatos_identidade", "whatsapp_contatos_wa_id_digitos",
        "whatsapp_contatos_um_vinculo", "whatsapp_mensagens_apagada_sem_texto", "whatsapp_mensagens_wamid_tamanho", "whatsapp_conta_progresso",
      ]),
    );
    expect(antes.indices).toEqual(
      expect.arrayContaining([
        "whatsapp_contatos_wa_id", "whatsapp_contatos_bsuid", "whatsapp_contatos_ultima", "whatsapp_contatos_reserva", "whatsapp_contatos_cotacao",
        "whatsapp_mensagens_wamid", "whatsapp_mensagens_contato", "whatsapp_eventos_chave", "whatsapp_eventos_recebido",
      ]),
    );
    // Nenhum nome passa dos 63 caracteres do Postgres. Ele corta o nome comprido (e o `conname = '...'` da migração corta
    // igual), então medir o catálogo não prova nada: mede os nomes escritos na 0073.
    const nomesNaMigracao = [...m0073.sql.join("\n").matchAll(/conname = '([^']+)'|INDEX IF NOT EXISTS "([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    expect(nomesNaMigracao).toHaveLength(26); // 11 chaves estrangeiras, 6 CHECKs, 9 índices
    expect(nomesNaMigracao.every((n) => n.length <= 63)).toBe(true);
    expect([...antes.restricoes, ...antes.indices]).toEqual(expect.arrayContaining(nomesNaMigracao));

    // Os únicos (23505) e os CHECKs (23514) que o banco garante sozinho. Valores fictícios.
    const codigo = async (sql: string, params: unknown[] = []) => {
      try {
        await db.query(sql, params);
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    const contato = (colunas: string, valores: string, params: unknown[]) => codigo(`insert into whatsapp_contatos (organizacao_id, ${colunas}) values ($1, ${valores})`, params);
    expect(await contato("wa_id", "'16505551234'", [org])).toBe("ok");
    expect(await contato("wa_id", "'16505551234'", [org])).toBe("23505");
    expect(await contato("wa_id", "'16505551234'", [outra])).toBe("ok");
    expect(await contato("bsuid", "'BR.Ficticio0000000000000001'", [org])).toBe("ok");
    expect(await contato("bsuid", "'BR.Ficticio0000000000000001'", [org])).toBe("23505");
    expect(await contato("nome_perfil", "'Sem identidade'", [org])).toBe("23514");
    expect(await contato("wa_id", "'5521a99990000'", [org])).toBe("23514");
    expect(await contato("wa_id, reserva_id, cotacao_id, vinculo_confirmado_em", "'5521999990000', $2, $3, now()", [org, reserva, cotacao])).toBe("23514");
    expect(await contato("wa_id, reserva_id", "'5521999990000', $2", [org, reserva])).toBe("23514");
    expect(await contato("wa_id, vinculo_confirmado_em", "'5521999990000', now()", [org])).toBe("23514");
    expect(await contato("wa_id, cotacao_id, vinculo_confirmado_em", "'5521999990000', $2, now()", [org, cotacao])).toBe("ok");
    const { id: conversa } = (await um<{ id: string }>("select id from whatsapp_contatos where organizacao_id = $1 and wa_id = '16505551234'", [org]))!;
    const mensagem = (wamid: string, extra = "", valores = "") =>
      codigo(`insert into whatsapp_mensagens (organizacao_id, contato_id, wamid, direcao, origem, tipo, enviada_em${extra}) values ($1, $2, $3, 'recebida', 'tempo_real', 'texto', now()${valores})`, [org, conversa, wamid]);
    expect(await mensagem("wamid.TESTE.A")).toBe("ok");
    expect(await mensagem("wamid.TESTE.A")).toBe("23505");
    expect(await mensagem("wamid.TESTE.B", ", texto, apagada_em", ", 'ainda com texto', now()")).toBe("23514");
    expect(await mensagem("")).toBe("23514");
    expect(await mensagem("w".repeat(257))).toBe("23514");
    expect(await mensagem("w".repeat(256))).toBe("ok");
    expect(await codigo("insert into whatsapp_conta (organizacao_id, progresso_historico) values ($1, 101)", [org])).toBe("23514");
    expect(await codigo("insert into whatsapp_conta (organizacao_id, progresso_historico) values ($1, 100)", [org])).toBe("ok");
    const evento = (chave: string) => codigo("insert into whatsapp_eventos (organizacao_id, campo, chave, resultado) values ($1, 'account_update', $2, 'gravado')", [org, chave]);
    expect(await evento("")).toBe("ok");
    expect(await evento("")).toBe("ok");
    expect(await evento("account_update:PARTNER_REMOVED:1:-:-")).toBe("ok");
    expect(await evento("account_update:PARTNER_REMOVED:1:-:-")).toBe("23505");
    // A cotação vinculada não some com a cotação: a chave estrangeira recusa (a limpeza de 30 dias não a apaga, site/cotacoes.ts).
    expect(await codigo("delete from cotacoes where id = $1", [cotacao])).toBe("23503");

    // As instruções de novo (banco compartilhado das prévias): nada muda, nem as linhas já gravadas.
    const gravadas = await linhas();
    expect(gravadas.find((r) => r.t === "whatsapp_contatos")?.n).toBe(4);
    for (const instrucao of m0073.sql) await db.exec(instrucao);
    expect({ restricoes: await restricoes(), indices: await indices(), tabelas: await tabelas(), linhas: await linhas() }).toEqual({ ...antes, linhas: gravadas });
    await db.query('delete from "drizzle"."__drizzle_migrations" where hash = $1', [m0073.hash]);
    expect(await aplicarMigracoesPendentes(executar, ate0073)).toBe(1);
    expect(await linhas()).toEqual(gravadas);
  }, 120_000);

  it("a 0074 (M8.3c, escrita das reservas do site no Beds24) aplica sobre operações da 0072 sem mudar nada nelas, cria o estado da rotina vazio e é idempotente", async () => {
    const todas = readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") });
    const m0074 = todas[74];
    expect(m0074.sql.join("\n")).toContain('"beds24_reservas_rotina"');
    // Só até a 0074 (as seguintes terão o próprio teste); a 0073 é a do WhatsApp (M10.1a), com o teste acima.
    const ate0074 = todas.slice(0, 75);
    expect(await aplicarMigracoesPendentes(executar, todas.slice(0, 74))).toBe(74);
    const { rows: [{ id: org }] } = await db.query<{ id: string }>("insert into organizacoes (nome) values ('Org') returning id");
    const { rows: [{ id: im }] } = await db.query<{ id: string }>("insert into imoveis (organizacao_id, codigo, nome) values ($1, '403', 'Studio Fictício') returning id", [org]);
    const { rows: [{ id: reserva }] } = await db.query<{ id: string }>("insert into reservas (organizacao_id, imovel_id, codigo, origem, checkin, checkout, fonte) values ($1, $2, 'SCL-7K2QXM', 'site', '2026-12-20', '2026-12-27', 'site') returning id", [org, im]);
    // Uma operação de antes (da 0072), uma simulação já terminada.
    await db.query("insert into beds24_reservas_operacoes (organizacao_id, reserva_id, tipo, chave, modo, situacao, erro) values ($1, $2, 'criar', 'simulacao:r:criar:abc:primeira', 'simulacao', 'simulada', '')", [org, reserva]);

    expect(await aplicarMigracoesPendentes(executar, ate0074)).toBe(1);
    // A linha de antes ganha a resposta nula e o detalhe vazio; nada nasce na rotina.
    expect((await db.query("select situacao, resposta, detalhe from beds24_reservas_operacoes")).rows).toEqual([{ situacao: "simulada", resposta: null, detalhe: {} }]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from beds24_reservas_rotina")).rows[0].n).toBe(0);
    const colunas = async () =>
      (await db.query<{ c: string }>("select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable as c from information_schema.columns where table_schema = 'public' and (table_name = 'beds24_reservas_rotina' or (table_name = 'beds24_reservas_operacoes' and column_name in ('resposta', 'detalhe'))) order by 1")).rows.map((r) => r.c);
    const restricoes = async () => (await db.query<{ n: string }>("select conname as n from pg_constraint where conname like 'beds24_reservas_%' order by 1")).rows.map((r) => r.n);
    const indices = async () => (await db.query<{ n: string }>("select indexname as n from pg_indexes where tablename like 'beds24_reservas_%' order by 1")).rows.map((r) => r.n);
    const antes = { colunas: await colunas(), restricoes: await restricoes(), indices: await indices(), tabelas: await tabelas() };
    expect(antes.colunas).toEqual(expect.arrayContaining([
      "beds24_reservas_operacoes.resposta:text:YES", "beds24_reservas_operacoes.detalhe:jsonb:NO",
      "beds24_reservas_rotina.organizacao_id:uuid:NO", "beds24_reservas_rotina.escopos:jsonb:YES", "beds24_reservas_rotina.escopos_credencial:text:NO",
      "beds24_reservas_rotina.conferencia_em:timestamp with time zone:YES", "beds24_reservas_rotina.releitura_em:timestamp with time zone:YES",
    ]));
    expect(antes.restricoes).toEqual(expect.arrayContaining(["beds24_reservas_rotina_organizacao_id_organizacoes_id_fk", "beds24_reservas_rotina_pkey"]));
    expect(antes.restricoes.every((n) => n.length <= 63)).toBe(true);
    expect(antes.indices).toEqual(expect.arrayContaining(["beds24_reservas_operacoes_resposta", "beds24_reservas_rotina_pkey"]));
    // Uma linha por organização, presa à organização.
    await db.query("insert into beds24_reservas_rotina (organizacao_id) values ($1)", [org]);
    await expect(db.query("insert into beds24_reservas_rotina (organizacao_id) values ($1)", [org])).rejects.toThrow();
    await expect(db.query("insert into beds24_reservas_rotina (organizacao_id) values (gen_random_uuid())")).rejects.toThrow();
    await db.query("update beds24_reservas_operacoes set resposta = 'tempo', detalhe = '{\"candidato\":\"98765\"}'::jsonb");
    // As instruções de novo (banco compartilhado das prévias): nada muda, nem as linhas já gravadas.
    for (const instrucao of m0074.sql) await db.exec(instrucao);
    expect({ colunas: await colunas(), restricoes: await restricoes(), indices: await indices(), tabelas: await tabelas() }).toEqual(antes);
    expect((await db.query("select resposta, detalhe from beds24_reservas_operacoes")).rows).toEqual([{ resposta: "tempo", detalhe: { candidato: "98765" } }]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from beds24_reservas_rotina")).rows[0].n).toBe(1);
    await db.query('delete from "drizzle"."__drizzle_migrations" where hash = $1', [m0074.hash]);
    expect(await aplicarMigracoesPendentes(executar, ate0074)).toBe(1);
  }, 120_000);
});
