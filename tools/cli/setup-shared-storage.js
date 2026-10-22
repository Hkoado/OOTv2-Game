import { request } from '../../server/shared/client.js';

const buckets = await request('/storage/v1/bucket');
const bucket = buckets.find((b) => b.id === 'ootv2-bots');
if (bucket) {
  if (bucket.public || Number(bucket.file_size_limit) !== 65536) throw new Error('Bucket configuration differs; review instead of overwriting.');
  console.log('Private bot bucket already configured.');
} else {
  await request('/storage/v1/bucket', { method: 'POST', body: { id: 'ootv2-bots', name: 'ootv2-bots', public: false, file_size_limit: 65536, allowed_mime_types: ['application/octet-stream'] } });
  console.log('Created private ootv2-bots bucket (64 KiB MVP).');
}