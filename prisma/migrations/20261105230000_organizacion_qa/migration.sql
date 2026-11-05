-- Cuenta de prueba interna. Las empresas existentes quedan como clientes reales.
ALTER TABLE "Organization" ADD COLUMN "isQa" BOOLEAN NOT NULL DEFAULT false;
