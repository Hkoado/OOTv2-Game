# Nộp bot qua GitHub và giảm lưu trữ trên máy BTC

Cập nhật 22/10/2026. Yêu cầu mới: đội push code lên GitHub, hệ thống BTC tự lấy về và chạy. Tài liệu này thay thiết kế “chỉ upload file, GitHub chưa cần cho MVP”. Giữ một file `bot.py`, Python/thư viện chuẩn, sandbox và các quy định vòng đấu đã chốt.

## 1. Phương án đề xuất

**GitHub lưu source chính; BTC chỉ giữ metadata, cache chạy ngắn hạn và kết quả/replay.** Mỗi đội đăng ký một repository, một branch thi và đường dẫn cố định `bot.py` ở root. Hệ thống tự đồng bộ trong cửa sổ nhận bài, lấy đúng commit, kiểm tra rồi dùng bản hợp lệ khi khóa vòng.

```text
Đội sửa bot.py -> commit/push GitHub
                        |
             sync job BTC trong cửa sổ nhận bài
                        |
        chốt repositoryId + branch + commit SHA
                        |
       lấy blob bot.py tại SHA -> hash -> sandbox check
                        |
             valid candidate -> khóa round snapshot
                        |
               runner dùng cache đúng hash
                        |
         lưu kết quả/replay; dọn source cache theo hạn
```

Không chạy `git pull main` trước mỗi ván. Branch thay đổi được; trận đã khóa chỉ nhận `commitSha + sourceSha256`, giữ nguyên cho cả vòng và ván phụ. Push sau cutoff chỉ dành cho cửa sổ/vòng tiếp theo.

## 2. Đăng ký repo và quyền truy cập

UI đội có “Kết nối GitHub”: URL repo được duyệt, branch, đường dẫn `bot.py`, trạng thái quyền đọc và lần sync cuối. Backend chuẩn hóa về GitHub repository numeric ID + owner/name để nhận diện; thay owner/name không được làm nhầm đội. Mỗi repo thi chính thức chỉ gắn một đội trong cùng sự kiện.

Ưu tiên **repo private** để các đội không tự xem code đối thủ. GitHub App do BTC quản lý được cài trên repo thi đã chọn, quyền Contents read-only và metadata cần thiết; credential chỉ ở service sync, không ở UI, runner hoặc jail. Kiểm permission và owner thật khi cài đặt, không coi URL là bằng chứng đội sở hữu repo. MVP không cần push write hoặc quyền quản trị repo.

Nếu cần bản đơn giản, BTC có thể dùng token đọc tối thiểu cho các repo BTC có quyền; fine-grained token có giới hạn theo chủ sở hữu/quyền của tài khoản nên phải kiểm trên các repo thật, không giả định một token đọc mọi repo sinh viên. Không yêu cầu sinh viên dán token cá nhân vào form bài nộp. Token không nằm trong URL, argv, log, bundle offline hoặc biến môi trường bot.

Repo public chỉ là lựa chọn BTC công bố rõ: source trên GitHub là công khai dù ứng dụng không cung cấp API đọc source đối thủ. Không hứa bảo mật code giữa các đội khi dùng repo public. Quyền xem trận theo vòng vẫn áp dụng độc lập.

## 3. Tự kéo code: baseline đơn giản

- Trong cửa sổ nộp/cập nhật, coordinator lập lịch sync các repo đã duyệt với khoảng cách cấu hình, mặc định đề xuất 5 phút; giới hạn concurrency, quota/ngày và backoff khi GitHub rate-limit/lỗi.
- Đội có nút **“Cập nhật bot từ GitHub”** để yêu cầu sync ngay trong quota. Push nhiều lần không cần tạo nhiều bản sao nếu SHA không đổi.
- Job resolve head của branch ở GitHub; ghi SHA và `resolvedAt` bằng clock server. Sau đó đọc đúng `bot.py` ở SHA đó, không đọc branch lần hai như nguồn chân lý.
- Trước cutoff, team được nhận receipt chứa SHA và trạng thái “Đang lấy/Đang kiểm tra”. Sau check valid mới thay candidate hợp lệ trước đó.
- Hệ thống tự chốt bản valid mới nhất từ các SHA đã resolve trước cutoff. Một candidate pending có thể check xong sau cutoff; freeze đợi check hoàn tất hoặc có quyết định hạ tầng. SHA chỉ phát hiện sau cutoff không hợp lệ cho vòng cũ, dù commit ghi timestamp sớm.
- Polling không bảo đảm nhìn thấy push sát giây khóa; UI phải nói rõ **push chưa đồng bộ chưa được tính là bài đã nhận**. Đội cần kiểm receipt hoặc bấm cập nhật sớm. Không dùng author/committer time để xử thời hạn.

Như vậy BTC không thao tác clone bằng tay, còn thời hạn có bằng chứng server. Nếu muốn nhận mọi push sát cutoff, bổ sung webhook push có kiểm chữ ký, delivery dedup và trusted repository mapping. Webhook là trigger queue; phải xác minh SHA thuộc repo đã duyệt, không tin URL/payload lạ hoặc cho webhook sửa bài đã khóa. Baseline polling + nút cập nhật chạy được trước khi làm webhook.

Mức quota cũ 10 bản/ngày đổi thành10 **commit mới được yêu cầu kiểm tra** mỗi đội/ngày; poll SHA không đổi không trừ quota và không tạo submission. Practice vẫn 5 cặp/ngày. Tất cả quota và lịch sync hiển thị rõ.

## 4. Lấy đúng một file, không chạy project sinh viên

Ưu tiên GitHub API đọc entry `bot.py` tại SHA với request có giới hạn thời gian/kích thước, không tải toàn history. Verify entry là regular file, không directory/symlink/submodule/LFS pointer. Kiểm source ≤256 KiB, UTF-8 và hash SHA-256 byte file; blob ID Git và source SHA-256 là hai trường khác nhau.

Nếu dùng Git CLI thay API: fetch vào kho tạm/bare do BTC tạo, không checkout working tree; dùng kiểm object/type và đọc blob tại `SHA:bot.py` (`git show`/`git cat-file`), có budget network/disk/time. Không kế thừa Git config/hooks/filter/credential helper của repo hoặc máy cá nhân. Không chạy script/npm/pip/Makefile/workflow từ repo; không recurse submodule/LFS hoặc nhận shell command của đội. Parser đường dẫn/ref/SHA có schema, spawn argv không shell.

Chỉ chấp nhận repo GitHub đã đăng ký và allowlist host; không fetch URL tùy ý do request truyền để tránh SSRF. Với API redirect/cross-host phải allowlist rõ và không forward credential ra host khác; không lấy `download_url` không kiểm tra làm đường tải arbitrary. Đổi branch, repo hoặc path phải xác minh lại và không sửa submission đã freeze.

Sync service có network + credential riêng, không execute bot. Runner có source cache read-only, sandbox không mạng/secret. Syntax check và smoke test đều trong jail; GitHub không làm code trở nên tin cậy.

## 5. Cache tối thiểu và dữ liệu phải giữ

| Loại | Nơi giữ / vòng đời |
| --- | --- |
| Source chính, lịch sử phát triển | GitHub repo đội |
| Metadata bài | DB: team/repoId/branch/path/SHA/sourceHash/size/resolve time/check/freeze |
| Source dùng cho trận/vòng | Cache nội bộ theo sourceHash, giữ trong toàn vòng/sự kiện và thời gian khiếu nại |
| Repo tải tạm | Dọn sau lấy blob; không mirror toàn repo dài hạn |
| Replay/map/kết quả/decisions | BTC lưu để xem lại, đối soát, cấp vé và backup |
| Bot thi offline | Tải trước sự kiện lên máy BTC; phát đúng đội, thu bản đã sửa qua USB |

Đề xuất `source-cache` hết hạn sau sự kiện đã finalized và đóng khiếu nại **72 giờ**, cấu hình trước mùa. Bản còn pending check, đang chạy, còn freeze dùng ở round sau, có khiếu nại hoặc cần export offline không được GC. Cache dùng reference count/retention pin; GC không xóa theo tuổi file đơn thuần. Nếu BTC cần kiểm chứng source lâu hơn có thể tăng hạn, nhưng không tự mặc định lưu mọi lần push 90 ngày.

Với 50 đội ×256 KiB, một phiên bản toàn bộ đội chỉ tối đa 12,5 MiB source; thường chỉ cần lấy một file thay vì tải cả repo/assets. Số này không bao gồm runtime, replay và backup. Không cần object storage/cloud lớn chỉ để giữ bot Python.

Sau GC, có thể lấy lại đúng SHA nếu GitHub vẫn cung cấp và sourceHash khớp. Nếu repo bị xóa/private mất quyền/force-push khiến object không còn truy cập được, không có bảo đảm lấy lại source. Replay action vẫn xem lại bàn cờ mà không cần chạy code; rerun bot không thể thực hiện nếu mất source. Trước GC kiểm không còn nghĩa vụ chạy lại/chuẩn bị offline. Không tự chạy head mới để thay SHA đã mất.

Replay không lưu source hoặc PAT. Backup/export có chứa source tạm cũng cùng hạn/pin; sau hết hạn phải xóa hoặc tạo bundle đã lược source nếu muốn thật sự giảm lưu trữ, giữ manifest/hash và kết quả. Cache bot không nằm trong public/src/dist và không commit vào repository game.

## 6. Offline vẫn hoạt động như đã chốt

BTC chọn SHA bot cũ đã xác nhận với đội → tải/check/hash/cache → export gói offline trước ngắt mạng → phát file cho đúng đội. Đội dùng nguyên/sửa/thay tùy ý trước cutoff, thu bài USB, khóa hash mới theo round và BTC xem/chấm localhost. Code sửa tại chỗ là source offline, không tự push ngược lên repo đội.

Không phụ thuộc GitHub/App/token/rate limit trong giờ offline. GitHub là nguồn ban đầu, không phải thay thế file thực thi tạm ở máy chấm. Job không được tự bật mạng khi cache thiếu; phải kiểm tra đủ bài trước buổi thi, xử lỗi trước sự kiện.

## 7. Database và API bổ sung

Thêm `team_repositories(teamId,githubRepositoryId,owner,name,branch,path,credentialRef,verifiedAt,status)`; credentialRef trỏ secret store phía BTC, không chứa raw PAT. Thêm `repo_sync_jobs`, `repo_sync_attempts`, `webhook_deliveries` nếu bật webhook. Một submission thêm `sourceKind=github|offline_file|upload_fallback`, repoId, requestedRef, commitSha, resolvedAt, sourceSha256, artifact/cache reference và receipt.

Unique `(team,event,repoId,commitSha,path)` cho một candidate cùng context; kiểm không lấy idempotency một event làm thay bài event khác. Freeze ghi snapshot/sourceHash/SHA cố định; source offline có SHA Git cũ làm provenance nếu có, không giả SHA đó chứa code đã sửa.

```text
PUT  /api/teams/:id/repository             # team sở hữu, verify lại khi đổi
GET  /api/teams/:id/repository             # che credential/internal error
POST /api/events/:id/submissions/from-github
GET  /api/repo-sync-jobs/:id               # chỉ owner/BTC scope
POST /api/internal/github/push-webhook    # tùy chọn, signature + dedup
```

Tên route là mục tiêu cần triển khai, chưa có trong repo. Các route tạo/cập nhật/check qua GitHub thay UI upload online làm luồng chính; upload file có thể giữ fallback do BTC bật. Offline import file vẫn bắt buộc. Nhận repo không bỏ auth/CSRF/quota, sandbox hoặc ACL xem trận.

## 8. UI và thông báo

Trang **Bot của đội** có form repo/branch/path, trạng thái kết nối, SHA phát hiện gần nhất, candidate đang kiểm và bản đã valid/khóa. CTA chính “Cập nhật bot từ GitHub”; không buộc đội upload lại source. Hiện cutoff, lần sync cuối/lần sync tiếp dự kiến và quota.

Các trạng thái: `not_connected, verifying, ready, resolving, fetching, checking, valid, invalid, inaccessible, rate_limited, frozen`. Phân lỗi fetch/access/hạ tầng với lỗi code. Fetch lỗi giữ bản valid cũ; không thay thành missing/invalid một cách âm thầm.

Copy cần có: “Đã push chưa đồng nghĩa đã nhận bài. Kiểm tra commit được hệ thống xác nhận.”; “Vòng đang dùng commit {shortSha}, file {shortHash}.”; “Không đọc được repo; bản hợp lệ trước đó vẫn được giữ.” Không lộ remote error có credential hoặc URL riêng tư của đội khác.

BTC có bảng repo/quyền đọc/lần fetch/SHA/freeze/error, nút retry sync có quota và export offline preflight. Offline dùng file/seal UI cũ, không form “kết nối GitHub” hoạt động khi mất mạng.

## 9. Milestone và nghiệm thu

G1: repo registration/permission + bounded blob fetch + hash/cache, chưa chạy bot. G2: nối sandbox validation/candidate/cutoff/quota/freeze. G3: UI/status + scheduler polling; webhook tùy chọn sau. G4: cache GC/pin/export offline và rehearsal. Giữ milestone engine/runner từ file 04; không mở execute untrusted trước sandbox.

- Hai push trước cutoff: chỉ SHA đã resolve/valid đúng quy tắc được chọn; sau freeze không đổi ván sau.
- Force-push/delete/revoke quyền: bản cache đã pin vẫn chạy; mất cache không chạy head mới.
- GitHub unreachable/rate limit: backoff và giữ bản hợp lệ cũ, không xử thua hạ tầng.
- Bản pending resolve sau cutoff: không nhận cho round cũ; commit timestamp không cứu được.
- Symlink/submodule/LFS/file quá lớn/URL lạ: từ chối, không execute project.
- Credential không xuất hiện ở UI/log/jail/bundle. Repo public không được mô tả là giữ kín source.
- GC không xóa job/bài pinned/khiếu nại/export offline; source đã GC không được báo rerun thành công nếu không tải lại đúng hash.
- Offline rút mạng vẫn có file bot cũ/map để phát đội, nhập bản sửa và BTC xem/chấm.

## Nguồn kỹ thuật

- [Git show](https://git-scm.com/docs/git-show): đọc nội dung object/file tại revision.
- [GitHub: quản lý access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens): phạm vi, giới hạn token và GitHub App cho tích hợp dài hạn.
- [GitHub: source archive theo branch/tag/commit](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives): có thể lấy snapshot theo commit; lấy đúng blob vẫn nhẹ hơn tải cả archive cho một bot.
