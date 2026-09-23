/** UUID completo (8-4-4-4-12 hexadecimais). Evita erro 500 do Postgres com ids malformados. */
export function uuidValido(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
