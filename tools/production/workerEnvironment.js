/** Separate allowlist: never transfer DDL credentials or browser settings to the judge. */
export function workerEnvironment(env) {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const allowed = [...required, 'OOTV2_GITHUB_TOKEN'];
  if (required.some((key) => typeof env[key] !== 'string' || !env[key].trim())) throw new Error('required_worker_credentials_missing');
  return allowed.filter((key) => env[key]).map((key) => {
    if (/[\r\n\0]/.test(env[key])) throw new Error('invalid_worker_environment');
    // Node .env parser supports double quoted values. Token/URL allowlist needs no escapes.
    if (!/^[A-Za-z0-9_:/?@.+=%&~-]+$/.test(env[key])) throw new Error('invalid_worker_environment');
    return `${key}=${env[key]}\n`;
  }).join('');
}