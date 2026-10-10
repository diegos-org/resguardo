/** Noites ocupadas de um apartamento do site (M7.6), para o calendário da consulta: só datas (`responderOcupacao`). */
import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { responderOcupacao } from "@/site/ocupacao";
import { organizacaoDoSite } from "@/site/site";

export async function GET(req: NextRequest) {
  const db = getDb();
  return responderOcupacao(db, await organizacaoDoSite(db), req.nextUrl.searchParams);
}
