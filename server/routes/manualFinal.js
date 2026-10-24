/**
 * manualFinal.js (routes) — API Chung kết thủ công, CHỈ BTC/admin.
 *
 * - Toàn bộ router dùng `requireLocalAdmin`: đội/anonymous nhận 403 `admin_required`
 *   (không lộ đợt/trận/bài có tồn tại). CSRF + same-origin do `sharedRouter` áp trước.
 * - Không dùng cờ `OOTV2_ALLOW_ONLINE_UPLOAD`; cổng upload online của đội vẫn đóng.
 * - Không route nào chạy Python/git: upload chỉ nhận bytes + xếp job validate.
 */

import { Router } from 'express';

import { requireLocalAdmin } from '../shared/accounts.js';
import { acceptBotUpload } from '../middleware/upload.js';
import * as manualFinal from '../services/manualFinal.js';

export function manualFinalRouter() {
  const router = Router();
  router.use(requireLocalAdmin);

  router.get('/', async (req, res) => {
    res.json(await manualFinal.listEvents());
  });

  router.post('/', async (req, res) => {
    const body = req.body || {};
    res.status(201).json(await manualFinal.createEvent({
      name: body.name,
      level: body.level,
      roundNo: body.round_no,
      teamIds: body.team_ids,
      map: body.map,
      seed: body.seed,
      actor: req.account,
    }));
  });

  router.get('/:id', async (req, res) => {
    res.json(await manualFinal.getEvent(req.params.id));
  });

  router.post('/:id/status', async (req, res) => {
    res.json(await manualFinal.setEventStatus({
      eventId: req.params.id,
      target: req.body?.status,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
      actor: req.account,
    }));
  });

  router.post('/:id/close', async (req, res) => {
    res.json(await manualFinal.setEventStatus({
      eventId: req.params.id,
      target: 'closed',
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
      actor: req.account,
    }));
  });

  // Nạp một file `.py` UTF-8 (1..262144 bytes) cho đúng đội trong đợt.
  router.post('/:id/submissions', acceptBotUpload, async (req, res) => {
    const result = await manualFinal.uploadSubmission({
      eventId: req.params.id,
      teamId: req.body?.team_id,
      file: req.file,
      actor: req.account,
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  });

  router.get('/:id/submissions/:submissionId/source', async (req, res) => {
    const source = await manualFinal.sourceOfSubmission({
      eventId: req.params.id,
      submissionId: req.params.submissionId,
    });
    res.set('Content-Type', 'text/x-python; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="bot.py"');
    res.set('X-Source-Sha256', source.sha256);
    res.send(source.bytes);
  });

  router.post('/:id/submissions/:submissionId/select', async (req, res) => {
    res.json(await manualFinal.selectSubmission({
      eventId: req.params.id,
      submissionId: req.params.submissionId,
      actor: req.account,
    }));
  });

  router.post('/:id/lock', async (req, res) => {
    res.json(await manualFinal.lockSubmission({
      eventId: req.params.id,
      teamId: req.body?.team_id,
      actor: req.account,
    }));
  });

  router.post('/:id/matches', async (req, res) => {
    const result = await manualFinal.requestPair({
      eventId: req.params.id,
      redTeamId: req.body?.red_team_id,
      blueTeamId: req.body?.blue_team_id,
      seriesId: req.body?.series_id,
      gameNo: req.body?.game_no === undefined ? 1 : req.body.game_no,
      seed: req.body?.seed,
      note: typeof req.body?.note === 'string' ? req.body.note : null,
      actor: req.account,
    });
    res.status(result.pair.idempotent ? 200 : 202).json(result);
  });

  router.get('/:id/matches/:matchId/replay', async (req, res) => {
    res.json(await manualFinal.matchReplay({
      eventId: req.params.id,
      matchId: req.params.matchId,
    }));
  });

  router.post('/:id/matches/:matchId/cancel', async (req, res) => {
    res.json(await manualFinal.cancelMatch({
      eventId: req.params.id,
      matchId: req.params.matchId,
      reason: req.body?.reason,
      actor: req.account,
    }));
  });

  router.post('/:id/matches/:matchId/rerun', async (req, res) => {
    const result = await manualFinal.rerunMatch({
      eventId: req.params.id,
      matchId: req.params.matchId,
      reason: req.body?.reason,
      actor: req.account,
    });
    res.status(202).json(result);
  });

  return router;
}

export default manualFinalRouter;
