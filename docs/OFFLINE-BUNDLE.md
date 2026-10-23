# Gói offline chung kết — K6a, chưa nghiệm thu trên giải thật

Mục tiêu: BTC mang theo một thư mục **tự chứa** để chạy ván offline không Internet. Gói chỉ chứa
snapshot vòng đã khóa, map đã công bố (nằm trong snapshot) và **đúng source bot đã pin**; không chứa
kết quả, không chứa DB, không chứa credential.

- Code: `server/shared/offlineBundle.js` — `buildOfflineBundle`, `verifyOfflineBundle`,
  `writeOfflineBundle`, `readOfflineBundle`.
- CLI: `tools/cli/offline-bundle.js` (`build`, `verify`).
- Schema: `campus-offline-bundle.v1`; snapshot dùng `campus-round-snapshot.v1` sẵn có.

## Định dạng

```text
<out-dir>/
  manifest.json            # schema, tóm tắt snapshot, hash/size từng file, contentHash
  snapshot.json            # canonical JSON của campus-round-snapshot.v1 (đã freeze)
  bots/<participantId>.py  # đúng bytes đã pin theo sourceSha256 trong snapshot
```

`manifest.json` không chứa source, token, storage path hay lease. `contentHash` phủ toàn bộ body trừ
chính nó; `snapshot.contentHash` phủ snapshot. `bots/<id>.py` phải khớp `sourceSha256` của snapshot,
và tập file phải **đúng bằng** tập bot trong snapshot — thiếu/thừa/trùng đều fail.

Giới hạn: bot 1..256 KiB, `snapshot.json`/`manifest.json` ≤ 256 KiB, tối đa 57 file, tổng ≤ 16 MiB.
`participantId` phải an toàn làm tên file (`[A-Za-z0-9][A-Za-z0-9._-]{0,79}`); UUID thỏa điều kiện.
Map chính/dự phòng và runtime version/hash nằm trong snapshot nên không tách file rời.

## Dùng

```powershell
# snapshot.json xuất từ pipeline K2 đã khóa; bots/ chứa <participantId>.py đã tải từ Storage/USB
node tools/cli/offline-bundle.js build <snapshot.json> <bots-dir> <out-dir>

# trên máy BTC trước khi vào phòng thi (và có thể chạy lại bất cứ lúc nào)
node tools/cli/offline-bundle.js verify <out-dir>
```

`build` chỉ ghi vào thư mục **rỗng**, từng file qua temp + `fsync` + rename, `manifest.json` ghi cuối;
lỗi giữa chừng sẽ xoá các file đã ghi. `verify` chỉ đọc các file có trong manifest, từ chối symlink/
không phải regular file, kiểm size trước khi đọc, rồi kiểm lại toàn bộ hash và snapshot.

## Đã kiểm chứng (24/10/2026, Windows, Node v24.18.0)

- Test `tests/offlineBundle.test.js` 5/5: build/verify, từ chối snapshot sai/thiếu bot/trùng/ID không
  an toàn/sai hash/0 byte/>256 KiB, phát hiện sửa byte, thêm/bớt file, sửa summary **dù đã reseal
  manifest**, path traversal, sai `totalBytes`, round-trip ghi/đọc, thư mục không rỗng.
- Diễn tập thật bằng CLI trong `data/khoa-next/offline-demo/` (gitignored): snapshot 2 bot, build 3 file
  (1754 byte), verify pass; sửa 1 byte → exit 1 `offline_bundle_invalid: file_hash_mismatch,
  bot_hash_mismatch`; phục hồi → exit 0. Không dùng mạng/DB/Python.

## Chưa làm / giới hạn

- **NOT RUN:** xuất từ giải thật, bundle 56 đội, restore trên VM Linux sạch, chạy bot thật trong phòng
  thi, đo thời gian setup. Chưa có scheduler màu/persistence nên gói chỉ là input của một vòng.
- Chưa có chữ ký số của BTC; `contentHash` chống sửa ngoài ý muốn nhưng ai giữ thư mục cũng tạo lại
  được manifest mới. Muốn chống giả mạo cần ký ngoài luồng (chưa làm).
- Không thay thế backup DB hay sandbox; không chứng minh runtime chạy được bot. Không tự xoá/GC gói cũ.
- Gói chưa chứa replay/kết quả; sau khi chấm offline phải xuất kết quả theo luồng nhập kết quả hiện có
  (chưa nối).
