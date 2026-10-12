/**
 * Routes match: chi tiết (không code bot) và replay (chỉ khi `finished`).
 */

import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { getMatchDetail, getMatchReplay, listMatches } from '../services/matches.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ matches: listMatches({ tournamentId: req.query.tournament_id }) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(getMatchDetail(req.params.id));
  })
);

router.get(
  '/:id/replay',
  asyncHandler(async (req, res) => {
    res.json(getMatchReplay(req.params.id));
  })
);

export default router;
