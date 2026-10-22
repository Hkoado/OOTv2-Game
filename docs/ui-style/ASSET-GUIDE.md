# Asset guide · Ít chi tiết, nét rõ

## 1. Hướng hình ảnh

Hình minh họa 2D đơn giản với viền mực tối, các mảng phẳng, ít đường mô tả bên trong. Nhận ra ngay loại element quan trọng hơn tính chân thực.

| Loại | Dấu hiệu cần giữ | Chi tiết cần bỏ |
| --- | --- | --- |
| Đá / Đấm | Khối đá thấp, tròn hoặc bất quy tắc; 1–2 nét nứt | Chấm li ti, vân đá dày, ánh sáng bóng |
| Giấy / Bao | Thuyền giấy; các nếp gấp lớn | Chữ trên giấy, ribbon, hatching dày |
| Kéo / song kiếm | Hai kiếm thẳng bắt chéo chữ X, có cán và chắn tay | Mạ vàng, rune, hoa văn, ánh sáng trên lưỡi |
| Lửa | 2–3 ngọn lửa rõ; cam/vàng | Đốm lửa dày, đá vụn, cột khói |
| Nước | Mảng nước xanh; 3–4 đường gợn | Đá, cây thủy sinh, bọt và sóng vụn |
| Bụi cây | Vài khối tán thấp xanh lá, ít dấu lá | Cây thân cao, hàng chục lá nhỏ |
| Vực | Lòng tối, mép đá đứt đoạn rõ | Vách đá chi chít, cảnh núi hoặc phối cảnh sâu cầu kỳ |
| Công trình nếu cần | Silhouette tháp/cổng nhận diện được | Từng viên gạch, cảnh quan quanh lâu đài |

Các ví dụ trên mô tả hình, không quy định số quân, số địa hình hay luật chặn. Không tự tạo thêm một loại địa hình từ minh họa.

## 2. Màu

- Quân và hình công trình trên token quân: đen/trắng/xám/ngà. Không tô màu theo đội.
- Phân biệt đội bằng viền, dấu hoặc tên, dùng token semantic và tín hiệu ngoài màu khi cần.
- Địa hình dùng màu tự nhiên, 2–3 mảng màu mỗi element. Nét viền vẫn tối để giữ silhouette.
- “Phẳng” nghĩa là tránh render ánh sáng và vật liệu nổi; không bắt buộc mỗi hình chỉ có một màu.
- Giữ nguyên màu asset khi đổi light/dark. Đặt quân đơn sắc trên nền trung tính sáng để không mất nét đen ở theme tối.
- Không dùng CSS `contrast()`, `invert()`, `brightness()` hoặc `mix-blend-mode` để giả tách nền hay sửa màu.

## 3. Đầu vào và quyền dùng

- Xác định rõ ảnh nào là tham khảo phong cách, ảnh nào cần trích nguyên element và ảnh nào được phép vẽ lại.
- Không gọi một asset vẽ lại là bản cắt pixel chính xác từ ảnh gốc.
- Không coi một ảnh tham khảo là giấy phép phát hành thương mại. Trước khi phát hành, xác nhận nguồn/quyền sử dụng hoặc dùng asset được cấp phép rõ ràng. Ghi nguồn cùng file.
- Nếu thay asset đã có, giữ bản gốc và dùng tên mới có nghĩa; cập nhật manifest tiêu thụ.

## 4. Tách nền đúng

1. Dùng nguồn có độ phân giải đủ; xác định cả silhouette và các lỗ rỗng bên trong.
2. Xuất PNG RGBA với alpha thật hoặc SVG nền trong suốt. Không vẽ caro giả vào ảnh.
3. Chỉ nền ngoài và lỗ rỗng phải trong suốt. Thân thuyền giấy, đá trắng, lưỡi kiếm vẫn có fill đục.
4. Giữ đủ đầu kiếm, chuôi, mép lửa, lá ngoài cùng và đỉnh tháp. Không cắt theo lưới atlas nếu hình vượt ô danh nghĩa.
5. Xem ảnh trên nền kem, than, trắng và màu bão hòa tạm thời để phát hiện viền trắng/đen, quầng màu và nền sót.
6. Kiểm tra ở 100% lẫn kích thước sử dụng. Mép alpha mượt không đồng nghĩa blur toàn bộ hình.
7. Kiểm tra alpha tại khoảng trống và độ đục bên trong đối tượng; không dựa vào việc ảnh nhìn ổn trên đúng một nền.

Không xóa toàn bộ pixel trắng: thao tác đó sẽ làm thủng phần giấy và kim loại. Không dùng ngưỡng tương phản cao vì nó làm đứt nét và mất chi tiết.

## 5. Tỷ lệ và kích thước

**Không bóp méo hình.** Đây là ràng buộc bắt buộc.

- Ưu tiên một PNG riêng cho một element nếu pipeline cho phép; dễ xác minh alpha và tránh tràn vùng atlas.
- Khi dùng atlas, lưu vùng cắt bằng tọa độ theo kích thước ảnh thật, bao gồm padding trong suốt. Có thể scan alpha để hỗ trợ, nhưng phải kiểm tra trực quan các element gần nhau.
- Căn giữa theo phần hình nhìn thấy, không theo một vùng cắt có khoảng trống lệch lớn.
- Giữ khoảng trong suốt an toàn khoảng 6% mỗi phía; `art.*-coverage` là mục tiêu quang học, không được ép fill đến mức cắt hình.
- Mỗi asset nên có số pixel ít nhất gấp đôi kích thước CSS lớn nhất dự kiến; không phóng một icon 32px lên 128px rồi gọi là rõ nét.
- Nếu chi tiết không còn nhận ra ở 32–48px, giản lược hình. Không tăng độ tương phản để cứu hình quá phức tạp.

Ví dụ ảnh độc lập, không phải template layout:

```css
.asset-frame {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
}
.asset-frame img {
  display: block;
  max-inline-size: 100%;
  max-block-size: 100%;
  inline-size: auto;
  block-size: auto;
  object-fit: contain;
}
```

Nếu runtime dùng crop atlas: tỷ lệ hiển thị của toàn ảnh phải bằng tỷ lệ ảnh nguồn, và khung crop phải khớp tọa độ vùng. Không đặt độc lập `width: 100%` và `height: 100%` cho ảnh bất kỳ với `object-fit: fill`.

## 6. File và manifest

Với một bộ mới, dùng tên rõ nghĩa như `piece-rock.png`, `piece-paper.png`, `piece-crossed-swords.png`, `terrain-fire.png`. Nếu dùng atlas, tách manifest khỏi UI để tránh hardcode vùng cắt rải rác.

Ghi: tên asset, file nguồn, kích thước gốc, vùng cắt nếu có, nội dung thay thế/nhãn ở component cha và nguồn hoặc prompt tạo hình. Tên hiển thị và khóa luật không nhất thiết giống tên file; mapping phải được khai báo rõ.

Không áp một kích thước SVG cố định lên mọi SVG lồng trong sprite. Không lấy toàn bộ spritesheet làm CSS background co giãn tùy ý.

## 7. Tham khảo hiện có

- [Bộ hình đơn giản](references/style-elements.png): tham khảo **mức độ giản lược, viền và màu**, không phải yêu cầu phải dùng đúng atlas này.
- [Nguồn ảnh và cách dùng tham khảo](references/README.md).
- Không dùng screenshot cả trang làm mẫu bố cục.

## 8. Prompt khởi điểm cho hình mới

Thay `[ELEMENT]`, `[COLOR]`, `[SIZE]` theo nhu cầu thực tế; chỉ đưa ảnh tham khảo đã được phép dùng.

> Create one simple 2D fantasy board-game element: [ELEMENT]. Bold clean dark ink outline, instantly recognizable silhouette at [SIZE] CSS pixels, very few internal lines, flat [COLOR] fills. True transparent alpha outside the object, solid opaque interior. Preserve natural proportions; no stretched geometry. Keep the complete object with safe transparent padding. No stippling, dense hatching, grain, tiny details, text, labels, ribbons, additional symbols, lightning, glow, cast shadows or 3D rendering. Match the simplicity of the supplied reference, not its page layout. For playing pieces use monochrome black/white/neutral gray only. For terrain retain restrained natural colors.

Nếu cần **trích nguyên ảnh gốc**, thay yêu cầu tạo mới bằng yêu cầu background extraction, liệt kê rõ phần phải giữ nguyên. Không dùng prompt tạo mới rồi mô tả kết quả là tách nguyên bản.
