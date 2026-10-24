import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginThrottle, LOGIN_PER_ACCOUNT, LOGIN_PER_IP } from '../server/lib/loginThrottle.js';

test('1. In-memory throttle: giới hạn 10 lần cho cặp ip + username', async () => {
  const throttle = createLoginThrottle({ rpcClient: null });
  const ip = '192.168.1.100';
  const username = 'student_a';

  for (let i = 0; i < LOGIN_PER_ACCOUNT; i++) {
    const res = await throttle.check({ ip, username });
    assert.equal(res.allowed, true, `Lần ${i + 1} phải được phép`);
  }

  // Lần 11 phải bị chặn
  const blocked = await throttle.check({ ip, username });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter > 0);

  // Tài khoản khác từ cùng IP vẫn được phép (miễn chưa vượt trần IP)
  const anotherUser = await throttle.check({ ip, username: 'student_b' });
  assert.equal(anotherUser.allowed, true);
});

test('2. In-memory throttle: reset chỉ xoá cặp ip + username thành công', async () => {
  const throttle = createLoginThrottle({ rpcClient: null });
  const ip = '10.0.0.1';
  const username = 'test_user';

  for (let i = 0; i < LOGIN_PER_ACCOUNT; i++) {
    await throttle.check({ ip, username });
  }
  assert.equal((await throttle.check({ ip, username })).allowed, false);

  // Reset sau khi đăng nhập thành công
  await throttle.reset({ ip, username });

  // Được phép thử lại ngay
  const afterReset = await throttle.check({ ip, username });
  assert.equal(afterReset.allowed, true);
});

test('3. In-memory throttle: giới hạn 60 lần cho toàn bộ IP', async () => {
  const throttle = createLoginThrottle({ rpcClient: null });
  const ip = '172.16.0.5';

  for (let i = 0; i < LOGIN_PER_IP; i++) {
    const res = await throttle.check({ ip, username: `user_${i}` });
    assert.equal(res.allowed, true);
  }

  // Lần 61 từ cùng IP phải bị chặn
  const blocked = await throttle.check({ ip, username: 'user_overflow' });
  assert.equal(blocked.allowed, false);
});

test('4. Supabase RPC throttle: tích hợp RPC phân tán', async () => {
  const rpcCalls = [];
  const mockRpc = async (proc, params) => {
    rpcCalls.push({ proc, params });
    if (proc === 'mvp_login_throttle_hit') {
      if (params.p_key.includes('blocked_user')) {
        return { allowed: false, retryAfter: 42, hits: 11 };
      }
      return { allowed: true, retryAfter: 60, hits: 1 };
    }
    if (proc === 'mvp_login_throttle_reset') {
      return null;
    }
    throw new Error(`Unexpected proc ${proc}`);
  };

  const throttle = createLoginThrottle({ rpcClient: mockRpc });

  // Thử đăng nhập thành công
  const ok = await throttle.check({ ip: '1.2.3.4', username: 'good_user' });
  assert.equal(ok.allowed, true);
  assert.equal(rpcCalls.length, 2, 'Phải gọi 2 lần: accountKey và ipKey');
  assert.equal(rpcCalls[0].proc, 'mvp_login_throttle_hit');
  assert.ok(rpcCalls[0].params.p_key.includes('good_user'));
  assert.ok(rpcCalls[1].params.p_key.startsWith('ip:'));

  // Thử tài khoản bị chặn
  const blocked = await throttle.check({ ip: '1.2.3.4', username: 'blocked_user' });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 42);

  // Reset
  await throttle.reset({ ip: '1.2.3.4', username: 'good_user' });
  assert.equal(rpcCalls[rpcCalls.length - 1].proc, 'mvp_login_throttle_reset');
});

test('5. Supabase RPC throttle: tự động fallback in-memory nếu RPC lỗi', async () => {
  const failingRpc = async () => {
    throw new Error('Supabase network down');
  };

  const throttle = createLoginThrottle({ rpcClient: failingRpc });
  const ip = '192.168.1.50';
  const username = 'fallback_user';

  // Không ném lỗi ra ngoài mà fallback về in-memory
  const res = await throttle.check({ ip, username });
  assert.equal(res.allowed, true);
});

test('6. H5: RPC fallback không bị đếm đôi (double count) khi RPC lỗi', async () => {
  const failingRpc = async () => {
    throw new Error('Supabase network down');
  };

  const throttle = createLoginThrottle({ rpcClient: failingRpc });
  const ip = '192.168.1.99';
  const username = 'target_account';

  // Thử 10 lần liên tiếp: tất cả 10 lần phải allowed = true (không bị chặn ở lần 6 do đếm đôi)
  const results = [];
  for (let i = 1; i <= 10; i++) {
    const res = await throttle.check({ ip, username });
    results.push(res.allowed);
    assert.equal(res.allowed, true, `Lần thứ ${i} phải được phép`);
  }

  assert.deepEqual(results, [true, true, true, true, true, true, true, true, true, true]);

  // Lần thứ 11 mới bị chặn
  const eleventh = await throttle.check({ ip, username });
  assert.equal(eleventh.allowed, false, 'Lần thứ 11 phải bị chặn');
  assert.ok(eleventh.retryAfter > 0);
});

test('7. H5: RPC lỗi ở lần gọi thứ hai (IP check) vẫn fallback an toàn và không đếm đôi', async () => {
  let callCount = 0;
  const partialFailingRpc = async (proc, params) => {
    callCount++;
    if (callCount % 2 === 1) {
      // Lần 1 (accountKey) thành công
      return { allowed: true, retryAfter: 60 };
    }
    // Lần 2 (ipKey) thất bại
    throw new Error('IP RPC timeout');
  };

  const throttle = createLoginThrottle({ rpcClient: partialFailingRpc });
  const ip = '10.10.10.10';
  const username = 'partial_user';

  for (let i = 1; i <= 10; i++) {
    const res = await throttle.check({ ip, username });
    assert.equal(res.allowed, true, `Lần ${i} phải được phép`);
  }

  const blocked = await throttle.check({ ip, username });
  assert.equal(blocked.allowed, false, 'Lần thứ 11 phải bị chặn');
});
