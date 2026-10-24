/**
 * create-mock-tournament.js — Tạo giải đấu ảo với bot từ repo ootv2botchallenger
 */

import { randomUUID, scryptSync, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import config from '../../server/config.js';
import { rows, insert, rpc } from '../../server/shared/client.js';
import { runMatch } from '../../server/judge/matchRunner.js';
import { EMPTY_MAP } from '../../src/game/maps.js';
import { matchMapSnapshot } from '../../server/contracts/mapSnapshot.js';

const REPO_URL = 'https://github.com/treatgoogtodog/ootv2botchallenger';
const BRANCH = 'main';

const encode = (password) => {
  const salt = 'a'.repeat(32);
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};

async function main() {
  console.log('=== Khởi tạo Giải đấu Ảo OOTv2 Challenger ===');

  // 1. Tải file bot.py từ repo GitHub
  console.log(`Đang tải file bot.py từ ${REPO_URL}...`);
  const rawUrl = 'https://raw.githubusercontent.com/treatgoogtodog/ootv2botchallenger/main/bot.py';
  const resp = await fetch(rawUrl);
  if (!resp.ok) throw new Error(`Không tải được bot từ GitHub: ${resp.status}`);
  const botCode = await resp.text();
  const botSha256 = createHash('sha256').update(botCode).digest('hex');
  console.log(`Tải thành công! Kích thước: ${botCode.length} bytes, SHA-256: ${botSha256}`);

  // Lưu bot vào data/cache
  fs.mkdirSync(config.artifactCacheDir, { recursive: true });
  const localBotPath = path.join(config.artifactCacheDir, 'challenger_bot.py');
  fs.writeFileSync(localBotPath, botCode, 'utf8');

  // Lấy commit SHA từ GitHub API
  let commitSha = '400a9a1000000000000000000000000000000000';
  try {
    const metaResp = await fetch('https://api.github.com/repos/treatgoogtodog/ootv2botchallenger/commits/main', {
      headers: { 'User-Agent': 'OOTv2-Tournament-Bot' }
    });
    if (metaResp.ok) {
      const meta = await metaResp.json();
      if (meta?.sha) commitSha = meta.sha;
    }
  } catch {
    // fallback
  }
  console.log(`Commit SHA: ${commitSha}`);

  const now = new Date().toISOString();

  // 2. Tạo 4 đội ảo
  const TEAMS = [
    { name: 'Challenger Alpha', username: 'challenger_alpha', pass: 'bot123' },
    { name: 'Challenger Beta', username: 'challenger_beta', pass: 'bot123' },
    { name: 'Challenger Gamma', username: 'challenger_gamma', pass: 'bot123' },
    { name: 'Challenger Delta', username: 'challenger_delta', pass: 'bot123' },
  ];

  const teamData = [];
  for (const t of TEAMS) {
    // Kiểm tra xem participant đã tồn tại chưa
    const existingP = await rows('participants', `name=eq.${encodeURIComponent(t.name)}`);
    let pId;
    if (existingP.length > 0) {
      pId = existingP[0].id;
    } else {
      const newP = await insert('participants', {
        id: randomUUID(),
        name: t.name,
        name_key: t.name.toLowerCase(),
        created_at: now
      });
      pId = newP[0].id;
    }

    // Tạo account nếu chưa có
    const existingA = await rows('accounts', `username=eq.${encodeURIComponent(t.username)}`);
    if (existingA.length === 0) {
      await insert('accounts', {
        id: randomUUID(),
        username: t.username,
        password_hash: encode(t.pass),
        role: 'team',
        participant_id: pId,
        repository: REPO_URL,
        branch: BRANCH,
        created_at: now
      });
    }

    // Tạo submission valid cho đội
    const newSub = await insert('submissions', {
      id: randomUUID(),
      participant_id: pId,
      storage_path: `${pId}.py`,
      status: 'valid',
      sha256: botSha256,
      created_at: now
    });
    const subId = newSub[0].id;

    teamData.push({ ...t, participant_id: pId, submission_id: subId });
  }
  console.log(`Đã khởi tạo xong ${teamData.length} đội thi đấu!`);

  // 3. Tạo Tournament ảo
  const tournamentId = randomUUID();
  const tournamentName = 'Giải Đấu Ảo - Challenger League 2026';
  console.log(`Đang tạo giải đấu: "${tournamentName}" (ID: ${tournamentId})...`);

  await insert('tournaments', {
    id: tournamentId,
    name: tournamentName,
    status: 'group_running',
    seed: 12345,
    created_at: now,
    started_at: now,
    map_json: JSON.stringify(EMPTY_MAP),
    version: 1
  });

  // 4. Tạo tournament entries & kết nối repo
  const entries = [];
  for (let i = 0; i < teamData.length; i++) {
    const t = teamData[i];
    const entryId = randomUUID();
    await insert('tournament_entries', {
      id: entryId,
      tournament_id: tournamentId,
      participant_id: t.participant_id,
      submission_id: t.submission_id,
      seed_order: i + 1,
      group_name: 'A'
    });
    entries.push({ ...t, entry_id: entryId, seed_order: i + 1 });

    // Tạo kết nối repo đã duyệt (approved = true)
    await insert('repo_connections', {
      id: randomUUID(),
      event_id: tournamentId,
      team_id: t.participant_id,
      repo_id: 99990000 + i,
      repository: REPO_URL,
      branch: BRANCH,
      approved: true,
      created_at: now,
      updated_at: now
    });

    // Tạo sync job đã hoàn thành
    const jobId = randomUUID();
    await insert('repo_sync_jobs', {
      id: jobId,
      event_id: tournamentId,
      team_id: t.participant_id,
      repo_id: 99990000 + i,
      repository: REPO_URL,
      branch: BRANCH,
      file_path: 'bot.py',
      commit_sha: commitSha,
      status: 'completed',
      created_at: now,
      updated_at: now
    });

    // Tạo receipt valid
    await insert('github_receipts', {
      id: randomUUID(),
      job_id: jobId,
      event_id: tournamentId,
      team_id: t.participant_id,
      repo_id: 99990000 + i,
      repository: REPO_URL,
      branch: BRANCH,
      file_path: 'bot.py',
      commit_sha: commitSha,
      source_hash: botSha256,
      status: 'valid',
      resolved_at: now,
      submission_id: t.submission_id
    });
  }
  console.log('Đã ghi danh các đội, duyệt repository và cấp thẻ biên nhận hợp lệ.');

  // 5. Chạy các trận đấu thực chiến giữa các bot
  console.log('Bắt đầu chạy các trận đấu thực tế giữa các bot Challenger...');
  const pairings = [
    [entries[0], entries[1]], // Alpha vs Beta
    [entries[2], entries[3]], // Gamma vs Delta
    [entries[0], entries[2]], // Alpha vs Gamma
    [entries[1], entries[3]], // Beta vs Delta
  ];

  let gameIndex = 1;
  for (const [redTeam, blueTeam] of pairings) {
    const matchId = randomUUID();
    console.log(`\n--- Ván ${gameIndex}: ${redTeam.name} (Đỏ) vs ${blueTeam.name} (Xanh) ---`);

    const matchOutcome = await runMatch({
      matchId,
      map: EMPTY_MAP,
      seed: 1000 + gameIndex,
      red: { name: redTeam.name, filePath: localBotPath },
      blue: { name: blueTeam.name, filePath: localBotPath },
      maxPlies: 60 // Giới hạn 60 nước để tạo diễn biến nhanh, gọn, đẹp mắt
    });

    console.log(`Kết quả ván ${gameIndex}: ${matchOutcome.result} (${matchOutcome.reason}) sau ${matchOutcome.ply_count} nước.`);

    const snapshot = matchMapSnapshot(EMPTY_MAP);
    // Lưu trận đấu vào DB
    await insert('matches', {
      id: matchId,
      tournament_id: tournamentId,
      stage: 'group',
      series_id: `gA_${redTeam.seed_order}-${blueTeam.seed_order}`,
      game_no: 1,
      red_entry_id: redTeam.entry_id,
      blue_entry_id: blueTeam.entry_id,
      seed: 1000 + gameIndex,
      status: 'finished',
      result: matchOutcome.result,
      reason: matchOutcome.reason,
      ply_count: matchOutcome.ply_count,
      map_json: snapshot.json,
      map_hash: snapshot.hash,
      started_at: now,
      finished_at: now
    });

    // Lưu các events nước cờ vào mvp_match_events
    if (Array.isArray(matchOutcome.replay?.events)) {
      const eventRows = [
        {
          match_id: matchId,
          seq: 0,
          kind: 'initial',
          payload_json: JSON.stringify({
            initialPieces: matchOutcome.replay.initial_pieces,
            seed: 1000 + gameIndex,
            map: EMPTY_MAP
          }),
          created_at: now
        }
      ];

      for (let seq = 0; seq < matchOutcome.replay.events.length; seq++) {
        const ev = matchOutcome.replay.events[seq];
        eventRows.push({
          match_id: matchId,
          seq: seq + 1,
          kind: 'move',
          payload_json: JSON.stringify(ev),
          created_at: now
        });
      }

      // Lưu theo lô 20 records
      for (let i = 0; i < eventRows.length; i += 20) {
        await Promise.all(eventRows.slice(i, i + 20).map(row => insert('match_events', row)));
      }
    }

    // Đặt lịch phát sóng cho ván đấu (Broadcast)
    // Ván 1: Đã chiếu xong (ended, full)
    // Ván 2: Đang chiếu trực tiếp (broadcasting)
    // Ván 3, 4: Sắp chiếu (waiting)
    const broadcastState = gameIndex === 1 ? 'ended' : 'scheduled';
    const releaseMode = 'full';
    const startsAt = gameIndex === 1 
      ? new Date(Date.now() - 300000).toISOString() // 5 phút trước
      : gameIndex === 2
      ? new Date(Date.now() - 20000).toISOString() // 20 giây trước (đang phát)
      : new Date(Date.now() + gameIndex * 60000).toISOString(); // tương lai

    await insert('match_broadcasts', {
      match_id: matchId,
      event_id: tournamentId,
      state: broadcastState,
      starts_at: startsAt,
      ply_interval_ms: 1500,
      release_mode: releaseMode,
      created_at: now
    });

    console.log(`Đã lưu ván đấu và tạo lịch phát sóng (${broadcastState}) tại ${startsAt}`);
    gameIndex++;
  }

  console.log('\n======================================================');
  console.log('🎉 GIẢI ĐẤU ẢO ĐÃ ĐƯỢC TẠO THÀNH CÔNG RỰC RỠ!');
  console.log(`Tên giải: ${tournamentName}`);
  console.log(`Mã giải: ${tournamentId}`);
  console.log(`Kho mã bot: ${REPO_URL}`);
  console.log('\nThông tin đăng nhập các đội để thử nghiệm:');
  for (const t of teamData) {
    console.log(`- Đội: ${t.name.padEnd(20)} | Username: ${t.username.padEnd(18)} | Password: ${t.pass}`);
  }
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('Lỗi khởi tạo giải đấu ảo:', err);
  process.exit(1);
});
