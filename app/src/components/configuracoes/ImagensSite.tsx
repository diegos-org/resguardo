"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { ErroFoto, nomeJpg, reduzirFoto } from "@/imoveis/reduzir-foto";
import { enviarImagemSiteAcao, type ResultadoImagemSite, tirarImagemSiteAcao } from "@/site/acoes-imagens-site";
import styles from "../formularios.module.css";

type Aviso = { ok: boolean; texto: string } | null;

/**
 * Foto da capa e marca do site (M7.6). A foto da capa é reduzida no navegador antes de subir (pode ser a original do
 * celular); a marca sobe como está, para o PNG transparente continuar transparente.
 */
export function ImagensSite({ capa, marca, marcaPadrao }: { capa: string | null; marca: string | null; marcaPadrao: string }) {
  const router = useRouter();
  const [aviso, setAviso] = useState<Aviso>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const ocupado = pendente || enviando !== null;
  const entradaCapa = useRef<HTMLInputElement>(null);
  const entradaMarca = useRef<HTMLInputElement>(null);

  function concluir(r: ResultadoImagemSite, sucesso: string) {
    setAviso(r.ok ? { ok: true, texto: sucesso } : { ok: false, texto: r.erro });
    router.refresh();
  }

  async function enviar(ev: FormEvent<HTMLFormElement>, qual: "capa" | "marca") {
    ev.preventDefault();
    const arquivo = (qual === "capa" ? entradaCapa : entradaMarca).current?.files?.[0];
    if (!arquivo) return setAviso({ ok: false, texto: "Escolha a imagem." });
    setAviso(null);
    setEnviando(qual === "capa" ? "Preparando e enviando a foto…" : "Enviando a marca…");
    try {
      const form = new FormData();
      form.set("qual", qual);
      if (qual === "capa") {
        const { grande } = await reduzirFoto(arquivo);
        form.set("arquivo", new File([grande], nomeJpg(arquivo.name), { type: "image/jpeg" }));
      } else form.set("arquivo", arquivo);
      concluir(await enviarImagemSiteAcao(form), qual === "capa" ? "Foto da capa trocada: já está no site." : "Marca trocada: já está no site.");
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof ErroFoto ? e.message : "Não foi possível enviar. Confira a conexão e tente de novo." });
    } finally {
      setEnviando(null);
      for (const r of [entradaCapa, entradaMarca]) if (r.current) r.current.value = "";
    }
  }

  function tirar(qual: "capa" | "marca") {
    const form = new FormData();
    form.set("qual", qual);
    iniciar(async () => concluir(await tirarImagemSiteAcao(form), qual === "capa" ? "Foto da capa tirada: o site volta ao fundo verde." : "Marca enviada tirada: o site volta à marca do estudo."));
  }

  const quadro = { position: "relative", borderRadius: 6, overflow: "hidden", background: "var(--scl-areia)", border: "1px solid var(--scl-borda)" } as const;
  return (
    <section aria-labelledby="titulo-imagens-site" style={{ maxWidth: 980, display: "flex", flexDirection: "column", gap: 12, marginTop: 28 }}>
      <h2 id="titulo-imagens-site" style={{ fontSize: "1.25rem" }}>
        Imagens do site
      </h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>
        A foto da capa fica atrás do título da página inicial; sem foto, a capa fica no fundo verde (nunca uma imagem genérica). Use só fotos que você tem direito de
        usar. A marca é o ícone ao lado do nome, no topo e no rodapé; enquanto você não enviar outra, vale a do estudo visual.
      </p>
      {aviso && (
        <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? styles.sucesso : styles.erro}>
          {aviso.texto}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>Foto da capa</strong>
          <div style={{ ...quadro, aspectRatio: "16 / 7" }}>
            {capa ? (
              <Image src={capa} alt="Foto da capa do site" fill sizes="480px" unoptimized style={{ objectFit: "cover" }} />
            ) : (
              <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>Sem foto: fundo verde</span>
            )}
          </div>
          <form onSubmit={(ev) => enviar(ev, "capa")} className={styles.form} aria-label="Enviar foto da capa">
            <label>
              {capa ? "Trocar a foto (JPG ou PNG; pode ser a original do celular)" : "Enviar a foto (JPG ou PNG; pode ser a original do celular)"}
              <input ref={entradaCapa} type="file" accept="image/jpeg,image/png,image/*" disabled={ocupado} />
            </label>
            <div className={styles.acoes}>
              <button type="submit" disabled={ocupado}>
                {enviando ?? "Enviar foto da capa"}
              </button>
            </div>
          </form>
          {capa && (
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                tirar("capa");
              }}
            >
              <BotaoConfirmar pergunta="Tirar a foto da capa? O site volta ao fundo verde." className={styles.pequeno} disabled={ocupado}>
                Tirar a foto da capa
              </BotaoConfirmar>
            </form>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>Marca (ícone do logotipo)</strong>
          <div style={{ ...quadro, width: 96, height: 96 }}>
            <Image src={marca ?? marcaPadrao} alt="Marca do site" fill sizes="96px" unoptimized style={{ objectFit: "contain" }} />
          </div>
          <span style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>{marca ? "Marca enviada por você." : "Marca do estudo visual (padrão)."}</span>
          <form onSubmit={(ev) => enviar(ev, "marca")} className={styles.form} aria-label="Enviar marca">
            <label>
              Trocar a marca (PNG ou JPG quadrado, até 512 KB)
              <input ref={entradaMarca} type="file" accept="image/png,image/jpeg" disabled={ocupado} />
            </label>
            <div className={styles.acoes}>
              <button type="submit" disabled={ocupado}>
                Enviar marca
              </button>
            </div>
          </form>
          {marca && (
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                tirar("marca");
              }}
            >
              <BotaoConfirmar pergunta="Tirar a marca enviada? O site volta à marca do estudo." className={styles.pequeno} disabled={ocupado}>
                Voltar à marca do estudo
              </BotaoConfirmar>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
