/**
 * 智简匣 · 污染数据恢复验证
 * 场景：用户曾遇到崩溃，旧版 restore() 已把 { user: {...} } 错误结构写入 localStorage。
 * 验证：修复后的应用能自动识别并修复污染数据，无需用户手动清理。
 */
const { chromium } = require('playwright-core');
const CHROME =
  'C:/Users/30386/.agent-browser/browsers/chrome-155.0.8059.84/chrome.exe';
const BASE = process.env.ZJ_BASE || 'http://localhost:3000';

const results = [];
function log(ok, name, extra = '') {
  results.push({ ok, name, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  →  ' + extra : ''}`);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  try {
    // 1) 先正常注册，拿到真实用户数据
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      const el = document.querySelector('.zj-scroll-snap');
      el.scrollTo({ top: el.clientHeight, behavior: 'instant' });
    });
    await page.waitForTimeout(1500);
    // 回到第 1 页，通过欢迎页内的登录卡片入口打开弹窗（贴近真实用户路径）
    await page.evaluate(() => {
      const el = document.querySelector('.zj-scroll-snap');
      el.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.waitForTimeout(800);
    // 用按钮文本内容精确定位欢迎页的登录卡片入口
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent.includes('登录以使用完整功能'),
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(1500);

    const nick = 'pollute_' + Date.now().toString().slice(-6);
    await page.click('[role="dialog"] button[role="tab"]:has-text("注册")');
    await page.waitForTimeout(400);
    await page.type('#login-nickname', nick);
    await page.type('#login-password', 'poll123456');
    await page.click('[role="dialog"] button:has-text("注册并登录")');
    await page.waitForTimeout(2500);

    const good = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('zj-user') || 'null'),
    );
    log(!!good?.uid, '注册后 localStorage 结构正常', good?.uid);

    // 2) 注入旧版本写入的污染结构 { user: {...} }
    await page.evaluate((g) => {
      localStorage.setItem('zj-user', JSON.stringify({ user: g }));
    }, good);
    log(true, '已注入污染数据 { user: {...} }');

    // 3) 重新加载页面 —— 这在旧版会直接崩溃
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3500);

    const after = await page.evaluate(() => ({
      cached: JSON.parse(localStorage.getItem('zj-user') || 'null'),
      bodyText: document.body.innerText,
      // 真正的错误标志：#__next_error__ 或含错误文案的 portal
      hasErrorOverlay: (() => {
        if (document.querySelector('#__next_error__')) return true;
        const portal = document.querySelector('nextjs-portal');
        // 空的 portal 是 Next 开发工具挂载点，不算错误
        return !!(portal && (portal.textContent || '').trim().length > 0);
      })(),
    }));

    log(
      !after.hasErrorOverlay,
      '污染数据下页面未进入错误覆盖层（不再崩溃）',
    );
    log(
      pageErrors.length === 0,
      '污染数据下无未捕获运行时异常',
      pageErrors.slice(0, 2).join(' | ') || '0 条',
    );
    log(
      after.cached && typeof after.cached.uid === 'string' && after.cached.uid.length > 0,
      '污染数据被自动修复为正确结构',
      JSON.stringify(after.cached).slice(0, 70),
    );
    log(
      after.bodyText.includes('UID '),
      '欢迎页正常渲染用户信息',
    );
  } catch (err) {
    log(false, '测试执行中断', err.message.split('\n')[0]);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n===== 污染恢复：${results.length - failed.length}/${results.length} 通过 =====`,
  );
  if (failed.length) {
    failed.forEach((f) => console.log('  FAILED: ' + f.name + '  ' + f.extra));
    process.exit(1);
  }
})();
