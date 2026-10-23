/**
 * 界面文案词典
 *
 * 设计取舍：
 *   - **以中文为基准定义 key 类型**（`zh` 是唯一事实来源），`en` 必须实现同一组 key，
 *     漏翻译会在 `tsc` 阶段直接报错，而不是运行时显示 undefined。
 *   - 文案带参数时用 `{name}` 占位，而不是拼字符串 —— 英文语序与中文不同，
 *     拼接写法在翻译时必然要改代码。
 *   - 只收「界面文案」。错误提示、日志、注释不入词典：前两者来自后端与运行时，
 *     后者不面向用户。
 */

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** 中文词典 —— key 的唯一定义处 */
export const zh = {
  // 状态栏
  greeting: '您好！',
  guest: '访客',
  viewProfile: '点击查看个人资料',
  loginToUnlock: '点击登录解锁完整功能',
  profile: '个人资料',
  login: '登录',
  viewEditProfile: '查看与修改资料',
  unlockHint: '解锁好友与群聊',
  launchPlugin: '启动插件',
  installPlugin: '去安装插件',
  moreInPlaza: '功能广场里有更多',
  aiChat: 'AI 对话',
  backendOnline: '后端在线，点击重新检测',
  backendOffline: '后端未开启，点击重新检测',
  backendStatus: '后端状态',
  expandPlugins: '展开插件列表',
  installedCount: '已安装 {count} 个插件 · 选择后点右下角启动',
  noPlugins: '还没有安装插件',
  goInstallMore: '去功能广场安装更多 →',

  // 设置 · 通用
  language: '界面语言',
  languageDesc: '切换后立即生效；目前导航栏与设置项已完成迁移，其余界面仍在逐步替换',
  languageZh: '简体中文',
  languageEn: 'English',
} as const;

export type MessageKey = keyof typeof zh;

/** 英文词典：必须覆盖全部 key（少一个就类型报错） */
export const en: Record<MessageKey, string> = {
  greeting: 'Hello!',
  guest: 'Guest',
  viewProfile: 'View your profile',
  loginToUnlock: 'Sign in to unlock everything',
  profile: 'Profile',
  login: 'Sign in',
  viewEditProfile: 'View and edit profile',
  unlockHint: 'Unlock friends and group chats',
  launchPlugin: 'Launch plugin',
  installPlugin: 'Install a plugin',
  moreInPlaza: 'More in the marketplace',
  aiChat: 'AI chat',
  backendOnline: 'Backend online — click to re-check',
  backendOffline: 'Backend offline — click to re-check',
  backendStatus: 'Backend status',
  expandPlugins: 'Show plugin list',
  installedCount: '{count} plugins installed · pick one, then launch it from the bottom right',
  noPlugins: 'No plugins installed yet',
  goInstallMore: 'Browse the marketplace →',

  language: 'Language',
  languageDesc:
    'Takes effect immediately. The navigation bar and settings are migrated; the rest is being translated.',
  languageZh: '简体中文',
  languageEn: 'English',
};

export const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { zh, en };
