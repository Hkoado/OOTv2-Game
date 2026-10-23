/** Worker source storage adapter. No execution, submission acceptance or automatic deletion.
 * Failed/uncertain uploads may leave an orphan; never delete a possibly accepted artifact.
 */
import { createHash, randomUUID } from 'node:crypto';
import { downloadStorageArtifact, ArtifactDownloadError } from './artifactDownload.js';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function storeVerifiedSource(source, { sourceHash, signal, timeoutMs = 20000 } = {}) {
  if (!Buffer.isBuffer(source) || source.length < 1 || source.length > 262144
    || typeof sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(sourceHash)
    || digest(source) !== sourceHash) throw new ArtifactDownloadError('invalid_source');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000) {
    throw new ArtifactDownloadError('invalid_budget');
  }
  let origin;
  const credential = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const url = new URL(process.env.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || !credential) throw new Error();
    origin = url.origin;
  } catch { throw new ArtifactDownloadError('storage_configuration'); }
  if (signal?.aborted) throw new ArtifactDownloadError('upload_cancelled');
  const key = `${randomUUID()}.py`, bytes = Buffer.from(source);
  const controller = new AbortController();
  let stopError, rejectStop, response;
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  stopped.catch(() => {});
  const stop = (code) => {
    if (stopError) return;
    stopError = new ArtifactDownloadError(code); controller.abort(); rejectStop(stopError);
  };
  const onAbort = () => stop('upload_cancelled');
  const discard = (body) => { if (body && !body.locked) body.cancel().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop('upload_timeout'), timeoutMs);
  try {
    if (signal?.aborted) onAbort();
    if (stopError) throw stopError;
    const pending = fetch(`${origin}/storage/v1/object/ootv2-bots/${key}`, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { apikey: credential, Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/octet-stream', 'x-upsert': 'false' }, body: bytes,
    });
    Promise.resolve(pending).then((late) => { if (controller.signal.aborted) discard(late.body); }, () => {});
    response = await Promise.race([pending, stopped]);
    if (stopError) throw stopError;
    if (!response.ok || response.redirected) throw new ArtifactDownloadError('upload_rejected');
    // No response JSON is needed: do not buffer/log an unbounded or private upstream body.
    discard(response.body);
    const restored = await Promise.race([
      downloadStorageArtifact(key, { maxBytes: 262144, timeoutMs, signal: controller.signal }), stopped,
    ]);
    if (stopError) throw stopError;
    if (digest(restored) !== sourceHash || !restored.equals(bytes)) throw new ArtifactDownloadError('upload_integrity');
    return { storage_path: key, sha256: sourceHash };
  } catch (error) {
    if (stopError) throw stopError;
    if (error instanceof ArtifactDownloadError) throw error;
    throw new ArtifactDownloadError('upload_unavailable');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    controller.abort(); discard(response?.body);
  }
}