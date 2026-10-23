# Luật Campus v2 — 24/10/2026

Quyết định trực tiếp mới của BTC thay phần địa hình/xếp trước sau trong docs v1.
Các quyết định khác (điểm, thắng, giới hạn, sandbox) không thay đổi.

## Địa hình

`map.v2` / `ott-campus.v2`, field `terrains: { e4: "fire", e6: "fire" }`.
`blocked` luôn rỗng; map v1 giữ nguyên để bảo toàn hash/replay.

| Asset sẵn có | Cản loại quân |
|---|---|
| fire / Lửa | paper / Bao |
| water / Nước | scissors / Kéo |
| bush / Bụi cây | rock / Búa |
| chasm / Vực | Tất cả |

Cấm đặt hoặc đi/bắt quân vào ô cản loại quân đó. Không gây sát thương, mất lượt,
che thông tin hoặc biến loại quân. Giữ luật cắt góc: cấm đi chéo khi cả hai ô kề
cạnh cản loại quân đang đi. Map đối xứng 180°, không đặt địa hình lên nhà chính;
kiểm đường đi và số ô setup riêng từng loại. Validator bảo thủ yêu cầu mỗi loại
còn ít nhất 9 ô setup và hai lối đi theo kiểm đồ thị v1.

BTC mở trang giải → bút địa hình map chính/dự phòng (dùng atlas có sẵn), lưu nháp;
đánh dấu công bố/khóa rồi lưu. Đội thuộc giải xem/tải JSON trước khi thiết kế bot.
Sau công bố không sửa map/revision/pack hoặc thu hồi. SQL trigger chống race:
`supabase/migrations/20261024180000_lock_published_maps.sql` (chưa apply remote).

## Setup bot

V2 vẫn dùng envelope `bot.v1`, thêm `setupVisibility: sealed` và
`availableSquaresByType` trong observation. Hai request có thể chạy tuần tự nhưng
không chứa quân đối phương khi setup. Chỉ mở đầy đủ sau cả hai setup thành công.
Đỏ vẫn đi trước. Bot mẫu `examples/campus_bot.py` tìm 9 ô hợp lệ khác nhau.
**Chốt bổ sung của người dùng:** offline vẫn xếp tay (đổi/nhấc quân, Xếp nhanh);
bot bắt buộc được viết cả thuật toán xếp quân và đi quân trước khi nộp. Có thể tính đội
hình từ màu/map được cấp, không bắt buộc hardcode vị trí. Không xếp tay hay auto-fill hộ bot.
Offline cùng máy thao tác lần lượt nhưng bàn chỉ hiển thị quân của người đang xếp;
sau cả hai xác nhận mới hiển thị 18 quân. Không coi việc ẩn UI là bảo mật trước DevTools.
Map mẫu hiện hành: `learn-fire`, `learn-water`, `learn-bush`, `learn-chasm`,
`campus-four-terrains`; dùng chung cho offline, menu thiết lập giải và JSON examples.
Engine room/P2P, replay MVP, map v1 giữ luật lịch sử, không âm thầm đổi.

## Phân màu

Đơn vị "trận" của quy tắc phân màu là một ván đơn. Lịch sử chỉ trong cùng vòng;
vòng bảng dùng roundId `group`, knockout dùng stage. Không dùng kết quả vòng trước.
Ưu tiên giảm số đội phải lặp màu; nếu xung đột: thua nhiều hơn → thắng ít hơn →
seed lưu (không RNG/clock bên ngoài). Hòa không tăng thắng/thua.

`nextOfficialGroupGame` / `nextOfficialKnockoutGame` tính **ván kế tiếp** từ prefix
kết quả đã chốt; không tính màu tương lai bằng kết quả chưa biết. Trả DTO màu cho
lớp điều phối lưu/công bố trước khi chạy. Kết quả phải mang redParticipantId và
blueParticipantId đúng màu đã chốt. Aggregator nhận `colorPolicy:
alternate-loss-priority.v1` để tính điểm theo màu mới, không đổi công thức điểm.

**Giới hạn tích hợp:** scheduler chính thức chưa có persistence/queue/API runtime;
chưa có UI công bố màu trước ván. Các hàm mới không tự enqueue và không mở gate MVP.
Để nghiệm thu yêu cầu công bố màu end-to-end cần nối DTO này vào runtime chính thức
ở milestone sau; không gọi đây là tính năng production hoàn tất.

## Kiểm tra

`npm.cmd test`, `npm.cmd run build`; `tests/terrainRulesV2.test.js` có trusted Python
sample E2E + replay verification, luật 4 terrain/setup kín/màu/hồi quy v1.
`tests/terrainPublication.test.js` dùng PostgREST mock, không gọi DB thật.
Không deploy/apply migration; chưa nghiệm thu Supabase thật, sandbox hoặc phòng hai máy.