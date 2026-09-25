/*
 * 月账本 · 核心逻辑（金额、账期、结余计算、数据读写）
 * 这个文件同时用于浏览器（挂到 window.BudgetCore）和 Node 测试（module.exports），
 * 所以不依赖任何浏览器 API，界面相关的东西都放在 app.js。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BudgetCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** App 版本号：改了功能就 +1，设置里能看到，用来确认线上是否已更新 */
  const VERSION = 'v2.3.21';

  // ---------------------------------------------------------------- 金额
  // 内部一律按“分”做整数运算，避免 0.1 + 0.2 这类浮点误差。

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[¥￥,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function toCents(value) {
    const n = toNumber(value);
    return Math.sign(n) * Math.round(Math.abs(n) * 100);
  }

  const Money = {
    cents: toCents,

    round(value) {
      return toCents(value) / 100;
    },

    sum(list) {
      if (!list || list.length === 0) return 0;
      return list.reduce((acc, item) => acc + toCents(item), 0) / 100;
    },

    /** 用户输入 → 金额；非法输入返回 null。 */
    parse(text) {
      if (text === null || text === undefined) return null;
      const cleaned = String(text).replace(/[¥￥,\s]/g, '').trim();
      if (cleaned === '') return null;
      if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
      if (cleaned === '.' || cleaned === '-') return null;
      const n = Number(cleaned);
      return Number.isFinite(n) ? Money.round(n) : null;
    },

    /** ¥1,234.50 */
    format(value, withSymbol) {
      const digits = 2;
      const text = Money.round(value).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      });
      return withSymbol === false ? text : '¥' + text;
    },

    /** 输入框回填用：整数不显示小数，如 2500 / 18.5 */
    plain(value) {
      const rounded = Money.round(value);
      return Number.isInteger(rounded) ? String(rounded) : String(rounded);
    },

    /** CSV 导出用：固定两位小数、无千分位 */
    csv(value) {
      return Money.round(value).toFixed(2);
    },

    isNegative(value) {
      return Money.round(value) < 0;
    },

    /** 百分比（0 ~ 1），分母为 0 时返回 0 */
    ratio(part, total) {
      const denominator = toCents(total);
      if (denominator === 0) return 0;
      return toCents(part) / denominator;
    }
  };

  // ---------------------------------------------------------------- 账期

  function normalizeMonth(year, month) {
    let y = Math.trunc(year);
    let m = Math.trunc(month);
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return { year: y, month: m };
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  const Month = {
    make: (year, month) => normalizeMonth(year, month),

    fromKey(key) {
      const parts = String(key).split('-');
      return normalizeMonth(Number(parts[0]) || 1970, Number(parts[1]) || 1);
    },

    fromDate(date) {
      const d = date instanceof Date ? date : new Date(date);
      return normalizeMonth(d.getFullYear(), d.getMonth() + 1);
    },

    current(now) {
      return Month.fromDate(now || new Date());
    },

    key(key) {
      return key.year + '-' + pad2(key.month);
    },

    /** 2026年3月 */
    label(key) {
      return key.year + '年' + key.month + '月';
    },

    /** 3月 */
    shortLabel(key) {
      return key.month + '月';
    },

    next(key) {
      return normalizeMonth(key.year, key.month + 1);
    },

    prev(key) {
      return normalizeMonth(key.year, key.month - 1);
    },

    equals(a, b) {
      return !!a && !!b && a.year === b.year && a.month === b.month;
    },

    compare(a, b) {
      if (a.year !== b.year) return a.year < b.year ? -1 : 1;
      if (a.month !== b.month) return a.month < b.month ? -1 : 1;
      return 0;
    },

    /** 当月 1 号 0 点 */
    startDate(key) {
      return new Date(key.year, key.month - 1, 1, 0, 0, 0, 0);
    },

    /** 下月 1 号 0 点（开区间上界） */
    endDate(key) {
      return Month.startDate(Month.next(key));
    },

    dayCount(key) {
      return new Date(key.year, key.month, 0).getDate();
    },

    contains(key, date) {
      return Month.equals(key, Month.fromDate(date));
    },

    /** 当月已过去的天数占比，用于「按天看进度」 */
    elapsedRatio(key, now) {
      const today = Month.fromDate(now || new Date());
      const diff = Month.compare(today, key);
      if (diff < 0) return 0;
      if (diff > 0) return 1;
      const day = (now instanceof Date ? now : new Date()).getDate();
      return Math.min(1, Math.max(0, day / Month.dayCount(key)));
    }
  };

  // ---------------------------------------------------------------- 分类

  const Categories = [
    { id: 'housing', label: '居住', icon: '🏠' },
    { id: 'food', label: '餐饮', icon: '🍚' },
    { id: 'transport', label: '交通', icon: '🚌' },
    { id: 'utilities', label: '水电燃气', icon: '⚡' },
    { id: 'communication', label: '通讯', icon: '📱' },
    { id: 'medical', label: '医疗', icon: '🏥' },
    { id: 'education', label: '教育', icon: '📚' },
    { id: 'family', label: '家庭', icon: '👨‍👩‍👧' },
    { id: 'entertainment', label: '娱乐', icon: '🎮' },
    { id: 'shopping', label: '购物', icon: '🛍️' },
    { id: 'social', label: '人情往来', icon: '🎁' },
    { id: 'travel', label: '旅行', icon: '✈️' },
    { id: 'saving', label: '储蓄理财', icon: '🏦' },
    { id: 'pet', label: '宠物', icon: '🐾' },
    { id: 'other', label: '其他', icon: '📌' }
  ];

  const CATEGORY_MAP = Categories.reduce(function (acc, item) {
    acc[item.id] = item;
    return acc;
  }, {});

  function categoryOf(id) {
    return CATEGORY_MAP[id] || CATEGORY_MAP.other;
  }

  function categoryLabel(id) {
    return categoryOf(id).label;
  }

  function categoryIcon(id) {
    return categoryOf(id).icon;
  }

  // ---------------------------------------------------------------- 模型

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function createItem(input) {
    const now = new Date().toISOString();
    const data = input || {};
    return {
      id: data.id || uid(),
      name: data.name || '',
      category: data.category || 'other',
      plannedAmount: Money.round(data.plannedAmount || 0),
      actualAmount: data.actualAmount === undefined || data.actualAmount === null
        ? null
        : Money.round(data.actualAmount),
      status: data.status || 'planned',
      note: data.note || '',
      dueDate: data.dueDate || null,
      settledAt: data.settledAt || null,
      /* 重复预算：每天每人一笔（例如生活费）。null 表示普通的一次性预算。 */
      recurrence: normalizeRecurrence(data.recurrence),
      /* 分次结算：这个项目可能分几笔付完，每笔有自己的金额和日期 */
      payments: (data.payments || []).map(createPayment),
      sortIndex: typeof data.sortIndex === 'number' ? data.sortIndex : 0,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now
    };
  }

  function createPayment(input) {
    const data = input || {};
    return {
      id: data.id || uid(),
      amount: Money.round(data.amount || 0),
      date: data.date || new Date().toISOString(),
      note: data.note || '',
      createdAt: data.createdAt || new Date().toISOString()
    };
  }

  /** 分次付款的合计 */
  function itemPaymentsTotal(item) {
    if (!item || !item.payments || item.payments.length === 0) return 0;
    return Money.sum(item.payments.map(function (payment) { return payment.amount; }));
  }

  function sortedPayments(item) {
    if (!item || !item.payments) return [];
    return item.payments.slice().sort(function (a, b) {
      const diff = new Date(b.date) - new Date(a.date);
      if (diff !== 0) return diff;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  function normalizeRecurrence(value) {
    if (!value || value.type !== 'daily') return null;
    const amounts = (value.amounts || [])
      .map(function (amount) { return Money.round(Math.max(0, toNumber(amount))); });
    if (amounts.length === 0) return null;
    const overrides = {};
    const rawOverrides = value.overrides || {};
    Object.keys(rawOverrides).forEach(function (dayKey) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return;
      const amount = rawOverrides[dayKey];
      if (amount === null || amount === undefined || amount === '') return;
      overrides[dayKey] = Money.round(Math.max(0, toNumber(amount)));
    });
    return {
      type: 'daily',
      amounts: amounts,
      startDate: value.startDate || null,
      endDate: value.endDate || null,
      /* 某天实际花了多少（'YYYY-MM-DD' → 金额）；没填的天数按计划金额推算 */
      overrides: overrides
    };
  }

  function createEntry(input) {
    const now = new Date().toISOString();
    const data = input || {};
    return {
      id: data.id || uid(),
      title: data.title || '',
      amount: Money.round(data.amount || 0),
      category: data.category || 'other',
      /* expense = 支出，income = 收入（旧数据没有这个字段时默认支出） */
      direction: data.direction === 'income' ? 'income' : 'expense',
      date: data.date || now,
      note: data.note || '',
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now
    };
  }

  function createAdvance(input) {
    const now = new Date().toISOString();
    const data = input || {};
    const date = data.date || now;
    const dateKey = Month.fromDate(new Date(date));
    const fallbackTarget = Month.next(dateKey);
    return {
      id: data.id || uid(),
      title: data.title || '',
      amount: Money.round(data.amount || 0),
      /* 兼容旧数据：预支不再有「还款/收回」的概念，这个字段恒为 0 */
      repaidAmount: Money.round(data.repaidAmount || 0),
      date: date,
      note: data.note || '',
      repaidAt: data.repaidAt || null,
      /* 这笔钱属于哪个月（默认是下个月）：例如 9 月买 10 月的车票 */
      targetYear: typeof data.targetYear === 'number' ? data.targetYear : fallbackTarget.year,
      targetMonth: typeof data.targetMonth === 'number' ? data.targetMonth : fallbackTarget.month,
      /*
       * 钱到底花了没有：
       *   null  = 按扣款日自动判断（到了就按已花掉算）
       *   true  = 用户明确说「已经花了」
       *   false = 用户明确说「还没花，先预留」
       */
      paidOverride: typeof data.paidOverride === 'boolean' ? data.paidOverride : null,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now
    };
  }

  /** 预支的归属月份 */
  function advanceTargetKey(advance) {
    return Month.make(advance.targetYear, advance.targetMonth);
  }

  /** 这笔预支占用的钱（金额减去历史遗留的已收回部分）。 */
  function advanceOutstanding(advance) {
    return Math.max(0, Money.round(advance.amount - advance.repaidAmount));
  }

  /**
   * 预支的付款日期到了没有：
   * - 还没到（未来日期）→ 钱还在手里，只占结余（像计划中的预算，先预留）
   * - 到了或已经过去 → 钱真的付出去了，实际剩余也要扣
   */
  function advanceIsPaid(advance, now) {
    if (typeof advance.paidOverride === 'boolean') return advance.paidOverride;
    const when = new Date(advance.date);
    if (!Number.isFinite(when.getTime())) return true;
    const today = startOfDay(now || new Date()).getTime();
    return startOfDay(when).getTime() <= today;
  }

  function createMonth(input) {
    const now = new Date().toISOString();
    const data = input || {};
    const key = normalizeMonth(data.year || 1970, data.month || 1);
    return {
      id: data.id || uid(),
      year: key.year,
      month: key.month,
      income: Money.round(data.income || 0),
      carryOverOverride: data.carryOverOverride === undefined || data.carryOverOverride === null
        ? null
        : Money.round(data.carryOverOverride),
      note: data.note || '',
      items: (data.items || []).map(createItem),
      ledgerEntries: (data.ledgerEntries || []).map(createEntry),
      advances: (data.advances || []).map(createAdvance),
      /* 余额对账记录：用户填入的实际余额与账面余额的差额（最后一条生效） */
      reconciliations: (data.reconciliations || []).map(createReconciliation),
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now
    };
  }

  function createReconciliation(input) {
    const data = input || {};
    return {
      id: data.id || uid(),
      createdAt: data.createdAt || new Date().toISOString(),
      /* 用户填写的实际余额 */
      enteredBalance: Money.round(data.enteredBalance || 0),
      /* 当时 App 算出来的账面余额（不含调整） */
      bookBalance: Money.round(data.bookBalance || 0),
      /* 差额 = 实际 − 账面；负数说明有支出漏记了，正数说明有收入漏记了 */
      difference: Money.round(data.difference || 0),
      note: data.note || ''
    };
  }

  /** 当前生效的对账调整额（取最后一次对账的差额）。 */
  function reconciliationAdjustment(month) {
    if (!month || !month.reconciliations || month.reconciliations.length === 0) return 0;
    const last = month.reconciliations[month.reconciliations.length - 1];
    return Money.round(last.difference || 0);
  }

  function defaultSettings() {
    return {
      defaultMonthlyIncome: 8000,
      carryOverEnabled: true,
      seededSampleData: false,
      /* 上次导出备份的时间，用来判断要不要提醒备份 */
      lastBackupAt: null,
      createdAt: new Date().toISOString()
    };
  }

  /** 距离上次导出备份过了多少天；从没备份过返回 Infinity。 */
  function daysSinceBackup(settings, now) {
    if (!settings || !settings.lastBackupAt) return Infinity;
    const last = new Date(settings.lastBackupAt).getTime();
    if (!Number.isFinite(last)) return Infinity;
    const reference = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
    return Math.max(0, Math.floor((reference - last) / 86400000));
  }

  /** 要不要提醒备份：默认超过 7 天（或从没备份过）就提醒。 */
  function needsBackup(settings, now, limitDays) {
    const limit = limitDays === undefined ? 7 : limitDays;
    return daysSinceBackup(settings, now) >= limit;
  }

  function defaultState() {
    return { version: 1, settings: defaultSettings(), months: [] };
  }

  // ---------------------------------------------------------- 重复预算（每天每人）

  /** 本地日期 → 'YYYY-MM-DD' */
  function dayString(value) {
    const d = value instanceof Date ? value : new Date(value);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseDay(value) {
    if (!value) return null;
    const parts = String(value).split('-');
    if (parts.length < 3) return null;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** 用 UTC 分量算天数差，避免夏令时/时区带来的误差 */
  function dayDiff(from, to) {
    const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86400000);
  }

  function startOfDay(value) {
    const d = value instanceof Date ? value : new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }

  function isRecurring(item) {
    return !!(item && item.recurrence && item.recurrence.type === 'daily');
  }

  /**
   * 重复预算的进度，逐天算：
   * - 已经「结算」过的天：按填写的实际金额算（可能少花，也可能超支）
   * - 今天及之前、还没结算的天：按计划金额先记入「已发生」（不然当天会显得结余偏高）
   * - 明天及以后：算作「还需要预留」
   * 于是 计划总额 = 已发生 + 还需预留 + 省下的钱。
   * now 传进来是为了可测试；界面用当前时间。
   */
  function recurrenceSchedule(item, now) {
    if (!isRecurring(item)) return null;
    const rec = item.recurrence;
    const dailyTotal = Money.sum(rec.amounts);
    const start = parseDay(rec.startDate) || startOfDay(now || new Date());
    const end = parseDay(rec.endDate) || start;
    const totalDays = Math.max(0, dayDiff(start, end) + 1);
    const today = startOfDay(now || new Date());
    const overrides = rec.overrides || {};

    const days = [];
    let spentCents = 0;
    let remainingCents = 0;
    let savedCents = 0;
    let overrunCents = 0;
    let settledDays = 0;
    let estimatedDays = 0;
    let remainingDays = 0;

    for (let index = 0; index < totalDays; index += 1) {
      const current = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 0, 0, 0, 0);
      const dayKey = dayString(current);
      const planCents = Money.cents(dailyTotal);
      const hasActual = Object.prototype.hasOwnProperty.call(overrides, dayKey);
      const isPast = dayDiff(current, today) > 0;
      // 当天 0 点起就按计划计入已发生，用户当天填了实际金额会覆盖它
      const isPastOrToday = dayDiff(current, today) >= 0;

      let status;
      let actual = null;
      let diff = 0;

      if (hasActual) {
        actual = Money.round(overrides[dayKey]);
        const actualCents = Money.cents(actual);
        diff = Money.round((actualCents - planCents) / 100);
        spentCents += actualCents;
        settledDays += 1;
        if (actualCents > planCents) overrunCents += actualCents - planCents;
        else savedCents += planCents - actualCents;
        status = 'settled';
      } else if (isPastOrToday) {
        spentCents += planCents;
        estimatedDays += 1;
        status = 'estimated';
      } else {
        remainingCents += planCents;
        remainingDays += 1;
        status = 'pending';
      }

      days.push({
        date: dayKey,
        planned: Money.round(dailyTotal),
        actual: actual,
        diff: diff,
        status: status,
        isToday: dayDiff(current, today) === 0,
        isPast: isPast
      });
    }

    const spentSoFar = spentCents / 100;
    const remainingAmount = remainingCents / 100;
    return {
      type: 'daily',
      amounts: rec.amounts.slice(),
      peopleCount: rec.amounts.length,
      dailyTotal: dailyTotal,
      startDate: dayString(start),
      endDate: dayString(end),
      totalDays: totalDays,
      spentDays: settledDays + estimatedDays,
      settledDays: settledDays,
      estimatedDays: estimatedDays,
      remainingDays: remainingDays,
      plannedAmount: Money.round(dailyTotal * totalDays),
      spentSoFar: Money.round(spentSoFar),
      remainingAmount: Money.round(remainingAmount),
      /* 这笔预算总共要占用的额度：已经发生的 + 还要预留的 */
      committedAmount: Money.round(spentSoFar + remainingAmount),
      savedSoFar: Money.round(savedCents / 100),
      overrunSoFar: Money.round(overrunCents / 100),
      days: days
    };
  }

  /** 计划金额：重复预算按「每天合计 × 天数」实时算，普通预算用填写的金额。 */
  function itemPlannedAmount(item, now) {
    const schedule = recurrenceSchedule(item, now);
    if (schedule) return schedule.plannedAmount;
    return Money.round(item.plannedAmount);
  }

  /** 已经花掉的钱：重复预算按已过天数自动累计，普通预算要手动结算。 */
  function itemPaidAmount(item, now) {
    const paymentsTotal = itemPaymentsTotal(item);
    if (item.status === 'completed') {
      // 有分次付款记录就按记录合计，否则用填写的实际金额
      if (paymentsTotal > 0) return paymentsTotal;
      const actual = item.actualAmount === null || item.actualAmount === undefined
        ? itemPlannedAmount(item, now)
        : item.actualAmount;
      return Money.round(actual);
    }
    // 还没标记完成，但已经付了几笔
    if (paymentsTotal > 0) return paymentsTotal;
    const schedule = recurrenceSchedule(item, now);
    return schedule ? schedule.spentSoFar : 0;
  }

  /**
   * 这笔预算一共要占用多少额度：
   * - 已完成的项目：只按实际花掉的算，省下的钱立刻回到结余（不再占额度）
   * - 按天重复的项目：已经发生的 + 后续还需要预留的
   * - 还没完成的项目：按计划金额先留出来
   */
  function itemCommittedAmount(item, now) {
    if (item.status === 'completed') return itemPaidAmount(item, now);
    const schedule = recurrenceSchedule(item, now);
    if (schedule) return schedule.committedAmount;
    return itemPlannedAmount(item, now);
  }

  /** 还没发生的预算占用：重复预算就是「后续还需要留的钱」。 */
  function itemOutstandingPlan(item, now) {
    if (item.status === 'completed') return 0;
    const schedule = recurrenceSchedule(item, now);
    if (schedule) return schedule.remainingAmount;
    // 分次结算：扣掉已经付掉的部分，剩下的才是还要预留的
    return Math.max(0, Money.round(itemPlannedAmount(item, now) - itemPaidAmount(item, now)));
  }

  function itemOverrun(item, now) {
    const schedule = recurrenceSchedule(item, now);
    if (schedule && item.status !== 'completed') return schedule.overrunSoFar;
    if (item.status !== 'completed') return 0;
    return Math.max(0, Money.round(itemPaidAmount(item, now) - itemPlannedAmount(item, now)));
  }

  function itemSaved(item, now) {
    const schedule = recurrenceSchedule(item, now);
    if (schedule && item.status !== 'completed') return schedule.savedSoFar;
    if (item.status !== 'completed') return 0;
    return Math.max(0, Money.round(itemPlannedAmount(item, now) - itemPaidAmount(item, now)));
  }

  /**
   * 预算项目排序：
   * 1. 还没完成的排在前面，已完成的排在后面
   * 2. 未完成之间按「计划金额」从大到小
   * 3. 已完成之间按「实际结算金额」从大到小
   */
  function sortedItems(month) {
    return month.items.slice().sort(function (a, b) {
      const aDone = a.status === 'completed' ? 1 : 0;
      const bDone = b.status === 'completed' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      const aAmount = aDone ? itemPaidAmount(a) : itemPlannedAmount(a);
      const bAmount = bDone ? itemPaidAmount(b) : itemPlannedAmount(b);
      const byAmount = Money.cents(bAmount) - Money.cents(aAmount);
      if (byAmount !== 0) return byAmount;
      if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }

  function sortedEntries(month) {
    return month.ledgerEntries.slice().sort(function (a, b) {
      const diff = new Date(b.date) - new Date(a.date);
      if (diff !== 0) return diff;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  /**
   * 预支排序：按日期从新到旧。
   */
  function sortedAdvances(month) {
    return month.advances.slice().sort(function (a, b) {
      const aSettled = advanceOutstanding(a) === 0 ? 1 : 0;
      const bSettled = advanceOutstanding(b) === 0 ? 1 : 0;
      if (aSettled !== bSettled) return aSettled - bSettled;
      const diff = new Date(b.date) - new Date(a.date);
      if (diff !== 0) return diff;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  // ---------------------------------------------------------------- 结余计算

  /**
   * 口径：
   *   实际剩余 = 本月账面部分 + 仍在卡里的跨月预留现金
   *   结余 = 实际剩余 − 预支待预留 − 当月未花预算
   *   超支 / 节省只做提示，不重复计入支出
   */
  function summarize(month, carryOver, now, incomingAdvances, pendingReservations, carriedAdvanceCash) {
    const reference = now || new Date();
    const items = month ? sortedItems(month) : [];
    const entries = month ? sortedEntries(month) : [];
    const advances = month ? sortedAdvances(month) : [];

    const income = Money.round(month ? month.income : 0);
    const carry = Money.round(carryOver || 0);
    const expenseEntries = entries.filter(function (e) { return e.direction !== 'income'; });
    const incomeEntries = entries.filter(function (e) { return e.direction === 'income'; });

    const plannedTotal = Money.sum(items.map(function (i) { return itemPlannedAmount(i, reference); }));
    const paidTotal = Money.sum(items.map(function (i) { return itemPaidAmount(i, reference); }));
    const remainingBudget = Money.sum(items.map(function (i) { return itemOutstandingPlan(i, reference); }));
    const overrunTotal = Money.sum(items.map(function (i) { return itemOverrun(i, reference); }));
    const savedTotal = Money.sum(items.map(function (i) { return itemSaved(i, reference); }));
    const ledgerTotal = Money.sum(expenseEntries.map(function (e) { return e.amount; }));
    const ledgerIncomeTotal = Money.sum(incomeEntries.map(function (e) { return e.amount; }));
    const advanceTotal = Money.sum(advances.map(function (a) { return a.amount; }));
    const advanceRepaidTotal = Money.sum(advances.map(function (a) { return a.repaidAmount; }));
    /* 本月登记的预支合计（含还没到扣款日的） */
    const advanceOutstandingTotal = Money.sum(advances.map(advanceOutstanding));
    /* 已经真的付出去了（付款日已到）：扣实际剩余也扣结余 */
    const advancePaidTotal = Money.sum(advances
      .filter(function (advance) { return advanceIsPaid(advance, reference); })
      .map(advanceOutstanding));
    /*
     * 还没到扣款日：像计划中的预算 —— 只占结余、不扣实际剩余。
     * 只对「目标月之前的月份」预留：
     * 例如 9 月为 11 月的开销预留 500，那么
     *   9 月、10 月：实际剩余里还有这 500（钱没花），但结余里要减掉它（是留给 11 月的）；
     *   11 月（就是给它预留的那个月）：不再减了，这 500 直接算在 11 月的实际剩余里，等它真正扣款。
     */
    const currentKey = month ? { year: month.year, month: month.month } : null;
    const isReservedForLaterMonth = function (advance) {
      if (advanceIsPaid(advance, reference)) return false;
      if (!currentKey) return false;
      return Month.compare(advanceTargetKey(advance), currentKey) > 0;
    };
    const reservedThisMonth = Money.sum(advances
      .filter(isReservedForLaterMonth)
      .map(advanceOutstanding));
    const pendingReservationTotal = Money.sum((pendingReservations || []).map(advanceOutstanding));
    const carriedCashAdvances = carriedAdvanceCash || pendingReservations || [];
    const carriedCashTotal = Money.sum(carriedCashAdvances.map(advanceOutstanding));
    const advanceReservedTotal = Money.round(reservedThisMonth + pendingReservationTotal);
    /*
     * 归属本月的预支（上个月替本月提前付掉的钱，只算已经真付出去的）。
     * 这笔钱要「加回」本月的可用额度：因为本月你可能还为它列了一条预算
     * （比如 10 月的车票），等那条预算记成已支付时会扣一次，
     * 这里的 +700 正好把它抵消掉，不会真的重复花钱。
     */
    const incoming = incomingAdvances || [];
    const advanceIncomingTotal = Money.sum(incoming
      .filter(function (advance) { return advanceIsPaid(advance, reference); })
      .map(advanceOutstanding));

    const recurringItems = items.map(function (item) { return recurrenceSchedule(item, reference); })
      .filter(function (schedule) { return !!schedule; });
    const recurringDailyTotal = Money.sum(recurringItems.map(function (s) { return s.dailyTotal; }));
    const recurringRemainingTotal = Money.sum(recurringItems.map(function (s) { return s.remainingAmount; }));
    const recurringSpentTotal = Money.sum(recurringItems.map(function (s) { return s.spentSoFar; }));

    const budgetByCategory = {};
    items.forEach(function (item) {
      budgetByCategory[item.category] = Money.round(
        (budgetByCategory[item.category] || 0) + itemPlannedAmount(item, reference)
      );
    });
    const ledgerByCategory = {};
    expenseEntries.forEach(function (entry) {
      ledgerByCategory[entry.category] = Money.round((ledgerByCategory[entry.category] || 0) + entry.amount);
    });

    const summary = {
      income: income,
      carryOver: carry,
      plannedTotal: plannedTotal,
      paidTotal: paidTotal,
      remainingBudget: remainingBudget,
      overrunTotal: overrunTotal,
      savedTotal: savedTotal,
      ledgerTotal: ledgerTotal,
      ledgerIncomeTotal: ledgerIncomeTotal,
      advanceTotal: advanceTotal,
      advanceRepaidTotal: advanceRepaidTotal,
      advanceOutstandingTotal: advanceOutstandingTotal,
      advancePaidTotal: advancePaidTotal,
      advanceReservedTotal: advanceReservedTotal,
      advanceReservedThisMonth: reservedThisMonth,
      /* 更早月份登记、至今还没到扣款日的预支（用于在归属月把它们列出来） */
      advanceCarriedReservations: carriedCashAdvances,
      advanceCarriedTotal: Money.round(carriedCashTotal),
      advancePendingCount: advances.filter(function (advance) {
        return !advanceIsPaid(advance, reference);
      }).length,
      advanceIncomingTotal: advanceIncomingTotal,
      advanceIncomingCount: incoming.length,
      advanceIncoming: incoming,
      itemCount: items.length,
      completedItemCount: items.filter(function (i) { return i.status === 'completed'; }).length,
      ledgerCount: entries.length,
      ledgerExpenseCount: expenseEntries.length,
      ledgerIncomeCount: incomeEntries.length,
      advanceCount: advances.length,
      recurringCount: recurringItems.length,
      recurringDailyTotal: recurringDailyTotal,
      recurringRemainingTotal: recurringRemainingTotal,
      recurringSpentTotal: recurringSpentTotal,
      budgetByCategory: budgetByCategory,
      ledgerByCategory: ledgerByCategory
    };

    /** 余额对账的调整额：把「漏记的钱」一次性补上。 */
    summary.reconciliationAdjustment = reconciliationAdjustment(month);
    /*
     * 更早月份留下、目前仍在卡里的预留现金要单列。它属于实际余额，
     * 但不是本月可以自由安排的结转；否则余额明细会把它混进「上月结转」，
     * 随后又在结余里减一次，看起来像重复计算。
     */
    summary.availableCarryOver = carry;
    summary.totalAvailable = Money.round(income + carry + ledgerIncomeTotal);
    /** 不含对账调整的账面余额，也是下次对账的基准。 */
    summary.balanceBeforeCarriedReservations = Money.round(
      income + summary.availableCarryOver + ledgerIncomeTotal + advanceIncomingTotal
      - paidTotal - ledgerTotal - advancePaidTotal
      + summary.reconciliationAdjustment
    );
    summary.actualBalance = Money.round(
      summary.balanceBeforeCarriedReservations + carriedCashTotal
    );
    summary.bookBalance = Money.round(summary.actualBalance - summary.reconciliationAdjustment);
    /**
     * 预算承诺额：每笔预算「按计划留、超支就按实际」，也就是 max(计划, 已付) 的合计。
     * 主结余 = 收入 + 结转 + 零星收入 − 预算承诺额 − 零星支出 − 预支未还。
     */
    summary.committedBudget = Money.sum(items.map(function (item) {
      return itemCommittedAmount(item, reference);
    }));
    summary.budgetBalance = Money.round(plannedTotal - paidTotal);
    /** 还没花掉的预算（已经花掉的之外，还要占着的钱），主结余和实际剩余的差额就是它。 */
    summary.unspentBudget = Money.round(summary.committedBudget - paidTotal);
    /**
     * 主结余只从实际剩余推导：先减跨月预支预留，再减当月未花预算。
     * 保持单一公式，避免新增余额来源后两套公式悄悄算出不同结果。
     */
    summary.plannedBalance = Money.round(
      summary.actualBalance - advanceReservedTotal - summary.unspentBudget
    );
    summary.totalSpending = Money.round(paidTotal + ledgerTotal + advancePaidTotal);
    summary.budgetProgress = Math.min(1.5, Math.max(0, Money.ratio(paidTotal, plannedTotal)));
    summary.spendingRatio = Math.min(1.5, Math.max(0, Money.ratio(summary.totalSpending, summary.totalAvailable)));
    summary.isOverBudget = summary.budgetBalance < 0;
    summary.isBalanceNegative = summary.plannedBalance < 0;
    summary.isCashNegative = summary.actualBalance < 0;
    summary.reconciliationCount = (month && month.reconciliations ? month.reconciliations.length : 0);
    summary.lastReconciliation = (month && month.reconciliations && month.reconciliations.length > 0)
      ? month.reconciliations[month.reconciliations.length - 1]
      : null;
    summary.isEmpty = items.length === 0 && entries.length === 0 && advances.length === 0
      && summary.reconciliationCount === 0 && income === 0;
    return summary;
  }

  // ---------------------------------------------------------------- 数据仓库

  /**
   * 所有读写入口。onChanged 回调用于持久化（浏览器里存 localStorage）。
   */
  function createStore(initialState, options) {
    const opts = options || {};
    let state = initialState ? normalizeState(initialState) : defaultState();

    function normalizeState(raw) {
      return {
        version: raw.version || 1,
        settings: Object.assign(defaultSettings(), raw.settings || {}),
        months: (raw.months || []).map(createMonth)
      };
    }

    function commit() {
      if (typeof opts.onChanged === 'function') opts.onChanged(state);
    }

    function findMonth(key) {
      return state.months.find(function (m) { return m.year === key.year && m.month === key.month; }) || null;
    }

    function ensureMonth(key) {
      const existing = findMonth(key);
      if (existing) return existing;
      const created = createMonth({
        year: key.year,
        month: key.month,
        income: Math.max(0, state.settings.defaultMonthlyIncome || 0)
      });
      state.months.push(created);
      commit();
      return created;
    }

    function mutateMonth(key, mutator) {
      const month = ensureMonth(key);
      mutator(month);
      month.updatedAt = new Date().toISOString();
      commit();
      return month;
    }

    /**
     * 更早月份登记的预支里，还需要在本月预留的那部分：
     * 钱没真出去、而且它的目标月还在本月之后（到了目标月就不再预留了）。
     */
    function pendingReservationsFor(key, now) {
      const result = [];
      state.months.forEach(function (month) {
        const monthKey = { year: month.year, month: month.month };
        if (Month.compare(monthKey, key) >= 0) return;
        month.advances.forEach(function (advance) {
          if (advanceIsPaid(advance, now)) return;
          if (Month.compare(advanceTargetKey(advance), key) > 0) result.push(advance);
        });
      });
      return result;
    }

    /**
     * 更早月份留下、至今仍未支付的跨月现金：目标月份也要继续单独带入。
     * 到目标月时它不再是「未来预留」，但仍然是之前留给本月使用的现金。
     */
    function carriedAdvanceCashFor(key, now) {
      const result = [];
      state.months.forEach(function (month) {
        const monthKey = { year: month.year, month: month.month };
        if (Month.compare(monthKey, key) >= 0) return;
        month.advances.forEach(function (advance) {
          if (advanceIsPaid(advance, now)) return;
          if (Month.compare(advanceTargetKey(advance), key) >= 0) result.push(advance);
        });
      });
      return result;
    }

    /** 上个月替本月提前付掉的预支（归属月份是本月）。 */
    function incomingAdvancesFor(key) {
      const result = [];
      state.months.forEach(function (month) {
        const monthKey = { year: month.year, month: month.month };
        // 只看登记时间更早的月份：谁提前替你付了，就由谁在归属月里抵回来
        if (Month.compare(monthKey, key) >= 0) return;
        month.advances.forEach(function (advance) {
          if (Month.equals(advanceTargetKey(advance), key)) result.push(advance);
        });
      });
      return result;
    }

    const store = {
      get state() { return state; },

      get settings() { return state.settings; },

      replaceState(nextState) {
        state = normalizeState(nextState);
        commit();
      },

      reset(keepSettings) {
        const settings = keepSettings === false ? defaultSettings() : state.settings;
        state = { version: 1, settings: settings, months: [] };
        commit();
      },

      // ---- 设置

      setDefaultIncome(amount) {
        state.settings.defaultMonthlyIncome = Money.round(Math.max(0, amount || 0));
        commit();
      },

      setCarryOverEnabled(enabled) {
        state.settings.carryOverEnabled = !!enabled;
        commit();
      },

      markSampleDataSeeded() {
        state.settings.seededSampleData = true;
        commit();
      },

      /** 记下「刚刚导出过备份」，用于备份提醒 */
      markBackupTaken(now) {
        state.settings.lastBackupAt = (now instanceof Date ? now : new Date()).toISOString();
        commit();
      },

      // ---- 账期

      month: findMonth,

      months() {
        return state.months.slice().sort(function (a, b) {
          return Month.compare({ year: b.year, month: b.month }, { year: a.year, month: a.month });
        });
      },

      monthKeys() {
        return store.months().map(function (m) { return { year: m.year, month: m.month }; });
      },

      ensureMonth: ensureMonth,

      setIncome(amount, key) {
        mutateMonth(key, function (month) {
          month.income = Money.round(Math.max(0, amount || 0));
        });
      },

      setCarryOverOverride(amount, key) {
        mutateMonth(key, function (month) {
          month.carryOverOverride = amount === null || amount === undefined ? null : Money.round(amount);
        });
      },

      setNote(note, key) {
        mutateMonth(key, function (month) {
          month.note = note || '';
        });
      },

      deleteMonth(key) {
        state.months = state.months.filter(function (m) {
          return !(m.year === key.year && m.month === key.month);
        });
        commit();
      },

      // ---- 结转与汇总

      carryOver(key, visited, now) {
        const seen = visited || [];
        if (seen.some(function (k) { return Month.equals(k, key); })) return 0;
        const month = findMonth(key);
        // 手动填的结转金额永远优先，跟「自动结转」开关无关
        if (month && month.carryOverOverride !== null && month.carryOverOverride !== undefined) {
          return Money.round(month.carryOverOverride);
        }
        // 关掉自动结转就不再自动带上一月的结余（手动填的上面已经处理了）
        if (!state.settings.carryOverEnabled) return 0;
        const previous = Month.prev(key);
        if (!findMonth(previous)) return 0;
        const previousPending = pendingReservationsFor(previous, now);
        const previousCarriedCash = carriedAdvanceCashFor(previous, now);
        const previousBalance = summarize(
          findMonth(previous),
          store.carryOver(previous, seen.concat([key]), now),
          now,
          incomingAdvancesFor(previous),
          previousPending,
          previousCarriedCash
        ).actualBalance;
        /*
         * 仍在预留中的跨月现金由 summary 单独带入，不能再混进普通结转。
         * 到目标月份后它不再预留，会自然回到普通结转中。
         */
        const carriedSeparately = Money.sum(
          carriedAdvanceCashFor(key, now).map(advanceOutstanding)
        );
        return Money.round(previousBalance - carriedSeparately);
      },

      summary(key, now) {
        const month = findMonth(key);
        const incoming = incomingAdvancesFor(key);
        const pending = pendingReservationsFor(key, now);
        const carriedCash = carriedAdvanceCashFor(key, now);
        if (!month) {
          return summarize(null, 0, now, incoming, pending, carriedCash);
        }
        return summarize(month, store.carryOver(key, [], now), now, incoming, pending, carriedCash);
      },

      recentSummaries(count, endingAt, now) {
        const result = [];
        let cursor = endingAt;
        for (let i = 0; i < count; i += 1) {
          result.unshift({ key: cursor, summary: store.summary(cursor, now) });
          cursor = Month.prev(cursor);
        }
        return result;
      },

      // ---- 预算项目

      items(key) {
        const month = findMonth(key);
        return month ? sortedItems(month) : [];
      },

      item(id, key) {
        const month = findMonth(key);
        if (!month) return null;
        return month.items.find(function (i) { return i.id === id; }) || null;
      },

      addItem(input, key) {
        let created = null;
        mutateMonth(key, function (month) {
          const sortIndex = month.items.reduce(function (max, item) {
            return Math.max(max, item.sortIndex || 0);
          }, -1) + 1;
          created = createItem(Object.assign({}, input, {
            plannedAmount: Math.max(0, input.plannedAmount || 0),
            sortIndex: sortIndex
          }));
          month.items.push(created);
        });
        return created;
      },

      updateItem(id, input, key) {
        mutateMonth(key, function (month) {
          const item = month.items.find(function (i) { return i.id === id; });
          if (!item) return;
          if (input.name !== undefined) item.name = input.name;
          if (input.category !== undefined) item.category = input.category;
          if (input.plannedAmount !== undefined) item.plannedAmount = Money.round(Math.max(0, input.plannedAmount || 0));
          if (input.dueDate !== undefined) item.dueDate = input.dueDate;
          if (input.note !== undefined) item.note = input.note;
          if (input.recurrence !== undefined) item.recurrence = normalizeRecurrence(input.recurrence);
          item.updatedAt = new Date().toISOString();
        });
      },

      completeItem(id, actualAmount, key, date) {
        mutateMonth(key, function (month) {
          const item = month.items.find(function (i) { return i.id === id; });
          if (!item) return;
          item.actualAmount = actualAmount === null || actualAmount === undefined
            ? null
            : Money.round(Math.max(0, actualAmount));
          item.status = 'completed';
          item.settledAt = date || new Date().toISOString();
          item.updatedAt = new Date().toISOString();
        });
      },

      reopenItem(id, key) {
        mutateMonth(key, function (month) {
          const item = month.items.find(function (i) { return i.id === id; });
          if (!item) return;
          item.status = 'planned';
          item.actualAmount = null;
          item.settledAt = null;
          item.updatedAt = new Date().toISOString();
        });
      },

      /**
       * 记一笔付款（分次结算）。加起来够计划金额时自动标记完成。
       * 返回这笔付款和付款后的状态，方便界面给出提示。
       */
      addItemPayment(id, input, key) {
        let payment = null;
        let finished = false;
        let remaining = 0;
        mutateMonth(key, function (month) {
          const item = month.items.find(function (i) { return i.id === id; });
          if (!item) return;
          payment = createPayment(input);
          payment.amount = Money.round(Math.max(0, payment.amount));
          item.payments.push(payment);
          const planned = itemPlannedAmount(item, new Date());
          const paid = itemPaymentsTotal(item);
          remaining = Math.max(0, Money.round(planned - paid));
          if (remaining === 0) {
            item.status = 'completed';
            item.settledAt = item.settledAt || payment.date;
            finished = true;
          }
          item.updatedAt = new Date().toISOString();
        });
        return { payment: payment, finished: finished, remaining: remaining };
      },

      deleteItemPayment(id, paymentId, key) {
        mutateMonth(key, function (month) {
          const item = month.items.find(function (i) { return i.id === id; });
          if (!item) return;
          item.payments = item.payments.filter(function (payment) { return payment.id !== paymentId; });
          item.updatedAt = new Date().toISOString();
        });
      },

      /** 手动把项目标记成已完成（剩下的钱不打算再花了）。 */
      markItemCompleted(id, key) {
        mutateMonth(key, function (month) {
          const item = month.items.find(function (i) { return i.id === id; });
          if (!item) return;
          item.status = 'completed';
          item.settledAt = item.settledAt || new Date().toISOString();
          item.updatedAt = new Date().toISOString();
        });
      },

      deleteItem(id, key) {
        mutateMonth(key, function (month) {
          month.items = month.items.filter(function (i) { return i.id !== id; });
        });
      },

      /** 把上个月的预算项目复制过来（重置为计划中），返回复制条数。 */
      copyItemsFrom(source, target) {
        if (Month.equals(source, target)) return 0;
        const sourceMonth = findMonth(source);
        if (!sourceMonth) return 0;
        const targetMonth = ensureMonth(target);
        const existing = {};
        targetMonth.items.forEach(function (i) { existing[i.name] = true; });
        let copied = 0;
        sortedItems(sourceMonth).forEach(function (item) {
          if (existing[item.name]) return;
          store.addItem({
            name: item.name,
            category: item.category,
            plannedAmount: item.plannedAmount,
            note: item.note
          }, target);
          existing[item.name] = true;
          copied += 1;
        });
        return copied;
      },

      /**
       * 生活费每日结算：填某一天实际花了多少（可以比计划少，也可以比计划多）。
       * 传 null 表示取消这条记录，恢复成按计划推算。
       */
      setRecurringDayActual(itemId, dayKey, amount, key) {
        mutateMonth(key, function (month) {
          const item = month.items.find(function (i) { return i.id === itemId; });
          if (!item || !isRecurring(item)) return;
          const overrides = Object.assign({}, item.recurrence.overrides || {});
          if (amount === null || amount === undefined) {
            delete overrides[dayKey];
          } else {
            overrides[dayKey] = Money.round(Math.max(0, amount));
          }
          item.recurrence = normalizeRecurrence(Object.assign({}, item.recurrence, { overrides: overrides }));
          // 整笔金额也跟着更新，方便外部（导出、旧接口）读
          const schedule = recurrenceSchedule({ recurrence: item.recurrence, plannedAmount: 0, status: 'planned' }, new Date());
          if (schedule) item.plannedAmount = schedule.plannedAmount;
          item.updatedAt = new Date().toISOString();
        });
      },

      /** 结算「今天」的生活费，amount 为今天的实际花费。 */
      settleTodayActual(itemId, amount, key) {
        store.setRecurringDayActual(itemId, dayString(new Date()), amount, key);
      },

      // ---- 余额对账

      /**
       * 余额对账：填入「现在实际有多少钱」，App 把差额记成一笔调整，
       * 于是结余 / 实际剩余会对上你填的数字。多次对账只保留最后一次的调整额。
       */
      reconcile(enteredBalance, key, note) {
        store.ensureMonth(key);
        const bookBalance = store.summary(key).bookBalance;
        const entered = Money.round(Math.max(0, enteredBalance || 0));
        const difference = Money.round(entered - bookBalance);
        let record = null;
        mutateMonth(key, function (month) {
          record = createReconciliation({
            enteredBalance: entered,
            bookBalance: bookBalance,
            difference: difference,
            note: note || ''
          });
          month.reconciliations.push(record);
        });
        return record;
      },

      /** 撤销最后一次对账，返回被撤销的记录。 */
      undoReconciliation(key) {
        let removed = null;
        mutateMonth(key, function (month) {
          removed = month.reconciliations.pop() || null;
        });
        return removed;
      },

      clearReconciliations(key) {
        mutateMonth(key, function (month) {
          month.reconciliations = [];
        });
      },

      /** 对账历史，最新的在前。 */
      reconciliations(key) {
        const month = findMonth(key);
        if (!month) return [];
        return month.reconciliations.slice().reverse();
      },

      // ---- 零星记账

      entries(key) {
        const month = findMonth(key);
        return month ? sortedEntries(month) : [];
      },

      entry(id, key) {
        const month = findMonth(key);
        if (!month) return null;
        return month.ledgerEntries.find(function (e) { return e.id === id; }) || null;
      },

      ledgerGroups(key) {
        const groups = [];
        const index = {};
        store.entries(key).forEach(function (entry) {
          const d = new Date(entry.date);
          const dayKey = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
          if (!index[dayKey]) {
            index[dayKey] = { date: d, entries: [] };
            groups.push(index[dayKey]);
          }
          index[dayKey].entries.push(entry);
        });
        return groups.map(function (group) {
          const expenses = group.entries.filter(function (e) { return e.direction !== 'income'; });
          const incomes = group.entries.filter(function (e) { return e.direction === 'income'; });
          const expenseTotal = Money.sum(expenses.map(function (e) { return e.amount; }));
          const incomeTotal = Money.sum(incomes.map(function (e) { return e.amount; }));
          return {
            date: group.date,
            entries: group.entries,
            total: expenseTotal,
            expenseTotal: expenseTotal,
            incomeTotal: incomeTotal
          };
        });
      },

      addEntry(input, key) {
        let created = null;
        mutateMonth(key, function (month) {
          created = createEntry(input);
          month.ledgerEntries.push(created);
        });
        return created;
      },

      updateEntry(id, input, key) {
        mutateMonth(key, function (month) {
          const entry = month.ledgerEntries.find(function (e) { return e.id === id; });
          if (!entry) return;
          if (input.title !== undefined) entry.title = input.title;
          if (input.amount !== undefined) entry.amount = Money.round(input.amount || 0);
          if (input.category !== undefined) entry.category = input.category;
          if (input.direction !== undefined) entry.direction = input.direction === 'income' ? 'income' : 'expense';
          if (input.date !== undefined) entry.date = input.date;
          if (input.note !== undefined) entry.note = input.note;
          entry.updatedAt = new Date().toISOString();
        });
      },

      deleteEntry(id, key) {
        mutateMonth(key, function (month) {
          month.ledgerEntries = month.ledgerEntries.filter(function (e) { return e.id !== id; });
        });
      },

      // ---- 预支

      advances(key) {
        const month = findMonth(key);
        return month ? sortedAdvances(month) : [];
      },

      advance(id, key) {
        const month = findMonth(key);
        if (!month) return null;
        return month.advances.find(function (a) { return a.id === id; }) || null;
      },

      addAdvance(input, key) {
        let created = null;
        const defaultTarget = Month.next(key);
        mutateMonth(key, function (month) {
          created = createAdvance(Object.assign({
            targetYear: defaultTarget.year,
            targetMonth: defaultTarget.month
          }, input));
          created.amount = Money.round(Math.max(0, created.amount));
          month.advances.push(created);
        });
        return created;
      },

      updateAdvance(id, input, key) {
        mutateMonth(key, function (month) {
          const advance = month.advances.find(function (a) { return a.id === id; });
          if (!advance) return;
          if (input.title !== undefined) advance.title = input.title;
          if (input.amount !== undefined) advance.amount = Money.round(Math.max(0, input.amount || 0));
          if (input.date !== undefined) advance.date = input.date;
          if (input.note !== undefined) advance.note = input.note;
          if (input.targetYear !== undefined) advance.targetYear = input.targetYear;
          if (input.targetMonth !== undefined) advance.targetMonth = input.targetMonth;
          if (input.paidOverride !== undefined) {
            advance.paidOverride = typeof input.paidOverride === 'boolean' ? input.paidOverride : null;
          }
          if (advance.repaidAmount > advance.amount) advance.repaidAmount = advance.amount;
          advance.updatedAt = new Date().toISOString();
        });
      },

      deleteAdvance(id, key) {
        mutateMonth(key, function (month) {
          month.advances = month.advances.filter(function (a) { return a.id !== id; });
        });
      },

      // ---- 导出

      toJSON() {
        return JSON.stringify(state, null, 2);
      },

      loadJSON(text) {
        try {
          const parsed = typeof text === 'string' ? JSON.parse(text) : text;
          if (!parsed || !Array.isArray(parsed.months)) return false;
          store.replaceState(parsed);
          return true;
        } catch (error) {
          return false;
        }
      },

      exportCSV() {
        const rows = [['月份', '类型', '名称', '分类', '金额', '实际支付', '状态', '日期', '备注']];
        const dateText = function (value) {
          if (!value) return '';
          const d = new Date(value);
          return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        };
        store.months().slice().reverse().forEach(function (month) {
          const key = { year: month.year, month: month.month };
          sortedItems(month).forEach(function (item) {
            const paidAmount = itemPaidAmount(item);
            rows.push([
              Month.label(key), '预算', item.name, categoryLabel(item.category),
              Money.csv(item.plannedAmount),
              paidAmount > 0 ? Money.csv(paidAmount) : '',
              item.status === 'completed' ? '已完成' : (paidAmount > 0 ? '部分已付' : '计划中'),
              dateText(item.settledAt), item.note
            ]);
          });
          sortedEntries(month).forEach(function (entry) {
            rows.push([
              Month.label(key),
              entry.direction === 'income' ? '零星收入' : '零星记账',
              entry.title, categoryLabel(entry.category),
              Money.csv(entry.amount), '',
              entry.direction === 'income' ? '已收' : '已花',
              dateText(entry.date), entry.note
            ]);
          });
          sortedAdvances(month).forEach(function (advance) {
            const target = advanceTargetKey(advance);
            rows.push([
              Month.label(key), '预支', advance.title, '归属 ' + Month.label(target),
              Money.csv(advance.amount), Money.csv(advance.repaidAmount),
              advanceIsPaid(advance, new Date()) ? '已支付' : '待预留',
              dateText(advance.date), advance.note
            ]);
          });
          (month.reconciliations || []).forEach(function (record) {
            rows.push([
              Month.label(key), '对账调整', '按实际余额校正', '',
              Money.csv(Math.abs(record.difference)), '',
              record.difference < 0 ? '补记支出' : (record.difference > 0 ? '补记收入' : '无差额'),
              dateText(record.createdAt),
              '填入实际余额 ' + Money.csv(record.enteredBalance) + (record.note ? ' · ' + record.note : '')
            ]);
          });
        });
        return rows.map(function (row) {
          return row.map(function (cell) {
            const text = cell === null || cell === undefined ? '' : String(cell);
            return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
          }).join(',');
        }).join('\n') + '\n';
      }
    };

    return store;
  }

  // ---------------------------------------------------------------- 示例数据

  const SampleData = {
    seed(store, key, now) {
      const reference = now || new Date();
      const target = key || Month.current();
      store.ensureMonth(target);
      store.setIncome(8000, target);

      [
        ['房租', 'housing', 2500, 2500],
        ['水电燃气', 'utilities', 300, 268],
        ['交通', 'transport', 300, 240],
        ['话费宽带', 'communication', 120, null],
        ['健身', 'entertainment', 200, 258],
        ['父母生活费', 'family', 1000, null]
      ].forEach(function (row) {
        const item = store.addItem({ name: row[0], category: row[1], plannedAmount: row[2] }, target);
        if (row[3] !== null) store.completeItem(item.id, row[3], target);
      });

      // 按天重复的生活费：2 个人，每人每天 35 元
      const dailyAmounts = [35, 35];
      const rangeStart = dayString(Month.startDate(target));
      const rangeEnd = dayString(new Date(target.year, target.month - 1, Month.dayCount(target)));
      const livingItem = store.addItem({
        name: '生活费',
        category: 'family',
        plannedAmount: Money.round(Money.sum(dailyAmounts) * Month.dayCount(target)),
        note: '按天自动计算',
        recurrence: { type: 'daily', amounts: dailyAmounts, startDate: rangeStart, endDate: rangeEnd }
      }, target);

      // 已经过去的日子给两条「每日结算」示例：一天省了点，一天超了点
      const dayKeyOf = function (day) { return dayString(new Date(target.year, target.month - 1, day)); };
      const isPast = function (day) {
        return new Date(target.year, target.month - 1, day, 23, 59, 0) < reference;
      };
      if (isPast(2)) store.setRecurringDayActual(livingItem.id, dayKeyOf(2), 60, target);
      if (isPast(4)) store.setRecurringDayActual(livingItem.id, dayKeyOf(4), 90, target);

      const start = Month.startDate(target);
      [
        ['奶茶 + 咖啡', 62, 'food', 3],
        ['同事下午茶', 45, 'social', 5],
        ['打车加班回家', 38, 'transport', 8],
        ['感冒药', 56, 'medical', 11],
        ['视频会员', 25, 'entertainment', 12]
      ].forEach(function (row) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + row[3], 12, 0, 0);
        store.addEntry({ title: row[0], amount: row[1], category: row[2], date: date.toISOString() }, target);
      });

      store.addEntry({
        title: '闲置物品卖出',
        amount: 120,
        category: 'other',
        direction: 'income',
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 12, 0, 0).toISOString()
      }, target);

      store.addAdvance({
        title: '下个月的车票',
        amount: 700,
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0).toISOString(),
        note: '提前买好'
      }, target);
    },

    seedIfNeeded(store, key) {
      if (store.settings.seededSampleData) return false;
      SampleData.seed(store, key);
      store.markSampleDataSeeded();
      return true;
    }
  };

  return {
    VERSION: VERSION,
    Money: Money,
    Month: Month,
    Categories: Categories,
    categoryOf: categoryOf,
    categoryLabel: categoryLabel,
    categoryIcon: categoryIcon,
    createStore: createStore,
    summarize: summarize,
    defaultState: defaultState,
    defaultSettings: defaultSettings,
    daysSinceBackup: daysSinceBackup,
    needsBackup: needsBackup,
    reconciliationAdjustment: reconciliationAdjustment,
    isRecurring: isRecurring,
    recurrenceSchedule: recurrenceSchedule,
    itemPlannedAmount: itemPlannedAmount,
    itemPaidAmount: itemPaidAmount,
    itemCommittedAmount: itemCommittedAmount,
    itemOutstandingPlan: itemOutstandingPlan,
    itemOverrun: itemOverrun,
    itemSaved: itemSaved,
    itemPaymentsTotal: itemPaymentsTotal,
    sortedPayments: sortedPayments,
    advanceOutstanding: advanceOutstanding,
    advanceIsPaid: advanceIsPaid,
    advanceTargetKey: advanceTargetKey,
    dayString: dayString,
    sortedItems: sortedItems,
    sortedEntries: sortedEntries,
    sortedAdvances: sortedAdvances,
    SampleData: SampleData
  };
});
