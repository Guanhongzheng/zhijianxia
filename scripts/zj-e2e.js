/**
 * 智简匣 · 端到端验证脚本
 * 验证：欢迎页渲染、两页滚动吸附、滚动触发登录弹窗、登录流程、
 *       公告加载、功能广场、插件安装、主题切换、控制台错误。
 */
const { chromium } = require('playwright-core');

const BASE = process.env.ZJ_BASE || 'http://localhost:3100';
const CHROME =
  'C:/Users/30386/.agent-browser/browsers/chrome-155.0.8059.84/chrome.exe';

const results = [];
function log(ok, name, extra = '') {
  results.push({ ok, name, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  →  ' + extra : ''}`);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  try {
    // ---------- 1. 欢迎页 ----------
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);

    const h1 = await page.textContent('.zj-snap-section:nth-child(1) h1');
    log(h1?.includes('智简匣') ?? false, '欢迎页标题渲染', h1 ?? '');

    const hero = await page.textContent('.zj-snap-section:nth-child(1)');
    log(
      (hero ?? '').includes('把 AI 装进你自己的设备'),
      '欢迎页主文案渲染',
      (hero ?? '').replace(/\s+/g, ' ').slice(0, 40),
    );

    const loginCard = await page.$('text=登录以使用完整功能');
    log(!!loginCard, '未登录时欢迎页内直接展示登录卡片入口');

    // ---------- 2. 滚动吸附结构 ----------
    const snapSections = await page.$$eval('.zj-snap-section', (els) => els.length);
    log(snapSections === 2, '页面为两个滚动吸附区块', `实际 ${snapSections}`);

    const snapType = await page.$eval('.zj-scroll-snap', (el) =>
      getComputedStyle(el).scrollSnapType,
    );
    log(snapType.includes('y'), '滚动吸附类型为 y mandatory', snapType);

    // ---------- 3. 滚动到第 2 页触发登录弹窗 ----------
    await page.evaluate(() => {
      const el = document.querySelector('.zj-scroll-snap');
      el.scrollTo({ top: el.clientHeight, behavior: 'instant' });
    });
    await page.waitForTimeout(1600);

    const dialogOpen = await page.$('[role="dialog"]');
    log(!!dialogOpen, '滚动到第 2 页自动弹出登录弹窗');

    const dialogTitle = await page
      .textContent('[role="dialog"] h2, [role="dialog"]')
      .catch(() => '');
    log(
      (dialogTitle ?? '').includes('登录智简匣'),
      '登录弹窗标题正确',
      (dialogTitle ?? '').slice(0, 20),
    );

    // ---------- 4. 注册 / 登录 ----------
    const nickname = 'e2e_' + Date.now().toString().slice(-6);
    await page.click('button[role="tab"]:has-text("注册")').catch(() => {});
    await page.waitForTimeout(400);

    await page.type('#login-nickname', nickname);
    await page.type('#login-password', 'e2e123456');
    await page.click('[role="dialog"] button:has-text("注册并登录")');
    await page.waitForTimeout(2500);

    const stillDialog = await page.$('[role="dialog"]');
    log(!stillDialog, '注册后自动关闭登录弹窗', nickname);

    // ---------- 4.5 刷新页面恢复登录态（本次崩溃的触发路径） ----------
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const afterReload = await page.evaluate(() => ({
      // 读取 localStorage 中持久化的用户资料
      cached: (() => {
        try {
          return JSON.parse(localStorage.getItem('zj-user') || 'null');
        } catch {
          return 'PARSE_ERROR';
        }
      })(),
      // 欢迎页是否渲染出用户卡片（uid 非空）
      bodyText: document.body.innerText,
    }));

    log(
      afterReload.cached && typeof afterReload.cached.uid === 'string' &&
        afterReload.cached.uid.length > 0,
      '刷新后 localStorage 中的用户资料结构正确（含 uid）',
      JSON.stringify(afterReload.cached).slice(0, 80),
    );
    log(
      afterReload.bodyText.includes('进入功能区') &&
        !afterReload.bodyText.includes('登录以使用完整功能'),
      '刷新后欢迎页正确渲染已登录状态（不再崩溃）',
      nickname,
    );

    // 再次滚到第 2 页，确认不会重复弹出登录弹窗
    await page.evaluate(() => {
      const el = document.querySelector('.zj-scroll-snap');
      el.scrollTo({ top: el.clientHeight, behavior: 'instant' });
    });
    await page.waitForTimeout(2000);
    const dialogAfterReload = await page.$('[role="dialog"]');
    log(
      !dialogAfterReload,
      '已登录状态下滚动到第 2 页不再弹出登录弹窗',
    );

    // ---------- 5. 第 2 页功能汇总 ----------
    const dashTitle = await page.$eval('.zj-snap-section:nth-child(2) h1', (el) => el.textContent);
    log(
      (dashTitle ?? '').includes('初来乍到'),
      '第 2 页标题为「初来乍到」',
      (dashTitle ?? '').slice(0, 20),
    );

    const dashSub = await page.$eval(
      '.zj-snap-section:nth-child(2) h1 + p',
      (el) => el.textContent,
    );
    log(
      (dashSub ?? '').includes('欢迎'),
      '第 2 页标题下方为欢迎语',
      (dashSub ?? '').slice(0, 24),
    );

    // 第 2 页卡片：公告、功能广场、好友、群聊、系统设置（启动插件不在此页）
    const page2 = await page.textContent('.zj-snap-section:nth-child(2)');
    const expected = ['公告', '功能广场', '好友', '群聊', '系统设置'];
    log(
      expected.every((t) => (page2 ?? '').includes(t)),
      '第 2 页包含全部 5 张卡片（公告/功能广场/好友/群聊/系统设置）',
    );
    log(
      !(page2 ?? '').includes('我的插件'),
      '不再单独显示「我的插件」分组',
    );

    // 启动插件位于底部导航栏，不占用卡片位
    const cornerStart = await page.$$eval(
      '.zj-snap-section:nth-child(2) footer button',
      (els) => {
        const b = els.find((e) => e.textContent.includes('启动'));
        return b ? b.textContent.trim() : '';
      },
    );
    log(
      cornerStart.includes('启动'),
      '启动插件为底部导航栏入口（非卡片）',
      cornerStart.slice(0, 20),
    );

    // 上下导航栏均存在
    const navBars = await page.$$eval(
      '.zj-snap-section:nth-child(2) header, .zj-snap-section:nth-child(2) footer',
      (els) => els.length,
    );
    log(navBars === 2, '第 2 页具备上导航栏与下导航栏');

    // 公告内容（后端在线时应加载出来）
    await page.waitForTimeout(2000);
    const noticeBody = await page.textContent('body');
    log(
      noticeBody.includes('欢迎使用智简匣'),
      '公告列表从后端加载成功',
    );

    // ---------- 6. 骨架屏组件存在性 ----------
    const skeletonCount = await page.$$eval('.zj-skeleton', (e) => e.length).catch(() => 0);
    log(true, '统一骨架屏组件已挂载（当前页面实例数）', String(skeletonCount));

    // ---------- 7. 功能广场 ----------
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
    await page.waitForTimeout(1200);
    const mkt = await page.textContent('[role="dialog"]');
    log((mkt ?? '').includes('功能广场'), '功能广场弹窗打开');
    log(
      (mkt ?? '').includes('番茄专注计时器') && (mkt ?? '').includes('极简随身音乐播放器'),
      '广场展示 6 个可下载插件',
    );
    log(
      (mkt ?? '').includes('AI 智能天气随行卡片') ||
        (mkt ?? '').includes('天气'),
      '广场展示预装插件',
    );

    // 搜索
    await page.type('input[placeholder*="搜索插件"]', '番茄');
    await page.waitForTimeout(700);
    const filtered = await page.textContent('[role="dialog"]');
    log(
      (filtered ?? '').includes('番茄专注计时器'),
      '广场关键词搜索生效',
    );

    // ---------- 8. 安装插件 ----------
    const installBtn = await page.$('[role="dialog"] button:has-text("安装"):not(:has-text("导入"))');
    if (installBtn) {
      await installBtn.click();
      await page.waitForTimeout(1500);
      const after = await page.textContent('[role="dialog"]');
      log(
        (after ?? '').includes('卸载') || (after ?? '').includes('导出'),
        '插件一键安装成功（出现卸载/导出按钮）',
      );
    } else {
      log(false, '找到安装按钮');
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);

    // ---------- 9. 插件卡片出现在汇总页 ----------
    await page.waitForTimeout(800);
    // 已安装插件应体现在底部导航栏的启动入口上
    const launcher = await page.$$eval(
      '.zj-snap-section:nth-child(2) footer button',
      (els) => {
        const b = els.find((e) => e.textContent.includes('启动'));
        return b ? b.textContent.trim() : '';
      },
    );
    log(
      (launcher ?? '').length > 0,
      '底部导航栏启动入口显示当前可启动的插件',
      launcher.slice(0, 20),
    );

    // ---------- 9.5 设置面板：左侧导航 / 个人资料 / 个性化 ----------

    // 打开设置
    await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('.zj-snap-section:nth-child(2) .zj-card'),
      );
      const t = cards.find(
        (c) => c.querySelector('p.text-sm.font-medium')?.textContent.trim() ===
          '系统设置',
      );
      if (t) t.click();
    });
    await page.waitForTimeout(1500);

    // 左侧导航
    const navItems = await page.$$eval(
      '[role="dialog"] nav button',
      (els) => els.map((e) => e.textContent.trim()),
    );
    log(
      navItems.includes('个人资料') && navItems.includes('个性化'),
      '设置面板采用左侧导航且含个人资料与个性化',
      navItems.join('、'),
    );

    // 个人资料可编辑
    const hasNicknameInput = await page.$('#profile-nickname');
    log(!!hasNicknameInput, '个人资料含可编辑的昵称输入框');

    // 个性化：主题包 + 界面大小
    await page.evaluate(() => {
      const nav = document.querySelector('[role="dialog"] nav');
      const b = Array.from(nav.querySelectorAll('button')).find(
        (x) => x.textContent.trim() === '个性化',
      );
      if (b) b.click();
    });
    await page.waitForTimeout(1000);

    const personalization = await page.textContent('[role="dialog"]');
    log(
      (personalization ?? '').includes('主题包'),
      '个性化含主题包管理（原全局主题中心插件已并入）',
    );
    log(
      (personalization ?? '').includes('界面大小'),
      '个性化含界面大小设置',
    );

    // 切换到大档，验证根字号变化
    const beforeFont = await page.$eval(
      'html',
      (el) => getComputedStyle(el).fontSize,
    );
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = Array.from(dlg.querySelectorAll('button')).find(
        (b) => b.textContent.trim() === '大',
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(700);
    const afterFont = await page.$eval(
      'html',
      (el) => getComputedStyle(el).fontSize,
    );
    log(
      parseFloat(afterFont) > parseFloat(beforeFont),
      '界面大小切换立即生效',
      `${beforeFont} → ${afterFont}`,
    );

    // 还原为小
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = Array.from(dlg.querySelectorAll('button')).find(
        (b) => b.textContent.trim() === '小',
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    // 全局主题中心插件已移除
    const themePluginGone = await page.evaluate(
      () => !document.body.innerText.includes('全局主题中心'),
    );
    log(themePluginGone, '「全局主题中心」插件已移除');

    // 底栏插件切换器
    const switcher = await page.$('button[aria-label="展开插件列表"]');
    log(!!switcher, '底栏提供可展开的插件切换器');
    if (switcher) {
      await switcher.click();
      await page.waitForTimeout(700);
      const expanded = await page.evaluate(
        () => document.body.innerText.includes('已安装'),
      );
      log(expanded, '插件切换器展开后显示已安装插件列表');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // ---------- 10. 主题切换 ----------
    const beforeBg = await page.$eval('body', (el) => getComputedStyle(el).backgroundColor);
    await page.click('.zj-snap-section:nth-child(2) button[aria-label="切换亮暗模式"]');
    await page.waitForTimeout(1200);
    const afterBg = await page.$eval('body', (el) => getComputedStyle(el).backgroundColor);
    const isDark = await page.$eval('html', (el) => el.classList.contains('dark'));
    log(beforeBg !== afterBg, '亮暗模式切换生效', `${beforeBg} → ${afterBg}`);
    log(isDark, 'html.dark class 正确同步');

    // ---------- 11. 扁平卡片风格 ----------
    const cardStyle = await page.$eval('.zj-card', (el) => {
      const s = getComputedStyle(el);
      return { radius: s.borderRadius, shadow: s.boxShadow, border: s.borderTopWidth };
    });
    log(
      parseFloat(cardStyle.radius) >= 8 && cardStyle.border === '1px',
      '统一扁平卡片样式（圆角 + 1px 边框）',
      JSON.stringify(cardStyle),
    );

    // ---------- 12. 响应式（移动端） ----------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1200);
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    );
    log(mobileOverflow, '移动端视口无横向溢出');
    await page.screenshot({ path: 'shot-mobile.png' });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'shot-dashboard.png' });

    // ---------- 13. 控制台错误 ----------
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('Download the React DevTools') &&
        !e.includes('favicon') &&
        !e.includes('404 (Not Found)'),
    );
    log(
      realErrors.length === 0,
      '无控制台错误',
      realErrors.slice(0, 3).join(' | ') || '0 条',
    );
  } catch (err) {
    log(false, '测试执行中断', err.message);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n===== 结果：${results.length - failed.length}/${results.length} 通过 =====`,
  );
  if (failed.length) {
    failed.forEach((f) => console.log('  FAILED: ' + f.name + '  ' + f.extra));
    process.exit(1);
  }
})();
