# Storage adapter cho consumer GitHub — K3e, chưa bật

`server/shared/artifactUpload.js` export `storeVerifiedSource(source, {sourceHash, signal, timeoutMs})`.
Đây là implementation cụ thể của callback `storeSource` mà `processGithubJob` yêu cầu; chưa được
import vào API, worker, polling hay UI. Consumer vẫn mặc định `enabled:false`.

## Contract

- Input: `Buffer` 1 byte..256 KiB, `sourceHash` 64 hex **phải khớp bytes** (kiểm trước khi gọi mạng).
- Key do adapter tự sinh `${randomUUID()}.py`; không dùng tên repo/đội/file, không nhận URL hay bucket
  từ caller. Bucket cố định `ootv2-bots`, origin lấy từ `SUPABASE_URL` (bắt buộc HTTPS, không
  user/password), credential `SUPABASE_SERVICE_ROLE_KEY`.
- `POST /storage/v1/object/ootv2-bots/<key>` với `x-upsert:false`, `redirect:'error'`,
  `Content-Type: application/octet-stream`; không ghi đè object đã có.
- Sau khi POST thành công, adapter **tải lại** qua `downloadStorageArtifact` (cùng budget 256 KiB,
  cùng deadline/signal) và so sánh bytes + SHA-256. Chỉ khi khớp mới trả
  `{storage_path:'<uuid>.py', sha256}`; lệch/hỏng → `upload_integrity`, không trả reference.
- Deadline mặc định/tối đa 20 s cho cả POST và readback; `signal` abort dừng cả hai.
- Không đọc/parse body lỗi của Storage (có thể chứa source hoặc token). Lỗi được chuẩn hoá:
  `invalid_source`, `invalid_budget`, `storage_configuration`, `upload_rejected`,
  `upload_timeout`, `upload_cancelled`, `upload_integrity`, `upload_unavailable`.
- Không retry, không xoá, không tạo submission. Adapter không thực thi Python và không phải sandbox.

## Orphan và đối soát

Upload thành công nhưng consumer chưa `finish` (deadline, mất lease, response không rõ) sẽ để lại
object không được submission nào tham chiếu. Adapter **không tự xoá** vì không thể biết transaction
`finish` đã commit hay chưa; xoá mù có thể làm hỏng bài đã nhận. Cần inventory/quarantine + GC sau
khi đối soát receipt/submission, hiện chưa có scheduler hay DB inventory tự động.

## Giới hạn hiện tại

- Chưa kiểm với Supabase Storage thật, chưa kiểm quyền bucket private/RLS, chưa kiểm dung lượng
  đồng thời hay rate limit của Storage.
- `downloadStorageArtifact` dùng chung vẫn là nguồn đọc cho `materialize` của worker MVP; adapter này
  không đổi profile/replay hay đường chạy hiện hữu.
- Chưa có validation adapter (sandbox) nên **không được bật consumer** chỉ vì đã có Storage adapter.
  Gate còn lại: PostgreSQL thật (lease/crash/duplicate finish), Storage private thật, GitHub thật,
  sandbox Linux, rồi mới xem xét polling.

## Kiểm thử

`node --test tests/artifactDownload.test.js` — 7 test mock `fetch` bổ sung cho transport tải xuống: key/bucket/header cố định, kiểm
hash readback, lỗi trước mạng, redaction, readback sai, timeout/abort khi fetch phớt lờ signal, source
256 KiB, cancel giữa upload không retry, và một test tích hợp `processGithubJob` + adapter (finish
nhận đúng `storage_path`/`sha256`, không gửi `submission_id`). Không DB/Storage/GitHub/Python thật.
