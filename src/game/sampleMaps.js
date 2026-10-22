import { EMPTY_MAP } from './maps.js';

export const SAMPLE_MAPS = [
  { name: 'Đấu trường mở', map: EMPTY_MAP },
  { name: 'Cổng đôi', map: { ...EMPTY_MAP, id: 'twin-gates', blocked: ['e4', 'e6'] } },
  { name: 'Bốn trụ', map: { ...EMPTY_MAP, id: 'four-pillars', blocked: ['d4', 'f4', 'd6', 'f6'] } },
];