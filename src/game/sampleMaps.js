import { EMPTY_TERRAIN_MAP, normalizeMap } from './maps.js';

function sample(name, id, description, terrains) {
  return { name, description, map: normalizeMap({ ...EMPTY_TERRAIN_MAP, id, terrains }) };
}

export const SAMPLE_MAPS = [
  sample('01 · Sân Lửa', 'learn-fire', 'Lửa cản Bao; Búa và Kéo đi qua được.',
    { b2: 'fire', h8: 'fire', e4: 'fire', e6: 'fire' }),
  sample('02 · Hồ Nước', 'learn-water', 'Nước cản Kéo; Búa và Bao đi qua được.',
    { c2: 'water', g8: 'water', d5: 'water', f5: 'water' }),
  sample('03 · Vườn Bụi cây', 'learn-bush', 'Bụi cây cản Búa; Bao và Kéo đi qua được.',
    { b3: 'bush', h7: 'bush', d4: 'bush', f6: 'bush' }),
  sample('04 · Sân Vực', 'learn-chasm', 'Vực cản tất cả quân. Chú ý luật cắt góc.',
    { c3: 'chasm', g7: 'chasm', e4: 'chasm', e6: 'chasm' }),
  sample('05 · Campus bốn địa hình', 'campus-four-terrains', 'Đủ Lửa, Nước, Bụi cây và Vực, cả ở sân nhà và giữa bàn.',
    { b2: 'fire', h8: 'fire', c2: 'water', g8: 'water', b3: 'bush', h7: 'bush',
      c3: 'chasm', g7: 'chasm', e4: 'fire', e6: 'fire', d5: 'water', f5: 'water',
      d4: 'bush', f6: 'bush', e5: 'chasm' }),
];