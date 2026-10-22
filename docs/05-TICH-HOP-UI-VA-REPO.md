# Tích hợp UI giấy da/hầm ngục vào OTTv2 hiện có

Ngày 22/10/2026. Đây là đặc tả UI sản phẩm và kế hoạch tích hợp; không chứa yêu cầu dựng lại demo. Đọc cùng [đặc tả kỹ thuật](03-DAC-TA-KY-THUAT.md) và [style kit](ui-style/README.md).

## 1. Mục tiêu

Nộp bot online dùng [GitHub sync](06-GITHUB-NOP-BOT-VA-LUU-TRU.md): đăng ký repo/branch, push `bot.py`, hệ thống tự lấy/check/chốt SHA. Upload file chỉ fallback BTC bật; offline vẫn phát/thu file qua USB. UI phải phân biệt đã push, đã sync, valid và frozen.

Đội thi cần biết đang dự giải/vòng nào, map gì, nộp bản nào, khi nào khóa bài và được xem trận nào. BTC cần chuẩn bị map, kiểm tra bài, vận hành chấm, xem diễn biến, phân xử và cấp vé. Mỹ thuật giấy da/hầm ngục phải làm các tác vụ này rõ hơn, không che thông tin bằng trang trí.

Phong cách dùng bộ người tổ chức cung cấp: Noto Serif cho tiêu đề, Be Vietnam Pro cho nội dung; giấy kem/mực nâu ở light, đá than/ngà ở dark; panel phẳng, góc nhỏ, viền rõ, không glow/gradient/shadow nổi. Token/asset guide là nguồn thị giác. Không sao chép bố cục ba cột hoặc CSS demo.

## 2. Hiện trạng và ranh giới thay đổi

Đã khảo sát Ex2 `0a0b6b5c2992aa8973c6a052da6eff026800e897` và nhánh `tournament/initial` `78cb8e20e83bf9d42445f3f166d42c09f95a7247`; khi code phải kiểm tra lại checkout.

| Đang có / thiết kế cũ | Tích hợp cần làm |
| --- | --- |
| React/Vite, CSS, lucide-react | Giữ stack; tạo component CSS dùng semantic token, không thêm framework UI chỉ để đổi style |
| `src/index.css` theme sáng xanh lá | Style giấy da/hầm ngục áp cho tournament mới; CSS scoped, không tìm/thay toàn cục các màu cũ |
| `src/components/Board`, `Square`, `Piece` | Tái dùng/adapter phần render; giữ nguyên khóa `rock/paper/scissors` và luật |
| `src/sync/usePlayRoom.js` | Giữ game chơi tay/room/spectator; tournament viewer không dùng P2P làm nguồn kết quả |
| `src/tournament/*` trên nhánh tournament | Mở rộng các view đã có, không tạo app song song thay thế |
| MVP 8 đội/30 ván, subprocess local | UI thể hiện cấu hình event thật; auth/sandbox/scale cần milestone backend, không fake bằng UI |
| Quy định viết lại bot/giữ map kín trong bản cũ | Đã thay: bot cũ dùng/sửa được; map công bố trước; không countdown tiết lộ map |
| Spectator public hoặc viewer mọi thiết bị | Trận online ACL theo round; offline chỉ BTC xem localhost |

Thay hình quân là thay biểu diễn, không đổi key/protocol/replay: `rock -> đá/Búa`, `paper -> thuyền giấy/Bao`, `scissors -> song kiếm/Kéo`. Label và legend giữ tên luật để sinh viên hiểu. Lửa/nước/bụi cây/vực trong ảnh là tham khảo hình; v1 chỉ có ô cản. Không thêm terrain effect, nhảy sông, mất lượt hoặc biến loại quân từ asset.

## 3. Điều hướng theo vai trò

Giữ cách vào tournament bằng tab/route nhẹ phù hợp App hiện có. Các tên dưới là view hợp lý, không bắt buộc cài router mới.

| Vai trò | Khu vực |
| --- | --- |
| Đội online | Tổng quan · Bot của đội · Luyện tập · Giải đấu · Map & tài liệu |
| Trong một giải | Tổng quan · Bảng/nhánh đấu · Trận được xem · Map · Kết quả & vé |
| BTC | Giải đấu · Đội & bài nộp · Map · Vận hành chấm · Kết quả & phân xử · Vé · Sao lưu/offline |
| Judge/operator | Chỉ các mục theo scope từ server, không giả làm admin qua localStorage |
| BTC offline | Sự kiện hiện tại · Thu bài · Chấm & xem trận · Kết quả · Backup/xuất kết quả |

Context đầu trang luôn rõ: tên sự kiện, cấp tuần/tháng/kỳ, vòng hiện tại và trạng thái. Không dùng một badge “offline” để chỉ mất kết nối online: phân biệt **“Chế độ thi offline”** và **“Mất kết nối máy chủ”**.

## 4. Các màn hình và hành vi cần triển khai

| View | Thông tin chính | Thao tác chính | Điều kiện/trạng thái |
| --- | --- | --- | --- |
| Tổng quan đội | Giải đã đăng ký, hạn nộp gần nhất, bản hợp lệ, vé hiện có | Mở giải/Nộp bot | Không tự đăng ký giải tháng/kỳ nếu chưa có vé |
| Bot của đội | Repo/branch/path, quyền đọc, lần sync/SHA/quota, candidate/valid/frozen | Kết nối repo/Cập nhật bot từ GitHub | Fetch/check lỗi giữ valid cũ; SHA resolve trước cutoff mới tính; file upload chỉ fallback |
| Luyện tập | Chọn bot/map/bot mẫu, quota còn lại, lịch sử | Chạy thử/Xem lại | Job queued/running/done/fault; chỉ practice đội mình |
| Danh sách giải | Tuần/tháng/kỳ, lịch, đăng ký/vé | Xem chi tiết/Đăng ký nếu đủ quyền | Phân biệt đủ điều kiện, đã có vé, hết hạn, không tham gia |
| Chi tiết giải | Map đã công bố, cutoff, đội tham gia, bảng/bracket và luật số ván | Nộp bài/Xem vòng | Dữ liệu event thật, không hardcode luôn Top16 |
| Trận được xem online | Trận trong đúng round của đội, trạng thái, cặp đấu, map | Xem trực tiếp/Xem lại | Backend filter; không tự hiện trận vòng sau rồi che bằng overlay |
| Player hai bot | Bàn, màu/đội, điểm cặp, ván mấy/tổng, phase, nước đi, map version | Theo dõi trực tiếp hoặc điều khiển replay | Read-only; không có nút đi quân của mode chơi tay |
| Map & tài liệu | JSON/preview/hash/version, main/reserve, lịch áp dụng, API/bot mẫu | Tải map/tài liệu | Hiện map từ trước; draft chưa duyệt chỉ BTC |
| Dashboard BTC | Tiến độ, queued/running/fault, worker heartbeat, việc cần xử lý | Mở hàng đợi/Chi tiết lỗi | Tách bot fault khỏi infra fault; không biến lỗi máy thành hòa |
| Editor map BTC | Lưới9×9, base/vùng xếp, ô cản, mirror 180°, kết quả validation | Validate/Duyệt/Công bố/Khóa | Đã published/locked chỉ tạo revision mới; không thêm loại terrain ngoài schema |
| Thu bài offline BTC | Team/round, file/hash, giờ seal, check status và receipt | Import/Xác nhận | Nộp nguyên bot cũ hợp lệ được chấp nhận; import muộn vẫn theo seal ledger |
| Kết quả/vé | Provisional/final, khiếu nại, thứ hạng, vé/chuyển vé | Đề nghị/Duyệt/Finalize theo role | Hai người duyệt quyết định đổi điểm; vé không trùng |

Màn hình đội offline không cần web app riêng: Python, bot cũ, simulator và tài liệu/map local là đủ. Không tạo kết nối LAN, dashboard xem trận hoặc màn hình gõ lại từ đầu cho đội.

## 5. Thứ tự thông tin và bố cục

- Tổng quan ưu tiên **việc cần làm tiếp theo** và cutoff, sau đó trạng thái bài/vòng, cuối cùng lịch sử.
- Trang bài nộp luôn phân biệt “Bản mới đang kiểm tra”, “Bản hợp lệ mới nhất” và “Bản dùng cho vòng”. Một dấu tick upload thành công không có nghĩa đã valid/được khóa.
- Player ưu tiên context cặp/điểm → bàn cờ → trạng thái đồng bộ → lịch sử. Dùng khu chính và phần phụ có thể gập/cuộn; không bắt buộc ba cột.
- Dashboard BTC ưu tiên lỗi cần can thiệp và tiến độ, không dùng số liệu tổng lớn làm trang trí.
- Bracket nhiều nhánh có vùng cuộn ngang được đặt tên riêng hoặc chế độ danh sách; không làm toàn trang tràn ngang.
- Desktop mục tiêu 1280×720, 1366×768, 1440×900; kiểm cả chiều cao. Không zoom/scale toàn trang để nhét nội dung.
- Bàn 9×9 dùng ô vuông, xem readonly có thể co theo container. Nếu còn dưới kích thước đọc được, gập phần phụ hoặc cho vùng bàn cuộn có chủ đích; không ép mọi ô xuống dưới 44px chỉ để giữ ba cột.
- Đây là lựa chọn bố cục để làm tác vụ rõ, không phải yêu cầu pixel giống ảnh. Không lấy tọa độ atlas làm layout.

## 6. Component và state contract

Tận dụng view hiện có; các tên sau là ranh giới component đề xuất, không bắt buộc tạo đủ file mới cùng lúc.

| Component | Contract và trạng thái |
| --- | --- |
| `TournamentShell` | context/role/theme/navigation; CSS scoped, content slot |
| `EventContext` | event/round/mode/cutoff; hiển thị giờ Việt Nam, kèm ngày và offset khi cần |
| `SubmissionStatus` | uploaded/checking/valid/invalid/frozen; receipt/hash/người sở hữu |
| `RepositoryConnection` | repo/branch/path, ready/access_error, credential che kín; verifying/resolving/fetching/rate_limited; SHA và lần sync |
| `RoundMatchList` | chỉ dữ liệu server cho phép; loading/empty/denied/stale/error |
| `MatchViewer` | snapshot/events/attemptId/version, không nhận callback thay đổi trận |
| `BoardView` | map/pieces/highlights readonly; legend, toạ độ; editor tương tác riêng |
| `ReplayControls` | đầu/trước/phát/dừng/sau/cuối, speed, scrubber; khác với “Theo dõi trực tiếp” |
| `MapPreview` | preview main/reserve/version + kết quả validation; không suy terrain từ ảnh |
| `JobStatus` | queued/leased/running/completed/bot_fault/infra_fault/canceled |
| `OfflineReceipt` | team/round/seal time/hash/import/check; không coi mtime là giờ nộp |
| `DecisionDialog` | ngữ cảnh, bằng chứng/lý do, người đề nghị/người duyệt, pending/error/success |

Control dùng button/input/tab/dialog semantic. Label thiết yếu ít nhất 12px, body 14–16px; button 40px, dense 36px theo token. Focus khác selected, không dùng màu một mình. Icon lucide cho công cụ, không thay cả quân/terrain bằng icon không thống nhất phong cách.

### Copy chính xác cho các trường hợp khó

| Tình huống | Nội dung gợi ý |
| --- | --- |
| Check chưa xong | “Đã nhận file. Đang kiểm tra; bản hợp lệ trước đó vẫn được giữ.” |
| GitHub chưa đồng bộ | “Đã push chưa đồng nghĩa đã nhận bài. Kiểm tra commit được hệ thống xác nhận.” |
| GitHub lỗi truy cập | “Không đọc được repo; bản hợp lệ trước đó vẫn được giữ.” |
| Khóa bài | “Vòng đã khóa bài lúc {time}. Bản dùng: {shortHash}.” |
| Chưa vào vòng | “Đội bạn chưa có quyền xem vòng này.” Không lộ tên đối thủ/board từ payload bị từ chối |
| Vòng không có trận cho phép | “Chưa có trận được xem trong vòng của đội.” |
| Mất event/đang tải lại | “Đang đồng bộ lại diễn biến.” Giữ ảnh bàn gần nhất với nhãn cũ, không giả ván đã tiếp tục |
| Kết quả live | “Kết quả tạm thời” cho đến accepted/finalized đúng tầng |
| Bot lỗi | “Bot {team} thua ván: {reason}.” Không hiển thị stack/private log đối thủ |
| Máy chấm lỗi | “Ván tạm dừng do lỗi hệ thống. BTC đang xử lý.” |
| Offline đội | “Bạn được dùng hoặc chỉnh sửa bot đã nhận trước hạn nộp.” |

Không hiển thị “map sắp tiết lộ”, “phải viết lại 90 phút” hoặc “đổi bot trong trận”. Quyền sửa workspace không đồng nghĩa sửa snapshot đã khóa.

## 7. Token vào React/Vite: một nguồn, không tạo bản sao rời

`docs/ui-style/tokens.json` là nguồn duy nhất, generator tạo `tokens.css` và contrast report cùng thư mục. Đây là schema riêng của dự án, không hứa import trực tiếp Figma/DTCG.

Chạy từ root:

```sh
node docs/ui-style/build-tokens.mjs
```

Khi code milestone UI, import một lần từ `src/tournament/TournamentApp.jsx` hoặc entry tương ứng:

```js
import '../../docs/ui-style/tokens.css';
import './tournament.css';
```

Đây là đường dẫn với cấu trúc hiện có, cần kiểm tra lại khi tích hợp. Vite xử lý CSS thành build asset; runtime không cần truy cập thư mục docs qua mạng. Không copy tay một bản tokens.css khác vào src rồi để drift. Nếu repo muốn nguồn token chuyển về src, chuyển cả JSON/generator và cập nhật link/script trong một thay đổi có chủ đích, không duy trì hai nguồn.

Áp semantic token lên wrapper tournament, không áp `body`, `button`, `h1` toàn cục theo ví dụ style kit mà chưa đánh giá game cũ:

```css
.ott-tournament {
  color: var(--ott-color-text-primary);
  background: var(--ott-color-bg-canvas);
  font-family: var(--ott-font-body);
  font-size: var(--ott-type-body-size);
  line-height: var(--ott-type-body-line-height);
}
.ott-tournament :is(h1, h2, h3) {
  font-family: var(--ott-font-display);
}
.ott-tournament .tournament-panel {
  padding: var(--ott-panel-padding);
  border: var(--ott-border-hairline) solid var(--ott-color-border-subtle);
  border-radius: var(--ott-radius-small);
  background: var(--ott-color-bg-surface);
  box-shadow: var(--ott-shadow-none);
}
```

Ví dụ không phải stylesheet hoàn chỉnh. Reset `src/index.css` và class `.btn/.badge` cũ có thể thắng cascade; kiểm specificity/import order, scope class mới hoặc migrate component theo milestone. Không sửa đồng loạt style game cũ để một trang tournament trông đúng.

### Theme, portal và font offline

- Đặt `data-theme=light|dark` trên `html` theo generator, mặc định light; lưu preference và nạp trước render để giảm nháy. Nếu storage không dùng được, fallback light, không làm crash app.
- Generator còn đặt `color-scheme` ở root. Khi room cũ chưa hỗ trợ dark, cô lập room bằng wrapper `color-scheme:light` và style nền/chữ cũ; không để input phòng chơi vô tình đảo theme. Khi migrate room cả hai theme mới bỏ compatibility wrapper.
- Dialog portal phải có class wrapper tournament hoặc nhận typography/surface token rõ; tránh CSS scoped biến mất khi portal ra body. Layer token dùng cho stacking; kiểm header cũ z-index 40 để dialog không bị che, có thể tạo stacking context cục bộ cho shell.
- Self-host font WOFF2 có đầy đủ tiếng Việt và ghi license trong asset manifest khi thật sự thêm font. Style kit mới chứa font-family, chưa chứa font binaries/license. Nếu chưa có font, dùng fallback system/Georgia; không tải Google Fonts/CDN cho offline.
- Theme không đổi bố cục, hash map, owner/type quân, quyền xem hoặc ảnh gốc. Không invert/filter asset ở dark.

## 8. Asset vào sản phẩm

Ảnh [style-elements.png](ui-style/references/style-elements.png) chỉ tham khảo nét/alpha/tỷ lệ. Không import cả atlas vào bàn rồi scale/crop tùy ý. Khi có asset sử dụng thật, tạo manifest mapping id luật → path, kích thước, nguồn/license, crop nếu có; dùng PNG RGBA hoặc SVG đã kiểm tra alpha, không tạo asset mới trong nhiệm vụ chỉ tích hợp docs.

Ở v1 chỉ cần ba quân, nhà chính và ô cản. Có thể tiếp tục component/vector hiện có làm fallback có nhãn trong lúc chưa có asset đúng phong cách. Không coi ảnh reference là bộ sprite runtime đã tách/cấp phép hoàn chỉnh. File assets đưa vào `public/` chỉ khi thật sự dùng và được kiểm; docs reference không cần public URL.

Quân đơn sắc trên nền trung tính, viền và nhãn Đỏ/Xanh. Hai kiếm vẫn mang tên Kéo ở luật. Ô cản có pattern/silhouette và legend “Ô cản”; không lấy hình nước để ngụ ý quân đi qua được hoặc tự gán hiệu ứng. Icon/ảnh có nhãn ở component cha thì ảnh decorative dùng alt rỗng để tránh đọc lặp.

## 9. Player và quyền xem

Server là nguồn quyền và kết quả. Team chỉ xem online thuộc đúng `eventId,roundId` trong `round_participants`; đội cùng vòng xem mọi trận vòng đó, đội bị loại không tự xem vòng sau. BTC/judge theo scope. Không có spectator public cho giải chính thức. Replay offline giữ btc_only/judge sau khi sync online.

Viewer lấy snapshot seq N rồi event N+1; kiểm attempt/resultVersion, dedup, gap/hash và reset theo file03. Board là read-only; tạm dừng replay không pause runner; tốc độ animation không đổi budget bot. Trận chạy nhanh thì UI catch-up/batch hoặc xem lại, không block engine vì animation. Chỉ hiển thị clock/budget server thực sự cung cấp, không tạo đồng hồ giả để kết luận timeout.

Không lấy việc disable nút làm auth: API list/detail/state/events/SSE/replay/file phải cùng ACL. Tránh prefetch/cache service worker dữ liệu vòng chưa đủ quyền; logout/đổi tài khoản xóa query cache nhạy cảm. Khi mất quyền trong stream, đóng/clear payload liên quan và hiện thông báo; không tiếp tục render stream cũ.

## 10. Tích hợp từng milestone

| Bước | Phạm vi | Nghiệm thu |
| --- | --- | --- |
| UI0 | Đọc code/AGENTS, baseline, token build; chọn một view đã hoạt động | Không ghi đè code; build/token pass hoặc ghi rõ baseline fail |
| UI1 | Shell + theme + component cơ bản trên view đó | Light/dark, chữ Việt/focus/portal, game cũ hoạt động; dùng dữ liệu thật hiện có |
| UI2 | Map preview và submission status | Đúng map published, receipt/valid/frozen; thiếu backend phải hiện unavailable, không fake công bố/khóa |
| UI3 | Player hai bot theo API hiện có, nâng event khi backend sẵn sàng | Round ACL và reconnect/reset; không dùng mock để tuyên bố E2E production |
| UI4 | BTC editor/dashboard/offline receipts/vé theo backend đã triển khai | Role gates thật, immutable map/bài khóa, offline BTC-only |
| UI5 | QA cả theme, viewport, offline assets, trạng thái và hồi quy | Screenshot thực, checklist và các giới hạn chưa kiểm tra |

Mỗi lần chỉ làm milestone được giao theo quy ước repo. Các milestone backend M1–M7 ở file04 vẫn là dependency; UI guide không tự cấp quyền mở upload công khai hoặc đổi runtime.

## 11. Kiểm tra trước bàn giao UI

- Token generator pass, CSS/report khớp JSON; không hardcode lại bảng màu.
- Hai theme tại 1280×720, 1366×768, 1440×900; body 14–16px, chữ phụ >=12px; zoom/focus bàn phím và tiếng Việt không mất dấu.
- Mở menu/dialog/tab/bảng dài; không mất thao tác chính vì chiều cao, không vô tình tràn toàn trang.
- Đủ loading/empty/error/denied/checking/frozen/stale/reset; không hiển thị source/private log đối thủ.
- Viewer online đúng round, replay offline BTC-only; mất quyền/log out không để dữ liệu cũ trong UI.
- Tắt mạng: BTC vẫn import/xem/chấm theo backend offline; không có external font/CDN/analytics. Đội không cần LAN/viewer.
- Asset không méo/cắt/thủng fill, không tự sinh luật terrain; quan sát trên cả hai nền.
- Test build/chức năng phù hợp, regression room/play/spectator cũ. Báo rõ test hostLinux/UI thực chưa chạy, không suy từ contrast report ra UI đạt hoàn toàn.

Đây là checklist cho lúc code. Nhiệm vụ đóng gói docs chỉ xác minh tài liệu/token/link/asset reference; chưa chứng minh các màn hình đã render đúng.
