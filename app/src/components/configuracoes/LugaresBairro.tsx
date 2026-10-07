"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type CSSProperties, type FormEvent, useId, useRef, useState, useTransition } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { ErroFoto, nomeJpg, reduzirFoto } from "@/imoveis/reduzir-foto";
import { adicionarLugarAcao, editarLugarAcao, fotoLugarAcao, moverLugarAcao, removerLugarAcao, salvarTextosBairroAcao, tirarFotoLugarAcao } from "@/site/acoes-bairro";
import type { LimitesBairro, ResultadoBairro } from "@/site/bairro";
import styles from "../formularios.module.css";

/** Um lugar como o painel mostra: a foto já é o endereço da prévia; `semImovel` = o bairro não bate com nenhum imóvel do site. */
export type LugarDoPainel = { id: string; nome: string; distancia: string; frase: string; bairro: string; foto: string | null; semImovel: boolean };

type Props = { titulo: string; subtitulo: string; lugares: readonly LugarDoPainel[]; bairros: readonly string[]; limites: LimitesBairro };
type Erros = Record<string, string | undefined>;
/** Recado de uma parte da tela: `onde` é "textos", "lista", "novo" ou o id do lugar. */
type Aviso = { onde: string; ok: boolean; texto: string; erros?: Erros } | null;
type Acao = (form: FormData) => Promise<ResultadoBairro>;

const nota: CSSProperties = { fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 };
const semCaixa: CSSProperties = { border: 0, padding: 0, background: "transparent", maxWidth: "none" };
const alertaAmarelo: CSSProperties = { background: "var(--scl-aviso-fundo)", color: "var(--scl-aviso-texto)", padding: "10px 12px", borderRadius: "var(--scl-raio-campo)", fontSize: "0.875rem", margin: 0 };

function Recado({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null;
  return (
    <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? styles.sucesso : styles.alerta}>
      {aviso.texto}
    </p>
  );
}

type PropsCampo = { nome: string; rotulo: string; limite: number; valor?: string; erro?: string; largo?: boolean; linhas?: number; lista?: string; obrigatorio?: boolean; exemplo?: string };

function Campo({ nome, rotulo, limite, valor, erro, largo, linhas, lista, obrigatorio, exemplo }: PropsCampo) {
  const props = { name: nome, defaultValue: valor ?? "", maxLength: limite, required: obrigatorio, placeholder: exemplo, "aria-invalid": erro ? true : undefined };
  return (
    <label className={largo ? styles.largo : undefined}>
      {rotulo}
      {linhas ? <textarea rows={linhas} {...props} /> : <input list={lista} {...props} />}
      {erro && <span className={styles.erro}>{erro}</span>}
    </label>
  );
}

function CamposLugar({ l, limites, erros, lista }: { l?: LugarDoPainel; limites: LimitesBairro; erros?: Erros; lista: string }) {
  return (
    <>
      <div className={styles.linha}>
        <Campo nome="nome" rotulo="Nome" limite={limites.nome} valor={l?.nome} erro={erros?.nome} obrigatorio largo exemplo="ex.: Praia do Leblon" />
        <Campo nome="distancia" rotulo="Distância" limite={limites.distancia} valor={l?.distancia} erro={erros?.distancia} exemplo="ex.: 5 min a pé" />
      </div>
      <Campo nome="frase" rotulo="Frase curta" limite={limites.frase} valor={l?.frase} erro={erros?.frase} exemplo="ex.: Mar aberto. Um convite a desacelerar." />
      <Campo nome="bairro" rotulo="Bairro (em branco = aparece em todos os imóveis)" limite={limites.bairro} valor={l?.bairro} erro={erros?.bairro} lista={lista} exemplo="ex.: Leblon" />
    </>
  );
}

type PropsItem = {
  l: LugarDoPainel;
  posicao: number;
  total: number;
  limites: LimitesBairro;
  lista: string;
  ocupado: boolean;
  enviando: boolean;
  aviso: Aviso;
  executar: (onde: string, acao: Acao, form: FormData, sucesso: string) => void;
  trocarFoto: (id: string, arquivo: File) => void;
};

function ItemLugar({ l, posicao, total, limites, lista, ocupado, enviando, aviso, executar, trocarFoto }: PropsItem) {
  const entrada = useRef<HTMLInputElement>(null);
  const doLugar = (campos: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("id", l.id);
    for (const [k, v] of Object.entries(campos)) form.set(k, v);
    return form;
  };
  const rotuloFoto = l.foto ? "Trocar foto" : "Pôr foto";
  return (
    <li style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 14, background: "var(--scl-papel)", border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)" }}>
      <div style={{ flex: "0 0 180px", display: "flex", flexDirection: "column", gap: 8 }}>
        {l.foto ? (
          <div style={{ position: "relative", aspectRatio: "3 / 2", borderRadius: 6, overflow: "hidden", background: "var(--scl-areia)" }}>
            <Image src={l.foto} alt={`Foto de ${l.nome}`} fill sizes="180px" unoptimized style={{ objectFit: "cover" }} />
          </div>
        ) : (
          <div style={{ ...nota, aspectRatio: "3 / 2", display: "flex", alignItems: "center", justifyContent: "center", padding: 10, textAlign: "center", border: "1px dashed var(--scl-borda)", borderRadius: 6, fontSize: "0.8125rem" }}>
            Sem foto: no site, o cartão fica só com o texto.
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className={styles.pequeno} disabled={ocupado} onClick={() => entrada.current?.click()} aria-label={`${rotuloFoto}: ${l.nome}`}>
            {enviando ? "Enviando…" : rotuloFoto}
          </button>
          <input
            ref={entrada}
            type="file"
            accept="image/jpeg,image/png,image/*"
            hidden
            tabIndex={-1}
            aria-label={`Foto de ${l.nome}`}
            onChange={(ev) => {
              const arquivo = ev.currentTarget.files?.[0];
              ev.currentTarget.value = "";
              if (arquivo) trocarFoto(l.id, arquivo);
            }}
          />
          {l.foto && (
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                executar(l.id, tirarFotoLugarAcao, doLugar(), "Foto tirada: no site, o cartão fica só com o texto.");
              }}
            >
              <BotaoConfirmar className={styles.pequeno} disabled={ocupado} aria-label={`Tirar foto: ${l.nome}`} pergunta={`Tirar a foto de "${l.nome}"? O arquivo da foto é apagado; o lugar continua no site, só com o texto.`}>
                Tirar foto
              </BotaoConfirmar>
            </form>
          )}
        </div>
      </div>
      <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Depois de salvar, o formulário volta com o que ficou gravado (espaços sobrando saem). */}
        <form
          key={[l.nome, l.distancia, l.frase, l.bairro].join("\n")}
          onSubmit={(ev) => {
            ev.preventDefault();
            executar(l.id, editarLugarAcao, new FormData(ev.currentTarget), "Lugar salvo.");
          }}
          className={styles.form}
          style={semCaixa}
          aria-label={`Lugar ${posicao + 1}: ${l.nome}`}
        >
          <input type="hidden" name="id" value={l.id} />
          <CamposLugar l={l} limites={limites} erros={aviso?.erros} lista={lista} />
          <div className={styles.acoes}>
            <button type="submit" disabled={ocupado}>
              Salvar
            </button>
          </div>
        </form>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className={styles.pequeno} disabled={ocupado || posicao === 0} onClick={() => executar(l.id, moverLugarAcao, doLugar({ passo: "-1" }), "Ordem salva.")} aria-label={`Subir: ${l.nome}`}>
            ↑
          </button>
          <button type="button" className={styles.pequeno} disabled={ocupado || posicao === total - 1} onClick={() => executar(l.id, moverLugarAcao, doLugar({ passo: "1" }), "Ordem salva.")} aria-label={`Descer: ${l.nome}`}>
            ↓
          </button>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              executar("lista", removerLugarAcao, doLugar(), `"${l.nome}" saiu da seção e do site.`);
            }}
            style={{ marginLeft: "auto" }}
          >
            <BotaoConfirmar
              className={styles.pequeno}
              style={{ color: "var(--scl-erro-texto)" }}
              disabled={ocupado}
              aria-label={`Remover: ${l.nome}`}
              pergunta={`Remover "${l.nome}" da seção? Ele sai do site na hora${l.foto ? " e o arquivo da foto é apagado" : ""}. Não dá para desfazer.`}
            >
              Remover
            </BotaoConfirmar>
          </form>
        </div>
        {l.semImovel && (
          <p style={alertaAmarelo}>
            Nenhum imóvel do site está no bairro &ldquo;{l.bairro}&rdquo;: este lugar não aparece em nenhuma ficha. Confira o nome do bairro, ou deixe em branco para aparecer em todos.
          </p>
        )}
        <Recado aviso={aviso} />
      </div>
    </li>
  );
}

/**
 * "O bairro à sua porta" (M7.6) em Configurações → Site: textos da seção, lugares (editar, foto, ordem, remover com
 * confirmação) e "Adicionar lugar". A foto é reduzida no navegador e sobe num pedido só dela.
 */
export function LugaresBairro({ titulo, subtitulo, lugares, bairros, limites }: Props) {
  const router = useRouter();
  const lista = useId();
  const fotoNova = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const ocupado = pendente || enviando !== null;
  const avisoDe = (onde: string) => (aviso?.onde === onde ? aviso : null);

  function executar(onde: string, acao: Acao, form: FormData, sucesso: string) {
    iniciar(async () => {
      const r = await acao(form);
      setAviso(r.ok ? { onde, ok: true, texto: r.mudou ? sucesso : "Nada mudou." } : { onde, ok: false, texto: r.erro, erros: r.erros });
      router.refresh();
    });
  }

  /** Reduz no navegador (a versão de 800 px basta para o cartão) e sobe; devolve o erro, ou null. */
  async function enviarFoto(id: string, arquivo: File): Promise<string | null> {
    try {
      const { pequena } = await reduzirFoto(arquivo);
      const form = new FormData();
      form.set("id", id);
      form.set("arquivo", new File([pequena], nomeJpg(arquivo.name), { type: "image/jpeg" }));
      const r = await fotoLugarAcao(form);
      return r.ok ? null : r.erro;
    } catch (e) {
      return e instanceof ErroFoto ? e.message : "Não foi possível enviar a foto. Confira a conexão e tente de novo.";
    }
  }

  async function trocarFoto(id: string, arquivo: File) {
    setAviso(null);
    setEnviando(id);
    const erro = await enviarFoto(id, arquivo);
    setEnviando(null);
    setAviso({ onde: id, ok: !erro, texto: erro ?? "Foto salva." });
    router.refresh();
  }

  async function adicionar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const formulario = ev.currentTarget;
    const form = new FormData(formulario);
    form.delete("foto");
    const foto = fotoNova.current?.files?.[0] ?? null;
    setAviso(null);
    setEnviando("novo");
    try {
      const r = await adicionarLugarAcao(form);
      if (!r.ok) return setAviso({ onde: "novo", ok: false, texto: r.erro, erros: r.erros });
      const erro = foto && r.id ? await enviarFoto(r.id, foto) : null;
      formulario.reset();
      setAviso(
        erro
          ? { onde: "novo", ok: false, texto: `O lugar foi adicionado, mas a foto não subiu: ${erro} Tente de novo em "Pôr foto", no lugar.` }
          : { onde: "novo", ok: true, texto: "Lugar adicionado." },
      );
    } catch {
      setAviso({ onde: "novo", ok: false, texto: "Não foi possível salvar. Confira a conexão e tente de novo." });
    } finally {
      setEnviando(null);
      router.refresh();
    }
  }

  const novo = avisoDe("novo");
  return (
    <section aria-labelledby="titulo-bairro-painel" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 }}>
      <h2 id="titulo-bairro-painel" style={{ fontSize: "1.25rem", margin: "12px 0 0" }}>
        O bairro à sua porta
      </h2>
      <p style={nota}>
        Lugares perto dos apartamentos (a praia, um café, uma livraria) que aparecem no fim da página de cada imóvel no site, com o título e o subtítulo abaixo.
        Cada lugar tem nome, distância (ex.: 5 min a pé), uma frase curta e, se quiser, uma foto. Com o bairro em branco, o lugar aparece em todos os
        imóveis; com um bairro (ex.: Leblon), só nos imóveis daquele bairro. Sem nenhum lugar, a seção não aparece no site.
      </p>
      <p style={nota}>
        As fotos de lugares do estudo visual não podem ser usadas, porque os direitos delas não foram liberados. Suba só fotos que você tirou ou que tem o
        direito de usar; cada foto é reduzida no seu navegador antes de subir. Sem foto, o cartão sai só com o texto.
      </p>
      <datalist id={lista}>
        {bairros.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <form
        key={`${titulo}\n${subtitulo}`}
        onSubmit={(ev) => {
          ev.preventDefault();
          executar("textos", salvarTextosBairroAcao, new FormData(ev.currentTarget), "Textos da seção salvos.");
        }}
        className={styles.form}
        aria-label="Textos da seção O bairro à sua porta"
      >
        <Campo nome="titulo" rotulo="Título da seção" limite={limites.titulo} valor={titulo} erro={avisoDe("textos")?.erros?.titulo} obrigatorio />
        <Campo nome="subtitulo" rotulo="Subtítulo (pode ficar em branco)" limite={limites.subtitulo} valor={subtitulo} erro={avisoDe("textos")?.erros?.subtitulo} linhas={2} />
        <Recado aviso={avisoDe("textos")} />
        <div className={styles.acoes}>
          <button type="submit" disabled={ocupado}>
            Salvar textos
          </button>
        </div>
      </form>
      <Recado aviso={avisoDe("lista")} />
      {lugares.length > 0 ? (
        <ol aria-label="Lugares, na ordem do site" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {lugares.map((l, i) => (
            <ItemLugar
              key={l.id}
              l={l}
              posicao={i}
              total={lugares.length}
              limites={limites}
              lista={lista}
              ocupado={ocupado}
              enviando={enviando === l.id}
              aviso={avisoDe(l.id)}
              executar={executar}
              trocarFoto={trocarFoto}
            />
          ))}
        </ol>
      ) : (
        <p style={nota}>Nenhum lugar ainda: a seção não aparece no site até você adicionar o primeiro.</p>
      )}
      {lugares.length < limites.lugares ? (
        <form onSubmit={adicionar} className={styles.form} aria-label="Adicionar lugar">
          <h3 style={{ fontSize: "1.0625rem", margin: 0 }}>Adicionar lugar</h3>
          <CamposLugar limites={limites} erros={novo?.erros} lista={lista} />
          <label>
            Foto (opcional; JPG ou PNG)
            <input ref={fotoNova} type="file" name="foto" accept="image/jpeg,image/png,image/*" disabled={ocupado} />
          </label>
          <Recado aviso={novo} />
          <div className={styles.acoes}>
            <button type="submit" disabled={ocupado}>
              {enviando === "novo" ? "Salvando…" : "Adicionar lugar"}
            </button>
          </div>
        </form>
      ) : (
        <p style={alertaAmarelo}>
          Já são {limites.lugares} lugares, o máximo. Remova algum para adicionar outro.
        </p>
      )}
    </section>
  );
}
