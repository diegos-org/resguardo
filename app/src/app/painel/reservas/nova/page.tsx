import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormReserva } from "@/components/reservas/FormReserva";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { salvarNovaReserva } from "@/reservas/acoes";

export default async function NovaReserva() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "reserva:editar")) redirect("/painel/reservas");
  const imoveis = await listarImoveis(getDb(), sessao.organizacaoId);
  return (
    <>
      <h1>Nova reserva</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820 }}>
        Para reservas fechadas diretamente (WhatsApp, indicação) ou enquanto o Beds24 não está ligado. Reservas do Airbnb e do Booking
        virão automaticamente pela sincronização.
      </p>
      <FormReserva acao={salvarNovaReserva} imoveis={imoveis} comValores={podeFazer(sessao.papel, "financeiro:editar")} />
    </>
  );
}
