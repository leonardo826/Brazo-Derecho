function shortSha(value: string | undefined) {
  const match = /^([0-9a-f]{7,40})$/i.exec((value ?? "").trim());
  return match ? match[1].slice(0, 7).toLowerCase() : "";
}

type CommitEnv = {
  VERCEL_GIT_COMMIT_SHA?: string;
  BRAZO_BUILD_COMMIT?: string;
};

export function publicCommit(env: CommitEnv = process.env as CommitEnv) {
  return shortSha(env.VERCEL_GIT_COMMIT_SHA) || shortSha(env.BRAZO_BUILD_COMMIT) || "desconocido";
}
