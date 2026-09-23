# Ghi chú sửa lỗi — nhánh `fix_bug_1`

## Bug 1: Vào phòng không thấy màn xếp quân, chỉ tự xếp khi hết giờ

**Vấn đề:**
Khi Khách (Đội Xanh) vào phòng, sự kiện thông báo tham gia (`OTT_JOIN`) qua kênh
đồng bộ cloud (playhtml) bị gửi đi *trước khi* `playhtml.init()` hoàn tất và
`registerPlayEventListener` được đăng ký xong. Điều này gây lỗi ngầm
`event "OTT_JOIN" not registered` (xác nhận được qua console khi tái hiện lỗi
bằng Playwright) — Host không hề nhận được thông báo qua kênh này.

Ngoài ra, hệ thống không có cơ chế tự đồng bộ lại (resync): nếu **bất kỳ** một
lần gửi trạng thái nào bị rớt trên mọi kênh (BroadcastChannel/WebRTC/playhtml) —
do race điều kiện trên, do kết nối WebRTC chưa kịp mở, mạng chập chờn... —
phía nhận sẽ bị "kẹt" vĩnh viễn ở trạng thái cũ, không có gì kích hoạt gửi lại.
Đây chính là lý do người chơi không thấy màn xếp quân xuất hiện, và phải chờ
đến khi Host tự đếm hết 30s rồi tự động xếp hộ toàn bộ quân.

**Hướng giải quyết** (`src/sync/usePlayRoom.js`):
1. Thêm cờ `playhtmlReadyRef`, chỉ đặt `true` (và chỉ dispatch `OTT_JOIN`) **sau
   khi** cả 2 `registerPlayEventListener` đã đăng ký xong — loại bỏ hoàn toàn
   race điều kiện gửi trước khi đăng ký.
2. Tách logic gửi trạng thái ra hàm `transmitState` dùng chung, và thêm một
   "nhịp tim" (`heartbeat`, mỗi 2.5s) tự gửi lại trạng thái mới nhất qua mọi
   kênh. Nếu 1 lần gửi bị rớt, bên nhận sẽ tự bắt kịp trong tối đa vài giây,
   không cần chờ tới hết giờ xếp quân.
3. Thêm cơ chế Khách tự kết nối lại (reconnect) WebRTC tới Host khi kết nối
   lỗi/rớt (`scheduleReconnect`, backoff tăng dần tới 5s) và `guestPeer.reconnect()`
   khi PeerJS báo `disconnected`, kèm gửi lại trạng thái hiện tại ngay khi kết
   nối lại thành công.

## Bug 2: Đỏ đi xong, Xanh không đi được quân

**Vấn đề:**
Nguyên nhân gốc giống Bug 1 — đây là hệ quả của việc thiếu cơ chế tự đồng bộ
lại khi một lần cập nhật trạng thái (nước đi của Đỏ) bị rớt trên đường truyền
tới máy của Xanh. Khi đó máy Xanh vẫn giữ `turn: 'red'` trong state cũ, khiến
`isMyTurn` luôn `false` và không cho phép chọn quân/đi.

Thêm vào đó, phần so sánh version/timestamp để quyết định có nhận trạng thái
mới hay không có rủi ro lệch giờ đồng hồ giữa 2 máy (dùng `updatedAt` là
timestamp tuyệt đối), và phía Host **chưa kiểm tra version** trước khi chấp
nhận `ACTION_STATE_UPDATE` gửi lên từ Khách — điều này sẽ nguy hiểm hơn khi đã
thêm heartbeat (có thể vô tình chấp nhận một state cũ được gửi lại).

**Hướng giải quyết** (`src/sync/usePlayRoom.js`):
1. Heartbeat + reconnect (xem Bug 1) giúp trạng thái nước đi của Đỏ luôn được
   gửi lại cho tới khi Xanh nhận được, không còn bị kẹt vĩnh viễn.
2. Thêm hàm `shouldAcceptIncomingState(incoming, current)`: so sánh `version`
   (bộ đếm tăng dần, đáng tin cậy tuyệt đối) trước, chỉ dùng `updatedAt` làm
   tiêu chí phụ khi 2 version bằng nhau — tránh lệch giờ giữa các máy làm mất
   nước đi mới hơn. Áp dụng hàm này thống nhất ở **mọi** điểm nhận trạng thái
   (BroadcastChannel, playhtml, WebRTC — cả phía Host và Khách).
3. Bổ sung kiểm tra `shouldAcceptIncomingState` trước khi Host chấp nhận
   `ACTION_STATE_UPDATE` từ Khách (trước đây chấp nhận vô điều kiện).

## Đã kiểm thử

Dùng Playwright (2 tab trong cùng 1 trình duyệt, mô phỏng kênh BroadcastChannel)
để tái hiện toàn bộ luồng: vào phòng → duyệt Đội Xanh → xếp quân Đỏ → xếp quân
Xanh → vào trận → Đỏ đi 1 nước → Xanh đi 1 nước. Sau khi sửa, cả 2 phía đều
đồng bộ đúng: màn xếp quân hiện ra ngay khi tới lượt (không cần chờ hết giờ),
và sau khi Đỏ đi, Xanh nhận được lượt và đi được nước tiếp theo — lịch sử nước
đi hiển thị đúng trên cả 2 máy (`Biên bản nước đi (2)`).

*Lưu ý:* Do sandbox không có kết nối Internet để tới được máy chủ tín hiệu
PeerJS/PartyKit thật, phần kiểm thử trên chỉ xác nhận được đường truyền qua
BroadcastChannel (2 tab cùng máy) và logic sửa lỗi ở tầng mã nguồn. Cơ chế
reconnect WebRTC và gating playhtml đã được review kỹ ở mức code nhưng nên
được xác nhận thêm trên môi trường thật (2 thiết bị khác nhau, có mạng) trước
khi coi là đã kiểm thử đầy đủ.
