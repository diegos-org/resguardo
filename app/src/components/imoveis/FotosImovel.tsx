"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { capaFotoAcao, enviarFotoAcao, legendaFotoAcao, moverFotoAcao, removerFotoAcao, type ResultadoAcaoFoto } from "@/imoveis/acoes-fotos";
import { enderecoDaFoto, LIMITE_LEGENDA, MAXIMO_FOTOS } from "@/imoveis/fotos-regras";
import { ErroFoto, nomeJpg, reduzirFoto } from "@/imoveis/reduzir-foto";
import styles from "../formularios.module.css";

export type FotoDaFicha = { id: string; legenda: string; tamanho: number };

type Props = {
  imovelId: string;
  imovelNome: string;
  fotos: readonly FotoDaFicha[];
  /** O imóvel aparece no site (público e ativo): as fotos vão para lá na hora. */
  noSite: boolean;
};

type Aviso = { ok: boolean; texto: string } | null;

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * Fotos do imóvel (M7.3) na ficha: subir várias de uma vez (cada uma é reduzida no navegador antes de subir), escolher a
 * capa, mudar a ordem, escrever a legenda e remover (com confirmação).
 */
export function FotosImovel({ imovelId, imovelNome, fotos, noSite }: Props) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const ocupado = pendente || progresso !== null;

  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const arquivos = Array.from(entrada.current?.files ?? []);
    if (!arquivos.length) return setAviso({ ok: false, texto: "Escolha uma ou mais fotos." });
    const vagas = MAXIMO_FOTOS - fotos.length;
    if (arquivos.length > vagas) return setAviso({ ok: false, texto: `Cabem só mais ${Math.max(0, vagas)} foto(s) neste imóvel (máximo de ${MAXIMO_FOTOS}).` });
    setAviso(null);
    const erros: string[] = [];
    let feitas = 0;
    for (const [i, arquivo] of arquivos.entries()) {
      setProgresso(`Preparando e enviando ${i + 1} de ${arquivos.length}…`);
      try {
        const { grande, pequena } = await reduzirFoto(arquivo);
        const form = new FormData();
        form.set("imovelId", imovelId);
        form.set("arquivo", new File([grande], nomeJpg(arquivo.name), { type: "image/jpeg" }));
        form.set("miniatura", new File([pequena], "pequena.jpg", { type: "image/jpeg" }));
        const r = await enviarFotoAcao(form);
        if (r.ok) feitas++;
        else erros.push(`${arquivo.name}: ${r.erro}`);
      } catch (e) {
        erros.push(`${arquivo.name}: ${e instanceof ErroFoto ? e.message : "não foi possível enviar. Confira a conexão e tente de novo."}`);
      }
    }
    setProgresso(null);
    if (entrada.current) entrada.current.value = "";
    const enviadas = feitas ? `${feitas} foto(s) enviada(s).` : "";
    setAviso(erros.length ? { ok: false, texto: [enviadas, `Não foram: ${erros.join(" · ")}`].filter(Boolean).join(" ") } : { ok: true, texto: enviadas });
    router.refresh();
  }

  function executar(acao: (f: FormData) => Promise<ResultadoAcaoFoto>, campos: Record<string, string>, sucesso: string) {
    const form = new FormData();
    form.set("imovelId", imovelId);
    for (const [k, v] of Object.entries(campos)) form.set(k, v);
    iniciar(async () => {
      const r = await acao(form);
      setAviso(r.ok ? { ok: true, texto: sucesso } : { ok: false, texto: r.erro });
      router.refresh();
    });
  }

  return (
    <section aria-label="Fotos do imóvel" style={{ maxWidth: 980, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.25rem" }}>Fotos</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>
        As fotos aparecem na galeria da página do imóvel, na ordem daqui; a primeira é a capa (cartão do site e capa do relatório mensal do proprietário).
        {noSite ? " Este imóvel está no site: o que você muda aqui aparece lá na hora." : " Este imóvel não está no site agora: as fotos ficam guardadas e aparecem quando ele for publicado."}{" "}
        Use as fotos dos anúncios ou as que você separou. Cada foto é reduzida no seu navegador antes de subir, então pode mandar a original do celular.
        Sem foto, o site mostra &ldquo;foto em breve&rdquo;.
      </p>
      {aviso && (
        <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? styles.sucesso : styles.erro}>
          {aviso.texto}
        </p>
      )}
      {fotos.length > 0 && (
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {fotos.map((f, i) => (
            <li key={f.id} style={{ border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", padding: 8, display: "flex", flexDirection: "column", gap: 6, background: "var(--scl-papel)" }}>
              <div style={{ position: "relative", aspectRatio: "3 / 2", borderRadius: 6, overflow: "hidden", background: "var(--scl-areia)" }}>
                <Image src={enderecoDaFoto(f.id, "pequena")} alt={f.legenda || `Foto ${i + 1} de ${imovelNome}`} fill sizes="240px" unoptimized style={{ objectFit: "cover" }} />
              </div>
              <span style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>
                {i === 0 ? <strong>Capa</strong> : `Foto ${i + 1}`} · {kb(f.tamanho)}
              </span>
              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const legenda = new FormData(ev.currentTarget).get("legenda");
                  executar(legendaFotoAcao, { id: f.id, legenda: typeof legenda === "string" ? legenda : "" }, "Legenda salva.");
                }}
                style={{ display: "flex", gap: 6 }}
              >
                <input name="legenda" defaultValue={f.legenda} maxLength={LIMITE_LEGENDA} placeholder="Legenda (ex.: Sala com vista)" aria-label={`Legenda da foto ${i + 1}`} style={{ flex: 1, minWidth: 0 }} />
                <button type="submit" className={styles.pequeno} disabled={ocupado}>
                  Salvar
                </button>
              </form>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className={styles.pequeno} disabled={ocupado || i === 0} onClick={() => executar(moverFotoAcao, { id: f.id, passo: "-1" }, "Ordem salva.")} aria-label={`Mover a foto ${i + 1} para antes`}>
                  ←
                </button>
                <button type="button" className={styles.pequeno} disabled={ocupado || i === fotos.length - 1} onClick={() => executar(moverFotoAcao, { id: f.id, passo: "1" }, "Ordem salva.")} aria-label={`Mover a foto ${i + 1} para depois`}>
                  →
                </button>
                {i > 0 && (
                  <button type="button" className={styles.pequeno} disabled={ocupado} onClick={() => executar(capaFotoAcao, { id: f.id }, "Capa trocada.")}>
                    Usar como capa
                  </button>
                )}
                <form
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    executar(removerFotoAcao, { id: f.id }, "Foto removida.");
                  }}
                  style={{ display: "inline" }}
                >
                  <BotaoConfirmar pergunta={`Remover a ${i === 0 ? "capa" : `foto ${i + 1}`} de ${imovelNome}? Ela sai do site e do relatório.${i === 0 && fotos.length > 1 ? " A foto seguinte vira a capa." : ""}`} className={styles.pequeno} disabled={ocupado}>
                    Remover
                  </BotaoConfirmar>
                </form>
              </div>
            </li>
          ))}
        </ol>
      )}
      {fotos.length < MAXIMO_FOTOS ? (
        <form onSubmit={enviar} className={styles.form} aria-label="Subir fotos">
          <label>
            Fotos (JPG ou PNG; pode escolher várias)
            <input ref={entrada} type="file" name="fotos" accept="image/jpeg,image/png,image/*" multiple disabled={ocupado} />
          </label>
          <div className={styles.acoes}>
            <button type="submit" className={styles.botao} disabled={ocupado}>
              {progresso ?? "Subir fotos"}
            </button>
          </div>
        </form>
      ) : (
        <p className={styles.alerta}>Este imóvel já tem {MAXIMO_FOTOS} fotos, o máximo. Remova alguma para subir outra.</p>
      )}
    </section>
  );
}
