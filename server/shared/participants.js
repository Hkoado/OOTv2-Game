import { randomUUID } from 'node:crypto';
import { rows, insert, uuid } from './client.js';
import { temporaryBot, hashBuffer, uploadArtifact } from './artifacts.js';
import { normalizeParticipantName } from '../lib/names.js';
import { validateBotFile } from '../services/botValidation.js';
import { HttpError } from '../lib/httpError.js';
import config from '../config.js';

export async function createParticipant(raw) {
  const name=normalizeParticipantName(raw);
  const [row]=await insert('participants',{id:randomUUID(),name,name_key:name.toLocaleLowerCase('en-US'),created_at:new Date().toISOString()});
  return {id:row.id,name:row.name,created_at:row.created_at};
}
const safe = ({id,participant_id,sha256,status,validation_error,created_at})=>({id,participant_id,sha256,status,validation_error,created_at});
export async function listParticipants() {
  const [teams,submissions]=await Promise.all([rows('participants','order=created_at,id'),rows('submissions','order=created_at.desc,id.desc')]);
  return teams.map((t)=>({id:t.id,name:t.name,created_at:t.created_at,latest_submission:submissions.find((s)=>s.participant_id===t.id)?safe(submissions.find((s)=>s.participant_id===t.id)):null,latest_valid_submission_id:submissions.find((s)=>s.participant_id===t.id&&s.status==='valid')?.id||null}));
}
export async function listSubmissions(id) {
  uuid(id);
  if (!(await rows('participants',`id=eq.${id}`)).length) throw new HttpError(404,'participant_not_found','Không tìm thấy đội.');
  return (await rows('submissions',`participant_id=eq.${id}&order=created_at.desc,id.desc`)).map(safe);
}
export async function createSubmission(id,upload) {
  uuid(id);
  if (!(await rows('participants',`id=eq.${id}`)).length) throw new HttpError(404,'participant_not_found','Không tìm thấy đội.');
  if (!Buffer.isBuffer(upload?.buffer)||upload.buffer.length>config.limits.maxSourceBytes) throw new HttpError(400,'bad_file',`Thiếu file hoặc quá ${config.limits.maxSourceBytes/1024} KiB.`);
  const local=temporaryBot(upload.buffer),submissionId=randomUUID();let validation;
  try {validation=await validateBotFile(local.file);} finally {local.cleanup();}
  // Source is private and available to all trusted workers, never a local path.
  const storage_path=validation.ok?await uploadArtifact(submissionId,upload.buffer):`${submissionId}.py`;
  const [row]=await insert('submissions',{id:submissionId,participant_id:id,storage_path,sha256:hashBuffer(upload.buffer),status:validation.ok?'valid':'invalid',validation_error:validation.ok?null:`${validation.error}: ${validation.message}`.slice(0,500),created_at:new Date().toISOString()});
  return safe(row);
}