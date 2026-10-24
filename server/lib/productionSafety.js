/** Shared, side-effect-free deployment guards. Never import config here. */
export const isProduction = (env = process.env) => env.NODE_ENV === 'production' || env.VERCEL === '1';

export function assertProductionSafety(env = process.env) {
  if (!isProduction(env)) return;
  const enabled = (key) => ['1', 'true', 'on', 'yes'].includes(String(env[key] ?? '').trim().toLowerCase());
  for (const key of ['OOTV2_ALLOW_TRUSTED_DEV', 'OOTV2_SANDBOX_ALLOW_WSL', 'OOTV2_ALLOW_LOCAL_ORIGIN',
    'OOTV2_ALLOW_ONLINE_UPLOAD']) {
    if (enabled(key)) throw Object.assign(new Error(`production_unsafe_config:${key}`), { code: 'production_unsafe_config' });
  }
  if (env.OOTV2_CAMPUS_SANDBOX === 'trusted-dev' || env.OOTV2_SANDBOX_SECCOMP === 'off') {
    throw Object.assign(new Error('production_unsafe_sandbox'), { code: 'production_unsafe_sandbox' });
  }
}