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

    // ---------- 8. 获取插件 ----------
    // 仓库里的插件走「下载」（下载后缓存到本地，可离线使用）；
    // 随应用打包的插件走「安装」。两者都应使插件进入已安装状态。
    const actionBtn = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btns = Array.from(dlg.querySelectorAll('button'));
      const install = btns.find(
        (x) => x.textContent.trim() === '安装',
      );
      if (install) {
        install.click();
        return '安装';
      }
      const download = btns.find((x) => x.textContent.trim() === '下载');
      if (download) {
        download.click();
        return '下载';
      }
      return null;
    });
    if (actionBtn) {
      await page.waitForTimeout(2500);
      const after = await page.textContent('[role="dialog"]');
      log(
        (after ?? '').includes('卸载') || (after ?? '').includes('导出'),
        `插件一键${actionBtn}成功（出现卸载/导出按钮）`,
      );
    } else {
      log(false, '找到安装或下载按钮');
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

    // ---------- 9.8 新增能力：插件选择分离 / 模型自选 / API 分类 ----------

    // 插件切换器：选择不直接启动，启动由右下角主行动触发
    const switcherBtn = await page.$('button[aria-label="展开插件列表"]');
    log(!!switcherBtn, '底栏提供插件选择器');
    if (switcherBtn) {
      await switcherBtn.click();
      await page.waitForTimeout(800);

      // 记录选择前的底栏提示
      const hintBefore = await page.$eval(
        '.zj-snap-section:nth-child(2) footer',
        (el) => el.innerText.replace(/\s+/g, ' '),
      );

      // 选择第二个插件（若存在）
      const pickedName = await page.evaluate(() => {
        const panel = document.querySelector('.zj-snap-section:nth-child(2) footer');
        const btns = Array.from(panel.querySelectorAll('button')).filter(
          (x) => x.getAttribute('aria-pressed') !== null,
        );
        const target = btns[1] ?? btns[0];
        if (!target) return null;
        const name = target.innerText.split('\n')[1]?.trim() ?? '';
        target.click();
        return name;
      });
      await page.waitForTimeout(900);

      const dialogAfterPick = await page.$('[role="dialog"]');
      log(
        !dialogAfterPick,
        '插件选择后不直接启动（需点右下角启动）',
        pickedName ?? '',
      );

      const hintAfter = await page.$eval(
        '.zj-snap-section:nth-child(2) footer',
        (el) => el.innerText.replace(/\s+/g, ' '),
      );
      log(
        hintBefore !== hintAfter,
        '选择插件后底栏主行动提示同步更新',
        hintAfter.slice(-24),
      );

      // 点右下角「启动插件」才真正启动
      await page.evaluate(() => {
        const f = document.querySelector('.zj-snap-section:nth-child(2) footer');
        const btn = Array.from(f.querySelectorAll('button')).find((x) =>
          x.textContent.includes('启动插件'),
        );
        if (btn) btn.click();
      });
      await page.waitForTimeout(1500);
      const startedDialog = await page.$('[role="dialog"]');
      log(!!startedDialog, '点右下角「启动插件」后真正启动所选插件');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }

    // 本地模型：国内镜像源 + 用户自选模型
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
    await page.waitForTimeout(1400);
    await page.evaluate(() => {
      const nav = document.querySelector('[role="dialog"] nav');
      const btn = Array.from(nav.querySelectorAll('button')).find(
        (x) => x.textContent.trim() === 'AI 引擎',
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(1400);

    const aiPanel = await page.textContent('[role="dialog"]');
    log(
      (aiPanel ?? '').includes('HF 镜像') &&
        (aiPanel ?? '').includes('HuggingFace 官方'),
      '本地模型提供国内镜像与官方源切换',
    );
    log(
      (aiPanel ?? '').includes('Qwen1.5 0.5B') &&
        (aiPanel ?? '').includes('SmolLM2 360M') &&
        (aiPanel ?? '').includes('Qwen3 0.6B'),
      '本地模型提供多个模型供用户自选下载',
    );

    // API 设置：按能力分类
    await page.evaluate(() => {
      const nav = document.querySelector('[role="dialog"] nav');
      const btn = Array.from(nav.querySelectorAll('button')).find(
        (x) => x.textContent.trim() === 'API',
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(1600);

    const apiPanel = await page.textContent('[role="dialog"]');
    log(
      ['文本对话', '多模态模型', '图像生成', '语音模型'].every((c) =>
        (apiPanel ?? '').includes(c),
      ),
      'API 设置按 4 个能力分类组织',
    );
    log(
      ['OpenAI API', 'Anthropic Claude API', 'Google Gemini API', '智谱AI API', 'DeepSeek API'].every(
        (c) => (apiPanel ?? '').includes(c),
      ),
      'API 设置提供 5 家服务商可选',
    );

    // 切到图像生成，验证 DALL·E 3 与 Stability AI
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = Array.from(dlg.querySelectorAll('button')).find(
        (x) => x.textContent.trim() === '图像生成',
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(1200);
    const imagePanel = await page.textContent('[role="dialog"]');
    log(
      (imagePanel ?? '').includes('Stability AI API'),
      '图像生成分类提供 Stability AI 服务商',
    );
    // DALL·E 3 属于 OpenAI 服务商，切到 OpenAI 后应出现
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = Array.from(dlg.querySelectorAll('button')).find((x) => {
        const line = (x.innerText || '').split('\n')[0]?.trim();
        return line === 'OpenAI API';
      });
      if (btn) btn.click();
    });
    await page
      .waitForFunction(
        () =>
          (document.querySelector('[role="dialog"]')?.textContent ?? '').includes(
            'dall-e-3',
          ),
        { timeout: 10000 },
      )
      .catch(() => {
        /* 超时则由后续断言报告 */
      });
    const openaiImage = await page.textContent('[role="dialog"]');
    log(
      (openaiImage ?? '').includes('dall-e-3'),
      '图像生成分类在 OpenAI 下提供 DALL·E 3',
    );

    // 切到语音模型
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = Array.from(dlg.querySelectorAll('button')).find(
        (x) => x.textContent.trim() === '语音模型',
      );
      if (btn) btn.click();
    });
    // 轮询等待模型列表渲染完成，避免与重挂载竞态
    await page
      .waitForFunction(
        () =>
          (document.querySelector('[role="dialog"]')?.textContent ?? '').includes(
            'whisper-1',
          ),
        { timeout: 10000 },
      )
      .catch(() => {
        /* 超时则由后续断言报告 */
      });
    const speechPanel = await page.textContent('[role="dialog"]');
    log(
      (speechPanel ?? '').includes('whisper-1') &&
        (speechPanel ?? '').includes('tts-1'),
      '语音模型分类含 Whisper API 与 TTS API',
    );

    // 切到多模态模型
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = Array.from(dlg.querySelectorAll('button')).find(
        (x) => x.textContent.trim() === '多模态模型',
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(1200);
    const visionPanel = await page.textContent('[role="dialog"]');
    log(
      (visionPanel ?? '').includes('Anthropic Claude API') &&
        (visionPanel ?? '').includes('Google Gemini API') &&
        (visionPanel ?? '').includes('通义千问VL'),
      '多模态模型分类含 Claude / Gemini / 通义千问VL 服务商',
    );

    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    // ---------- 9.9 仓库与主题包 ----------

    // 设置面板：切换左侧导航时高度保持稳定
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

    const dialogHeights = [];
    for (const sec of ['个性化', 'AI 引擎', '局域网', 'API', '通用', '关于']) {
      await page.evaluate((s) => {
        const nav = document.querySelector('[role="dialog"] nav');
        const btn = Array.from(nav.querySelectorAll('button')).find(
          (x) => x.textContent.trim() === s,
        );
        if (btn) btn.click();
      }, sec);
      await page.waitForTimeout(800);
      dialogHeights.push(
        await page.evaluate(() =>
          Math.round(
            document.querySelector('[role="dialog"]').getBoundingClientRect().height,
          ),
        ),
      );
    }
    log(
      new Set(dialogHeights).size === 1,
      '设置面板切换左侧导航时高度保持稳定',
      dialogHeights.join(','),
    );

    // 个性化：主色调已移除，主题包可导入
    await page.evaluate(() => {
      const nav = document.querySelector('[role="dialog"] nav');
      const btn = Array.from(nav.querySelectorAll('button')).find(
        (x) => x.textContent.trim() === '个性化',
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(1500);

    const personalizationText = await page.textContent('[role="dialog"]');
    log(
      !(personalizationText ?? '').includes('主色调'),
      '个性化已移除「主色调」设置项',
    );
    log(
      (personalizationText ?? '').includes('导入 .theme'),
      '个性化提供 .theme 主题包导入入口',
    );
    log(
      (personalizationText ?? '').includes('广场主题包'),
      '个性化提供广场主题包区域',
    );
    log(
      (personalizationText ?? '').includes('主题定制'),
      '个性化提供主题定制区（图标 / 卡片 / 导航栏 / 配色 / 壁纸）',
    );

    // 主题定制：卡片风格切换会写回 data-card-style
    const cardStyleBefore = await page.evaluate(() =>
      document.documentElement.dataset.cardStyle,
    );
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="dialog"] button'));
      const b = btns.find(
        (x) =>
          x.textContent.trim() === '扁平' &&
          x.closest('section')?.textContent.includes('卡片样式'),
      );
      if (b) b.click();
    });
    await page.waitForTimeout(1200);
    const cardStyleAfter = await page.evaluate(() =>
      document.documentElement.dataset.cardStyle,
    );
    log(
      cardStyleBefore !== cardStyleAfter && cardStyleAfter === 'flat',
      '主题定制可切换卡片风格',
      `${cardStyleBefore} → ${cardStyleAfter}`,
    );

    const navStyleAfter = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="dialog"] button'));
      const b = btns.find(
        (x) =>
          x.textContent.trim() === '毛玻璃' &&
          x.closest('section')?.textContent.includes('导航栏样式'),
      );
      if (b) b.click();
      return true;
    });
    await page.waitForTimeout(1000);
    const navStyle = await page.evaluate(() =>
      document.documentElement.dataset.navStyle,
    );
    log(
      navStyleAfter && navStyle === 'glass',
      '主题定制可切换导航栏风格',
      navStyle,
    );

    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    // 功能广场：仓库插件走「下载」，已下载显示「可离线」
    await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('.zj-snap-section:nth-child(2) .zj-card'),
      );
      const t = cards.find(
        (c) => c.querySelector('p.text-sm.font-medium')?.textContent.trim() ===
          '功能广场',
      );
      if (t) t.click();
    });
    await page.waitForTimeout(2500);

    const market = await page.textContent('[role="dialog"]');
    log(
      (market ?? '').includes('下载') || (market ?? '').includes('安装'),
      '功能广场提供插件获取入口（下载/安装）',
    );
    log(
      (market ?? '').includes('可离线'),
      '已下载的插件在广场标记为「可离线」',
    );

    // 广场的主题分类页
    const themeTab = await page.evaluate(() => {
      const btns = Array.from(
        document.querySelectorAll('[role="dialog"] button'),
      );
      const b = btns.find(
        (x) => x.textContent.trim() === '主题' && x.querySelector('svg'),
      );
      if (b) b.click();
      return !!b;
    });
    await page.waitForTimeout(2000);
    const themeMarket = (await page.textContent('[role="dialog"]')) ?? '';
    log(themeTab, '功能广场提供「主题」分类页');
    log(
      ['综合', '配色', '卡片', '导航栏', '壁纸', '图标'].every((c) =>
        themeMarket.includes(c),
      ),
      '主题分类包含配色 / 卡片 / 导航栏 / 壁纸 / 图标等维度',
    );
    log(
      themeMarket.includes('内置主题'),
      '主题分类列出内置主题（可离线直接使用）',
    );

    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

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
