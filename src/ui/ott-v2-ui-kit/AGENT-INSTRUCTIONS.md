# Chỉ dẫn tích hợp cho coding agent

Người dùng đã chốt hình thức bàn cờ OTT-v2 và yêu cầu tái sử dụng component có sẵn. Không tái dựng bàn cờ bằng suy diễn từ mô tả hoặc screenshot.

## Việc phải làm

1. Đọc yêu cầu chức năng, AGENTS.md và state/handler thật trong repo đích. Giữ stack và logic hiện có.
2. Đưa toàn bộ thư mục `ott-v2-ui-kit` vào một vị trí ổn định trong source, hoặc dùng dependency local tương đương.
3. Import `ui-kit.css` một lần. Đặt đúng vùng giao diện trong `.ott-ui` và `data-theme="light|dark"`.
4. React dùng `OTTBoard` trong `react/index.mjs`; JavaScript thuần dùng `mountBoard` trong `board.mjs`.
5. Dùng các factory/wrapper cho quân, terrain, thẻ đội, unit button, trạng thái lượt và thanh thao tác. Asset đã có alpha thật, font đã có trong thư mục.
6. Viết adapter nhỏ từ snapshot ứng dụng sang props: pieces, terrain, selection, valid moves, orientation, readOnly và callback. Không đưa fixture của catalog vào flow production.
7. Giữ `rock/paper/scissors` làm key luật. `scissors` dùng hình hai kiếm, không phải một loại quân mới.
8. Dùng đúng map/terrain/luật được đặc tả cho milestone. Có hình lửa/nước/bụi cây không có nghĩa app phải hỗ trợ luật mới.
9. Kích thước bàn được điều khiển bằng chiều rộng container. Hình, ô và trục bên trong giữ nguyên tỷ lệ và style.
10. Nối callback vào flow thật; quyền chỉ xem phải có cả kiểm tra backend khi sản phẩm yêu cầu. Component UI không phải authorization layer.

## Không làm

- Không dựng grid bàn cờ khác, thay hình quân bằng emoji, tự vẽ terrain mới hoặc đổi file atlas.
- Không chép stylesheet demo cũ, không import `showcase.css` hay logic `showcase.mjs` vào sản phẩm.
- Không chỉnh riêng width/height ảnh gây méo, không filter/invert/contrast, không cắt vùng atlas tùy ý.
- Không sửa rule engine để khớp dữ liệu mẫu của catalog.
- Không tạo app thay thế, router mới, backend mới hoặc chuyển stack chỉ để dùng kit.
- Không coi yêu cầu “bố cục mới” trong style guide cũ là yêu cầu tự vẽ lại component. Kit này là phần code tái sử dụng được người dùng yêu cầu bổ sung.
- Không giữ cỡ chữ tí hon của demo nếu nội dung mới cần đọc. Component đã dùng cỡ chữ rõ hơn; giữ hierarchy này khi ghép trang.

## Phần được tự thiết kế

Layout ngoài component: sảnh, tournament, phòng đấu, điều hướng, cách nhóm các panel, vị trí lịch sử và thao tác. Có thể thay cách ghép các thành phần để phù hợp tác vụ, không phải copy layout catalog hay demo.

Nếu thật sự cần thay đổi cấu trúc bên trong bàn, nêu lý do và làm thành biến thể có prop rõ ràng. Không âm thầm ghi đè một loạt CSS để thành bàn khác.

## Kiểm tra trước bàn giao

- Build dự án thật, không chỉ mở catalog.
- Kiểm 81 ô, tọa độ a1–i9, orientation red/blue và dữ liệu mỗi ô.
- Chọn quân/đi/ăn/hoàn tác/chơi lại dùng flow hiện có; không fake callback thành thành công.
- Light/dark, tiếng Việt, ảnh đúng tỷ lệ, font offline, focus bàn phím và chế độ chỉ xem.
- Cửa sổ desktop thông thường không bị tràn ngang hoặc che thao tác chính.
- Nêu file tích hợp, adapter đã viết và những gì chưa chạy được. Không khẳng định React build đã pass chỉ vì test thuần của kit pass.

## Prompt giao việc ngắn

> Tích hợp [màn hình/tính năng] vào repo hiện có. Dùng trực tiếp `ott-v2-ui-kit` cho bàn cờ và các thành phần đã chốt; đọc README và AGENT-INSTRUCTIONS trong kit. Không tự vẽ lại board, square, piece, terrain hoặc trục tọa độ. Chỉ thiết kế cách ghép component bên ngoài cho phù hợp tác vụ. Nối props/callback với state, rule engine và backend hiện có; giữ quyền/luật theo đặc tả milestone. Hoàn tất build và kiểm tra trong app thật.
