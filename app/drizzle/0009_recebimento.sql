CREATE TYPE "public"."recebimento_reserva" AS ENUM('split', 'empresa');--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "recebimento" "recebimento_reserva";