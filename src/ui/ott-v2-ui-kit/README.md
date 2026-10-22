# OTT-v2 UI Kit · Dùng component thật, không dựng lại bàn cờ

Bộ component tách từ bản OTT-v2 đã chốt: giữ khung, ô vuông, quân đơn sắc, song kiếm, địa hình màu và hai theme. Có bản JavaScript thuần và wrapper React. Không cần cài thư viện để xem catalog; React chỉ cần khi dùng wrapper.

**Phần được ghép mới:** layout bên ngoài, các màn hình, dữ liệu và luồng sản phẩm.

**Phần dùng trực tiếp:** component bàn cờ, ô, asset, quân, trạng thái và CSS trong kit. Đây là phần bổ sung bằng code cho style guide trước đó. Yêu cầu không copy layout demo không có nghĩa là phải tự vẽ lại những component này.

## Xem trước

```sh
cd ott-v2-ui-kit
npm run dev
```

Mở `http://127.0.0.1:4174/`. Không cần `npm install` cho trang catalog. Mọi font và asset đều nằm trong kit; không có CDN hoặc API mạng trong runtime. Nếu cổng đã có server kit chạy, dùng server đó.

Trang catalog có bàn cờ tương tác, quân 32–64px, địa hình, trạng thái ô, thẻ đội, nút chọn quân, lượt, lịch sử và điều khiển. Catalog là màn hình xem component, không phải layout bắt buộc của sản phẩm.

## Tệp nên dùng

| Tệp | Chức năng |
| --- | --- |
| `ui-kit.css` | Toàn bộ component, import token scoped và font nội bộ |
| `tokens.json` / `tokens.css` | Nguồn token / CSS được sinh |
| `assets.mjs` | Vùng ảnh gốc, URL asset tự tính từ vị trí module |
| `components.mjs` | Factory tạo DOM component |
| `board.mjs` | Bàn 9×9 controlled, hỗ trợ bàn phím |
| `react/index.mjs` | Wrapper cho ứng dụng React hiện có |
| `assets/` | PNG RGBA nguyên vẹn, lớp chữ cổ, nguồn ảnh |
| `fonts/` | Font tiếng Việt cùng giấy phép OFL |
| `AGENT-INSTRUCTIONS.md` | Brief giao AI tích hợp |
| `fixtures.mjs` / `showcase.*` | Chỉ dùng catalog; không đưa dữ liệu mẫu vào state production |

`ott-*` là namespace của component. Token được scope vào `.ott-ui`, không ghi lên `:root`, không đặt style cho body của ứng dụng. Riêng catalog có stylesheet trang `showcase.css`; **không import file đó vào sản phẩm**.

## JavaScript thuần

```html
<link rel="stylesheet" href="./ott-v2-ui-kit/ui-kit.css">
<div class="ott-ui" data-theme="light">
  <div id="game-board"></div>
</div>
```

```js
import {mountBoard} from './ott-v2-ui-kit/board.mjs';

const board = mountBoard(document.querySelector('#game-board'), {
  pieces: Object.values(gameState.pieces),
  terrains: map.terrains,
  selectedSquare: selectedPiece?.square ?? null,
  validMoves: legalMoves,
  onSquareClick(square) {
    // Gọi flow chọn/đi có sẵn trong ứng dụng.
    handleSquareClick(square);
  }
});

// Có snapshot mới: cập nhật chính instance này.
board.update({pieces: Object.values(nextState.pieces), selectedSquare: null, validMoves: []});

// Khi màn hình bị gỡ:
board.destroy();
```

Ví dụ có các biến của ứng dụng, không phải một rule engine đi kèm. Kit không xác thực nước đi trên server và không quyết định thắng thua.

## React

Copy toàn bộ kit vào một thư mục ổn định trong source, ví dụ `src/ui/ott-v2-ui-kit`. Dùng React đã có của dự án; không cài thêm một bản React thứ hai.

```jsx
import './ui/ott-v2-ui-kit/ui-kit.css';
import {OTTBoard, OTTPlayerCard, OTTTerrainLegend} from './ui/ott-v2-ui-kit/react/index.mjs';

function MatchView({snapshot, map, selectedSquare, legalMoves, handleSquareClick, theme}) {
  return (
    <div className="ott-ui" data-theme={theme}>
      {/* Chọn layout phù hợp sản phẩm ở đây. */}
      <OTTPlayerCard name="Hồng Long" team="red" count={9} active />
      <OTTBoard
        pieces={Object.values(snapshot.pieces)}
        terrains={map.terrains}
        selectedSquare={selectedSquare}
        validMoves={legalMoves}
        readOnly={snapshot.role === 'spectator'}
        onSquareClick={handleSquareClick}
      />
      <OTTTerrainLegend />
    </div>
  );
}
```

Các ví dụ chỉ minh họa API. Chúng không quy định các component phải nằm cạnh nhau như catalog hoặc demo.

Wrapper dùng DOM và `useLayoutEffect`; dùng trong vùng client. Với Next App Router, đặt component tiêu thụ trong client boundary. Kit không tạo ứng dụng mới, router hay backend.

## API bàn cờ

`mountBoard(host, options)` trả `{element, update(partialOptions), focusSquare(square), destroy()}`. Mount thay nội dung bên trong `host`; dùng một host dành riêng cho bàn cờ.

`<OTTBoard {...options} className="optional-layout-class" />` nhận cùng dữ liệu; wrapper cập nhật đầy đủ theo props, tự gỡ khi unmount. `className` áp lên host bên ngoài, không đổi nét vẽ bên trong.

| Option | Kiểu / mặc định | Ý nghĩa |
| --- | --- | --- |
| `pieces` | `[]` | `{id?, type, player, square, alive?}[]`; `player` là `red/blue`, `alive:false` bị bỏ qua |
| `terrains` | `{}` | Map tọa độ → `fire/water/bush/chasm` |
| `zones` | `null` | `null` dùng phân màu sân nhà của mẫu; `{}` cho toàn bộ ô trung tính; map có giá trị `red/blue/neutral` để tự đặt vùng |
| `bases` | `{a1:'red', i9:'blue'}` | Tọa độ thành trì; `{}` nếu không muốn hiển thị |
| `selectedSquare` | `null` | Tọa độ ô đang chọn |
| `validMoves` | `[]` | Chuỗi tọa độ hoặc `{square, type:'move'/'capture'}`; app tự tính luật |
| `lastMove` | `null` | Chuỗi tọa độ hoặc `{from, to}`; tô dấu ở `to` |
| `orientation` | `'red'` | `'red'` hoặc `'blue'`, đổi thứ tự hiển thị và nhãn trục |
| `readOnly` | `false` | Khóa callback bấm ô; vẫn xem bằng bàn phím |
| `title` | `'OTT-v2'` | Nhãn trên khung, xử lý như text |
| `onSquareClick` | `null` | Callback nhận tọa độ, không tự sửa piece/state |

Tọa độ hợp lệ `a1`–`i9`. Key quân là `rock/paper/scissors`; `scissors` vẽ hai kiếm bắt chéo, không đổi key luật. Bàn từ chối tọa độ ngoài 9×9, piece chồng ô và loại terrain không hỗ trợ; app nên validate dữ liệu trước khi đưa vào UI.

Phím: Tab vào bàn một lần; mũi tên di chuyển focus theo hướng nhìn; Home/End đầu/cuối hàng; Ctrl/⌘ + Home/End đầu/cuối bàn; Enter/Space kích hoạt ô trong chế độ tương tác. Update giữ focus nếu người dùng đang thao tác trong bàn.

`readOnly` là hành vi UI, **không thay cho phân quyền backend**. Quyền spectator, room và dữ liệu phải được xử lý trong ứng dụng.

## API các component còn lại

Factory trả `HTMLElement`, có thể `append()` vào container. Nội dung tên/nhãn được đặt bằng `textContent`, không chèn HTML từ dữ liệu người dùng.

| JavaScript factory | React wrapper | Tham số chính |
| --- | --- | --- |
| `createAsset(name, options)` | — | 8 tên asset; `label?`, `size?` |
| `createPiece(options)` | `OTTPiece` | `type`, `team`, `size?`, `selected?`, `label?` |
| `createTerrain(type, options)` | `OTTTerrain` | `type`, `size?`, `label?` |
| `createSquare(options)` | — | `coordinate`, `zone`, `terrain?`, `piece?`, `base?`, `selected?`, `available?`, `capture?`, `lastMove?`, `disabled?`, `onClick?` |
| `createPlayerCard(options)` | `OTTPlayerCard` | `name`, `team`, `count`, `total`, `active`, `status?` |
| `createUnitButton(options)` | `OTTUnitButton` | `type`, `team`, `count`, `selected`, `disabled`, `onClick(type)` |
| `createTerrainLegend(options)` | `OTTTerrainLegend` | `types?`, `descriptions?` |
| `createTurnBadge(options)` | `OTTTurnBadge` | `team`, `number`, `label?` |
| `createActionBar(options)` | `OTTActionBar` | `message`, `onUndo?`, `onReset?`, `undoDisabled`, `resetDisabled` |
| `createMoveList(options)` | `OTTMoveList` | `moves: {team,from,to,label?}[]`, `emptyText?` |

Chú ý: `piece` của ô đơn dùng `{type,team}`; `pieces` của bàn dùng `{type,player,square}` để tương thích state OTT-v2 gốc. React `OTTTerrain` nhận `type` như prop. Kích thước `size` là số pixel dương; các factory ảnh giữ đúng tỷ lệ gốc.

Mô tả trong `TerrainLegend` do app truyền. Kit không mặc định gán luật cho lửa/nước/bụi cây. Nếu đặc tả đang triển khai chỉ có blocker, dùng đúng loại visual được map một cách tường minh; không tự bổ sung cơ chế game vì có asset.

## CSS và theme

```html
<div class="ott-ui" data-theme="dark">…component…</div>
```

Có thể có hai vùng `.ott-ui` với theme khác nhau trên cùng trang. Font/asset không bị đảo màu. Viền phân biệt đội; quân và công trình đơn sắc, địa hình có màu.

- `.ott-panel`: panel cơ bản.
- `.ott-button`: button phụ; thêm `.ott-button--primary` cho hành động chính.
- `.ott-icon-button`: button chỉ icon, cần `aria-label`.
- `.ott-heading`, `.ott-caption`, `.ott-label`: typography dùng chung.

Dùng semantic token để mở rộng component ngoài bàn cờ. Chạy `npm run tokens` khi sửa `tokens.json`; generator của kit sinh token vào `.ott-ui`. Không sửa `tokens.css` bằng tay. `contrast-report.json` chỉ kiểm cặp màu đặc, không chứng minh mọi cấu hình có texture/ảnh đều đạt.

## Layout và kích thước

Đặt `OTTBoard` vào container có chiều rộng phù hợp. Khung tự rộng 100%, bàn giữ vuông. Không gán riêng chiều cao ép bàn; không dùng `zoom`, `scaleX`, `object-fit:fill` hoặc filter.

Ví dụ container: `inline-size: clamp(380px, 42vw, 620px); max-inline-size: 100%`. Đây là lựa chọn layout của app, không phải kích thước bắt buộc. Khi cần vừa chiều cao cửa sổ, tính chiều rộng từ vùng còn lại của layout thực tế.

Không override `.ott-square`, `.ott-piece`, `.ott-art__crop`, `.ott-axis`, `.ott-board-wrap` để AI “vẽ lại cho giống”. Nếu cần biến thể mới, bổ sung component/prop có chủ đích và kiểm tra với mẫu trước.

## Kiểm tra

```sh
npm test
npm run tokens
```

Pure tests kiểm orientation, điều hướng không nhảy hàng, validation snapshot và ranh giới presentation/luật. Catalog dùng để kiểm ảnh, theme, callback và focus trong trình duyệt. React wrapper đã có source ESM và được kiểm cú pháp; cần chạy build/smoke test trong dự án React đích khi tích hợp, vì kit không cài/vendoring React hay framework của dự án.

## Nguồn

Asset được làm bằng imagegen theo ảnh người dùng cung cấp; xem `assets/PROVENANCE.md`. Đây không phải tuyên bố giấy phép của các ảnh đầu vào. Font lấy từ kho Google Fonts, Be Vietnam Pro và Noto Serif, kèm giấy phép gốc trong `fonts/`. Source của kit và asset được chuyển giao trong workspace này; package `private:true` để dùng nội bộ, không tự phát hành lên registry.
