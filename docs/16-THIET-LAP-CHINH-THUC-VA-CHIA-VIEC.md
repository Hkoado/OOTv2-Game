# Thiết lập giải chính thức và bàn giao 3 thành viên

Ngày 23/10/2026. Quyết định mới của người dùng: bỏ luồng **tạo mới** giải MVP 8 đội,
thiết lập theo điều lệ chính thức, chuyển nộp online sang repo GitHub, chia việc Huy/Bảo/Khoa.
Thay kế hoạch một agent trong docs/15 cho đợt tiếp theo. Không tự phục hồi SQLite.

## 1. Đã triển khai ở checkpoint này

- Portal tạo mới giải `campus-setup.v1`: tuần/tháng/kỳ; roster 0–56 đội để chuẩn bị;
  cutoff có múi giờ (lưu UTC), lịch tuần/tháng, map chính/dự phòng, nhãn version pack.
- Dự kiến chia bảng bằng seed lưu của giải và roster canonical; chọn đội theo thứ tự khác nhau
  vẫn cho cùng bảng. Chưa có thao tác khóa bốc thăm hay công bố pack, chưa có hash/slot assignment pack.
- Vòng loại tuần: 32–56 đội / 8 bảng; 16–31 / 4; 8–15 / 2; 4–7 / 1; dưới 4 báo giao lưu.
  Bảng lệch tối đa 1. Fixture 35/40/48/50 tương ứng 120/160/240/264 ván (2 ván/cặp).
- Tháng/kỳ: cấu hình bracket 8; chỉ ngoại lệ kỳ 3 tháng / 6 đội có 2 bye.
  **Chưa cấp vé/xếp seed theo thành tích**, không lấy thứ tự chọn đội làm seed chính thức.
- Có bảng/RPC Supabase mới cho cấu hình, cập nhật draft có optimistic version + row lock.
  Không sửa migration cũ hoặc kết quả cũ. Giải lịch sử vẫn đọc được theo profile MVP.
- API start và DB trigger chặn dùng lịch MVP cho giải chính thức, kể cả chọn đúng 8 đội.
  UI không hiện nút bắt đầu giả. `setupReady` chỉ là đủ thông tin, `executionReady` luôn false.

### Migration bắt buộc trước khi chạy API phiên bản này

`supabase/migrations/20261023160000_official_setup.sql` **chưa apply remote**.
Nó tạo `mvp_official_setups`, RPC/trigger và nâng giới hạn seed_order lên 56; không mở
public grants. API đọc thêm bảng này khi mở chi tiết giải nên phải migrate project test
được BTC cho phép trước khi nghiệm thu integration hoặc rollout; không deploy code trước schema.
Không đổi tên bảng `mvp_*` hàng loạt: đây là nơi lưu roster hiện có, discriminator nằm trong bảng setup.
Khi nối runtime chính thức phải migration versioned riêng; không nhồi stages mới vào worker cũ.

### Chưa triển khai

Scheduler thực thi chính thức, bảng điểm cặp/mini-table, khóa bốc thăm, tránh tái đấu,
knockout/bye/ván phụ/tranh ba, vé, map pack hash & slot mapping, public publication,
GitHub job/receipt, persistent protocol và sandbox. Map chính/dự phòng hiện là **chọn cấu hình**,
không phải tuyên bố đã công bố hoặc đã chạy. Không mở giải cho bot không tin cậy.

## 2. Review các nhánh trước tích hợp

Đã `git fetch origin --prune` exit 0 ngày 23/10; remote Backend cập nhật lên `8540d2f`.

| Nhánh / SHA | Kết luận |
|---|---|
| `origin/live` / `7676a51` | Là ancestor của HEAD `eabb907`; đã có, không merge lại |
| `origin/logs-bot-errors-on-admin` / `0112cc1` | Là ancestor; admin judge/log đã có, giữ nguyên |
| `origin/Backend` / `8540d2f` | Không merge nguyên; xem lý do dưới |

Backend có UI deadline/repo sync và hướng dẫn bot có thể tham khảo; nhưng gitSync vẫn import
`server/db.js`, `sharedEnabled`, services SQLite đã xóa trên dev. Bản mới gọi clone từ HTTP sync route,
clone branch rồi lấy HEAD, không transaction receipt/cutoff trước hạn; autoPuller kéo khi tới/qua deadline.
Clone còn đọc file qua stat/readFile và output git không bounded như contract mục tiêu.
Ngoài ra có thay đổi độ dài password 12→10 và commit tạo tài khoản test, không thuộc nhiệm vụ.
Merge nguyên sẽ làm sai Supabase-only/API request ngắn/cutoff và mang thay đổi auth ngoài scope.
**Không tạo merge commit hoặc dùng `-s ours` để giả đã tích hợp.** Không port mã runtime không phù hợp.
Tận dụng bằng cách giữ live/log đã có và dùng ý tưởng form/CTA từ Backend trong phần việc Bảo sau review.

## 3. Kế hoạch thay upload online bằng GitHub (chưa code intake)

**Không hiểu “BTC tự clone” là clone trong API.** Luồng chính:

```text
đăng ký repo/branch → BTC duyệt quyền → API resolve repo numeric ID + full SHA
→ transaction DB kiểm cutoff/freeze/idempotency/quota → job + receipt riêng theo đội/giải
→ worker BTC tải đúng blob bot.py ở SHA → size/hash/static + sandbox validation
→ candidate valid → snapshot vòng bất biến → chấm kín → BTC đặt lịch → viewer theo giờ
```

1. API chỉ metadata/resolve SHA, không tải source, clone, Python hoặc timer background.
   Cutoff dùng clock DB khi commit transaction, không commit timestamp; resolve xong sau cutoff không nhận.
2. Repo HTTPS GitHub canonical, numeric ID, branch, path cố định `bot.py`; một repo/đội trong giải.
   Quyền public không chứng minh ownership: chưa verify phải BTC approval/fail closed.
   Private ưu tiên GitHub App Contents read-only; không form PAT sinh viên, không token trong URL/log/bot.
3. Unique `(event,team,repoId,commitSha,path)`; cùng SHA không tạo job/trừ quota lần nữa.
   Receipt whitelist, không storage path/token/raw remote error; đội khác giải/đội không đọc được.
4. Worker ưu tiên GitHub blob API bounded tại SHA, không clone project. Nếu BTC bắt buộc clone:
   chỉ worker checkout-free, fetch object khóa SHA, vô hiệu hooks/submodule/LFS/filter,
   bounded timeout/output/disk và xác minh Git object **regular file**, không `stat` theo symlink;
   lấy nội dung đúng SHA và hash, tuyệt đối không pull HEAD trước mỗi trận.
5. Validation job có lease/fencing/retry/backoff. Lỗi GitHub/Storage/máy BTC giữ bản valid cũ;
   không đánh invalid vì thiếu Python. Pending đã nhận SHA trước cutoff có thể check xong sau hạn;
   freeze phải đợi hoặc BTC xử lý hạ tầng, không chọn HEAD mới.
6. UI GitHub trở thành CTA chính sau API sẵn sàng; `uploaded/resolving/checking` khác `invalid`.
   Upload HTTP không dành cho đội online nữa; trusted-dev fallback mặc định tắt, admin-only opt-in.
   **Không bỏ import file offline**: điều lệ bắt buộc USB bot.py và receipt của giám thị.
7. Pin snapshot/artifact/map/runtime trước chấm/offline; revoke/force-push không đổi bản đã khóa;
   GC không xóa pinned/khiếu nại. Không claim offline tournament chạy được khi vẫn cần Supabase Internet.

## 4. Contract chung trước khi 3 người tích hợp

- Setup DTO hiện tại: `event.profile`, `competition` (schemaVersion/level/cutoff/mapPackVersion/
  weeksPerMonth/monthsPerSemester/primaryMap/reserveMap), `setup_preview`; update gửi `expectedVersion`.
- Mỗi thay đổi schema/API cần mẫu request/response/error và PR review trước khi downstream nối.
- API intake đã chốt ở H1 (`server/shared/router.js`, service `server/services/githubIntake.js`):
  `PUT /api/local/events/:id/repository` — đội tự đăng ký (nhận `approved=false`, trạng thái
  `pending_approval`), admin gửi kèm `team` để duyệt (`approved=true`); `GET` cùng path cho
  owner/admin xem connection; `GET /api/local/events/:id/repositories` (admin) liệt kê repo chờ duyệt.
  `POST /api/local/events/:id/submissions/from-github` body `{repository?, branch?}` trả
  `202 {created, job, receipt}` (lần nộp lại cùng SHA trả `created=false`, không tạo job/quota mới).
  `GET /api/local/repo-sync-jobs/:id` và `GET /api/local/events/:id/submissions/from-github` chỉ
  owner/admin. Không có route nào clone, tải source hay chạy Python.
- DTO receipt (whitelist, snake_case khớp fixtures `githubSyncState.js`):
  `{id,event_id,team_id,repo_id,repository,branch,commit_sha,resolved_at,status,source_kind,file_path,
  source_hash,error,error_category,submission_id,previous_valid_submission_id,job_id}` với
  `status ∈ resolving|fetching|checking|valid|invalid|infrastructure|frozen` (frozen là view khi giải
  đã bắt đầu, kèm `previous_status` + `note`). Job view bỏ `lease_token`/`requested_by`:
  `{id,event_id,team_id,status,attempt,available_at,error,error_category,created_at,updated_at}`.
  Mã lỗi API: `repo_not_approved`, `repo_taken`, `repository_changed`, `repository_not_found`,
  `past_cutoff`, `event_frozen`, `quota_exceeded`, `missing_team`, `github_rate_limited`,
  `github_timeout`, `github_unavailable`.
- Job nội bộ cần source kind/path/SHA, lease token/until, attempt/retry/availableAt; status tách
  lỗi code khỏi hạ tầng. Snapshot tham chiếu receipt/source hash/map hash/rules/protocol/budget.
- API viewer dùng chính sách docs/14: cùng **giải** xem mọi ván **đã công bố**, không theo vòng cũ;
  khách không được xem nước/kết quả, offline mặc định BTC. Chặn cả standings/bracket/replay/log side channels.
- Không mở public execute trước sandbox Linux kiểm chứng. Gate này độc lập với deploy Vercel.

## 5. Chia việc cân đối theo năng lực, không chỉ số file

| Người | Gói chính (tương đương một luồng end-to-end) | Bàn giao đầu tiên |
|---|---|---|
| [Huy](assignments/Huy.md) | GitHub intake/DB/auth + publication API/ACL | Schema + DTO job/receipt/snapshot/broadcast |
| [Bảo](assignments/Bao.md) | UI GitHub/setup + viewer/phân quyền hiển thị + browser QA | UI state fixtures theo DTO, sau đó nối API |
| [Khoa](assignments/Khoa.md) | Scheduler/standings/bracket/vé + worker/runtime/sandbox | Hàm thuần thể thức + job consumer contract |

Khoa có gói kỹ thuật sâu hơn: Huy chịu integration SQL/concurrency/security, Bảo chịu browser
E2E/load harness/runbook để cân bằng. Mỗi người chỉ làm **một milestone nhỏ/PR**, không làm hết gói một lượt.
Không cần nhiều agent cùng sửa workspace này; thành viên làm checkout/branch riêng do nhóm tự bố trí.

### Ownership và thứ tự

- Huy: `server/shared/router.js`, accounts/client/participants, GitHub intake services, migrations API.
- Bảo: `src/tournament/portal/*`, React UI, browser fixtures/tools và docs UI; không tự sửa API/schema.
- Khoa: `server/shared/tournaments.js`, `officialSetup.js`, `src/game/competition.js`, `server/judge/*`,
  worker/artifacts, scheduler thuần, sandbox/SDK. Migration scheduler do Khoa viết file timestamp riêng,
  Huy review; không sửa migration của nhau hoặc merge SQL đang apply.
- Test mỗi người đặt file riêng. `App.jsx`, package/lock, config, schema/API contract phải báo nhóm trước.
- Trình tự: checkpoint setup → Huy chốt DTO/schema → ba người làm phần độc lập → intake → worker/snapshot
  → scheduler → privacy API → viewer → QA tải/offline/restore. Không mở Start trước cả runtime/privacy gate.
- Huy tích hợp PR từng cái sau test/build; không merge nguyên Backend. Người dùng tự push, không tự deploy.

## 6. Nghiệm thu

Kết quả sau mỗi PR bắt buộc ghi chung ở [docs/handoff](handoff/README.md), mỗi người một báo cáo
Huy/Bao/Khoa; không chỉ nằm trong chat. Agent sau đọc ba báo cáo rồi theo
[checklist sau tích hợp](handoff/SAU-TICH-HOP.md). H1/B1/K1 chỉ là bước đầu; ngay cả khi cả gói của
ba người hoàn thành vẫn cần xác minh tích hợp, E2E thật, an toàn runtime, tải, offline/restore và vận hành.

- Giải 35/40/48/50 đội đúng counts; tie/mini-table chính xác, tránh cùng bảng, bye không ván giả,
  main 4/final 6/extra 2, tranh ba/vé không trùng. Fixtures thuần không thay DB integration.
- GitHub: cutoff đồng thời/force-push/revoke/rate limit, receipt cross-team 403, retries không duplicate;
  API chạy khi không có git/Python. Worker hai máy stale token không ghi đè kết quả/event.
- Privacy: đoán match ID/afterSeq vẫn không có nước tương lai, kết quả kín, bracket/standings;
  cùng giải xem vòng sau được sau công bố, khác giải không xem; log source/credential không lộ.
- Sandbox Linux VM sạch: file/network/fork/RAM/CPU/stdout/cleanup; chưa chạy thì ghi NOT RUN.
- Bảo điều phối browser 2 theme/mobile/dirty draft/reconnect + tải 50/100/200 viewer;
  Khoa/Huy phối hợp số đo worker/DB và recovery. Offline bot giải là gói việc riêng, không lẫn chơi tay.

## 7. Kiểm chứng checkpoint

- Baseline: `npm.cmd install`, `npm.cmd test`, `npm.cmd run build` đều exit 0; baseline 82 test.
- Install báo **2 high severity vulnerabilities** và cảnh báo approve esbuild scripts.
  Chưa tự `npm audit fix` vì có thể đổi dependency ngoài scope; cần review riêng.
- Test mới `tests/officialSetup.test.js`: 9/9 pass lúc chạy riêng; mock PostgREST, không gọi DB thật.
- Kết quả full suite/build sau chỉnh và giới hạn nghiệm thu ghi ở docs/07.
- NOT RUN: apply SQL, Supabase integration, thao tác browser setup, Preview HTTPS, sandbox/load/offline.
  Build/test không thay cho nghiệm thu giải chính thức; checkpoint này chỉ hoàn thành **setup foundation**.