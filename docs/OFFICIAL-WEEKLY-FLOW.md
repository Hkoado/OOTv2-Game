# Luồng giải tuần online — trạng thái 24/10/2026

Mục tiêu: một giải tuần chạy được từ setup → cutoff → pull GitHub một lần → mở vòng bảng.
Tháng/kỳ, knockout, offline và VM production làm sau (A4 đã chốt).

## Luồng đã nối

1. BTC tạo giải `campus-setup.v1`, chọn 4–56 đội, map pack, cutoff.
2. Đội đăng ký repo công khai + branch; BTC duyệt (`mvp_repo_connections.approved=true`).
3. **Đúng/sau cutoff**, BTC bấm `1. Chốt GitHub lúc cutoff` hoặc chạy:
   `npm run github:cutoff -- <eventId>`.
   - Mỗi repo đã duyệt được resolve HEAD **một lần**; tạo một job + receipt.
   - Chạy lại cùng SHA: bỏ qua; không tạo job thứ hai.
   - Lỗi mạng/GitHub: trả trong `failed`, BTC chạy lại; không tạo submission giả.
4. Worker tải bài: `npm run github:worker` (hoặc `node tools/cli/github-cutoff-worker.js --drain`).
   - Tải đúng blob `bot.py` tại SHA, kiểm size/UTF-8/syntax Python, upload Storage private.
   - Không chạy bot; chạy trận thuộc runner sandbox.
   - Job lỗi hạ tầng được release/retry theo lease hiện có.
5. BTC bấm `2. Mở vòng bảng` hoặc `POST /api/local/events/:id/official-round`.
   - Service chỉ mở khi mọi đội có đúng một bot hợp lệ trước cutoff.
   - Snapshot pin event/round/seed/cutoff/map/runtime/budget + bot SHA/commit.
   - Gọi lại trả round đã mở, không tạo snapshot thứ hai.
6. UI admin xem tổng ván, cutoff, snapshot hash và cặp đấu kế tiếp (màu đã chốt).

## Lệnh kiểm chứng

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
- **VM Hyper-V**: Hyper-V đang Disabled trên máy; cần admin + reboot trước khi tạo VM sạch.
- **Storage bucket**: worker cần bucket `ootv2-bots`; chưa kiểm Storage thật trong đợt này.
- **GitHub token**: repo công khai không cần token; 35–50 request cutoff nằm dưới 60/giờ. Nếu retry nhiều, đặt `GITHUB_TOKEN` để tăng hạn mức.
- **Quyền xem**: route round hiện chỉ admin; đội/viewer chưa có API công bố.
