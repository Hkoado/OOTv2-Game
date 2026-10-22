import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import config from '../../server/config.js';
import { initDb, closeDb } from '../../server/db.js';
import { initAccounts, listAccounts, createAccount } from '../../server/services/localAccounts.js';
import { sharedEnabled } from '../../server/shared/client.js';
import * as sharedAccounts from '../../server/shared/accounts.js';

if (!sharedEnabled) { initDb(); initAccounts(); }
const accountService = sharedEnabled ? sharedAccounts : { listAccounts, createAccount };
try {
  if ((await accountService.listAccounts()).some((account) => account.role === 'admin')) {
    console.log('Admin đã tồn tại. Không thay mật khẩu hoặc ghi đè tài khoản.');
  } else {
    const file = path.join(config.dataDir, 'local-admin-credentials.txt');
    if (existsSync(file)) throw new Error('File biên nhận admin đã tồn tại; kiểm tra thủ công trước khi tiếp tục.');
    const password = randomBytes(18).toString('base64url');
    await accountService.createAccount({ username: 'admin', password, role: 'admin' });
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(file, `Local trusted-only OOTv2\nUsername: admin\nPassword: ${password}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`Đã tạo admin. Thông tin đăng nhập lưu riêng tại ${file}. Không commit hoặc chia sẻ công khai.`);
  }
} finally { closeDb(); }