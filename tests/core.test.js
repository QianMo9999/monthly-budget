/*
 * 核心逻辑测试：node --test tests/
 * 覆盖金额精度、账期计算、结余口径、增删改、结转、导入导出。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');

const { Money, Month, createStore, summarize, SampleData } = core;

function day(year, month, date) {
  return new Date(year, month - 1, date, 12, 0, 0).toISOString();
}

const MARCH = { year: 2026, month: 3 };
const APRIL = { year: 2026, month: 4 };

// ---------------------------------------------------------------- 金额

test('金额：四舍五入到分，避免浮点误差', () => {
  assert.equal(Money.round(0.1 + 0.2), 0.3);
  assert.equal(Money.round(10.005), 10.01);
  assert.equal(Money.round(2.675), 2.68);
  assert.equal(Money.sum([0.1, 0.2]), 0.3);
  assert.equal(Money.sum([18.5, 31.5, 40]), 90);
  assert.equal(Money.sum([]), 0);
  assert.equal(Money.round(-12.345), -12.35);
});

test('金额：解析用户输入', () => {
  assert.equal(Money.parse('1200.5'), 1200.5);
  assert.equal(Money.parse('1,200.5'), 1200.5);
  assert.equal(Money.parse('¥8000'), 8000);
  assert.equal(Money.parse('  '), null);
  assert.equal(Money.parse('abc'), null);
  assert.equal(Money.parse('12.3.4'), null);
  assert.equal(Money.parse('0'), 0);
});

test('金额：格式化', () => {
  assert.equal(Money.format(1234.5), '¥1,234.50');
  assert.equal(Money.format(0), '¥0.00');
  assert.equal(Money.format(-200), '¥-200.00');
  assert.equal(Money.csv(18.5), '18.50');
  assert.equal(Money.csv(2500), '2500.00');
  assert.equal(Money.plain(2500), '2500');
  assert.equal(Money.plain(18.5), '18.5');
});

test('金额：比例计算不会除零炸掉', () => {
  assert.equal(Money.ratio(50, 0), 0);
  assert.equal(Money.ratio(50, 100), 0.5);
});

// ---------------------------------------------------------------- 账期

test('账期：前后一个月，跨年正确', () => {
  assert.deepEqual(Month.next(MARCH), APRIL);
  assert.deepEqual(Month.next({ year: 2026, month: 12 }), { year: 2027, month: 1 });
  assert.deepEqual(Month.prev({ year: 2026, month: 1 }), { year: 2025, month: 12 });
  assert.deepEqual(Month.make(2026, 13), { year: 2027, month: 1 });
  assert.deepEqual(Month.make(2026, 0), { year: 2025, month: 12 });
});

test('账期：键值、标签、天数、归属判断', () => {
  assert.equal(Month.key(MARCH), '2026-03');
  assert.equal(Month.label(MARCH), '2026年3月');
  assert.deepEqual(Month.fromKey('2026-03'), MARCH);
  assert.equal(Month.dayCount(MARCH), 31);
  assert.equal(Month.dayCount({ year: 2026, month: 2 }), 28);
  assert.equal(Month.dayCount({ year: 2028, month: 2 }), 29);
  assert.ok(Month.contains(MARCH, day(2026, 3, 15)));
  assert.ok(!Month.contains(MARCH, day(2026, 4, 1)));
  assert.deepEqual(Month.fromDate(day(2026, 3, 31)), MARCH);
});

test('账期：当月时间进度', () => {
  const ratio = Month.elapsedRatio(MARCH, new Date(2026, 2, 16, 12));
  assert.ok(Math.abs(ratio - 16 / 31) < 1e-9);
  assert.equal(Month.elapsedRatio(MARCH, new Date(2026, 3, 5, 12)), 1);
  assert.equal(Month.elapsedRatio(MARCH, new Date(2026, 1, 5, 12)), 0);
});

// ---------------------------------------------------------------- 结余计算

test('结余：月收入 8000 的典型场景', () => {
  const items = [
    { id: 'a', name: '房租', category: 'housing', plannedAmount: 2500, actualAmount: 2500, status: 'completed', sortIndex: 0 },
    { id: 'b', name: '餐饮', category: 'food', plannedAmount: 1500, actualAmount: null, status: 'planned', sortIndex: 1 },
    { id: 'c', name: '健身', category: 'entertainment', plannedAmount: 200, actualAmount: 260, status: 'completed', sortIndex: 2 },
    { id: 'd', name: '水电', category: 'utilities', plannedAmount: 300, actualAmount: 250, status: 'completed', sortIndex: 3 }
  ];
  const entries = [
    { id: 'e1', title: '奶茶', category: 'food', amount: 20, date: day(2026, 3, 3) },
    { id: 'e2', title: '打车', category: 'transport', amount: 30, date: day(2026, 3, 4) }
  ];
  const advances = [{ id: 'v1', title: '垫付聚餐', amount: 600, repaidAmount: 0, date: day(2026, 3, 5) }];

  const month = {
    id: 'm', year: 2026, month: 3, income: 8000,
    items: items, ledgerEntries: entries, advances: advances
  };
  const s = summarize(month, 500);

  assert.equal(s.plannedTotal, 4500);
  assert.equal(s.paidTotal, 3010);
  assert.equal(s.remainingBudget, 1500);
  assert.equal(s.overrunTotal, 60);
  assert.equal(s.savedTotal, 50);
  assert.equal(s.ledgerTotal, 50);
  assert.equal(s.advanceTotal, 600);
  assert.equal(s.advanceOutstandingTotal, 600);
  assert.equal(s.totalAvailable, 8500);
  assert.equal(s.actualBalance, 4840);
  assert.equal(s.committedBudget, 4510, "已经花掉的 3010 + 还要花的 1500；水电省下的 50 直接回结余");
  assert.equal(s.plannedBalance, 3340, "收入+结转 8500 − 预算承诺 4510 − 零星 50 − 预支 600");
  assert.equal(s.unspentBudget, 1500, "只有还没花的预算（餐饮 1500）");
  assert.equal(s.unspentBudget, s.remainingBudget, "未花预算 = 还没花掉的预算占用");
  assert.equal(s.plannedBalance + s.unspentBudget, s.actualBalance, "结余 + 未花预算 = 实际剩余");
  assert.equal(s.budgetBalance, 1490);
  assert.equal(s.totalSpending, 3660);
  assert.equal(s.completedItemCount, 3);
  assert.equal(s.itemCount, 4);
  assert.equal(s.budgetByCategory.food, 1500);
  assert.equal(s.ledgerByCategory.food, 20);
  assert.ok(Math.abs(s.budgetProgress - 3010 / 4500) < 1e-9);
  assert.ok(!s.isOverBudget);
  assert.ok(!s.isBalanceNegative);
});

test('结余：完成但没填实际金额时按计划金额扣减', () => {
  const month = {
    id: 'm', year: 2026, month: 3, income: 1000, carryOverOverride: null,
    items: [{ id: 'a', name: '话费', category: 'communication', plannedAmount: 120, actualAmount: null, status: 'completed', sortIndex: 0 }],
    ledgerEntries: [], advances: []
  };
  const s = summarize(month, 0);
  assert.equal(s.paidTotal, 120);
  assert.equal(s.actualBalance, 880);
  assert.equal(s.remainingBudget, 0);
  assert.equal(s.plannedBalance, 880);
});

test('结余：超支、空账期、全完成', () => {
  const over = summarize({
    id: 'm', year: 2026, month: 3, income: 200, carryOverOverride: null,
    items: [{ id: 'a', name: 'A', category: 'other', plannedAmount: 100, actualAmount: 150, status: 'completed', sortIndex: 0 }],
    ledgerEntries: [], advances: []
  }, 0);
  assert.equal(over.actualBalance, 50);
  assert.equal(over.plannedBalance, 50, "超支时按实际 150 扣");
  assert.equal(over.overrunTotal, 50);
  assert.ok(over.isOverBudget);
  assert.equal(over.budgetProgress, 1.5);

  const empty = summarize(null, 0);
  assert.equal(empty.actualBalance, 0);
  assert.equal(empty.budgetProgress, 0);
  assert.ok(empty.isEmpty);
});

test('结余：预支归还后不再占用结余', () => {
  const month = {
    id: 'm', year: 2026, month: 3, income: 5000, carryOverOverride: null,
    items: [], ledgerEntries: [],
    advances: [{ id: 'v', title: '垫付', amount: 600, repaidAmount: 200, date: day(2026, 3, 1) }]
  };
  const s = summarize(month, 0);
  assert.equal(s.advanceTotal, 600);
  assert.equal(s.advanceRepaidTotal, 200);
  assert.equal(s.advanceOutstandingTotal, 400);
  assert.equal(s.actualBalance, 4600);
});

// ---------------------------------------------------------------- Store

test('Store：新增 / 结算 / 撤销结算 / 删除预算项目', () => {
  const store = createStore();
  store.ensureMonth(MARCH);
  assert.equal(store.month(MARCH).income, 8000, '新账期默认取设置里的月收入');

  store.setIncome(8000, MARCH);
  const rent = store.addItem({ name: '房租', category: 'housing', plannedAmount: 2500 }, MARCH);
  store.addItem({ name: '餐饮', category: 'food', plannedAmount: 1500 }, MARCH);
  assert.deepEqual(store.items(MARCH).map(i => i.name), ['房租', '餐饮']);

  store.completeItem(rent.id, 2500, MARCH);
  assert.equal(store.summary(MARCH).paidTotal, 2500);
  assert.equal(store.summary(MARCH).actualBalance, 5500);
  assert.equal(store.summary(MARCH).plannedBalance, 4000, "扣掉房租 2500 + 餐饮 1500");

  store.reopenItem(rent.id, MARCH);
  assert.equal(store.summary(MARCH).paidTotal, 0);
  assert.equal(store.summary(MARCH).plannedBalance, 4000, "扣掉房租 2500 + 餐饮 1500");

  store.completeItem(rent.id, 2400, MARCH);
  assert.equal(store.summary(MARCH).savedTotal, 100);
  assert.equal(store.summary(MARCH).actualBalance, 5600);

  store.updateItem(rent.id, { plannedAmount: 2600, note: '含物业费' }, MARCH);
  assert.equal(store.item(rent.id, MARCH).plannedAmount, 2600);
  assert.equal(store.summary(MARCH).overrunTotal, 0);

  store.deleteItem(rent.id, MARCH);
  assert.deepEqual(store.items(MARCH).map(i => i.name), ['餐饮']);
});

test('Store：零星记账的增删改与按天分组', () => {
  const store = createStore();
  const tea = store.addEntry({ title: '奶茶', amount: 18.5, category: 'food', date: day(2026, 3, 3) }, MARCH);
  store.addEntry({ title: '打车', amount: 31.5, category: 'transport', date: day(2026, 3, 3) }, MARCH);
  store.addEntry({ title: '感冒药', amount: 40, category: 'medical', date: day(2026, 3, 4) }, MARCH);

  assert.equal(store.summary(MARCH).ledgerTotal, 90);
  const groups = store.ledgerGroups(MARCH);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].total, 40, '最新的一天在最前面');
  assert.equal(groups[1].entries.length, 2);

  store.updateEntry(tea.id, { amount: 20, note: '加珍珠' }, MARCH);
  assert.equal(store.summary(MARCH).ledgerTotal, 91.5);
  assert.equal(store.entry(tea.id, MARCH).note, '加珍珠');

  store.deleteEntry(tea.id, MARCH);
  assert.equal(store.summary(MARCH).ledgerTotal, 71.5);
  assert.equal(store.entries(MARCH).length, 2);
});

test('Store：上月结转、手动覆盖、关闭开关、复制预算', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const rent = store.addItem({ name: '房租', category: 'housing', plannedAmount: 2500 }, MARCH);
  store.completeItem(rent.id, 2400, MARCH);
  store.addEntry({ title: '奶茶', amount: 71.5, category: 'food', date: day(2026, 3, 3) }, MARCH);
  const marchBalance = store.summary(MARCH).actualBalance;
  assert.equal(marchBalance, 5528.5);

  assert.equal(store.carryOver({ year: 2026, month: 2 }), 0, '上个月没有数据时不结转');
  assert.equal(store.carryOver(APRIL), marchBalance, '只要有 3 月数据，4 月就能算出结转');
  assert.equal(store.summary(APRIL).carryOver, 0, '账期本身还没建立时汇总为空');

  store.ensureMonth(APRIL);
  assert.equal(store.carryOver(APRIL), marchBalance);
  assert.equal(store.summary(APRIL).carryOver, marchBalance);
  assert.equal(store.summary(APRIL).actualBalance, 8000 + marchBalance);

  store.setCarryOverOverride(1000, APRIL);
  assert.equal(store.carryOver(APRIL), 1000);
  store.setCarryOverOverride(null, APRIL);
  assert.equal(store.carryOver(APRIL), marchBalance);

  store.setCarryOverEnabled(false);
  assert.equal(store.carryOver(APRIL), 0);
  assert.equal(store.summary(APRIL).actualBalance, 8000);
  store.setCarryOverEnabled(true);
  assert.equal(store.carryOver(APRIL), marchBalance);

  assert.equal(store.carryOver({ year: 2026, month: 6 }), 0, '中间月份缺失时不跨月结转');
  assert.equal(store.carryOver({ year: 2026, month: 5 }), store.summary(APRIL).actualBalance);

  // 关掉自动结转后，手动填的金额仍然要生效（之前的 bug 是把两者一起忽略了）
  store.setCarryOverEnabled(false);
  assert.equal(store.carryOver(APRIL), 0, '关掉开关且没手填 → 0');
  store.setCarryOverOverride(1500, APRIL);
  assert.equal(store.carryOver(APRIL), 1500, '关掉开关但手动填了 → 按手动填的算');
  assert.equal(store.summary(APRIL).carryOver, 1500);
  assert.equal(store.summary(APRIL).actualBalance, 8000 + 1500);
  store.setCarryOverOverride(0, APRIL);
  assert.equal(store.carryOver(APRIL), 0, '手动填 0 就是 0');
  store.setCarryOverOverride(null, APRIL);
  store.setCarryOverEnabled(true);
  assert.equal(store.carryOver(APRIL), marchBalance, '恢复自动结转');

  assert.equal(store.copyItemsFrom(MARCH, APRIL), 1);
  assert.deepEqual(store.items(APRIL).map(i => i.name), ['房租']);
  assert.equal(store.items(APRIL)[0].status, 'planned', '复制过来的是计划中');
  assert.equal(store.items(APRIL)[0].actualAmount, null);
  assert.equal(store.copyItemsFrom(MARCH, APRIL), 0, '重复复制不会产生重复项');
  assert.equal(store.copyItemsFrom(APRIL, APRIL), 0, '不能自己复制自己');
});

test('Store：删除账期与清空数据', () => {
  const store = createStore();
  store.ensureMonth(MARCH);
  store.ensureMonth(APRIL);
  assert.equal(store.monthKeys().length, 2);
  assert.deepEqual(store.monthKeys()[0], APRIL, '月份倒序排列');

  store.deleteMonth(MARCH);
  assert.equal(store.month(MARCH), null);
  assert.equal(store.monthKeys().length, 1);

  store.setDefaultIncome(9000);
  store.reset();
  assert.equal(store.monthKeys().length, 0);
  assert.equal(store.settings.defaultMonthlyIncome, 9000, '清空数据保留设置');
});

// ---------------------------------------------------------------- 持久化

test('持久化：onChanged 回调 + JSON 往返', () => {
  let saved = null;
  const store = createStore(null, { onChanged: state => { saved = JSON.stringify(state); } });
  store.setIncome(8000, MARCH);
  const rent = store.addItem({ name: '房租', category: 'housing', plannedAmount: 2500 }, MARCH);
  store.completeItem(rent.id, 2480, MARCH);
  store.addEntry({ title: '奶茶', amount: 18.5, category: 'food', date: day(2026, 3, 3) }, MARCH);
  store.addAdvance({ title: '垫付', amount: 300, date: day(2026, 3, 6) }, MARCH);
  assert.ok(saved, '每次改动都会触发保存回调');

  const reloaded = createStore(JSON.parse(saved));
  const before = store.summary(MARCH);
  const after = reloaded.summary(MARCH);
  assert.equal(after.income, 8000);
  assert.equal(after.paidTotal, 2480);
  assert.equal(after.ledgerTotal, 18.5);
  assert.equal(after.advanceOutstandingTotal, 300);
  assert.equal(after.actualBalance, before.actualBalance);

  assert.ok(reloaded.loadJSON(JSON.parse(saved)), '可以重新导入 JSON');
  assert.ok(!reloaded.loadJSON('{"nope":1}'), '非法结构导入失败');
  assert.ok(!reloaded.loadJSON('这不是 JSON'), '非法文本导入失败');
  assert.equal(reloaded.summary(MARCH).actualBalance, before.actualBalance, '导入失败不破坏原有数据');
});

test('导出：CSV 结构与内容', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const rent = store.addItem({ name: '房租', category: 'housing', plannedAmount: 2500 }, MARCH);
  store.completeItem(rent.id, 2480, MARCH, day(2026, 3, 6));
  store.addEntry({ title: '奶茶', amount: 18.5, category: 'food', date: day(2026, 3, 3) }, MARCH);
  store.addAdvance({ title: '垫付', amount: 300, date: day(2026, 3, 6) }, MARCH);

  const csv = store.exportCSV();
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], '月份,类型,名称,分类,金额,实际支付,状态,日期,备注');
  assert.ok(csv.includes('2026年3月,预算,房租,居住,2500.00,2480.00,已完成,2026-03-06'));
  assert.ok(csv.includes('2026年3月,零星记账,奶茶,餐饮,18.50,,已花,2026-03-03'));
  assert.ok(csv.includes('2026年3月,预支,垫付,归属 2026年4月,300.00,0.00,已支付,2026-03-06'), csv);
  assert.equal(lines.length, 4);
});

test('导出：带逗号的备注会被正确转义', () => {
  const store = createStore();
  store.addEntry({ title: '聚餐', amount: 100, category: 'social', date: day(2026, 3, 3), note: '和 A, B 一起' }, MARCH);
  const csv = store.exportCSV();
  assert.ok(csv.includes('"和 A, B 一起"'), 'CSV 里的逗号要加引号');
});

// ---------------------------------------------------------------- 示例数据

test('示例数据：只写入一次', () => {
  const store = createStore();
  assert.equal(SampleData.seedIfNeeded(store, MARCH), true);
  assert.equal(SampleData.seedIfNeeded(store, MARCH), false);
});

test('示例数据：金额口径正确', () => {
  const store = createStore();
  const NOW = new Date(2026, 2, 16, 12);
  SampleData.seed(store, MARCH, NOW);

  const s = store.summary(MARCH, NOW);
  assert.equal(s.income, 8000);
  assert.equal(s.itemCount, 7);
  assert.equal(s.completedItemCount, 4);
  assert.equal(s.plannedTotal, 6590, '含生活费 70/天 × 31 天');
  assert.equal(s.paidTotal, 4396, '含生活费 1–16 号（当天也按计划先记），其中两天按实际结算');
  assert.equal(s.remainingBudget, 2170, '含生活费明天起的 15 天');
  assert.equal(s.ledgerTotal, 226);
  assert.equal(s.ledgerIncomeTotal, 120);
  assert.equal(s.advanceOutstandingTotal, 700, '示例里提前买了下个月的车票');
  assert.equal(s.actualBalance, 2798);
  assert.equal(s.committedBudget, 6566, '已完成项目按实际（水电省 32、交通省 60 直接回结余）');
  assert.equal(s.plannedBalance, 628);
  assert.equal(s.unspentBudget, 2170);
  assert.equal(s.unspentBudget, s.remainingBudget);
  assert.equal(s.plannedBalance + s.unspentBudget, s.actualBalance);
  assert.equal(s.recurringCount, 1);
  assert.equal(s.recurringDailyTotal, 70);
  assert.equal(s.recurringRemainingTotal, 1050);

  const living = store.items(MARCH).find(item => item.name === '生活费');
  const schedule = core.recurrenceSchedule(living, NOW);
  assert.equal(schedule.settledDays, 2);
  assert.equal(schedule.savedSoFar, 10, '第 2 天计划 70 实际 60');
  assert.equal(schedule.overrunSoFar, 20, '第 4 天计划 70 实际 90');
  assert.equal(schedule.spentSoFar, 1130);
  assert.equal(schedule.remainingAmount, 1050);

  // 下个月应该收到这笔预支的转入
  store.ensureMonth({ year: 2026, month: 4 });
  assert.equal(store.summary({ year: 2026, month: 4 }, NOW).advanceIncomingTotal, 700);
});

// ---------------------------------------------------------------- 分类

test('分类：未知分类回退到其他', () => {
  assert.equal(core.categoryLabel('housing'), '居住');
  assert.equal(core.categoryLabel('不存在'), '其他');
  assert.equal(core.categoryIcon('food'), '🍚');
});

test('分类：新增宠物分类', () => {
  assert.equal(core.categoryLabel('pet'), '宠物');
  assert.equal(core.categoryIcon('pet'), '🐾');
  assert.ok(core.Categories.some(c => c.id === 'pet'));
});

// ---------------------------------------------------------------- 重复预算

function recurringItem(overrides) {
  return Object.assign({
    id: 'r1',
    name: '生活费',
    category: 'family',
    plannedAmount: 0,
    actualAmount: null,
    status: 'planned',
    sortIndex: 0,
    recurrence: {
      type: 'daily',
      amounts: [50, 40, 40],
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    }
  }, overrides || {});
}

test('重复预算：整月按天算，支持每人不同金额', () => {
  const item = recurringItem();
  const schedule = core.recurrenceSchedule(item, new Date(2026, 2, 16, 12));
  assert.equal(schedule.peopleCount, 3);
  assert.equal(schedule.dailyTotal, 130, '50 + 40 + 40');
  assert.equal(schedule.totalDays, 31);
  assert.equal(schedule.spentDays, 16, '1–16 号算已发生（当天按计划先记）');
  assert.equal(schedule.remainingDays, 15, '明天起才是待预留');
  assert.equal(schedule.days.find(d => d.isToday).status, 'estimated', '当天也算已发生');
  assert.equal(schedule.plannedAmount, 4030);
  assert.equal(schedule.spentSoFar, 2080);
  assert.equal(schedule.remainingAmount, 1950, '后续还需要留的预算');
});

test('重复预算：未开始 / 已结束 / 单天 / 自定义区间', () => {
  const item = recurringItem();
  const before = core.recurrenceSchedule(item, new Date(2026, 1, 20, 12));
  assert.equal(before.spentDays, 0);
  assert.equal(before.remainingAmount, 4030, '还没到起始日，全额待预留');

  const after = core.recurrenceSchedule(item, new Date(2026, 3, 5, 12));
  assert.equal(after.spentDays, 31);
  assert.equal(after.remainingAmount, 0, '整段结束后不再预留');
  assert.equal(after.spentSoFar, 4030);

  const single = core.recurrenceSchedule(recurringItem({
    recurrence: { type: 'daily', amounts: [60], startDate: '2026-03-10', endDate: '2026-03-10' }
  }), new Date(2026, 2, 10, 9));
  assert.equal(single.totalDays, 1);
  assert.equal(single.spentDays, 1, '当天就按计划记入');
  assert.equal(single.spentSoFar, 60);
  assert.equal(single.remainingAmount, 0);

  const custom = core.recurrenceSchedule(recurringItem({
    recurrence: { type: 'daily', amounts: [100], startDate: '2026-03-10', endDate: '2026-03-20' }
  }), new Date(2026, 2, 16, 12));
  assert.equal(custom.totalDays, 11);
  assert.equal(custom.spentDays, 7, '10–16 号（含当天）');
  assert.equal(custom.remainingDays, 4);
  assert.equal(custom.plannedAmount, 1100);
  assert.equal(custom.remainingAmount, 400);
});

test('重复预算：普通项目不受影响', () => {
  const plain = { id: 'p', name: '房租', category: 'housing', plannedAmount: 2500, actualAmount: null, status: 'planned', sortIndex: 0 };
  assert.equal(core.isRecurring(plain), false);
  assert.equal(core.recurrenceSchedule(plain, new Date(2026, 2, 16)), null);
  assert.equal(core.itemPlannedAmount(plain, new Date(2026, 2, 16)), 2500);
  assert.equal(core.itemPaidAmount(plain, new Date(2026, 2, 16)), 0);
  assert.equal(core.itemOutstandingPlan(plain, new Date(2026, 2, 16)), 2500);
});

test("重复预算：计入结余，后续要留的钱体现在结余里", () => {
  const month = {
    id: 'm', year: 2026, month: 3, income: 8000, carryOverOverride: null,
    items: [recurringItem()],
    ledgerEntries: [], advances: []
  };
  const s = core.summarize(month, 0, new Date(2026, 2, 16, 12));
  assert.equal(s.plannedTotal, 4030);
  assert.equal(s.paidTotal, 2080, '今天及之前按计划算作已花');
  assert.equal(s.remainingBudget, 1950, '后续还需要留的预算');
  assert.equal(s.actualBalance, 5920, '当天也扣了，不会显得结余偏高');
  assert.equal(s.plannedBalance, 3970, "8000 − 预算总额 4030");
  assert.equal(s.recurringCount, 1);
  assert.equal(s.recurringDailyTotal, 130);
  assert.equal(s.recurringSpentTotal, 2080);
  assert.equal(s.recurringRemainingTotal, 1950);
});

test('重复预算：手动结算后按实际金额算', () => {
  const month = {
    id: 'm', year: 2026, month: 3, income: 8000, carryOverOverride: null,
    items: [recurringItem({ status: 'completed', actualAmount: 4000, settledAt: day(2026, 3, 20) })],
    ledgerEntries: [], advances: []
  };
  const s = core.summarize(month, 0, new Date(2026, 2, 25, 12));
  assert.equal(s.paidTotal, 4000);
  assert.equal(s.remainingBudget, 0);
  assert.equal(s.actualBalance, 4000);
  assert.equal(s.plannedBalance, 4000, "已完成就按实际花的 4000 扣，省下的 30 回结余");
});

test('Store：新增重复预算后可改人数与金额', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const item = store.addItem({
    name: '生活费',
    category: 'family',
    plannedAmount: 0,
    recurrence: { type: 'daily', amounts: [50, 40], startDate: '2026-03-01', endDate: '2026-03-31' }
  }, MARCH);
  assert.ok(core.isRecurring(store.item(item.id, MARCH)));
  assert.equal(store.summary(MARCH, new Date(2026, 2, 16, 12)).plannedTotal, 2790, '90 × 31 天');

  store.updateItem(item.id, {
    recurrence: { type: 'daily', amounts: [50, 40, 30], startDate: '2026-03-01', endDate: '2026-03-31' }
  }, MARCH);
  assert.equal(store.summary(MARCH, new Date(2026, 2, 16, 12)).recurringDailyTotal, 120);

  store.updateItem(item.id, { recurrence: null }, MARCH);
  assert.equal(core.isRecurring(store.item(item.id, MARCH)), false, '可以改回一次性预算');
});

// ---------------------------------------------------------------- 生活费每日结算

test('每日结算：某天少花，省下的钱立刻回到结余里', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const item = store.addItem({
    name: '生活费',
    category: 'family',
    plannedAmount: 0,
    recurrence: { type: 'daily', amounts: [50, 40, 40], startDate: '2026-03-01', endDate: '2026-03-31' }
  }, MARCH);
  const NOW = new Date(2026, 2, 16, 12);

  const before = store.summary(MARCH, NOW);
  assert.equal(before.plannedBalance, 3970, '8000 − 整月计划 4030');
  assert.equal(before.actualBalance, 5920, '8000 − 16 天（含当天）× 130');

  store.setRecurringDayActual(item.id, '2026-03-05', 80, MARCH);
  const after = store.summary(MARCH, NOW);
  assert.equal(after.recurringSpentTotal, 2030, '2080 − 少花的 50');
  assert.equal(after.recurringRemainingTotal, 1950, '后续还要预留的不变');
  assert.equal(after.actualBalance, 5970, '手里多了 50');
  assert.equal(after.plannedBalance, 4020, '这笔预算的承诺额少了 50');
  assert.equal(after.savedTotal, 50);
  assert.equal(after.unspentBudget, after.committedBudget - after.paidTotal);
});

test('每日结算：某天花超，超出的钱从结余里扣', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const item = store.addItem({
    name: '生活费',
    category: 'family',
    plannedAmount: 0,
    recurrence: { type: 'daily', amounts: [50, 40, 40], startDate: '2026-03-01', endDate: '2026-03-31' }
  }, MARCH);
  const NOW = new Date(2026, 2, 16, 12);

  store.setRecurringDayActual(item.id, '2026-03-06', 200, MARCH);
  const after = store.summary(MARCH, NOW);
  assert.equal(after.recurringSpentTotal, 2150, '2080 + 超支 70');
  assert.equal(after.recurringRemainingTotal, 1950);
  assert.equal(after.actualBalance, 5850);
  assert.equal(after.plannedBalance, 3900, '8000 − 承诺额 4100');
  assert.equal(after.overrunTotal, 70);
  assert.equal(core.itemCommittedAmount(store.item(item.id, MARCH), NOW), 4100);
});

test('每日结算：当天先按计划记入，填了实际金额就按实际算', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const item = store.addItem({
    name: '生活费',
    category: 'family',
    plannedAmount: 0,
    recurrence: { type: 'daily', amounts: [100], startDate: '2026-03-01', endDate: '2026-03-31' }
  }, MARCH);
  const NOW = new Date(2026, 2, 16, 20);
  const scheduleBefore = core.recurrenceSchedule(store.item(item.id, MARCH), NOW);
  assert.equal(scheduleBefore.remainingDays, 15, '待预留只算明天起');
  assert.equal(scheduleBefore.remainingAmount, 1500);
  assert.equal(scheduleBefore.spentSoFar, 1600, '当天先按计划记入');

  store.setRecurringDayActual(item.id, '2026-03-16', 60, MARCH);
  const scheduleAfter = core.recurrenceSchedule(store.item(item.id, MARCH), NOW);
  assert.equal(scheduleAfter.remainingDays, 15, '今天已经结算过了');
  assert.equal(scheduleAfter.remainingAmount, 1500);
  assert.equal(scheduleAfter.spentSoFar, 1560, '前几天 1500 + 今天 60');
  assert.equal(scheduleAfter.savedSoFar, 40);
});

test('每日结算：取消某天的记录会恢复按计划推算', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const item = store.addItem({
    name: '生活费',
    category: 'family',
    plannedAmount: 0,
    recurrence: { type: 'daily', amounts: [100], startDate: '2026-03-01', endDate: '2026-03-31' }
  }, MARCH);
  const NOW = new Date(2026, 2, 16, 12);

  store.setRecurringDayActual(item.id, '2026-03-05', 20, MARCH);
  assert.equal(store.summary(MARCH, NOW).recurringSpentTotal, 1520);
  store.setRecurringDayActual(item.id, '2026-03-05', null, MARCH);
  assert.equal(store.summary(MARCH, NOW).recurringSpentTotal, 1600, '恢复成 16 天 × 100');
  assert.equal(store.summary(MARCH, NOW).savedTotal, 0);
});

test('每日结算：填了未来的某天也会按实际算（用于提前知道要花多少）', () => {
  const item = recurringItem({
    recurrence: {
      type: 'daily', amounts: [100], startDate: '2026-03-01', endDate: '2026-03-31',
      overrides: { '2026-03-20': 300 }
    }
  });
  const now = new Date(2026, 2, 16, 12);
  const schedule = core.recurrenceSchedule(item, now);
  assert.equal(schedule.days.find(d => d.date === '2026-03-20').status, 'settled');
  assert.equal(schedule.overrunSoFar, 200);
  assert.equal(schedule.remainingAmount, 1400, '20 号那天已经不是待预留（今天是 16 号）');
  assert.equal(schedule.remainingDays, 14);
});

test('每日结算：逐天状态正确（已结算 / 按计划推算 / 待预留）', () => {
  const item = recurringItem({
    recurrence: {
      type: 'daily', amounts: [100], startDate: '2026-03-01', endDate: '2026-03-31',
      overrides: { '2026-03-03': 60 }
    }
  });
  const schedule = core.recurrenceSchedule(item, new Date(2026, 2, 16, 12));
  const byDate = {};
  schedule.days.forEach(day => { byDate[day.date] = day; });
  assert.equal(schedule.days.length, 31);
  assert.equal(byDate['2026-03-03'].status, 'settled');
  assert.equal(byDate['2026-03-03'].actual, 60);
  assert.equal(byDate['2026-03-03'].diff, -40);
  assert.equal(byDate['2026-03-02'].status, 'estimated');
  assert.equal(byDate['2026-03-02'].actual, null);
  assert.equal(byDate['2026-03-16'].status, 'estimated', '当天按计划记入');
  assert.equal(byDate['2026-03-16'].isToday, true);
  assert.equal(byDate['2026-03-20'].status, 'pending');
  assert.equal(schedule.plannedAmount, 3100);
  assert.equal(schedule.spentSoFar, 1600 - 40, '16 天计划 1600，3 号实际少了 40');
  assert.equal(schedule.remainingAmount, 1500);
  assert.equal(schedule.savedSoFar, 40);
  assert.equal(schedule.plannedAmount, schedule.committedAmount + schedule.savedSoFar);
});

// ---------------------------------------------------------------- 记账收入

test('记账：收入会加回结余，和支出分开统计', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  store.addEntry({ title: '奶茶', amount: 18.5, category: 'food', date: day(2026, 3, 3) }, MARCH);
  store.addEntry({
    title: '闲置物品卖出', amount: 120, category: 'other', direction: 'income', date: day(2026, 3, 6)
  }, MARCH);

  const s = store.summary(MARCH);
  assert.equal(s.ledgerTotal, 18.5, '支出合计');
  assert.equal(s.ledgerIncomeTotal, 120, '收入合计');
  assert.equal(s.ledgerExpenseCount, 1);
  assert.equal(s.ledgerIncomeCount, 1);
  assert.equal(s.actualBalance, 8000 + 120 - 18.5);
  assert.equal(s.totalAvailable, 8120);

  const groups = store.ledgerGroups(MARCH);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].entries[0].direction, 'income', '6 号在最前面');
});

test('记账：默认是支出，可以改成收入', () => {
  const store = createStore();
  const entry = store.addEntry({ title: '误记', amount: 50, category: 'other', date: day(2026, 3, 3) }, MARCH);
  assert.equal(store.entry(entry.id, MARCH).direction, 'expense');
  assert.equal(store.summary(MARCH).actualBalance, 8000 - 50, '默认支出，从结余里扣');

  store.updateEntry(entry.id, { direction: 'income' }, MARCH);
  assert.equal(store.entry(entry.id, MARCH).direction, 'income');
  assert.equal(store.summary(MARCH).ledgerTotal, 0);
  assert.equal(store.summary(MARCH).ledgerIncomeTotal, 50);
  assert.equal(store.summary(MARCH).actualBalance, 8050, '改成收入后加回结余');
});

test('导出：收入行会写成「零星收入」', () => {
  const store = createStore();
  store.addEntry({ title: '卖闲置', amount: 120, category: 'other', direction: 'income', date: day(2026, 3, 6) }, MARCH);
  const csv = store.exportCSV();
  assert.ok(csv.includes('2026年3月,零星收入,卖闲置,其他,120.00,,已收,2026-03-06'), csv);
});

test('兼容旧数据：没有 direction / recurrence 字段也能读', () => {
  const legacy = {
    version: 1,
    settings: { defaultMonthlyIncome: 8000, carryOverEnabled: true, seededSampleData: true },
    months: [{
      id: 'm', year: 2026, month: 3, income: 8000, carryOverOverride: null, note: '',
      items: [{ id: 'i', name: '房租', category: 'housing', plannedAmount: 2500, status: 'completed', actualAmount: 2500, sortIndex: 0 }],
      ledgerEntries: [{ id: 'e', title: '奶茶', amount: 20, category: 'food', date: day(2026, 3, 3) }],
      advances: []
    }]
  };
  const store = createStore(legacy);
  assert.equal(store.entry('e', MARCH).direction, 'expense', '旧记账默认是支出');
  assert.equal(store.item('i', MARCH).recurrence, null, '旧预算默认不是重复预算');
  assert.equal(store.summary(MARCH).actualBalance, 8000 - 2500 - 20);
});

// ---------------------------------------------------------------- 余额对账

function storeWithSpending() {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const rent = store.addItem({ name: '房租', category: 'housing', plannedAmount: 2500 }, MARCH);
  store.completeItem(rent.id, 2500, MARCH);
  store.addEntry({ title: '奶茶', amount: 18.5, category: 'food', date: day(2026, 3, 3) }, MARCH);
  return store;
}

test('对账：填入实际余额后，实际剩余正好等于你填的数字', () => {
  const store = storeWithSpending();
  assert.equal(store.summary(MARCH).actualBalance, 5481.5, '账面：8000 − 2500 − 18.5');
  assert.equal(store.summary(MARCH).reconciliationAdjustment, 0);

  const record = store.reconcile(5200, MARCH, '银行卡 + 现金');
  assert.equal(record.enteredBalance, 5200);
  assert.equal(record.bookBalance, 5481.5);
  assert.equal(record.difference, -281.5, '实际比账面少 281.5，说明有支出漏记');

  const summary = store.summary(MARCH);
  assert.equal(summary.actualBalance, 5200, '实际剩余对上了');
  assert.equal(summary.plannedBalance, 5200, '结余同步校正');
  assert.equal(summary.reconciliationAdjustment, -281.5);
  assert.equal(summary.reconciliationCount, 1);
  assert.equal(summary.plannedBalance + summary.unspentBudget, summary.actualBalance, '两者关系依然成立');
});

test('对账：实际比账面多时说明有收入漏记', () => {
  const store = storeWithSpending();
  const record = store.reconcile(5800, MARCH);
  assert.equal(record.difference, 318.5);
  assert.equal(store.summary(MARCH).actualBalance, 5800);
});

test('对账：预算还没花时，结余和实际剩余的差额仍然是未花预算', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  store.addItem({ name: '餐饮', category: 'food', plannedAmount: 1500 }, MARCH);
  store.addEntry({ title: '奶茶', amount: 100, category: 'food', date: day(2026, 3, 3) }, MARCH);
  // 账面实际剩余 7900，实际只有 7700
  store.reconcile(7700, MARCH);

  const s = store.summary(MARCH);
  assert.equal(s.actualBalance, 7700);
  assert.equal(s.unspentBudget, 1500);
  assert.equal(s.plannedBalance, 6200, '7700 − 1500 未花预算');
  assert.equal(s.plannedBalance + s.unspentBudget, s.actualBalance);
});

test('对账：多次对账只按最后一次调整，不会叠加', () => {
  const store = storeWithSpending();
  store.reconcile(5200, MARCH);
  assert.equal(store.summary(MARCH).actualBalance, 5200);

  const second = store.reconcile(5300, MARCH);
  assert.equal(second.bookBalance, 5481.5, '基准还是原来的账面余额');
  assert.equal(second.difference, -181.5);
  assert.equal(store.summary(MARCH).actualBalance, 5300, '不是 5300 + 281.5');
  assert.equal(store.summary(MARCH).reconciliationCount, 2, '历史记录保留');
  assert.equal(store.reconciliations(MARCH).length, 2);
  assert.equal(store.reconciliations(MARCH)[0].enteredBalance, 5300, '最新的在前');
});

test('对账：可以撤销，撤销后回到账面余额', () => {
  const store = storeWithSpending();
  store.reconcile(5200, MARCH);
  assert.equal(store.summary(MARCH).actualBalance, 5200);

  const removed = store.undoReconciliation(MARCH);
  assert.equal(removed.difference, -281.5);
  assert.equal(store.summary(MARCH).actualBalance, 5481.5);
  assert.equal(store.summary(MARCH).reconciliationAdjustment, 0);
  assert.equal(store.undoReconciliation(MARCH), null, '没有记录了');

  store.reconcile(5000, MARCH);
  store.clearReconciliations(MARCH);
  assert.equal(store.summary(MARCH).reconciliationCount, 0);
  assert.equal(store.summary(MARCH).actualBalance, 5481.5);
});

test('对账：调整会带到下个月的结转里', () => {
  const store = storeWithSpending();
  store.reconcile(5200, MARCH);
  store.ensureMonth(APRIL);
  assert.equal(store.carryOver(APRIL), 5200);
  assert.equal(store.summary(APRIL).income, 8000);
  assert.equal(store.summary(APRIL).actualBalance, 13200);
});

test('对账：导出 CSV 有对账调整行', () => {
  const store = storeWithSpending();
  store.reconcile(5200, MARCH, '月初对账');
  const csv = store.exportCSV();
  assert.ok(csv.includes('2026年3月,对账调整,按实际余额校正,,281.50,,补记支出'), csv);
  assert.ok(csv.includes('填入实际余额 5200.00 · 月初对账'));
});

test('已完成的项目：省下的钱立刻回到结余，不再占用预算', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const rent = store.addItem({ name: '房租', category: 'housing', plannedAmount: 2500 }, MARCH);

  assert.equal(store.summary(MARCH).plannedBalance, 5500, '结算前先按计划预留 2500');
  assert.equal(store.summary(MARCH).unspentBudget, 2500);

  store.completeItem(rent.id, 2400, MARCH);
  const s = store.summary(MARCH);
  assert.equal(s.paidTotal, 2400);
  assert.equal(s.committedBudget, 2400, '只按实际花的算');
  assert.equal(s.plannedBalance, 5600, '省下的 100 回到结余');
  assert.equal(s.unspentBudget, 0, '没有还要花的预算了');
  assert.equal(s.actualBalance, 5600);
  assert.equal(s.savedTotal, 100, '省下的金额单独提示');
});

test('已完成的项目：超支时按实际扣，不会少算', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const gym = store.addItem({ name: '健身', category: 'entertainment', plannedAmount: 200 }, MARCH);
  store.completeItem(gym.id, 260, MARCH);

  const s = store.summary(MARCH);
  assert.equal(s.committedBudget, 260);
  assert.equal(s.plannedBalance, 7740);
  assert.equal(s.actualBalance, 7740);
  assert.equal(s.unspentBudget, 0);
  assert.equal(s.overrunTotal, 60, '超支单独提示');
});

// ---------------------------------------------------------------- 跨月预支（提前付下个月的钱）

test('预支：本月买下个月的车票，钱从本月出、归属下个月', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const ticket = store.addAdvance({ title: '下个月的车票', amount: 700, date: day(2026, 3, 20) }, MARCH);

  assert.deepEqual(core.advanceTargetKey(store.advance(ticket.id, MARCH)), APRIL, '默认归属下个月');
  const march = store.summary(MARCH);
  assert.equal(march.advanceOutstandingTotal, 700);
  assert.equal(march.actualBalance, 7300, '本月手里的钱少了 700');
  assert.equal(march.plannedBalance, 7300, '本月的可用结余也少了 700');
  assert.equal(march.ledgerTotal, 0, '不算本月的零星支出');
  assert.equal(march.paidTotal, 0, '也不算本月的预算支出');

  // 4 月：自动带入「上月预支」
  store.ensureMonth(APRIL);
  const april = store.summary(APRIL);
  assert.equal(april.carryOver, 7300, '3 月结转的是实际剩下的钱');
  assert.equal(april.advanceIncomingTotal, 700, '只是提示：上个月已经付过这笔');
  assert.equal(april.advanceIncomingCount, 1);
  assert.equal(april.actualBalance, 16000, '8000 收入 + 7300 结转 + 700 上月替它付的');

  // 4 月把这 700 列成预算并结算：不会再重复扣一次
  const travel = store.addItem({ name: '车票', category: 'transport', plannedAmount: 700 }, APRIL);
  store.completeItem(travel.id, 700, APRIL);
  const aprilAfter = store.summary(APRIL);
  assert.equal(aprilAfter.paidTotal, 700);
  assert.equal(aprilAfter.actualBalance, 15300, '4 月记了车票 700 → 加回的 700 正好抵消');
  assert.equal(8000 + 8000 - 700, aprilAfter.actualBalance, '两个月收入 − 一次车票');
});

test('预支：可以指定归属月份，也可以不给下个月', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const key = Month.next(Month.next(MARCH));
  const advance = store.addAdvance({
    title: '5 月的机票',
    amount: 1200,
    date: day(2026, 3, 21),
    targetYear: key.year,
    targetMonth: key.month
  }, MARCH);
  assert.deepEqual(core.advanceTargetKey(store.advance(advance.id, MARCH)), key);

  store.ensureMonth(APRIL);
  assert.equal(store.summary(APRIL).advanceIncomingTotal, 0, '4 月不该收到这笔');
  store.ensureMonth(key);
  assert.equal(store.summary(key).advanceIncomingTotal, 1200, '5 月才收到');
});

test('预支：付款日在未来时只占结余，不扣实际剩余', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const now = new Date(2026, 2, 10, 12);          // 3 月 10 日
  store.addAdvance({ title: '下个月的车票', amount: 700, date: day(2026, 3, 20) }, MARCH);

  const before = store.summary(MARCH, now);
  assert.equal(before.actualBalance, 8000, '钱还没付出去，实际剩余里要包含它');
  assert.equal(before.plannedBalance, 7300, '但要先预留出来，不能算进结余');
  assert.equal(before.advancePaidTotal, 0);
  assert.equal(before.advanceReservedTotal, 700);
  assert.equal(before.advanceOutstandingTotal, 700, '总占用还是 700');
  assert.equal(before.totalSpending, 0, '还没真花，不算本月支出');

  const after = store.summary(MARCH, new Date(2026, 2, 21, 12));   // 付款日之后
  assert.equal(after.actualBalance, 7300, '过了付款日才真扣');
  assert.equal(after.plannedBalance, 7300);
  assert.equal(after.advancePaidTotal, 700);
  assert.equal(after.advanceReservedTotal, 0);
});

test('预支：预留会一直保留到扣款日（10 月结余减掉，但实际剩余里还有这笔钱）', () => {
  const store = createStore();
  const SEP = { year: 2026, month: 9 };
  const OCT = { year: 2026, month: 10 };
  const NOV = { year: 2026, month: 11 };
  [SEP, OCT, NOV].forEach(k => store.setIncome(8000, k));
  const now = new Date(2026, 8, 24, 12);            // 9 月 24 日登记
  store.addAdvance({
    title: '11 月 3 日要扣的钱',
    amount: 500,
    date: day(2026, 10, 3),                          // 扣款日 11 月 3 日
    targetYear: 2026,
    targetMonth: 11
  }, SEP);

  const september = store.summary(SEP, now);
  assert.equal(september.actualBalance, 8000, '钱还在卡里 → 实际剩余不减');
  assert.equal(september.plannedBalance, 7500, '但结余里先减掉 500（预留）');
  assert.equal(september.advanceReservedTotal, 500);

  const october = store.summary(OCT, now);
  assert.equal(october.carryOver, 7500, '普通结转不含仍在预留中的 500');
  assert.equal(october.advanceCarriedTotal, 500, '跨月预留现金单独带入');
  assert.equal(october.actualBalance, 16000, '10 月的实际剩余里包含这 500（还没花）');
  assert.equal(october.advanceReservedTotal, 500, '10 月仍然要预留');
  assert.equal(october.plannedBalance, 15500, '所以 10 月的结余要减掉这 500');

  const november = store.summary(NOV, now);
  assert.equal(november.carryOver, 15500, '普通结转不含单独带入11月的500');
  assert.equal(november.advanceCarriedTotal, 500, '目标月份仍要收到之前预留的现金');
  assert.equal(november.actualBalance, 24000, '钱一直在卡里，11 月当然包含它');
  assert.equal(november.advanceReservedTotal, 0, '到了目标月就不再预留扣结余了');
  assert.equal(november.plannedBalance, 24000, '11 月的结余不再减这 500');

  store.setCarryOverOverride(0, NOV);
  const novemberWithZeroOverride = store.summary(NOV, now);
  assert.equal(novemberWithZeroOverride.actualBalance, 8500, '手动结转为0时，11月收入8000仍要加预留现金500');
  assert.equal(novemberWithZeroOverride.advanceCarriedTotal, 500);
  assert.equal(novemberWithZeroOverride.advanceReservedTotal, 0);
  store.setCarryOverOverride(null, NOV);

  // 扣款日到了之后：钱真的出去，实际剩余减少，预留解除；全程只扣这一次
  const later = new Date(2026, 10, 5, 12);           // 11 月 5 日
  assert.equal(store.summary(SEP, later).actualBalance, 7500, '钱真的出去了（在登记月体现）');
  assert.equal(store.summary(SEP, later).advanceReservedTotal, 0, '扣款后不再预留');
  assert.equal(store.summary(OCT, later).actualBalance, 15500, '10 月实际剩余随之减少');
  assert.equal(store.summary(OCT, later).plannedBalance, 15500, '也不再重复预留');

  // 11 月（归属月）：这笔钱已经付过，所以加回可用额度，等你把 11 月的这笔预算记成已支付时抵消
  const novemberAfter = store.summary(NOV, later);
  assert.equal(novemberAfter.advanceIncomingTotal, 500, '11 月把上月已付的 500 加回');
  assert.equal(novemberAfter.actualBalance, 24000, '8000 + 15500 结转 + 500');
  const bill = store.addItem({ name: '11 月这笔开销', category: 'other', plannedAmount: 500 }, NOV);
  store.completeItem(bill.id, 500, NOV);
  assert.equal(store.summary(NOV, later).actualBalance, 23500, '记成已支付后 ≈ 银行卡（三个月收入 − 一次 500）');
});

test('预支：真的花了（9 月买了 10 月的车票）就当场扣实际剩余', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  store.ensureMonth(APRIL);
  const now = new Date(2026, 2, 20, 12);
  store.addAdvance({ title: '10 月的车票', amount: 700, date: day(2026, 3, 10) }, MARCH);

  const march = store.summary(MARCH, now);
  assert.equal(march.actualBalance, 7300, '钱已经花掉 → 实际剩余减少');
  assert.equal(march.plannedBalance, 7300);
  assert.equal(march.advancePaidTotal, 700);
  assert.equal(march.advanceReservedTotal, 0, '已经花掉的不用再预留');

  const april = store.summary(APRIL, now);
  assert.equal(april.advanceIncomingTotal, 700, '10 月把上月替它付的 700 加回可用额度');
  assert.equal(april.actualBalance, 16000, '8000 收入 + 7300 结转 + 700 上月已付');
  assert.equal(april.plannedBalance, 16000);
  assert.equal(april.advanceReservedTotal, 0, '已经花掉的不再预留');

  // 10 月把「车票 700」记成已支付：刚好把加回的 700 抵消掉
  const ticket = store.addItem({ name: '车票', category: 'transport', plannedAmount: 700 }, APRIL);
  assert.equal(store.summary(APRIL, now).actualBalance, 16000, '只是列预算还没扣');
  store.completeItem(ticket.id, 700, APRIL);
  const aprilAfter = store.summary(APRIL, now);
  assert.equal(aprilAfter.actualBalance, 15300, '记账后 ≈ 银行卡余额');
  assert.equal(aprilAfter.plannedBalance, 15300);
  assert.equal(8000 + 8000 - 700, aprilAfter.actualBalance, '两个月收入 − 一次车票');
});

test('预支综合：9 月付车票 + 给 11 月预留，10 月的数字要对得上', () => {
  const SEP = { year: 2026, month: 9 };
  const OCT = { year: 2026, month: 10 };
  const NOV = { year: 2026, month: 11 };
  const store = createStore();
  store.setIncome(1200, SEP);      // 9 月：付掉 700 车票、为 11 月预留 500
  store.setIncome(8800, OCT);      // 10 月收入 8800
  store.ensureMonth(NOV);
  store.addAdvance({ title: '10 月的车票', amount: 700, date: day(2026, 8, 10), targetYear: 2026, targetMonth: 10 }, SEP);
  store.addAdvance({ title: '11 月 3 日要扣的钱', amount: 500, date: day(2026, 10, 3), targetYear: 2026, targetMonth: 11 }, SEP);
  const now = new Date(2026, 8, 24, 12);

  const before = store.summary(OCT, now);
  assert.equal(before.carryOver, 0, '普通结转不含给 11 月预留的 500');
  assert.equal(before.availableCarryOver, 0, '500 是跨月预留，不混进可自由安排的上月结转');
  assert.equal(before.balanceBeforeCarriedReservations, 9500, '手动扣车票预算前：8800 + 700 = 9500');
  assert.equal(before.actualBalance, 10000, '卡里还含有给 11 月预留的 500');
  assert.equal(before.plannedBalance, 9500, '实际剩余 − 预支待预留 500');

  const ticket = store.addItem({ name: '车票', category: 'transport', plannedAmount: 700 }, OCT);
  store.completeItem(ticket.id, 700, OCT);
  const after = store.summary(OCT, now);
  assert.equal(after.balanceBeforeCarriedReservations, 8800, '9500 − 当月车票实际支付 700');
  assert.equal(after.advanceCarriedTotal, 500, '9 月给 11 月预留的钱仍在卡里');
  assert.equal(after.actualBalance, 9300, '本月账面 8800 + 跨月预留现金 500');
  assert.equal(after.plannedBalance, 8800, '结余 = 实际剩余 9300 − 预支预留 500 − 当月剩余预算 0');
  assert.equal(after.advanceReservedTotal, 500, '11 月那笔预留仍然挂着');
  assert.equal(after.plannedBalance + after.advanceReservedTotal + after.unspentBudget, after.actualBalance);

  store.addItem({ name: '当月生活费', category: 'food', plannedAmount: 300 }, OCT);
  const withCurrentBudget = store.summary(OCT, now);
  assert.equal(withCurrentBudget.actualBalance, 9300, '未支付的当月预算不改变卡里的实际余额');
  assert.equal(withCurrentBudget.unspentBudget, 300);
  assert.equal(withCurrentBudget.plannedBalance, 8500, '9300 − 预支预留 500 − 当月预算 300');

  store.setCarryOverOverride(0, OCT);
  const withZeroOverride = store.summary(OCT, now);
  assert.equal(withZeroOverride.availableCarryOver, 0, '手动结转为 0 时不能显示成 −500');
  assert.equal(withZeroOverride.advanceCarriedTotal, 500, '跨月预留仍然独立带入');
  assert.equal(withZeroOverride.actualBalance, 9300);
  assert.equal(withZeroOverride.plannedBalance, 8500);
});

test('预支：明确选「还没花」时，即使扣款日是今天也只预留不扣现金', () => {
  const store = createStore();
  const SEP = { year: 2026, month: 9 };
  const OCT = { year: 2026, month: 10 };
  const NOV = { year: 2026, month: 11 };
  [SEP, OCT, NOV].forEach(k => store.setIncome(8000, k));
  const now = new Date(2026, 8, 24, 12);

  // 9 月登记、扣款日就是今天，但明确选「还没花」（预留给 11 月）
  store.addAdvance({
    title: '11 月的预留',
    amount: 500,
    date: day(2026, 8, 24),
    targetYear: 2026,
    targetMonth: 11,
    paidOverride: false
  }, SEP);

  const september = store.summary(SEP, now);
  assert.equal(september.actualBalance, 8000, '钱没出去 → 9 月实际剩余不变');
  assert.equal(september.plannedBalance, 7500, '结余里减掉 500');

  const october = store.summary(OCT, now);
  assert.equal(october.actualBalance, 16000, '10 月实际剩余里含这 500');
  assert.equal(october.plannedBalance, 15500, '10 月结余也减掉 500');

  const november = store.summary(NOV, now);
  assert.equal(november.advanceCarriedTotal, 500, '目标月份仍然单独带入这500');
  assert.equal(november.advanceReservedTotal, 0, '目标月份不再把它当作未来预留');
  assert.equal(november.actualBalance, 24000, '11 月就是给它预留的月份，钱直接算在实际剩余里');
  assert.equal(november.plannedBalance, 24000, '11 月不再预扣');

  // 如果明确选「已经花了」，就当场从实际剩余里扣
  store.updateAdvance(store.advances(SEP)[0].id, { paidOverride: true }, SEP);
  assert.equal(store.summary(SEP, now).actualBalance, 7500, '已经花了 → 当场扣');
  assert.equal(store.summary(OCT, now).actualBalance, 15500, '10 月随之减少');
});

// ---------------------------------------------------------------- 备份提醒

// ---------------------------------------------------------------- 分次结算

test('排序：预算未完成在前（按计划金额降序），已完成在后（按实际金额降序）', () => {
  const store = createStore();
  store.setIncome(10000, MARCH);
  const phone = store.addItem({ name: '话费', category: 'communication', plannedAmount: 100 }, MARCH);
  const rent = store.addItem({ name: '房租', category: 'housing', plannedAmount: 2500 }, MARCH);
  const food = store.addItem({ name: '餐饮', category: 'food', plannedAmount: 1200 }, MARCH);

  assert.deepEqual(store.items(MARCH).map(i => i.name), ['房租', '餐饮', '话费'], '未完成按计划金额从大到小');

  store.addItemPayment(rent.id, { amount: 2500, date: day(2026, 3, 3) }, MARCH);
  store.addItemPayment(phone.id, { amount: 100, date: day(2026, 3, 4) }, MARCH);
  assert.deepEqual(store.items(MARCH).map(i => i.name), ['餐饮', '房租', '话费'],
    '未完成的餐饮排最前，两个已完成按实际金额从大到小');
});

test('排序：预支按日期从新到旧', () => {
  const store = createStore();
  store.setIncome(10000, MARCH);
  store.addAdvance({ title: '3 月 1 日', amount: 200, date: day(2026, 3, 1) }, MARCH);
  store.addAdvance({ title: '3 月 20 日', amount: 300, date: day(2026, 3, 20) }, MARCH);
  store.addAdvance({ title: '3 月 5 日', amount: 400, date: day(2026, 3, 5) }, MARCH);

  assert.deepEqual(store.advances(MARCH).map(a => a.title), ['3 月 20 日', '3 月 5 日', '3 月 1 日']);
});

test('排序：记账按日期从新到旧', () => {
  const store = createStore();
  store.addEntry({ title: '3 号', amount: 1, category: 'other', date: day(2026, 3, 3) }, MARCH);
  store.addEntry({ title: '20 号', amount: 1, category: 'other', date: day(2026, 3, 20) }, MARCH);
  store.addEntry({ title: '10 号', amount: 1, category: 'other', date: day(2026, 3, 10) }, MARCH);
  assert.deepEqual(store.entries(MARCH).map(e => e.title), ['20 号', '10 号', '3 号']);
});

test('分次结算：一个项目分几笔付完，每笔都有自己的金额和日期', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const item = store.addItem({ name: '装修', category: 'housing', plannedAmount: 3000 }, MARCH);

  const first = store.addItemPayment(item.id, { amount: 1000, date: day(2026, 3, 5) }, MARCH);
  assert.equal(first.finished, false);
  assert.equal(first.remaining, 2000);

  const afterFirst = store.summary(MARCH, new Date(2026, 2, 5));
  assert.equal(afterFirst.paidTotal, 1000, '已付 1000');
  assert.equal(afterFirst.remainingBudget, 2000, '剩下的 2000 才算还要预留');
  assert.equal(afterFirst.actualBalance, 7000);
  assert.equal(afterFirst.plannedBalance, 5000, '结余仍按整笔计划 3000 扣');
  assert.equal(afterFirst.unspentBudget, 2000);

  const second = store.addItemPayment(item.id, { amount: 1200, date: day(2026, 3, 12) }, MARCH);
  assert.equal(second.remaining, 800);
  assert.equal(store.item(item.id, MARCH).status, 'planned', '还没付完，仍算计划中');
  assert.equal(store.summary(MARCH).paidTotal, 2200);

  const third = store.addItemPayment(item.id, { amount: 800, date: day(2026, 3, 20) }, MARCH);
  assert.equal(third.finished, true, '付满自动标记完成');
  const settled = store.item(item.id, MARCH);
  assert.equal(settled.status, 'completed');
  assert.equal(settled.payments.length, 3);
  assert.equal(core.itemPaymentsTotal(settled), 3000);
  assert.equal(store.summary(MARCH).remainingBudget, 0);
  assert.equal(store.summary(MARCH).actualBalance, 5000);
});

test('分次结算：删掉一笔会重算已付；状态要自己改（撤销结算）', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const item = store.addItem({ name: '装修', category: 'housing', plannedAmount: 3000 }, MARCH);
  store.addItemPayment(item.id, { amount: 1000, date: day(2026, 3, 5) }, MARCH);
  const second = store.addItemPayment(item.id, { amount: 2000, date: day(2026, 3, 9) }, MARCH);
  assert.equal(store.item(item.id, MARCH).status, 'completed');

  store.deleteItemPayment(item.id, second.payment.id, MARCH);
  assert.equal(store.summary(MARCH).paidTotal, 1000, '删掉那笔后已付回到 1000');
  assert.equal(store.item(item.id, MARCH).payments.length, 1);
  assert.equal(store.summary(MARCH).remainingBudget, 0, '项目仍是「已完成」，不再预留');
  assert.equal(store.summary(MARCH).savedTotal, 2000, '视作省下 2000');

  store.reopenItem(item.id, MARCH);
  assert.equal(store.summary(MARCH).remainingBudget, 2000, '改回计划中后，剩下的 2000 继续预留');
  assert.equal(store.summary(MARCH).paidTotal, 1000);
});

test('分次结算：可以手动标记完成（剩下的不打算再花）', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const item = store.addItem({ name: '装修', category: 'housing', plannedAmount: 3000 }, MARCH);
  store.addItemPayment(item.id, { amount: 2500, date: day(2026, 3, 5) }, MARCH);

  store.markItemCompleted(item.id, MARCH);
  const settled = store.item(item.id, MARCH);
  assert.equal(settled.status, 'completed');
  const s = store.summary(MARCH);
  assert.equal(s.paidTotal, 2500, '按实际付掉的算');
  assert.equal(s.remainingBudget, 0, '不再预留');
  assert.equal(s.savedTotal, 500, '比计划省下 500');
  assert.equal(s.actualBalance, 5500);
});

test('分次结算：撤销结算不会丢掉付款记录', () => {
  const store = createStore();
  store.setIncome(8000, MARCH);
  const item = store.addItem({ name: '装修', category: 'housing', plannedAmount: 3000 }, MARCH);
  store.addItemPayment(item.id, { amount: 3000, date: day(2026, 3, 5) }, MARCH);
  assert.equal(store.item(item.id, MARCH).status, 'completed');

  store.reopenItem(item.id, MARCH);
  const reopened = store.item(item.id, MARCH);
  assert.equal(reopened.status, 'planned');
  assert.equal(reopened.payments.length, 1, '付款记录还在');
  assert.equal(store.summary(MARCH).paidTotal, 3000);
  assert.equal(store.summary(MARCH).remainingBudget, 0);
});

test('备份提醒：从没备份过会提醒，导出后 7 天内不再提醒', () => {
  const store = createStore();
  const now = new Date(2026, 2, 16, 12);

  assert.equal(core.daysSinceBackup(store.settings, now), Infinity);
  assert.equal(core.needsBackup(store.settings, now), true, '从没备份过要提醒');

  store.markBackupTaken(now);
  assert.equal(core.daysSinceBackup(store.settings, now), 0);
  assert.equal(core.needsBackup(store.settings, now), false);
  assert.equal(core.daysSinceBackup(store.settings, new Date(2026, 2, 19, 12)), 3);
  assert.equal(core.needsBackup(store.settings, new Date(2026, 2, 22, 12)), false, '第 6 天还不提醒');
  assert.equal(core.needsBackup(store.settings, new Date(2026, 2, 23, 13)), true, '超过 7 天提醒');
});

test('备份提醒：备份时间会一起存进 JSON，换设备导入后仍然记得', () => {
  const store = createStore();
  const now = new Date(2026, 2, 16, 12);
  store.markBackupTaken(now);
  const restored = createStore(JSON.parse(store.toJSON()));
  assert.equal(core.daysSinceBackup(restored.settings, now), 0);
  assert.equal(core.needsBackup(restored.settings, now), false);
});
