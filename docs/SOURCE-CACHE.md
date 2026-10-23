# Cache mã nguồn theo hash — K3c

Helper `createSourceCache` tại `server/shared/sourceCache.js` chỉ lưu bytes đã kiểm SHA-256,
không chạy Python, không tạo submission valid, không thay sandbox hoặc chứng minh quyền sở hữu repo.
Chưa nối vào worker polling. Profile nguồn vẫn 1..256 KiB; không đổi replay/runtime MVP.

## Contract

- `createSourceCache({root, now?})`: root tuyệt đối trong thư mục private do operator kiểm soát,
  ngoài `public`, `src`, `dist`. Chỉ **một coordinator/process** sở hữu một root; file `.owner`
  tạo exclusive để ngăn coordinator thứ hai. Không dùng chung root giữa hai worker.
- `put(Buffer, expectedSha256) -> hash`: kiểm size/hash trước ghi; file `<hash>.py`, file tạm
  UUID riêng rồi rename. Cache hit vẫn kiểm bytes. Không tự sửa bản hỏng hoặc tải branch HEAD.
- `read(hash) -> Buffer|null`: bounded read, kiểm regular file, single link, hash mỗi lần.
  Sai hash/entry là lỗi hạ tầng, không lỗi bot và không forfeit.
- `acquire(hash) -> {source, sourceHash, release}`: giữ hash khỏi GC cho tới release;
  release idempotent. Buffer trả riêng; runner phải tạo bản tạm private, không đưa cache path cho bot.
- `gc({retainedHashes, maxAgeMs}) -> removedHashes`: bắt buộc danh sách **đầy đủ** từ coordinator
  cho tất cả job đang chờ/đang chạy, snapshot vòng, bài valid còn dùng, khiếu nại và offline export.
  Không gọi khi DB unavailable hoặc chưa lấy đủ inventory. Missing/corrupt retained source chặn GC;
  hash đang acquire tự được giữ. Không xóa metadata/receipt/replay/Storage; file lạ được bỏ qua.
- `close()`: chỉ đóng sau khi release hết acquisitions; không xóa source, chỉ bỏ lock.

Inventory phải là snapshot nhất quán được coordinator tin cậy cung cấp; helper không tự truy vấn
DB và không thể phát hiện một retained hash bị caller bỏ sót. Pin bền vững thuộc DB/snapshot,
không nằm trong Map của process; sau restart phải tải inventory lại **trước** GC.
TTL tính từ thời điểm file được ghi, không từ lần đọc. Không chốt TTL nghiệp vụ mặc định.

## Phục hồi và giới hạn

- Khi process crash, `.owner` có thể còn lại. Không tự phá lock/đoán PID để tiếp quản.
  Operator phải xác nhận process cũ đã dừng, sao lưu/kiểm cache và bỏ lock thủ công trước mở lại.
  Đây là quy trình đề xuất, chưa diễn tập crash/restore thật.
- Thư mục và mọi ancestor phải do operator kiểm soát. Từ chối symlink/junction hiện hữu,
  source hardlink/symlink/directory. Không chống attacker có quyền sửa filesystem của coordinator.
- POSIX file mới 0600/root mới 0700; Windows cần operator cấu hình ACL private riêng.
  Windows unit tests không chứng minh POSIX permissions hoặc Linux sandbox.
- Write/rename không có fsync durability guarantee; sau crash phải đọc lại đúng hash,
  mất/hỏng cache thì phục hồi đúng pinned SHA+hash hoặc báo hạ tầng, không dùng HEAD mới.
- Không tự GC file `.tmp` sau crash: operator kiểm tra khi process đã dừng. Disk quota, tổng
  số bytes, lưu pin DB và GC lịch tự động còn là phần tích hợp sau.

## Kiểm thử

Từ repository root: `node --test tests/sourceCache.test.js`.
Fixtures bytes tạm trong OS temp, không gọi GitHub/DB và không execute bot.