/*
 * 界面接线检查：app.js 里引用的每个元素 id 都必须真的存在
 * （静态写在 index.html 里，或者在 app.js 动态生成的模板里）。
 * 这类拼写错误在浏览器里只会表现为「点了没反应」，所以用测试兜住。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
const stylesheet = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]*styles-v2\.css)"/);
const css = stylesheet ? fs.readFileSync(path.join(ROOT, stylesheet[1]), 'utf8') : '';

function matchAll(text, regex, group) {
  const result = [];
  let match;
  while ((match = regex.exec(text)) !== null) result.push(match[group || 1]);
  return result;
}

test('index.html 引用的静态资源都存在', () => {
  const sources = matchAll(html, /(?:src|href)="([^"]+)"/g)
    .filter(source => !source.startsWith('#'));
  assert.ok(sources.length >= 3, '至少引用 css 和两个 js');
  sources.forEach(relative => {
    assert.ok(fs.existsSync(path.join(ROOT, relative)), '缺少文件：' + relative);
  });
});

test('app.js 引用的元素 id 都存在', () => {
  const staticIds = new Set(matchAll(html, /id="([^"]+)"/g));
  const dynamicIds = new Set(matchAll(app, /id="([^"]+)"/g));
  const referenced = new Set(matchAll(app, /\$\('([^']+)'\)/g));

  const missing = [...referenced].filter(id => !staticIds.has(id) && !dynamicIds.has(id));
  assert.deepEqual(missing, [], '以下 id 在页面里找不到：' + missing.join(', '));
});

test('关键结构存在：底栏按钮、弹层、列表容器', () => {
  ['fab', 'sheet', 'backdrop', 'listArea', 'heroValue', 'statTiles', 'progressFill', 'tab-budget', 'tab-ledger', 'tab-advance', 'toast', 'storageBanner']
    .forEach(id => assert.ok(html.includes('id="' + id + '"'), 'index.html 缺少 #' + id));
});

test('样式里定义了基础布局类', () => {
  ['hero', 'tile', 'row', 'chip', 'sheet', 'fab', 'toast', 'tab']
    .forEach(className => assert.ok(css.includes('.' + className), '当前样式表缺少 .' + className));
});

test('app.js 只通过全局 BudgetCore 使用核心逻辑', () => {
  assert.ok(app.includes('window.BudgetCore'), 'app.js 应从 window.BudgetCore 取核心逻辑');
  assert.ok(!/require\(/.test(app), 'app.js 不应该依赖 CommonJS');
});

test('余额明细默认收起', () => {
  assert.ok(app.includes('let breakdownExpanded = false;'), '余额明细初始状态应该是收起');
  assert.ok(app.includes('class="breakdown-summary"'), '收起时应显示余额摘要');
});

test('Liquid Glass 有渐进增强和辅助功能降级', () => {
  assert.ok(css.includes('@supports ((-webkit-backdrop-filter:'), '应仅在支持背景模糊时启用玻璃材质');
  assert.ok(css.includes('prefers-reduced-transparency: reduce'), '应尊重减少透明度设置');
  assert.ok(css.includes('prefers-reduced-motion: reduce'), '应尊重减少动态效果设置');
});

// 之前有个真 bug：「删除这笔付款」按钮只写了 data-delete-payment，
// 但弹层事件只分发 [data-action]，于是点了没反应。这条检查拦的就是这类错误。
test('每个 data-* 属性都必须被代码读取（否则就是点了没反应）', () => {
  const attributes = new Set(matchAll(app, /(data-[a-z-]+)="/g));
  const unread = [...attributes].filter(name => {
    const readers = [
      'getAttribute(\'' + name + '\')',
      'hasAttribute(\'' + name + '\')',
      'closest(\'[' + name,
      'querySelector(\'[' + name,
      'querySelectorAll(\'[' + name,
      '[' + name + '=',
      '[' + name + ']'
    ];
    return !readers.some(reader => app.includes(reader));
  });
  assert.deepEqual(unread, [], '这些属性只写进了 HTML，但没有代码读取它：' + unread.join(', '));
});
