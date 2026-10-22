import type { LinhaHistorico } from "@/auditoria/auditoria";
import { dataHoraNoFuso } from "@/lib/datas";
import { ALVOS_VINCULO, type AlvoVinculo, ROTULO_GENERICO_DO_ALVO } from "@/whatsapp/regras";

const ROTULOS: Record<string, string> = {
  codigo: "Código",
  nome: "Nome",
  publico: "No site",
  ativo: "Em operação",
  bairro: "Bairro",
  cidade: "Cidade",
  endereco: "Endereço",
  fuso: "Fuso",
  capacidade: "Capacidade",
  quartos: "Quartos",
  banheiros: "Banheiros",
  descricao: "Descrição",
  // M7.17: o mesmo nome do campo na ficha do imóvel.
  frase: "Frase de abertura (site)",
  tipo: "Tipo",
  documento: "CPF/CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  chavePix: "Chave Pix",
  observacoes: "Observações",
  imoveis: "Imóveis",
  representante: "Representante",
  contrato: "Contrato",
  idExterno: "Canal",
  estado: "Situação",
  checkin: "Entrada",
  checkout: "Saída",
  hospedes: "Hóspedes",
  hospedeNome: "Hóspede",
  valorBruto: "Valor bruto (centavos)",
  taxaCanal: "Taxa do canal (centavos)",
  valorLiquido: "Líquido (centavos)",
  recebimento: "Quem recebe do canal",
  // M8.2d: a alteração de reserva paga pelo site.
  alteracao: "Alteração",
  diferenca: "Diferença (centavos)",
  // M8.2c, M8.2d e M8.3: as marcas das OTAs e o registro no Beds24.
  otaLiberadaEm: "Datas reabertas nas OTAs",
  otaAtualizadaEm: "Bloqueio mudado nas OTAs",
  otaFechadaEm: "Datas fechadas nas OTAs",
  situacaoNoBeds24: "Situação no Beds24",
  beds24Id: "Id no Beds24",
  // M8.3c: a escrita real das reservas do site no Beds24 e os botões da ficha.
  motivoNoBeds24: "Motivo no Beds24",
  otaFechadaPeloSistema: "Datas fechadas nas OTAs pelo sistema",
  operacao: "Envio ao Beds24",
  operacoesSuperadas: "Envios na fila superados",
  // M10.1a: o vínculo da conversa do WhatsApp (só "tipo:id", sem nome), a situação da conta e a configuração.
  vinculo: "Vínculo",
  situacao: "Situação",
  motivo: "Motivo",
  quemVeConversas: "Quem vê as conversas",
  wabaId: "Id da conta (WABA)",
  numeroId: "Id do número",
};

const ACOES: Record<string, string> = {
  "imovel.criar": "criou",
  "imovel.editar": "alterou",
  "proprietario.criar": "cadastrou",
  "proprietario.editar": "alterou",
  "proprietario.imoveis": "alterou os imóveis",
  "proprietario.representante.adicionar": "adicionou representante",
  "proprietario.representante.remover": "removeu representante",
  "contrato.criar": "adicionou contrato",
  "contrato.encerrar": "encerrou contrato",
  "idexterno.adicionar": "ligou canal",
  "idexterno.remover": "desligou canal",
  "reserva.criar": "lançou a reserva",
  "reserva.importar": "importou a reserva",
  "reserva.sincronizar": "atualizou pela sincronização",
  "reserva.cancelar": "cancelou a reserva",
  "reserva.alterar": "alterou a reserva (alteração da reserva paga pelo site)",
  "bloqueio.criar": "bloqueou datas",
  "bloqueio.remover": "removeu o bloqueio",
  "configuracao.calendario_regras": "alterou calendário e preços",
  "beds24.sincronizar": "importou do Beds24",
  "beds24.enviar": "enviou calendário e preços ao Beds24",
  // M3.11a: a importação dos preços do Beds24 para o SCL (nada muda nas OTAs).
  "imovel.precos.importar": "importou os preços do Beds24",
  "imovel.precos.desfazer_importacao": "desfez a importação dos preços do Beds24",
  "reserva.ota_liberada": "marcou as datas reabertas nas OTAs",
  "alteracao.ota_atualizada": "marcou o bloqueio mudado nas OTAs",
  "beds24.reserva.ota_fechada": "marcou as datas fechadas nas OTAs",
  "beds24.reserva.ota_reaberta": "marcou as datas reabertas nas OTAs",
  "beds24.reserva.adotar": "ligou a reserva ao registro do Beds24",
  // M8.3c: a escrita real (o autor nulo é o sistema) e os botões da ficha (o autor é quem apertou).
  "beds24.reserva.criar": "criou a reserva no Beds24",
  "beds24.reserva.atualizar": "atualizou a reserva no Beds24",
  "beds24.reserva.cancelar": "cancelou a reserva no Beds24",
  "beds24.reserva.encerrar": "encerrou o acompanhamento no Beds24",
  "beds24.reserva.conferir": "conferiu a reserva no Beds24",
  "beds24.reserva.tentar_de_novo": "pediu de novo o envio ao Beds24",
  "beds24.reserva.deixar_a_mao": "deixou a reserva à mão no Beds24",
  "beds24.reserva.reenviar": "reenviou ao Beds24 o que está no SCL",
  "beds24.reserva.nao_existe": "confirmou que a reserva não existe no Beds24",
  "beds24.reserva.passar_ao_sistema": "passou a reserva ao sistema no Beds24",
  // M10.1a: verbos, como os outros ("{autor} {ação}"). Só o da conversa tem tela de histórico (a página da conversa); os
  // da configuração e da conta ficam para a leitura da auditoria.
  "configuracao.whatsapp": "alterou a configuração do WhatsApp",
  "whatsapp.conversa.vincular": "vinculou a conversa do WhatsApp",
  "whatsapp.conversa.desvincular": "desfez o vínculo da conversa do WhatsApp",
  "whatsapp.conta.situacao": "mudou a situação da conta do WhatsApp",
};

/** Um instante gravado com `toISOString()` ou com o deslocamento do fuso, também no meio do texto ("COT-1 até <ISO>"). */
const INSTANTE_ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g;

/**
 * O valor de um campo para pessoas (M7.22), também nos registros antigos, sem mexer no que está gravado: os instantes ISO
 * ("2026-10-16T18:05:00.000Z", em UTC) saem como "16/10/2026 às 15:05", no horário de Brasília, e as datas "AAAA-MM-DD"
 * soltas no texto, em dd/mm/aaaa. Os UUID ficam como estão.
 */
function valor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "sim";
  if (v === false) return "não";
  if (Array.isArray(v)) return v.length ? `${v.length} item(ns)` : "nenhum";
  const t = String(v)
    .replace(INSTANTE_ISO, (m) => {
      const d = new Date(m);
      return Number.isNaN(d.getTime()) ? m : dataHoraNoFuso(d);
    })
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1");
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

/**
 * M10.1a: o vínculo da conversa do WhatsApp é gravado como "tipo:id" (sem nome); na tela sai só o tipo ("uma reserva"),
 * nunca o id, que é texto técnico e, com as conversas liberadas à operação, apontaria um cadastro que ela não lê.
 */
function valorDoCampo(campo: string, v: unknown): string {
  if (campo !== "vinculo" || typeof v !== "string") return valor(v);
  const tipo = v.split(":")[0];
  return (ALVOS_VINCULO as readonly string[]).includes(tipo) ? ROTULO_GENERICO_DO_ALVO[tipo as AlvoVinculo].rotulo : "—";
}

export function HistoricoAlteracoes({ linhas }: { linhas: LinhaHistorico[] }) {
  return (
    <section aria-label="Histórico de alterações" style={{ maxWidth: 820 }}>
      <h2 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Histórico</h2>
      {linhas.length === 0 ? (
        <p style={{ color: "var(--scl-texto-2)" }}>Sem alterações registradas.</p>
      ) : (
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {linhas.map((l) => (
            <li key={l.id} style={{ fontSize: "0.875rem", borderLeft: "3px solid var(--scl-areia)", paddingLeft: 10 }}>
              <strong>{l.autor ?? "Sistema"}</strong> {ACOES[l.acao] ?? l.acao} · {dataHoraNoFuso(l.criadoEm)}
              {/* A criação e a importação de uma reserva trazem o registro inteiro; a dos preços (M3.11a), só noites e intervalo. */}
              {(!/\.(criar|importar)$/.test(l.acao) || l.acao === "imovel.precos.importar") && (
                <ul style={{ listStyle: "none", color: "var(--scl-texto-2)" }}>
                  {Object.entries(l.mudancas).map(([campo, [antes, depois]]) => (
                    <li key={campo}>
                      {ROTULOS[campo] ?? campo}: {valorDoCampo(campo, antes)} → {valorDoCampo(campo, depois)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
