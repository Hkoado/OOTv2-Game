# Runtime identity chính thức — cần chốt gì

Trạng thái 24/10/2026: đã có module `server/judge/officialRuntime.js` + test **3/3**.
Đây là **đề xuất mặc định**, chưa phải quyết định BTC; snapshot K2 đã dùng hash thật trong drill.

## 1. Vì sao cần

Replay chỉ ghi các nước đi. Để chứng minh một ván chạy đúng, hệ thống còn phải biết **đúng phiên bản
luật/engine** và **đúng giới hạn tài nguyên** đã dùng. Hai thứ này được pin vào snapshot dưới dạng:

- `runtimeHash`: hash của các file quyết định luật/kết quả + `rulesVersion` + `protocolVersion`.
- `budgetHash`: hash của thời gian/RAM/số nước/kích thước file.

Nếu code hoặc budget đổi mà không đổi hash, một ván cũ có thể không tái lập được. Vì vậy trước khi chấm,
scheduler phải gọi `verifyOfficialRuntimeIdentity(identity)`; lệch hash thì **không chạy**, báo BTC.

## 2. Mặc định đang dùng

`OFFICIAL_RUNTIME_VERSION = 'campus-runtime.v1'`, rules `ott-campus.v2`, protocol `bot.v1`.

Budget mặc định:

| Thông số | Giá trị |
|---|---|
| Setup mỗi bên | 5.000 ms |
| Move mỗi nước | 1.000 ms |
| Tổng thời gian phản hồi mỗi bot/trận | 45.000 ms |
| CPU mỗi bot/trận | 30.000 ms |
| Số nước tối đa | 400 |
| Source bot | 256 KiB |
| Input mỗi request | 64 KiB |
| Output mỗi luồng | 16 KiB |
| RAM | 256 MiB |
| PIDs | 32 |
| Sandbox profile | `linux-sandbox.v2` |

Danh sách file hash nằm trong `OFFICIAL_RUNTIME_FILES` (engine, rules, map/terrain, protocol, replay,
adapter, runner, sandbox adapter). Hash chuẩn hoá CRLF → LF nên Windows/Linux cho cùng kết quả.

## 3. Cần BTC chốt

1. **Đóng băng engine trong mùa giải**: không sửa các file trên trừ khi bump `runtimeVersion` và mở
   vòng mới; vòng đã mở giữ snapshot cũ.
2. **Budget** ở bảng trên có đúng điều lệ không (nhất là 5 s setup, 1 s/nước, 45 s/bot/trận, 400 nước,
   256 MiB).
3. Có cần hash thêm **Python version**/OS không. Đề xuất **không**: Python chỉ chạy bot, server quyết
   định luật; thêm vào sẽ làm hash khác giữa máy BTC và VM dù luật không đổi.

## 4. Chưa làm

- Chưa có scheduler gọi verify trước trận; module mới chỉ có hàm thuần + drill.
- `server/services/officialRounds.js` đã dùng identity này khi tạo snapshot; chưa có runner chấm.
- Chưa chốt VM production; WSL2 hiện là dev, factory từ chối attestation WSL.
