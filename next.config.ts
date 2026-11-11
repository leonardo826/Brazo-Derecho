import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import { securityHeaders } from "@/lib/security-headers";

function buildCommit() {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  if (/^[0-9a-f]{7,40}$/i.test(fromVercel)) return fromVercel.slice(0, 7).toLowerCase();
  try {
    const sha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
    if (/^[0-9a-f]{7}$/i.test(sha)) return sha.toLowerCase();
  } catch {
    // El build no tiene git. El health dirá desconocido si tampoco hay SHA de Vercel.
  }
  return "desconocido";
}

const nextConfig: NextConfig = {
  env: {
    BRAZO_BUILD_COMMIT: buildCommit(),
  },
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(),
      },
      {
        source: "/panel",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/panel/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
