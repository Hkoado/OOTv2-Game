# Điều phối Codex + Cline — 23/10/2026

## 1. Cách chạy nhanh

Hai agent làm **hai lát cắt của M1**, không phải hai agent tự triển khai toàn bộ M1–M6.
Worktree là hai thư mục của cùng repository, không phải viết project mới.

1. Commit bộ tài liệu/script này trên `dev` sau khi review; script từ chối working tree bẩn.
2. Từ PowerShell chạy (mặc định chỉ xem trước):

```powershell
& 'D:\OOTv2-Game\tools\parallel\start-m1.ps1'
& 'D:\OOTv2-Game\tools\parallel\start-m1.ps1' -Apply
```

3. Mở **đúng thư mục riêng** trong hai cửa sổ IDE:
   - Codex: `D:\OOTv2-Game-codex-m1`, nhánh `parallel/m1-github-intake`.
   - Cline mới: `D:\OOTv2-Game-cline-m1`, nhánh `parallel/m1-serverless-regression`.
4. Gửi đúng một câu cho mỗi agent:

```text
Đọc AGENTS.md rồi docs/agents/CODEX-M1.md trong workspace hiện tại và thực hiện đúng nhiệm vụ đó. Không làm ngoài phạm vi.
```

```text
Đọc AGENTS.md rồi docs/agents/CLINE-M1.md trong workspace hiện tại và thực hiện đúng nhiệm vụ đó. Không làm ngoài phạm vi.
```

Các đường dẫn tương đối ở đây được resolve theo root worktree; khi gọi công cụ agent phải dùng đường dẫn tuyệt đối. Nếu dùng checkout khác, truyền `-RepoRoot` và `-WorktreeParent` cho script. Không khởi chạy hai agent trong `D:\OOTv2-Game`.

## 2. Kịch bản đã chốt

Đội nộp repo/branch → API resolve và ghi nhận SHA trước cutoff, tạo job/receipt → worker tải đúng `bot.py` tại SHA, validate → snapshot bất biến → chấm trước → giữ kín kết quả → BTC công bố theo lịch → thành viên giải xem từng nước đến hạn → kết thúc mới mở replay/kết quả đầy đủ.

- Supabase Postgres + Storage private là nguồn dữ liệu duy nhất. Không phục hồi SQLite.
- Vercel phục vụ request ngắn; không Python, worker nền, `git clone` hoặc ghi cache source trên API host.
- Worker riêng trên máy BTC; **chưa có sandbox OS** nên chỉ được chạy bot tin cậy.
- Giữ React/Vite, phòng chơi cũ, engine MVP, 256 KiB / **200 plies**. Campus 400 plies/persistent protocol là migration riêng, không lén đổi trong đợt này.
- Ưu tiên quyết định ngày 23/10 và docs/14 cho đợt này; phần SQLite/upload-only trong AGENTS/docs MVP là lịch sử.

## 3. Đã làm và mức bằng chứng

Đối chiếu checkout ngày 23/10: `dev` tại `dd785fb`; log có `1369345` (bỏ SQLite), `589173b` (intake upload + entrypoint Vercel), `dd785fb` (dọn import). Khi bắt đầu, agent phải tự xác nhận lại HEAD/status.

| Phần | Hiện trạng code | Không được suy diễn |
|---|---|---|
| Supabase-only | `server/shared/client.js`, không còn dependency better-sqlite3 | Không có nghĩa mọi migration đã áp trên remote |
| Upload | `participants.js` kiểm tĩnh, Storage + SHA-256, `uploaded`/receipt | Không phải nộp GitHub hoặc validation-job receipt đầy đủ |
| Validation | `worker.js::validatePendingSubmissions` chạy Python, update valid/invalid | Chưa có claim/lease/fencing cho validation; catch giữ uploaded chưa có backoff/phân loại đầy đủ |
| Match worker | Claim/heartbeat/lease/token fencing qua RPC cho trận | Không bảo vệ validation upload bằng lease trận |
| Serverless | Có `api/[...path].js`, `vercel.json`; VERCEL tắt static Express | Chưa nghiệm thu routing Preview, cookie HTTPS, proxy/IP |
| Live | Supabase live events/output/heartbeat, migration `20261023120000_live_stream.sql` | `/api/live` còn anonymous/immediate; không phải phát lịch/kết quả kín |
| Auth | Session/CSRF, admin guard; profile có repo/branch | Chưa verify repo ownership/permission; chưa có job GitHub |
| Test | Báo cáo trước: 77/77, build exit 0; 9 suite SQLite đã xóa | Mock không thay E2E Supabase, browser hay production readiness |

Lần rà soát tài liệu này đã chạy lại test/build: log ghi 77 pass / 0 fail và build hoàn tất 4,43 s,
nhưng shell integration không thu được exit code của hai lệnh; không coi đó là nghiệm thu exit 0.
Script worktree đã dry-run exit 0 và parser PowerShell không có lỗi; chưa chạy `-Apply` trên repo thật.
Agent phải lưu exit code và log mới. Docs/07 phần cũ và docs/14 chứa trạng thái lịch sử:
đọc bảng này cùng code thật, không lấy một dòng cũ làm hiện trạng.

## 4. Chia việc và quyền sở hữu file (đợt 1 / M1)

| Agent | Sở hữu chỉnh sửa | Không được chỉnh |
|---|---|---|
| Codex | `server/shared/router.js`, `server/shared/participants.js`; module mới `server/shared/github*.js`, `server/lib/github*.js`; migration mới `supabase/migrations/20261023140000_github_intake.sql`; `tests/github*.test.js`; `docs/agents/reports/CODEX-M1.md` | app/config/accounts/client/worker/artifacts, api/, vercel.json, package/lock, src/, docs chung |
| Cline | `server/app.js`, `server/config.js`, `server/shared/accounts.js`, `server/lib/origin.js`; `api/[...path].js`, `vercel.json`, `.env.example`; `tests/serverless*.test.js`, `tests/sharedAuth*.test.js`, `tests/sharedApi*.test.js`; helper mới `tests/helpers/shared*.js`; `tools/cli/check-serverless.mjs`; `docs/agents/reports/CLINE-M1.md` | router/participants/client/worker/artifacts, migration, module github, package/lock, src/, docs chung |

Đọc file ngoài phạm vi được phép. Nếu cần sửa file của agent kia: ghi đề nghị trong report, **không sửa chui**, không tạo bản sao để né ownership. Hai agent không sửa README, AGENTS, docs/07/14/15, package/lock hay cùng một report. Không xóa test cũ. Không thêm dependency; dùng fetch, Node built-in test và stack hiện có.

## 5. Hợp đồng tích hợp

- Giữ `/api/local` + cookie path hiện hành. Codex đăng ký route GitHub trong `shared/router.js`, **sau requireSession** và dùng CSRF/membership/admin guard hiện có. Không đổi hợp đồng login, tên cookie hoặc export accounts.
- Route chốt cho lát cắt này: `POST /api/local/events/:id/submissions/from-github`, `GET /api/local/repo-sync-jobs/:id`. Chỉ đội sở hữu/membership giải hoặc BTC được truy cập; GET trả whitelist receipt, không trả secret/source.
- Input POST: `{ repository, branch }`; `bot.py` cố định. Repository chỉ HTTPS github.com owner/repo, không token/query/hash/port lạ. API GitHub endpoint được dựng từ thành phần đã validate, không fetch URL tùy ý.
- Resolve branch **một lần** thành full SHA; lấy giờ DB/server tin cậy, không dùng commit timestamp. Receipt tối thiểu: `id`, `tournament_id`, `participant_id`, `repository_id`, `repository`, `requested_ref`, `commit_sha`, `resolved_at`, `status`, `error_code`. HTTP 202 khi đã ghi job; idempotency trong cùng giải/đội/repo/SHA/path. Không đọc branch lại để chạy.
- Cutoff phải authoritative và kiểm lại trong transaction tạo job; sau deadline hoặc snapshot đã freeze phải reject. Nếu schema hiện chưa có deadline thì Codex thêm additive trong migration riêng, quy định rõ NULL = chưa cấu hình cutoff nhưng vẫn bắt buộc draft/open policy; không tự suy ra timestamp từ client.
- M1 chỉ resolve metadata + persist job; chưa tải/execute source. Status job ban đầu `queued`; reserve `validating`, `valid`, `invalid`, `retry` cho M2 và ghi CHECK/contract chính xác trong report. Không giả job đã validate. Giữ upload tương thích trusted-dev, chưa chuyển UI.
- RPC intake transaction kiểm membership/context/freeze/cutoff/uniqueness và ghi atomically. RLS private, revoke public/anon/authenticated execute phù hợp mô hình service_role hiện có. Không sửa migration cũ, không dùng bảng Campus thay mvp_*.
- Codex ghi tên bảng/RPC/arguments/response/error/status trong report để M2 dùng. Cline không mock route mới chưa tồn tại trên nhánh mình, không giả DB hỗ trợ schema mới.
- Token GitHub chỉ env server tối thiểu/read-only; không nhận token sinh viên, không gửi tới browser/bot/log. Repo public không chứng minh ownership; nếu chưa verify quyền đăng ký phải yêu cầu BTC phê duyệt và báo rõ giới hạn, không báo private-repo/GitHub App hoàn tất.

Đây là hợp đồng triển khai M1 cần nghiệm thu, **không mô tả API đã tồn tại**.

## 6. Gate và thứ tự sau hai nhánh

1. Integrator đọc hai report, review diff/path ownership và test. Tích hợp **Codex trước, Cline sau** trên nhánh tạm từ base chung, không merge agent vào nhau khi đang chạy.
2. Chạy install/build/test trên nhánh tích hợp; giải quyết đề nghị ngoài ownership; kiểm POST repo → receipt bằng project test riêng. Chưa đạt thì vẫn M1-partial.
3. **M2** riêng: job claim/lease/heartbeat/fencing + bounded blob fetch đúng SHA, timeout/redirect/rate limit/hash, phân lỗi bot/hạ tầng/backoff, giữ valid cũ, pin snapshot/cache, map worker và E2E hai worker. Không dùng loop uploaded hiện tại như hàng đợi an toàn.
4. **M3** riêng: bảng publication/lịch/mốc giờ, ACL theo giải, audit mọi đường live/replay/standings/bracket/result/log/file để không lộ tương lai. Trước gate này không mở site chứa dữ liệu giải thật.
5. **M4** viewer từng nước/catch-up/countdown/replay sau phát, không rebuild game engine.
6. **M5–M6** tải 50/100/200 viewer, lỗi mạng/force-push/cutoff/hồi quy; Preview HTTPS thật, vận hành/khôi phục/offline. Sandbox OS là gate độc lập trước bot không tin cậy, không được trì hoãn rồi mở public.

Chỉ mở đợt sau khi milestone trước pass. Không giao agent làm M3 trong lúc M1 chưa nối được job/receipt.

## 7. Quy trình tích hợp (người điều phối)

Hai agent commit **file mình sửa**, không `git add -A`, không push/merge/reset/rebase nhánh khác. Report ghi HEAD/base, commit, file, lệnh/exit code, test chưa chạy và rủi ro. Không commit secret, log source bot hay `.env`.

Sau khi cả hai dừng, tại checkout chính sạch (thay tên integration nếu đã tồn tại):

```powershell
Set-Location 'D:\OOTv2-Game'
git status --short
git switch -c integration/m1-parallel dev
git merge --no-ff parallel/m1-github-intake
# Nếu conflict: dừng, review; không tiếp tục merge thứ hai khi còn conflict.
git merge --no-ff parallel/m1-serverless-regression
npm.cmd install
npm.cmd test
npm.cmd run build
```

Không dùng đoạn trên như script bỏ qua lỗi: kiểm `$LASTEXITCODE` sau mỗi lệnh. Review diff với `dev`, test lại full rồi mới đưa vào `dev` theo quy trình repo; không force-push. Nếu dev đã tiến, review thay đổi từ base ghi trong manifest trước merge. Không áp SQL/deploy thật tự động. Project integration riêng phải có xác nhận đúng project và dữ liệu disposable; không reset/seed/delete DB giải thật. Không xóa worktree khi report hoặc thay đổi chưa lưu.