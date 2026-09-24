"use client";

import { useActionState } from "react";
import type { Detalhes } from "@/imoveis/detalhes";
import type { EstadoDetalhes } from "@/imoveis/acoes";
import { COMODIDADES, TIPOS_CAMA } from "@/imoveis/cadastro-opcoes";
import { DIAS_SEMANA } from "@/imoveis/regras-venda";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import styles from "../formularios.module.css";

type Props = { imovelId: string; inicial: Detalhes; salvar: (a: EstadoDetalhes, f: FormData) => Promise<EstadoDetalhes> };

const grupo = { border: "1px solid var(--scl-areia)", borderRadius: 8, padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 12, margin: 0 };
const legenda = { fontWeight: 500, padding: "0 6px" };

export function FormDetalhes({ imovelId, inicial, salvar }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  // Depois de um erro, o React limpa o formulário: os campos voltam com o que foi digitado.
  const v = estado.valores;
  const campo = (k: string, atual: string) => (v ? String(v[k] ?? "") : atual);
  const dinheiro = (k: keyof Detalhes) => campo(k, centavosParaCampo(inicial[k] as number | null));
  const numero = (k: keyof Detalhes) => campo(k, inicial[k] === null ? "" : String(inicial[k]));
  const marcado = (k: keyof Detalhes) => (v ? v[k] === "on" : Boolean(inicial[k]));
  const naLista = (k: "comodidades" | "diasChegada" | "diasSaida", valor: string) =>
    v ? ((v[k] as string[] | undefined) ?? []).includes(valor) : k === "comodidades" ? inicial.comodidades.includes(valor) : (inicial[k] as number[]).includes(Number(valor));
  const outras = inicial.comodidades.filter((c) => !(COMODIDADES as readonly string[]).includes(c)).join(", ");
  const erro = (k: string) => {
    const m = estado.erros?.[k as keyof typeof estado.erros];
    return m ? <span className={styles.erro}>{m}</span> : null;
  };
  const invalido = (k: string) => (estado.erros?.[k as keyof typeof estado.erros] ? { "aria-invalid": true as const } : {});
  const diasTodos = (k: "diasChegada" | "diasSaida") => (v ? false : (inicial[k] as number[]).length === 0);

  return (
    <section aria-label="Cadastro completo" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.25rem" }}>Cadastro completo</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>
        Campo em branco = ainda não cadastrado (o sistema avisa em vez de supor um valor). O site, o Beds24 e as cotações vão ler daqui.
      </p>
      <form key={JSON.stringify(inicial)} action={enviar} className={styles.form} aria-label="Cadastro completo do imóvel">
        <input type="hidden" name="imovelId" value={imovelId} />
        {estado.mensagem && (
          <p role="alert" className={styles.alerta}>
            {estado.mensagem}
          </p>
        )}

        <fieldset style={grupo}>
          <legend style={legenda}>Endereço (complemento do cadastro básico)</legend>
          <div className={styles.linha}>
            <label>
              CEP
              <input name="cep" defaultValue={campo("cep", inicial.cep)} maxLength={9} {...invalido("cep")} />
              {erro("cep")}
            </label>
            <label className={styles.largo}>
              Complemento
              <input name="complemento" defaultValue={campo("complemento", inicial.complemento)} maxLength={120} placeholder="ex.: apto 403, bloco B" />
              {erro("complemento")}
            </label>
            <label>
              Estado (UF)
              <input name="estado" defaultValue={campo("estado", inicial.estado)} maxLength={2} placeholder="RJ" {...invalido("estado")} />
              {erro("estado")}
            </label>
          </div>
        </fieldset>

        <fieldset style={grupo}>
          <legend style={legenda}>Camas e comodidades</legend>
          <div className={styles.linha}>
            {Object.entries(TIPOS_CAMA).map(([tipo, nome]) => (
              <label key={tipo} style={{ minWidth: 90, flex: "0 1 100px" }}>
                {nome}
                <input name={`cama_${tipo}`} type="number" min={0} max={20} defaultValue={campo(`cama_${tipo}`, String(inicial.camas[tipo] ?? ""))} />
              </label>
            ))}
          </div>
          {erro("camas")}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
            {COMODIDADES.map((c) => (
              <label key={c} className={styles.check} style={{ flex: "0 0 auto", minWidth: 0 }}>
                <input type="checkbox" name="comodidades" value={c} defaultChecked={naLista("comodidades", c)} /> {c}
              </label>
            ))}
          </div>
          <label>
            Outras comodidades (separe por vírgula)
            <input name="comodidadesOutras" defaultValue={campo("comodidadesOutras", outras)} {...invalido("comodidadesOutras")} />
            {erro("comodidadesOutras")}
            {erro("comodidades")}
          </label>
        </fieldset>

        <fieldset style={grupo}>
          <legend style={legenda}>Regras da casa e horários</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <label className={styles.check}>
              <input type="checkbox" name="aceitaAnimais" defaultChecked={marcado("aceitaAnimais")} /> Aceita animais
            </label>
            <label className={styles.check}>
              <input type="checkbox" name="permiteFumar" defaultChecked={marcado("permiteFumar")} /> Permite fumar
            </label>
            <label className={styles.check}>
              <input type="checkbox" name="permiteFestas" defaultChecked={marcado("permiteFestas")} /> Permite festas
            </label>
          </div>
          <label>
            Regras da casa (texto para o hóspede)
            <textarea name="regrasCasa" rows={3} maxLength={4000} defaultValue={campo("regrasCasa", inicial.regrasCasa)} />
            {erro("regrasCasa")}
          </label>
          <div className={styles.linha}>
            <label>
              Entrada a partir de
              <input name="checkinAPartirDe" type="time" defaultValue={campo("checkinAPartirDe", inicial.checkinAPartirDe)} {...invalido("checkinAPartirDe")} />
              {erro("checkinAPartirDe")}
            </label>
            <label>
              Saída até
              <input name="checkoutAte" type="time" defaultValue={campo("checkoutAte", inicial.checkoutAte)} {...invalido("checkoutAte")} />
              {erro("checkoutAte")}
            </label>
          </div>
        </fieldset>

        <fieldset style={grupo}>
          <legend style={legenda}>Preço e taxas (R$)</legend>
          <div className={styles.linha}>
            <label>
              Preço base da noite
              <input name="precoBase" inputMode="decimal" defaultValue={dinheiro("precoBase")} placeholder="ex.: 650,00" {...invalido("precoBase")} />
              {erro("precoBase")}
            </label>
            <label>
              Taxa de limpeza
              <input name="taxaLimpeza" inputMode="decimal" defaultValue={dinheiro("taxaLimpeza")} {...invalido("taxaLimpeza")} />
              {erro("taxaLimpeza")}
            </label>
          </div>
          <div className={styles.linha}>
            <label>
              Hóspede extra (por noite)
              <input name="hospedeExtraValor" inputMode="decimal" defaultValue={dinheiro("hospedeExtraValor")} {...invalido("hospedeExtraValor")} />
              {erro("hospedeExtraValor")}
            </label>
            <label>
              Cobrar a partir do hóspede nº
              <input name="hospedeExtraAPartirDe" type="number" min={1} max={50} defaultValue={numero("hospedeExtraAPartirDe")} {...invalido("hospedeExtraAPartirDe")} />
              {erro("hospedeExtraAPartirDe")}
            </label>
          </div>
          <label className={styles.check}>
            <input type="checkbox" name="precoDinamico" defaultChecked={marcado("precoDinamico")} /> Preço dinâmico ligado (o valor fica sempre entre o mínimo e o máximo)
          </label>
          {erro("precoDinamico")}
          <div className={styles.linha}>
            <label>
              Preço mínimo da noite
              <input name="precoMinimo" inputMode="decimal" defaultValue={dinheiro("precoMinimo")} {...invalido("precoMinimo")} />
              {erro("precoMinimo")}
            </label>
            <label>
              Preço máximo da noite
              <input name="precoMaximo" inputMode="decimal" defaultValue={dinheiro("precoMaximo")} {...invalido("precoMaximo")} />
              {erro("precoMaximo")}
            </label>
          </div>
        </fieldset>

        <fieldset style={grupo}>
          <legend style={legenda}>Regras de venda</legend>
          <div className={styles.linha}>
            <label>
              Estadia mínima (noites)
              <input name="estadiaMinima" type="number" min={1} max={365} defaultValue={numero("estadiaMinima")} {...invalido("estadiaMinima")} />
              {erro("estadiaMinima")}
            </label>
            <label>
              Estadia máxima (noites)
              <input name="estadiaMaxima" type="number" min={1} max={365} defaultValue={numero("estadiaMaxima")} {...invalido("estadiaMaxima")} />
              {erro("estadiaMaxima")}
            </label>
            <label>
              Antecedência mínima (dias)
              <input name="antecedenciaMinima" type="number" min={0} max={365} defaultValue={numero("antecedenciaMinima")} {...invalido("antecedenciaMinima")} />
              {erro("antecedenciaMinima")}
            </label>
            <label>
              Reservas até (dias à frente)
              <input name="janelaMaxima" type="number" min={1} max={1095} defaultValue={numero("janelaMaxima")} {...invalido("janelaMaxima")} />
              {erro("janelaMaxima")}
            </label>
          </div>
          {(["diasChegada", "diasSaida"] as const).map((k) => (
            <div key={k} style={{ fontSize: "0.875rem" }}>
              <span style={{ color: "var(--scl-texto-2)" }}>{k === "diasChegada" ? "Dias de entrada permitidos" : "Dias de saída permitidos"} (nenhum ou todos marcados = qualquer dia): </span>
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "4px 12px" }}>
                {DIAS_SEMANA.map((d, i) => (
                  <label key={d} className={styles.check} style={{ flex: "0 0 auto", minWidth: 0 }}>
                    <input type="checkbox" name={k} value={String(i)} defaultChecked={diasTodos(k) || naLista(k, String(i))} /> {d}
                  </label>
                ))}
              </span>
              {erro(k)}
            </div>
          ))}
        </fieldset>

        {estado.ok && (
          <p role="status" className={styles.sucesso}>
            Salvo.
          </p>
        )}
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar cadastro completo"}
          </button>
        </div>
      </form>
    </section>
  );
}
