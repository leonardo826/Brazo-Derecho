-- Época guardada al quedar READY. Una época distinta no se trata como encendido.
ALTER TABLE "ComputerPower" ADD COLUMN "leaseEpoch" INTEGER NOT NULL DEFAULT 0;
