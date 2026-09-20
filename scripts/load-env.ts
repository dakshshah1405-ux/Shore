// Loads .env.local when running locally. On CI the file doesn't exist and the variables come from
// the environment instead — loadEnvFile throws ENOENT in that case, so the miss is ignored.
try {
  process.loadEnvFile?.('.env.local');
} catch {
  // no .env.local: expected in CI
}
