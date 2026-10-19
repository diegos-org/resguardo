/**
 * Integrações → "Reservas do site no Beds24" (M8.3a, desenho 2.3, 7 e 8): a chave e o ambiente, a credencial (M8.3c: com o
 * último 403 ou 401 de reservas), a prontidão (só leitura no Beds24; M8.3c: com os escopos guardados e o motivo que para a
 * escrita), a pausa geral, os imóveis ligados (D6), o ensaio (M8.3c, D7: criar, conferir nas OTAs e cancelar) e os
 * contadores por situação, com o link para as reservas que pedem atenção. Os dados vêm de `painelReservasBeds24` (códigos); os
 * textos ficam aqui. Só o painel importa este componente: nada que o hóspede ou o proprietário lê cita o Beds24.
 */
import Link from "next/link";
import type { EnsaioNoPainel } from "@/beds24/reservas-site-ensaio";
import type { EscoposGuardadosBeds24, MarcaLegivelBeds24, MotivoSemEnsaioBeds24, MotivoSemLigarBeds24, PainelReservasBeds24 } from "@/beds24/reservas-site-painel";
import { type SituacaoAcompanhamentoBeds24, SITUACOES_ACOMPANHAMENTO_BEDS24 } from "@/beds24/reservas-site-regras";
import { textoDaConfiguracaoDasReservas, type UltimaRecusaDeReservas } from "@/beds24/reservas-site-rotina";
import styles from "@/components/formularios.module.css";
import { dataBr, dataHoraNoFuso, hojeISO } from "@/lib/datas";
import { NOMES_SITUACAO_NO_BEDS24 } from "@/components/reservas/ReservaNoBeds24";
import { TEXTO_CREDENCIAL_ESCRITA_FORA_DA_PRODUCAO } from "@/sistema/servicos";
import { AcaoReservasBeds24, ConferirEscoposBeds24, CriarEnsaioBeds24 } from "./AcaoReservasBeds24";

const quando = (iso: string | Date) => dataHoraNoFuso(typeof iso === "string" ? new Date(iso) : iso);

const MARCA: Record<MarcaLegivelBeds24, string> = {
  provada_no_ensaio: "legível: o último ensaio, com a credencial atual, leu a marca de volta",
  ilegivel: "não legível: uma reserva do sistema voltou sem a marca do SCL; as criações ficam paradas",
  nao_conferida: "ainda não conferida: só o ensaio com a credencial atual prova",
};
const SEM_LIGAR: Record<MotivoSemLigarBeds24, string> = {
  sem_credencial: "Para ligar um imóvel, falta a credencial do Beds24.",
  sem_ensaio: "Para ligar um imóvel, falta um ensaio conferido com a credencial atual (abaixo, em Ensaio): sem ele, nenhum imóvel liga.",
};

/** A leitura guardada dos escopos, em poucas palavras (o botão mostra a leitura de agora, com a lista). */
const ESCOPOS_GUARDADOS: Record<EscoposGuardadosBeds24["situacao"], string> = {
  em_ordem: "em ordem",
  escopo_excessivo: "com permissões demais (nada é escrito com esta credencial)",
  ilegivel: "não deu para ler (conta como fora de ordem)",
  incompleto: "faltam escopos do convite (conta como fora de ordem)",
};

function textoDosEscoposGuardados(e: EscoposGuardadosBeds24 | null): string {
  if (!e) return "ainda não lidos";
  const lidos = e.lidoEm ? `, lidos em ${quando(e.lidoEm)}` : "";
  const vale = !e.comCredencialAtual ? " com outra credencial: vale ler de novo" : !e.valida ? " há mais de 26 horas: a rotina lê de novo antes de escrever" : "";
  return `${ESCOPOS_GUARDADOS[e.situacao]}${lidos}${vale}`;
}

function textoDaRecusa(r: UltimaRecusaDeReservas): string {
  const codigo = r.resposta === "http_403" ? "403 (sem permissão de escrever reservas)" : "401 (credencial recusada)";
  return ` Última recusa do Beds24 ao gravar reservas: ${codigo}, em ${quando(r.em)}${r.tipo === "ensaio" ? ", no ensaio" : ""}, ${r.comCredencialAtual ? "com a credencial atual" : "com uma credencial anterior"}.`;
}

const SEM_ENSAIO: Record<MotivoSemEnsaioBeds24, string> = {
  fora_da_producao: "O ensaio só roda no deploy de produção (aqui é prévia, computador ou teste): daqui, nada é escrito no Beds24.",
  nao_pronta: "Para o ensaio, falta a escrita de reservas pronta neste deploy: a chave BEDS24_ESCRITA_RESERVAS ligada e o refresh token.",
  pausa: "Com a pausa geral, o ensaio não roda: retome antes.",
  em_curso: "Um ensaio por vez: resolva o ensaio acima antes de criar outro.",
  sem_imovel: "Nenhum imóvel ativo tem um vínculo único e válido com um quarto do Beds24.",
};

/** As situações que pedem atenção: o contador leva à lista de reservas filtrada (desenho 6.5 e 8). */
const PEDEM_ATENCAO: readonly SituacaoAcompanhamentoBeds24[] = ["conflito", "divergente", "aguardando_equipe"];
const LINK_ATENCAO_BEDS24 = "/painel/reservas?beds24=atencao";

/** O ensaio em curso, o não resolvido ou o último (com o resultado), e os botões que valem para ele. */
function EnsaioAtual({ e }: { e: EnsaioNoPainel }) {
  const onde = `${e.imovel ? `imóvel ${e.imovel}` : "quarto sem vínculo com um imóvel"}, de ${dataBr(e.chegada)} a ${dataBr(e.saida)}${e.beds24Id ? `, reserva de teste ${e.beds24Id} no Beds24` : ""}`;
  const cancelar = e.podeCancelar && (
    <AcaoReservasBeds24
      acao="cancelar_ensaio"
      operacaoId={e.operacaoId}
      rotulo="Cancelar o ensaio"
      pergunta="Cancelar o ensaio? A reserva de teste passa a Cancelado no Beds24 (não é apagada), e as datas reabrem nas OTAs."
    />
  );
  const conferir = e.podeConferir ? (
    <AcaoReservasBeds24 acao="conferir_ensaio" operacaoId={e.operacaoId} rotulo="Conferir o ensaio" pergunta="Conferir o ensaio no Beds24? É só leitura: nada é escrito lá." />
  ) : e.conferirAPartirDe ? (
    <p role="note">Conferir o ensaio fica disponível a partir de {quando(e.conferirAPartirDe)} (5 minutos depois do envio: o Beds24 ainda pode gravar).</p>
  ) : null;
  const outraCredencial = !e.comCredencialAtual && (
    <p role="note">
      Este ensaio foi feito com outra credencial: o sistema não o cancela, e só o confere se a credencial de agora for da mesma conta do Beds24. Mude a reserva
      de teste para Cancelado no Beds24 (não apague) e use Conferir o ensaio.
    </p>
  );
  switch (e.fase) {
    case "em_andamento":
      return <p role="status">Ensaio em andamento ({onde}), desde {quando(e.iniciadoEm)}. Aguarde e atualize a página.</p>;
    case "criado":
      return (
        <>
          <p role="status">
            <strong>Ensaio criado</strong> ({onde}): confira no Beds24 e nas OTAs que as datas fecharam (cerca de 1 minuto); depois, Cancelar o ensaio. Se
            você mudou a reserva de teste para Cancelado direto no Beds24, use Conferir o ensaio.
          </p>
          {outraCredencial}
          {cancelar}
          {conferir}
        </>
      );
    case "nao_resolvido":
      return (
        <>
          <p role="alert" className={styles.alerta}>
            <strong>Ensaio criado e não cancelado: mude para Cancelado no Beds24 (não apague)</strong> e use Conferir o ensaio ({onde}).
            {e.erro ? ` ${e.erro}` : ""}
          </p>
          {outraCredencial}
          {cancelar}
          {conferir}
        </>
      );
    case "parado_antes_do_envio":
      return (
        <>
          <p role="note">O último ensaio parou antes do envio ({onde}): nada foi enviado ao Beds24. Conferir o ensaio o encerra (criar um ensaio novo também).</p>
          {conferir}
        </>
      );
    case "terminado":
      return (
        <p>
          Ensaio mais recente ({onde}{e.terminadoEm ? `, terminado em ${quando(e.terminadoEm)}` : ""}): {e.situacao === "conferida" ? "conferido e cancelado." : `não concluído.${e.erro ? ` ${e.erro}` : ""}`}
        </p>
      );
  }
}

export function ReservasSiteBeds24({ p }: { p: PainelReservasBeds24 }) {
  const acompanhadas = SITUACOES_ACOMPANHAMENTO_BEDS24.filter((s) => p.contadores[s] > 0);
  return (
    <section aria-label="Reservas do site no Beds24" style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <h2>Reservas do site no Beds24</h2>
      <p>
        O sistema cria, muda e cancela no Beds24 as reservas pagas pelo site (quarto, datas, pessoas e situação; nunca dados do hóspede nem valores), para o
        Airbnb e o Booking fecharem e abrirem as datas sozinhos. Isso só acontece no deploy de produção, com a chave BEDS24_ESCRITA_RESERVAS ligada, o refresh
        token, um ensaio conferido com a credencial atual e o imóvel ligado. Nas prévias e no computador, nada é escrito no Beds24.
      </p>
      {p.credencial.foraDaProducao && (
        <p role="alert" className={styles.alerta}>
          {TEXTO_CREDENCIAL_ESCRITA_FORA_DA_PRODUCAO}
        </p>
      )}
      <h3>Chave e ambiente</h3>
      <ul>
        <li>
          Chave BEDS24_ESCRITA_RESERVAS: <strong>{p.chave.ligada ? "ligada" : "desligada"}</strong>. Só o Diego liga, na Vercel, no ambiente Production, com o valor
          exato &quot;ligada&quot;; depois, Redeploy. Ela não depende da BEDS24_ESCRITA (calendário e preços), e o contrário também vale.
        </li>
        <li>
          Ambiente: <strong>{p.chave.ambienteDeProducao ? "deploy de produção" : "fora do deploy de produção"}</strong>.{" "}
          {p.chave.ambienteDeProducao ? "Só aqui a escrita de reservas pode sair." : "Aqui a escrita de reservas nunca sai, com qualquer chave: use Simular na ficha da reserva."}
        </li>
        <li>
          Credencial:{" "}
          <strong>{p.credencial.refreshToken ? "refresh token configurado" : p.credencial.soTokenDireto ? "só o token direto (BEDS24_API_KEY), que só lê" : "nenhuma"}</strong>.
          A escrita de reservas exige o refresh token de um convite com escrita de reservas.
          {p.ultimaRecusa ? textoDaRecusa(p.ultimaRecusa) : ""}
        </li>
        <li>
          Escrita de reservas: <strong>{p.chave.pronta ? "pronta neste ambiente" : "não pronta"}</strong> (deploy de produção, chave ligada e refresh token,
          tudo junto). Mesmo pronta, ela ainda depende da pausa, da prontidão e dos imóveis ligados abaixo.
        </li>
      </ul>
      <h3>Prontidão (só leitura)</h3>
      {p.motivoDeConfiguracao && (
        <p role="alert" className={styles.alerta}>
          Envio de reservas parado: {textoDaConfiguracaoDasReservas(p.motivoDeConfiguracao)}.
        </p>
      )}
      <ul>
        <li>
          Escopos da credencial: {textoDosEscoposGuardados(p.escopos)}. Lidos no Beds24 só no deploy de produção, com a escrita pronta (a rotina lê de novo a
          cada 23 horas): <ConferirEscoposBeds24 />
        </li>
        <li>Marca do SCL: {MARCA[p.marca]}.</li>
        <li>
          Último ensaio:{" "}
          {p.ensaio ? `${quando(p.ensaio.em)} · ${p.ensaio.valeParaCredencialAtual ? "com a credencial atual" : "com outra credencial: vale um ensaio novo"}` : "nenhum ainda"}.
        </li>
        <li>
          Importação automática do Beds24: <strong>{p.importacaoAutomatica ? "ligada" : "desligada"}</strong>. Não é requisito: o envio de reservas faz a própria
          conferência.
        </li>
      </ul>
      <h3>Pausa geral</h3>
      <p>
        {p.pausa ? (
          <>
            <strong>Pausado</strong>
            {p.pausa.em ? ` desde ${quando(p.pausa.em)}` : ""}
            {p.pausa.por ? ` por ${p.pausa.por}` : ""}: nenhuma reserva do site é criada, mudada ou cancelada no Beds24. O envio de calendário e preços
            não para com esta pausa: ele tem a própria chave (BEDS24_ESCRITA) e o próprio envio automático.
          </>
        ) : (
          "Sem pausa. A pausa vale na hora (tirar a variável da Vercel só vale depois de uma publicação nova) e para todo o envio das reservas do site, inclusive os cancelamentos. Ela não para o envio de calendário e preços, que tem a própria chave (BEDS24_ESCRITA) e o próprio envio automático."
        )}
      </p>
      {p.pausa ? (
        <AcaoReservasBeds24 acao="retomar" rotulo="Retomar" pergunta="Retirar a pausa geral do envio das reservas do site ao Beds24?" />
      ) : (
        <AcaoReservasBeds24
          acao="pausar"
          rotulo="Pausar as reservas do site"
          pergunta="Pausar o envio das reservas do site ao Beds24? Nenhuma reserva do site é criada, mudada ou cancelada lá até você retomar. O calendário e os preços não param com esta pausa."
        />
      )}
      <h3>Imóveis ligados</h3>
      <p>
        Só os imóveis ligados recebem reservas novas, e só as confirmadas a partir da ligação (as de antes ficam com a equipe, à mão). Desligar para só a
        criação: o que o sistema já criou continua sendo atualizado e cancelado.
      </p>
      {p.semLigar && <p role="note">{SEM_LIGAR[p.semLigar]}</p>}
      {p.imoveis.length ? (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Imóvel</th>
                <th>Quarto no Beds24</th>
                <th>Situação</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {p.imoveis.map((i) => (
                <tr key={i.id}>
                  <td>{i.codigo}</td>
                  <td>{i.quartoDoVinculo ?? "sem vínculo único e válido"}</td>
                  <td>
                    {i.ligadoEm ? `ligado desde ${quando(i.ligadoEm)}${i.ligadoPor ? ` por ${i.ligadoPor}` : ""}` : "desligado"}
                    {i.ativo ? "" : " · imóvel inativo (reative no cadastro antes de ligar de novo)"}
                  </td>
                  <td>
                    {i.ligadoEm ? (
                      <AcaoReservasBeds24 acao="desligar" imovelId={i.id} rotulo="Desligar" pergunta={`Desligar o imóvel ${i.codigo}? Nenhuma reserva nova dele vai ao Beds24.`} />
                    ) : !i.ativo ? null : (
                      <AcaoReservasBeds24
                        acao="ligar"
                        imovelId={i.id}
                        rotulo="Ligar"
                        desabilitado={p.semLigar !== null}
                        pergunta={`Ligar o imóvel ${i.codigo}? As reservas pagas pelo site confirmadas a partir de agora passam a ir ao Beds24.`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Nenhum imóvel ativo.</p>
      )}
      <h3>Ensaio (o primeiro teste real)</h3>
      <p>
        O ensaio cria no Beds24 uma reserva de teste (1 pessoa, sem hóspede, sem valor, com a marca SCL-ENSAIO), confere que ela volta com a marca e, quando você
        mandar, a cancela (muda para Cancelado; nunca apaga). Ele não cria reserva no SCL nem mexe no financeiro. Escolha um imóvel e datas sem procura: enquanto
        o ensaio existir, essas datas ficam fechadas nas OTAs. Depois de criar, confira no Beds24 e nas OTAs que as datas fecharam (cerca de 1 minuto); então,
        Cancelar o ensaio, e confira que elas reabriram. Só o ensaio conferido com a credencial atual libera Ligar.
      </p>
      {p.ensaioAtual && <EnsaioAtual e={p.ensaioAtual} />}
      {p.semEnsaio && <p role="note">{SEM_ENSAIO[p.semEnsaio]}</p>}
      <CriarEnsaioBeds24 imoveis={p.imoveis.filter((i) => i.ativo && i.quartoDoVinculo !== null).map((i) => ({ id: i.id, codigo: i.codigo }))} hoje={hojeISO()} desabilitado={p.semEnsaio !== null} />
      <h3>Reservas acompanhadas</h3>
      {acompanhadas.length ? (
        <ul>
          {acompanhadas.map((s) => (
            <li key={s}>
              {PEDEM_ATENCAO.includes(s) ? (
                <Link href={LINK_ATENCAO_BEDS24}>
                  {NOMES_SITUACAO_NO_BEDS24[s]}: {p.contadores[s]}
                </Link>
              ) : (
                <>
                  {NOMES_SITUACAO_NO_BEDS24[s]}: {p.contadores[s]}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>Nenhuma reserva acompanhada ainda.</p>
      )}
    </section>
  );
}
