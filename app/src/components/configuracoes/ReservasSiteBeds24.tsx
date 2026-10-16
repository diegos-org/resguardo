/**
 * Integrações → "Reservas do site no Beds24" (M8.3a, desenho 2.3, 7 e 8): a chave e o ambiente, a credencial, a
 * prontidão (só leitura), a pausa geral, os imóveis ligados (D6) e os contadores por situação. Nada aqui escreve no
 * Beds24: a escrita é o M8.3c. Os dados vêm de `painelReservasBeds24` (códigos); os textos ficam aqui.
 */
import type { MarcaLegivelBeds24, MotivoSemLigarBeds24, PainelReservasBeds24 } from "@/beds24/reservas-site-painel";
import { SITUACOES_ACOMPANHAMENTO_BEDS24 } from "@/beds24/reservas-site-regras";
import styles from "@/components/formularios.module.css";
import { NOMES_SITUACAO_NO_BEDS24 } from "@/components/reservas/ReservaNoBeds24";
import { TEXTO_CREDENCIAL_ESCRITA_FORA_DA_PRODUCAO } from "@/sistema/servicos";
import { AcaoReservasBeds24, ConferirEscoposBeds24 } from "./AcaoReservasBeds24";

const FUSO = "America/Sao_Paulo";
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" });

const MARCA: Record<MarcaLegivelBeds24, string> = {
  provada_no_ensaio: "legível: o último ensaio, com a credencial atual, leu a marca de volta",
  ilegivel: "não legível: uma reserva do sistema voltou sem a marca do SCL; as criações ficam paradas",
  nao_conferida: "ainda não conferida: só o ensaio com a credencial atual prova",
};
const SEM_LIGAR: Record<MotivoSemLigarBeds24, string> = {
  sem_credencial: "Para ligar um imóvel, falta a credencial do Beds24.",
  sem_ensaio: "Para ligar um imóvel, falta um ensaio conferido com a credencial atual. O ensaio chega com a escrita de reservas (M8.3c): até lá, nenhum imóvel liga.",
};

export function ReservasSiteBeds24({ p }: { p: PainelReservasBeds24 }) {
  const acompanhadas = SITUACOES_ACOMPANHAMENTO_BEDS24.filter((s) => p.contadores[s] > 0);
  return (
    <section aria-label="Reservas do site no Beds24" style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <h2>Reservas do site no Beds24</h2>
      <p>
        Quando a escrita de reservas for ligada, o sistema cria, muda e cancela no Beds24 as reservas pagas pelo site (quarto, datas, pessoas e situação; nunca
        dados do hóspede nem valores), para o Airbnb e o Booking fecharem e abrirem as datas sozinhos. Por enquanto nada é escrito: esta parte só mostra a
        situação e prepara.
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
        </li>
        <li>
          Escrita de reservas: <strong>{p.chave.pronta ? "pronta neste ambiente" : "não pronta"}</strong> (deploy de produção, chave ligada e refresh token,
          tudo junto). Mesmo pronta, ela ainda depende da pausa, da prontidão e dos imóveis ligados abaixo.
        </li>
      </ul>
      <h3>Prontidão (só leitura)</h3>
      <ul>
        <li>
          Escopos da credencial (lidos no Beds24 só no deploy de produção, com a escrita pronta): <ConferirEscoposBeds24 />
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
            {p.pausa.por ? ` por ${p.pausa.por}` : ""}: nada é escrito no Beds24, nem cancelamentos.
          </>
        ) : (
          "Sem pausa. A pausa vale na hora (tirar a variável da Vercel só vale depois de uma publicação nova) e para tudo, inclusive os cancelamentos."
        )}
      </p>
      {p.pausa ? (
        <AcaoReservasBeds24 acao="retomar" rotulo="Retomar" pergunta="Retirar a pausa geral do envio das reservas do site ao Beds24?" />
      ) : (
        <AcaoReservasBeds24 acao="pausar" rotulo="Pausar tudo" pergunta="Pausar o envio das reservas do site ao Beds24? Nada é escrito lá, nem cancelamentos, até você retomar." />
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
      <h3>Reservas acompanhadas</h3>
      {acompanhadas.length ? (
        <ul>
          {acompanhadas.map((s) => (
            <li key={s}>
              {NOMES_SITUACAO_NO_BEDS24[s]}: {p.contadores[s]}
            </li>
          ))}
        </ul>
      ) : (
        <p>Nenhuma reserva acompanhada ainda.</p>
      )}
    </section>
  );
}
