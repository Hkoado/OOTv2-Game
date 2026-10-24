# Luồng giải tuần online — trạng thái 24/10/2026

Mục tiêu: một giải tuần chạy được từ setup → cutoff → pull GitHub một lần → mở vòng bảng.
Tháng/kỳ, knockout, offline và VM production làm sau (A4 đã chốt).

**Checkpoint 24/10:** code cutoff mới cần migration
`20261025100000_cutoff_capture.sql` (chưa apply remote). Xem
[readiness](PRODUCTION-READINESS.md) trước khi chạy. Các kết quả DB drill cũ bên
dưới không chứng minh migration mới đã được nghiệm thu trên Supabase.

## Luồng đã nối

1. BTC tạo giải `campus-setup.v1`, chọn 4–56 đội, map pack, cutoff.
2. Đội đăng ký repo công khai + branch; BTC duyệt (`mvp_repo_connections.approved=true`).
3. **Đúng/sau cutoff**, BTC bấm `1. Chốt GitHub lúc cutoff` hoặc chạy:
   `npm run github:cutoff -- <eventId>`.
   - Policy `cutoff-first-resolution.v1`: resolve thành công đầu tiên sau cutoff,
     không chứng minh HEAD lịch sử tại cutoff, không dùng commit timestamp thay thế.
   - DB reserve event/team và khóa repo/branch/cutoff/roster; pin job/receipt atomically.
   - Capture đã pin: chạy lại bỏ qua **trước** khi gọi GitHub, kể cả HEAD đã thay đổi.
   - Lỗi resolve: trả `failed`, đợi lease 60 giây rồi retry cùng repo/branch đã reserve.
     Lỗi tải/validation hạ tầng retry job cùng SHA, không tạo submission giả.
4. Worker tải bài: `npm run github:worker` (hoặc `node tools/cli/github-cutoff-worker.js --drain`).
   - Tải đúng blob `bot.py` tại SHA, kiểm size/UTF-8/syntax Python, upload Storage private.
   - Không chạy bot; chạy trận thuộc runner sandbox.
   - Job lỗi hạ tầng được release/retry theo lease hiện có.
5. BTC bấm `2. Mở vòng bảng` hoặc `POST /api/local/events/:id/official-round`.
   - Service chỉ mở khi mọi đội có đúng receipt valid của capture chính thức;
     validation có thể xong sau cutoff. Thiếu/pending/invalid không dùng bài cũ thay.
   - Snapshot pin event/round/seed/cutoff/map/runtime/budget + bot SHA/commit.
   - Gọi lại trả round đã mở, không tạo snapshot thứ hai.
6. UI admin xem tổng ván, cutoff, snapshot hash và cặp đấu kế tiếp (màu đã chốt).

## Lệnh kiểm chứng

**Lưu ý:** `db:cutoff` và `db:k2-open` dưới đây là bằng chứng **legacy**, chưa tương
thích migration capture mới (fixture/cleanup phải nâng trước). Không chạy hai drill
này sau migration mới; dùng `sudo bash tools/cli/test-cutoff-postgres.sh` để kiểm
contract PostgreSQL local. Full test hiện hành: **338/338 pass**, build pass.

```powershell
npm run db:cutoff     # 4/4 PASS — job/receipt thật, chạy lại skip
npm run db:k2-open    # 6/6 PASS — mở round từ setup/submission thật
npm run db:k2         # 14/14 PASS — chain/result/freeze
npm test              # 326/326
npm run build
```

## Chưa nối

- **Chạy trận/ghi kết quả**: chưa có scheduler gọi `runCampusMatch`, append/record/freeze; K2 chỉ lưu lịch.
- **Knockout/standings/top 16**: chưa tự động từ kết quả vòng bảng.
- **VM Hyper-V**: session đã đọc được Hyper-V nhưng chưa có VM Linux để nghiệm thu.
- **Storage bucket**: worker cần bucket `ootv2-bots`; chưa kiểm Storage thật trong đợt này.
- **GitHub token**: repo công khai không cần token; 35–50 request cutoff nằm dưới 60/giờ. Nếu retry nhiều, đặt `GITHUB_TOKEN` để tăng hạn mức.
- **Quyền xem**: route round hiện chỉ admin; đội/viewer chưa có API công bố.
