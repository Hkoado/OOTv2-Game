# OOTv2 — Nền tảng thi đấu bot Oẳn Tù Tì

OOTv2 là ứng dụng web tổ chức giải đấu bot lập trình trên bàn cờ chiến thuật **9 × 9**. Mỗi đội xây dựng bot Python tự xếp quân và lựa chọn nước đi. Hệ thống tiếp nhận bài qua GitHub, khóa phiên bản thi đấu, chấm bằng worker riêng, tính kết quả và phát diễn biến trận đấu theo lịch của ban tổ chức.

Dự án kết hợp **cổng quản lý giải**, **engine luật cờ**, **pipeline chấm bot**, **bảng xếp hạng/knockout** và **trình xem trận đấu**. Người dùng cũng có thể chơi hai người trên cùng máy để tìm hiểu luật và thử bản đồ.

> **Phạm vi bàn giao:** mã nguồn phục vụ thẩm định và demo nội bộ có kiểm soát. Build/test thành công không đồng nghĩa đủ điều kiện mở dịch vụ chấm code không tin cậy. Hướng dẫn triển khai và vận hành nằm trong [runbook BTC](docs/runbook/BAN-TO-CHUC.md).

## Mục lục

1. [Mục tiêu và chức năng](#1-mục-tiêu-và-chức-năng)
2. [Luật và bot Python](#2-luật-và-bot-python)
3. [Công nghệ và kiến trúc](#3-công-nghệ-và-kiến-trúc)
4. [Cấu trúc dự án](#4-cấu-trúc-dự-án)
5. [Cài đặt và chạy](#5-cài-đặt-và-chạy)
6. [Kiểm thử](#6-kiểm-thử)
7. [Triển khai và an toàn](#7-triển-khai-và-an-toàn)
8. [Tài liệu và kịch bản duyệt](#8-tài-liệu-và-kịch-bản-duyệt)

## 1. Mục tiêu và chức năng

### Đối tượng sử dụng

- **Đội thi:** phát triển thuật toán Python, khai báo repository, theo dõi biên nhận và kết quả được công bố.
- **Ban tổ chức (BTC):** quản lý tài khoản/đội/giải, map, hạn nộp, duyệt repository, điều hành vòng đấu và công bố kết quả.
- **Người vận hành:** chuẩn bị Supabase, worker Linux, sandbox, migration, sao lưu và phục hồi.
- **Hội đồng duyệt:** xem kiến trúc, mã nguồn, bộ kiểm thử, hướng dẫn demo và giới hạn thực tế.

### Chức năng có trong mã nguồn

| Nhóm | Nội dung |
| --- | --- |
| Tài khoản | Đăng nhập theo phiên, admin/đội, kiểm quyền theo giải, CSRF và giới hạn đăng nhập |
| Thiết lập giải | Giải tuần/tháng/kỳ, danh sách đội, seed, chia bảng, cutoff, map chính/dự phòng và khóa map đã công bố |
| Nộp bot GitHub | Repository được BTC duyệt; commit SHA, job kiểm tra, receipt và trạng thái lỗi |
| Khóa phiên bản | Snapshot nguồn/map/seed/protocol/runtime/budget; retry không tự đổi bài đã pin |
| Chấm giải | Worker Campus riêng, vòng bảng, phân màu, điểm, knockout và vé đi tiếp |
| Công bố | Kết quả kín trước công bố; phát nước đi theo lịch, viewer/replay và kiểm quyền server |
| Chơi cùng máy | Xếp quân thủ công, setup kín, năm map Campus v2 và lịch sử nước đi |
| Công cụ | Kiểm map/replay, bot mẫu, health, migration, bộ cài VM và script kiểm thử |

**Chung kết thủ công** có mã nguồn admin-only để nạp/chọn/khóa bot và chấm qua API/Supabase/worker có kết nối. Nghiệm thu đầu-cuối module này đang hoãn; đây **không phải** giải hoạt động hoàn toàn không Internet.

Mã phòng/P2P và giải MVP cũ được giữ để tương thích/hồi quy. Entrypoint hiện tại chỉ mount **CampusPortal**, không mở giao diện LegacyApp.

## 2. Luật và bot Python

### Bàn cờ Campus v2

- Bàn **9 × 9**, hai bên Đỏ/Xanh; mỗi bên 9 quân: 3 Búa (rock), 3 Bao (paper), 3 Kéo (scissors).
- Búa thắng Kéo, Kéo thắng Bao, Bao thắng Búa.
- Di chuyển một ô theo tám hướng, tuân thủ ô chiếm chỗ, địa hình và luật cắt góc của engine.
- Đỏ đi trước. Thắng bằng chiếm nhà chính hoặc loại hết một loại quân đối thủ; judge xử lý nước sai, timeout và các điều kiện kết thúc.
- Setup bot kín: không nhận đội hình đối phương trước khi hai bên hoàn tất; không tự điền hộ setup thiếu/sai.

| Địa hình | Loại quân bị cản |
| --- | --- |
| Lửa | Bao |
| Nước | Kéo |
| Bụi cây | Búa |
| Vực | Tất cả |

Năm map luyện tập: learn-fire, learn-water, learn-bush, learn-chasm, campus-four-terrains. Map/replay v1 lịch sử không bị chuyển luật ngầm. Xem [luật chi tiết](docs/17-LUAT-DIA-HINH-VA-XEP-KIN.md).

### Chuẩn bot

- Một file **bot.py** UTF-8 tại gốc repository, tối đa **256 KiB**, chỉ thư viện chuẩn Python; không ZIP/package hoặc cài pip.
- Protocol Campus **bot.v1**, JSON Lines qua stdin/stdout, process persistent; viết cả setup và move, flush mỗi phản hồi, không in debug ra stdout.
- Setup tự trả đủ 9 quân ở 9 vị trí hợp lệ theo màu/map; không xếp tay thay bot.
- Mẫu hiện hành: [campus_bot.py](examples/campus_bot.py). Mẫu sample_bot.py là protocol MVP stateless lịch sử, không thay bot Campus.
- Budget mặc định Campus: **400 plies**, setup wall 5 giây, move wall 1 giây, tổng phản hồi 45 giây, CPU 30 giây, RAM 256 MiB, tối đa 32 process. Budget được pin/hash trong runtime; không suy ra mọi chỉ số đã nghiệm thu trên production.
- Profile MVP cũ vẫn giữ **200 plies** và protocol/replay riêng.

## 3. Công nghệ và kiến trúc

| Thành phần | Công nghệ |
| --- | --- |
| Frontend | React 19, Vite 6, JavaScript ESM, CSS, UI kit và font đi kèm |
| API | Node.js >=22.12, Express 5, REST và polling |
| Dữ liệu | Supabase PostgreSQL + Storage private; không SQLite |
| Bot | Python >=3.12, thư viện chuẩn |
| Worker | Node.js riêng, Campus runtime và adapter sandbox Linux |
| Cô lập | Script namespace/cgroup/seccomp, attestation; cần nghiệm thu đúng release |
| Kiểm thử | Node built-in test runner, SQL smoke và script browser |
| Đóng gói | Web/API trên Vercel; worker trên VM Linux riêng, công cụ Windows/Hyper-V |

~~~text
Trình duyệt React
        │ REST /api, cookie session + CSRF
        ▼
Express API ─── metadata repository/SHA ─── GitHub
        │
        ▼
Supabase PostgreSQL + Storage private
        ▲                         ▲
        │ job/receipt             │ snapshot/lease/result/replay
GitHub intake worker       Official Campus worker
        │                         │
 tải bot đúng SHA          Engine + Linux sandbox
                                  │ JSONL
                              Python bot A/B
~~~

API không chạy Python và không clone repository. Worker kiểm artifact/hash đã pin và ghi kết quả qua lease/fencing. Trình duyệt chỉ hiển thị dữ liệu được server cho phép, không quyết định thắng thua. Health API không chứng nhận worker/sandbox sẵn sàng.

## 4. Cấu trúc dự án

Workspace bàn giao: **D:\OOTv2-Game**. Cây dưới dùng đường dẫn tương đối với gốc đó. Danh mục **toàn bộ file** được trình bày trong [PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md).

~~~text
OOTv2-Game/
├── api/                     # Entrypoint Express trên Vercel
├── docs/                    # Đặc tả, hướng dẫn vận hành, review, danh mục file
│   ├── runbook/             # Hướng dẫn BTC và đội thi
│   └── ui-style/            # Style, token và tham khảo asset
├── examples/                # Bot Python mẫu
│   └── maps/                # Map v2 và fixture v1 lịch sử
├── public/                  # Tài nguyên tĩnh public
├── sandbox/
│   ├── fixtures/            # Kiểm tài nguyên/cô lập; không chạy trên host
│   └── linux/               # Runner, preflight, selftest, seccomp, attestation
├── server/
│   ├── contracts/           # Bot protocol, schema map, snapshot/hash
│   ├── judge/               # Engine/runner Campus, MVP và sandbox adapter
│   ├── lib/                 # HTTP, origin, throttle, phân bảng/màu
│   ├── middleware/          # Upload
│   ├── replay/              # Replay Campus
│   ├── routes/              # API official, manual, live
│   ├── services/            # Intake, cutoff, điều phối, kết quả, phát sóng
│   ├── shared/              # Supabase, auth, artifact, queue và RPC adapter
│   ├── app.js               # Express app
│   ├── config.js            # Env và giới hạn
│   ├── index.js             # Khởi động API
│   ├── githubWorker.js      # Worker intake GitHub
│   ├── officialWorker.js    # Worker Campus / manual
│   └── worker.js            # Worker MVP lịch sử
├── src/
│   ├── components/          # Component game gốc
│   ├── game/                # Luật, state, terrain, map và offline game
│   ├── sync/                # Phòng/P2P cũ, không mount mặc định
│   ├── tournament/          # API client, replay và UI MVP giữ lại
│   │   └── portal/          # Cổng giải, setup, bài nộp, kết quả, offline
│   │       └── live/        # Viewer/publication
│   ├── ui/                  # Board adapter, UI kit, atlas/font/license
│   ├── App.jsx              # Mount CampusPortal
│   ├── LegacyApp.jsx        # Giao diện cũ giữ tương thích
│   ├── main.jsx             # React entrypoint
│   └── index.css            # CSS nền
├── supabase/
│   ├── migrations/          # SQL versioned, không xóa/đổi lịch sử
│   └── tests/               # Kiểm tra PostgreSQL
├── tests/                   # Unit, regression, API/contract và mô phỏng
├── tools/
│   ├── cli/                 # Demo, validate, health, migration, drill
│   ├── production/          # Manifest migration, cấu hình worker
│   ├── provision/           # Linux/systemd, update/rollback
│   └── vm/                  # Cài/điều khiển VM từ Windows
├── .env.example             # Mẫu env không chứa credential
├── .gitattributes           # Quy tắc Git/line ending
├── .gitignore               # Loại secret/cache/output sinh tự động
├── AGENTS.md                # Quy tắc bảo trì
├── index.html               # HTML shell
├── package.json             # Dependency và lệnh
├── package-lock.json        # Dependency lockfile
├── README.md                # Giới thiệu và chạy dự án
├── vercel.json              # Serverless build/header/routing
└── vite.config.js           # React build và proxy API
~~~

**Không thuộc hồ sơ mã nguồn:** .git/, node_modules/, dist/, data/, .env, .envdev, cache Python, log, backup và credential. Không nén toàn bộ workspace thô để nộp vì data/ và env có thể chứa dữ liệu riêng. Không xóa source legacy/fixture chỉ vì chúng không được mount.

## 5. Cài đặt và chạy

### Yêu cầu

Node.js >=22.12, npm, Python >=3.12; project Supabase riêng cho demo với schema và Storage private đúng cấu hình. Giải online cần Internet cho GitHub/Supabase. Worker production cần VM Linux theo tài liệu sandbox, không chạy bot lạ trên Windows host.

### Cài dependency và cấu hình

~~~powershell
Set-Location D:\OOTv2-Game
npm.cmd ci
Copy-Item .env.example .env
~~~

Điền SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY và nên đặt OOTV2_EXPECTED_PROJECT_REF trong .env. Không commit/gửi credential cùng hồ sơ và không dùng tiền tố VITE_ cho secret.

**DB:** operator đối chiếu tools/production/migrationPlan.js, SQL trong supabase/migrations/ và ledger đích. Lệnh npm.cmd run db:production mặc định chỉ kiểm cấu hình/manifest, không apply và không xác nhận schema remote. Bootstrap/apply/Storage là thao tác quản trị cần phê duyệt, backup và đích rõ ràng; không tự chạy trên DB có dữ liệu. Xem [bootstrap](docs/PRODUCTION-BOOTSTRAP.md).

Khi schema sẵn sàng, operator có thể chạy npm.cmd run db:admin để tạo admin đầu tiên. Lệnh này **ghi DB**, chỉ chạy trên project được phép; credential ngẫu nhiên lưu riêng tại data/local-admin-credentials.txt, không có mật khẩu mặc định công khai.

### Chạy frontend và API

~~~powershell
# Terminal 1: API 127.0.0.1:3001
npm.cmd run dev:api
# Terminal 2: Vite 127.0.0.1:3000, proxy /api sang API
npm.cmd run dev
~~~

Hoặc phục vụ web đã build cùng origin API:

~~~powershell
npm.cmd run build
npm.cmd start
~~~

Chọn **Chơi offline** ở màn đăng nhập để thử bàn cờ cùng máy. Luồng tài khoản/giải cần API và DB, không fallback dữ liệu giả khi mất kết nối. Trên Windows, dùng npm.cmd nếu execution policy chặn npm.ps1; không cần đổi policy toàn máy.

### Worker và demo bot tin cậy

~~~powershell
npm.cmd run worker:github
npm.cmd run worker:official
npm.cmd run worker:health -- --scope=judge --json
~~~

Các worker là process riêng, chỉ chạy sau khi chuẩn bị schema, artifact và môi trường cô lập; không chạy worker trên Vercel. Đọc [bộ cài](docs/WORKER-PACKAGING.md) và [sandbox](sandbox/README.md) trước khi khởi động.

Demo chỉ dùng bot mẫu tin cậy, output phải chưa tồn tại:

~~~powershell
node tools/cli/demo-campus-bots.js --trusted-dev examples/maps/campus-four-terrains.json "$env:TEMP/ootv2-campus-demo-new.json"
node tools/cli/verify-replay.js "$env:TEMP/ootv2-campus-demo-new.json"
~~~

Trusted-dev **không phải sandbox an toàn**, production cấm chế độ này. Không chạy fixture phá tài nguyên trong sandbox/fixtures/ trực tiếp trên host.

### Biến môi trường chính

| Biến | Ý nghĩa |
| --- | --- |
| SUPABASE_URL | Project DB/Storage chung cho API và worker |
| SUPABASE_SERVICE_ROLE_KEY | Chỉ backend/worker, không frontend |
| OOTV2_EXPECTED_PROJECT_REF | Guard tránh nhầm project |
| OOTV2_ENV_FILE | Chọn env tường minh; development mặc định .env |
| OOTV2_API_HOST / OOTV2_API_PORT | Local mặc định 127.0.0.1:3001 |
| OOTV2_PUBLIC_ORIGIN / OOTV2_TRUST_PROXY | Origin/proxy cho CSRF và HTTPS cookie |
| OOTV2_GITHUB_TOKEN | Credential đọc GitHub của BTC, chỉ backend |
| OOTV2_DATA_DIR / OOTV2_PYTHON_BIN | Cache riêng và executable Python |
| OOTV2_CAMPUS_SANDBOX | Production worker dùng linux-sandbox |
| OOTV2_SANDBOX_RUNNER / OOTV2_SANDBOX_ATTESTATION | Runner/receipt đúng release trên VM |
| OOTV2_ALLOW_TRUSTED_DEV | Chỉ opt-in dev tin cậy, cấm production |

Production nhận cấu hình từ platform/service, không tự nạp .env của checkout. .envdev chỉ dùng khi chọn tường minh. Xem toàn bộ ví dụ tại [.env.example](.env.example).

## 6. Kiểm thử

~~~powershell
npm.cmd test
npm.cmd run test:engine
npm.cmd run build
npm.cmd audit
node --test src/ui/ott-v2-ui-kit/board.test.mjs
node tools/cli/smoke-ui-kit.mjs
git diff --check
~~~

Smoke UI kit hiện dùng Edge trên Windows. Test bao phủ luật/terrain, protocol, runner, snapshot/hash, queue/fencing, ACL/CSRF, cutoff, publication, standings/knockout, replay và cấu hình triển khai. Mock/mô phỏng không thay nghiệm thu DB/VM/browser tích hợp.

Browser smoke chỉ gồm màn đăng nhập/offline trên preview, không thay E2E API/DB theo vai trò. Chạy lại các lệnh trên với đúng commit chuẩn bị triển khai; không dùng kết quả của một checkout cũ để xác nhận release mới.

## 7. Triển khai và an toàn

- Vercel: frontend + API, **không thực thi Python**.
- Supabase: schema, grants/RLS và Storage private đúng manifest.
- VM Linux: intake và worker, kiểm runtime/sandbox/artifact trước chạy.
- /api/health chỉ liveness; /api/ready cần admin, chỉ kiểm DB, không chứng nhận worker.
- Không mở code bên ngoài trước gate sandbox, hai worker/recovery, rollback và restore.
- Cutoff dùng cutoff-first-resolution.v1: lần resolve thành công đầu sau cutoff, **không chứng minh HEAD lịch sử đúng tại hạn nộp**. Lưu ý giới hạn thời gian xử lý trong runbook BTC.
- Không tự sửa snapshot/replay/migration lịch sử để vượt lỗi runtime/hash.
- Chưa có LICENSE toàn dự án trong checkout. Font có OFL đi kèm; quyền ảnh đầu vào atlas cần chủ dự án xác nhận trước khi phân phối công khai. Không tự tuyên bố MIT hoặc asset đã được duyệt.

## 8. Tài liệu và kịch bản duyệt

- [Mục lục kỹ thuật](docs/README.md).
- [Toàn bộ danh mục file](docs/PROJECT-STRUCTURE.md).
- [Hướng dẫn đội thi](docs/runbook/SINH-VIEN.md).
- [Hướng dẫn BTC](docs/runbook/BAN-TO-CHUC.md).

**Kịch bản trình bày:** (1) chơi cùng máy với map bốn địa hình; (2) giới thiệu bot mẫu/protocol; (3) đăng nhập admin/đội trên DB demo riêng; (4) trình bày receipt/snapshot và vòng đấu khi worker sẵn sàng; (5) công bố ván đã chấm và mở viewer; (6) chạy test/build, đối chiếu giới hạn còn lại. Không dùng dữ liệu sản xuất/secret hoặc bỏ gate để demo.
