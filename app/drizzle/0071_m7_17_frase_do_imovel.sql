-- M7.17 (frase de abertura de cada casa, editável na ficha do imóvel). Idempotente como a 0067 a 0070: o banco das
-- prévias é compartilhado e as migrações entram por hash, então rodar esta instrução de novo não pode falhar nem mudar
-- nada. Os imóveis que já existem ficam com a frase vazia (nada aparece no site): nenhum texto é preenchido sozinho.
ALTER TABLE "imoveis" ADD COLUMN IF NOT EXISTS "frase" text DEFAULT '' NOT NULL;
