# Brief giao coding agent

Copy phần sau, điền nhiệm vụ cụ thể rồi gửi kèm thư mục `docs/ui-style`. Đây là brief cho công việc được giao, không tự tạo thêm yêu cầu triển khai hay phát hành.

---

Bạn cần triển khai **[màn hình / luồng / tính năng]** cho **[sản phẩm]**.

## Nguồn yêu cầu

- Yêu cầu người dùng: **[điền nội dung và kết quả mong muốn]**.
- Đặc tả chức năng/luật được chọn: **[đường dẫn hoặc mô tả]**.
- Phạm vi và ràng buộc kỹ thuật: **[framework, desktop, tích hợp, dữ liệu nếu có]**.
- Phong cách: `docs/ui-style/UI-GUIDE.md`.
- Asset: `docs/ui-style/ASSET-GUIDE.md`.
- Token: `docs/ui-style/tokens.json`; dùng `tokens.css` đã sinh hoặc adapter tương đương từ JSON.

Nếu đặc tả chưa rõ, dùng thông tin đã có để tiến hành phần độc lập; chỉ hỏi những điều thực sự ảnh hưởng chức năng hoặc quyết định thiết kế. Không suy luật game từ màu hay ảnh minh họa.

## Hướng thiết kế

Giữ phong cách giấy da sáng / hầm ngục tối, hình 2D phẳng, viền mực rõ, serif ở tiêu đề và sans hỗ trợ tiếng Việt ở nội dung. Giao diện gọn, cỡ chữ đủ đọc, ít chữ trang trí. Hình đơn giản và có alpha sạch; quân đơn sắc, địa hình có màu tự nhiên. Kéo được biểu diễn bằng hai kiếm bắt chéo nếu sản phẩm dùng bộ ký hiệu OTT-v2.

**Phải tự thiết kế cấu trúc màn hình phù hợp luồng được giao. Không dựng lại layout demo.** Không copy grid ba cột, vị trí thẻ, điều hướng, sidebar, kích thước khung bàn hoặc stylesheet của `demo-ui`. Screenshot chỉ thể hiện chất liệu, nét vẽ và mức độ đơn giản của asset; không dùng làm mục tiêu so khớp pixel.

Trước khi code, ghi ngắn gọn tác vụ chính, thứ tự thông tin và lựa chọn cấu trúc. Tiếp tục triển khai trong phạm vi được giao; không tự thêm một bước xin duyệt bố cục.

## Quy tắc triển khai

1. Dùng semantic token cho màu, type, spacing và trạng thái. Thêm token có chủ đích nếu thiếu; giữ đủ hai theme.
2. Không lấy cỡ chữ siêu nhỏ của demo làm chuẩn. Nội dung body 14–16px, nhãn phụ tối thiểu 12px ở 100% zoom.
3. Không bóp méo ảnh, không cắt mất đầu kiếm/cán/đường viền; không làm mất fill trắng. Không dùng filter hoặc blend mode để giả tách nền.
4. Không thêm tia sét, glow, ký hiệu, hiệu ứng 3D hoặc trang trí chưa được yêu cầu lên asset.
5. Theme không thay đổi ý nghĩa và chức năng; asset giữ nguyên màu gốc. Quân ở nền trung tính, viền/dấu phân biệt đội.
6. Control phải hoạt động thật: hover/focus/selected/disabled/error khi phù hợp. Dùng semantic HTML và tên truy cập.
7. Bố cục desktop xét cả chiều cao và chiều rộng; không CSS zoom hoặc scale toàn trang. Giữ tỷ lệ vuông nếu có ô/bàn chơi.
8. Không thay luật hoặc copy logic demo nếu không được yêu cầu. Đọc đặc tả chức năng đã chỉ định.
9. Nếu cần asset mới, xác định đây là tạo mới, tham khảo phong cách hay tách nguyên ảnh. Ghi nguồn và pipeline đúng với việc đã làm.
10. Không thêm nội dung, tính năng hoặc bước phát hành ngoài phạm vi công việc.

## Kiểm tra và bàn giao

- Chạy `node docs/ui-style/build-tokens.mjs` nếu có sửa token. Không sửa file CSS sinh ra bằng tay.
- Kiểm tra trực quan hai theme ở các kích thước desktop mục tiêu; mặc định 1280×720 và 1366×768, mở rộng khi layout cần.
- Kiểm tra chữ có dấu, focus bàn phím, trạng thái và ảnh trên cả nền sáng/tối.
- Xác minh không tràn ngang vô tình, không che thao tác chính, không kéo méo hình.
- Chạy kiểm tra chức năng phù hợp thay đổi; không thêm test chỉ lặp lại stylesheet.
- Bàn giao kết quả có thể mở xem, danh sách file chính, kiểm tra đã thực hiện và giới hạn còn lại nếu có.
- Nêu ngắn gọn bố cục mới phục vụ tác vụ thế nào. Không dùng “giống screenshot” làm lý do thiết kế.

---
