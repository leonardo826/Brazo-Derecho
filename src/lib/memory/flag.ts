type FlagEnv = {
  MEMORY_FEATURE_ENABLED?: string;
};

/** Solo la cadena exacta `true` enciende la memoria. Cualquier otro valor la deja apagada. */
export function memoryFeatureEnabled(env: FlagEnv = process.env as FlagEnv) {
  return env.MEMORY_FEATURE_ENABLED === "true";
}
