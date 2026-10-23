/** Private Storage transport only. Never accepts a client-supplied URL or bucket. */
import { HttpError } from '../lib/httpError.js';

export class ArtifactDownloadError extends Error {
  constructor(code) {
    super(`Artifact integrity/download failure: ${code}`);
    this.name = 'ArtifactDownloadError';
    this.code = code;
  }
}

/** Bound retained memory and cancel as soon as declared or actual size exceeds budget.
 * The deadline races both fetch and every read, including a peer that stops sending.
 * Error bodies are not parsed/logged: upstream text may contain credentials/source.
 */
export async function downloadStorageArtifact(key, { maxBytes, timeoutMs = 20000, signal } = {}) {
  if (typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.py$/.test(key)) {
    throw new ArtifactDownloadError('invalid_key');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000) {
    throw new ArtifactDownloadError('invalid_budget');
  }
  let origin;
  const credential = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const url = new URL(process.env.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || !credential) throw new Error();
    origin = url.origin;
  } catch { throw new ArtifactDownloadError('storage_configuration'); }

  const controller = new AbortController();
  let timer, reader, response, rejectStop, stopError;
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  // A caller may already be aborted before fetch starts.
  const cancel = (code) => {
    if (controller.signal.aborted) return;
    stopError = new ArtifactDownloadError(code);
    controller.abort();
    rejectStop(stopError);
  };
  const onAbort = () => cancel('download_cancelled');
  const race = (operation) => Promise.race([operation, stopped]);
  const discard = (body) => {
    if (!body || body.locked) return;
    body.cancel().catch(() => {});
  };
  try {
    if (signal?.aborted) throw new ArtifactDownloadError('download_cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => cancel('download_timeout'), timeoutMs);
    const pending = fetch(`${origin}/storage/v1/object/ootv2-bots/${key}`, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { apikey: credential, Authorization: `Bearer ${credential}` },
    });
    // A transport/mock that ignores AbortSignal must not leak a late response body.
    pending.then((late) => { if (controller.signal.aborted) discard(late.body); }, () => {});
    response = await race(pending);
    if (stopError) throw stopError;
    if (!response.ok || response.redirected) {
      if (response.status === 429 || response.status >= 500) throw new ArtifactDownloadError('storage_unavailable');
      throw new ArtifactDownloadError('storage_rejected');
    }
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)) {
      throw new ArtifactDownloadError('source_size_limit');
    }
    if (!response.body) throw new ArtifactDownloadError('empty_source');
    reader = response.body.getReader();
    const output = Buffer.allocUnsafe(maxBytes); let total = 0;
    while (true) {
      const { done, value } = await race(reader.read());
      if (stopError) throw stopError;
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new ArtifactDownloadError('invalid_stream');
      if (value.byteLength > maxBytes - total) throw new ArtifactDownloadError('source_size_limit');
      // Fixed allocation avoids unbounded per-chunk metadata for tiny/empty chunks.
      output.set(value, total);
      total += value.byteLength;
    }
    if (total === 0) throw new ArtifactDownloadError('empty_source');
    if (length !== null && Number(length) !== total) throw new ArtifactDownloadError('source_size_mismatch');
    return Buffer.from(output.subarray(0, total));
  } catch (error) {
    if (stopError) throw stopError;
    if (error instanceof ArtifactDownloadError) throw error;
    // Keep the established shared-worker HTTP category without upstream details.
    throw new HttpError(503, 'artifact_unavailable', 'Không tải được artifact. Giữ bài hợp lệ cũ và thử lại.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    controller.abort();
    if (reader) {
      // Do not await a hostile/broken underlying cancel() forever.
      reader.cancel().catch(() => {});
    } else discard(response?.body);
  }
}