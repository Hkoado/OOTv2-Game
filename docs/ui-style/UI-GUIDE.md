# UI guide · Giấy da & hầm ngục

## 1. Ý định thiết kế

Một giao diện game chiến thuật **2D phẳng, rõ và gọn**, gợi bản đồ bàn chơi fantasy bằng giấy và mực. Chất trung cổ nằm ở vật liệu nền, chữ serif và hình minh họa; thao tác vẫn phải dễ hiểu như một ứng dụng hiện đại.

Ba ưu tiên, theo thứ tự:

1. Người dùng nhìn ra trạng thái và biết thao tác tiếp theo.
2. Quân cờ, địa hình và chữ vẫn rõ ở kích thước sử dụng thực tế.
3. Không khí giấy da/hầm ngục bổ trợ cho hai mục tiêu trên.

## 2. Giữ phong cách, thiết kế lại cấu trúc

**Không dùng demo làm bản thiết kế cần dựng lại.** Không copy DOM, stylesheet, grid ba cột, sidebar, vị trí thẻ người chơi, thanh điều hướng, khung bàn cờ hoặc khoảng cách giữa các khối của demo.

Coding agent phải tự đề xuất cấu trúc dựa trên nội dung và luồng của màn hình mới. Có thể thay đổi số cột, cách nhóm thông tin, cách trình bày lượt, vị trí lịch sử hoặc dạng điều hướng. Không thay đổi một cách hình thức chỉ để khác screenshot: bố cục mới phải giải quyết một nhu cầu cụ thể của sản phẩm.

Các token là ngôn ngữ dùng chung, **không phải tọa độ bố cục**. Giá trị chiều cao nút, cỡ chữ và khoảng cách có thể dùng lại; chiều rộng sidebar, chiều cao header hay phép trừ viewport của demo không phải quy chuẩn.

Trước khi code, ghi ngắn gọn: tác vụ chính, thông tin ưu tiên, cấu trúc được chọn và lý do cấu trúc đó phù hợp. Không cần dựng một vòng xin duyệt riêng nếu công việc đã được giao rõ.

## 3. Hai theme

| Vai trò | Giấy da sáng | Hầm ngục tối |
| --- | --- | --- |
| Nền | Kem giấy ấm | Than đá hơi xanh xám |
| Bề mặt | Kem sáng hơn nền | Xám đá sáng hơn nền |
| Chữ | Mực nâu đậm | Ngà sáng |
| Màu nhấn | Nâu đồng | Đồng nhạt |
| Trang trí | Chữ cổ và hạt giấy rất mờ | Đường mạch đá rất mờ |
| Asset | Giữ màu gốc | Giữ màu gốc, không đảo màu |

- Dùng semantic token `color.bg.*`, `color.text.*`, `color.border.*` cho UI.
- Theme không được thay đổi layout, kích thước ảnh, vị trí nút hoặc logic chơi.
- Không dùng đen tuyệt đối hoặc trắng chói làm nền toàn trang. Phần trắng/đen bên trong hình quân cờ được giữ nguyên.
- Không dùng gradient trên panel/nút, bóng nổi, glow, bevel, kính mờ, phối cảnh nghiêng hoặc chất liệu 3D.

## 4. Token và cách mở rộng

Nguồn duy nhất: [tokens.json](tokens.json). CSS được sinh ra bằng [build-tokens.mjs](build-tokens.mjs).

| Nhóm | Ví dụ CSS variable | Mục đích |
| --- | --- | --- |
| Nền | `--ott-color-bg-surface` | Bề mặt chứa nội dung |
| Chữ | `--ott-color-text-primary` | Nội dung chính |
| Viền | `--ott-color-border-control` | Ranh giới control cần nhận diện |
| Nhấn | `--ott-color-accent-default` | Hành động hoặc trạng thái nổi bật |
| Trạng thái | `--ott-color-status-danger` | Màu trạng thái, kèm nhãn/icon |
| Khoảng cách | `--ott-space-5` | 16px |
| Chữ | `--ott-type-body-size` | 14px |
| Quân | `--ott-color-piece-surface` | Nền trung tính cho hình quân |
| Địa hình | `--ott-color-terrain-surface-water` | Màu nền hỗ trợ element nước |

- Đừng hardcode lại mã màu trong từng component.
- Nếu thiếu vai trò thật sự, thêm token có tên theo chức năng, khai báo đủ light/dark và sinh lại CSS.
- Không thêm token đặt tên theo vị trí như `left-card-color`, hay theo một trang chưa được xác nhận.
- Không biến mọi con số thành token: số cột, tỷ lệ phân vùng và độ rộng theo nội dung thuộc component/layout.
- Màu terrain là màu minh họa hoặc nền địa hình; không dùng chúng làm màu chữ chung.
- Màu `team.red/blue` dành cho viền/dấu trên nền quân trung tính. Không mặc định dùng chúng làm chữ trên nền hầm ngục; tên đội dùng text token.

## 5. Typography và ngôn ngữ

- **Noto Serif:** tên sản phẩm, tiêu đề màn hình, tiêu đề nhóm quan trọng. Không dùng serif cho mọi đoạn mô tả dài.
- **Be Vietnam Pro:** điều hướng, nút, thông số, luật, mô tả và biểu mẫu.
- Font phải hỗ trợ đầy đủ tiếng Việt. Kiểm tra: “Bụi cây”, “Nước”, “Đến lượt”, “Người chơi”, “Điểm thưởng”, “Hoàn tác”.
- Chữ thao tác thường 13–14px; nội dung đọc dài 14–16px. Chữ phụ tối thiểu 12px ở 100% zoom. Không sao chép các nhãn 7–9px của bản demo.
- Chỉ dùng chữ in hoa ngắn cho nhãn nhóm khi có ích; tránh cả đoạn in hoa và tracking rộng.
- Chữ viết tay chỉ là lớp nền trang trí, không dùng cho nhãn hay nội dung cần đọc.
- Viết ngắn: “Nước đi”, “Chơi lại”, “Chặn Kéo”. Bỏ slogan, lore và câu dẫn không giúp người dùng quyết định.
- Nếu đổi hình Kéo thành song kiếm, giữ tên/luật nhất quán với đặc tả sản phẩm. Style guide không tự đổi luật ăn quân.

## 6. Hình khối, mật độ và trang trí

- Ưu tiên khung chữ nhật, góc vuông hoặc bo 2px. Hình tròn dành cho quân cờ, avatar hoặc tín hiệu có nghĩa.
- Viền 1px cho phân cách phụ; 2px cho khung chính/trạng thái quan trọng. Không viền dày mọi lớp lồng nhau.
- Không dùng shadow để phân tầng. Dùng khoảng cách, nền và viền.
- Dùng hệ khoảng cách 4/8/12/16/24/32px; 2px chỉ cho tinh chỉnh nhỏ.
- Giao diện đầy đặn nhờ thông tin được nhóm tốt và cỡ chữ đủ lớn, không nhờ nhồi nhiều khung hoặc giảm khoảng thở.
- Mỗi vùng nội dung có một nhãn chính. Không lặp tiêu đề trong header, card và toolbar nếu không có ý nghĩa khác.

### Chữ cổ phía sau giấy da

- Trang trí tùy chọn; có thể bỏ nếu làm giảm độ rõ.
- Opacity mặc định khoảng 0.035, tối đa 0.06 cho toàn bộ lớp sau khi tính chồng lớp. Không nhân nhiều lớp rồi làm nền tối hơn dự kiến.
- Nằm dưới nội dung, không bắt pointer, không tham gia accessibility tree.
- Ưu tiên khoảng trống ngoài khu vực chơi. Không để nét chữ xuyên qua hình quân, con số hay nút.
- Không làm ảnh nền chữ mờ bằng cách blur toàn bộ container chứa nội dung.

## 7. Asset và màu của thế giới

Chi tiết kỹ thuật nằm trong [ASSET-GUIDE.md](ASSET-GUIDE.md).

- Hình 2D, viền mực rõ, ít đường bên trong, silhouette dễ nhận ra ở 32–48px.
- Quân cờ **đơn sắc**, nền trắng/ngà trung tính. Viền hoặc nhãn phân biệt đội; không tô màu bản thân hình đá, giấy và kiếm.
- Slot Kéo dùng **hai kiếm thẳng bắt chéo chữ X**, đủ cả lưỡi, chắn tay và chuôi.
- Địa hình có màu tiết chế: Lửa cam/vàng, Nước xanh lam/ngọc, Bụi cây xanh lá, Vực tối với mép đá.
- Địa hình là đặc điểm của ô: dùng cả nền ô và hình đủ lớn trong ô, không biến nó thành badge nhỏ lơ lửng. Giữ khoảng an toàn để không cắt asset.
- Quân đứng trên địa hình phải rõ: dùng nền quân trung tính và viền, không làm mờ địa hình hoặc đổi màu quân bằng filter.
- Không tự thêm tia sét, vũ khí, rune, đốm sáng hay phụ kiện lên asset đã chốt.

## 8. Component và trạng thái

Không có bộ component layout bắt buộc. Khi màn hình cần một loại control dưới đây, áp dụng hành vi tương ứng.

| Thành phần | Quy tắc |
| --- | --- |
| Button chính | Nền accent, chữ on-accent; có hover, pressed, focus và disabled |
| Button phụ | Nền surface hoặc trong suốt, viền control; cùng cỡ chữ và chiều cao với button chính |
| Icon button | Hình đơn giản, vùng bấm 36–40px; có tên truy cập và tooltip nếu ý nghĩa chưa rõ |
| Panel | Nền surface, viền hợp lý, padding 16px; không tự thêm tiêu đề nếu không cần |
| Input/select | Chữ body, nền surface, viền control; label ngoài field; lỗi bằng nhãn kèm màu |
| Tab | Phân biệt active bằng nét gạch hoặc viền và trọng lượng chữ; không chỉ dựa vào hue |
| Dialog | Ngắn, có tiêu đề, hành động rõ, trả focus về control mở dialog |
| Toast/status | Thông báo thay đổi cần biết; không thay hộp thoại quyết định hay nội dung quan trọng |

Ví dụ **component đơn lẻ**, không phải mẫu màn hình:

```css
.action-primary {
  min-block-size: var(--ott-control-height);
  padding-inline: var(--ott-control-padding-inline);
  border: var(--ott-border-hairline) solid var(--ott-color-accent-default);
  border-radius: var(--ott-radius-small);
  color: var(--ott-color-text-on-accent);
  background: var(--ott-color-accent-default);
  font: inherit;
  transition: background-color var(--ott-motion-fast) var(--ott-motion-ease);
}
.action-primary:hover:not(:disabled) {
  background: var(--ott-color-accent-hover);
}
.action-primary:active:not(:disabled) {
  background: var(--ott-color-accent-pressed);
}
.action-primary:focus-visible {
  outline: var(--ott-border-focus) solid var(--ott-color-focus);
  outline-offset: var(--ott-focus-offset);
}
.action-primary:disabled {
  background: var(--ott-color-bg-disabled);
  border-color: var(--ott-color-border-subtle);
  color: var(--ott-color-text-disabled);
  cursor: default;
}
```

### Trạng thái ô/quân nếu màn hình có bàn chơi

| Trạng thái | Cách thể hiện |
| --- | --- |
| Bình thường | Hình rõ, viền đủ phân biệt nền |
| Hover | Đổi viền hoặc nền nhẹ; không phóng/ép hình |
| Đang chọn | Viền mạnh và dấu chọn bổ sung; vẫn thấy toàn bộ hình |
| Có thể đi | Chấm hoặc vòng nhỏ tách khỏi hình địa hình |
| Có thể ăn | Vòng/viền khác và thông tin tên quân; không chỉ đổi đỏ/xanh |
| Vừa di chuyển | Viền hoặc dấu vị trí trước/sau, ưu tiên thấp hơn selected/focus |
| Không hợp lệ | Thông báo ngắn lý do; giữ bàn cờ ổn định |
| Focus bàn phím | Focus ring độc lập với selected, không bị clipping |

Ưu tiên lớp hiển thị: nền → địa hình → quân → dấu chọn/nước đi → focus. Không đặt một lớp highlight đặc che hình. Không dùng animation rung hoặc nhấp nháy cho thao tác sai.

## 9. Desktop và cách scale

- Thiết kế cho cửa sổ desktop thông thường; kiểm tra 1280×720, 1366×768, 1440×900 và cửa sổ rộng hơn khi cần.
- Nếu sản phẩm chỉ hỗ trợ desktop, không tự mở rộng phạm vi sang một thiết kế mobile hoàn chỉnh.
- Dùng grid/flex co giãn theo không gian thật. Đừng dùng `zoom`, scale toàn trang, hay thu nhỏ font để nhét màn hình.
- Xét cả chiều rộng và chiều cao. Bàn chơi lớn lên phải nhường chỗ cho thao tác và thông tin thiết yếu.
- Tách khả năng co của bàn chơi khỏi khả năng đọc của chữ. Khi thiếu chỗ, giảm trang trí và thông tin thứ cấp trước.
- Giữ ô vuông bằng `aspect-ratio: 1`. Không kéo bàn chơi thành hình chữ nhật để lấp vùng trống.
- Icon bên trong dùng `object-fit: contain` và tỷ lệ tự nhiên. Không đặt đồng thời hai kích thước làm méo ảnh.
- Một vùng lịch sử dài có thể cuộn riêng. Không ép toàn bộ nội dung dài vào một viewport bằng cách làm mọi thứ nhỏ đi.
- Khi cửa sổ dưới mức desktop được hỗ trợ, dùng một fallback có chủ đích; tránh để trang tràn ngang vô tình.
- Không sao chép công thức `calc(100vh - ...)` của demo. Tính vùng chơi còn lại từ layout mới, dùng vùng có thể co hoặc đo container khi cần.

## 10. Khả năng sử dụng và kiểm tra

- Mục tiêu chữ thường: tương phản ít nhất 4.5:1 với nền thực tế; ranh giới control và focus quan trọng ít nhất 3:1.
- `contrast-report.json` kiểm tra cặp token màu đặc. Nó không chứng minh mọi tổ hợp, texture, focus nền accent hay ảnh thực tế đều đạt.
- Border subtle chỉ là trang trí/phân cách. Nếu viền là tín hiệu duy nhất để nhận diện control, dùng border control.
- Không đặt nội dung quan trọng ở trạng thái disabled để né yêu cầu dễ đọc. Disabled thực sự mới dùng token disabled.
- Dùng semantic HTML; control có label/tên truy cập; thao tác được bằng bàn phím và focus nhìn thấy.
- Chỉ khai báo ARIA grid nếu đã triển khai hành vi bàn phím tương ứng. Một bàn cờ toàn button không tự nhiên trở thành grid keyboard hoàn chỉnh.
- Không truyền đạt đội, kết quả hoặc khả năng di chuyển chỉ bằng màu.
- Chuyển động chỉ cho màu/viền và phản hồi cần thiết, 120–180ms; tôn trọng reduced motion.
- Giữ nội dung có thể đọc khi zoom trình duyệt. Không khóa zoom.

## 11. Điều kiện nghiệm thu

- [ ] Layout xuất phát từ luồng sản phẩm; không tái tạo cấu trúc demo.
- [ ] Cả hai theme giữ cùng ý nghĩa, trạng thái và chức năng.
- [ ] Nội dung tiếng Việt đầy đủ dấu, không cắt phần dấu trên/dưới.
- [ ] Nhãn thiết yếu không nhỏ hơn 12px ở 100% zoom.
- [ ] Toàn bộ asset rõ ở kích thước sử dụng, không méo, không cắt mất.
- [ ] Quân đơn sắc; địa hình giữ màu; nền alpha sạch trên nền sáng và tối.
- [ ] Không filter tương phản/đảo màu asset, không tia sét hoặc hiệu ứng tự thêm.
- [ ] Chữ cổ và hạt nền không cạnh tranh với nội dung.
- [ ] Có trạng thái hover/focus/selected/disabled/error khi phù hợp.
- [ ] Luồng chính dùng được bằng bàn phím; không có control chỉ là hình trang trí.
- [ ] Desktop không tràn ngang hoặc che thao tác chính ở kích thước mục tiêu.
- [ ] Token CSS khớp JSON; kiểm tra màu và kiểm tra trực quan đã thực hiện.

Một giao diện cùng phong cách có thể trông khác demo đáng kể về bố cục. Đó là kết quả đúng nếu tác vụ rõ, chữ dễ đọc, hình đúng phong cách và các trạng thái nhất quán.
