# OTT-v2 · UI style kit

Bộ tài liệu này chuyển giao **ngôn ngữ thị giác**, không chuyển giao bố cục demo.

Để gắn vào OTTv2 đã có, bắt đầu từ [mục lục bộ docs](../README.md), [hướng dẫn tích hợp repo](../05-TICH-HOP-UI-VA-REPO.md) và [brief riêng cho repo](REPO-INTEGRATION-BRIEF.md). Hướng dẫn tích hợp chỉ rõ scope CSS, view theo vai trò và dependency backend; không áp ví dụ body toàn cục dưới đây vào game cũ mà chưa kiểm tra.

Đọc theo thứ tự:

1. [UI-GUIDE.md](UI-GUIDE.md): nguyên tắc thiết kế và hành vi giao diện.
2. [ASSET-GUIDE.md](ASSET-GUIDE.md): phong cách hình, xử lý alpha, giữ tỷ lệ.
3. [tokens.json](tokens.json): nguồn token duy nhất, gồm light/dark.
4. [tokens.css](tokens.css): CSS variables sinh từ JSON, dùng trực tiếp.
5. [AGENT-BRIEF.md](AGENT-BRIEF.md): prompt có thể giao cho coding agent.

Chạy `node docs/ui-style/build-tokens.mjs` từ thư mục gốc để sinh lại CSS và kiểm tra các cặp màu chính. Không cần cài thư viện.

## Phạm vi

- Giữ: giấy da sáng, đá hầm ngục tối, nét mực rõ, hình 2D đơn giản, quân đơn sắc, địa hình có màu.
- Thiết kế mới: cấu trúc màn hình, điều hướng, cách nhóm thông tin, vị trí thao tác và cách bố trí bàn chơi.
- Không sao chép: layout ba cột, vị trí thẻ, kích thước sidebar, nội dung và CSS của `demo-ui`.
- Các ảnh trong demo chỉ tham khảo phong cách asset. Screenshot không phải wireframe hay tiêu chí so khớp pixel.
- Luật và luồng sản phẩm phải lấy từ đặc tả chức năng được chọn cho công việc đó. Style kit không thay thế đặc tả game hoặc quyết định lại luật chơi.

## Dùng trong dự án

```css
@import './tokens.css';

body {
  color: var(--ott-color-text-primary);
  background: var(--ott-color-bg-canvas);
  font-family: var(--ott-font-body);
  font-size: var(--ott-type-body-size);
  line-height: var(--ott-type-body-line-height);
}
```

Đặt `data-theme="light"` hoặc `data-theme="dark"` trên phần tử `html`. CSS mặc định là light. Lưu lựa chọn người dùng nếu sản phẩm có chuyển theme; không đổi theme giữa phiên một cách bất ngờ.

Token JSON dùng schema đơn giản của dự án: `foundations`, `components`, `themes`. Đây không phải tệp import DTCG/Figma trực tiếp. Nếu cần tích hợp công cụ khác, viết adapter từ nguồn JSON này, tránh duy trì thêm bảng màu bằng tay.

Thư mục `references` có một ảnh gồm các element rời để agent hiểu nét hình. Bộ kit không kèm screenshot màn hình hay template layout. Có thể chuyển riêng toàn bộ thư mục này cho agent; không cần gửi mã demo để dùng tài liệu và token.
