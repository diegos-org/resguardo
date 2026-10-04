import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { descartarRetratosAntigos, lerRetrato, publicarRetrato } from "./testing";

/**
 * Regras do retrato do banco de teste (M0.8) quando duas rodadas do Vitest dividem a mesma pasta:
 * quem gera nunca apaga o retrato vigente, a publicação é atômica e a leitura sobrevive a um sumiço.
 */
describe("retrato do banco de teste", () => {
  const pastas: string[] = [];
  function pastaTemporaria(): string {
    const pasta = mkdtempSync(join(tmpdir(), "scl-retrato-"));
    pastas.push(pasta);
    return pasta;
  }
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
  });

  it("descarta retratos de outras assinaturas, mas nunca o vigente, parciais ou outros arquivos", () => {
    const pasta = pastaTemporaria();
    const vigente = join(pasta, "migrado-bbbb.tar");
    writeFileSync(join(pasta, "migrado-aaaa.tar"), "antigo");
    writeFileSync(vigente, "vigente");
    writeFileSync(join(pasta, "migrado-cccc.tar.123.456.parcial"), "em escrita por outro processo");
    writeFileSync(join(pasta, "outro.txt"), "nao e retrato");

    expect(descartarRetratosAntigos(pasta, vigente)).toEqual(["migrado-aaaa.tar"]);
    expect(readdirSync(pasta).sort()).toEqual(["migrado-bbbb.tar", "migrado-cccc.tar.123.456.parcial", "outro.txt"]);
    expect(readFileSync(vigente, "utf8")).toBe("vigente");
  });

  it("não falha quando não há nada para descartar", () => {
    const pasta = pastaTemporaria();
    expect(descartarRetratosAntigos(pasta, join(pasta, "migrado-bbbb.tar"))).toEqual([]);
  });

  it("publica por renome atômico, sem deixar arquivo parcial", () => {
    const pasta = pastaTemporaria();
    const arquivo = join(pasta, "migrado-dddd.tar");
    publicarRetrato(arquivo, Buffer.from("conteudo"));
    expect(readFileSync(arquivo, "utf8")).toBe("conteudo");
    expect(readdirSync(pasta)).toEqual(["migrado-dddd.tar"]);
  });

  it("publicar por cima de um retrato já publicado substitui o conteúdo inteiro", () => {
    const pasta = pastaTemporaria();
    const arquivo = join(pasta, "migrado-dddd.tar");
    publicarRetrato(arquivo, Buffer.from("primeiro"));
    publicarRetrato(arquivo, Buffer.from("segundo"));
    expect(readFileSync(arquivo, "utf8")).toBe("segundo");
    expect(readdirSync(pasta)).toEqual(["migrado-dddd.tar"]);
  });

  it("se a publicação falhar sem retrato publicado, propaga o erro e não deixa parcial", () => {
    const pasta = pastaTemporaria();
    // Pasta inexistente: a escrita do temporário falha (ENOENT) e não há retrato de ninguém.
    const arquivo = join(pasta, "nao-existe", "migrado-eeee.tar");
    expect(() => publicarRetrato(arquivo, Buffer.from("x"))).toThrow();
    expect(existsSync(arquivo)).toBe(false);
    expect(readdirSync(pasta)).toEqual([]);
  });

  it("lê o retrato existente sem gerar de novo", async () => {
    const pasta = pastaTemporaria();
    const arquivo = join(pasta, "migrado-ffff.tar");
    writeFileSync(arquivo, "pronto");
    let geracoes = 0;
    const lido = await lerRetrato(arquivo, async () => {
      geracoes++;
    });
    expect(lido.toString()).toBe("pronto");
    expect(geracoes).toBe(0);
  });

  it("gera de novo se o retrato sumiu entre a conferência e a leitura", async () => {
    const pasta = pastaTemporaria();
    const arquivo = join(pasta, "migrado-ffff.tar");
    let geracoes = 0;
    const lido = await lerRetrato(arquivo, async (caminho) => {
      geracoes++;
      writeFileSync(caminho, "regerado");
    });
    expect(lido.toString()).toBe("regerado");
    expect(geracoes).toBe(1);
  });

  it("propaga erro de leitura que não seja arquivo ausente", async () => {
    const pasta = pastaTemporaria();
    // Ler uma pasta como arquivo dá EISDIR, não ENOENT: não é caso de gerar de novo.
    let geracoes = 0;
    await expect(
      lerRetrato(pasta, async () => {
        geracoes++;
      }),
    ).rejects.toMatchObject({ code: "EISDIR" });
    expect(geracoes).toBe(0);
  });
});
