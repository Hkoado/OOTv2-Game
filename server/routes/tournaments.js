/**
 * Routes giải đấu: tạo/start (cần `x-admin-key`), standings, bracket, matches.
 * Toàn bộ tính toán nằm trong services/tournaments.js (SQLite aggregate).
 */

import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/httpError.js';
import { requireAdminKey } from '../middleware/adminKey.js';
import {
  computeBracket,
  computeStandings,
  createTournament,
  getTournament,
  listMatches,
  listTournaments,
  startTournament,
} from '../services/tournaments.js';

const STAGES = ['group', 'semifinal', 'final'];

const router = Router();

router.get('/', (req, res) => {
  res.json({ tournaments: listTournaments() });
});

router.post(
  '/',
  requireAdminKey,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const tournament = createTournament({
      name: body.name,
      participantIds: body.participantIds,
    });
    res.status(201).json(tournament);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(getTournament(req.params.id));
  })
);

router.post(
  '/:id/start',
  requireAdminKey,
  asyncHandler(async (req, res) => {
    res.json(startTournament(req.params.id));
  })
);

router.get(
  '/:id/standings',
  asyncHandler(async (req, res) => {
    res.json(computeStandings(req.params.id));
  })
);

router.get(
  '/:id/bracket',
  asyncHandler(async (req, res) => {
    res.json(computeBracket(req.params.id));
  })
);

router.get(
  '/:id/matches',
  asyncHandler(async (req, res) => {
    const stage = req.query.stage;
    if (stage !== undefined && !STAGES.includes(stage)) {
      throw badRequest('bad_stage', `stage phải là một trong: ${STAGES.join(', ')}`);
    }
    res.json({ matches: listMatches(req.params.id, stage) });
  })
);

export default router;
