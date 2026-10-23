/**
 * create-admin.js — Tạo tài khoản admin đầu tiên trên Supabase (một lần).
 *
 * Không ghi đè, không đổi mật khẩu tài khoản đã có. Mật khẩu sinh ngẫu nhiên và
 * lưu vào `data/local-admin-credentials.txt` (không commit, không chia sẻ).
 *
 * Chạy: `node tools/cli/create-admin.js` sau khi đã điền SUPABASE_* trong `.env`.
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import config from '../../server/config.js';
import { assertSharedConfig } from '../../server/shared/client.js';
import * as accounts from '../../server/shared/accounts.js';

assertSharedConfig();

if ((await accounts.listAccounts()).some((account) => account.role === 'admin')) {
  console.log('Admin đã tồn tại. Không thay mật khẩu hoặc ghi đè tài khoản.');
} else {
  const file = path.join(config.dataDir, 'local-admin-credentials.txt');
  if (existsSync(file)) throw new Error('File biên nhận admin đã tồn tại; kiểm tra thủ công trước khi tiếp tục.');
  const password = randomBytes(18).toString('base64url');
  await accounts.createAccount({ username: 'admin', password, role: 'admin' });
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(file, `Local trusted-only OOTv2\nUsername: admin\nPassword: ${password}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Đã tạo admin. Thông tin đăng nhập lưu riêng tại ${file}. Không commit hoặc chia sẻ công khai.`);
}
