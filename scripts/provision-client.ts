import { pathToFileURL } from "node:url";
import { cliWillCallFly, planProvision, provisionClient } from "../src/lib/computer/provision";

const HELP = `Arma el plan de un computador Fly para un cliente. Por defecto no llama a Fly y no cobra.

Uso:
  npx tsx scripts/provision-client.ts --client <organizationId>

Solo llama a la Machines API si se cumplen las tres:
  FLY_DRY_RUN=false
  FLY_API_TOKEN con valor
  y el flag --confirmo-gasto

Sin eso imprime el plan y termina. No corras fly apps create.`;

function readClient(argv: string[]) {
  const index = argv.indexOf("--client");
  if (index >= 0) return argv[index + 1] ?? "";
  return "";
}

export async function main(argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const clientId = readClient(argv);
  if (!clientId) {
    console.error("Falta --client con el id de la organización.");
    return 2;
  }
  let plan;
  try {
    plan = planProvision({ clientId, env });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "No pude armar el plan.");
    return 2;
  }
  if (!cliWillCallFly(env, argv)) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          llamoAFly: false,
          token: env.FLY_API_TOKEN?.trim() ? "presente" : "falta",
          aviso:
            "No llamé a Fly. No se creó ninguna app y no hay cobro. El computador de producción parte cuando Leonardo cargue las claves y confirme el gasto.",
          plan,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  try {
    const result = await provisionClient({ clientId, env });
    console.log(JSON.stringify({ dryRun: false, llamoAFly: result.called, app: plan.appName, volumeId: "volumeId" in result ? result.volumeId : "", machineId: "machineId" in result ? result.machineId : "" }, null, 2));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Fly no completó el alta.");
    return 1;
  }
}

const direct = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (direct) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
