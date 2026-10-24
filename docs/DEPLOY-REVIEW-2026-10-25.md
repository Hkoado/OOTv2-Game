# Rà soát trước deploy — 25/10/2026

## Kết luận

**NO-GO production** cho RC `6be2cfd03da1bf3e8c7ff3ffa46057332758758c` (nhánh `dev`).
Phạm vi theo docs/20; Chung kết thủ công tiếp tục hoãn nghiệm thu.
Không push/deploy/apply remote hoặc sửa code nghiệp vụ trong lượt review.

## Kiểm tra local

- Node v24.18.0; working tree ban đầu sạch.
- `npm.cmd test`: 483 PASS, 0 fail/cancel/skip; log có summary hoàn chỉnh.
- `node --test tests/*.test.js`: chạy lại 483 PASS, 0 fail/cancel/skip.
- `npm.cmd run build`: PASS, marker `BUILD_OK` chỉ được ghi sau exit 0; 1657 modules,
  9.00s. Còn cảnh báo chunk JS 510.80 kB, không phải lỗi build.
- `npm.cmd audit --json`: report vulnerabilities total=0.
- Git inspection: HEAD xác định, diff check không có output lỗi;
  `.env`, `.envdev`, `data`, `dist` không có file tracked theo lệnh kiểm tra.
- Terminal shell integration không báo exit đáng tin cậy; dùng log/summary và marker
  sau `&&` thay vì coi wrapper tool success là bằng chứng. Lượt `npm.ps1` ban đầu bị
  ExecutionPolicy chặn; lượt này không được tính PASS.

Evidence local (gitignored): `data/review-deploy-tests.log`, `data/review-tests-direct.log`,
`data/review-build-direct.log`, `data/review-build-ok.txt`, `data/review-audit-direct.json`,
`data/review-git-final.txt`, `data/review-deploy-probes.mjs`, `data/review-deploy-probes.log`,
`data/review-probes-ok.txt`. Probe chỉ dùng dependency injection/mock HTTP, không DB thật.

## Findings cần sửa

### P1 — Trạng thái broadcast lộ kết quả trước reveal (Huy)

`server/services/officialBroadcasts.js:108,180-197` lấy `result,replay_hash,recorded_at`
rồi trả nguyên `context.game` cho thành viên giải, chỉ kiểm `isPublished`, không lọc
theo `reveal_result`. Probe xác nhận `broadcast.reveal_result=false` nhưng
`game.result=red_win`. Cần DTO whitelist riêng cho đội, giấu result/hash/thời điểm
accepted khi chưa được phép; test route/service với game thật-shaped, không mock DTO đã lọc.

### P1 — API published aggregate bỏ qua publication gate (Huy)

`server/routes/official.js:165-201`: standings/bracket chỉ kiểm group `frozen`, tickets
chỉ kiểm knockout complete. `bracketView` trả thắng/thua của các series accepted.
`server/services/officialOrchestration.js:125-147` khóa vòng vì lịch/kết quả hoàn tất,
không chứng minh phát xong; `officialKnockout.js:266-282` cũng không kiểm broadcast.
Do đó đội có thể suy ra kết quả còn kín khi BTC chấm trước/khóa vòng nhưng chưa phát.
Cần publication gate tổng hợp từ dữ liệu authoritative (kể cả các vòng knockout),
không đồng nhất freeze với công bố. Test lịch tương lai/window/canceled/thiếu broadcast
và mixed revealed/unrevealed; giữ API admin riêng.

### P1 — Published games query lệch schema (Huy + Bảo kiểm tích hợp)

`server/services/officialBroadcasts.js:231-246` select `series_id,reason,ply_count`
từ `mvp_official_games`. Bảng trong `20261025090000_official_schedule.sql:23-49`
không có ba cột này; toàn bộ ALTER bảng trong migration repo không thêm chúng.
Mock PostgREST lỗi cột `42703` xác nhận service trả `shared_db_error`.
Không có nghiệm thu DB remote trong lượt này; kết luận schema dựa trên migration repo.
Cần dùng dữ liệu/schema thực có, lấy số ply từ replay accepted hoặc thiết kế additive
reviewed; không sửa migration đã apply. Kiểm danh sách + viewer trên DB đúng ledger.

### P1 — Cutoff chưa bounded theo serverless deadline (Huy + Bảo)

`server/services/githubCutoff.js:12-60` chỉ slice khi client truyền limit; mặc định loop
tuần tự mọi repo, mỗi repo thêm claim/GitHub/pin. `OfficialRoundPanel.jsx:222-227`
không truyền limit; `vercel.json:8` maxDuration=30. Không có request-wide time budget.
50 repo ở độ trễ mạng thực có nguy cơ timeout trước response, dù pin một phần đã commit.
Ngoài ra `remaining=failed.length` bỏ qua đội chưa được xử lý do limit, và limit được
áp trước khi bỏ qua đội đã pin nên gọi lại một batch có thể không tiến tới đội sau.
Cần giới hạn server-side, chọn đội còn việc, trả remaining authoritative, UI chạy batch
đến hết/cho retry có tiến độ, giữ SHA đã pin. Chưa benchmark Vercel: đây là rủi ro từ code,
không tuyên bố đã tái hiện timeout production.

### P2 — Throttle fallback đếm đôi (Huy)

`server/lib/loginThrottle.js:90-103` bump local khi gắn thuộc tính sync lên Promise,
rồi bump lần nữa khi RPC lỗi. Probe 6 request cùng account/IP trả
`[true,true,true,true,true,false]`, trái ngưỡng 10 lần/phút. Bỏ đếm đôi, regression test
11 lần và lỗi ở RPC thứ nhất/thứ hai; không coi fallback memory là bảo vệ phân tán.

## Gate môi trường còn thiếu

- Migration `20261026170000_shared_login_throttle.sql`: handoff Huy ghi CHƯA apply;
  chưa đọc ledger remote để xác nhận trạng thái hiện tại. Phải đối chiếu project đích,
  backup và apply theo quyền riêng trước mở login production; fallback không thay schema gate.
- Browser smoke admin/team/cross-event + publication/refresh/logout: chưa có evidence
  browser thật cho RC hiện tại; adapter/mock tests không thay browser acceptance.
- Handoff Khoa ghi VM service còn release cũ, fixture mới không phải deploy service.
  Đối chiếu release/hash/attestation trước chấm bằng runtime mới.
- Hai consumer DB thật trên release mới, outage/reboot/update rollback/disposable restore:
  NOT RUN theo handoff; chặn mở chấm bot không tin cậy, không đồng nghĩa chỉ thiếu web deploy.
- Production HTTPS/cookie/CSRF/routing/health/ready: NOT RUN, chỉ làm sau deploy được phép.

## Điều kiện xem xét lại

Sửa findings + regression trên một RC SHA mới; full tests/build/audit; đối chiếu ledger
và schema thật; browser online smoke. Sau đó mới duyệt web/API deploy; mốc mở giải/chấm
bot lạ vẫn phải đóng gate runtime/recovery riêng theo docs/20 và runbook.