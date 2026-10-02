"use client";

import { useActionState } from "react";
import type { EstadoAnuncio } from "@/anuncios/acoes";
import type { Anuncio } from "@/anuncios/repositorio";
import { SITUACOES, type CanalAnuncio } from "@/anuncios/regras";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import styles from "../formularios.module.css";

export function FormAnuncio({ imovelId, canal, inicial, salvar }: { imovelId: string; canal: CanalAnuncio; inicial?: Anuncio; salvar: (a: EstadoAnuncio, f: FormData) => Promise<EstadoAnuncio> }) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  return <form action={enviar} className={styles.form} aria-label={`Editar referência ${canal === "airbnb" ? "Airbnb" : "Booking.com"}`}>
    <input type="hidden" name="imovelId" value={imovelId} />
    <input type="hidden" name="canal" value={canal} />
    <input type="hidden" name="versao" value={inicial?.versao ?? 0} />
    <p>Registre o que você encontrou no canal. Salvar aqui não publica nem altera o anúncio externo.</p>
    {estado.erro && <p role="alert" className={styles.alerta}>{estado.erro}</p>}
    {estado.ok && <p role="status" className={styles.sucesso}>Referência salva.</p>}
    <label>Situação informada<select name="situacao" defaultValue={inicial?.situacao ?? "nao_conferido"}>{Object.entries(SITUACOES).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
    <label>Link do anúncio<input name="url" type="url" maxLength={2048} defaultValue={inicial?.url ?? ""} placeholder={canal === "airbnb" ? "https://www.airbnb.com.br/rooms/…" : "https://www.booking.com/hotel/…"} /></label>
    <label>Título no canal<input name="titulo" maxLength={200} defaultValue={inicial?.titulo ?? ""} /></label>
    <label>Descrição no canal<textarea name="descricao" rows={5} maxLength={10000} defaultValue={inicial?.descricao ?? ""} /></label>
    <label>Preço base informado (R$)<input name="precoBase" inputMode="decimal" maxLength={20} defaultValue={centavosParaCampo(inicial?.precoBase ?? null)} placeholder="Não informado" /></label>
    <p>Use a diária base em reais, sem total de estadia. Taxas, descontos e datas especiais podem explicar diferenças.</p>
    <label>Links das fotos, na ordem do anúncio<textarea name="fotos" rows={4} maxLength={62000} defaultValue={inicial?.fotos.join("\n") ?? ""} placeholder="Um link HTTPS por linha, até 30 fotos" /></label>
    <p>As fotos ficam como referências para abrir e conferir. Não são copiadas para o site.</p>
    <label className={styles.check}><input name="conferido" type="checkbox" />Conferi estas informações no canal agora</label>
    <p>Sem marcar, os dados salvos ficam aguardando conferência.</p>
    <div className={styles.acoes}><button disabled={enviando} type="submit">{enviando ? "Salvando…" : "Salvar referência"}</button></div>
  </form>;
}
