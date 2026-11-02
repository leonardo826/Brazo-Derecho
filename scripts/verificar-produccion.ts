import { readFileSync } from "node:fs";
import { codigoSalida, formatearInforme, leerAppUrl, resolverCli, TEXTO_AYUDA, verificarProduccion } from "../src/lib/verificar-produccion";

function appUrl() {
  const directa = process.env.APP_URL?.trim();
  if (directa) return directa;
  try {
    return leerAppUrl(readFileSync(".env", "utf8"));
  } catch {
    return undefined;
  }
}

const cli = resolverCli(process.argv.slice(2), appUrl());

if (cli.tipo === "ayuda") {
  console.log(TEXTO_AYUDA);
  process.exit(0);
}

if (cli.tipo === "error") {
  console.error(cli.mensaje);
  process.exit(2);
}

void verificarProduccion(cli.url)
  .then((chequeos) => {
    console.log(formatearInforme(cli.url, chequeos));
    process.exit(codigoSalida(chequeos));
  })
  .catch(() => {
    console.error("El chequeo se interrumpió antes de terminar.");
    process.exit(1);
  });
