export type FlyEnv = {
  FLY_API_TOKEN?: string;
  FLY_DRY_RUN?: string;
  FLY_ORG?: string;
  FLY_REGION?: string;
  FLY_IMAGE?: string;
  [key: string]: string | undefined;
};

export type ProvisionPlan = {
  appName: string;
  region: string;
  org: string;
  image: string;
  volume: { name: string; sizeGb: number; encrypted: boolean; path: string };
  guest: { cpu_kind: "shared"; cpus: number; memory_mb: number };
  autostop: false;
  agentUrl: string;
};

const FLY_API = "https://api.machines.dev/v1";

export function flyCallsAllowed(env: FlyEnv) {
  return env.FLY_DRY_RUN?.trim() === "false" && (env.FLY_API_TOKEN?.trim().length ?? 0) > 0;
}

export function cliWillCallFly(env: FlyEnv, argv: string[]) {
  return flyCallsAllowed(env) && argv.includes("--confirmo-gasto");
}

export function appNameForClient(clientId: string) {
  const slug = clientId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  if (slug.length < 4) throw new Error("El id del cliente no alcanza para nombrar la app.");
  return `iabot-desk-${slug}`;
}

export function planProvision(input: { clientId: string; env: FlyEnv }): ProvisionPlan {
  const region = /^[a-z]{3}$/.test(input.env.FLY_REGION?.trim() ?? "") ? input.env.FLY_REGION!.trim() : "gru";
  const appName = appNameForClient(input.clientId.trim());
  return {
    appName,
    region,
    org: (input.env.FLY_ORG ?? "").trim().slice(0, 40),
    image: input.env.FLY_IMAGE?.trim() || "registry.fly.io/iabot-desktop:phase0",
    volume: { name: "chrome_profile", sizeGb: 5, encrypted: true, path: "/data" },
    guest: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
    autostop: false,
    agentUrl: `http://${appName}.internal:8787`,
  };
}

export function flyRequests(plan: ProvisionPlan, volumeId = "VOLUME_ID") {
  const appBody: { app_name: string; org_slug?: string } = { app_name: plan.appName };
  if (plan.org) appBody.org_slug = plan.org;
  return [
    { method: "POST" as const, url: `${FLY_API}/apps`, body: appBody },
    {
      method: "POST" as const,
      url: `${FLY_API}/apps/${plan.appName}/volumes`,
      body: { name: plan.volume.name, region: plan.region, size_gb: plan.volume.sizeGb, encrypted: true },
    },
    {
      method: "POST" as const,
      url: `${FLY_API}/apps/${plan.appName}/machines`,
      body: {
        name: "desktop",
        region: plan.region,
        config: {
          image: plan.image,
          env: { XAI_MODE: "mock", DISPLAY: ":99", CHROME_PROFILE: "/data/chrome-profile" },
          guest: plan.guest,
          mounts: [{ volume: volumeId, path: "/data" }],
          restart: { policy: "always" },
          auto_destroy: false,
        },
      },
    },
  ];
}

async function postJson(fetchImpl: typeof fetch, url: string, token: string, body: unknown) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Fly respondió ${response.status}`);
  return text ? (JSON.parse(text) as { id?: string }) : {};
}

export async function provisionClient(input: { clientId: string; env: FlyEnv; fetchImpl?: typeof fetch }) {
  const plan = planProvision(input);
  if (!flyCallsAllowed(input.env)) return { ok: true as const, dryRun: true, called: false, plan };
  const token = input.env.FLY_API_TOKEN!.trim();
  const fetchImpl = input.fetchImpl ?? fetch;
  const requests = flyRequests(plan);
  await postJson(fetchImpl, requests[0].url, token, requests[0].body);
  const volume = await postJson(fetchImpl, requests[1].url, token, requests[1].body);
  const volumeId = volume.id || "";
  if (!volumeId) throw new Error("Fly no entregó el id del volumen");
  const machineBody = flyRequests(plan, volumeId)[2].body;
  const machine = await postJson(fetchImpl, requests[2].url, token, machineBody);
  return {
    ok: true as const,
    dryRun: false,
    called: true,
    plan,
    appName: plan.appName,
    volumeId,
    machineId: machine.id || "",
  };
}
