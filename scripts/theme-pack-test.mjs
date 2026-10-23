/**
 * 主题包 / 插件包校验器单元测试
 *
 * 目标是 `server/src/routes/registry-validate.js` —— 上传接口与种子写入
 * **共用同一套**校验规则，所以这里的用例等价于「用户能上传什么」的边界。
 *
 * 为什么单独为它写测试：这是仓库里唯一处理**外部不可信输入**的纯函数模块。
 * 之前只靠契约测试「上传一个坏包被拒」这一条，具体规则（对比度、id 长度、
 * protocol 1 禁用字段）全凭实现者自觉，改坏没人知道。
 *
 * 用法：node scripts/theme-pack-test.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ID_PATTERN,
  COLOR_PATTERN,
  THEME_CATEGORIES,
  normalizeThemeCategory,
  normalizeTags,
  joinTags,
  splitTags,
  validateThemeBrand,
  validateThemeCard,
  validateThemeNav,
  validatePluginPackage,
  validateThemePack,
} = require('../server/src/routes/registry-validate.js');

let pass = 0;
let fail = 0;
function check(ok, name, extra = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  →  ' + extra : ''}`);
}

/** 取错误提示（期望校验失败时用） */
const err = (r) => (r.ok ? '(ok)' : r.error);

// ========== 1. 基础模式 ==========
check(ID_PATTERN.test('abyss-glass') && ID_PATTERN.test('a1'), 'id 允许小写字母、数字、连字符');
check(
  !ID_PATTERN.test('Abyss') && !ID_PATTERN.test('-lead') && !ID_PATTERN.test('a_b'),
  'id 拒绝大写、下划线、以及连字符开头',
);
check(
  COLOR_PATTERN.test('#aabbcc') && COLOR_PATTERN.test('#AABBCCDD') && !COLOR_PATTERN.test('#abc'),
  '颜色只接受 #rrggbb / #rrggbbaa，拒绝三位缩写',
);

// ========== 2. 分类与标签归一化 ==========
check(normalizeThemeCategory('配色') === '配色', '合法分类原样返回');
check(normalizeThemeCategory('不存在的分类') === '综合', '未知分类回落到「综合」');
check(normalizeThemeCategory(undefined) === '综合', '缺省分类回落到「综合」');
check(THEME_CATEGORIES.includes(normalizeThemeCategory('壁纸')), '「壁纸」在合法分类内');
check(
  JSON.stringify(normalizeTags(' 暗色 , 极简 ,, 夜景 ')) === JSON.stringify(['暗色', '极简', '夜景']),
  '标签字符串按逗号切分并去掉空白项',
);
check(
  JSON.stringify(normalizeTags([' a ', 2, '', null])) === JSON.stringify(['a', '2', 'null']),
  '标签数组统一转字符串（与数据库读取行为一致）',
);
check(normalizeTags(undefined).length === 0, '非数组非字符串的标签返回空数组');
check(joinTags(['a', 'b']) === 'a,b' && splitTags('a,b').length === 2, 'joinTags / splitTags 往返一致');

// ========== 3. protocol 主题（文件夹制，走 validateProtocolTheme） ==========
const validProtocol = {
  id: 'demo-dark',
  name: '演示暗色',
  version: '1.0.0',
  colors: {
    '--bg': '#0b0f14',
    '--fg': '#f2f5f7',
    '--accent': '#4fc3f7',
    '--card': '#121820',
    '--border': '#22303c',
  },
};

check(validateThemePack(validProtocol).ok === true, '合法 protocol 主题通过', err(validateThemePack(validProtocol)));
check(validateThemePack(validProtocol).data.protocol === 1, 'protocol 缺省视为 1');
check(
  validateThemePack({ ...validProtocol, protocol: 2 }).data.protocol === 2,
  'protocol:2 通过并回显',
);
check(
  validateThemePack(validProtocol).data.tags.length === 0 &&
    validateThemePack(validProtocol).data.category === '综合',
  '缺省 tags / category 被归一化为空数组与「综合」',
);

// 非法输入
check(validateThemePack(null).ok === false, 'null 被拒');
check(validateThemePack([]).ok === false, '数组被拒（不是对象）');
check(validateThemePack('theme').ok === false, '字符串被拒');
check(err(validateThemePack({ ...validProtocol, id: 'Bad_ID' })).includes('id 不合法'), '大写下划线 id 被拒');
check(
  err(validateThemePack({ ...validProtocol, id: 'a'.repeat(33) })).includes('过长'),
  'id 超过 32 字符被拒',
);
check(err(validateThemePack({ ...validProtocol, name: '   ' })).includes('不能为空'), '空白 name 被拒');
check(err(validateThemePack({ ...validProtocol, version: 'v1' })).includes('version'), '非语义化版本被拒');
check(err(validateThemePack({ ...validProtocol, protocol: 3 })).includes('protocol'), 'protocol:3 被拒');

// 五个必需颜色逐个缺失
for (const key of ['--bg', '--fg', '--accent', '--card', '--border']) {
  const colors = { ...validProtocol.colors };
  delete colors[key];
  check(
    err(validateThemePack({ ...validProtocol, colors })).includes(`colors.${key}`),
    `缺少 ${key} 被拒`,
  );
}
check(
  err(validateThemePack({ ...validProtocol, colors: { ...validProtocol.colors, '--bg': '#abc' } })).includes(
    'colors.--bg',
  ),
  '三位缩写色值被拒（颜色规则要精确）',
);

// 对比度：白底浅灰字必须被拦
const lowContrast = {
  ...validProtocol,
  colors: { ...validProtocol.colors, '--bg': '#ffffff', '--fg': '#eeeeee' },
};
check(err(validateThemePack(lowContrast)).includes('对比度不足'), '对比度低于 4.5:1 被拒');

// 壁纸必须是路径字符串
check(
  err(validateThemePack({ ...validProtocol, wallpaper: { url: 'x' } })).includes('相对路径字符串'),
  'wallpaper 非字符串被拒',
);
check(validateThemePack({ ...validProtocol, wallpaper: 'assets/wallpaper.webp' }).ok === true, '合法 wallpaper 通过');

// protocol 1 不允许 v2 专属字段
for (const key of ['video', 'bgm', 'texts']) {
  check(
    err(validateThemePack({ ...validProtocol, [key]: 'x' })).includes('protocol 为 1'),
    `protocol:1 携带 ${key} 被拒`,
  );
}
check(
  validateThemePack({ ...validProtocol, protocol: 2, bgm: 'assets/bgm.mp3' }).ok === true,
  'protocol:2 允许 bgm',
);

// ========== 4. 旧版主题包（light / dark 双变体） ==========
const variant = {
  accent: '#4fc3f7',
  accentSoft: '#1a3a4a',
  card: '#121820',
  bg: '#0b0f14',
  fg: '#f2f5f7',
  mutedFg: '#8fa3b3',
  border: '#22303c',
  shadow: 2,
};
const legacy = { id: 'legacy-pack', name: '旧版包', light: variant, dark: variant };

check(validateThemePack(legacy).ok === true, '合法旧版主题包通过', err(validateThemePack(legacy)));
check(
  validateThemePack(legacy).data.version === '1.0.0' && validateThemePack(legacy).data.preview === '🎨',
  '旧版包缺省 version / preview 有默认值',
);
check(err(validateThemePack({ ...legacy, light: undefined })).includes('缺少 light'), '缺 light 变体被拒');
check(err(validateThemePack({ ...legacy, dark: undefined })).includes('缺少 dark'), '缺 dark 变体被拒');
check(
  err(validateThemePack({ ...legacy, light: { ...variant, accent: 'red' } })).includes('light.accent'),
  '变体颜色非法时指出具体字段',
);
check(
  err(validateThemePack({ ...legacy, light: { ...variant, shadow: 9 } })).includes('shadow'),
  'shadow 超出 0-3 被拒',
);
check(
  err(validateThemePack({ ...legacy, light: { ...variant, radius: 100 } })).includes('radius'),
  'radius 超出 0-48 被拒',
);
check(
  err(validateThemePack({ ...legacy, wallpaper: [] })).includes('wallpaper'),
  '旧版包 wallpaper 非对象被拒',
);

// ========== 5. brand / card / nav 子校验 ==========
check(validateThemeBrand(undefined) === null, 'brand 缺省视为合法');
check(validateThemeBrand({ name: '智简匣', tagline: '本地优先' }) === null, '合法 brand 通过');
check(typeof validateThemeBrand({ name: 123 }) === 'string', 'brand.name 非字符串被拒');
// 只校验 icon / name / tagline 三个字段，其余字段（含旧版遗留的 title）不参与校验
check(validateThemeBrand({ title: 123 }) === null, 'brand 不校验未声明字段（保持向后兼容）');
check(validateThemeCard(undefined) === null, 'card 缺省视为合法');
check(validateThemeCard({ style: 'glass' }) === null, '合法 card.style 通过');
check(typeof validateThemeCard({ style: 'neon' }) === 'string', '未知 card.style 被拒');
check(validateThemeNav(undefined) === null, 'nav 缺省视为合法');
check(validateThemeNav({ style: 'minimal', height: 56, showIcon: true }) === null, '合法 nav 通过');
check(typeof validateThemeNav({ height: 999 }) === 'string', 'nav.height 超出 0-200 被拒');
check(typeof validateThemeNav({ showIcon: 'yes' }) === 'string', 'nav.showIcon 非布尔被拒');

// ========== 6. 插件包 ==========
const validPlugin = {
  format: 'zhijianxia.plugin',
  manifest: { id: 'my-plugin', name: '我的插件', version: '1.0.0', category: '工具' },
  core: { minVersion: '1.0.0' },
};
check(validatePluginPackage(validPlugin).ok === true, '合法插件包通过', err(validatePluginPackage(validPlugin)));
check(validatePluginPackage(null).ok === false, 'null 插件包被拒');
check(
  err(validatePluginPackage({ ...validPlugin, format: 'other' })).includes('format'),
  '未知 format 被拒',
);
check(
  err(validatePluginPackage({ format: 'zhijianxia.plugin' })).includes('manifest'),
  '缺 manifest 被拒',
);
check(
  err(validatePluginPackage({ ...validPlugin, manifest: { id: 'Bad', name: 'x' } })).includes('id 不合法'),
  '插件 id 非法被拒',
);
check(
  err(validatePluginPackage({ ...validPlugin, manifest: { id: 'ok-id', name: ' ' } })).includes('不能为空'),
  '插件 name 空白被拒',
);
check(
  err(validatePluginPackage({ ...validPlugin, manifest: { ...validPlugin.manifest, version: 'x' } })).includes(
    'version',
  ),
  '插件 version 非语义化被拒',
);
check(
  err(validatePluginPackage({ ...validPlugin, manifest: { ...validPlugin.manifest, category: '' } })).includes(
    'category',
  ),
  '插件 category 为空被拒',
);
check(
  err(validatePluginPackage({ ...validPlugin, core: undefined })).includes('core.minVersion'),
  '缺 core.minVersion 被拒（内核兼容性是硬要求）',
);
check(
  validatePluginPackage({ ...validPlugin, manifest: { ...validPlugin.manifest, tags: 'a, b' } }).data.tags.length === 2,
  '插件 tags 字符串被归一化为数组',
);

console.log('\n════════════════════════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('════════════════════════════════════════');
process.exit(fail === 0 ? 0 : 1);
