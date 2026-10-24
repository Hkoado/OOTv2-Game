# Kịch bản sửa và xác minh RC trước deploy — 25/10/2026

Đi cùng [biên bản rà soát](DEPLOY-REVIEW-2026-10-25.md), [RC online tối giản](20-RC-ONLINE-TOI-GIAN.md)
và `docs/19-CONTRACT-TICH-HOP.md`.

**Trạng thái ban đầu:** NO-GO production tại `6be2cfd03da1bf3e8c7ff3ffa46057332758758c`.
Đây là kế hoạch xử lý findings, không phải tuyên bố đã sửa hoặc đã chạy E2E. Không push,
deploy, apply migration remote hoặc bật nhận/chấm bot lạ theo tài liệu này.

## Quy tắc phối hợp

- Giữ nguyên working tree/nhánh đang có; không tạo worktree mới. Trước khi sửa, mỗi owner
  kiểm `git status`, xác nhận checkout/commit và chỉ sửa phạm vi của mình. Không hai người
  cùng ghi cùng working tree/file; ghép qua quy trình checkout/commit đã được chuẩn bị.
- Huy chốt route/DTO/error và fixture **trước** khi Bảo sửa client/UI phụ thuộc response.
  Không đổi contract âm thầm. Bảo có thể chuẩn bị kịch bản browser trong lúc Huy sửa.
- Giữ Campus v2, policy `cutoff-first-resolution.v1`, SHA đã pin, quyền admin/team,
  nguyên tắc chấm trước–phát sau. Không sửa migration đã apply; migration mới phải additive,
  review và đối chiếu ledger project đích.
- Không dùng mock/fixture thay cho browser hoặc DB thật khi checklist yêu cầu môi trường thật.
  Ghi lệnh, exit code quan sát được, SHA, môi trường và evidence; mọi mục chưa chạy là NOT RUN.

## Huy — API, privacy, schema, cutoff và throttle

### H1. Chặn lộ kết quả trước giờ reveal — P1

Phạm vi: `server/services/officialBroadcasts.js`, khi cần `server/routes/official.js`,
`tests/officialBroadcast.test.js`, `tests/officialPublishedRoutes.test.js`.

1. Tạo DTO whitelist cho thành viên giải; không trả `result`, `replay_hash`, `recorded_at`
   hoặc dữ liệu tương đương khi `reveal_result=false`. Admin được giữ DTO điều hành riêng.
2. Trạng thái/broadcast không công bố phải tiếp tục trả đúng 404/403 theo contract; viewer
   chỉ nhận events tới `visible_plies`, kết quả chỉ khi `reveal_result=true`.
3. Test thành viên/admin cho ba trạng thái: chưa tới starts_at, phát kiểu `window` chưa hết,
   và `full`/đã reveal. Dùng fixture game thật-shaped có result/hash bí mật; assert các key
   nhạy cảm vắng khỏi JSON (không chỉ assert giá trị `null`).

**PASS khi:** không thể suy ra kết quả/hash từ state, danh sách, viewer hay DTO published
trước gate; admin vẫn xem đúng phần được phép; ACL cross-event giữ nguyên.

### H2. Publication gate cho standings, bracket, tickets — P1

Phạm vi: `server/routes/official.js`, service publication/broadcast hiện có và test route/service.

1. Định nghĩa rõ điều kiện server-side cho kết quả tổng hợp đã công bố. `frozen=true` chỉ
   nghĩa đã khóa vòng, không phải giờ phát; knockout complete chỉ nghĩa đã có kết quả.
2. Dùng dữ liệu broadcast authoritative để không trả qualifiers/ranking/winner/loser/tickets
   có thể lộ kết quả kín. Kiểm các series thuộc stage/round tương ứng, không chỉ group round;
   không nhận round tùy ý từ client và không thay gate admin.
3. Thêm test khi broadcast thiếu, scheduled trong tương lai, window chưa reveal, canceled,
   đã full/reveal, và trường hợp chỉ một phần series đã reveal. Response trước gate không chứa
   standings/bracket/ticket nhạy cảm; trả code lỗi/shape đã chốt cho Bảo.

**PASS khi:** team/cross-event không đọc được aggregate tiết lộ kết quả trước gate; sau gate
nhận DTO whitelist; admin API vận hành hiện có không bị đổi ngoài ý muốn.

### H3. Sửa query danh sách ván theo schema thật — P1

Phạm vi: `server/services/officialBroadcasts.js`, migration additive nếu thật sự cần,
test service/API, cập nhật contract §7 `docs/19-CONTRACT-TICH-HOP.md`.

1. Đối chiếu `mvp_official_games` trên migration manifest và schema/ledger **đúng project đích**.
   Không giả định ba cột `series_id`, `reason`, `ply_count` có mặt.
2. Chỉ select cột có thật. Lấy ply count từ nguồn replay accepted nếu phù hợp; không làm lộ
   payload/replay/hash trước quyền phát. Nếu cần cột mới, thêm migration additive mới và nêu
   rõ thứ tự, grants/RLS, smoke/rollback; không sửa migration cũ.
3. Test PostgREST adapter với projection chính xác và response DB có kiểu dữ liệu đúng. Khi
   có project disposable/quyền phù hợp, chạy API list + viewer thật và lưu kết quả không-secret.

**PASS khi:** published games hoạt động với schema thực, không truy vấn cột không tồn tại,
không lộ kết quả ngoài publication policy. Nếu chưa có quyền DB, phần remote ghi BLOCKED,
không báo PASS.

### H4. Bounded cutoff batch và tiến độ authoritative — P1, phối hợp Bảo

Phạm vi backend: `server/services/githubCutoff.js`, `server/shared/router.js`, tests cutoff.

1. Đặt batch cap và time budget phía server, không tin `limit` do browser gửi. Xử lý tuần tự
trong budget an toàn dưới Vercel `maxDuration`; trả progress/remaining rõ để UI gọi lượt sau.
2. Chọn đội pending/failed chưa pin trước khi áp batch limit; đội đã pinned không tiêu slot.
   Busy không bị tính là pending có thể retry ngay. `remaining` phải đếm cả đội chưa xử lý,
   pending và lỗi còn cần retry theo định nghĩa DTO; `complete` dựa trạng thái authoritative.
3. Retry phải giữ SHA/receipt đã pin, không resolve lại hoặc ghi đè đội đã pin. Lỗi từng đội
   phải có code ổn định; timeout/response mất không được xóa pin.
4. Test: nhiều hơn một batch, batch lặp, mixed pinned/busy/pending/failed, team_ids cụ thể,
   limit sai/quá lớn, GitHub chậm, RPC timeout/commit không rõ, retry sau lỗi và bảo toàn SHA.

**PASS khi:** nhiều batch liên tiếp cuối cùng xử lý hết đội còn việc; response không báo xong
giả, một batch bị retry không bỏ qua đội sau và SHA đã pin bất biến.

### H5. Login throttle fallback — P2

Phạm vi: `server/lib/loginThrottle.js`, `tests/loginThrottle.test.js` và migration plan nếu cần.

1. Bỏ cập nhật in-memory hai lần trong nhánh có RPC. Chọn một semantics rõ: RPC thành công
   dùng kết quả phân tán; khi RPC lỗi, mỗi request chỉ bump local đúng một lần.
2. Test account threshold 10/11, IP threshold 60/61, RPC lỗi trước kết quả, lỗi ở lần gọi
   RPC thứ hai, reset, và học sinh nhiều account chung IP. Không để request thử thứ 11 bị
   chặn sớm do double count.
3. Ghi rõ fallback local không phân tán và migration
   `20261026170000_shared_login_throttle.sql` applied/not applied theo ledger của đúng project.
   Không tự apply remote.

**PASS khi:** thresholds khớp test local; RPC outage không đếm đôi; production readiness
không nhầm fallback process-local là shared throttle.

### Bàn giao Huy

Ghi `docs/handoff/Huy.md`: SHA sau sửa, routes/DTO/error, migration + project/ledger status,
lệnh và exit code, DB local/mock/remote phân biệt, test mới, blocker/NOT RUN. Gửi contract/fixture
đã chốt cho Bảo. Huy không ký thay browser gate của Bảo hoặc release/runtime của Khoa.

## Bảo — nối UI theo API đã sửa và browser smoke

Phạm vi: `src/tournament/portal/OfficialRoundPanel.jsx`,
`src/tournament/portal/officialRoundApi.js`, tests frontend và `docs/runbook/SINH-VIEN.md`.

1. Sau khi Huy chốt response, nối danh sách ván/standings/bracket/tickets theo DTO thật;
   UI chỉ hiển thị dữ liệu server trả, không tự tính điểm hoặc suy diễn công bố từ `frozen`.
   401/403/404/409 phải có thông báo rõ và không giữ dữ liệu account trước khi đổi phiên.
2. Cutoff: gửi/tuân theo batch cap đã chốt; hiển thị queued/skipped/failed/remaining và
   trạng thái từng đội. Retry tiếp batch còn việc tới khi hoàn tất; không nhầm `busy` là lỗi
   đã xử lý, không báo thành công toàn bộ khi backend còn pending.
3. Giữ UI/style hiện có, không thêm fixture fallback ở production. Refresh/reconnect tải lại
   trạng thái authoritative; logout/đổi account xóa dữ liệu portal cũ.
4. Tạo smoke trên môi trường tích hợp có DB/API dùng được, bằng browser thật:
   - admin đăng nhập, xem cutoff, retry batch, tiến độ, standings/bracket kín và mở phát;
   - thành viên đúng giải trước publication: không thấy aggregate/kết quả kín; sau publication:
     thấy dữ liệu được mở và mở viewer đúng quyền;
   - đội ngoài giải: 403/404 theo contract, không rò dữ liệu;
   - refresh, reconnect, logout rồi đăng nhập account khác; thử 401/403/409 và không còn state cũ.
5. Chạy smoke ở viewport desktop và cả hai theme nếu app hỗ trợ; ghi browser/version, URL môi
   trường (không ghi token/cookie), vai trò test, bước, kết quả và lỗi. Không dùng ảnh có dữ liệu
   cá nhân trong repo.

**PASS khi:** browser thật gọi API tích hợp (không mock), luồng admin/team/out-of-scope đạt,
privacy trước/sau publication đúng, cutoff batch tiến triển và refresh/logout không để stale state.

### Bàn giao Bảo

Ghi `docs/handoff/Bao.md`: SHA UI/API được thử, browser/OS/viewport/theme, môi trường thật hay
mock, kịch bản + kết quả từng vai trò, lỗi/NOT RUN. Gửi cho Huy/Khoa script review ngắn. Không
đánh browser PASS chỉ từ unit test, screenshot tĩnh hoặc mock server.

## Khoa — tổng hợp RC và deploy-readiness (không ký thay)

Sau khi Huy/Bảo có checkpoint, tích hợp theo quy trình repo đang dùng rồi:

1. Chốt một SHA RC; kiểm `git status`, diff, migration manifest/ledger đích và env names.
2. Chạy full test, build, audit và diff-check trên chính SHA đó; ghi exit code/evidence.
3. Đối chiếu Vercel config, Node engine, production safety guards, Supabase env/project ref,
   API routes, headers/cookie/proxy, rollback và backup/artifact runbook.
4. Tổng hợp gate Huy/Bảo/Khoa thành PASS/FAIL/NOT RUN riêng. Không tuyên bố RC đạt nếu còn
   privacy/schema/cutoff blocker hoặc browser smoke online chưa chạy.
5. Không push/deploy/apply migration remote. Bàn giao một RC cho người dùng tự review/deploy.

## Phần người dùng và hai mốc quyết định

- Người dùng đã báo đã thử bot và nhận kết quả OK; đây là **user-reported**. Không yêu cầu thử
  bot lại nếu boundary không đổi; không xem đó là sandbox/recovery acceptance.
- **RC review/deploy:** chỉ xem xét sau khi findings trên được sửa, browser smoke online có
  evidence, và Khoa/Huy/Bảo bàn giao cùng SHA. Người dùng tự deploy Vercel; HTTPS/cookie/CSRF,
  route và health smoke là bước sau deploy, không thể PASS trước đó.
- **Mở giải/chấm bot không tin cậy:** là gate riêng. Runtime mới trên VM, hai worker DB thật,
  crash/reclaim/stale-write, outage/reboot/update rollback và backup/restore phải có evidence
  PASS trước khi mở. Các mục NOT RUN ở `docs/handoff/Khoa.md` không được đổi thành PASS.
- Chung kết thủ công và giải hoàn toàn không Internet vẫn hoãn trong phạm vi RC này.