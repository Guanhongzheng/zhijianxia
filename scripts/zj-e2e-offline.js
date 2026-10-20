/**
 * 智简匣 · 后端离线场景验证
 * 验证：后端未启动时，纯本地功能可用；依赖后端的功能弹出规范提示。
 */
const { chromium } = require('playwright-core');
const CHROME =
  'C:/Users/30386/.agent-browser/browsers/chrome-155.0.8059.84/chrome.exe';

const BASE = process.env.ZJ_BASE || 'http://localhost:3100';

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
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  try {
    // 强制把后端地址指向一个不存在的端口，模拟后端未启动
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      localStorage.setItem(
        'zj-lan-config',
        JSON.stringify({ host: '127.0.0.1', port: 59999, autoReconnect: true }),
      );
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3500); // 等轮询检测失败

    // 后端离线状态：页头徽标 + 欢迎页提示文案
    const badge = await page.textContent('body');
    log(
      badge.includes('后端未启动') ||
        badge.includes('本地 AI 与插件无需后端'),
      '后端离线状态正确显示',
    );

    // 滚到第 2 页
    await page.evaluate(() => {
      const el = document.querySelector('.zj-scroll-snap');
      el.scrollTo({ top: el.clientHeight, behavior: 'instant' });
    });
    await page.waitForTimeout(2000);

    // 公告应给出友好提示而非崩溃
    const dash = await page.$eval(
      '.zj-snap-section:nth-child(2)',
      (el) => el.textContent,
    );
    log(
      dash.includes('公告需要后端服务支持'),
      '公告模块在离线时给出友好提示',
      dash.includes('公告需要后端服务支持') ? 'OK' : '未找到提示文案',
    );

    // 登录弹窗应提示后端未开启
    const dlg = await page.textContent('[role="dialog"]').catch(() => '');
    log(
      (dlg ?? '').includes('后端服务未开启'),
      '登录弹窗提示后端未开启',
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // 点击「好友」应弹出后端未开启提示
    await page.click(
      '.zj-snap-section:nth-child(2) button:has-text("好友")',
    );
    await page.waitForTimeout(2500);
    const gate = await page.textContent('[role="dialog"]').catch(() => '');
    log(
      (gate ?? '').includes('后端服务未开启') ||
        (gate ?? '').includes('请启动后端服务后再使用该功能'),
      '依赖后端的功能弹出统一提示',
      (gate ?? '').slice(0, 40).replace(/\s+/g, ' '),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // 纯本地功能：功能广场应正常打开
    // 精确点击「功能广场」卡片
    await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('.zj-snap-section:nth-child(2) .zj-card'),
      );
      const target = cards.find(
        (c) =>
          c.querySelector('p.text-sm.font-medium')?.textContent.trim() ===
          '功能广场',
      );
      if (target) target.click();
    });
    await page.waitForTimeout(1500);
    const mkt = await page.textContent('[role="dialog"]').catch(() => '');
    log(
      (mkt ?? '').includes('功能广场') && (mkt ?? '').includes('番茄专注计时器'),
      '纯本地功能（功能广场）离线可用',
    );

    // 本地插件安装应正常
    const installBtn = await page.$(
      '[role="dialog"] button:has-text("安装"):not(:has-text("导入"))',
    );
    if (installBtn) {
      await installBtn.click();
      await page.waitForTimeout(1500);
      const after = await page.textContent('[role="dialog"]');
      log(
        (after ?? '').includes('卸载') || (after ?? '').includes('导出'),
        '离线状态下插件安装正常',
      );
    } else {
      log(false, '离线状态找到安装按钮');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);

    // 主题包切换（纯本地）应正常
    const before = await page.$eval('body', (el) => getComputedStyle(el).backgroundColor);
    await page.click(
      '.zj-snap-section:nth-child(2) button[aria-label="切换亮暗模式"]',
    );
    await page.waitForTimeout(1000);
    const after = await page.$eval('body', (el) => getComputedStyle(el).backgroundColor);
    log(before !== after, '离线状态下主题切换正常', `${before} → ${after}`);

    log(consoleErrors.length === 0, '离线场景无未捕获异常', consoleErrors.slice(0, 2).join(' | '));
  } catch (err) {
    log(false, '测试执行中断', err.message.split('\n')[0]);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n===== 离线场景：${results.length - failed.length}/${results.length} 通过 =====`,
  );
  if (failed.length) {
    failed.forEach((f) => console.log('  FAILED: ' + f.name + '  ' + f.extra));
    process.exit(1);
  }
})();
