import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { cnpjValido, cortarTexto, cpfValido, LIMITE_DO_TEXTO, limparEndereco, limparEvento, limparRastro, limparTexto, limparValor, luhnValido } from "./limpeza";

/**
 * M0.9: a limpeza dos avisos de erro antes de saírem para o Sentry. Todos os dados abaixo são fictícios (o CPF, o CNPJ e
 * os cartões são números de teste com os dígitos verificadores certos).
 */
const PESSOAIS = {
  email: "maria.silva@exemplo.com",
  cpf: "529.982.247-25",
  cpfSolto: "52998224725",
  cnpj: "11.222.333/0001-81",
  cnpjSolto: "11222333000181",
  cnpjAlfanumerico: "12.ABC.345/01DE-35",
  celular: "(21) 99876-5432",
  celularInternacional: "+55 21 99876-5432",
  celularSolto: "21998765432",
  fixo: "21 2345-6789",
  cartao: "4111 1111 1111 1111",
  cartaoSolto: "5031433215406351",
  uuid: "123e4567-e89b-42d3-a456-426614174000",
  cotacao: "COT-ABCD2345",
  convite: "q3Zk1x9VbN0pLr7tYw2eHf5uJc8aMs4dGi6oPk1QwEr",
};

describe("textos (M0.9): cada tipo de dado pessoal vira um marcador", () => {
  it.each([
    [`Falha ao enviar para ${PESSOAIS.email}.`, "Falha ao enviar para [e-mail]."],
    [`CPF ${PESSOAIS.cpf} recusado`, "CPF [CPF] recusado"],
    [`documento ${PESSOAIS.cpfSolto}`, "documento [CPF]"],
    [`CNPJ ${PESSOAIS.cnpj}`, "CNPJ [CNPJ]"],
    [`CNPJ ${PESSOAIS.cnpjSolto}`, "CNPJ [CNPJ]"],
    [`CNPJ novo ${PESSOAIS.cnpjAlfanumerico}`, "CNPJ novo [CNPJ]"],
    [`WhatsApp ${PESSOAIS.celular}`, "WhatsApp [telefone]"],
    [`WhatsApp ${PESSOAIS.celularInternacional}`, "WhatsApp [telefone]"],
    [`WhatsApp ${PESSOAIS.celularSolto}`, "WhatsApp [telefone]"],
    [`WhatsApp +55${PESSOAIS.celularSolto}`, "WhatsApp [telefone]"],
    [`fixo ${PESSOAIS.fixo}`, "fixo [telefone]"],
    ["sem DDD 99876-5432", "sem DDD [telefone]"],
    [`cartão ${PESSOAIS.cartao}`, "cartão [cartão]"],
    ["cartão 4111-1111-1111-1111", "cartão [cartão]"],
    [`cartão ${PESSOAIS.cartaoSolto}`, "cartão [cartão]"],
    [`chave Pix ${PESSOAIS.uuid}`, "chave Pix [id]"],
    [`Cotação ${PESSOAIS.cotacao} não encontrada`, "Cotação [código] não encontrada"],
    ["limite de tentativas para 203.0.113.7", "limite de tentativas para [IP]"],
    ["limite de tentativas para 2001:db8:85a3::8a2e:370:7334", "limite de tentativas para [IP]"],
    ["limite de tentativas para 2001:0db8:85a3:0000:0000:8a2e:0370:7334.", "limite de tentativas para [IP]."],
    // Telefones de fora do Brasil, com o código do país.
    ["hóspede de Portugal +351 912 345 678", "hóspede de Portugal [telefone]"],
    ["ligar +1 415 555 2671 amanhã", "ligar [telefone] amanhã"],
    ["WhatsApp +14155552671", "WhatsApp [telefone]"],
    ["fixo +44 (20) 7946 0958", "fixo [telefone]"],
    ["celular +33 6 12 34 56 78.", "celular [telefone]."],
  ])("%s", (entrada, saida) => {
    expect(limparTexto(entrada)).toBe(saida);
  });

  it("segredos: Bearer, Basic, chave=valor, JWT, tokens do sistema e chaves do Mercado Pago", () => {
    expect(limparTexto("Authorization: Bearer abc123DEF456ghi789")).toBe("Authorization: Bearer [segredo]");
    expect(limparTexto("Basic dXNlcjpwYXNzd29yZA==")).toBe("Basic [segredo]");
    expect(limparTexto("GET https://api.exemplo.com/v1?access_token=abc123secret&x=1")).toBe("GET https://api.exemplo.com/v1");
    expect(limparTexto("falhou com access_token=abc123secret no corpo")).toBe("falhou com access_token=[segredo] no corpo");
    expect(limparTexto('{"client_secret": "s3gr3d0-muito-longo"}')).toBe('{"client_secret": "[segredo]"}');
    expect(limparTexto("senha: hunter2!")).toBe("senha: [segredo]");
    expect(limparTexto("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJh inválido")).toBe("token [segredo] inválido");
    expect(limparTexto("chave APP_USR-1234567890123456-101612-0123456789abcdef0123456789abcdef-123456789 recusada")).toBe("chave [segredo] recusada");
    expect(limparTexto("chave TEST-1234567890123456-101612-0123456789abcdef recusada")).toBe("chave [segredo] recusada");
    // Palavras comuns depois de Bearer/Basic e "Password must…" não são segredo.
    expect(limparTexto("Basic authentication required")).toBe("Basic authentication required");
    expect(limparTexto("Password must have 8 characters")).toBe("Password must have 8 characters");
  });

  it("credenciais dentro de endereços (banco, DSN de outro serviço) saem", () => {
    expect(limparTexto("connect ECONNREFUSED postgresql://usuario:senha123@banco.exemplo.com/scl")).toBe("connect ECONNREFUSED postgresql://[credenciais]@banco.exemplo.com/scl");
    expect(limparTexto("dsn https://chavepublica@o0.ingest.exemplo.io/1")).toBe("dsn https://[credenciais]@o0.ingest.exemplo.io/1");
  });

  it("a senha do endereço sai inteira mesmo com parêntese, aspas ou @ no meio", () => {
    expect(limparTexto("postgresql://usuario:hunter2)abc@banco.exemplo.com/scl")).toBe("postgresql://[credenciais]@banco.exemplo.com/scl");
    expect(limparTexto("postgresql://usuario:hunter2'abc@banco.exemplo.com/scl")).toBe("postgresql://[credenciais]@banco.exemplo.com/scl");
    expect(limparTexto('postgresql://usuario:abc"def@banco.exemplo.com/scl')).toBe("postgresql://[credenciais]@banco.exemplo.com/scl");
    expect(limparTexto("erro (postgresql://usuario:p@ss(1@banco.exemplo.com/scl)")).toBe("erro (postgresql://[credenciais]@banco.exemplo.com/scl)");
    // A "@" depois do caminho, da consulta ou de um espaço não é credencial.
    expect(limparTexto("https://exemplo.com/a@b")).not.toContain("[credenciais]");
    expect(limparTexto("https://exemplo.com?x=1 fulano@exemplo.com")).toBe("https://exemplo.com [e-mail]");
  });

  it("os valores de uma consulta ao banco nunca saem (Drizzle e o detalhe do Postgres)", () => {
    const drizzle = `Failed query: insert into "cotacoes" ("nome", "email", "telefone") values ($1, $2, $3)\nparams: Maria Silva,${PESSOAIS.email},${PESSOAIS.celularSolto}`;
    expect(limparTexto(drizzle)).toBe('Failed query: insert into "cotacoes" ("nome", "email", "telefone") values ($1, $2, $3)\nparams: [omitidos]');
    expect(limparTexto("Key (email)=(Maria Silva <maria@exemplo.com>) already exists.")).toBe("Key (email)=([valor]) already exists.");
  });

  it("o valor que o Postgres repete num erro de conversão sai (a causa do erro do Drizzle; revisão do Codex no M0.9)", () => {
    const nome = "Maria Fictícia Teste";
    const casos: [string, string][] = [
      [`invalid input syntax for type uuid: "${nome}"`, 'invalid input syntax for type uuid: "[valor]"'],
      [`invalid input syntax for type date: "${nome}"`, 'invalid input syntax for type date: "[valor]"'],
      [`invalid input syntax for type timestamp with time zone: "${nome}"`, 'invalid input syntax for type timestamp with time zone: "[valor]"'],
      [`invalid input value for enum situacao_reserva: "${nome}"`, 'invalid input value for enum situacao_reserva: "[valor]"'],
      [`malformed array literal: "${nome}"`, 'malformed array literal: "[valor]"'],
      [`date/time field value out of range: "${nome}"`, 'date/time field value out of range: "[valor]"'],
      // O valor pode ter aspas e quebra de linha: daí até o fim sai.
      [`invalid input syntax for type integer: "${nome} "da Silva"\nSouza"`, 'invalid input syntax for type integer: "[valor]"'],
      [`value "${nome}" is out of range for type integer`, 'value "[valor]" is out of range for type integer'],
      [`time zone "${nome}" not recognized`, 'time zone "[valor]" not recognized'],
    ];
    for (const [antes, depois] of casos) {
      expect(limparTexto(antes), antes).toBe(depois);
      expect(limparTexto(depois), depois).toBe(depois);
    }
    // As outras mensagens do Postgres, com nomes de tabela, coluna e regra (do código, não da pessoa), ficam.
    for (const tecnica of ['duplicate key value violates unique constraint "usuarios_email_key"', 'null value in column "nome" of relation "proprietarios" violates not-null constraint', "value too long for type character varying(20)"]) {
      expect(limparTexto(tecnica)).toBe(tecnica);
    }
  });

  it("o código do Pix copia e cola sai inteiro", () => {
    const pix = "00020101021226850014br.gov.bcb.pix2563qr.exemplo.com/pix/v2/cobv/abc5204000053039865802BR5913SUA CASA TESTE6014RIO DE JANEIRO62070503***6304A1B2";
    expect(limparTexto(`copia e cola: ${pix}`)).toBe("copia e cola: [código Pix]");
  });

  it("números técnicos ficam: ids de pagamento, centavos, datas, hashes e linhas da pilha", () => {
    for (const t of [
      "pagamento 12345678900 recusado",
      "valor 1500000 centavos",
      "2026-10-16T12:00:00.000Z",
      "às 04:15:51, versão 16.3.6",
      "hash a1234567890b",
      // 10 ou 11 dígitos só viram telefone com DDD válido (sem 0) e o começo de um número de telefone.
      "pedido 1034567890",
      "at verCotacao (/var/task/.next/server/chunks/ssr/src_site_cotacoes_ts.js:12:345)",
      "TypeError: Cannot read properties of undefined (reading 'valor')",
      // Um sinal de mais com poucos dígitos não é telefone (fuso, versão, conta).
      "UTC+03:00",
      "versão +2.0.1",
      "total +1500",
    ]) {
      expect(limparTexto(t), t).toBe(t);
    }
  });

  it("limpar duas vezes dá o mesmo resultado", () => {
    const texto = `${PESSOAIS.email} ${PESSOAIS.cpf} /reservar/${PESSOAIS.cotacao}?a=1 Bearer abc123DEF456ghi789 access_token=x1 Key (a)=(b) ${PESSOAIS.uuid}`;
    const uma = limparTexto(texto);
    expect(limparTexto(uma)).toBe(uma);
  });

  it("dígitos verificadores", () => {
    expect(cpfValido(PESSOAIS.cpf)).toBe(true);
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("12345678900")).toBe(false);
    expect(cnpjValido(PESSOAIS.cnpj)).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(luhnValido("4111111111111111")).toBe(true);
    expect(luhnValido("4111111111111112")).toBe(false);
  });
});

describe("textos longos (M0.9): cortados antes da limpeza, que nunca trava", () => {
  const rapido = (texto: string) => {
    const inicio = performance.now();
    const limpo = limparTexto(texto);
    return { limpo, ms: performance.now() - inicio };
  };

  it("100 mil letras sem espaço, só dígitos ou o começo de um Pix repetido terminam rápido (antes, 14 s para 80 mil letras)", () => {
    for (const texto of ["a".repeat(100_000), "1".repeat(100_000), "000201".repeat(17_000), "a ".repeat(50_000), "b".repeat(LIMITE_DO_TEXTO), "7".repeat(LIMITE_DO_TEXTO)]) {
      const { limpo, ms } = rapido(texto);
      expect(ms, texto.slice(0, 12)).toBeLessThan(100);
      expect(limpo.length).toBeLessThanOrEqual(LIMITE_DO_TEXTO + " [cortado]".length);
    }
    // Sem espaço nenhum, o texto é um pedaço só: sai todo.
    expect(limparTexto("a".repeat(100_000))).toBe("[cortado]");
    // Até o limite, nada é cortado.
    expect(limparTexto("b".repeat(LIMITE_DO_TEXTO))).toBe("b".repeat(LIMITE_DO_TEXTO));
  });

  it("corta num espaço e tira o pedaço final que pode ser o começo de um dado (o resto do dado ficou além do limite)", () => {
    const antes = "x ".repeat((LIMITE_DO_TEXTO - 40) / 2);
    // Um e-mail inteiro antes do corte é limpo; o que fica depois do limite não sai.
    const comEmail = rapido(`${antes}${PESSOAIS.email} ${"y ".repeat(200)}`).limpo;
    expect(comEmail).toContain("[e-mail]");
    expect(comEmail).not.toContain("maria");
    expect(comEmail.endsWith(" [cortado]")).toBe(true);
    // Cartão, telefone, valor de consulta e Pix pela metade, bem no limite: saem do fim.
    for (const meio of ["cartão 4111 1111 1111 1111 1111", "ligar (21) 99876 5432 5432 5432", "Key (email)=(Maria Silva Santos Oliveira", "Pix 00020101021226850014br.gov.bcb.pix2563qr.exemplo.com/pix/v2 5913SUA CASA TESTE"]) {
      const texto = `${"x ".repeat((LIMITE_DO_TEXTO - meio.length + 12) / 2)}${meio} ${"z".repeat(30)}`;
      expect(texto.length, meio).toBeGreaterThan(LIMITE_DO_TEXTO);
      const limpo = cortarTexto(texto);
      expect(limpo, meio).toMatch(/ \[cortado\]$/);
      for (const pedaco of ["4111 1111", "99876", "Maria", "000201", "SUA CASA"]) expect(limpo, `${meio} / ${pedaco}`).not.toContain(pedaco);
    }
    // Um parêntese aberto ou um "000201" longe do fim é só texto: não leva o resto junto.
    const longe = cortarTexto(`aberto ( e 000201 ${"x ".repeat(LIMITE_DO_TEXTO)}`);
    expect(longe.length).toBeGreaterThan(LIMITE_DO_TEXTO - 10);
  });

  it("endereço longo é cortado numa barra, com o último pedaço inteiro", () => {
    const longo = `https://site.exemplo/${"pasta/".repeat(1000)}reservar/${PESSOAIS.cotacao}?email=a%40b.com`;
    const limpo = limparEndereco(longo);
    expect(limpo.startsWith("https://site.exemplo/pasta/")).toBe(true);
    expect(limpo.endsWith("/pasta/[cortado]")).toBe(true);
    expect(limpo.length).toBeLessThanOrEqual(LIMITE_DO_TEXTO + "/[cortado]".length);
    expect(limparEndereco(`https://${"a".repeat(5000)}.exemplo/x`)).toBe("[cortado]");
  });
});

describe("endereços (M0.9): sem consulta, sem fragmento, sem os códigos pessoais", () => {
  it.each([
    [`https://site.exemplo/reservar/${PESSOAIS.cotacao}/pagamento?email=maria%40exemplo.com#topo`, "https://site.exemplo/reservar/[código]/pagamento"],
    [`/reservar/${PESSOAIS.cotacao}`, "/reservar/[código]"],
    [`https://site.exemplo/convite/${PESSOAIS.convite}`, "https://site.exemplo/convite/[convite]"],
    [`/painel/reservas/${PESSOAIS.uuid}`, "/painel/reservas/[id]"],
    ["/hospede/entrar/AbCdEf1234567890GhIjKl", "/hospede/entrar/[token]"],
    ["/api/contatos/maria%40exemplo.com", "/api/contatos/[e-mail]"],
    ["/api/cotacoes/COT-ABCD2345/pix", "/api/cotacoes/[código]/pix"],
    ["/anunciar?etapa=codigo&email=pessoa%40exemplo.com", "/anunciar"],
    ["postgresql://usuario:senha@banco.exemplo.com/scl?sslmode=require", "postgresql://[credenciais]@banco.exemplo.com/scl"],
  ])("%s", (entrada, saida) => {
    expect(limparEndereco(entrada)).toBe(saida);
  });

  it("endereços públicos e caminhos do código ficam como estão", () => {
    for (const e of [
      "https://site.exemplo/imoveis/403",
      "/consulta",
      "/_next/static/chunks/app/reservar/%5Bcodigo%5D/page-0a1b2c3d4e5f6a7b.js",
      "app:///.next/server/app/reservar/[codigo]/page.js",
      "webpack-internal:///(app-pages-browser)/./src/app/reservar/[codigo]/page.tsx",
      "/var/task/app/.next/server/chunks/ssr/[root-of-the-server]__0f1e2d3c._.js",
    ]) {
      expect(limparEndereco(e), e).toBe(e);
    }
  });

  it("dentro de um texto, o endereço é limpo do mesmo jeito", () => {
    expect(limparTexto(`GET /reservar/${PESSOAIS.cotacao}?pix=1 falhou`)).toBe("GET /reservar/[código] falhou");
    expect(limparTexto(`Erro em https://site.exemplo/convite/${PESSOAIS.convite}.`)).toBe("Erro em https://site.exemplo/convite/[convite]");
  });
});

describe("valores (M0.9): campos com nome de dado pessoal saem por inteiro", () => {
  it("objetos e listas, em qualquer nível", () => {
    expect(
      limparValor({ email: "a@b.com", nomeDoHospede: "Maria", contato: { telefone: "x", obs: `ligar ${PESSOAIS.celular}` }, lista: [PESSOAIS.cpf, 3], pixelRatio: 2 }),
    ).toEqual({ email: "[omitido]", nomeDoHospede: "[omitido]", contato: { telefone: "[omitido]", obs: "ligar [telefone]" }, lista: ["[CPF]", 3], pixelRatio: 2 });
  });

  it("nomes em outros campos (hóspede, pagador, titular, first_name…) também saem; os nomes técnicos do Sentry ficam", () => {
    expect(
      limparValor({ hospede: "Maria Silva", hóspedes: "Maria e João", pagador: { first_name: "Maria" }, payer: { last_name: "Silva" }, titular: "Maria", cardholder: "M SILVA", full_name: "Maria Silva" }),
    ).toEqual({ hospede: "[omitido]", hóspedes: "[omitido]", pagador: "[omitido]", payer: "[omitido]", titular: "[omitido]", cardholder: "[omitido]", full_name: "[omitido]" });
    expect(limparValor({ os: { name: "iOS" }, browser: { name: "Safari" }, runtime: { name: "node" } })).toEqual({ os: { name: "iOS" }, browser: { name: "Safari" }, runtime: { name: "node" } });
  });
});

describe("rastros (M0.9)", () => {
  it("console nunca sai; requisição com corpo também não", () => {
    expect(limparRastro({ category: "console", message: `log ${PESSOAIS.email}` })).toBeNull();
    expect(limparRastro({ category: "fetch", type: "http", data: { url: "/api/x", request_body: '{"email":"a@b.com"}' } })).toBeNull();
    expect(limparRastro({ category: "http", type: "http", data: { url: "https://api.exemplo.com", body: "x" } })).toBeNull();
  });

  it("requisição sem corpo: só método, situação e endereço limpo (sem a consulta nem os outros dados)", () => {
    const r: Breadcrumb = {
      category: "fetch",
      type: "http",
      data: { method: "POST", url: `/reservar/${PESSOAIS.cotacao}?email=a%40b.com`, status_code: 500, request_body_size: 120, "http.query": "?email=a%40b.com" },
    };
    expect(limparRastro(r)).toEqual({ category: "fetch", type: "http", data: { method: "POST", url: "/reservar/[código]", status_code: 500 } });
  });

  it("navegação e clique", () => {
    expect(limparRastro({ category: "navigation", data: { from: `/reservar/${PESSOAIS.cotacao}`, to: `/convite/${PESSOAIS.convite}?x=1` } })).toEqual({
      category: "navigation",
      data: { from: "/reservar/[código]", to: "/convite/[convite]" },
    });
    expect(limparRastro({ category: "ui.click", message: 'body > main > button.botao[aria-label="Falar com Maria Silva"]' })).toEqual({
      category: "ui.click",
      message: "body > main > button.botao",
    });
    // Uma descrição longa demais é cortada antes, e o marcador do corte fica.
    expect(limparRastro({ category: "ui.click", message: `${"div > ".repeat(1000)}button[title="Maria Silva"]` })?.message).toMatch(/^div > .* \[cortado\]$/);
  });

  it("requisição feita pelo servidor (o formato do Node): o método fica, na chave das convenções do Sentry", () => {
    const r: Breadcrumb = {
      category: "http",
      type: "http",
      data: { "http.request.method": "POST", url: "https://api.exemplo.com/v1/orders/ORD123", status_code: 502, "url.query": "?access_token=x", "url.fragment": "#a" },
    };
    expect(limparRastro(r)).toEqual({ category: "http", type: "http", data: { "http.request.method": "POST", url: "https://api.exemplo.com/v1/orders/ORD123", status_code: 502 } });
  });

  it("outros rastros: mensagem e dados limpos", () => {
    expect(limparRastro({ category: "sentry.event", message: `Erro com ${PESSOAIS.email}`, data: { email: "x", ok: true } })).toEqual({
      category: "sentry.event",
      message: "Erro com [e-mail]",
      data: { email: "[omitido]", ok: true },
    });
  });
});

describe("aviso de erro inteiro (M0.9)", () => {
  const pilha = {
    frames: [
      { filename: "app:///.next/server/chunks/ssr/src_site_cotacoes_ts.js", function: "verCotacao", lineno: 12, colno: 345, in_app: true },
      { filename: "https://site.exemplo/_next/static/chunks/0a1b2c3d4e5f.js", function: "onClick", lineno: 1, colno: 2048, in_app: true },
    ],
  };

  it("sem nada pessoal, fica igual no que importa: mensagem técnica, tipo, pilha, contextos e rastreio", () => {
    const evento: ErrorEvent = {
      type: undefined,
      event_id: "0123456789abcdef0123456789abcdef",
      level: "error",
      platform: "node",
      environment: "preview",
      release: "abc123",
      transaction: "GET /reservar/[codigo]",
      exception: { values: [{ type: "TypeError", value: "Cannot read properties of undefined (reading 'valor')", stacktrace: pilha, mechanism: { type: "onerror", handled: false } }] },
      contexts: {
        trace: { trace_id: "0123456789abcdef0123456789abcdef", span_id: "0123456789abcdef" },
        os: { name: "Linux", version: "5.10" },
        nextjs: { router_kind: "App Router", router_path: "/reservar/[codigo]", route_type: "render" },
      },
      tags: { runtime: "node" },
      sdk: { name: "sentry.javascript.nextjs", version: "11.8.0", settings: { infer_ip: "never" } },
    };
    expect(limparEvento(evento)).toEqual(evento);
  });

  it("com tudo o que pode ser pessoal: nada sai, e a mensagem técnica e a pilha continuam", () => {
    const evento: ErrorEvent = {
      type: undefined,
      user: { id: "u1", email: PESSOAIS.email, ip_address: "203.0.113.7", username: "maria" },
      request: {
        url: `https://site.exemplo/reservar/${PESSOAIS.cotacao}?email=maria%40exemplo.com`,
        method: "POST",
        headers: { Cookie: "sessao=abc", Authorization: "Bearer abc123DEF456ghi789", "User-Agent": "Mozilla/5.0 (iPhone)", Referer: `https://site.exemplo/convite/${PESSOAIS.convite}` },
        cookies: { sessao: "abc" },
        data: { nome: "Maria Silva", email: PESSOAIS.email },
        query_string: "email=maria%40exemplo.com",
        env: { REMOTE_ADDR: "203.0.113.7" },
      },
      message: `Falha para ${PESSOAIS.email}`,
      logentry: { message: "Falha para %s", params: [PESSOAIS.email] },
      exception: {
        values: [
          {
            type: "Error",
            value: `Pix recusado para ${PESSOAIS.cpf} (${PESSOAIS.celular}), chave ${PESSOAIS.uuid}, de 198.51.100.23`,
            stacktrace: { frames: [{ ...pilha.frames[0], vars: { email: PESSOAIS.email }, context_line: `  const contato = "${PESSOAIS.email}";` }] },
            mechanism: { type: "generic", handled: true, data: { url: `/reservar/${PESSOAIS.cotacao}` } },
          },
        ],
      },
      extra: { email: PESSOAIS.email, detalhe: `cartão ${PESSOAIS.cartao}` },
      tags: { digest: "123456", pagina: `/convite/${PESSOAIS.convite}` },
      contexts: {
        trace: { trace_id: "0123456789abcdef0123456789abcdef", span_id: "0123456789abcdef" },
        nextjs: { request_path: `/reservar/${PESSOAIS.cotacao}?email=maria%40exemplo.com`, router_path: "/reservar/[codigo]" },
      },
      breadcrumbs: [
        { category: "console", message: PESSOAIS.email },
        { category: "fetch", type: "http", data: { method: "GET", url: `/api/x?cpf=${PESSOAIS.cpfSolto}`, status_code: 200 } },
        { category: "navigation", data: { from: "/", to: `/reservar/${PESSOAIS.cotacao}` } },
      ],
    };
    const limpo = limparEvento(evento);
    expect(limpo.user).toBeUndefined();
    expect(limpo.request).toEqual({ url: "https://site.exemplo/reservar/[código]", method: "POST", headers: { "User-Agent": "Mozilla/5.0 (iPhone)" } });
    expect(limpo.message).toBe("Falha para [e-mail]");
    expect(limpo.logentry).toEqual({ message: "Falha para %s", params: ["[e-mail]"] });
    const erro = limpo.exception!.values![0];
    expect(erro.type).toBe("Error");
    expect(erro.value).toBe("Pix recusado para [CPF] ([telefone]), chave [id], de [IP]");
    expect(erro.stacktrace!.frames![0]).toEqual({ ...pilha.frames[0], context_line: '  const contato = "[e-mail]";' });
    expect(erro.mechanism).toEqual({ type: "generic", handled: true, data: { url: "/reservar/[código]" } });
    expect(limpo.extra).toEqual({ email: "[omitido]", detalhe: "cartão [cartão]" });
    expect(limpo.tags).toEqual({ digest: "123456", pagina: "/convite/[convite]" });
    expect(limpo.contexts).toEqual({
      trace: { trace_id: "0123456789abcdef0123456789abcdef", span_id: "0123456789abcdef" },
      nextjs: { request_path: "/reservar/[código]", router_path: "/reservar/[codigo]" },
    });
    expect(limpo.breadcrumbs).toEqual([
      { category: "fetch", type: "http", data: { method: "GET", url: "/api/x", status_code: 200 } },
      { category: "navigation", data: { from: "/", to: "/reservar/[código]" } },
    ]);
    const tudo = JSON.stringify(limpo);
    for (const valor of [...Object.values(PESSOAIS), "maria", "Maria Silva", "203.0.113.7", "198.51.100.23", "sessao=abc", "abc123DEF456ghi789", "maria%40exemplo.com"]) {
      expect(tudo, valor).not.toContain(valor);
    }
    // O evento original não é alterado.
    expect(evento.user?.email).toBe(PESSOAIS.email);
  });
});

describe("partes do aviso com regra própria (M0.9)", () => {
  it("objeto lançado no lugar de um erro: o Sentry o põe inteiro em extra.__serialized__, que sai sem o conteúdo", () => {
    const evento = {
      type: undefined,
      exception: { values: [{ type: "Error", value: "Object captured as exception with keys: hospede, pagador, tel" }] },
      extra: { __serialized__: { hospede: "Maria Silva", tel: "+351 912 345 678", pagador: { first_name: "Maria" } }, outro: "ok" },
    } as ErrorEvent;
    const limpo = limparEvento(evento);
    expect(limpo.extra).toEqual({ __serialized__: "[omitido]", outro: "ok" });
    expect(limpo.exception!.values![0].value).toBe("Object captured as exception with keys: hospede, pagador, tel");
    const tudo = JSON.stringify(limpo);
    for (const valor of ["Maria", "+351 912 345 678", "912 345 678"]) expect(tudo, valor).not.toContain(valor);
  });

  it("o código do erro do Next (digest) fica como está; um telefone em outra tag continua virando marcador", () => {
    for (const digest of ["2353485737", "3141592653@E394", "3353831296", "4294967295", "123"]) {
      expect(limparEvento({ type: undefined, tags: { digest } } as ErrorEvent).tags, digest).toEqual({ digest });
    }
    expect(limparEvento({ type: undefined, tags: { digest: "2353485737", contato: "21 2345-6789", outra: "2353485737" } } as ErrorEvent).tags).toEqual({
      digest: "2353485737",
      contato: "[telefone]",
      outra: "[telefone]",
    });
    // Sem a forma de um digest do Next (11 dígitos, texto), passa pela limpeza como qualquer tag.
    expect(limparEvento({ type: undefined, tags: { digest: "21998765432" } } as ErrorEvent).tags).toEqual({ digest: "[telefone]" });
    expect(limparEvento({ type: undefined, tags: { digest: `para ${PESSOAIS.email}` } } as ErrorEvent).tags).toEqual({ digest: "para [e-mail]" });
  });
});
