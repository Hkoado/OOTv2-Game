# Các bước còn lại để hoàn thiện sau Huy / Bảo / Khoa

## Checklist RC hiện hành — quyết định 24/10/2026

Ưu tiên [docs/18](../18-CHOT-HOAN-THIEN-VA-NGHIEM-THU.md) và
[docs/19](../19-CONTRACT-TICH-HOP.md). Checklist bên dưới phần này giữ làm lịch sử;
offline tự động/bundle/import hai chiều không là gate đợt này, prompt chỉ chọn một bước rồi dừng
không áp dụng. Nhóm tự checkpoint/tích hợp, user nghiệm thu một RC.

- [ ] Cả ba: baseline SHA chung bảo toàn working tree, mapping concrete API/RPC/job/DTO/error/version
  trong docs/19, producer/consumer tests; ghép sớm giải nhỏ bằng runtime chính thức.
  → **Huy 24/10:** đã điền bảng mapping docs/19 mục 5 + mục 6 (manual final route/RPC/DTO/mã lỗi);
  phần online/worker vẫn chờ Khoa/Bảo xác nhận.
- [ ] Huy: schema/history project đích đúng, migration additive được phép, backup/restore đã thử;
  DB/RLS/grants/Storage/auth/CSRF/IDOR/cutoff/provenance/concurrency integration thật.
  → **Huy 24/10:** đã apply `20261025100000_cutoff_capture` + `20261026100000_manual_final` trên
  project `wsyfcgurnrowcuefwynx` (OTTv2-G5) bằng `db:apply-migrations --apply --smoke` (OK 2/2, smoke
  PASS); `db:verify` counts 16/11/2/12/28/4 không đổi; `db:manual` PASS trên schema đã apply.
  Snapshot dữ liệu trước apply: `data/backup-before-step0.json` (gitignored). **Restore rehearsal**
  và backup artifact/recovery: **NOT RUN**.

- [ ] Khoa: worker Campus riêng, snapshot/hash/runtime/budget, accepted attempt fencing result/log/replay;
  hai worker/crash/retry/stale/duplicate không tính đôi, infra không forfeit.
  → **Huy 24/10 (phần DB/review):** migration `20261026090000` (queue official) **đã apply** cùng hardening
  `20261026110000` (service_role chỉ `SELECT`; REST PATCH/POST → 403 `42501`); test 395/395. VM/2 worker thật,
  crash/retry trên VM: **NOT RUN** (Khoa).
- [ ] Khoa: group/standings/tie/knockout/extra/tranh ba/bye/DQ/walkover/vé đúng; màu lưu trước chạy.
  → **Huy 24/10 (phần API):** route admin cho progress/standings/publish/freeze/bracket/tickets +
  cancel/requeue job đã có (`docs/19` §7), route test 6/6 + smoke 12/12. UI Bảo + VM/2 worker: **NOT RUN**.
- [ ] Khoa: sandbox VM thật, resources/network/filesystem/cleanup/attestation, không secret vào bot;
  WSL/mock không thay production acceptance.
- [ ] Khoa: Windows khác không chạy API, installer/start/stop/reboot/update hỏng/rollback đã thử;
  sửa path attestation/SSH user/doctor/config null/env-cache-cgroup; SSH console verified.
- [ ] Bảo: UI hiện có/UI-GUIDE, không redesign; hai theme/desktop/keyboard/error/loading/draft/conflict;
  các action online nối API thật, viewer clock/cursor/reconnect không leak tương lai/kết quả kín.
- [ ] Cả ba: online E2E repo → cutoff → receipt/snapshot → chấm → standings/knockout/vé
  → publication/viewer, không sửa DB để vượt bước thiếu.
  → **Huy 24/10:** DB thật `ftzockzolisecnyhlwej` đã bootstrap **21 migration** (smoke PASS, dữ liệu rỗng,
  ledger `ootv2_schema_migrations` 21 dòng); E2E dev **PASS 13/13** — knockout complete 4/4 + vé 2 (sửa bug pin
  ván phụ `nextSeriesGame`, có test hồi quy); publication official có backend mới (`20261026140000` +
  `server/services/officialBroadcasts.js` + 3 route) và đã E2E trên DB thật bằng fixture tạm rồi xoá sạch.
  **Chốt schema Huy ↔ Khoa:** `docs/HUY-KHOA-CHOT-SCHEMA-WORKER.md` + drill `worker-schema-drill` 17/17, đã vá
  fencing lease official (`…150000`) và DELETE của service_role (`…160000`). Còn NOT RUN: browser E2E,
  VM/2-worker thật, restore, UI viewer publication.
- [ ] Cả ba: Chung kết thủ công E2E admin tạo đợt/vòng → nạp bot → validation → chọn/khóa
  → chọn cặp/chấm → điểm/lý do/replay → BTC xác nhận đi tiếp; dùng cùng runner/sandbox.
  → **Huy 24/10:** backend + RPC + migration **đã apply**; **thiếu** worker consume (Khoa) và UI (Bảo),
  nên E2E trình duyệt **NOT RUN**.
- [ ] Huy/Bảo/Khoa: manual scoped event/round/team admin-only, source/hash/actor/server time;
  pending/invalid/lock race đúng; sau khóa không thay bài; online không nhận manual provenance giả.
  → **Huy 24/10 DONE ở mức API/DB:** test `manualFinalApi` 9/9 (403 đội/anonymous, CSRF, scope,
  upload sai, dup idempotent, pending không khóa, sau khóa không đổi, provenance `manual_final`).
- [ ] Cả ba: manual cancel/rerun có reason/audit giữ lịch sử; infra retry cùng input;
  không form nhập tay thay engine result, không mở upload online toàn cục, mặc định BTC-only.
  → **Huy 24/10 DONE ở mức API/DB:** `cancel` bắt buộc lý do + audit, `finished` không hủy được,
  `rerun` giữ `rerun_of`/snapshot hash, `release` retry cùng input rồi `infra_fault`;
  router manual không dùng cờ upload toàn cục.
- [ ] Bảo/Khoa: counts 35/40/48/50, benchmark worker và viewer 50/100/200 có môi trường/P95/error/resource;
  không coi in-process simulation là nghiệm thu hạ tầng triển khai.
- [ ] Cả ba: full tests/build/diff, replay/rules cũ, backup/artifact/recovery; security/dependency/secret-history/license review.
  → **Huy 24/10 (phần Huy):** `npm test` **372/372 pass** (0 skip), `npm run build` pass,
  `git diff --check` sạch; replay/rules cũ không đổi (không sửa engine). Backup/restore DB,
  security/secret-history review lại và license: **NOT RUN**.
- [ ] Huy tổng hợp, mỗi owner ký: một RC SHA, evidence commands/exit/PASS/FAIL/NOT RUN,
  Bảo review script, Khoa worker runbook, Huy schema/env/deploy checklist; không để user nối code.
  → **Chưa đạt RC:** thiếu bằng chứng Khoa (VM/worker/2-worker) và Bảo (browser/theme/load);
  thiếu apply migration + E2E manual thật. Huy đã cập nhật handoff/contract, chưa ký thay người khác.
- [ ] Supabase và VM sẵn sàng trước bàn giao. User tự deploy Vercel; HTTPS/cookie/routing production
  smoke sau deploy là checkpoint môi trường riêng, không giả đã chạy trước deploy.

**Gate bắt buộc chưa chạy thật thì RC chưa đạt.** Thiếu quyền/hardware báo sớm owner/impact,
không chuyển NOT RUN thành PASS. Manual finals cần API/Supabase/worker có kết nối; không quảng cáo
chạy khi mất Internet. Hoãn local DB/offline sync/bundle thi/thu-phát USB tự động; BTC tự tổ chức.

## Checklist lịch sử trước khi chốt lại phạm vi (không áp dụng khi mâu thuẫn phần trên)

Checklist này chưa được nghiệm thu. Người tích hợp ghi commit, ngày, môi trường và bằng chứng khi đánh dấu.
Hoàn thành H1/B1/K1 chỉ là **PR đầu tiên**, không phải hoàn thành cả gói H1–H4/B1–B4/K1–K4.
Nếu các gói đã có bằng chứng VERIFIED thì kiểm lại trên nhánh tích hợp, không bắt viết lại tính năng.

## 1. Thu kết quả và tích hợp có kiểm soát

- [ ] Đọc ba báo cáo; kiểm commit/PR tồn tại và merge đúng nhánh. Xác định contract đã duyệt,
  chỗ còn fixture, API thiếu và migration chưa apply. Không tự coi đề xuất contract là quyết định BTC.
- [ ] Merge từng PR, giải conflict theo ownership; full test/build sau mỗi đợt, không merge nguyên Backend cũ.
- [ ] Trên project disposable được phép: migration theo thứ tự, private grants/RLS/RPC/Storage,
  session/CSRF/HTTPS/cookie/proxy. Thử nâng từ schema cũ, không chỉ cài DB trống. Backup trước rollout.
- [ ] Review dependency vulnerabilities và secrets/credential rotation nếu cần; không tự audit fix mù.

## 2. E2E nghiệp vụ chính thức trên nhánh tích hợp

- [ ] Tài khoản đội → đăng ký repo được duyệt → receipt đúng SHA → validation → snapshot theo vòng
  → scheduler → kết quả/replay kín → BTC đặt lịch → viewer nhận đúng mốc → mở kết quả sau phát xong.
- [ ] Counts 35/40/48/50, điểm cặp/tie mini-table, tránh cùng bảng, ván phụ/tranh ba,
  bye/double-DQ/walkover/vé bù. Map/rules/protocol/runtime hash đúng và không đổi snapshot sau khóa.
- [ ] Cutoff race/force-push/revoke/rate limit/cùng SHA/mất cache; giữ valid cũ khi lỗi hạ tầng,
  không tính đôi hoặc nhận HEAD sau hạn. API chạy không cần git/Python.
- [ ] Membership/IDOR trên list/detail/events/replay/file/standings/bracket/log; khách/khác giải bị chặn,
  cùng giải xem vòng sau đã công bố; sửa afterSeq/clock client không lộ nước tương lai hoặc kết quả kín.

## 3. An toàn runtime và khả năng chịu lỗi — gate mở bot sinh viên

- [ ] Kiểm sandbox Linux thật trên VM sạch: filesystem/network/CPU/RAM/process/flood/timeout/cleanup;
  xác nhận không secret vào bot. Chưa có bằng chứng thì chỉ trusted-dev, không mở nhận code lạ.
- [ ] Hai worker tranh job, lease hết hạn, stale result/event/log/terminal, duplicate finish,
  kill giữa ván, DB/Storage/GitHub mất mạng; lỗi hạ tầng không quy đội thua.
- [ ] Pin runtime/budget và benchmark; pause queue/cảnh báo/khôi phục, log/audit và retention có giới hạn.

## 4. Browser, tải và hồi quy

- [ ] Browser thật team/admin, hai theme, mobile, keyboard, draft/conflict/logout,
  viewer countdown/catch-up/reset/reconnect và không tải replay tương lai.
- [ ] Đo tải 50/100/200 viewer + đợt nộp bài + 2 game slots theo đặc tả; ghi P95/request rate/error,
  tài nguyên DB/API/worker, quota thực và thời lượng toàn giải. Điều chỉnh polling từ số đo, không từ phỏng đoán.
- [ ] Hồi quy replay MVP và game/phòng/spectator hai máy; code còn trong repo không đồng nghĩa đã dùng được.

## 5. Offline giải chính thức và khôi phục — milestone riêng

- [ ] Chốt kiến trúc offline không Internet tương thích quyết định Supabase-only hiện hành với BTC.
  Không tự thêm SQLite fallback; nếu cần đổi quyết định phải có ADR/phê duyệt trước code.
- [ ] Export gói pin bot cũ/map/runtime/manifest/hash trước khi ngắt mạng; phát đúng bot cho đội,
  cho dùng/sửa/thay, thu USB và seal/cutoff/receipt; không kéo GitHub trong giờ thi.
- [ ] BTC chấm/xem không mạng, import kết quả idempotent, không có ván giả hoặc đổi snapshot.
  Chơi tay offline hiện có không thay thế quy trình này.
- [ ] Backup nhất quán và restore máy dự phòng; diễn tập mất điện/mất máy/mất mạng, kiểm artifacts,
  accepted results và chạy lại cùng snapshot/map/seed. Có ít nhất hai người thao tác phục hồi được.

## 6. Vận hành và phát hành

- [ ] Preview HTTPS với project test, GitHub App/credential tối thiểu, Storage private,
  giám sát worker/job lỗi; tài liệu cài máy chấm, env chỉ tên biến và runbook xử lý sự cố.
- [ ] BTC phê duyệt điều lệ/cutoff/map pack/budget/quota/lịch công bố/quy trình khiếu nại,
  kiểm audit/xác nhận sửa kết quả và quyền vận hành; không coi quyền kỹ thuật là quyền tổ chức đã duyệt.
- [ ] Diễn tập giải đầy đủ bằng dữ liệu thử; ghi biên bản PASS/FAIL/NOT RUN, đóng blocker mức mở giải.
- [ ] Rollout có backup, thứ tự schema/code, rollback đã thử và người trực vận hành.
  Chỉ người được phép deploy/apply remote; push GitHub không tự có nghĩa production-ready.

## Tiêu chuẩn hoàn thiện

Chỉ báo “sẵn sàng giải chính thức” khi luồng E2E đúng luật/quyền, sandbox bot lạ, tải và recovery
có bằng chứng trên môi trường triển khai; offline hoàn tất nếu công bố phạm vi giải online + offline.
Có thể nghiệm thu online trước nhưng phải ghi rõ offline chưa xong, không tuyên bố toàn dự án hoàn thiện.
Agent sau chọn một checkbox còn thiếu làm milestone, không tự thực hiện toàn checklist trong một phiên.