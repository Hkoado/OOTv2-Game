import config from '../../server/config.js';
import { request } from '../../server/shared/client.js';

const bucketName = 'ootv2-bots';
const limit = config.limits.maxSourceBytes;
const buckets = await request('/storage/v1/bucket');
const bucket = buckets.find((b) => b.id === bucketName);
if (bucket) {
  if (bucket.public) throw new Error('Bucket is public; review instead of overwriting.');
  if (Number(bucket.file_size_limit) === limit) {
    console.log(`Private bot bucket already configured (${limit} bytes).`);
  } else if (Number(bucket.file_size_limit) === 64 * 1024) {
    // Migration 64 KiB -> 256 KiB (profile `bot.v1`): chỉ nới hạn mức của bucket private,
    // không đổi quyền truy cập và không ghi đè file đang có.
    await request(`/storage/v1/bucket/${bucketName}`, { method: 'PUT', body: { id: bucketName, name: bucketName, public: false, file_size_limit: limit, allowed_mime_types: ['application/octet-stream'] } });
    console.log(`Raised private bot bucket limit ${64 * 1024} -> ${limit} bytes.`);
  } else {
    throw new Error(`Bucket file_size_limit=${bucket.file_size_limit} differs from ${limit}; review instead of overwriting.`);
  }
} else {
  await request('/storage/v1/bucket', { method: 'POST', body: { id: bucketName, name: bucketName, public: false, file_size_limit: limit, allowed_mime_types: ['application/octet-stream'] } });
  console.log(`Created private ootv2-bots bucket (${limit} bytes).`);
}