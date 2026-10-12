/**
 * Routes đội tham gia + submission bot.
 * Không bao giờ trả `storage_path`, nội dung source hay stderr thô ra client.
 */

import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/httpError.js';
import { acceptBotUpload } from '../middleware/upload.js';
import {
  createParticipant,
  createSubmission,
  listParticipants,
  listSubmissions,
} from '../services/participants.js';

const router = Router();

/** Bỏ các trường nội bộ trước khi gửi ra ngoài. */
function toSubmissionView(row) {
  return {
    id: row.id,
    participant_id: row.participant_id,
    sha256: row.sha256,
    status: row.status,
    validation_error: row.validation_error || null,
    created_at: row.created_at,
  };
}

router.get('/', (req, res) => {
  res.json({ participants: listParticipants() });
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (body.name === undefined) {
      throw badRequest('missing_name', 'Thiếu trường `name`');
    }
    const participant = createParticipant(body.name);
    res.status(201).json(participant);
  })
);

router.get(
  '/:id/submissions',
  asyncHandler(async (req, res) => {
    res.json({ submissions: listSubmissions(req.params.id).map(toSubmissionView) });
  })
);

router.post(
  '/:id/submissions',
  acceptBotUpload,
  asyncHandler(async (req, res) => {
    const submission = await createSubmission(req.params.id, req.file);
    res.status(201).json(toSubmissionView(submission));
  })
);

export default router;
