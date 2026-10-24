# Contract phối hợp cho đợt hoàn thiện

Ngày 24/10/2026. Đi cùng [phạm vi chốt](18-CHOT-HOAN-THIEN-VA-NGHIEM-THU.md).
Đây là **contract ngữ nghĩa bắt buộc**, không khẳng định các route/RPC dưới đây đã tồn tại.
Nhóm map vào exports/routes/schema thật trước khi code từng boundary; không tạo tên trùng hoặc
đường chạy song song chỉ để khớp tài liệu. Bảng mapping ở cuối chưa được coi là contract wire đã xong.

## 1. Quy tắc chung

- ID ổn định, version schema rõ; thời gian server/DB UTC ISO, UI định dạng theo timezone có nhãn.
- Producer chỉ trả DTO whitelist; UI không nhận service key, token lease, source, storage key hoặc
  snapshot private chỉ để hiển thị trạng thái. Admin tải source nếu nghiệp vụ cho phép là endpoint riêng có ACL.
- Mọi write kiểm session/CSRF/role/scope tại server. Hidden control không phải authorization.
- Idempotency cho request retry; optimistic version cho draft; transaction cho khóa/chọn/claim/finish.
- Dùng error envelope/code hiện có, bổ sung code có test nếu thiếu. UI phân biệt forbidden,
  conflict/frozen, validation, infrastructure; không suy thành công từ HTTP 202 hay trạng thái process.
- Fixture cùng schema với API thật, test producer/consumer, tests không gọi mạng thật mặc định.

## 2. Các boundary phải thống nhất

| Boundary | Producer → consumer | Dữ liệu/điều kiện tối thiểu |
| --- | --- | --- |
| Intake/readiness | Huy → Bảo/Khoa | event/team, receipt/job ID, pinned SHA/hash, trạng thái và lý do, ready/blockers; latest khác locked |
| Snapshot | Huy + Khoa → runtime | immutable source identity + map/rules/protocol/runtime/budget + seed + round; provenance phù hợp intake mode |
| Schedule | Khoa → Huy/Bảo | round/game identity, seq/prefix/version, red/blue, map/seed, trạng thái, màu persist trước chạy |
| Execution | Khoa ↔ persistence Huy review | job/attempt, lease token/generation, heartbeat, input hashes, accepted result/replay; fencing mọi ghi liên quan |
| Standings/bracket/vé | Khoa → Huy/Bảo | điểm ván/cặp tách biệt, tie-break/seed, tiến độ, next stage/ticket provenance; output kín trước công bố |
| Publication | Huy → Bảo | server time, lịch phát, cursor/reset, chỉ visible moves và result được phép; API kiểm membership |
| Manual intake | Huy → Bảo/Khoa | event/round/team/submission ID, sourceKind manual, bytes/hash, người/thời gian nhận, trạng thái, version/locked |
| Manual judging | Huy/Bảo → Khoa | hai đội và submission đã khóa, map/runtime/seed/cấu hình cặp hợp lệ, idempotency; không latest lookup khi chạy |
| Health/control | Khoa → operator/API khi cần | intake health khác match execution readiness; schema/storage/runtime/attestation/capacity và blockers, không secret |

Không đổi các enum persistent hiện có cho đẹp; ghi mapping chính xác giữa enum DB/job và nhãn UI.
`valid` source/syntax không đồng nghĩa match đã chạy hoặc sandbox production được nghiệm thu.
Kết quả chính thức phải xuất phát accepted attempt, không chỉ thấy một artifact tồn tại.

## 3. Chung kết thủ công

- Intake mode phân biệt online GitHub và manual final; binding nằm ở đợt/vòng, kiểm ở server.
- Lifecycle ngữ nghĩa: draft → nhận/kiểm bài → chọn bài → locked → chấm → BTC xác nhận/chốt.
  Wire enum chọn theo code thật; không ép sửa enum cũ hoặc dùng status UI thay transaction.
- Upload scoped event/round/team, admin-only; một `.py` UTF-8 1..262144 bytes. Private artifact,
  server hash và server received time; filename người dùng không thành execution path.
- Validation/selection/lock không race: bài pending/invalid không khóa; chọn bài khác sau lock bị chặn.
  Không ghi đè submission cũ; job chấm pin snapshot, không đọc latest toàn đội.
- Snapshot manual không yêu cầu GitHub capture giả. Nó có provenance manual được validate riêng;
  không nới lỏng yêu cầu capture của online để hỗ trợ manual.
- Cùng worker/sandbox/budget/rules. Bot lỗi tính theo luật; infra retry cùng input, không tự forfeit.
- Cancel/rerun có actor/reason/link attempt cũ, không xóa audit; accepted result conflict phải chặn.
- Xác nhận đi tiếp không cho BTC tự giả engine result; không tự công bố manual finals cho đội.
- Không cần bundle/import offline hay API không mạng; không dùng cờ mở online upload toàn cục làm thiết kế.

## 4. Test contract tối thiểu

1. Admin/team/anonymous/cross-event; CSRF, upload size/type, path/redirect/source secrecy.
2. Upload trùng/retry, hai người chọn/khóa đồng thời, pending/invalid và thay bài sau khóa.
3. Online không nhận manual provenance; manual không cần GitHub nhưng không bỏ artifact validation.
4. Snapshot hash mismatch/runtime mismatch → không chạy. Duplicate/stale attempt → không ghi được kết quả.
5. Infra vs bot fault; replay của accepted attempt; retry không đổi map/source/seed.
6. Viewer không đọc kết quả kín/nước tương lai dù sửa cursor hoặc clock; manual admin-only.

## 5. Mapping wire thực tế — nhóm điền trước khi nối boundary

Đây là prerequisite nội bộ, không phải câu hỏi chờ người dùng duyệt tên endpoint. Mỗi owner
đối chiếu code thật, điền method/path hoặc export/RPC, request/response/error/version, tests
và consumer đã xác nhận. Chỉ đánh VERIFIED khi đã tích hợp và có test.

| Boundary | Owner chốt | Mapping/test/consumer | Trạng thái |
| --- | --- | --- | --- |
| Intake/readiness/publication | Huy, Bảo xác nhận | Chưa đối chiếu đầy đủ trong đợt giao việc này | NOT VERIFIED |
| Snapshot/schedule/job/result/standings | Khoa + Huy, Bảo xác nhận DTO | Chưa đối chiếu đầy đủ trong đợt giao việc này | NOT VERIFIED |
| Manual intake/lock/judging | Huy + Khoa, Bảo xác nhận | Chức năng cần triển khai theo phạm vi mới | NOT IMPLEMENTED |
| Worker install/control/readiness | Khoa | Có scaffolding, cần sửa và nghiệm thu VM | NOT VERIFIED |

Các quyết định sản phẩm đã chốt trong docs/18 không được thay đổi khi điền bảng này.