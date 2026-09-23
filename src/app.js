/*
 * 月账本 · 界面层
 * 依赖 core.js 暴露的 window.BudgetCore；数据保存在浏览器 localStorage。
 */
(function () {
  'use strict';

  const core = window.BudgetCore;
  const { Money, Month, Categories, categoryLabel, categoryIcon } = core;

  const STORAGE_KEY = 'monthly-budget-state-v1';
  const $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------- 持久化

  let storageAvailable = true;

  function detectStorage() {
    try {
      window.localStorage.setItem('__budget_probe__', '1');
      window.localStorage.removeItem('__budget_probe__');
      return true;
    } catch (error) {
      return false;
    }
  }

  storageAvailable = detectStorage();

  function readInitialState() {
    if (!storageAvailable) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  const store = core.createStore(readInitialState(), {
    onChanged: function (state) {
      if (!storageAvailable) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (error) {
        storageAvailable = false;
        renderStorageBanner();
      }
    }
  });

  // ---------------------------------------------------------------- 界面状态

  let currentKey = Month.current();
  let activeTab = 'budget';
  let sheetState = null;

  const urlParams = new URLSearchParams(window.location.search);
  if (['budget', 'ledger', 'advance'].indexOf(urlParams.get('tab')) >= 0) {
    activeTab = urlParams.get('tab');
  }
  // ?month=2026-10 用于演示/截图：直接看某个月
  if (/^\d{4}-\d{2}$/.test(urlParams.get('month') || '')) {
    currentKey = Month.fromKey(urlParams.get('month'));
  }

  store.ensureMonth(currentKey);

  // ---------------------------------------------------------------- 工具

  function esc(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function todayISO() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  function toDateInputValue(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fromDateInputValue(value, fallbackISO) {
    if (!value) return fallbackISO || new Date().toISOString();
    const parts = String(value).split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  function dayText(value) {
    const d = new Date(value);
    const label = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    const today = new Date();
    const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return label + ' ' + weekday + (isToday ? ' · 今天' : '');
  }

  /** '2026-09-01' → '9月1日 周二' */
  function dayLabel(dayKey) {
    const parts = String(dayKey).split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + weekday;
  }

  let toastTimer = null;
  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.classList.remove('hidden');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { node.classList.add('hidden'); }, 1900);
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /** 备份文件名：默认固定名字，方便在「文件」里覆盖同一个文件 */
  function backupFileName(withDate) {
    return withDate ? '月账本备份-' + fileStamp() + '.json' : '月账本备份.json';
  }

  // ---- 记住「上次保存到哪个文件」，下次直接覆盖，不再产生 (2)(3) ----

  function openHandleDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no-indexeddb')); return; }
      const request = window.indexedDB.open('monthly-budget', 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains('handles')) {
          request.result.createObjectStore('handles');
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function handleStore(action) {
    return openHandleDatabase().then(function (db) {
      return new Promise(function (resolve) {
        const tx = db.transaction('handles', action === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('handles');
        if (action === 'get') {
          const get = store.get('backup');
          get.onsuccess = function () { resolve(get.result || null); };
          get.onerror = function () { resolve(null); };
        } else {
          store.put(action.handle, 'backup');
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        }
      });
    }).catch(function () { return action === 'get' ? null : false; });
  }

  /**
   * 桌面 Chrome/Edge：写进你选定的那个文件，直接覆盖，不会多出 (2)(3)。
   * 返回 'saved'（已写入）/ 'cancelled'（用户取消）/ 'unavailable'（浏览器不支持或失败）
   */
  function exportJSONToPickedFile(name, text) {
    if (typeof window.showSaveFilePicker !== 'function') return Promise.resolve('unavailable');
    const writeTo = function (handle) {
      return handle.createWritable().then(function (writable) {
        return writable.write(text).then(function () { return writable.close(); });
      }).then(function () { return 'saved'; }).catch(function () { return 'unavailable'; });
    };
    return handleStore('get').then(function (handle) {
      if (!handle) {
        return window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'JSON 备份', accept: { 'application/json': ['.json'] } }]
        }).then(function (picked) {
          return handleStore({ handle: picked }).then(function () { return writeTo(picked); });
        }).catch(function (error) {
          return isCancelled(error) ? 'cancelled' : 'unavailable';
        });
      }
      return handle.queryPermission({ mode: 'readwrite' }).then(function (permission) {
        if (permission === 'granted') return writeTo(handle);
        return handle.requestPermission({ mode: 'readwrite' }).then(function (next) {
          return next === 'granted' ? writeTo(handle) : 'unavailable';
        });
      }).catch(function () { return 'unavailable'; })
        .then(function (result) {
          if (result !== 'unavailable') return result;
          // 文件被删掉或权限失效：重新选一次
          return window.showSaveFilePicker({
            suggestedName: name,
            types: [{ description: 'JSON 备份', accept: { 'application/json': ['.json'] } }]
          }).then(function (picked) {
            return handleStore({ handle: picked }).then(function () { return writeTo(picked); });
          }).catch(function (error) {
            return isCancelled(error) ? 'cancelled' : 'unavailable';
          });
        });
    }).catch(function () { return 'unavailable'; });
  }

  /**
   * 手机：走系统分享面板，「存储到文件」时 iOS 会问「替换 / 保留两者」，选替换就是覆盖。
   * 返回 'saved' / 'cancelled' / 'unavailable'
   */
  function exportJSONViaShare(name, text) {
    if (typeof File !== 'function' || !navigator.canShare || !navigator.share) return Promise.resolve('unavailable');
    let file = null;
    try {
      file = new File([text], name, { type: 'application/json' });
    } catch (error) {
      return Promise.resolve('unavailable');
    }
    if (!navigator.canShare({ files: [file] })) return Promise.resolve('unavailable');
    return navigator.share({ files: [file], title: '月账本备份' }).then(function () {
      return 'saved';
    }).catch(function (error) {
      return isCancelled(error) ? 'cancelled' : 'unavailable';
    });
  }

  function isCancelled(error) {
    return !!error && (error.name === 'AbortError' || error.name === 'NotAllowedError');
  }

  /** 只有真实的用户点击才会激活系统级文件选择器/分享面板 */
  function userHasActivation() {
    return !navigator.userActivation || navigator.userActivation.isActive !== false;
  }

  function isHandheld() {
    return (navigator.maxTouchPoints || 0) > 0 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  }

  /**
   * 导出备份。默认用固定文件名，尽力做到「覆盖上一次的文件」：
   * 手机 → 系统分享面板（选「替换」）；电脑 → 文件选择器（选一次后自动覆盖）。
   */
  function exportBackup(withDate) {
    const name = backupFileName(withDate);
    const text = store.toJSON();

    const fallback = function () {
      download(name, text, 'application/json;charset=utf-8');
      store.markBackupTaken();
      toast('已导出：' + name + '（可在「文件」里替换旧文件）');
      render();
    };

    if (withDate) { fallback(); return; }

    const finishSaved = function (message) {
      store.markBackupTaken();
      toast(message);
      render();
    };

    // 没有真实点击（例如自动化环境）时，直接走普通下载，避免弹不出来的系统对话框
    if (!userHasActivation()) { fallback(); return; }

    if (isHandheld()) {
      exportJSONViaShare(name, text).then(function (shareResult) {
        if (shareResult === 'saved') {
          finishSaved('备份已保存（同名文件可在「文件」里选替换）');
          return;
        }
        if (shareResult === 'cancelled') return;   // 用户取消，什么都不做
        fallback();
      });
      return;
    }

    exportJSONToPickedFile(name, text).then(function (result) {
      if (result === 'saved') {
        finishSaved('已覆盖保存到 ' + name);
        return;
      }
      if (result === 'cancelled') return;
      fallback();
    });
  }

  function fileStamp() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** 离线缓存状态，用于设置面板里给用户一个交代 */
  function offlineStateText() {
    if (!('serviceWorker' in navigator)) return '当前浏览器不支持';
    if (!/^https?:$/.test(window.location.protocol)) return '用网页地址打开后会缓存';
    return navigator.serviceWorker.controller ? '已缓存，断网也能用 ✓' : '首次打开后自动缓存';
  }

  function backupAgeText(now) {
    const days = core.daysSinceBackup(store.settings, now || new Date());
    if (!Number.isFinite(days)) return '还没备份过';
    if (days === 0) return '今天';
    return days + ' 天前';
  }

  // ---------------------------------------------------------------- 渲染

  function render() {
    renderHeader();
    renderHero();
    renderTiles();
    renderProgress();
    renderTabs();
    renderList();
    renderStorageBanner();
    renderBackupBanner();
  }

  /** 备份提醒：手机上的浏览器存储有可能被系统清掉，定期导出一次最保险。 */
  function renderBackupBanner() {
    const node = $('backupBanner');
    const days = core.daysSinceBackup(store.settings, new Date());
    if (!core.needsBackup(store.settings, new Date())) {
      node.classList.add('hidden');
      return;
    }
    const text = !Number.isFinite(days)
      ? '还没导出过备份。浏览器上的数据可能被系统清理，建议导出一份存到「文件」。'
      : '已经 ' + days + ' 天没备份了，建议导出一份存到「文件」。';
    $('backupBannerText').textContent = text;
    node.classList.remove('hidden');
  }

  function backupNow() {
    exportBackup(false);
  }

  function renderHeader() {
    $('monthLabel').textContent = Month.label(currentKey);
    const isCurrent = Month.equals(currentKey, Month.current());
    $('todayBtn').classList.toggle('hidden', isCurrent);
  }

  function renderStorageBanner() {
    const node = $('storageBanner');
    if (storageAvailable) {
      node.classList.add('hidden');
      return;
    }
    node.textContent = '当前浏览器不允许本地保存（可能是隐私模式）。请用「设置 → 导出备份」保存数据。';
    node.classList.remove('hidden');
  }

  function renderHero() {
    const summary = store.summary(currentKey);
    const hero = $('hero');
    hero.classList.toggle('negative', summary.isBalanceNegative);
    $('heroLabel').textContent = Month.label(currentKey) + ' 结余（已扣预算）';
    $('heroValue').textContent = Money.format(summary.plannedBalance);
    $('heroSub').innerHTML =
      '<span>收入 <strong>' + Money.format(summary.income) + '</strong></span>' +
      (summary.carryOver !== 0 ? '<span>上月结转 <strong>' + Money.format(summary.carryOver) + '</strong></span>' : '') +
      (summary.ledgerIncomeTotal > 0 ? '<span>零星收入 <strong>' + Money.format(summary.ledgerIncomeTotal) + '</strong></span>' : '') +
      '<span>预算 <strong>−' + Money.format(summary.plannedTotal) + '</strong></span>' +
      (summary.overrunTotal > 0 ? '<span>超支 <strong>−' + Money.format(summary.overrunTotal) + '</strong></span>' : '') +
      (summary.ledgerTotal > 0 ? '<span>零星支出 <strong>−' + Money.format(summary.ledgerTotal) + '</strong></span>' : '') +
      (summary.advancePaidTotal > 0 ? '<span>预支 <strong>−' + Money.format(summary.advancePaidTotal) + '</strong></span>' : '') +
      (summary.advanceReservedTotal > 0 ? '<span>预支待预留 <strong>−' + Money.format(summary.advanceReservedTotal) + '</strong></span>' : '') +
      (summary.advanceIncomingTotal > 0
        ? '<span>上月已付预支 <strong>' + Money.format(summary.advanceIncomingTotal) + '</strong>（不用再列预算）</span>'
        : '');
  }

  function tile(label, value, hint, tone, action) {
    return '<div class="tile ' + (tone || '') + '">' +
      '<div class="tile-label">' + label + '</div>' +
      '<div class="tile-value">' + value + '</div>' +
      (hint ? '<div class="tile-hint">' + hint + '</div>' : '') +
      (action ? '<button class="mini-btn ghost tile-action" data-reconcile="1">' + action + '</button>' : '') +
      '</div>';
  }

  function renderTiles() {
    const s = store.summary(currentKey);
    const tiles = [];

    tiles.push(tile(
      '预算计划',
      Money.format(s.plannedTotal),
      s.itemCount === 0 ? '还没有预算项目' : ('已完成 ' + s.completedItemCount + ' / ' + s.itemCount + ' 项'),
      ''
    ));
    tiles.push(tile(
      '预算已支付',
      Money.format(s.paidTotal),
      '还需预留 ' + Money.format(s.remainingBudget),
      s.isOverBudget ? 'bad' : ''
    ));
    tiles.push(tile(
      '实际剩余',
      Money.format(s.actualBalance),
      s.advanceReservedTotal > 0
        ? '只扣已经花掉的：未花预算 ' + Money.format(s.unspentBudget) + ' + 预支待预留 ' + Money.format(s.advanceReservedTotal)
        : '只扣已经花掉的，含未花预算 ' + Money.format(s.unspentBudget),
      s.isCashNegative ? 'bad' : '',
      '对账'
    ));
    if (s.reconciliationAdjustment !== 0) {
      tiles.push(tile(
        '对账调整',
        (s.reconciliationAdjustment > 0 ? '+' : '−') + Money.format(Math.abs(s.reconciliationAdjustment)),
        '按实际余额校正' + (s.lastReconciliation ? ' · 录入 ' + Money.format(s.lastReconciliation.enteredBalance) : ''),
        s.reconciliationAdjustment < 0 ? 'warn' : 'good'
      ));
    }
    tiles.push(tile(
      '零星记账',
      Money.format(s.ledgerTotal),
      s.ledgerCount === 0
        ? '没有记账'
        : (s.ledgerExpenseCount + ' 笔支出' + (s.ledgerIncomeTotal > 0 ? ' · 收入 ' + Money.format(s.ledgerIncomeTotal) : '')),
      ''
    ));
    tiles.push(tile(
      '预支（已花掉）',
      Money.format(s.advancePaidTotal),
      s.advanceCount === 0 ? '没有预支' : ('共登记 ' + s.advanceCount + ' 笔'),
      s.advancePaidTotal > 0 ? 'warn' : ''
    ));
    if (s.advanceReservedTotal > 0) {
      tiles.push(tile(
        '预支待预留',
        Money.format(s.advanceReservedTotal),
        '付款日还没到：先占结余，不扣实际剩余',
        'warn'
      ));
    }
    if (s.advanceIncomingTotal > 0) {
      tiles.push(tile(
        '上月已提前支付',
        Money.format(s.advanceIncomingTotal),
        s.advanceIncomingCount + ' 笔 · 上个月已付过，本月不用再列预算',
        ''
      ));
    }

    if (s.overrunTotal > 0) {
      tiles.push(tile('预算超支', Money.format(s.overrunTotal), '实际支付超过计划的部分', 'bad'));
    }
    if (s.savedTotal > 0) {
      tiles.push(tile('预算节省', Money.format(s.savedTotal), '实际支付少于计划的部分', 'good'));
    }
    if (s.recurringCount > 0) {
      tiles.push(tile(
        '重复预算待预留',
        Money.format(s.recurringRemainingTotal),
        s.recurringCount + ' 项 · 每天 ' + Money.format(s.recurringDailyTotal) + ' · 已发生 ' + Money.format(s.recurringSpentTotal),
        'warn'
      ));
    }

    $('statTiles').innerHTML = tiles.join('');
  }

  function renderProgress() {
    const s = store.summary(currentKey);
    const percent = s.plannedTotal > 0 ? Math.round(s.budgetProgress * 100) : 0;
    const fill = $('progressFill');
    fill.style.width = Math.min(100, s.budgetProgress * 100) + '%';
    fill.classList.toggle('over', s.budgetProgress >= 1);
    $('progressPercent').textContent = s.plannedTotal > 0 ? percent + '%' : '暂无预算';

    $('progressFoot').innerHTML =
      '<span>已付 ' + Money.format(s.paidTotal) + ' / 计划 ' + Money.format(s.plannedTotal) + '</span>' +
      '<span>' + (s.isOverBudget
        ? '超预算 ' + Money.format(Math.abs(s.budgetBalance))
        : '预算结余 ' + Money.format(s.budgetBalance)) + '</span>';
  }

  function renderTabs() {
    const counts = {
      budget: store.items(currentKey).length,
      ledger: store.entries(currentKey).length,
      advance: store.advances(currentKey).length
    };
    ['budget', 'ledger', 'advance'].forEach(function (tab) {
      const node = $('tab-' + tab);
      node.classList.toggle('active', tab === activeTab);
      const countNode = node.querySelector('.tab-count');
      if (countNode) countNode.textContent = counts[tab] > 0 ? ' ' + counts[tab] : '';
    });
  }

  function emptyState(icon, title, desc, buttonLabel, action) {
    return '<div class="list"><div class="empty">' +
      '<div class="empty-icon">' + icon + '</div>' +
      '<div class="empty-title">' + esc(title) + '</div>' +
      '<div class="empty-desc">' + esc(desc) + '</div>' +
      (buttonLabel ? '<button class="mini-btn" data-empty-action="' + action + '">' + esc(buttonLabel) + '</button>' : '') +
      '</div></div>';
  }

  function renderList() {
    if (activeTab === 'budget') {
      renderBudgetList();
    } else if (activeTab === 'ledger') {
      renderLedgerList();
    } else {
      renderAdvanceList();
    }
    $('fab').textContent = activeTab === 'budget' ? '＋ 预算项目' : (activeTab === 'ledger' ? '＋ 记一笔' : '＋ 预支');
  }

  function renderBudgetList() {
    const items = store.items(currentKey);
    const area = $('listArea');
    if (items.length === 0) {
      area.innerHTML = emptyState(
        '🧾', '还没有预算项目', '比如房租、餐饮、交通，先定计划金额，花完再填实际支付。',
        '添加预算项目', 'add-item'
      );
      return;
    }

    const rows = items.map(function (item) {
      const done = item.status === 'completed';
      const paid = core.itemPaidAmount(item);
      const over = core.itemOverrun(item) > 0;
      const schedule = core.recurrenceSchedule(item, new Date());
      const payments = core.sortedPayments(item);
      const planned = core.itemPlannedAmount(item);
      const remainingToPay = Math.max(0, Money.round(planned - paid));
      const partial = !done && payments.length > 0;
      const badge = done
        ? '<span class="badge ' + (over ? 'over' : 'done') + '">' + (over ? '超支' : '已完成') + '</span>'
        : (partial
          ? '<span class="badge advance">部分已付</span>'
          : '<span class="badge plan">计划中</span>');
      const headParts = [categoryLabel(item.category)];
      const detailParts = [];
      if (schedule) {
        const equalAmounts = schedule.amounts.every(function (amount) {
          return Money.cents(amount) === Money.cents(schedule.amounts[0]);
        });
        headParts.push(equalAmounts
          ? schedule.peopleCount + ' 人 × ' + Money.format(schedule.amounts[0]) + '/天'
          : schedule.peopleCount + ' 人 · ' + Money.format(schedule.dailyTotal) + '/天');
        detailParts.push('已发生 ' + Money.format(schedule.spentSoFar));
        detailParts.push('还需留 ' + Money.format(schedule.remainingAmount) + '（' + schedule.remainingDays + ' 天）');
      } else if (payments.length > 0) {
        headParts.push('分 ' + payments.length + ' 次');
        detailParts.push('已付 ' + Money.format(paid) + ' / 计划 ' + Money.format(planned));
        if (remainingToPay > 0) detailParts.push('还差 ' + Money.format(remainingToPay));
      }
      if (item.dueDate) detailParts.push('截止 ' + toDateInputValue(item.dueDate));
      if (item.note) detailParts.push(item.note);
      if (done && !over && core.itemSaved(item) > 0) detailParts.push('省下 ' + Money.format(core.itemSaved(item)));
      if (done && over) detailParts.push('超 ' + Money.format(core.itemOverrun(item)));

      const amountNode = done
        ? '<div class="amount ' + (over ? 'spend' : (core.itemSaved(item) > 0 ? 'income' : '')) + '">' + Money.format(paid) + '</div>'
        : (partial
          ? '<div class="amount">' + Money.format(paid) + '/' + Money.format(planned) + '</div>'
          : '<div class="amount">' + Money.format(planned) + '</div>');

      const action = done
        ? ''
        : (schedule
          ? '<button class="mini-btn" data-settle-day="' + item.id + '">记今天</button>'
          : '<button class="mini-btn" data-pay="' + item.id + '">付款</button>');

      if (schedule && schedule.savedSoFar > 0) detailParts.push('已省 ' + Money.format(schedule.savedSoFar));
      if (schedule && schedule.overrunSoFar > 0) detailParts.push('已超 ' + Money.format(schedule.overrunSoFar));

      return '<div class="row tappable" data-edit-item="' + item.id + '">' +
        '<div class="avatar">' + categoryIcon(item.category) + '</div>' +
        '<div class="main"><div class="title">' + esc(item.name) + '</div>' +
        '<div class="sub">' + badge + (schedule ? '<span class="badge repeat">按天</span>' : '') +
        ' ' + esc(headParts.join(' · ')) + '</div>' +
        (detailParts.length > 0 ? '<div class="sub detail">' + esc(detailParts.join(' · ')) + '</div>' : '') +
        '</div>' +
        '<div class="row-actions">' + amountNode + action + '</div>' +
        '</div>';
    }).join('');

    const recurring = store.summary(currentKey).recurringCount;
    const s = store.summary(currentKey);
    area.innerHTML =
      '<div class="section-title"><span>预算项目</span><span>计划 ' + Money.format(s.plannedTotal) +
      ' · 已付 ' + Money.format(s.paidTotal) +
      (recurring > 0 ? ' · 待预留 ' + Money.format(s.recurringRemainingTotal) : '') + '</span></div>' +
      '<div class="list">' + rows + '</div>';
  }

  function renderLedgerList() {
    const groups = store.ledgerGroups(currentKey);
    const area = $('listArea');
    if (groups.length === 0) {
      area.innerHTML = emptyState(
        '☕️', '还没有零星记账', '奶茶、打车这类不在预算里的开销，以及报销、卖闲置这类零星收入，都记在这里。',
        '记第一笔', 'add-entry'
      );
      return;
    }

    const summary = store.summary(currentKey);
    const html = groups.map(function (group) {
      const rows = group.entries.map(function (entry) {
        const income = entry.direction === 'income';
        const subParts = [categoryLabel(entry.category)];
        if (income) subParts.push('收入');
        if (entry.note) subParts.push(entry.note);
        return '<div class="row tappable" data-edit-entry="' + entry.id + '">' +
          '<div class="avatar ' + (income ? 'income' : '') + '">' + categoryIcon(entry.category) + '</div>' +
          '<div class="main"><div class="title">' + esc(entry.title) + '</div>' +
          '<div class="sub">' + esc(subParts.join(' · ')) + '</div></div>' +
          '<div class="amount ' + (income ? 'income' : 'spend') + '">' +
          (income ? '+' : '-') + Money.format(entry.amount) + '</div>' +
          '</div>';
      }).join('');
      const dayParts = [];
      if (group.expenseTotal > 0) dayParts.push('-' + Money.format(group.expenseTotal));
      if (group.incomeTotal > 0) dayParts.push('+' + Money.format(group.incomeTotal));
      return '<div class="day-header"><span>' + esc(dayText(group.date)) + '</span><span>' +
        esc(dayParts.join('  ')) + '</span></div>' +
        '<div class="list">' + rows + '</div>';
    }).join('');

    area.innerHTML =
      '<div class="section-title"><span>零星记账</span><span>支出 ' + Money.format(summary.ledgerTotal) +
      (summary.ledgerIncomeTotal > 0 ? ' · 收入 ' + Money.format(summary.ledgerIncomeTotal) : '') + '</span></div>' +
      html;
  }

  function renderAdvanceList() {
    const advances = store.advances(currentKey);
    const area = $('listArea');
    if (advances.length === 0) {
      area.innerHTML = emptyState(
        '🧾', '还没有预支', '这个月提前买了下个月的东西（车票、学费、订阅）就记在这里：钱从本月出，下个月自动抵回来。',
        '添加预支', 'add-advance'
      );
      return;
    }

    const rows = advances.map(function (advance) {
      const outstanding = core.advanceOutstanding(advance);
      const settled = outstanding === 0;
      const paid = core.advanceIsPaid(advance, new Date());
      const target = core.advanceTargetKey(advance);
      const subParts = [paid ? '扣款 ' + toDateInputValue(advance.date) : toDateInputValue(advance.date) + ' 才扣款',
        '归属 ' + Month.label(target)];
      if (!settled && !paid) subParts.push('钱还在手里，先占结余');
      if (advance.note) subParts.push(advance.note);

      const statusBadge = paid
        ? '<span class="badge advance">已支付</span> '
        : '<span class="badge plan">待预留</span> ';

      return '<div class="row tappable" data-edit-advance="' + advance.id + '">' +
        '<div class="avatar">🗓️</div>' +
        '<div class="main"><div class="title">' + esc(advance.title) + '</div>' +
        '<div class="sub">' + statusBadge + esc(subParts.join(' · ')) + '</div></div>' +
        '<div class="row-actions">' +
        '<div class="amount spend">' + Money.format(outstanding) + '</div>' +
        '</div></div>';
    }).join('');

    const s = store.summary(currentKey);
    const headerParts = ['已支付 ' + Money.format(s.advancePaidTotal)];
    if (s.advanceReservedTotal > 0) headerParts.push('待预留 ' + Money.format(s.advanceReservedTotal));
    if (s.advanceIncomingTotal > 0) {
      headerParts.push('上月转入 ' + Money.format(s.advanceIncomingTotal));
    }
    area.innerHTML =
      '<div class="section-title"><span>预支（提前为后面月份花钱 / 预留）</span><span>' + esc(headerParts.join(' · ')) + '</span></div>' +
      (s.advanceIncomingTotal > 0
        ? '<div class="list" style="margin-bottom:12px"><div class="row"><div class="avatar">↩️</div>' +
          '<div class="main"><div class="title">上月已提前支付</div>' +
          '<div class="sub">' + s.advanceIncomingCount + ' 笔共 ' + Money.format(s.advanceIncomingTotal) +
          '：上个月已经替你付过了，这部分已加回本月可用额度；本月为它记的预算结算时会刚好抵消</div></div>' +
          '<div class="amount muted">' + Money.format(s.advanceIncomingTotal) + '</div></div></div>'
        : '') +
      '<div class="list">' + rows + '</div>';
  }

  // ---------------------------------------------------------------- 弹层

  function openSheet(html, state) {
    sheetState = state || null;
    $('sheet').innerHTML = '<div class="sheet-grabber"></div>' + html;
    $('sheet').classList.remove('hidden');
    $('backdrop').classList.remove('hidden');
    lockBodyScroll();
  }

  function closeSheet() {
    sheetState = null;
    $('sheet').classList.add('hidden');
    $('backdrop').classList.add('hidden');
    $('sheet').innerHTML = '';
    unlockBodyScroll();
  }

  // 弹层打开时锁住背后的页面，避免「滑动小页面却把主页面带着滚」
  let lockedScrollY = 0;

  function lockBodyScroll() {
    if (document.body.classList.contains('sheet-open')) return;
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = '-' + lockedScrollY + 'px';
    document.body.classList.add('sheet-open');
  }

  function unlockBodyScroll() {
    if (!document.body.classList.contains('sheet-open')) return;
    document.body.classList.remove('sheet-open');
    document.body.style.top = '';
    window.scrollTo(0, lockedScrollY);
  }

  function categoryChips(selected, name) {
    return '<div class="chips" data-chip-group="' + name + '">' +
      Categories.map(function (category) {
        return '<button type="button" class="chip ' + (category.id === selected ? 'active' : '') +
          '" data-chip-value="' + category.id + '">' + category.icon + ' ' + category.label + '</button>';
      }).join('') + '</div>';
  }

  function clampPeople(value) {
    const count = Math.trunc(Number(value) || 1);
    return Math.min(20, Math.max(1, count));
  }

  function monthRange(key) {
    return {
      start: toDateInputValue(Month.startDate(key).toISOString()),
      end: toDateInputValue(new Date(key.year, key.month - 1, Month.dayCount(key), 12, 0, 0).toISOString())
    };
  }

  /** 余额对账面板：填实际余额，差额自动记成一笔调整。 */
  function openReconcileSheet() {
    const summary = store.summary(currentKey);
    const history = store.reconciliations(currentKey);
    const historyHTML = history.length === 0 ? '' :
      '<div class="field"><label>对账历史</label><div class="day-list">' +
      history.slice(0, 5).map(function (record) {
        const when = new Date(record.createdAt);
        const diffText = record.difference === 0
          ? '没有差额'
          : (record.difference < 0 ? '补记支出 ' : '补记收入 ') + Money.format(Math.abs(record.difference));
        return '<div class="day-row">' +
          '<div class="day-date">' + (when.getMonth() + 1) + '月' + when.getDate() + '日 对账' +
          (record.note ? ' · ' + esc(record.note) : '') + '</div>' +
          '<div class="day-plan">录入 ' + Money.format(record.enteredBalance) + '</div>' +
          '<div class="day-actual"><span class="day-state">' + diffText + '</span></div>' +
          '</div>';
      }).join('') + '</div></div>';

    const html =
      '<h2>余额对账</h2>' +
      '<div class="hint" style="margin-bottom:12px">漏记了几笔不用怕：填「现在实际有多少钱」（银行卡 + 现金 + 零钱），' +
      'App 会把差额记成一笔调整，让结余、实际剩余都对上。</div>' +
      '<div class="stat-line"><span class="k">App 算出来的账面剩余</span><span class="v">' +
      Money.format(summary.bookBalance) + '</span></div>' +
      (summary.reconciliationAdjustment !== 0
        ? '<div class="stat-line"><span class="k">当前已调整</span><span class="v">' +
          (summary.reconciliationAdjustment > 0 ? '+' : '−') +
          Money.format(Math.abs(summary.reconciliationAdjustment)) + '</span></div>'
        : '') +
      '<div class="field" style="margin-top:14px"><label>现在实际有多少</label>' +
      '<div class="amount-input"><span class="prefix">¥</span>' +
      '<input id="reconcile-amount" type="text" inputmode="decimal" value="' +
      esc(Money.plain(summary.actualBalance)) + '"></div>' +
      '<div class="preview" id="reconcile-preview" style="margin-top:10px">' +
      reconcilePreviewHTML(Money.plain(summary.actualBalance)) + '</div></div>' +
      '<div class="field"><label>备注（可选）</label>' +
      '<input id="reconcile-note" type="text" placeholder="例如：月初对银行卡"></div>' +
      historyHTML +
      '<div class="sheet-actions">' +
      '<button class="btn" data-action="close">取消</button>' +
      '<button class="btn primary" data-action="save-reconcile">保存并校正</button>' +
      '</div>' +
      (history.length > 0
        ? '<div class="sheet-actions"><button class="btn warn" data-action="undo-reconcile">撤销上次对账</button></div>'
        : '');
    openSheet(html, { kind: 'reconcile' });
  }

  /**
   * 对账预览。enteredText 传进来是为了在面板还没插进 DOM 时也能渲染，
   * 传空则从输入框读当前值（用户正在输入时）。
   */
  function reconcilePreviewHTML(enteredText) {
    const input = $('reconcile-amount');
    const raw = enteredText !== undefined ? enteredText : (input ? input.value : '');
    const entered = Money.parse(raw);
    if (entered === null) return '<div class="preview-line">填一个金额来算差额</div>';
    const bookBalance = store.summary(currentKey).bookBalance;
    const difference = Money.round(entered - bookBalance);
    if (difference === 0) {
      return '<div class="preview-line"><span>和账面一致</span><strong>不用调整</strong></div>';
    }
    const explanation = difference < 0
      ? '说明有 ' + Money.format(-difference) + ' 支出没记上'
      : '说明有 ' + Money.format(difference) + ' 收入没记上';
    return '<div class="preview-line"><span>差额</span><strong class="' + (difference < 0 ? 'bad' : 'good') + '">' +
      (difference > 0 ? '+' : '−') + Money.format(Math.abs(difference)) + '</strong></div>' +
      '<div class="preview-line"><span>' + explanation + '</span></div>' +
      '<div class="preview-line highlight"><span>校正后实际剩余</span><strong>' + Money.format(entered) + '</strong></div>';
  }

  function itemDraft(item) {
    const range = monthRange(currentKey);
    const recurring = item ? core.isRecurring(item) : false;
    const amounts = recurring ? item.recurrence.amounts.map(function (a) { return Money.plain(a); }) : ['', ''];
    return {
      itemId: item ? item.id : null,
      name: item ? item.name : '',
      category: item ? item.category : 'housing',
      mode: recurring ? 'daily' : 'fixed',
      amount: item && !recurring ? Money.plain(item.plannedAmount) : '',
      people: recurring ? item.recurrence.amounts.length : 2,
      amounts: amounts,
      startDate: recurring && item.recurrence.startDate ? item.recurrence.startDate : range.start,
      endDate: recurring && item.recurrence.endDate ? item.recurrence.endDate : range.end,
      overrides: recurring ? Object.assign({}, item.recurrence.overrides || {}) : {},
      /* 每天明细默认收起：不然一个月 31 行，每次保存都要滑很久 */
      daysExpanded: false,
      // 新建时截止日期默认今天（空着的话在手机上会显示成很扁的一条）
      dueDate: item
        ? (item.dueDate ? toDateInputValue(item.dueDate) : '')
        : todayISO(),
      note: item ? item.note : '',
      status: item ? item.status : 'planned'
    };
  }

  /** 把表单里已填的内容读回 sheetState，避免切换选项时丢输入。 */
  function readItemDraft() {
    if (!sheetState || sheetState.kind !== 'item' || !$('item-name')) return sheetState;
    sheetState.name = valueOf('item-name');
    sheetState.note = valueOf('item-note');
    if ($('item-amount')) sheetState.amount = valueOf('item-amount');
    if ($('item-due')) sheetState.dueDate = valueOf('item-due');
    if ($('item-start')) sheetState.startDate = valueOf('item-start');
    if ($('item-end')) sheetState.endDate = valueOf('item-end');
    const peopleInput = $('item-people');
    if (peopleInput) sheetState.people = clampPeople(peopleInput.value);
    const personInputs = $('sheet').querySelectorAll('[data-person-amount]');
    if (personInputs.length) {
      sheetState.amounts = Array.prototype.map.call(personInputs, function (node) { return node.value.trim(); });
    }
    return sheetState;
  }

  function resizeAmounts(amounts, count) {
    const next = amounts.slice(0, count);
    while (next.length < count) {
      next.push(next.length > 0 ? next[next.length - 1] : '');
    }
    return next;
  }

  function personAmountFields(draft) {
    const rows = [];
    for (let index = 0; index < draft.people; index += 1) {
      rows.push(
        '<div class="person-row"><span class="person-label">第 ' + (index + 1) + ' 人</span>' +
        '<div class="amount-input"><span class="prefix">¥</span>' +
        '<input data-person-amount type="text" inputmode="decimal" placeholder="每天" value="' +
        esc(draft.amounts[index] !== undefined ? draft.amounts[index] : '') + '"></div></div>'
      );
    }
    return rows.join('');
  }

  /**
   * 用「草稿数据」算一份进度。
   * 注意：表单还没插进 DOM 时不能去读输入框，所以这里以 sheetState 为准，
   * 只有 sheetState 已经存在并同步过（readItemDraft）才读 DOM。
   */
  function draftSchedule() {
    const draft = (sheetState && sheetState.kind === 'item') ? readItemDraft() : sheetState;
    const source = draft || {};
    const amounts = (source.amounts || []).map(function (text) { return Money.parse(text) || 0; });
    return core.recurrenceSchedule({
      plannedAmount: 0,
      actualAmount: null,
      status: 'planned',
      createdAt: new Date().toISOString(),
      recurrence: {
        type: 'daily',
        amounts: amounts,
        startDate: source.startDate,
        endDate: source.endDate,
        overrides: source.overrides || {}
      }
    }, new Date());
  }

  function recurringPreviewHTML() {
    const schedule = draftSchedule();
    if (!schedule || schedule.totalDays <= 0) {
      return '<div class="preview warn">结束日期要晚于起始日期</div>';
    }
    const lines = [
      '<div class="preview-line"><span>每天合计</span><strong>' + Money.format(schedule.dailyTotal) +
        ' · ' + schedule.peopleCount + ' 人</strong></div>',
      '<div class="preview-line"><span>整段合计（' + schedule.totalDays + ' 天）</span><strong>' +
        Money.format(schedule.plannedAmount) + '</strong></div>',
      '<div class="preview-line"><span>已发生（' + schedule.spentDays + ' 天，其中 ' + schedule.settledDays +
        ' 天已结算）</span><strong>' +
        Money.format(schedule.spentSoFar) + '</strong></div>',
      '<div class="preview-line highlight"><span>后续还需预留（' + schedule.remainingDays + ' 天）</span><strong>' +
        Money.format(schedule.remainingAmount) + '</strong></div>'
    ];
    if (schedule.savedSoFar > 0) {
      lines.push('<div class="preview-line"><span>已经省下</span><strong class="good">' +
        Money.format(schedule.savedSoFar) + '</strong></div>');
    }
    if (schedule.overrunSoFar > 0) {
      lines.push('<div class="preview-line"><span>已经超支</span><strong class="bad">' +
        Money.format(schedule.overrunSoFar) + '</strong></div>');
    }
    return '<div class="preview" id="item-preview">' + lines.join('') + '</div>';
  }

  /** 每天一行的结算清单：今天和过去可以填实际金额，未来的显示「待预留」。 */
  function dayDetailInnerHTML() {
    const schedule = draftSchedule();
    if (!schedule || schedule.totalDays <= 0) return '';
    const expanded = !!(sheetState && sheetState.daysExpanded);
    const todayKey = core.dayString(new Date());
    const today = schedule.days.find(function (day) { return day.date === todayKey; });
    const todayText = !today
      ? ''
      : (today.actual === null
        ? '今天待结算 ' + Money.format(today.planned)
        : '今天已结算 ' + Money.format(today.actual));

    const head =
      '<div class="day-detail-head">' +
      '<div><div class="dd-title">每天明细</div>' +
      '<div class="dd-sub">共 ' + schedule.totalDays + ' 天 · 已结算 ' + schedule.settledDays + ' 天' +
      (todayText ? ' · ' + todayText : '') + '</div></div>' +
      '<button type="button" class="mini-btn ghost" data-toggle-days="1">' + (expanded ? '收起' : '展开') + '</button>' +
      '</div>';

    if (!expanded) return head;

    const rows = schedule.days.map(function (day) {
      const editable = day.isPast || day.isToday;
      let diffNode = '';
      if (day.diff > 0) diffNode = '<span class="day-diff bad">超 ' + Money.format(day.diff) + '</span>';
      else if (day.diff < 0) diffNode = '<span class="day-diff good">省 ' + Money.format(-day.diff) + '</span>';
      else if (day.status === 'settled') diffNode = '<span class="day-state">已结算</span>';
      else if (day.status === 'estimated') diffNode = '<span class="day-state">按计划</span>';

      let actualNode;
      if (editable) {
        actualNode = '<input data-day-actual="' + day.date + '" type="text" inputmode="decimal" ' +
          'placeholder="' + Money.plain(day.planned) + '" value="' +
          (day.actual === null ? '' : esc(Money.plain(day.actual))) + '">' + diffNode;
      } else {
        actualNode = '<span class="day-pending">待预留 ' + Money.format(day.planned) + '</span>';
      }

      return '<div class="day-row' + (day.isToday ? ' today' : '') + '">' +
        '<div class="day-date">' + dayLabel(day.date) + (day.isToday ? ' · 今天' : '') + '</div>' +
        '<div class="day-plan">计划 ' + Money.format(day.planned) + '</div>' +
        '<div class="day-actual">' + actualNode + '</div>' +
        '</div>';
    }).join('');
    return head +
      '<div class="hint" style="margin:8px 0 8px">填实际花了多少就行：比计划少算省下，比计划多算超支，没填的过去天数按计划估算。</div>' +
      '<div class="day-list" id="day-list">' + rows + '</div>';
  }

  function dayDetailHTML() {
    return '<div class="field" id="day-detail">' + dayDetailInnerHTML() + '</div>';
  }

  function renderItemSheet() {
    const draft = sheetState;
    const editing = !!draft.itemId;
    const html =
      '<h2>' + (editing ? '编辑预算项目' : '新增预算项目') + '</h2>' +
      '<div class="field"><label>名称</label>' +
      '<input id="item-name" type="text" placeholder="例如：房租 / 生活费" value="' + esc(draft.name) + '"></div>' +
      '<div class="field"><label>计算方式</label>' +
      '<div class="chips" data-mode-group>' +
      '<button type="button" class="chip ' + (draft.mode === 'fixed' ? 'active' : '') + '" data-mode="fixed">一次性金额</button>' +
      '<button type="button" class="chip ' + (draft.mode === 'daily' ? 'active' : '') + '" data-mode="daily">按天重复</button>' +
      '</div>' +
      '<div class="hint">按天重复适合生活费这类每天都要花的钱：填人数和每人每天的金额，App 按天数自动算总额、已发生和后续要留的预算。' +
      '注意：这类支出不用再逐笔记账，否则会重复计算。</div></div>' +
      (draft.mode === 'fixed'
        ? '<div class="field"><label>计划金额</label>' +
          '<div class="amount-input"><span class="prefix">¥</span>' +
          '<input id="item-amount" type="text" inputmode="decimal" placeholder="0.00" value="' + esc(draft.amount) + '"></div></div>'
        : '<div class="field"><label>人数</label>' +
          '<div class="stepper">' +
          '<button type="button" class="icon-btn" data-people="-1">−</button>' +
          '<input id="item-people" type="number" min="1" max="20" value="' + draft.people + '">' +
          '<button type="button" class="icon-btn" data-people="1">＋</button>' +
          '<span class="hint" style="margin:0 0 0 8px">人</span>' +
          '</div></div>' +
          '<div class="field"><label>每人每天的金额</label>' + personAmountFields(draft) +
          '<div class="hint">每个人可以不一样，比如大人 50、小孩 30。</div></div>' +
          '<div class="field"><label>计算区间</label>' +
          '<div class="range-row"><input id="item-start" type="date" value="' + esc(draft.startDate) + '">' +
          '<span class="range-sep">至</span>' +
          '<input id="item-end" type="date" value="' + esc(draft.endDate) + '"></div>' +
          '<div class="hint">默认算整月，也可以只算某一段（例如出差期间）。</div></div>' +
          recurringPreviewHTML() +
          dayDetailHTML()) +
      '<div class="field"><label>分类</label>' + categoryChips(draft.category, 'item-category') + '</div>' +
      (draft.mode === 'fixed'
        ? '<div class="field"><label>截止日期（可选）</label>' +
          '<input id="item-due" type="date" value="' + esc(draft.dueDate) + '">' +
          '<div class="hint">默认今天；不需要就清空，留空表示没有截止日期。</div></div>'
        : '') +
      '<div class="field"><label>备注（可选）</label>' +
      '<input id="item-note" type="text" placeholder="例如：含物业费" value="' + esc(draft.note) + '"></div>' +
      '<div class="sheet-actions">' +
      (editing ? '<button class="btn danger" data-action="delete-item">删除</button>' : '') +
      '<button class="btn" data-action="close">取消</button>' +
      '<button class="btn primary" data-action="save-item">保存</button>' +
      '</div>' +
      (editing && draft.status === 'completed'
        ? '<div class="sheet-actions"><button class="btn warn" data-action="reopen-item">撤销结算（改回计划中）</button></div>'
        : '') +
      (editing && draft.mode === 'daily' && draft.status !== 'completed'
        ? '<div class="sheet-actions"><button class="btn" data-action="settle-whole-item">整月一次性结算</button></div>'
        : '') +
      (editing && draft.mode === 'fixed' && draft.status !== 'completed'
        ? '<div class="sheet-actions"><button class="btn" data-action="open-payment">分次付款 / 记一笔付款</button></div>'
        : '');

    openSheet(html, draft);
  }

  function openItemSheet(itemId) {
    const item = itemId ? store.item(itemId, currentKey) : null;
    sheetState = Object.assign(itemDraft(item), { kind: 'item' });
    renderItemSheet();
  }

  function openSettleSheet(itemId) {
    const item = store.item(itemId, currentKey);
    if (!item) return;
    const schedule = core.recurrenceSchedule(item, new Date());
    const html =
      '<h2>结算：' + esc(item.name) + '</h2>' +
      '<div class="stat-line"><span class="k">计划金额</span><span class="v">' +
      Money.format(core.itemPlannedAmount(item)) + '</span></div>' +
      (schedule
        ? '<div class="stat-line"><span class="k">按天自动算到现在的已发生</span><span class="v">' +
          Money.format(schedule.spentSoFar) + '</span></div>' +
          '<div class="stat-line"><span class="k">后续还需预留</span><span class="v">' +
          Money.format(schedule.remainingAmount) + '</span></div>'
        : '') +
      '<div class="field" style="margin-top:14px"><label>实际支付金额</label>' +
      '<div class="amount-input"><span class="prefix">¥</span>' +
      '<input id="settle-amount" type="text" inputmode="decimal" value="' +
      esc(Money.plain(core.itemPlannedAmount(item))) + '"></div>' +
      '<div class="hint">填好金额后，这笔钱会立刻计入本月结余。</div></div>' +
      '<div class="sheet-actions">' +
      '<button class="btn" data-action="close">取消</button>' +
      '<button class="btn primary" data-action="confirm-settle">完成并记账</button>' +
      '</div>';
    openSheet(html, { kind: 'settle', itemId: itemId });
  }

  /** 分次付款：一个预算项目分几笔付完，每笔都有自己的金额和日期。 */
  function openPaymentSheet(itemId) {
    const item = store.item(itemId, currentKey);
    if (!item) return;
    const planned = core.itemPlannedAmount(item);
    const paid = core.itemPaidAmount(item);
    const remaining = Math.max(0, Money.round(planned - paid));
    const payments = core.sortedPayments(item);

    const historyHTML = payments.length === 0 ? '' :
      '<div class="field"><label>付款记录</label><div class="day-list">' +
      payments.map(function (payment) {
        const when = new Date(payment.date);
        return '<div class="day-row">' +
          '<div class="day-date">' + (when.getMonth() + 1) + '月' + when.getDate() + '日 付款' +
          (payment.note ? ' · ' + esc(payment.note) : '') + '</div>' +
          '<div class="day-plan">' + Money.format(payment.amount) + '</div>' +
          '<div class="day-actual"><button class="mini-btn ghost" data-action="delete-payment" data-payment-id="' +
          payment.id + '">删除这笔</button></div>' +
          '</div>';
      }).join('') + '</div></div>';

    const html =
      '<h2>记一笔付款 · ' + esc(item.name) + '</h2>' +
      '<div class="stat-line"><span class="k">计划金额</span><span class="v">' + Money.format(planned) + '</span></div>' +
      '<div class="stat-line"><span class="k">已经付了</span><span class="v">' + Money.format(paid) +
      (payments.length > 1 ? '（' + payments.length + ' 笔）' : '') + '</span></div>' +
      '<div class="stat-line"><span class="k">还差</span><span class="v">' + Money.format(remaining) + '</span></div>' +
      '<div class="hint" style="margin-top:10px">分几次付也没问题：每笔都记一下，付满计划金额会自动标记完成。</div>' +
      '<div class="field" style="margin-top:14px"><label>本次付款金额</label>' +
      '<div class="amount-input"><span class="prefix">¥</span>' +
      '<input id="payment-amount" type="text" inputmode="decimal" value="' + esc(Money.plain(remaining)) + '"></div></div>' +
      '<div class="field"><label>付款日期</label>' +
      '<input id="payment-date" type="date" value="' + todayISO() + '"></div>' +
      '<div class="field"><label>备注（可选）</label>' +
      '<input id="payment-note" type="text" placeholder="例如：第一笔定金"></div>' +
      historyHTML +
      '<div class="sheet-actions">' +
      '<button class="btn" data-action="close">取消</button>' +
      '<button class="btn primary" data-action="save-payment">记下这笔</button>' +
      '</div>' +
      (item.status !== 'completed' && remaining > 0
        ? '<div class="sheet-actions"><button class="btn warn" data-action="finish-item">剩下的不打算花了，直接标记完成</button></div>'
        : '');
    openSheet(html, { kind: 'payment', itemId: itemId });
  }

  /** 生活费「记今天」：只结算某一天，可以少花也可以超支。 */
  function openDaySheet(itemId, dayKey) {
    const item = store.item(itemId, currentKey);
    if (!item) return;
    const schedule = core.recurrenceSchedule(item, new Date());
    if (!schedule) return;
    const targetKey = dayKey || core.dayString(new Date());
    const day = schedule.days.find(function (entry) { return entry.date === targetKey; });
    const planned = day ? day.planned : schedule.dailyTotal;
    const isToday = targetKey === core.dayString(new Date());
    const html =
      '<h2>结算 ' + dayLabel(targetKey) + (isToday ? '（今天）' : '') + '</h2>' +
      '<div class="stat-line"><span class="k">' + esc(item.name) + ' 计划</span><span class="v">' +
      Money.format(planned) + '</span></div>' +
      (day && day.actual !== null
        ? '<div class="stat-line"><span class="k">已经填过</span><span class="v">' + Money.format(day.actual) + '</span></div>'
        : '') +
      '<div class="field" style="margin-top:14px"><label>这一天实际花了多少</label>' +
      '<div class="amount-input"><span class="prefix">¥</span>' +
      '<input id="day-actual-input" type="text" inputmode="decimal" value="' +
      esc(Money.plain(day && day.actual !== null ? day.actual : planned)) + '"></div>' +
      '<div class="hint">比计划少花：省下的钱立刻加回结余；比计划多花：超出的部分从结余里扣。</div></div>' +
      '<div class="sheet-actions">' +
      '<button class="btn" data-action="close">取消</button>' +
      '<button class="btn" data-action="save-day">保存</button>' +
      '</div>' +
      (day && day.actual !== null
        ? '<div class="sheet-actions"><button class="btn warn" data-action="clear-day">取消这天的记录</button></div>'
        : '');
    openSheet(html, { kind: 'day', itemId: itemId, dayKey: targetKey });
  }

  function openEntrySheet(entryId, presetDate) {
    const entry = entryId ? store.entry(entryId, currentKey) : null;
    const editing = !!entry;
    const direction = entry ? entry.direction : 'expense';
    const html =
      '<h2>' + (editing ? '编辑记录' : '记一笔') + '</h2>' +
      '<div class="field"><label>类型</label>' +
      '<div class="chips" data-direction-group>' +
      '<button type="button" class="chip ' + (direction === 'expense' ? 'active' : '') + '" data-direction="expense">💸 支出</button>' +
      '<button type="button" class="chip ' + (direction === 'income' ? 'active' : '') + '" data-direction="income">💰 收入</button>' +
      '</div>' +
      '<div class="hint">收入会加回本月结余（例如报销、卖闲置、临时赚的外快）。</div></div>' +
      '<div class="field"><label>名称</label>' +
      '<input id="entry-title" type="text" placeholder="例如：奶茶" value="' + esc(entry ? entry.title : '') + '"></div>' +
      '<div class="field"><label>金额</label>' +
      '<div class="amount-input"><span class="prefix">¥</span>' +
      '<input id="entry-amount" type="text" inputmode="decimal" placeholder="0.00" value="' +
      (entry ? esc(Money.plain(entry.amount)) : '') + '"></div></div>' +
      '<div class="field"><label>分类</label>' + categoryChips(entry ? entry.category : 'food', 'entry-category') + '</div>' +
      '<div class="field"><label>日期</label>' +
      '<input id="entry-date" type="date" value="' +
      (entry ? toDateInputValue(entry.date) : (presetDate || todayISO())) + '"></div>' +
      '<div class="field"><label>备注（可选）</label>' +
      '<input id="entry-note" type="text" value="' + esc(entry ? entry.note : '') + '"></div>' +
      '<div class="sheet-actions">' +
      (editing ? '<button class="btn danger" data-action="delete-entry">删除</button>' : '') +
      '<button class="btn" data-action="close">取消</button>' +
      '<button class="btn primary" data-action="save-entry">保存</button>' +
      '</div>';
    openSheet(html, {
      kind: 'entry',
      entryId: entryId || null,
      category: entry ? entry.category : 'food',
      direction: direction
    });
  }

  function openAdvanceSheet(advanceId) {
    const advance = advanceId ? store.advance(advanceId, currentKey) : null;
    const editing = !!advance;
    const target = advance ? core.advanceTargetKey(advance) : Month.next(currentKey);
    const html =
      '<h2>' + (editing ? '编辑预支' : '新增预支') + '</h2>' +
      '<div class="hint" style="margin-bottom:12px">这个月买的、但属于下个月的开销（车票、学费、订阅…）：钱从本月出，' +
      '付款日到了就从实际剩余里扣；还没到就只占结余（先预留）。归属月份会标注「上月已提前支付」，不会再扣一遍。</div>' +
      '<div class="field"><label>买了什么</label>' +
      '<input id="advance-title" type="text" placeholder="例如：下个月的车票" value="' + esc(advance ? advance.title : '') + '"></div>' +
      '<div class="field"><label>金额</label>' +
      '<div class="amount-input"><span class="prefix">¥</span>' +
      '<input id="advance-amount" type="text" inputmode="decimal" placeholder="0.00" value="' +
      (advance ? esc(Money.plain(advance.amount)) : '') + '"></div></div>' +
      '<div class="field"><label>扣款日</label>' +
      '<input id="advance-date" type="date" value="' +
      (advance ? toDateInputValue(advance.date) : todayISO()) + '">' +
      '<div class="hint">这笔钱预计哪天从卡里扣（或已经花了）。</div></div>' +
      '<div class="field"><label>这笔钱算在哪个月</label>' +
      '<div class="stepper">' +
      '<button type="button" class="icon-btn" data-target-step="-1">‹</button>' +
      '<span class="target-month" id="advance-target-label">' + Month.label(target) + '</span>' +
      '<button type="button" class="icon-btn" data-target-step="1">›</button>' +
      '<span class="hint" style="margin:0 0 0 8px">默认下个月</span>' +
      '</div>' +
      '<div class="hint">到了这个月，App 会在那个月标注「上月已提前支付' +
      (advance ? ' ' + Money.format(core.advanceOutstanding(advance)) : '') +
      '」，提醒你不用再列一遍预算（钱不会重复扣）。</div></div>' +
      '<div class="field"><label>备注（可选）</label>' +
      '<input id="advance-note" type="text" placeholder="例如：月底报销" value="' + esc(advance ? advance.note : '') + '"></div>' +
      '<div class="sheet-actions">' +
      (editing ? '<button class="btn danger" data-action="delete-advance">删除</button>' : '') +
      '<button class="btn" data-action="close">取消</button>' +
      '<button class="btn primary" data-action="save-advance">保存</button>' +
      '</div>';
    openSheet(html, {
      kind: 'advance',
      advanceId: advanceId || null,
      targetYear: target.year,
      targetMonth: target.month
    });
  }

  function openIncomeSheet() {
    const month = store.month(currentKey) || store.ensureMonth(currentKey);
    const html =
      '<h2>' + Month.label(currentKey) + ' 收入与结转</h2>' +
      '<div class="field"><label>本月收入</label>' +
      '<div class="amount-input"><span class="prefix">¥</span>' +
      '<input id="income-amount" type="text" inputmode="decimal" value="' + esc(Money.plain(month.income)) + '"></div></div>' +
      '<div class="field"><label>上月结转</label>' +
      '<input id="carry-input" type="text" inputmode="decimal" placeholder="留空 = 自动使用上月结余" value="' +
      (month.carryOverOverride === null || month.carryOverOverride === undefined ? '' : esc(Money.plain(month.carryOverOverride))) + '">' +
      '<div class="hint">自动结转当前为：' + (store.settings.carryOverEnabled ? '开启' : '关闭') +
      '，自动值 ' + Money.format(store.carryOver(currentKey) || 0) +
      '。手动填了金额就以你填的为准（即使自动结转是关闭的）。</div></div>' +
      '<div class="field"><label>本月备注（可选）</label>' +
      '<input id="month-note" type="text" value="' + esc(month.note) + '"></div>' +
      '<div class="sheet-actions">' +
      '<button class="btn" data-action="close">取消</button>' +
      '<button class="btn primary" data-action="save-income">保存</button>' +
      '</div>';
    openSheet(html, { kind: 'income' });
  }

  function openSettingsSheet() {
    const settings = store.settings;
    const html =
      '<h2>设置与数据</h2>' +
      '<div class="stat-line"><span class="k">版本</span><span class="v" id="app-version">' + core.VERSION + '</span></div>' +
      '<div class="stat-line"><span class="k">离线可用</span><span class="v">' + offlineStateText() + '</span></div>' +
      '<div class="stat-line"><span class="k">上次备份</span><span class="v">' + backupAgeText() + '</span></div>' +
      '<div class="field"><label>默认月收入</label>' +
      '<div class="amount-input"><span class="prefix">¥</span>' +
      '<input id="default-income" type="text" inputmode="decimal" value="' + esc(Money.plain(settings.defaultMonthlyIncome)) + '"></div>' +
      '<div class="hint">新建月份时自动填入这个金额。</div></div>' +
      '<div class="field"><label>自动结转上月结余</label>' +
      '<div class="chips"><button type="button" class="chip ' + (settings.carryOverEnabled ? 'active' : '') +
      '" data-toggle="carry-over">' + (settings.carryOverEnabled ? '已开启' : '已关闭') + '</button></div>' +
      '<div class="hint">开启后，本月结余会自动加上上月剩余的钱。</div></div>' +
      '<div class="sheet-list">' +
      '<div class="row tappable" data-action="copy-last-month"><div class="avatar">📋</div>' +
      '<div class="main"><div class="title">复制上月预算</div><div class="sub">把上月项目按计划金额带过来</div></div></div>' +
      '<div class="row tappable" data-action="reconcile"><div class="avatar">⚖️</div>' +
      '<div class="main"><div class="title">余额对账</div><div class="sub">填现在的实际余额，差额自动校正结余</div></div></div>' +
      '<div class="row tappable" data-action="export-json"><div class="avatar">💾</div>' +
      '<div class="main"><div class="title">导出备份（覆盖同一个文件）</div>' +
      '<div class="sub">固定文件名：手机提示「替换」、电脑直接覆盖，不会多出 (2)(3)</div></div></div>' +
      '<div class="row tappable" data-action="export-json-dated"><div class="avatar">🗂️</div>' +
      '<div class="main"><div class="title">导出带日期的备份</div><div class="sub">需要留多个历史版本时用这个</div></div></div>' +
      '<div class="row tappable" data-action="export-csv"><div class="avatar">📊</div>' +
      '<div class="main"><div class="title">导出表格（CSV）</div><div class="sub">用 Excel / Numbers 打开</div></div></div>' +
      '<div class="row tappable" data-action="import-json"><div class="avatar">📥</div>' +
      '<div class="main"><div class="title">导入备份</div><div class="sub">从 JSON 文件恢复数据</div></div></div>' +
      '</div>' +
      '<div class="sheet-actions">' +
      '<button class="btn danger" data-action="clear-data">清空数据</button>' +
      '<button class="btn primary" data-action="save-settings">保存</button>' +
      '</div>' +
      '<div class="sheet-actions"><button class="btn" data-action="close">关闭</button></div>' +
      '<input id="import-file" type="file" accept=".json,application/json" class="hidden">';
    openSheet(html, { kind: 'settings' });
  }

  function openMonthPicker() {
    const html =
      '<h2>选择月份</h2>' +
      '<div class="year-switch">' +
      '<button class="icon-btn" data-action="year-prev">‹</button>' +
      '<div class="year" id="pick-year">' + currentKey.year + '</div>' +
      '<button class="icon-btn" data-action="year-next">›</button>' +
      '</div>' +
      '<div class="month-grid">' +
      Array.from({ length: 12 }, function (_, index) {
        const month = index + 1;
        const active = month === currentKey.month ? ' active' : '';
        return '<button class="chip' + active + '" data-month="' + month + '">' + month + '月</button>';
      }).join('') +
      '</div>' +
      '<div class="sheet-actions"><button class="btn" data-action="jump-today">回到本月</button>' +
      '<button class="btn primary" data-action="close">完成</button></div>';
    openSheet(html, { kind: 'month-picker', year: currentKey.year });
  }

  // ---------------------------------------------------------------- 表单读写

  function selectedChip(name, fallback) {
    const group = $('sheet').querySelector('[data-chip-group="' + name + '"]');
    if (!group) return fallback;
    const active = group.querySelector('.chip.active');
    return active ? active.getAttribute('data-chip-value') : fallback;
  }

  function valueOf(id) {
    const node = $(id);
    return node ? node.value.trim() : '';
  }

  function saveItem() {
    const draft = readItemDraft();
    if (!draft.name) { toast('请填写名称'); return; }
    const payload = {
      name: draft.name,
      category: selectedChip('item-category', draft.category),
      note: draft.note
    };

    if (draft.mode === 'daily') {
      const amounts = Array.prototype.map.call(
        $('sheet').querySelectorAll('[data-person-amount]'),
        function (node) { return Money.parse(node.value); }
      );
      if (amounts.length === 0) { toast('请至少设置一个人'); return; }
      if (amounts.some(function (amount) { return amount === null || amount <= 0; })) {
        toast('请填写每个人每天的金额');
        return;
      }
      if (!draft.startDate || !draft.endDate || draft.startDate > draft.endDate) {
        toast('请选择正确的计算区间');
        return;
      }
      const schedule = core.recurrenceSchedule({
        plannedAmount: 0,
        status: 'planned',
        recurrence: { type: 'daily', amounts: amounts, startDate: draft.startDate, endDate: draft.endDate }
      }, new Date());
      payload.recurrence = {
        type: 'daily',
        amounts: amounts,
        startDate: draft.startDate,
        endDate: draft.endDate,
        overrides: draft.overrides || {}
      };
      payload.plannedAmount = schedule ? schedule.plannedAmount : 0;
      payload.dueDate = null;
    } else {
      const amount = Money.parse(draft.amount);
      if (amount === null || amount <= 0) { toast('请填写正确的金额'); return; }
      payload.plannedAmount = amount;
      payload.recurrence = null;
      payload.dueDate = draft.dueDate ? fromDateInputValue(draft.dueDate, null) : null;
    }

    if (draft.itemId) {
      store.updateItem(draft.itemId, payload, currentKey);
      toast('已保存');
    } else {
      store.addItem(payload, currentKey);
      toast(draft.mode === 'daily' ? '已添加重复预算' : '已添加预算项目');
    }
    closeSheet();
    render();
  }

  function saveEntry() {
    const title = valueOf('entry-title');
    const amount = Money.parse(valueOf('entry-amount'));
    if (!title) { toast('请填写名称'); return; }
    if (amount === null || amount <= 0) { toast('请填写正确的金额'); return; }
    const entryDate = fromDateInputValue(valueOf('entry-date'));
    // 记账日期属于哪个月就记到哪个月，跨月时自动跳过去，免得「记了却看不见」
    const targetKey = Month.fromDate(entryDate);
    const payload = {
      title: title,
      amount: amount,
      category: selectedChip('entry-category', 'other'),
      direction: selectedDirection(),
      date: entryDate,
      note: valueOf('entry-note')
    };
    if (sheetState && sheetState.entryId) {
      if (Month.equals(targetKey, currentKey)) {
        store.updateEntry(sheetState.entryId, payload, currentKey);
      } else {
        store.deleteEntry(sheetState.entryId, currentKey);
        store.addEntry(payload, targetKey);
        currentKey = targetKey;
      }
      toast('已保存');
    } else {
      store.addEntry(payload, targetKey);
      if (Month.equals(targetKey, currentKey)) {
        toast(payload.direction === 'income' ? '已记一笔收入' : '已记一笔');
      } else {
        currentKey = targetKey;
        toast('已记到 ' + Month.label(targetKey));
      }
    }
    closeSheet();
    render();
  }

  function selectedDirection() {
    const group = $('sheet').querySelector('[data-direction-group]');
    if (!group) return (sheetState && sheetState.direction) || 'expense';
    const active = group.querySelector('.chip.active');
    return active && active.getAttribute('data-direction') === 'income' ? 'income' : 'expense';
  }

  function saveAdvance() {
    const title = valueOf('advance-title');
    const amount = Money.parse(valueOf('advance-amount'));
    if (!title) { toast('请填写事由'); return; }
    if (amount === null || amount <= 0) { toast('请填写正确的金额'); return; }
    const payload = {
      title: title,
      amount: amount,
      date: fromDateInputValue(valueOf('advance-date')),
      note: valueOf('advance-note'),
      targetYear: sheetState.targetYear,
      targetMonth: sheetState.targetMonth
    };
    if (sheetState && sheetState.advanceId) {
      store.updateAdvance(sheetState.advanceId, payload, currentKey);
      toast('已保存');
    } else {
      store.addAdvance(payload, currentKey);
      toast('已添加预支');
    }
    closeSheet();
    render();
  }

  // ---------------------------------------------------------------- 事件

  $('prevMonth').addEventListener('click', function () {
    currentKey = Month.prev(currentKey);
    store.ensureMonth(currentKey);
    render();
  });

  $('nextMonth').addEventListener('click', function () {
    currentKey = Month.next(currentKey);
    store.ensureMonth(currentKey);
    render();
  });

  $('todayBtn').addEventListener('click', function () {
    currentKey = Month.current();
    store.ensureMonth(currentKey);
    render();
  });

  $('monthLabel').addEventListener('click', openMonthPicker);
  $('openSettings').addEventListener('click', openSettingsSheet);
  $('backdrop').addEventListener('click', closeSheet);

  $('hero').addEventListener('click', openIncomeSheet);

  // 概览卡片里的「对账」按钮
  $('statTiles').addEventListener('click', function (event) {
    const target = event.target.closest('[data-reconcile]');
    if (target) openReconcileSheet();
  });

  $('backupNow').addEventListener('click', backupNow);

  ['budget', 'ledger', 'advance'].forEach(function (tab) {
    $('tab-' + tab).addEventListener('click', function () {
      activeTab = tab;
      render();
    });
  });

  $('fab').addEventListener('click', function () {
    if (activeTab === 'budget') openItemSheet(null);
    else if (activeTab === 'ledger') openEntrySheet(null);
    else openAdvanceSheet(null);
  });

  // 列表内的点击（编辑 / 结算 / 归还 / 空状态引导）
  $('listArea').addEventListener('click', function (event) {
    const target = event.target.closest('[data-settle],[data-settle-day],[data-pay],[data-edit-item],[data-edit-entry],[data-edit-advance],[data-empty-action]');
    if (!target) return;
    const settle = target.getAttribute('data-settle');
    const settleDay = target.getAttribute('data-settle-day');
    const pay = target.getAttribute('data-pay');
    const editItem = target.getAttribute('data-edit-item');
    const editEntry = target.getAttribute('data-edit-entry');
    const editAdvance = target.getAttribute('data-edit-advance');
    const emptyAction = target.getAttribute('data-empty-action');

    if (settle) { openSettleSheet(settle); return; }
    if (settleDay) { openDaySheet(settleDay); return; }
    if (pay) { openPaymentSheet(pay); return; }
    if (editItem) { openItemSheet(editItem); return; }
    if (editEntry) { openEntrySheet(editEntry); return; }
    if (editAdvance) { openAdvanceSheet(editAdvance); return; }
    if (emptyAction === 'add-item') openItemSheet(null);
    if (emptyAction === 'add-entry') openEntrySheet(null);
    if (emptyAction === 'add-advance') openAdvanceSheet(null);
  });

  // 弹层内事件：分类选择 / 按钮动作
  $('sheet').addEventListener('click', function (event) {
    const modeChip = event.target.closest('[data-mode]');
    if (modeChip) {
      const draft = readItemDraft();
      draft.mode = modeChip.getAttribute('data-mode');
      renderItemSheet();
      return;
    }

    const toggleDays = event.target.closest('[data-toggle-days]');
    if (toggleDays) {
      const draft = readItemDraft();
      draft.daysExpanded = !draft.daysExpanded;
      renderItemSheet();
      return;
    }

    const peopleButton = event.target.closest('[data-people]');
    if (peopleButton) {
      const draft = readItemDraft();
      draft.people = clampPeople(draft.people + Number(peopleButton.getAttribute('data-people')));
      draft.amounts = resizeAmounts(draft.amounts, draft.people);
      renderItemSheet();
      return;
    }

    const targetStep = event.target.closest('[data-target-step]');
    if (targetStep) {
      const step = Number(targetStep.getAttribute('data-target-step'));
      let target = Month.make(sheetState.targetYear, sheetState.targetMonth);
      target = step > 0 ? Month.next(target) : Month.prev(target);
      sheetState.targetYear = target.year;
      sheetState.targetMonth = target.month;
      const label = $('advance-target-label');
      if (label) label.textContent = Month.label(target);
      return;
    }

    const directionChip = event.target.closest('[data-direction]');
    if (directionChip) {
      const group = directionChip.parentElement;
      group.querySelectorAll('.chip').forEach(function (node) { node.classList.remove('active'); });
      directionChip.classList.add('active');
      if (sheetState) sheetState.direction = directionChip.getAttribute('data-direction');
      return;
    }

    const chip = event.target.closest('.chip[data-chip-value]');
    if (chip) {
      const group = chip.parentElement;
      group.querySelectorAll('.chip').forEach(function (node) { node.classList.remove('active'); });
      chip.classList.add('active');
      if (sheetState) {
        if (sheetState.kind === 'item') sheetState.category = chip.getAttribute('data-chip-value');
        if (sheetState.kind === 'entry') sheetState.category = chip.getAttribute('data-chip-value');
      }
      return;
    }

    const monthChip = event.target.closest('[data-month]');
    if (monthChip) {
      const month = Number(monthChip.getAttribute('data-month'));
      currentKey = Month.make(sheetState ? sheetState.year : currentKey.year, month);
      store.ensureMonth(currentKey);
      openMonthPicker();
      render();
      return;
    }

    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      store.setCarryOverEnabled(!store.settings.carryOverEnabled);
      openSettingsSheet();
      render();
      return;
    }

    const actionNode = event.target.closest('[data-action]');
    if (!actionNode) return;
    const action = actionNode.getAttribute('data-action');

    switch (action) {
      case 'close':
        closeSheet();
        break;
      case 'save-item':
        saveItem();
        break;
      case 'save-entry':
        saveEntry();
        break;
      case 'save-advance':
        saveAdvance();
        break;
      case 'delete-item':
        store.deleteItem(sheetState.itemId, currentKey);
        closeSheet();
        toast('已删除');
        render();
        break;
      case 'delete-entry':
        store.deleteEntry(sheetState.entryId, currentKey);
        closeSheet();
        toast('已删除');
        render();
        break;
      case 'delete-advance':
        store.deleteAdvance(sheetState.advanceId, currentKey);
        closeSheet();
        toast('已删除');
        render();
        break;
      case 'reopen-item':
        store.reopenItem(sheetState.itemId, currentKey);
        closeSheet();
        toast('已改回计划中');
        render();
        break;
      case 'settle-whole-item':
        openSettleSheet(sheetState.itemId);
        break;
      case 'open-payment':
        openPaymentSheet(sheetState.itemId);
        break;
      case 'save-payment': {
        const amount = Money.parse(valueOf('payment-amount'));
        if (amount === null || amount <= 0) { toast('请填写正确的金额'); return; }
        const itemId = sheetState.itemId;
        const result = store.addItemPayment(itemId, {
          amount: amount,
          date: fromDateInputValue(valueOf('payment-date')),
          note: valueOf('payment-note')
        }, currentKey);
        closeSheet();
        toast(result.finished
          ? '已付满，标记为已完成'
          : (result.remaining > 0 ? '已记下这笔，还差 ' + Money.format(result.remaining) : '已记下这笔'));
        render();
        break;
      }
      case 'delete-payment': {
        const itemId = sheetState.itemId;
        const paymentNode = event.target.closest('[data-payment-id]');
        store.deleteItemPayment(itemId, paymentNode.getAttribute('data-payment-id'), currentKey);
        openPaymentSheet(itemId);
        render();
        toast('已删除这笔付款');
        break;
      }
      case 'finish-item':
        store.markItemCompleted(sheetState.itemId, currentKey);
        closeSheet();
        toast('已标记完成');
        render();
        break;
      case 'save-day': {
        const amount = Money.parse(valueOf('day-actual-input'));
        if (amount === null || amount < 0) { toast('请填写正确的金额'); return; }
        const dayItemId = sheetState.itemId;
        const dayKey = sheetState.dayKey;
        store.setRecurringDayActual(dayItemId, dayKey, amount, currentKey);
        closeSheet();
        const schedule = core.recurrenceSchedule(store.item(dayItemId, currentKey), new Date());
        toast(schedule && schedule.remainingDays > 0
          ? '已结算这天的生活费，还需预留 ' + Money.format(schedule.remainingAmount)
          : '已结算这天的生活费');
        render();
        break;
      }
      case 'clear-day':
        store.setRecurringDayActual(sheetState.itemId, sheetState.dayKey, null, currentKey);
        closeSheet();
        toast('已恢复按计划推算');
        render();
        break;
      case 'confirm-settle': {
        const amount = Money.parse(valueOf('settle-amount'));
        if (amount === null || amount < 0) { toast('请填写正确的金额'); return; }
        store.completeItem(sheetState.itemId, amount, currentKey);
        closeSheet();
        toast('已结算，计入本月结余');
        render();
        break;
      }
      case 'save-income': {
        const income = Money.parse(valueOf('income-amount'));
        if (income === null || income < 0) { toast('请填写正确的收入金额'); return; }
        const carryText = valueOf('carry-input');
        const carry = carryText === '' ? null : Money.parse(carryText);
        if (carryText !== '' && carry === null) { toast('结转金额格式不对'); return; }
        store.setIncome(income, currentKey);
        store.setCarryOverOverride(carry, currentKey);
        store.setNote(valueOf('month-note'), currentKey);
        closeSheet();
        toast('已保存');
        render();
        break;
      }
      case 'save-settings': {
        const income = Money.parse(valueOf('default-income'));
        if (income === null || income < 0) { toast('请填写正确的金额'); return; }
        store.setDefaultIncome(income);
        closeSheet();
        toast('设置已保存');
        render();
        break;
      }
      case 'copy-last-month': {
        const copied = store.copyItemsFrom(Month.prev(currentKey), currentKey);
        closeSheet();
        toast(copied > 0 ? '已复制 ' + copied + ' 个项目' : '上月没有可复制的项目');
        render();
        break;
      }
      case 'reconcile':
        openReconcileSheet();
        break;
      case 'save-reconcile': {
        const balance = Money.parse(valueOf('reconcile-amount'));
        if (balance === null || balance < 0) { toast('请填写实际余额'); return; }
        const record = store.reconcile(balance, currentKey, valueOf('reconcile-note'));
        closeSheet();
        if (record.difference === 0) {
          toast('账面和实际一致，不用调整');
        } else if (record.difference < 0) {
          toast('已校正：补记支出 ' + Money.format(-record.difference));
        } else {
          toast('已校正：补记收入 ' + Money.format(record.difference));
        }
        render();
        break;
      }
      case 'undo-reconcile': {
        const removed = store.undoReconciliation(currentKey);
        openReconcileSheet();
        render();
        toast(removed ? '已撤销上次对账' : '没有可撤销的对账');
        break;
      }
      case 'export-json':
        exportBackup(false);
        break;
      case 'export-json-dated':
        exportBackup(true);
        break;
      case 'export-csv':
        download('月账本-' + fileStamp() + '.csv', '\ufeff' + store.exportCSV(), 'text/csv;charset=utf-8');
        toast('已导出表格');
        break;
      case 'import-json':
        $('import-file').click();
        break;
      case 'clear-data':
        if (window.confirm('确定清空全部数据吗？建议先导出备份。')) {
          store.reset();
          store.ensureMonth(currentKey);
          closeSheet();
          toast('已清空');
          render();
        }
        break;
      case 'year-prev':
        sheetState.year -= 1;
        $('pick-year').textContent = sheetState.year;
        break;
      case 'year-next':
        sheetState.year += 1;
        $('pick-year').textContent = sheetState.year;
        break;
      case 'jump-today':
        currentKey = Month.current();
        store.ensureMonth(currentKey);
        openMonthPicker();
        render();
        break;
      default:
        break;
    }
  });

  $('sheet').addEventListener('change', function (event) {
    if (event.target && event.target.id === 'import-file') {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        const ok = store.loadJSON(String(reader.result));
        closeSheet();
        if (ok) {
          store.ensureMonth(currentKey);
          toast('已导入备份');
        } else {
          toast('文件格式不对，导入失败');
        }
        render();
      };
      reader.readAsText(file);
      return;
    }

    // 每天明细：填了某天的实际金额，立刻更新预览和这条记录的「省 / 超」标记
    const dayInput = event.target && event.target.closest ? event.target.closest('[data-day-actual]') : null;
    if (dayInput && sheetState && sheetState.kind === 'item') {
      const dayKey = dayInput.getAttribute('data-day-actual');
      const text = dayInput.value.trim();
      const amount = text === '' ? null : Money.parse(text);
      if (text !== '' && amount === null) {
        toast('金额格式不对');
        dayInput.value = '';
      } else {
        if (!sheetState.overrides) sheetState.overrides = {};
        if (amount === null) delete sheetState.overrides[dayKey];
        else sheetState.overrides[dayKey] = amount;
      }
      const preview = $('item-preview');
      if (preview) preview.outerHTML = recurringPreviewHTML();
      const row = dayInput.parentElement;
      const schedule = draftSchedule();
      const day = schedule ? schedule.days.find(function (entry) { return entry.date === dayKey; }) : null;
      const oldDiff = row ? row.querySelector('.day-diff') : null;
      if (oldDiff) oldDiff.remove();
      if (row && day) {
        if (day.diff > 0) row.insertAdjacentHTML('beforeend', '<span class="day-diff bad">超 ' + Money.format(day.diff) + '</span>');
        else if (day.diff < 0) row.insertAdjacentHTML('beforeend', '<span class="day-diff good">省 ' + Money.format(-day.diff) + '</span>');
      }
    }
  });

  // 重复预算表单里改动人数/金额/日期时，实时刷新「后续还需预留」
  $('sheet').addEventListener('input', function (event) {
    const inputTarget = event.target;
    if (inputTarget.id === 'reconcile-amount') {
      const preview = $('reconcile-preview');
      if (preview) preview.innerHTML = reconcilePreviewHTML();
      return;
    }
    if (!sheetState || sheetState.kind !== 'item' || sheetState.mode !== 'daily') return;
    const target = inputTarget;
    if (target.id === 'item-people') {
      const draft = readItemDraft();
      draft.amounts = resizeAmounts(draft.amounts, draft.people);
      renderItemSheet();
      return;
    }
    if (target.hasAttribute('data-person-amount') || target.id === 'item-start' || target.id === 'item-end') {
      const preview = $('item-preview');
      if (preview) preview.outerHTML = recurringPreviewHTML();
      const detail = $('day-detail');
      if (detail) detail.innerHTML = dayDetailInnerHTML();
      return;
    }
  });

  render();

  // ---------------------------------------------------------------- 自检（?selftest=1）

  function runSelfTest() {
    const results = [];
    function check(label, condition, extra) {
      results.push((condition ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  → ' + extra : ''));
      return condition;
    }
    function click(id) {
      const node = $(id);
      if (!node) throw new Error('找不到元素 ' + id);
      node.click();
    }
    function rowText() {
      return $('listArea').textContent;
    }
    /** 手机上「左右晃动」的根因就是横向溢出：页面比视口宽 */
    function checkNoOverflow(label) {
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      check(label + ' 没有横向溢出', overflow <= 1, '超出 ' + overflow + 'px');
    }
    /** 输入框（尤其 iOS 的日期框）右边框不能被顶出屏幕 */
    function checkInputsInside(label, root) {
      const nodes = (root || document).querySelectorAll('input');
      let worst = 0;
      Array.prototype.forEach.call(nodes, function (node) {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0) return;
        worst = Math.max(worst, rect.right - window.innerWidth);
      });
      check(label + ' 的输入框没有超出屏幕', worst <= 0.5, '超出 ' + Math.round(worst) + 'px');
    }
    function checkBodyLocked(label) {
      check(label + ' 打开时锁住了背景页面', document.body.classList.contains('sheet-open'));
    }

    try {
      results.push('INFO  视口 ' + window.innerWidth + 'x' + window.innerHeight + ' dpr=' + window.devicePixelRatio);
      results.push('INFO  本地存储 ' + (storageAvailable ? '可用' : '不可用'));
      store.reset();
      currentKey = { year: 2026, month: 3 };
      activeTab = 'budget';
      store.ensureMonth(currentKey);
      store.setIncome(8000, currentKey);
      render();
      check('初始结余等于月收入', $('heroValue').textContent === Money.format(8000), $('heroValue').textContent);
      check('没备份过会提示备份', !$('backupBanner').classList.contains('hidden'));
      check('提示文案说明风险', $('backupBannerText').textContent.includes('可能被系统清理'));
      click('backupNow');
      check('点了立即备份后提醒消失', $('backupBanner').classList.contains('hidden'));
      check('记下了备份时间', !!store.settings.lastBackupAt);

      click('fab');
      check('点＋打开新增预算表单', !$('sheet').classList.contains('hidden'));
      checkNoOverflow('新增预算面板');
      checkInputsInside('新增预算面板', $('sheet'));
      checkBodyLocked('新增预算面板');
      check('截止日期默认今天', $('item-due').value === todayISO(), $('item-due').value);
      check('截止日期框有正常高度（不会被压扁）',
        $('item-due').getBoundingClientRect().height >= 40,
        Math.round($('item-due').getBoundingClientRect().height) + 'px');
      $('item-name').value = '房租';
      $('item-amount').value = '2500';
      $('sheet').querySelector('[data-chip-value="housing"]').click();
      $('sheet').querySelector('[data-action="save-item"]').click();
      check('新增预算后列表出现该项目', rowText().includes('房租'), rowText().slice(0, 40));
      check('预算计入计划总额', store.summary(currentKey).plannedTotal === 2500);

      $('listArea').querySelector('[data-pay]').click();
      check('点付款打开付款表单', !!$('payment-amount'));
      $('payment-amount').value = '2400';
      $('sheet').querySelector('[data-action="save-payment"]').click();
      const afterSettle = store.summary(currentKey);
      check('付款后已付 2400', afterSettle.paidTotal === 2400);
      check('付款后手里剩 5600', afterSettle.actualBalance === 5600, String(afterSettle.actualBalance));
      check('还没付满，顶部结余仍按计划 2500 留 = 5500',
        $('heroValue').textContent === Money.format(5500), $('heroValue').textContent);
      check('列表显示部分已付', rowText().includes('部分已付'));

      click('tab-ledger');
      click('fab');
      checkNoOverflow('记账面板');
      checkInputsInside('记账面板', $('sheet'));
      $('entry-title').value = '奶茶';
      $('entry-amount').value = '18.5';
      $('entry-date').value = '2026-03-03';
      $('sheet').querySelector('[data-action="save-entry"]').click();
      check('记一笔后出现在列表', rowText().includes('奶茶'));
      check('记账合计 18.5', store.summary(currentKey).ledgerTotal === 18.5);
      check('记账后结余 5581.5', store.summary(currentKey).actualBalance === 5581.5, String(store.summary(currentKey).actualBalance));

      click('tab-advance');
      click('fab');
      checkNoOverflow('预支面板');
      checkInputsInside('预支面板', $('sheet'));
      checkBodyLocked('预支面板');
      check('预支表单说明了两种情形',
        $('sheet').textContent.includes('只占结余') && $('sheet').textContent.includes('不会再扣一遍'));
      $('advance-title').value = '下个月的车票';
      $('advance-amount').value = '700';
      check('归属月份默认下个月',
        $('advance-target-label').textContent === Month.label(Month.next(currentKey)),
        $('advance-target-label').textContent);
      $('sheet').querySelector('[data-target-step="1"]').click();
      check('归属月份可以改', $('advance-target-label').textContent === Month.label(Month.next(Month.next(currentKey))));
      $('sheet').querySelector('[data-target-step="-1"]').click();
      $('sheet').querySelector('[data-action="save-advance"]').click();
      check('新增预支成功', store.advances(currentKey).length === 1);
      check('预支从本月扣钱', store.summary(currentKey).actualBalance === 5581.5 - 700,
        Money.plain(store.summary(currentKey).actualBalance));
      check('预支不算本月的零星支出', store.summary(currentKey).ledgerTotal === 18.5);
      check('列表显示归属月份', rowText().includes('归属'), rowText().slice(0, 40));
      check('预支列表没有「还款/收回」按钮（预支不是借款）',
        !$('listArea').querySelector('[data-repay]'));

      // —— 付款日在未来的预支：只占结余，不扣实际剩余 ——
      // 用「真实今天 + 40 天」保证真的是未来日期（当前月份可能是历史月份）
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 40);
      click('fab');
      $('advance-title').value = '下下个月的机票';
      $('advance-amount').value = '1200';
      $('advance-date').value = toDateInputValue(futureDate.toISOString());
      const beforeFutureAdvance = store.summary(currentKey);
      $('sheet').querySelector('[data-action="save-advance"]').click();
      const afterFutureAdvance = store.summary(currentKey);
      check('付款日在未来时不扣实际剩余',
        Money.cents(afterFutureAdvance.actualBalance) === Money.cents(beforeFutureAdvance.actualBalance),
        Money.plain(beforeFutureAdvance.actualBalance) + ' → ' + Money.plain(afterFutureAdvance.actualBalance));
      check('付款日在未来时要占结余（预留）',
        Money.cents(afterFutureAdvance.plannedBalance) === Money.cents(beforeFutureAdvance.plannedBalance) - 120000,
        Money.plain(beforeFutureAdvance.plannedBalance) + ' → ' + Money.plain(afterFutureAdvance.plannedBalance));
      check('概览出现「预支待预留」', $('statTiles').textContent.includes('预支待预留'));
      check('列表里显示「待预留」', rowText().includes('待预留'));

      click('nextMonth');
      check('下个月会标注「上月已提前支付」', store.summary(currentKey).advanceIncomingTotal === 700,
        Money.plain(store.summary(currentKey).advanceIncomingTotal));
      check('概览有「上月已提前支付」提示', $('statTiles').textContent.includes('上月已提前支付'));
      const nextMonthSummary = store.summary(currentKey);
      check('下个月把这笔已付的钱加回可用额度（抵消本月的记账）',
        Money.cents(nextMonthSummary.actualBalance) ===
          Money.cents(nextMonthSummary.income + nextMonthSummary.carryOver + nextMonthSummary.advanceIncomingTotal),
        Money.plain(nextMonthSummary.actualBalance) + ' vs ' +
        Money.plain(nextMonthSummary.income + nextMonthSummary.carryOver + nextMonthSummary.advanceIncomingTotal));
      click('prevMonth');
      check('回到 3 月', $('monthLabel').textContent === '2026年3月');

      click('openSettings');
      check('设置面板打开', !$('sheet').classList.contains('hidden'));
      checkNoOverflow('设置面板');
      checkInputsInside('设置面板', $('sheet'));
      $('sheet').querySelector('[data-action="export-csv"]').click();
      const csv = store.exportCSV();
      check('CSV 含预算行', csv.includes('2026年3月,预算,房租,居住,2500.00,2400.00,部分已付'));
      check('CSV 含记账行', csv.includes('2026年3月,零星记账,奶茶,餐饮,18.50'));

      // —— 备份导出：固定文件名（覆盖）与带日期两种 ——
      check('设置里有「导出备份（覆盖同一个文件）」', !!$('sheet').querySelector('[data-action="export-json"]'));
      check('设置里有「导出带日期的备份」', !!$('sheet').querySelector('[data-action="export-json-dated"]'));
      store.state.settings.lastBackupAt = null;
      render();
      $('sheet').querySelector('[data-action="export-json-dated"]').click();
      check('带日期备份会记录备份时间', !!store.settings.lastBackupAt);
      store.state.settings.lastBackupAt = null;
      render();
      $('sheet').querySelector('[data-action="export-json"]').click();
      check('固定文件名备份也会记录备份时间', !!store.settings.lastBackupAt);
      $('sheet').querySelector('[data-action="close"]').click();

      // —— 关闭自动结转后，手动填的结转金额仍然要计入当月 ——
      click('openSettings');
      $('sheet').querySelector('[data-toggle="carry-over"]').click();
      check('可以关闭自动结转', store.settings.carryOverEnabled === false);
      $('sheet').querySelector('[data-action="close"]').click();
      const beforeManualCarry = store.summary(currentKey).actualBalance;
      click('hero');
      check('打开收入与结转面板', !!$('carry-input'));
      $('carry-input').value = '1234';
      $('sheet').querySelector('[data-action="save-income"]').click();
      check('关闭自动结转后，手动填的结转会计入当月',
        store.summary(currentKey).carryOver === 1234, Money.plain(store.summary(currentKey).carryOver));
      check('手动结转也算进结余',
        Money.cents(store.summary(currentKey).actualBalance) === Money.cents(beforeManualCarry) + 123400,
        Money.plain(beforeManualCarry) + ' → ' + Money.plain(store.summary(currentKey).actualBalance));
      store.setCarryOverOverride(null, currentKey);
      store.setCarryOverEnabled(true);
      render();

      click('nextMonth');
      check('关闭弹层后背景解除锁定', !document.body.classList.contains('sheet-open'));
      check('切到 4 月', $('monthLabel').textContent === '2026年4月', $('monthLabel').textContent);
      // 3 月：收入 8000 − 房租 2400 − 奶茶 18.5 − 预支的车票 700 = 4881.5
      check('4 月自动结转 4881.5', store.summary(currentKey).carryOver === 4881.5, String(store.summary(currentKey).carryOver));
      click('monthLabel');
      check('月份选择器打开', !!$('pick-year'));
      $('sheet').querySelector('[data-month="3"]').click();
      check('选回 3 月', $('monthLabel').textContent === '2026年3月');
      $('sheet').querySelector('[data-action="close"]').click();

      click('monthLabel');
      $('sheet').querySelector('[data-action="year-next"]').click();
      check('年份可以切换', $('pick-year').textContent === '2027', $('pick-year').textContent);
      $('sheet').querySelector('[data-action="jump-today"]').click();
      check('回到本月', Month.equals(currentKey, Month.current()));
      $('sheet').querySelector('[data-action="close"]').click();

      // —— 新增功能：宠物分类 / 按天重复预算 / 收入记账 ——
      click('tab-budget');
      click('fab');
      check('分类里有宠物', !!$('sheet').querySelector('[data-chip-value="pet"]'));
      $('item-name').value = '生活费';
      $('sheet').querySelector('[data-mode="daily"]').click();
      check('切到按天重复模式', !!$('item-people') && !!$('item-preview'));
      checkNoOverflow('新增预算面板（按天重复）');
      checkInputsInside('新增预算面板（按天重复）', $('sheet'));
      check('默认两个人两个金额输入框', $('sheet').querySelectorAll('[data-person-amount]').length === 2);
      $('sheet').querySelector('[data-people="1"]').click();
      check('加一个人变成三个输入框', $('sheet').querySelectorAll('[data-person-amount]').length === 3);
      const personInputs = $('sheet').querySelectorAll('[data-person-amount]');
      personInputs[0].value = '50';
      personInputs[1].value = '40';
      personInputs[2].value = '30';
      $('sheet').querySelector('[data-chip-value="family"]').click();
      $('sheet').querySelector('[data-action="save-item"]').click();
      const recurringItem = store.items(currentKey).find(function (item) { return item.name === '生活费'; });
      check('保存成重复预算', !!recurringItem && core.isRecurring(recurringItem));
      const schedule = recurringItem ? core.recurrenceSchedule(recurringItem, new Date()) : null;
      check('每人金额不同也能算每天合计 120', !!schedule && schedule.dailyTotal === 120, schedule ? String(schedule.dailyTotal) : '无');
      check('计划总额 = 每天 × 天数', !!schedule && schedule.plannedAmount === Money.round(120 * schedule.totalDays));
      check('已发生 + 还需预留 = 计划总额',
        !!schedule && Money.cents(schedule.spentSoFar) + Money.cents(schedule.remainingAmount) === Money.cents(schedule.plannedAmount));
      check('预算列表显示「还需留」', rowText().includes('还需留'), rowText().slice(0, 60));
      const withRecurring = store.summary(currentKey);
      check('概览有「重复预算待预留」', $('statTiles').textContent.includes('重复预算待预留'));
      check('待预留金额与日程一致', Money.cents(withRecurring.recurringRemainingTotal) === Money.cents(schedule.remainingAmount));
      check('结余 = 收入 + 结转 + 零星收入 − 预算总额 − 零星支出 − 预支未还',
        Money.cents(withRecurring.plannedBalance) === Money.cents(
          withRecurring.income + withRecurring.carryOver + withRecurring.ledgerIncomeTotal
          + withRecurring.advanceIncomingTotal
          - withRecurring.committedBudget - withRecurring.ledgerTotal
          - withRecurring.advancePaidTotal - withRecurring.advanceReservedTotal
        ));
      check('顶部结余显示扣完预算后的金额',
        $('heroValue').textContent === Money.format(withRecurring.plannedBalance),
        $('heroValue').textContent + ' vs ' + Money.format(withRecurring.plannedBalance));
      check('结余 + 未花预算 + 预支待预留 = 实际剩余',
        Money.cents(withRecurring.plannedBalance + withRecurring.unspentBudget + withRecurring.advanceReservedTotal)
          === Money.cents(withRecurring.actualBalance),
        Money.plain(withRecurring.plannedBalance) + ' + ' + Money.plain(withRecurring.unspentBudget) +
        ' + ' + Money.plain(withRecurring.advanceReservedTotal) +
        ' vs ' + Money.plain(withRecurring.actualBalance));

      // —— 生活费每日结算 ——
      $('listArea').querySelector('[data-edit-item="' + recurringItem.id + '"]').click();
      check('每天明细默认收起（页面不用再滚半天）',
        $('sheet').querySelectorAll('.day-row').length === 0,
        $('sheet').querySelectorAll('.day-row').length + ' 行');
      check('收起时给出汇总和展开按钮',
        $('sheet').textContent.includes('已结算') && !!$('sheet').querySelector('[data-toggle-days]'));
      $('sheet').querySelector('[data-toggle-days]').click();
      check('展开后能看到整月每天明细',
        $('sheet').querySelectorAll('.day-row').length === Month.dayCount(currentKey),
        $('sheet').querySelectorAll('.day-row').length + ' 行');
      check('未来的天显示「待预留」', $('sheet').textContent.includes('待预留'));
      const todayKey = core.dayString(new Date());
      check('今天可以填实际金额', !!$('sheet').querySelector('[data-day-actual="' + todayKey + '"]'));
      const firstDayKey = core.dayString(Month.startDate(currentKey));
      const firstDayRow = $('sheet').querySelector('[data-day-actual="' + firstDayKey + '"]');
      check('本月 1 号在明细里', !!firstDayRow);
      const balanceBeforeDaySettle = store.summary(currentKey).plannedBalance;
      firstDayRow.value = '100';
      firstDayRow.dispatchEvent(new Event('change', { bubbles: true }));
      check('少花时立刻显示「省」', $('sheet').textContent.includes('省 ¥20.00'), $('sheet').textContent.slice(0, 80));
      $('sheet').querySelector('[data-action="save-item"]').click();
      const afterDaySettle = core.recurrenceSchedule(
        store.items(currentKey).find(function (item) { return item.name === '生活费'; }), new Date());
      check('保存后这天的记录生效', afterDaySettle.settledDays === 1 && Money.cents(afterDaySettle.savedSoFar) === 2000,
        '已结算 ' + afterDaySettle.settledDays + ' 天，省 ' + Money.plain(afterDaySettle.savedSoFar));
      check('省下的 20 立刻回到结余里',
        Money.cents(store.summary(currentKey).plannedBalance) === Money.cents(balanceBeforeDaySettle) + 2000,
        Money.plain(store.summary(currentKey).plannedBalance) + ' vs ' + Money.plain(balanceBeforeDaySettle));
      check('列表里显示已省', rowText().includes('已省'));

      const livingItem = store.items(currentKey).find(function (item) { return item.name === '生活费'; });
      const scheduleBeforeToday = core.recurrenceSchedule(livingItem, new Date());
      $('listArea').querySelector('[data-settle-day]').click();
      check('打开「记今天」面板', !!$('day-actual-input'));
      const todayPlan = scheduleBeforeToday.dailyTotal;
      $('day-actual-input').value = String(todayPlan + 50);
      $('sheet').querySelector('[data-action="save-day"]').click();
      const scheduleAfterToday = core.recurrenceSchedule(
        store.items(currentKey).find(function (item) { return item.name === '生活费'; }), new Date());
      check('今天结算后按实际算（待预留天数不变）',
        scheduleAfterToday.remainingDays === scheduleBeforeToday.remainingDays &&
        Money.cents(scheduleAfterToday.spentSoFar) === Money.cents(scheduleBeforeToday.spentSoFar) + 5000,
        '已发生 ' + Money.plain(scheduleBeforeToday.spentSoFar) + ' → ' + Money.plain(scheduleAfterToday.spentSoFar));
      check('今天花超的 50 被记账', Money.cents(scheduleAfterToday.overrunSoFar) === 5000,
        '超 ' + Money.plain(scheduleAfterToday.overrunSoFar));
      check('列表里显示已超', rowText().includes('已超'));
      const afterOverspend = store.summary(currentKey);
      check('超支后结余口径仍然成立',
        Money.cents(afterOverspend.plannedBalance) === Money.cents(
          afterOverspend.income + afterOverspend.carryOver + afterOverspend.ledgerIncomeTotal
          - afterOverspend.committedBudget - afterOverspend.ledgerTotal
          - afterOverspend.advancePaidTotal - afterOverspend.advanceReservedTotal));
      check('超支让承诺额变高',
        Money.cents(afterOverspend.committedBudget) === Money.cents(scheduleAfterToday.committedAmount),
        Money.plain(afterOverspend.committedBudget));

      $('listArea').querySelector('[data-settle-day]').click();
      check('已经填过的那天可以取消记录', !!$('sheet').querySelector('[data-action="clear-day"]'));
      $('sheet').querySelector('[data-action="clear-day"]').click();
      const scheduleAfterClear = core.recurrenceSchedule(
        store.items(currentKey).find(function (item) { return item.name === '生活费'; }), new Date());
      check('取消后恢复按计划推算', Money.cents(scheduleAfterClear.overrunSoFar) === 0 && scheduleAfterClear.settledDays === 1);

      // —— 预算项目分次结算 ——
      click('tab-budget');
      click('fab');
      $('item-name').value = '装修';
      $('item-amount').value = '3000';
      $('sheet').querySelector('[data-action="save-item"]').click();
      const buildItem = store.items(currentKey).find(function (item) { return item.name === '装修'; });
      check('列表出现「付款」按钮', !!$('listArea').querySelector('[data-pay="' + buildItem.id + '"]'));

      $('listArea').querySelector('[data-pay="' + buildItem.id + '"]').click();
      check('打开付款面板', !!$('payment-amount'));
      check('预填还差的钱', $('payment-amount').value === '3000', $('payment-amount').value);
      $('payment-amount').value = '1000';
      $('sheet').querySelector('[data-action="save-payment"]').click();
      check('第一笔付款记下了', core.itemPaymentsTotal(store.item(buildItem.id, currentKey)) === 1000);
      check('没付完就不算完成', store.item(buildItem.id, currentKey).status === 'planned');
      check('列表显示「部分已付」', rowText().includes('部分已付'));
      check('列表显示还差多少', rowText().includes('还差'));

      // 删除付款记录（之前这里有 bug：按钮没接上事件，点了没反应）
      $('listArea').querySelector('[data-pay="' + buildItem.id + '"]').click();
      check('付款面板能看到付款记录', !!$('sheet').querySelector('[data-payment-id]'));
      $('sheet').querySelector('[data-payment-id]').click();
      check('删除这笔付款后已付归零',
        core.itemPaymentsTotal(store.item(buildItem.id, currentKey)) === 0,
        String(core.itemPaymentsTotal(store.item(buildItem.id, currentKey))));
      closeSheet();
      render();
      check('删掉付款后列表回到「计划中」', rowText().includes('计划中'));

      $('listArea').querySelector('[data-pay="' + buildItem.id + '"]').click();
      $('payment-amount').value = '1000';
      $('sheet').querySelector('[data-action="save-payment"]').click();

      $('listArea').querySelector('[data-pay="' + buildItem.id + '"]').click();
      check('第二笔预填剩余 2000', $('payment-amount').value === '2000', $('payment-amount').value);
      check('付款记录里能看到第一笔', $('sheet').textContent.includes('付款记录'));
      $('payment-amount').value = '2000';
      $('sheet').querySelector('[data-action="save-payment"]').click();
      const buildDone = store.item(buildItem.id, currentKey);
      check('付满自动标记完成', buildDone.status === 'completed');
      check('两次付款合计 3000', core.itemPaymentsTotal(buildDone) === 3000);
      check('列表显示已完成', rowText().includes('已完成'));

      // —— 余额对账：漏记几笔时用实际余额校正 ——
      const liveItem = store.items(currentKey).find(function (item) { return item.name === '生活费'; });
      store.setRecurringDayActual(liveItem.id, core.dayString(new Date()), core.recurrenceSchedule(liveItem, new Date()).dailyTotal, currentKey);
      store.addEntry({ title: '对账前的漏记', amount: 300, category: 'other', date: new Date().toISOString() }, currentKey);
      const beforeReconcile = store.summary(currentKey);
      const targetBalance = Money.round(beforeReconcile.bookBalance - 250);

      click('tab-budget');
      check('概览「实际剩余」卡片有对账按钮', !!$('statTiles').querySelector('[data-reconcile]'));
      $('statTiles').querySelector('[data-reconcile]').click();
      check('打开对账面板', !!$('reconcile-amount'));
      check('面板显示账面剩余', $('sheet').textContent.includes(Money.format(beforeReconcile.bookBalance)));
      $('reconcile-amount').value = String(targetBalance);
      $('reconcile-amount').dispatchEvent(new Event('input', { bubbles: true }));
      check('实时显示差额与方向', $('sheet').textContent.includes('说明有 ¥250.00 支出没记上'),
        $('sheet').textContent.match(/说明有[^0-9]*[\d,.]+ 支出没记上/) ? '有提示' : '缺少提示');
      $('sheet').querySelector('[data-action="save-reconcile"]').click();
      const afterReconcile = store.summary(currentKey);
      check('对账后实际剩余 = 填写的余额',
        Money.cents(afterReconcile.actualBalance) === Money.cents(targetBalance),
        Money.plain(afterReconcile.actualBalance) + ' vs ' + Money.plain(targetBalance));
      check('对账后结余同步校正',
        Money.cents(afterReconcile.plannedBalance) === Money.cents(beforeReconcile.plannedBalance) - 25000,
        Money.plain(afterReconcile.plannedBalance) + ' vs ' + Money.plain(beforeReconcile.plannedBalance));
      check('顶部结余跟着变', $('heroValue').textContent === Money.format(afterReconcile.plannedBalance));
      check('概览出现「对账调整」卡片', $('statTiles').textContent.includes('对账调整'));
      check('结余 + 未花预算 + 预支待预留 = 实际剩余（对账后仍成立）',
        Money.cents(afterReconcile.plannedBalance + afterReconcile.unspentBudget + afterReconcile.advanceReservedTotal)
          === Money.cents(afterReconcile.actualBalance),
        Money.plain(afterReconcile.plannedBalance) + ' + ' + Money.plain(afterReconcile.unspentBudget) +
        ' + ' + Money.plain(afterReconcile.advanceReservedTotal) + ' vs ' + Money.plain(afterReconcile.actualBalance));

      $('statTiles').querySelector('[data-reconcile]').click();
      const secondRecord = store.reconcile(targetBalance, currentKey, '再对一次');
      check('重复对账不会叠加', Money.cents(store.summary(currentKey).actualBalance) === Money.cents(targetBalance),
        '第二次差额 ' + Money.plain(secondRecord.difference) + '，余额仍为 ' + Money.plain(store.summary(currentKey).actualBalance));
      check('可以撤销对账', !!store.undoReconciliation(currentKey));
      store.undoReconciliation(currentKey);
      check('撤销全部对账后回到账面余额',
        Money.cents(store.summary(currentKey).actualBalance) === Money.cents(store.summary(currentKey).bookBalance));
      closeSheet();
      render();

      click('tab-ledger');
      click('fab');
      check('记账表单有收入选项', !!$('sheet').querySelector('[data-direction="income"]'));
      $('sheet').querySelector('[data-direction="income"]').click();
      $('entry-title').value = '报销到账';
      $('entry-amount').value = '300';
      const balanceBeforeIncome = store.summary(currentKey).actualBalance;
      $('sheet').querySelector('[data-action="save-entry"]').click();
      const withIncome = store.summary(currentKey);
      check('零星收入加回结余', Money.cents(withIncome.actualBalance) === Money.cents(balanceBeforeIncome) + 30000,
        Money.plain(withIncome.actualBalance) + ' vs ' + Money.plain(balanceBeforeIncome));
      check('收入不计入支出合计', withIncome.ledgerIncomeTotal === 300);
      check('列表里显示 +¥300.00', rowText().includes('+¥300.00'), rowText().slice(0, 60));
      check('CSV 里有零星收入行', store.exportCSV().includes('零星收入,报销到账'));

      const previousMonth = Month.prev(Month.current());
      click('fab');
      $('entry-title').value = '上月补记';
      $('entry-amount').value = '66';
      $('entry-date').value = toDateInputValue(Month.startDate(previousMonth).toISOString());
      $('sheet').querySelector('[data-action="save-entry"]').click();
      check('日期属于上月时自动记到上月',
        Month.equals(currentKey, previousMonth) &&
        store.entries(currentKey).some(function (entry) { return entry.title === '上月补记'; }),
        Month.label(currentKey));
      currentKey = Month.current();
      render();

      const failed = results.filter(function (line) { return line.indexOf('FAIL') === 0; });
      document.title = failed.length === 0 ? 'SELFTEST OK' : 'SELFTEST FAIL';
    } catch (error) {
      results.push('FAIL  抛出异常: ' + error.message);
      document.title = 'SELFTEST FAIL';
    }

    const box = document.createElement('pre');
    box.className = 'selftest';
    box.id = 'selftestOutput';
    box.textContent = results.join('\n');
    document.body.appendChild(box);
  }

  if (window.location.search.indexOf('selftest=1') >= 0) {
    runSelfTest();
  }

  // 第二阶段：重新打开页面，检查上一轮的数据是否真的落在本机。
  if (window.location.search.indexOf('selftest=persist') >= 0) {
    const results = [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const marchMonth = parsed && (parsed.months || []).find(function (m) { return m.year === 2026 && m.month === 3; });
      results.push((parsed ? 'PASS  ' : 'FAIL  ') + '重新打开后读到了本地数据');
      results.push((marchMonth ? 'PASS  ' : 'FAIL  ') + '3 月账期还在');
      results.push((marchMonth && marchMonth.items.some(function (i) { return i.name === '房租'; }) ? 'PASS  ' : 'FAIL  ') + '预算项目「房租」还在');
      results.push((marchMonth && marchMonth.ledgerEntries.some(function (e) { return e.title === '奶茶'; }) ? 'PASS  ' : 'FAIL  ') + '记账「奶茶」还在');
      const ticket = marchMonth && marchMonth.advances.find(function (a) { return a.title === '下个月的车票'; });
      results.push((ticket ? 'PASS  ' : 'FAIL  ') + '预支记录还在');
      results.push((ticket && ticket.amount === 700 ? 'PASS  ' : 'FAIL  ') + '预支金额保留');
      results.push((ticket && ticket.targetMonth === 4 ? 'PASS  ' : 'FAIL  ') + '预支归属月份保留');
    } catch (error) {
      results.push('FAIL  读取本地数据出错: ' + error.message);
    }
    const box = document.createElement('pre');
    box.className = 'selftest';
    box.id = 'selftestPersist';
    box.textContent = results.join('\n');
    document.body.appendChild(box);
    document.title = results.some(function (line) { return line.indexOf('FAIL') === 0; }) ? 'SELFTEST FAIL' : 'SELFTEST OK';
  }

  // ?sample=1 用于演示/截图：当前月份没有数据时自动填入一套示例。
  if (window.location.search.indexOf('sample=1') >= 0) {
    const seedKey = Month.current();
    if (store.items(seedKey).length === 0) {
      core.SampleData.seed(store, seedKey);
      render();
    }
  }

  // ?sheet=item / ?sheet=entry 用于演示/截图：直接打开对应表单
  const sheetParam = urlParams.get('sheet');
  if (sheetParam === 'item') openItemSheet(null);
  // ?sheet=daily 直接打开「按天重复」项目的编辑面板（演示/截图用）
  if (sheetParam === 'daily') {
    const recurring = store.items(currentKey).find(function (item) { return core.isRecurring(item); });
    openItemSheet(recurring ? recurring.id : null);
  }
  if (sheetParam === 'entry') openEntrySheet(null);
  if (sheetParam === 'advance') openAdvanceSheet(null);
  if (sheetParam === 'reconcile') openReconcileSheet();
  if (sheetParam === 'settings') openSettingsSheet();

  // 跨天 / 从后台切回前台时自动刷新：生活费按天推进的数字不会「过期」。
  let lastRenderedDay = core.dayString(new Date());
  function refreshIfDayChanged() {
    const today = core.dayString(new Date());
    if (today !== lastRenderedDay) {
      lastRenderedDay = today;
      render();
    }
  }
  window.setInterval(refreshIfDayChanged, 60 * 1000);
  window.addEventListener('focus', function () { refreshIfDayChanged(); render(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      refreshIfDayChanged();
      render();
    }
  });

  // 离线缓存：第一次打开就把整份文件存在手机里，之后断网也能用。
  if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    // 新版本装上后自动刷新一次，省得用户手动刷两遍
    const pageWasControlled = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!pageWasControlled || reloading) return;
      reloading = true;
      window.location.reload();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 离线能力失败不影响使用 */ });
    });
  }

  // ?offline=1 用于验证「断网也能打开」：把结果写进页面，方便自动化检查
  if (window.location.search.indexOf('offline=1') >= 0) {
    const lines = [];
    lines.push('版本: ' + core.VERSION);
    lines.push('页面已渲染: ' + ($('heroValue') ? $('heroValue').textContent : '无'));
    lines.push('本地数据可读: ' + (function () {
      try {
        return (window.localStorage.getItem(STORAGE_KEY) || '空').slice(0, 60);
      } catch (error) {
        return '不可读';
      }
    })());
    lines.push('离线缓存接管: ' + (navigator.serviceWorker && navigator.serviceWorker.controller ? '是' : '否'));
    const box = document.createElement('pre');
    box.className = 'selftest';
    box.id = 'offlineReport';
    box.textContent = 'OFFLINE OK\n' + lines.join('\n');
    document.body.appendChild(box);
    document.title = 'OFFLINE OK';
  }
})();
