# Map luyện tập Campus v2

| File | Nội dung |
|---|---|
| learn-fire.json | Lửa cản Bao |
| learn-water.json | Nước cản Kéo |
| learn-bush.json | Bụi cây cản Búa |
| learn-chasm.json | Vực cản tất cả |
| campus-four-terrains.json | Đủ 4 loại ở sân nhà và trung tâm |

Các map đối xứng 180°, dùng được khi xếp tay offline và viết bot tự xếp quân.
Nguồn là `src/game/sampleMaps.js`; tái sinh từ root bằng
`node tools/cli/generate-sample-maps.js`. Offline có nút tải JSON cùng nội dung.

Các file map.v1 khác trong thư mục là fixture/demo lịch sử, không phải map mới để
tạo giải Campus. Không sửa chúng để bảo toàn replay/hash cũ.