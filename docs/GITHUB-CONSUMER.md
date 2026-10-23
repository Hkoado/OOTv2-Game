# Consumer bài GitHub — K3d, foundation chưa bật

`server/shared/githubConsumer.js` export `processGithubJob(options)` thực hiện một job theo
contract `githubJobs.js` và pinned retrieval `githubArtifact.js`. Không có polling mới, endpoint,
CLI, env flag hoặc import vào `runSharedWorker`. Mặc định `enabled:false` trả disabled trước DB.

## Cách tích hợp sau review

Caller phải truyền `enabled:true`, `workerId`, hai adapter `validateSource`/`storeSource`;
thiếu adapter ném lỗi cấu hình trước claim. Chưa cung cấp adapter thực thi mặc định vì chưa có
sandbox Linux được nghiệm thu. Không nối thẳng `validateBotFile` trusted-dev vào intake công khai.

- `validateSource(Buffer,{signal,sourceHash}) -> {status:'valid'|'invalid'|'infrastructure'}`.
  Adapter phải phân biệt thiếu Python/disk/host/sandbox với lỗi bot; exception/DTO lạ là hạ tầng.
  Consumer không chấp nhận `{ok:true}` cũ như bằng chứng validation protocol mới.
- `storeSource(Buffer,{signal,sourceHash}) -> {storage_path:'<uuid>.py',sha256}`.
  Adapter tự sinh UUID/storage key, kiểm ghi đúng bytes và hash, không dùng tên repo/file từ đội.
  Hiện chỉ kiểm DTO trả về; không thể thay cho kiểm upload/download thực tế.
- Adapter nhận Buffer riêng, signal và hash; không nhận raw job/credential/lease token.
  Phải honor abort và cleanup tài nguyên/process riêng. Promise race chỉ ngừng chờ, không kill
  callback hoặc subprocess phớt lờ signal, không preempt callback JS đồng bộ chặn event loop.
- `cache` tùy chọn theo `createSourceCache`: put và acquire trong cùng synchronous section,
  release trong finally. Consumer không chạy GC, không tự suy ra retained inventory.
- `jobApi`/`acquireSource` là dependency injection cho test. Mặc định dùng RPC client và GitHub
  artifact helper thật. Không cho browser truyền dependencies hoặc options này.

## Lease, kết quả và phục hồi

Claim dùng lease 120s; kiểm job/receipt cùng identity, token và generation. Heartbeat mặc định
10s; operation deadline mặc định/tối đa 60s sau claim. False/lỗi heartbeat => abort ngay, không
gửi finish/release tiếp. Progress fetching/checking đều kiểm true. Timeout/cancel để lease hết
hạn tự reclaim; không dùng một lease không chắc còn hiệu lực để release.

Valid chỉ finish bằng **payload submission mới** cùng source hash, không dùng nhánh existing
submission_id còn thiếu kiểm status/hash trong SQL hiện tại. Bot source sai định dạng từ helper
hoặc validator trả invalid => invalid, không upload; lỗi access/repo/cache/Storage/validation
hạ tầng => heartbeat xác nhận rồi release retry 3 lần. Message fixed/redacted, không raw exception.

Heartbeat trước release giảm rủi ro nhưng **không sửa được** thiếu expiry predicate trong SQL.
Cần Huy review/fix server-side + integration PostgreSQL trước bật thật. Claim expired/retry limit,
freeze pending/cutoff, concurrent workers và idempotent finish vẫn chưa nghiệm thu DB thật.

Finish false => lease_lost. Finish exception/timeout có thể đã commit: trả completion_unknown
(hoặc lý do cancellation), không release hay xóa Storage có thể đã được submission tham chiếu.
Heartbeat cũng có thể trả false ngay sau completion; kết quả unknown phải đối soát bằng receipt
chứ không suy thành bot fault/thành công. Không tự retry finish hoặc tạo submission thứ hai.

Upload thành công nhưng finish không rõ/stale có thể để orphan. Adapter/coordinator cần ghi
inventory/quarantine và GC sau đối soát DB; consumer chưa tự xóa orphan vì có thể xóa bài đã nhận.
Cancellation có thể xảy ra khi request ghi đang in-flight; SQL fencing vẫn là nguồn quyết định.
Client RPC hiện chưa nhận signal của consumer: request đã gửi có timeout riêng và có thể commit
sau khi caller dừng chờ. Không tuyên bố client cancellation thu hồi transaction trên server.

## Nghiệm thu và rollback

`node --test tests/githubConsumer.test.js` dùng fixture, actual RPC wrappers/pinned fetch/cache
qua network mock; không chạy Python hoặc gọi DB/GitHub thật. Không chứng minh sandbox/DB production.
Rollback hiện là bỏ dùng helper (chưa có đường gọi trong worker), không có migration/env mới.
Start vẫn khóa; phải kiểm adapter sandbox/Storage, DB concurrency/crash/lease và quyền trước bật.