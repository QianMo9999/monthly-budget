var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/core/lifecycle/sheet-stack.ts
var BASE_Z = 100;
var STEP = 10;
var SheetStack = class {
  constructor() {
    __publicField(this, "entries", []);
  }
  push(entry) {
    this.entries.push(entry);
    this.recompute();
    return () => this.remove(entry.id);
  }
  remove(id) {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return;
    this.entries.splice(idx, 1);
    this.recompute();
  }
  promote(id) {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return;
    if (idx !== this.entries.length - 1) {
      const [entry] = this.entries.splice(idx, 1);
      this.entries.push(entry);
    }
    this.recompute();
  }
  update() {
    this.recompute();
  }
  size() {
    return this.entries.length;
  }
  depthOf(id) {
    const open = [];
    for (const entry of this.entries) {
      if (!entry.isOpen || entry.isOpen()) open.push(entry);
    }
    const idx = open.findIndex((e) => e.id === id);
    if (idx === -1) return 0;
    return open.length - 1 - idx;
  }
  clear() {
    this.entries = [];
  }
  recompute() {
    let top = null;
    const open = [];
    for (const entry of this.entries) {
      if (!entry.isOpen || entry.isOpen()) {
        top = entry;
        open.push(entry);
      }
    }
    if (!top && this.entries.length > 0) {
      top = this.entries[this.entries.length - 1];
    }
    this.entries.forEach((entry, i) => {
      entry.setZIndex(BASE_Z + i * STEP);
      entry.setIsTop(entry === top);
      if (entry.setDepth) {
        const openIdx = open.indexOf(entry);
        entry.setDepth(openIdx === -1 ? 0 : open.length - 1 - openIdx);
      }
    });
  }
};
var sheetStack = new SheetStack();

// src/core/primitives/transform.ts
function buildTransformTemplate(axis) {
  switch (axis) {
    case "bottom":
      return (offset) => `translate3d(0, ${offset}px, 0)`;
    case "top":
      return (offset) => `translate3d(0, ${-offset}px, 0)`;
    case "left":
      return (offset) => `translate3d(${-offset}px, 0, 0)`;
    case "right":
      return (offset) => `translate3d(${offset}px, 0, 0)`;
  }
}
var layoutAxis = (axis) => axis === "left" || axis === "right" ? "width" : "height";

// src/core/primitives/instance-id.ts
var counters = {};
function nextInstanceId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}-${counters[prefix]}`;
}

// src/core/primitives/event-bus.ts
function createEventBus() {
  const listeners = /* @__PURE__ */ new Map();
  return {
    on(event, fn) {
      let set = listeners.get(event);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        listeners.set(event, set);
      }
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        fn(payload);
      }
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
    clear() {
      listeners.clear();
    }
  };
}

// src/core/primitives/css-length.ts
var probe = null;
var PROBE_ATTR = "data-bs-probe";
var ensureProbe = (axis) => {
  if (typeof document === "undefined") return null;
  if (!probe || !probe.isConnected) {
    const existing = document.querySelector(`[${PROBE_ATTR}]`);
    if (existing) {
      probe = existing;
    } else {
      probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.setAttribute(PROBE_ATTR, "");
      probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;contain:strict;left:0;top:0;width:0;height:0;";
      document.body.appendChild(probe);
    }
  }
  if (axis === "vertical") {
    probe.style.width = "0";
    probe.style.height = "";
  } else {
    probe.style.height = "0";
    probe.style.width = "";
  }
  return probe;
};
var isViewportAxisVertical = (mode) => mode === "bottom" || mode === "top";
var viewportSize = (mode) => {
  if (typeof window === "undefined") return 0;
  return isViewportAxisVertical(mode) ? window.innerHeight : window.innerWidth;
};
var PERCENT = /^(-?\d+(?:\.\d+)?)%$/;
var resolveSnap = (point, mode, measureFit) => {
  if (typeof point === "number") return Math.max(0, point);
  if (point === "full") return viewportSize(mode);
  if (point === "fit" || point === "content") {
    return Math.max(0, measureFit?.() ?? 0);
  }
  const pctMatch = point.match(PERCENT);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]) / 100;
    return Math.max(0, viewportSize(mode) * pct);
  }
  const axis = isViewportAxisVertical(mode) ? "vertical" : "horizontal";
  const el = ensureProbe(axis);
  if (!el) return 0;
  if (axis === "vertical") {
    el.style.height = point;
    return Math.max(0, el.getBoundingClientRect().height);
  }
  el.style.width = point;
  return Math.max(0, el.getBoundingClientRect().width);
};

// src/core/primitives/dev-warn.ts
function devWarn(...args) {
  if (typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production" && typeof console !== "undefined") {
    console.warn(...args);
  }
}

// src/core/primitives/snap-points.ts
var resolveSnapList = (points, mode, measureFit) => points.map((p) => {
  const raw = resolveSnap(p.size, mode, measureFit);
  if (!Number.isFinite(raw) || raw < 0) {
    devWarn(
      `[BottomSheet] snap "${p.id}" resolved to invalid size (${String(p.size)} \u2192 ${raw}); clamped to 0.`
    );
    return { id: p.id, size: 0 };
  }
  return { id: p.id, size: raw };
}).sort((a, b) => a.size - b.size);
var VH_NOT_DVH = /(^|[^a-z])vh\b/i;
var auditVhUsage = (points) => {
  for (const p of points) {
    if (typeof p.size !== "string") continue;
    if (!VH_NOT_DVH.test(p.size)) continue;
    devWarn(
      `[BottomSheet] snap "${p.id}" uses "vh" \u2014 prefer "dvh" on mobile (iOS Safari URL bar makes vh unstable). See https://web.dev/blog/viewport-units`
    );
  }
};
var findNearest = (size, resolved, allowed, direction = 0, bias = 0) => {
  const pool = resolved.filter((p) => allowed.includes(p.id));
  if (pool.length === 0) return null;
  const target = size + direction * bias;
  let best = pool[0];
  let bestDist = Math.abs(target - best.size);
  for (let i = 1; i < pool.length; i++) {
    const cand = pool[i];
    const dist = Math.abs(target - cand.size);
    if (dist < bestDist) {
      best = cand;
      bestDist = dist;
    }
  }
  return best;
};
var allowedRange = (resolved, allowed) => {
  const pool = resolved.filter((p) => allowed.includes(p.id));
  if (pool.length === 0) return { min: 0, max: 0 };
  return {
    min: pool[0].size,
    max: pool[pool.length - 1].size
  };
};
var findById = (id, resolved) => resolved.find((p) => p.id === id) ?? null;
var MOUSE_FLICK_VELOCITY = 0.4;
var MOUSE_DRAG_THRESHOLD = 12;
var DIRECTIONAL_INTENT_VELOCITY = 0.15;
var findDragSettleTarget = (input) => {
  const speed = Math.abs(input.velocity);
  const flickThreshold = input.pointerKind === "mouse" ? MOUSE_FLICK_VELOCITY : input.flickVelocity;
  const dragThresh = input.pointerKind === "mouse" ? MOUSE_DRAG_THRESHOLD : input.dragThreshold;
  let direction = 0;
  if (speed > flickThreshold || speed > DIRECTIONAL_INTENT_VELOCITY) {
    direction = input.velocity > 0 ? 1 : -1;
  }
  if (Math.abs(input.delta) < dragThresh && direction === 0) {
    return findById(input.activeId, input.resolved);
  }
  const speedBias = speed > flickThreshold ? Math.min(speed * 180, input.maxAxisSize) : 0;
  return findNearest(
    input.size,
    input.resolved,
    input.allowed,
    direction,
    speedBias
  );
};

// src/core/primitives/cancelable-emit.ts
function emitCancelable(emit, base, warnLabel) {
  let cancelled = false;
  let frozen = false;
  emit({
    ...base,
    cancel: () => {
      if (frozen) {
        devWarn(
          `[BottomSheet] ${warnLabel}.cancel() called asynchronously \u2014 ignored. cancel() must be invoked synchronously inside the listener.`
        );
        return;
      }
      cancelled = true;
    }
  });
  frozen = true;
  return cancelled;
}

// src/core/primitives/snap-resolver.ts
var SnapResolver = class {
  constructor(raw, allowed, mode, measureFit, onMaxAxisSizeChange) {
    __publicField(this, "mode", mode);
    __publicField(this, "measureFit", measureFit);
    __publicField(this, "onMaxAxisSizeChange", onMaxAxisSizeChange);
    __publicField(this, "raw");
    __publicField(this, "allowedIds");
    __publicField(this, "resolved", []);
    __publicField(this, "maxAxisSize", 0);
    __publicField(this, "rangeCache", null);
    __publicField(this, "notified", false);
    this.raw = raw;
    this.allowedIds = allowed ?? raw.map((p) => p.id);
    this.recompute();
  }
  recompute() {
    const measure = this.measureFit;
    let measured;
    const measureOnce = measure ? () => measured ?? (measured = measure()) : void 0;
    this.resolved = resolveSnapList(this.raw, this.mode, measureOnce);
    const nextMax = this.resolved.reduce(
      (m, s) => s.size > m ? s.size : m,
      0
    );
    this.rangeCache = null;
    const changed = nextMax !== this.maxAxisSize || !this.notified;
    this.maxAxisSize = nextMax;
    this.notified = true;
    if (changed) this.onMaxAxisSizeChange?.(this.maxAxisSize);
  }
  setRaw(raw) {
    this.raw = raw;
    this.recompute();
  }
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.recompute();
  }
  setAllowedIds(ids) {
    this.allowedIds = ids;
    this.rangeCache = null;
  }
  findById(id) {
    return findById(id, this.resolved);
  }
  findDragSettleTarget(args) {
    return findDragSettleTarget({
      ...args,
      resolved: this.resolved,
      allowed: this.allowedIds,
      maxAxisSize: this.maxAxisSize
    });
  }
  getAllowedRange() {
    return this.rangeCache ?? (this.rangeCache = allowedRange(this.resolved, this.allowedIds));
  }
  getResolvedSnaps() {
    return this.resolved;
  }
  getAllowedIds() {
    return this.allowedIds;
  }
  getMaxAxisSize() {
    return this.maxAxisSize;
  }
  setMaxAxisSize(n) {
    this.maxAxisSize = n;
    this.onMaxAxisSizeChange?.(n);
  }
};

// src/core/features/linked-sheets.ts
function notifyLinkedSheets(sheets, self) {
  if (sheets.length === 0) return;
  for (const linked of sheets) {
    if (linked === self) continue;
    try {
      if (linked.state.size === 0) continue;
      const ids = linked.getAllowedIds();
      const resolved = linked.getResolvedSnaps();
      const sizeOf = (id) => resolved.find((s) => s.id === id)?.size ?? 0;
      const target = ids.find((id) => sizeOf(id) > 0);
      if (target && target !== linked.state.activeId) {
        void linked.snapTo(target);
      }
    } catch (err) {
      queueMicrotask(() => {
        throw err;
      });
    }
  }
}

// src/core/primitives/hot-path-thresholds.ts
var SIZE_WRITE_EPSILON = 0.5;
var OPACITY_WRITE_EPSILON = 5e-3;
var POINTER_EVENTS_OPACITY_THRESHOLD = 0.05;
var RANGE_DIVISION_EPSILON = 1e-4;

// src/core/features/resize-observer.ts
function installResizeObserver(deps) {
  if (typeof window === "undefined") {
    return () => {
    };
  }
  const seatFor = () => {
    const snap = deps.resolveActiveSnap();
    const max = deps.getMaxAxisSize();
    return { target: snap ? Math.min(snap.size, max) : null, max };
  };
  const onResize = () => {
    if (deps.isDestroyed()) return;
    const before = seatFor();
    deps.recomputeSnaps();
    const mode = deps.getMode();
    const isVerticalAxis = mode === "bottom" || mode === "top";
    const viewportSize2 = isVerticalAxis ? window.innerHeight : window.innerWidth;
    const max = deps.getMaxAxisSize();
    if (viewportSize2 > 0 && viewportSize2 < max) {
      deps.setMaxAxisSize(viewportSize2);
    }
    const after = seatFor();
    if (before.target !== null && after.target !== null && Math.abs(after.target - before.target) < SIZE_WRITE_EPSILON && Math.abs(after.max - before.max) < SIZE_WRITE_EPSILON) {
      return;
    }
    const wasAnimating = deps.isAnimating?.() ?? false;
    deps.cancelInFlight();
    deps.newCycle();
    const current = deps.resolveActiveSnap();
    const newMax = deps.getMaxAxisSize();
    const targetSize = current ? Math.min(current.size, newMax) : Math.min(deps.getSize(), newMax);
    deps.setSize(targetSize);
    if (current && !deps.isDragging()) {
      deps.applySize(targetSize);
      if (wasAnimating) deps.resyncAfterCancel?.();
    }
  };
  let resizeObserver = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(document.documentElement);
  } else {
    window.addEventListener("resize", onResize);
  }
  window.addEventListener("orientationchange", onResize);
  const onVisibility = () => {
    if (deps.isDestroyed()) return;
    if (document.hidden) deps.cancelInFlight();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    resizeObserver?.disconnect();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

// src/core/features/fit-observer.ts
var contentTargets = (scroller) => {
  if (!scroller) return [];
  const hasSlot = typeof HTMLSlotElement !== "undefined";
  const out = [];
  for (const child of Array.from(scroller.children)) {
    if (hasSlot && child instanceof HTMLSlotElement) {
      for (const el of child.assignedElements()) out.push(el);
    } else {
      out.push(child);
    }
  }
  return out;
};
function installFitObserver(deps) {
  if (typeof ResizeObserver === "undefined") return () => {
  };
  if (!deps.hasFitSnap()) return () => {
  };
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (deps.isDestroyed() || deps.isDragging()) return;
      deps.recompute();
    });
  };
  const ro = new ResizeObserver(schedule);
  ro.observe(deps.handle);
  const scroller = deps.scrollContainer;
  const observed = /* @__PURE__ */ new Set();
  const slots = /* @__PURE__ */ new Set();
  const hasSlot = typeof HTMLSlotElement !== "undefined";
  const onSlotChange = () => resync();
  const trackSlots = () => {
    if (!scroller || !hasSlot) return;
    for (const child of Array.from(scroller.children)) {
      if (child instanceof HTMLSlotElement && !slots.has(child)) {
        child.addEventListener("slotchange", onSlotChange);
        slots.add(child);
      }
    }
  };
  const resync = () => {
    trackSlots();
    const targets = contentTargets(scroller);
    for (const el of observed) {
      if (!targets.includes(el)) {
        ro.unobserve(el);
        observed.delete(el);
      }
    }
    for (const el of targets) {
      if (!observed.has(el)) {
        ro.observe(el);
        observed.add(el);
      }
    }
    schedule();
  };
  let mo;
  if (scroller) {
    resync();
    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(resync);
      mo.observe(scroller, { childList: true });
    }
  }
  return () => {
    ro.disconnect();
    mo?.disconnect();
    for (const slot of slots) {
      slot.removeEventListener("slotchange", onSlotChange);
    }
    if (raf) cancelAnimationFrame(raf);
  };
}

// src/core/features/max-height-controller.ts
function createMaxHeightController(deps) {
  let maxHeightCap;
  let maxHeightRaw;
  const resolveCap = () => {
    const raw = maxHeightRaw;
    if (raw === void 0) {
      maxHeightCap = void 0;
      return;
    }
    if (typeof raw === "number") {
      maxHeightCap = raw;
      return;
    }
    if (typeof window === "undefined") return;
    const measured = resolveSnap(raw, deps.mode);
    maxHeightCap = measured > 0 ? measured : void 0;
  };
  const clampTo = () => {
    if (maxHeightCap === void 0) return;
    if (deps.getMaxAxisSize() > maxHeightCap) {
      deps.setMaxAxisSize(maxHeightCap);
    }
  };
  return {
    setRadius(r) {
      deps.element.style.setProperty(
        "--bs-radius",
        typeof r === "number" ? `${r}px` : r
      );
    },
    setMaxHeight(h) {
      const value = typeof h === "number" ? `${h}px` : h;
      const axis = layoutAxis(deps.mode);
      deps.element.style.setProperty(
        axis === "height" ? "max-height" : "max-width",
        value
      );
      maxHeightRaw = h;
      resolveCap();
      deps.recompute();
    },
    resolveCap,
    clampTo,
    getCap: () => maxHeightCap
  };
}

// src/core/features/fit-measurement.ts
var measureSheetNatural = (element, content, vertical) => {
  const axis = vertical ? "height" : "width";
  const sheetStyle = element.style;
  if (!content) {
    const prev = sheetStyle[axis];
    sheetStyle[axis] = "auto";
    const poked2 = vertical ? element.offsetHeight : element.offsetWidth;
    sheetStyle[axis] = prev;
    return poked2;
  }
  const cs = content.style;
  const prevSheet = sheetStyle[axis];
  const prevFlex = cs.flex;
  const prevContent = vertical ? cs.height : cs.width;
  sheetStyle[axis] = "auto";
  cs.flex = "none";
  if (vertical) cs.height = "auto";
  else cs.width = "auto";
  const poked = vertical ? element.offsetHeight : element.offsetWidth;
  const contentBox = vertical ? content.clientHeight : content.clientWidth;
  const contentScroll = vertical ? content.scrollHeight : content.scrollWidth;
  const natural = Math.max(poked, poked - contentBox + contentScroll);
  sheetStyle[axis] = prevSheet;
  cs.flex = prevFlex;
  if (vertical) cs.height = prevContent;
  else cs.width = prevContent;
  return natural;
};
var containingExtent = (element, vertical) => {
  const op = element.offsetParent;
  if (op && op !== document.body && op !== document.documentElement) {
    return vertical ? op.clientHeight : op.clientWidth;
  }
  return vertical ? window.innerHeight : window.innerWidth;
};
var measureFitSize = (deps) => {
  const vertical = layoutAxis(deps.mode) === "height";
  const natural = measureSheetNatural(
    deps.element,
    deps.scrollContainer,
    vertical
  );
  const cap = deps.getMaxHeightCap();
  const capped = cap !== void 0 ? Math.min(natural, cap) : natural;
  if (typeof window === "undefined") return capped;
  const viewport = containingExtent(deps.element, vertical);
  return viewport > 0 ? Math.min(capped, viewport) : capped;
};

// src/core/features/slider-keyboard.ts
function installSliderKeyboard(deps) {
  const isVerticalAxis = deps.mode === "bottom" || deps.mode === "top";
  const stepUp = isVerticalAxis ? "ArrowUp" : "ArrowRight";
  const stepDown = isVerticalAxis ? "ArrowDown" : "ArrowLeft";
  const sheetExpandsKey = deps.mode === "top" ? stepDown : stepUp;
  const sheetCollapsesKey = deps.mode === "top" ? stepUp : stepDown;
  const onHandleKey = (e) => {
    if (deps.isDestroyed()) return;
    const allowed = deps.getAllowedIds();
    const idx = allowed.indexOf(deps.getActiveId());
    if (idx === -1) return;
    if (e.key === sheetExpandsKey && idx < allowed.length - 1) {
      e.preventDefault();
      deps.snapTo(allowed[idx + 1]);
    } else if (e.key === sheetCollapsesKey && idx > 0) {
      e.preventDefault();
      deps.snapTo(allowed[idx - 1]);
    } else if (e.key === "Home") {
      e.preventDefault();
      deps.snapTo(allowed[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      deps.snapTo(allowed[allowed.length - 1]);
    }
  };
  deps.handle.addEventListener("keydown", onHandleKey);
  return () => deps.handle.removeEventListener("keydown", onHandleKey);
}

// src/core/types.ts
var SCRIM_PRESETS = Object.freeze({
  subtle: {
    color: "rgba(0,0,0,0.2)",
    blur: void 0,
    range: [0.3, 1],
    interactive: false
  },
  standard: {
    color: "rgba(0,0,0,0.4)",
    blur: void 0,
    range: [0, 1],
    interactive: false
  },
  monitoring: {
    color: "rgba(15,15,20,0.55)",
    blur: "4px",
    range: [0, 1],
    interactive: false
  },
  cinematic: {
    color: "rgba(0,0,0,0.7)",
    blur: "12px",
    range: [0, 1],
    interactive: false
  }
});

// src/core/primitives/opacity-dedup.ts
var WriteSentinel = class {
  constructor() {
    __publicField(this, "last", -1);
  }
  shouldWrite(next, epsilon) {
    if (Math.abs(next - this.last) <= epsilon) return false;
    this.last = next;
    return true;
  }
  invalidate() {
    this.last = -1;
  }
  setLastWritten(value) {
    this.last = value;
  }
  get value() {
    return this.last;
  }
};

// src/core/primitives/overlay-position.ts
function resolveSheetAnchoredStyle(mode, position, inset) {
  const sizeOffset = `calc(var(--bs-size, 0px) + ${inset})`;
  switch (mode) {
    case "bottom":
      if (position === "sheet-top-left") return { bottom: sizeOffset, left: inset };
      if (position === "sheet-top-right") return { bottom: sizeOffset, right: inset };
      return { bottom: sizeOffset, left: "50%", transform: "translateX(-50%)" };
    case "top":
      if (position === "sheet-top-left") return { top: sizeOffset, left: inset };
      if (position === "sheet-top-right") return { top: sizeOffset, right: inset };
      return { top: sizeOffset, left: "50%", transform: "translateX(-50%)" };
    case "left":
      if (position === "sheet-top-left") return { left: sizeOffset, top: inset };
      if (position === "sheet-top-right") return { left: sizeOffset, bottom: inset };
      return { left: sizeOffset, top: "50%", transform: "translateY(-50%)" };
    case "right":
      if (position === "sheet-top-left") return { right: sizeOffset, top: inset };
      if (position === "sheet-top-right") return { right: sizeOffset, bottom: inset };
      return { right: sizeOffset, top: "50%", transform: "translateY(-50%)" };
  }
}
function applyOverlayPosition(ws, mode, position, inset) {
  switch (position) {
    case "top-left":
      ws.top = inset;
      ws.left = inset;
      break;
    case "top-center":
      ws.top = inset;
      ws.left = "50%";
      ws.transform = "translateX(-50%)";
      break;
    case "top-right":
      ws.top = inset;
      ws.right = inset;
      break;
    case "center-left":
      ws.top = "50%";
      ws.left = inset;
      ws.transform = "translateY(-50%)";
      break;
    case "center":
      ws.top = "50%";
      ws.left = "50%";
      ws.transform = "translate(-50%, -50%)";
      break;
    case "center-right":
      ws.top = "50%";
      ws.right = inset;
      ws.transform = "translateY(-50%)";
      break;
    case "bottom-left":
      ws.bottom = inset;
      ws.left = inset;
      break;
    case "bottom-center":
      ws.bottom = inset;
      ws.left = "50%";
      ws.transform = "translateX(-50%)";
      break;
    case "bottom-right":
      ws.bottom = inset;
      ws.right = inset;
      break;
    case "sheet-top-left":
    case "sheet-top-center":
    case "sheet-top-right": {
      const style = resolveSheetAnchoredStyle(mode, position, inset);
      if (style.top !== void 0) ws.top = style.top;
      if (style.bottom !== void 0) ws.bottom = style.bottom;
      if (style.left !== void 0) ws.left = style.left;
      if (style.right !== void 0) ws.right = style.right;
      if (style.transform !== void 0) ws.transform = style.transform;
      break;
    }
  }
}

// src/core/controllers/scrim-controller.ts
var VALID_CSS_LENGTH = /^-?\d+(?:\.\d+)?(?:px|em|rem|%)$/;
var DEFAULT_SCRIM_DIM = "rgba(0, 0, 0, 0.4)";
var ScrimController = class {
  constructor(deps, opts) {
    __publicField(this, "screenComponent");
    __publicField(this, "backdrop");
    __publicField(this, "mode");
    __publicField(this, "isDestroyed");
    __publicField(this, "getAllowedIds");
    __publicField(this, "getResolvedSnaps");
    __publicField(this, "snapToFn");
    __publicField(this, "closeFn");
    __publicField(this, "scrimInteractive", false);
    __publicField(this, "scrimMode");
    __publicField(this, "backdropRange");
    __publicField(this, "screenRange");
    __publicField(this, "scrimEnabled", true);
    __publicField(this, "savedScrimRanges", null);
    __publicField(this, "scrimTapToCloseEnabled", false);
    __publicField(this, "detachScrimTap", null);
    __publicField(this, "scrimOverlayTeardown", null);
    __publicField(this, "backdropOpacitySentinel", new WriteSentinel());
    __publicField(this, "screenOpacitySentinel", new WriteSentinel());
    __publicField(this, "lastBackdropPointer", "");
    __publicField(this, "lastScreenDisplay", "");
    this.screenComponent = deps.screenComponent;
    this.backdrop = deps.backdrop;
    this.mode = deps.mode;
    this.isDestroyed = deps.isDestroyed;
    this.getAllowedIds = deps.getAllowedIds;
    this.getResolvedSnaps = deps.getResolvedSnaps;
    this.snapToFn = deps.snapTo;
    this.closeFn = deps.close;
    this.scrimMode = opts.scrimMode ?? "full";
    const preset = opts.scrimPreset ? SCRIM_PRESETS[opts.scrimPreset] : null;
    this.backdropRange = opts.backdropRange ?? preset?.range ?? [0, 1];
    this.screenRange = opts.screenRange ?? preset?.range ?? [0, 1];
    this.scrimTapToCloseEnabled = opts.scrimTapToClose ?? false;
    const explicitColor = opts.scrimColor ?? preset?.color;
    const effectiveColor = explicitColor ?? (this.scrimMode !== "off" && !this.backdrop ? DEFAULT_SCRIM_DIM : void 0);
    if (this.screenComponent) {
      this.applyScrimStyles({
        color: effectiveColor,
        blur: opts.scrimBlur ?? preset?.blur,
        interactive: opts.scrimInteractive ?? preset?.interactive ?? false
      });
      if (this.scrimMode === "above-sheet") {
        this.applyAboveSheetInset();
      } else if (this.scrimMode === "off") {
        const s = this.screenComponent.style;
        s.opacity = "0";
        s.display = "none";
        this.screenOpacitySentinel.setLastWritten(0);
        this.lastScreenDisplay = "none";
      }
    }
  }
  invalidateOpacityCache() {
    this.backdropOpacitySentinel.invalidate();
    this.screenOpacitySentinel.invalidate();
  }
  attach() {
    if (this.scrimTapToCloseEnabled) {
      this.setScrimTapToClose(true);
    }
  }
  applyOpacity(progress, progressChanged) {
    if (!progressChanged && this.backdropOpacitySentinel.value !== -1 && this.screenOpacitySentinel.value !== -1) {
      return;
    }
    if (this.backdrop) {
      const [s, e] = this.backdropRange;
      const range = Math.max(e - s, RANGE_DIVISION_EPSILON);
      const backdropOpacity = Math.min(
        Math.max((progress - s) / range, 0),
        1
      );
      if (this.backdropOpacitySentinel.shouldWrite(
        backdropOpacity,
        OPACITY_WRITE_EPSILON
      )) {
        this.backdrop.style.opacity = String(backdropOpacity);
      }
      const nextPointer = backdropOpacity > POINTER_EVENTS_OPACITY_THRESHOLD ? "auto" : "none";
      if (nextPointer !== this.lastBackdropPointer) {
        this.backdrop.style.pointerEvents = nextPointer;
        this.lastBackdropPointer = nextPointer;
      }
    }
    if (this.screenComponent && this.scrimMode !== "off") {
      const [ss, se] = this.screenRange;
      const screenOpacity = Math.min(
        1,
        Math.max(
          0,
          (progress - ss) / Math.max(RANGE_DIVISION_EPSILON, se - ss)
        )
      );
      if (this.screenOpacitySentinel.shouldWrite(
        screenOpacity,
        OPACITY_WRITE_EPSILON
      )) {
        this.screenComponent.style.opacity = String(screenOpacity);
      }
      const nextDisplay = screenOpacity > 0 ? "" : "none";
      if (nextDisplay !== this.lastScreenDisplay) {
        this.screenComponent.style.display = nextDisplay;
        this.lastScreenDisplay = nextDisplay;
      }
    }
  }
  setBackdropRange(range, applySize) {
    if (this.isDestroyed()) return;
    this.backdropRange = range;
    this.invalidateOpacityCache();
    applySize();
  }
  setScreenRange(range, applySize) {
    if (this.isDestroyed()) return;
    this.screenRange = range;
    this.invalidateOpacityCache();
    applySize();
  }
  setScrimColor(color) {
    if (this.isDestroyed()) return;
    this.applyScrimStyles({ color: color === void 0 ? null : color });
  }
  setScrimBlur(blur) {
    if (this.isDestroyed()) return;
    this.applyScrimStyles({ blur: blur === void 0 ? null : blur });
  }
  setScrimInteractive(interactive) {
    if (this.isDestroyed()) return;
    this.applyScrimStyles({ interactive });
  }
  setSheetMode(mode) {
    if (this.isDestroyed() || mode === this.mode) return;
    this.mode = mode;
    this.invalidateOpacityCache();
  }
  setScrimMode(mode, applySize) {
    if (this.isDestroyed()) return;
    if (mode === this.scrimMode) return;
    this.invalidateOpacityCache();
    const previous = this.scrimMode;
    this.scrimMode = mode;
    if (this.screenComponent) {
      const s = this.screenComponent.style;
      if (previous === "above-sheet" && mode !== "above-sheet") {
        s.position = "";
        s.inset = "";
        s.pointerEvents = "";
      }
      if (mode === "above-sheet") {
        this.applyAboveSheetInset();
      } else if (mode === "off") {
        s.opacity = "0";
        s.display = "none";
        this.screenOpacitySentinel.setLastWritten(0);
        this.lastScreenDisplay = "none";
      } else {
        if (this.lastScreenDisplay === "none") {
          s.display = "";
          this.lastScreenDisplay = "";
        }
      }
    }
    applySize();
  }
  setScrimTapToClose(enabled) {
    if (this.isDestroyed()) return;
    if (!this.screenComponent) return;
    const installed = this.detachScrimTap !== null;
    if (enabled === installed) return;
    if (enabled) {
      const target = this.screenComponent;
      if (target.style.pointerEvents === "none") {
        target.style.pointerEvents = "auto";
      }
      const onClick = () => {
        if (this.isDestroyed()) return;
        if (this.closeFn) {
          this.closeFn();
          return;
        }
        const allowed = this.getAllowedIds();
        const snaps = this.getResolvedSnaps();
        const fallback = allowed.find((id) => {
          const snap = findById(id, snaps);
          return snap !== null && snap.size === 0;
        });
        if (fallback) this.snapToFn(fallback);
      };
      target.addEventListener("click", onClick);
      this.detachScrimTap = () => target.removeEventListener("click", onClick);
      this.scrimTapToCloseEnabled = true;
    } else {
      this.detachScrimTap?.();
      this.detachScrimTap = null;
      this.scrimTapToCloseEnabled = false;
    }
  }
  setScrimEnabled(enabled, applySize) {
    if (this.isDestroyed()) return;
    if (enabled === this.scrimEnabled) return;
    this.scrimEnabled = enabled;
    this.invalidateOpacityCache();
    if (!enabled) {
      this.savedScrimRanges = {
        screen: this.screenRange,
        backdrop: this.backdropRange
      };
      this.screenRange = [1, 1];
      this.backdropRange = [1, 1];
    } else {
      this.screenRange = this.savedScrimRanges?.screen ?? [0, 1];
      this.backdropRange = this.savedScrimRanges?.backdrop ?? [0, 1];
      this.savedScrimRanges = null;
    }
    applySize();
  }
  setScrim(opts, applySize) {
    if (this.isDestroyed()) return;
    if (opts.preset) {
      const cfg = SCRIM_PRESETS[opts.preset];
      this.applyScrimStyles({
        color: cfg.color,
        blur: cfg.blur ?? null,
        interactive: cfg.interactive
      });
      if (!this.scrimEnabled && this.savedScrimRanges) {
        this.savedScrimRanges = { screen: cfg.range, backdrop: cfg.range };
      } else {
        this.screenRange = cfg.range;
        this.backdropRange = cfg.range;
      }
    }
    const noop = () => {
    };
    if (opts.mode !== void 0) this.setScrimMode(opts.mode, noop);
    if (opts.enabled !== void 0) this.setScrimEnabled(opts.enabled, noop);
    if (opts.tapToClose !== void 0) this.setScrimTapToClose(opts.tapToClose);
    this.applyScrimStyles({
      color: opts.color,
      blur: opts.blur,
      interactive: opts.interactive
    });
    if (opts.range !== void 0) {
      if (!this.scrimEnabled && this.savedScrimRanges) {
        this.savedScrimRanges = {
          screen: opts.range,
          backdrop: this.savedScrimRanges.backdrop
        };
      } else {
        this.screenRange = opts.range;
      }
    }
    this.invalidateOpacityCache();
    applySize();
  }
  setScrimOverlay(opts) {
    if (this.isDestroyed()) return () => {
    };
    if (!this.screenComponent) return () => {
    };
    this.scrimOverlayTeardown?.();
    const screen = this.screenComponent;
    const insetRaw = opts.inset ?? "16px";
    const inset = VALID_CSS_LENGTH.test(insetRaw) ? insetRaw : "16px";
    if (inset !== insetRaw) {
      devWarn(
        `[bottom-sheet] setScrimOverlay: invalid inset ${JSON.stringify(insetRaw)}; expected a CSS length like "16px" / "1rem" / "5%". Falling back to "16px".`
      );
    }
    if (opts.children.ownerDocument && opts.children.ownerDocument !== screen.ownerDocument) {
      devWarn(
        "[bottom-sheet] setScrimOverlay: children belong to a different document than the scrim. Cross-document adoption can drop event listeners; construct children via the same document as the sheet root."
      );
    }
    const position = opts.position ?? "top-right";
    const interactive = opts.interactive ?? true;
    const wrapper = screen.ownerDocument.createElement("div");
    wrapper.className = "bs-scrim-overlay";
    const ws = wrapper.style;
    ws.position = "absolute";
    applyOverlayPosition(ws, this.mode, position, inset);
    if (interactive) {
      ws.pointerEvents = "auto";
    }
    wrapper.appendChild(opts.children);
    const host = screen.parentElement;
    if (!host) {
      devWarn(
        "[bottom-sheet] setScrimOverlay: scrim element has no parent, skipping overlay injection. Mount the sheet root before calling setScrimOverlay."
      );
      return () => {
      };
    }
    host.appendChild(wrapper);
    const teardown = () => {
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      if (this.scrimOverlayTeardown === teardown) {
        this.scrimOverlayTeardown = null;
      }
    };
    this.scrimOverlayTeardown = teardown;
    return teardown;
  }
  destroy() {
    this.detachScrimTap?.();
    this.detachScrimTap = null;
    this.scrimOverlayTeardown?.();
    this.scrimOverlayTeardown = null;
    if (this.screenComponent) {
      const s = this.screenComponent.style;
      s.opacity = "";
      s.display = "";
      s.position = "";
      s.inset = "";
      s.pointerEvents = "";
    }
    if (this.backdrop) {
      this.backdrop.style.opacity = "";
      this.backdrop.style.pointerEvents = "";
    }
    this.invalidateOpacityCache();
    this.lastBackdropPointer = "";
    this.lastScreenDisplay = "";
  }
  applyScrimStyles(opts) {
    if (!this.screenComponent) return;
    const s = this.screenComponent.style;
    if (opts.color !== void 0) {
      s.background = opts.color === null ? "" : opts.color;
    }
    if (opts.blur !== void 0) {
      const w = s;
      if (opts.blur === null) {
        s.backdropFilter = "";
        w.webkitBackdropFilter = "";
      } else {
        const filter = `blur(${opts.blur})`;
        s.backdropFilter = filter;
        w.webkitBackdropFilter = filter;
      }
    }
    if (opts.interactive !== void 0) {
      this.scrimInteractive = opts.interactive;
      s.pointerEvents = opts.interactive ? "auto" : "none";
    }
  }
  applyAboveSheetInset() {
    if (!this.screenComponent) return;
    const insetByMode = {
      bottom: "0 0 var(--bs-size) 0",
      top: "var(--bs-size) 0 0 0",
      left: "0 0 0 var(--bs-size)",
      right: "0 var(--bs-size) 0 0"
    };
    const s = this.screenComponent.style;
    s.position = "fixed";
    s.inset = insetByMode[this.mode];
    s.pointerEvents = this.scrimInteractive || this.scrimTapToCloseEnabled ? "auto" : "none";
  }
};

// src/core/animation/animation.ts
var easeOutBack = (t) => {
  const c1 = 1.40158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
var easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
var easeLinear = (t) => t;
var easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
var tween = ({
  from,
  to,
  duration,
  easing = easeOutCubic,
  onUpdate
}) => {
  let cancelled = false;
  let rafId = 0;
  let resolveFn = null;
  const start = performance.now();
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
    if (duration <= 0) {
      onUpdate(to);
      resolve();
      return;
    }
    const step = (now) => {
      if (cancelled) return;
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const value = from + (to - from) * easing(t);
      onUpdate(value);
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    rafId = requestAnimationFrame(step);
  });
  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      resolveFn?.();
    },
    promise
  };
};
var prefersReducedMotion = () => {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

// src/core/animation/spring.ts
var DEFAULT_SPRING = {
  stiffness: 220,
  damping: 26,
  mass: 1,
  restDelta: 0.5,
  restSpeed: 0.5
};
var MAX_DT = 1 / 30;
var runSpring = ({
  from,
  to,
  velocity = 0,
  config,
  onUpdate
}) => {
  const cfg = { ...DEFAULT_SPRING, ...config };
  let cancelled = false;
  let rafId = 0;
  let resolveFn = null;
  let x = from;
  let v = velocity;
  let lastTime = performance.now();
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
    const step = (now) => {
      if (cancelled) return;
      const dt = Math.min((now - lastTime) / 1e3, MAX_DT);
      lastTime = now;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const subDt = dt / steps;
      let stepsLeft = steps;
      while (stepsLeft-- > 0) {
        const force = -cfg.stiffness * (x - to) - cfg.damping * v;
        const accel = force / cfg.mass;
        v += accel * subDt;
        x += v * subDt;
      }
      if (!Number.isFinite(x) || !Number.isFinite(v)) {
        onUpdate(to, 0);
        resolve();
        return;
      }
      onUpdate(x, v);
      const isAtRest = Math.abs(to - x) < (cfg.restDelta ?? 0.5) && Math.abs(v) < (cfg.restSpeed ?? 0.5);
      if (isAtRest) {
        onUpdate(to, 0);
        resolve();
      } else {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
  });
  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      resolveFn?.();
    },
    promise
  };
};

// src/core/animation/animation-presets.ts
var DEFAULT_DURATION = 220;
function resolveAnimationPreset(animation) {
  switch (animation) {
    case "ios-spring":
      return {
        kind: "spring",
        spring: { stiffness: 300, damping: 30, mass: 1 }
      };
    case "material-bounce":
      return {
        kind: "spring",
        spring: { stiffness: 200, damping: 22, mass: 1 }
      };
    case "linear":
      return { kind: "tween", duration: DEFAULT_DURATION, easing: easeLinear };
    case "snappy":
      return { kind: "tween", duration: 180, easing: easeOutQuint };
    case "tween":
      return { kind: "tween" };
    case "spring":
    case void 0:
    default:
      return { kind: "spring" };
  }
}

// src/core/animation/waapi-settle.ts
var SIM_HZ = 240;
var SAMPLE_STRIDE = 4;
var MAX_SIM_MS = 3e3;
function sampleSpringSettle(from, to, velocityPxPerS, config) {
  const cfg = { ...DEFAULT_SPRING, ...config };
  const subDt = 1 / SIM_HZ;
  const stepMs = SAMPLE_STRIDE / SIM_HZ * 1e3;
  const maxSteps = Math.ceil(MAX_SIM_MS / 1e3 * SIM_HZ);
  const values = [from];
  let x = from;
  let v = velocityPxPerS;
  for (let i = 1; i <= maxSteps; i += 1) {
    const force = -cfg.stiffness * (x - to) - cfg.damping * v;
    v += force / cfg.mass * subDt;
    x += v * subDt;
    if (!Number.isFinite(x) || !Number.isFinite(v)) {
      values.push(to);
      break;
    }
    if (i % SAMPLE_STRIDE === 0) values.push(x);
    const atRest = Math.abs(to - x) < (cfg.restDelta ?? 0.5) && Math.abs(v) < (cfg.restSpeed ?? 0.5);
    if (atRest) break;
  }
  if (values[values.length - 1] !== to) values.push(to);
  return {
    values,
    stepMs,
    durationMs: (values.length - 1) * stepMs
  };
}
function sampleTweenSettle(from, to, durationMs, easing) {
  const count = Math.max(2, Math.min(60, Math.round(durationMs / 16)));
  const values = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    values.push(from + (to - from) * easing(t));
  }
  values[values.length - 1] = to;
  return {
    values,
    stepMs: durationMs / count,
    durationMs
  };
}

// src/core/controllers/animation-runner.ts
var DEFAULT_DURATION2 = 220;
var VELOCITY_PX_PER_S = 1e3;
var AnimationRunner = class {
  constructor(deps, opts) {
    __publicField(this, "element");
    __publicField(this, "getRootEl");
    __publicField(this, "applySizeFn");
    __publicField(this, "getSize");
    __publicField(this, "isDragging");
    __publicField(this, "applyAux");
    __publicField(this, "getTransformFor");
    __publicField(this, "settleWaapi");
    __publicField(this, "currentWaapi", null);
    __publicField(this, "animationKind");
    __publicField(this, "springConfig");
    __publicField(this, "duration");
    __publicField(this, "easing");
    __publicField(this, "respectReducedMotion");
    __publicField(this, "reducedMotion", false);
    __publicField(this, "detachReducedMotion", null);
    __publicField(this, "viewTransitionsAvailable");
    __publicField(this, "currentTween", null);
    __publicField(this, "currentSpring", null);
    this.element = deps.element;
    this.getRootEl = deps.getRootEl;
    this.applySizeFn = deps.applySize;
    this.getSize = deps.getSize;
    this.isDragging = deps.isDragging;
    this.applyAux = deps.applyAux;
    this.getTransformFor = deps.getTransformFor;
    this.settleWaapi = opts.settleAnimation === "waapi";
    const preset = resolveAnimationPreset(opts.animation);
    this.animationKind = preset.kind;
    this.duration = opts.duration ?? preset.duration ?? DEFAULT_DURATION2;
    this.easing = opts.easing ?? preset.easing ?? easeOutBack;
    this.springConfig = { ...preset.spring ?? {}, ...opts.spring ?? {} };
    this.respectReducedMotion = opts.respectReducedMotion ?? true;
    const viewTransitionsEnabled = opts.viewTransitions ?? false;
    this.viewTransitionsAvailable = viewTransitionsEnabled && typeof document !== "undefined" && typeof document.startViewTransition === "function";
    if (this.respectReducedMotion && typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion = mq.matches;
      const onMqChange = (e) => {
        this.reducedMotion = e.matches;
      };
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", onMqChange);
        this.detachReducedMotion = () => mq.removeEventListener("change", onMqChange);
      } else if (typeof mq.addListener === "function") {
        mq.addListener(onMqChange);
        this.detachReducedMotion = () => mq.removeListener(onMqChange);
      }
    }
  }
  get isAnimating() {
    return this.currentTween !== null || this.currentSpring !== null || this.currentWaapi !== null;
  }
  cancelWaapi() {
    if (!this.currentWaapi) return;
    const entry = this.currentWaapi;
    this.currentWaapi = null;
    entry.stop();
    try {
      entry.anim.cancel();
    } catch {
    }
  }
  cancel() {
    this.currentTween?.cancel();
    this.currentSpring?.cancel();
    this.cancelWaapi();
  }
  async animateTo(target, velocityPxPerMs) {
    if (target === this.getSize()) {
      if (!this.isAnimating && !this.isDragging()) {
        this.element.style.willChange = "";
      }
      return;
    }
    this.currentTween?.cancel();
    this.currentSpring?.cancel();
    this.cancelWaapi();
    this.getRootEl()?.setAttribute("data-animating", "true");
    this.element.style.willChange = "transform";
    if (this.reducedMotion) {
      this.applySizeFn(target);
      this.getRootEl()?.removeAttribute("data-animating");
      if (!this.isDragging()) this.element.style.willChange = "";
      return;
    }
    if (this.settleWaapi && this.applyAux && this.getTransformFor && typeof this.element.animate === "function") {
      const samples = this.animationKind === "spring" ? sampleSpringSettle(
        this.getSize(),
        target,
        velocityPxPerMs * VELOCITY_PX_PER_S,
        this.springConfig
      ) : sampleTweenSettle(
        this.getSize(),
        target,
        this.duration,
        this.easing
      );
      if (samples.values.length >= 2 && samples.durationMs > 0) {
        await this.runWaapiSettle(samples, target);
        if (!this.isAnimating) {
          this.getRootEl()?.removeAttribute("data-animating");
          if (!this.isDragging()) this.element.style.willChange = "";
        }
        return;
      }
    }
    if (this.animationKind === "spring") {
      const spring = runSpring({
        from: this.getSize(),
        to: target,
        velocity: velocityPxPerMs * VELOCITY_PX_PER_S,
        config: this.springConfig,
        onUpdate: (v) => this.applySizeFn(v)
      });
      this.currentSpring = spring;
      await spring.promise;
      if (this.currentSpring === spring) this.currentSpring = null;
    } else {
      const tw = tween({
        from: this.getSize(),
        to: target,
        duration: this.duration,
        easing: this.easing,
        onUpdate: (v) => this.applySizeFn(v)
      });
      this.currentTween = tw;
      await tw.promise;
      if (this.currentTween === tw) this.currentTween = null;
    }
    if (!this.isAnimating) {
      this.getRootEl()?.removeAttribute("data-animating");
      if (!this.isDragging()) this.element.style.willChange = "";
    }
  }
  async runWaapiSettle(samples, target) {
    const applyAux = this.applyAux;
    const getTransformFor = this.getTransformFor;
    const frames = samples.values.map((v) => ({
      transform: getTransformFor(v)
    }));
    const anim = this.element.animate(frames, {
      duration: samples.durationMs,
      easing: "linear",
      fill: "forwards"
    });
    let stopped = false;
    let auxRaf = 0;
    const lastIdx = samples.values.length - 1;
    const auxTick = () => {
      if (stopped) return;
      const at = Math.min(
        (Number(anim.currentTime) || 0) / samples.stepMs,
        lastIdx
      );
      const idx = Math.floor(at);
      const from = samples.values[idx];
      const to = samples.values[Math.min(idx + 1, lastIdx)];
      applyAux(from + (to - from) * (at - idx));
      auxRaf = requestAnimationFrame(auxTick);
    };
    auxRaf = requestAnimationFrame(auxTick);
    const entry = {
      anim,
      stop: () => {
        stopped = true;
        cancelAnimationFrame(auxRaf);
      }
    };
    this.currentWaapi = entry;
    try {
      await anim.finished;
    } catch {
    }
    entry.stop();
    const wasCurrent = this.currentWaapi === entry;
    if (wasCurrent) this.currentWaapi = null;
    if (wasCurrent && anim.playState === "finished") {
      this.applySizeFn(target);
      try {
        anim.cancel();
      } catch {
      }
    }
  }
  destroy() {
    this.detachReducedMotion?.();
    this.detachReducedMotion = null;
    this.currentTween = null;
    this.currentSpring = null;
    if (this.currentWaapi) {
      const entry = this.currentWaapi;
      this.currentWaapi = null;
      entry.stop();
      try {
        entry.anim.cancel();
      } catch {
      }
    }
  }
};

// src/core/lifecycle/focus-trap.ts
var FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])"
].join(",");
var isVisible = (el) => {
  if (typeof el.checkVisibility === "function") {
    return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  }
  return el.offsetParent !== null;
};
var collectFocusables = (root) => {
  const out = Array.from(root.querySelectorAll(FOCUSABLE));
  if (typeof HTMLSlotElement !== "undefined") {
    for (const slot of Array.from(root.querySelectorAll("slot"))) {
      for (const assigned of slot.assignedElements()) {
        if (assigned.matches(FOCUSABLE)) out.push(assigned);
        out.push(...collectFocusables(assigned));
      }
    }
  }
  return out;
};
var focusables = (root) => collectFocusables(root).filter(
  (el) => !el.hasAttribute("inert") && isVisible(el) && !el.matches("[aria-hidden='true']")
);
var containsComposed = (container, node) => {
  let n = node;
  while (n) {
    if (n === container) return true;
    const slot = n.assignedSlot;
    if (slot) {
      n = slot;
      continue;
    }
    const parent = n.parentNode;
    n = parent instanceof ShadowRoot ? parent.host : parent;
  }
  return false;
};
var trapStack = [];
var installFocusTrap = (container, options = {}) => {
  if (typeof document === "undefined") return () => {
  };
  const token = {};
  trapStack.push(token);
  const isActive = () => trapStack[trapStack.length - 1] === token;
  const previouslyFocused = document.activeElement;
  const focusInitial = () => {
    const spec = options.initialFocus;
    if (spec === false) {
      if (!container.hasAttribute("tabindex")) container.tabIndex = -1;
      container.focus({ preventScroll: true });
      return;
    }
    const initial = typeof spec === "string" ? container.querySelector(spec) : spec ?? focusables(container)[0] ?? container;
    initial?.focus({ preventScroll: true });
  };
  focusInitial();
  const handleKey = (e) => {
    if (!isActive()) return;
    if (e.key === "Escape" && options.onEscape) {
      options.onEscape();
      return;
    }
    if (e.key !== "Tab") return;
    const list = focusables(container);
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const handleFocusIn = (e) => {
    if (!isActive()) return;
    const target = e.target;
    if (target && !containsComposed(container, target)) {
      const list = focusables(container);
      list[0]?.focus({ preventScroll: true });
    }
  };
  document.addEventListener("keydown", handleKey, true);
  document.addEventListener("focusin", handleFocusIn, true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const idx = trapStack.indexOf(token);
    if (idx !== -1) trapStack.splice(idx, 1);
    document.removeEventListener("keydown", handleKey, true);
    document.removeEventListener("focusin", handleFocusIn, true);
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus({ preventScroll: true });
    } else {
      const fallback = document.querySelector("[data-bs-restore-fallback]");
      fallback?.focus({ preventScroll: true });
    }
  };
};

// src/core/lifecycle/scroll-lock.ts
var lockCount = 0;
var savedStyles = null;
var lockBodyScroll = () => {
  if (typeof document === "undefined") return () => {
  };
  if (lockCount === 0) {
    const body = document.body;
    savedStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      paddingRight: body.style.paddingRight,
      scrollY: window.scrollY
    };
    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarGap > 0) {
      const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + scrollbarGap}px`;
    }
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${savedStyles.scrollY}px`;
    body.style.width = "100%";
  }
  lockCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0 && savedStyles) {
      const body = document.body;
      body.style.overflow = savedStyles.overflow;
      body.style.position = savedStyles.position;
      body.style.top = savedStyles.top;
      body.style.width = savedStyles.width;
      body.style.paddingRight = savedStyles.paddingRight;
      window.scrollTo(0, savedStyles.scrollY);
      savedStyles = null;
    }
  };
};

// src/core/features/inert-siblings.ts
function createInertSiblings(rootProvider) {
  const tracked = [];
  return {
    apply() {
      if (typeof document === "undefined") return;
      let top = rootProvider();
      while (top.parentElement && top.parentElement !== document.body) {
        top = top.parentElement;
      }
      const parent = top.parentElement ?? document.body;
      for (const child of Array.from(parent.children)) {
        if (child === top) continue;
        if (child.hasAttribute("inert")) continue;
        if (child.classList.contains("bs-backdrop") || child.classList.contains("bs-screen") || child.classList.contains("bs-root")) {
          continue;
        }
        child.setAttribute("inert", "");
        tracked.push(child);
      }
    },
    remove() {
      for (const el of tracked) el.removeAttribute("inert");
      tracked.length = 0;
    }
  };
}

// src/core/controllers/lifecycle-controller.ts
var LifecycleController = class {
  constructor(deps, opts) {
    __publicField(this, "element");
    __publicField(this, "focusTrapEnabled");
    __publicField(this, "initialFocus");
    __publicField(this, "closeOnEscape");
    __publicField(this, "bodyScrollLockEnabled");
    __publicField(this, "inertSiblingsEnabled");
    __publicField(this, "inertSiblings");
    __publicField(this, "shouldApplyInertSiblings");
    __publicField(this, "returnFocus");
    __publicField(this, "releaseFocusTrap", null);
    __publicField(this, "releaseScrollLock", null);
    __publicField(this, "installed", false);
    __publicField(this, "destroyed", false);
    this.element = deps.element;
    this.focusTrapEnabled = opts.focusTrap ?? false;
    this.initialFocus = opts.initialFocus;
    this.closeOnEscape = opts.closeOnEscape ?? true;
    this.bodyScrollLockEnabled = opts.lockBodyScroll ?? true;
    this.inertSiblingsEnabled = opts.inertSiblings ?? false;
    this.shouldApplyInertSiblings = opts.shouldApplyInertSiblings ?? (() => true);
    this.returnFocus = opts.returnFocus;
    this.inertSiblings = createInertSiblings(() => this.element);
  }
  get isInstalled() {
    return this.installed;
  }
  install() {
    if (this.destroyed) return;
    this.installed = true;
    if (this.bodyScrollLockEnabled && !this.releaseScrollLock) {
      this.releaseScrollLock = lockBodyScroll();
    }
    if (this.focusTrapEnabled && !this.releaseFocusTrap) {
      this.releaseFocusTrap = installFocusTrap(this.element, {
        initialFocus: this.initialFocus
      });
    }
    if (this.inertSiblingsEnabled && this.shouldApplyInertSiblings()) {
      this.inertSiblings.apply();
    }
  }
  setReturnFocus(target) {
    if (this.destroyed) return;
    this.returnFocus = target;
  }
  release() {
    if (!this.installed) return;
    this.installed = false;
    this.releaseFocusTrap?.();
    this.releaseFocusTrap = null;
    this.releaseScrollLock?.();
    this.releaseScrollLock = null;
    this.inertSiblings.remove();
    if (this.returnFocus) {
      const target = typeof this.returnFocus === "function" ? this.returnFocus() : typeof this.returnFocus === "string" ? typeof document !== "undefined" ? document.querySelector(this.returnFocus) : null : this.returnFocus;
      target?.focus?.();
    }
  }
  destroy() {
    this.release();
    this.destroyed = true;
  }
};

// src/core/gestures.ts
var isAxisVertical = (mode) => mode === "bottom" || mode === "top";
var SampleRing = class {
  constructor(capacity) {
    __publicField(this, "slots");
    __publicField(this, "capacity");
    __publicField(this, "head", 0);
    __publicField(this, "size", 0);
    this.capacity = capacity;
    this.slots = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.slots[i] = { t: 0, v: 0 };
  }
  push(t, v) {
    const slot = this.slots[this.head];
    slot.t = t;
    slot.v = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }
  pruneBefore(cutoff, minKeep) {
    while (this.size > minKeep) {
      const oldestIdx = (this.head - this.size + this.capacity) % this.capacity;
      if (this.slots[oldestIdx].t < cutoff) this.size--;
      else break;
    }
  }
  get length() {
    return this.size;
  }
  oldest() {
    if (this.size === 0) return void 0;
    return this.slots[(this.head - this.size + this.capacity) % this.capacity];
  }
  newest() {
    if (this.size === 0) return void 0;
    return this.slots[(this.head - 1 + this.capacity) % this.capacity];
  }
  reset() {
    this.head = 0;
    this.size = 0;
  }
};
var installGestures = (handle, mode, callbacks, options = {}) => {
  let activePointerId = null;
  let activePointerType = "touch";
  let startCoord = 0;
  let startCross = 0;
  let lastCoord = 0;
  let pendingStart = false;
  const VELOCITY_WINDOW_MS = (kind) => kind === "mouse" ? 160 : 120;
  const MAX_SAMPLES = 32;
  const samples = new SampleRing(MAX_SAMPLES);
  const axis = isAxisVertical(mode) ? "Y" : "X";
  const sign = mode === "bottom" || mode === "right" ? -1 : 1;
  const coordOf = (e) => axis === "Y" ? e.clientY : e.clientX;
  const crossOf = (e) => axis === "Y" ? e.clientX : e.clientY;
  const capture = (pointerId) => {
    try {
      handle.setPointerCapture(pointerId);
    } catch {
    }
  };
  const releaseTracking = () => {
    activePointerId = null;
    pendingStart = false;
    samples.reset();
  };
  const onPointerDown = (e) => {
    if (activePointerId !== null) return;
    if (e.button !== void 0 && e.button !== 0) return;
    if (options.shouldStart && !options.shouldStart(e)) return;
    activePointerId = e.pointerId;
    activePointerType = e.pointerType || "touch";
    startCoord = coordOf(e);
    startCross = crossOf(e);
    lastCoord = startCoord;
    samples.reset();
    samples.push(e.timeStamp, startCoord);
    if (options.deferStart) {
      pendingStart = true;
      return;
    }
    capture(e.pointerId);
    callbacks.onStart(startCoord, activePointerType);
  };
  const onPointerMove = (e) => {
    if (e.pointerId !== activePointerId) return;
    const coord = coordOf(e);
    const rawDelta = coord - startCoord;
    const delta = rawDelta * sign;
    if (pendingStart) {
      const verdict = options.deferStart(e, delta, crossOf(e) - startCross);
      if (verdict === false) {
        releaseTracking();
        return;
      }
      if (verdict !== true) return;
      pendingStart = false;
      startCoord = coord;
      lastCoord = coord;
      samples.reset();
      samples.push(e.timeStamp, coord);
      capture(e.pointerId);
      callbacks.onStart(startCoord, activePointerType);
      return;
    }
    lastCoord = coord;
    samples.push(e.timeStamp, coord);
    const cutoff = e.timeStamp - VELOCITY_WINDOW_MS(activePointerType);
    samples.pruneBefore(cutoff, 2);
    callbacks.onMove(delta);
  };
  const finishGesture = (e) => {
    if (e.pointerId !== activePointerId) return;
    if (pendingStart) {
      releaseTracking();
      return;
    }
    const rawDelta = lastCoord - startCoord;
    const delta = rawDelta * sign;
    let velocity = 0;
    if (samples.length >= 3) {
      const first = samples.oldest();
      const last = samples.newest();
      const dt = last.t - first.t;
      if (dt > 0) velocity = (last.v - first.v) / dt * sign;
    }
    const finishedKind = activePointerType;
    activePointerId = null;
    samples.reset();
    try {
      if (handle.hasPointerCapture(e.pointerId)) {
        handle.releasePointerCapture(e.pointerId);
      }
    } catch {
    }
    callbacks.onEnd(delta, velocity, finishedKind);
  };
  const onPointerCancel = (e) => {
    if (e.pointerId !== activePointerId) return;
    const wasPending = pendingStart;
    releaseTracking();
    if (wasPending) return;
    callbacks.onCancel?.();
  };
  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", finishGesture);
  handle.addEventListener("pointercancel", onPointerCancel);
  const managesTouchAction = options.manageTouchAction !== false;
  const prevTouchAction = handle.style.touchAction;
  if (managesTouchAction) {
    handle.style.touchAction = isAxisVertical(mode) ? "pan-x" : "pan-y";
  }
  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", finishGesture);
    handle.removeEventListener("pointercancel", onPointerCancel);
    if (managesTouchAction) handle.style.touchAction = prevTouchAction;
    if (activePointerId !== null && handle.hasPointerCapture(activePointerId)) {
      handle.releasePointerCapture(activePointerId);
    }
  };
};

// src/core/primitives/rubber-band.ts
function rubberBand(overshoot, maxAxisSize) {
  const cap = Math.min(maxAxisSize * 0.15, 80);
  if (cap <= 0) return 0;
  const abs = Math.abs(overshoot);
  return Math.sign(overshoot) * (cap * abs / (abs + cap));
}

// src/core/features/soft-keyboard.ts
function dismissSoftKeyboardIfFocused(root) {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active) return false;
  if (!root.contains(active)) return false;
  const tag = active.tagName;
  const isEditable = tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable === true;
  if (!isEditable) return false;
  try {
    active.blur();
    return true;
  } catch {
    return false;
  }
}

// src/core/controllers/gesture-controller.ts
var GestureController = class {
  constructor(deps) {
    __publicField(this, "deps");
    __publicField(this, "detach", null);
    __publicField(this, "isDragging_", false);
    __publicField(this, "dragStartSize", 0);
    __publicField(this, "currentPointerKind", "touch");
    __publicField(this, "keyboardDismissed", false);
    __publicField(this, "dragSuppressed", false);
    __publicField(this, "dragPayload", { size: 0, delta: 0 });
    this.deps = deps;
  }
  get isDragging() {
    return this.isDragging_;
  }
  install() {
    if (this.detach) return this.detach;
    this.detach = installGestures(this.deps.handle, this.deps.mode, {
      onStart: (_coord, kind) => {
        if (this.deps.getDisableDrag?.()) {
          this.dragSuppressed = true;
          return;
        }
        this.dragSuppressed = false;
        this.deps.cancelAnimation();
        this.isDragging_ = true;
        this.dragStartSize = this.deps.getDragContext().size;
        this.currentPointerKind = kind;
        this.keyboardDismissed = false;
        this.deps.getRoot()?.setAttribute("data-dragging", "true");
        this.deps.element.style.willChange = "transform";
        this.deps.emit("dragstart", { size: this.dragStartSize });
      },
      onMove: (delta) => {
        if (this.dragSuppressed) return;
        const ctx = this.deps.getDragContext();
        const { min, max } = ctx.range;
        const maxAxis = ctx.maxAxisSize;
        const rubberOn = ctx.rubberBandEnabled;
        let next = this.dragStartSize + delta;
        if (next > max) {
          next = rubberOn ? max + rubberBand(next - max, maxAxis) : max;
        } else if (next < min) {
          next = rubberOn ? min - rubberBand(min - next, maxAxis) : min;
        }
        this.deps.applySize(next);
        if (!this.keyboardDismissed && this.currentPointerKind === "touch" && this.deps.mode === "bottom" && next < this.dragStartSize) {
          if (dismissSoftKeyboardIfFocused(this.deps.element)) {
            this.keyboardDismissed = true;
          }
        }
        if (this.deps.listenerCount("drag") > 0) {
          this.dragPayload.size = next;
          this.dragPayload.delta = delta;
          this.deps.emit("drag", this.dragPayload);
        }
      },
      onEnd: (delta, velocity, kind) => {
        if (this.dragSuppressed) {
          this.dragSuppressed = false;
          return;
        }
        this.isDragging_ = false;
        this.keyboardDismissed = false;
        this.deps.getRoot()?.removeAttribute("data-dragging");
        this.deps.emit("dragend", {
          size: this.deps.getDragContext().size,
          velocity
        });
        this.deps.settleAfterDrag(delta, velocity, kind);
      },
      onCancel: () => {
        if (this.dragSuppressed) {
          this.dragSuppressed = false;
          return;
        }
        this.isDragging_ = false;
        this.keyboardDismissed = false;
        this.deps.getRoot()?.removeAttribute("data-dragging");
        this.deps.emit("dragend", {
          size: this.deps.getDragContext().size,
          velocity: 0
        });
        const restoreTo = this.dragStartSize;
        void this.deps.animateTo(restoreTo, 0);
      }
    }, this.deps.gestureOptions);
    return this.detach;
  }
  forceClearDragState() {
    if (!this.isDragging_) return;
    this.isDragging_ = false;
    this.keyboardDismissed = false;
    this.deps.getRoot()?.removeAttribute("data-dragging");
    this.deps.element.style.willChange = "";
  }
};

// src/core/primitives/drag-zones.ts
var DRAG_ZONE_SELECTOR = "[data-bs-drag]";
var NO_DRAG_SELECTOR = "[data-bs-no-drag]";
var asElement = (target) => {
  const candidate = target;
  return candidate && typeof candidate.closest === "function" ? candidate : null;
};
function isDragAllowedFrom(target, mode) {
  const el = asElement(target);
  if (!el) return mode !== "zones";
  if (el.closest(NO_DRAG_SELECTOR)) return false;
  if (mode === "zones") return el.closest(DRAG_ZONE_SELECTOR) !== null;
  return true;
}

// src/core/primitives/content-gesture.ts
var CONTENT_DRAG_SLOP = 6;
function decideContentGesture(input) {
  const slop = input.slop ?? CONTENT_DRAG_SLOP;
  const cross = input.crossDelta ?? 0;
  const sharesScrollAxis = input.sharesScrollAxis ?? true;
  if (!sharesScrollAxis) {
    if (Math.abs(input.delta) < slop && Math.abs(cross) < slop) return "pending";
    if (Math.abs(input.delta) <= Math.abs(cross)) return "scroll";
    return "drag";
  }
  if (Math.abs(input.delta) < slop) return "pending";
  if (input.scrollTop > 0) return "scroll";
  if (input.delta > 0 && input.atMaxSnap) return "scroll";
  return "drag";
}

// src/core/primitives/logical-mode.ts
var isLogicalMode = (mode) => mode === "start" || mode === "end";
var readDirection = (el) => {
  if (!el) return "ltr";
  if (typeof getComputedStyle === "function") {
    try {
      if (getComputedStyle(el).direction === "rtl") return "rtl";
    } catch {
    }
  }
  try {
    const marked = el.closest?.("[dir]");
    if (marked) {
      return marked.getAttribute("dir")?.toLowerCase() === "rtl" ? "rtl" : "ltr";
    }
  } catch {
  }
  return "ltr";
};
var resolveMode = (mode, el) => {
  if (!isLogicalMode(mode)) return mode;
  const rtl = readDirection(el) === "rtl";
  if (mode === "start") return rtl ? "right" : "left";
  return rtl ? "left" : "right";
};

// src/core/primitives/touch-scroll-guard.ts
function installTouchScrollGuard(surface, isDragging) {
  const onTouchMove = (e) => {
    if (!isDragging()) return;
    if (e.cancelable) e.preventDefault();
  };
  surface.addEventListener("touchmove", onTouchMove, { passive: false });
  return () => surface.removeEventListener("touchmove", onTouchMove);
}

// src/core/primitives/aria-slider-writer.ts
var AriaSliderWriter = class {
  constructor(handle, mode) {
    __publicField(this, "handle", handle);
    handle.setAttribute(
      "aria-orientation",
      mode === "bottom" || mode === "top" ? "vertical" : "horizontal"
    );
  }
  setValue(allowedIds, activeId) {
    if (allowedIds.length === 0) {
      this.handle.removeAttribute("aria-valuemin");
      this.handle.removeAttribute("aria-valuemax");
      this.handle.removeAttribute("aria-valuenow");
      this.handle.removeAttribute("aria-valuetext");
      return;
    }
    const max = Math.max(allowedIds.length - 1, 0);
    const idx = Math.max(allowedIds.indexOf(activeId), 0);
    this.handle.setAttribute("aria-valuemin", "0");
    this.handle.setAttribute("aria-valuemax", String(max));
    this.handle.setAttribute("aria-valuenow", String(idx));
    this.handle.setAttribute("aria-valuetext", activeId);
  }
};

// src/core/features/scroll-cache.ts
function createScrollCache(deps) {
  const positions = /* @__PURE__ */ new Map();
  const isSmallSize = (size) => {
    const max = deps.getMaxAxisSize();
    if (max <= 0) return false;
    return size < max / 2;
  };
  return {
    cache(fromId, prevSize, nextSize) {
      const container = deps.scrollContainer;
      if (!container) return;
      if (isSmallSize(prevSize)) return;
      if (!isSmallSize(nextSize)) return;
      positions.set(fromId, container.scrollTop);
    },
    restore(toId, prevSize, nextSize) {
      const container = deps.scrollContainer;
      if (!container) return;
      if (isSmallSize(nextSize)) return;
      if (!isSmallSize(prevSize)) return;
      const cached = positions.get(toId);
      if (cached === void 0) return;
      container.scrollTop = cached;
      positions.delete(toId);
    },
    clear() {
      positions.clear();
    }
  };
}

// src/core/primitives/anchor-animations.ts
var DEFAULT_DURATION3 = 200;
var DEFAULT_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
var PRESET_FRAMES = {
  fade: {
    enter: [{ opacity: 0 }, { opacity: 1 }],
    exit: [{ opacity: 1 }, { opacity: 0 }]
  },
  scale: {
    enter: [
      { opacity: 0, transform: "scale(0.85)" },
      { opacity: 1, transform: "scale(1)" }
    ],
    exit: [
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: "scale(0.85)" }
    ]
  },
  slide: {
    enter: [
      { opacity: 0, transform: "translateY(10px)" },
      { opacity: 1, transform: "translateY(0)" }
    ],
    exit: [
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: "translateY(10px)" }
    ]
  },
  pop: {
    enter: [
      { opacity: 0, transform: "scale(0.6)", offset: 0 },
      { opacity: 1, transform: "scale(1.06)", offset: 0.7 },
      { opacity: 1, transform: "scale(1)", offset: 1 }
    ],
    exit: [
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: "scale(0.6)" }
    ]
  }
};
var INSTANT = {
  finished: Promise.resolve(),
  cancel: () => {
  }
};
function resolveTransitionFrames(spec, phase) {
  const fallback = { frames: null, duration: 0, easing: DEFAULT_EASING };
  if (spec === "none") return fallback;
  if (spec === void 0 || typeof spec === "string") {
    const preset2 = PRESET_FRAMES[spec ?? "fade"];
    return {
      frames: preset2[phase],
      duration: DEFAULT_DURATION3,
      easing: DEFAULT_EASING
    };
  }
  const custom = phase === "enter" ? spec.enter : spec.exit;
  if (custom) {
    return {
      frames: custom,
      duration: spec.duration ?? DEFAULT_DURATION3,
      easing: spec.easing ?? DEFAULT_EASING
    };
  }
  if (spec.preset === "none") return fallback;
  const preset = PRESET_FRAMES[spec.preset ?? "fade"];
  return {
    frames: preset[phase],
    duration: spec.duration ?? DEFAULT_DURATION3,
    easing: spec.easing ?? DEFAULT_EASING
  };
}
function runAnchorTransition(el, spec, phase) {
  const respectReduced = typeof spec === "object" ? spec.respectReducedMotion !== false : true;
  if (respectReduced && prefersReducedMotion()) return INSTANT;
  const { frames, duration, easing } = resolveTransitionFrames(spec, phase);
  if (!frames || duration <= 0) return INSTANT;
  if (typeof el.animate !== "function") return INSTANT;
  const animation = el.animate(frames, {
    duration,
    easing,
    fill: "both"
  });
  const finished = animation.finished.then(() => void 0).catch(() => void 0);
  return {
    finished,
    cancel: () => {
      try {
        animation.cancel();
      } catch {
        return;
      }
    }
  };
}

// src/core/features/sheet-anchors.ts
function attachAnchor(deps, opts) {
  const doc = deps.host.ownerDocument;
  const wrapper = doc.createElement("div");
  wrapper.className = "bs-anchor";
  const interactive = opts.interactive ?? true;
  const position = opts.position ?? "sheet-top-right";
  const isDock = position === "dock-bottom" || position === "dock-top";
  const ws = wrapper.style;
  ws.position = "fixed";
  if (isDock) {
    ws.left = "0";
    ws.right = "0";
    if (position === "dock-bottom") {
      ws.bottom = "0";
    } else {
      ws.top = "0";
    }
  } else {
    applyOverlayPosition(ws, deps.mode, position, opts.inset ?? "16px");
  }
  if (opts.fadeRange) {
    const [r0, r1] = opts.fadeRange;
    const span = Math.max(r1 - r0, 1e-4);
    ws.opacity = `clamp(0, calc((var(--bs-progress, 0) - ${r0}) / ${span}), 1)`;
  }
  wrapper.appendChild(opts.element);
  deps.host.appendChild(wrapper);
  let visible = null;
  let inFlight = null;
  const shouldShow = (state) => {
    if (typeof opts.showOn === "function") return opts.showOn(state);
    if (Array.isArray(opts.showOn)) return opts.showOn.includes(state.activeId);
    return isDock || state.size > 0;
  };
  const applyVisibility = (next, animate) => {
    if (next === visible) return;
    visible = next;
    inFlight?.cancel();
    inFlight = null;
    wrapper.style.pointerEvents = next && interactive ? "auto" : "none";
    if (next) {
      wrapper.style.visibility = "";
      if (animate) {
        inFlight = runAnchorTransition(opts.element, opts.animation, "enter");
      }
      return;
    }
    if (!animate) {
      wrapper.style.visibility = "hidden";
      return;
    }
    const handle = runAnchorTransition(opts.element, opts.animation, "exit");
    inFlight = handle;
    void handle.finished.then(() => {
      if (inFlight === handle && visible === false) {
        wrapper.style.visibility = "hidden";
      }
    });
  };
  const evaluate = (animate) => {
    if (deps.isDestroyed()) return;
    applyVisibility(shouldShow(deps.getState()), animate);
  };
  const offs = [
    deps.on("snap", () => evaluate(true)),
    deps.on("open", () => evaluate(true)),
    deps.on("close", () => evaluate(true))
  ];
  evaluate(false);
  return {
    wrapper,
    detach: () => {
      offs.forEach((off) => off());
      inFlight?.cancel();
      inFlight = null;
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    },
    syncZ: (z) => {
      wrapper.style.zIndex = String(z);
    }
  };
}

// src/core/features/scrim-stages.ts
var matchesId = (def, activeId) => {
  if (def.for === void 0) return false;
  return Array.isArray(def.for) ? def.for.includes(activeId) : def.for === activeId;
};
var matchesRange = (def, progress) => {
  if (!def.forRange) return false;
  const [from, to] = def.forRange;
  return progress >= from && progress <= to;
};
function installScrimStages(deps, opts) {
  const doc = deps.host.ownerDocument;
  const entries2 = opts.stages.map((def) => {
    const wrapper = doc.createElement("div");
    wrapper.className = "bs-scrim-stage";
    const ws = wrapper.style;
    ws.position = "absolute";
    applyOverlayPosition(
      ws,
      deps.mode,
      def.position ?? opts.position ?? "center",
      def.inset ?? opts.inset ?? "16px"
    );
    ws.visibility = "hidden";
    ws.pointerEvents = "none";
    wrapper.appendChild(def.element);
    deps.host.appendChild(wrapper);
    return { def, wrapper, inFlight: null };
  });
  let active = null;
  const resolveActive = () => {
    const state = deps.getState();
    if (state.size === 0) {
      return entries2.find((e) => matchesId(e.def, state.activeId)) ?? null;
    }
    return entries2.find((e) => matchesId(e.def, state.activeId)) ?? entries2.find((e) => matchesRange(e.def, state.progress)) ?? null;
  };
  const hide = (entry, animate) => {
    entry.inFlight?.cancel();
    entry.wrapper.style.pointerEvents = "none";
    if (!animate) {
      entry.inFlight = null;
      entry.wrapper.style.visibility = "hidden";
      return;
    }
    const handle = runAnchorTransition(
      entry.def.element,
      entry.def.animation ?? opts.animation,
      "exit"
    );
    entry.inFlight = handle;
    void handle.finished.then(() => {
      if (entry.inFlight === handle && active !== entry) {
        entry.wrapper.style.visibility = "hidden";
      }
    });
  };
  const show = (entry, animate) => {
    entry.inFlight?.cancel();
    entry.inFlight = null;
    entry.wrapper.style.visibility = "";
    entry.wrapper.style.pointerEvents = entry.def.interactive ?? opts.interactive ?? false ? "auto" : "none";
    if (animate) {
      entry.inFlight = runAnchorTransition(
        entry.def.element,
        entry.def.animation ?? opts.animation,
        "enter"
      );
    }
  };
  const update = (animate) => {
    if (deps.isDestroyed()) return;
    const next = resolveActive();
    if (next === active) return;
    const prev = active;
    active = next;
    if (prev) hide(prev, animate);
    if (next) show(next, animate);
  };
  const offs = [
    deps.on("snap", () => update(true)),
    deps.on("open", () => update(true)),
    deps.on("close", () => update(true))
  ];
  if (entries2.some((e) => e.def.forRange)) {
    offs.push(deps.on("progress", () => update(true)));
  }
  update(false);
  return () => {
    offs.forEach((off) => off());
    for (const entry of entries2) {
      entry.inFlight?.cancel();
      entry.inFlight = null;
      if (entry.wrapper.parentNode) {
        entry.wrapper.parentNode.removeChild(entry.wrapper);
      }
    }
    active = null;
  };
}

// src/core/primitives/engine-options.ts
var DEFAULT_FLICK_VELOCITY = 0.65;
var DEFAULT_DRAG_THRESHOLD = 18;
function resolveEngineOptions(opts, extras) {
  const initialAllowed = opts.allowed ?? opts.snapPoints.map((p) => p.id);
  let initialId = opts.initial ?? initialAllowed[0] ?? opts.snapPoints[0]?.id ?? "default";
  if (opts.persistKey) {
    const restored = readPersistedIdSafe(opts.persistKey);
    if (restored && initialAllowed.includes(restored)) {
      initialId = restored;
    }
  }
  return {
    mode: resolveMode(opts.mode ?? "bottom", opts.element),
    flickVelocity: opts.flickVelocity ?? DEFAULT_FLICK_VELOCITY,
    dragThreshold: opts.dragThreshold ?? DEFAULT_DRAG_THRESHOLD,
    dragFrom: opts.dragFrom ?? (opts.handle ? "handle" : "sheet"),
    dragFromContent: opts.dragFromContent ?? true,
    rubberBandEnabled: opts.rubberBand ?? true,
    closeOnBack: opts.closeOnBack ?? false,
    persistent: opts.persistent ?? false,
    disableClose: opts.disableClose ?? false,
    disableDrag: opts.disableDrag ?? false,
    closeOnRouteChange: opts.closeOnRouteChange ?? false,
    radius: opts.radius,
    maxHeight: opts.maxHeight,
    initialAllowed,
    initialId,
    scrim: {
      scrimMode: opts.scrimMode,
      scrimColor: opts.scrimColor,
      scrimBlur: opts.scrimBlur,
      scrimInteractive: opts.scrimInteractive ?? (opts.scrimTapToClose ? true : void 0),
      scrimTapToClose: opts.scrimTapToClose,
      scrimPreset: opts.scrimPreset,
      screenRange: opts.screenRange,
      backdropRange: opts.backdropRange
    },
    animation: {
      animation: opts.animation,
      settleAnimation: opts.settleAnimation,
      duration: opts.duration,
      easing: opts.easing,
      spring: opts.spring,
      respectReducedMotion: opts.respectReducedMotion,
      viewTransitions: opts.viewTransitions
    },
    lifecycle: {
      focusTrap: opts.focusTrap,
      initialFocus: opts.initialFocus,
      closeOnEscape: opts.closeOnEscape,
      lockBodyScroll: opts.lockBodyScroll,
      inertSiblings: opts.inertSiblings,
      shouldApplyInertSiblings: extras?.shouldApplyInertSiblings,
      returnFocus: opts.returnFocusTo
    }
  };
}
var readPersistedIdSafe = (key) => {
  if (typeof window === "undefined") return null;
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

// src/core/primitives/teardown-stack.ts
var TeardownStack = class {
  constructor() {
    __publicField(this, "fns", []);
  }
  add(fn) {
    if (fn) this.fns.push(fn);
  }
  drain() {
    while (this.fns.length) {
      try {
        this.fns.pop()();
      } catch (err) {
        queueMicrotask(() => {
          throw err;
        });
      }
    }
  }
};

// src/core/BottomSheetCore.ts
var HAPTIC_DURATION_MS = 8;
var BottomSheetCore = class {
  constructor(opts) {
    __publicField(this, "id", nextInstanceId("bs"));
    __publicField(this, "element");
    __publicField(this, "handle");
    __publicField(this, "scrollContainer");
    __publicField(this, "backdrop");
    __publicField(this, "screenComponent");
    __publicField(this, "scrimParent", null);
    __publicField(this, "mode");
    __publicField(this, "flickVelocity");
    __publicField(this, "dragThreshold");
    __publicField(this, "dragFromMode");
    __publicField(this, "dragFromContentDefault");
    __publicField(this, "rubberBandEnabled");
    __publicField(this, "scrim");
    __publicField(this, "aria");
    __publicField(this, "animation");
    __publicField(this, "lifecycle");
    __publicField(this, "closeOnBack");
    __publicField(this, "routedTo");
    __publicField(this, "fitContentToSnap");
    __publicField(this, "persistent");
    __publicField(this, "disableCloseFlag");
    __publicField(this, "disableDragFlag");
    __publicField(this, "closeOnRouteChange");
    __publicField(this, "maxHeight");
    __publicField(this, "maxHeightDeps");
    __publicField(this, "snapPointsRaw");
    __publicField(this, "snaps");
    __publicField(this, "activeId");
    __publicField(this, "size", 0);
    __publicField(this, "gesture");
    __publicField(this, "contentGesture");
    __publicField(this, "detachSheetGesture", null);
    __publicField(this, "detachSliderKeyboard", null);
    __publicField(this, "rootEl", null);
    __publicField(this, "destroyed", false);
    __publicField(this, "restClosed", false);
    __publicField(this, "currentViewTransition", null);
    __publicField(this, "currentAbort", new AbortController());
    __publicField(this, "sizeWriteSentinel", new WriteSentinel());
    __publicField(this, "progressWriteSentinel", new WriteSentinel());
    __publicField(this, "isTopSheet", true);
    __publicField(this, "opening", false);
    __publicField(this, "promotedForOpen", false);
    __publicField(this, "allowOvershoot", false);
    __publicField(this, "progressPayload", {
      value: 0,
      size: 0
    });
    __publicField(this, "dragContextBuf", {
      size: 0,
      maxAxisSize: 0,
      range: { min: 0, max: 0 },
      rubberBandEnabled: false
    });
    __publicField(this, "bus", createEventBus());
    __publicField(this, "persistKey");
    __publicField(this, "linkedSheets", []);
    __publicField(this, "scrollCache");
    __publicField(this, "teardowns", new TeardownStack());
    __publicField(this, "anchors", []);
    __publicField(this, "anchorHost", null);
    __publicField(this, "stackZ", 100);
    __publicField(this, "detachScrimStages", null);
    __publicField(this, "stackEffectEnabled", false);
    __publicField(this, "stackEffectPrimed", false);
    __publicField(this, "fitDeps");
    __publicField(this, "transformTemplate");
    __publicField(this, "featureList", []);
    __publicField(this, "featureCtx");
    const resolved = resolveEngineOptions(opts, {
      shouldApplyInertSiblings: () => {
        if (typeof document === "undefined") return false;
        const bodyChildren = Array.from(document.body.children);
        return bodyChildren.some(
          (c) => c === opts.element || c.contains(opts.element)
        );
      }
    });
    this.element = opts.element;
    this.handle = opts.handle ?? opts.element;
    this.scrollContainer = opts.scrollContainer;
    this.backdrop = opts.backdrop;
    this.screenComponent = opts.scrim ?? opts.screenComponent;
    this.scrimParent = this.screenComponent?.parentElement ?? null;
    this.mode = resolved.mode;
    this.element.dataset.mode = this.mode;
    this.transformTemplate = buildTransformTemplate(this.mode);
    this.aria = new AriaSliderWriter(this.handle, this.mode);
    this.flickVelocity = resolved.flickVelocity;
    this.dragThreshold = resolved.dragThreshold;
    this.dragFromMode = resolved.dragFrom;
    this.dragFromContentDefault = resolved.dragFromContent;
    this.rubberBandEnabled = resolved.rubberBandEnabled;
    this.scrim = new ScrimController(
      {
        mode: this.mode,
        screenComponent: this.screenComponent,
        backdrop: this.backdrop,
        isDestroyed: () => this.destroyed,
        getAllowedIds: () => this.snaps.getAllowedIds().slice(),
        getResolvedSnaps: () => this.snaps.getResolvedSnaps().slice(),
        snapTo: (id) => {
          void this.snapTo(id);
        },
        close: () => {
          if (!this.canDismiss()) return;
          void this.close("backdrop");
        }
      },
      resolved.scrim
    );
    this.animation = new AnimationRunner(
      {
        element: this.element,
        getRootEl: () => this.rootEl,
        applySize: (size) => this.applySize(size),
        getSize: () => this.size,
        isDragging: () => this.isDraggingAny(),
        applyAux: (size) => this.applySize(size, true),
        getTransformFor: (size) => {
          const cap = this.snaps.getMaxAxisSize();
          const shown = cap > 0 && !this.allowOvershoot ? Math.min(size, cap) : size;
          return this.transformTemplate(cap - shown);
        }
      },
      resolved.animation
    );
    this.lifecycle = new LifecycleController(
      {
        element: this.element,
        close: () => this.close()
      },
      resolved.lifecycle
    );
    this.closeOnBack = resolved.closeOnBack;
    this.routedTo = opts.routedTo;
    this.fitContentToSnap = opts.fitContentToSnap === true;
    this.persistent = resolved.persistent;
    this.disableCloseFlag = resolved.disableClose;
    this.disableDragFlag = resolved.disableDrag;
    this.closeOnRouteChange = resolved.closeOnRouteChange;
    this.stackEffectEnabled = opts.stackEffect ?? false;
    this.snapPointsRaw = opts.snapPoints;
    this.persistKey = opts.persistKey;
    if (opts.linkedSheets) {
      this.linkedSheets = opts.linkedSheets;
    }
    const byName = /* @__PURE__ */ new Map();
    for (const feature of opts.features ?? []) {
      byName.set(feature.name, feature);
    }
    this.featureList = Array.from(byName.values());
    this.activeId = resolved.initialId;
    auditVhUsage(this.snapPointsRaw);
    this.auditDuplicateSnapIds(this.snapPointsRaw);
    this.rootEl = this.element.closest(".bs-root");
    this.maxHeightDeps = {
      element: this.element,
      mode: this.mode,
      getMaxAxisSize: () => this.snaps.getMaxAxisSize(),
      setMaxAxisSize: (size) => {
        this.snaps.setMaxAxisSize(size);
      },
      recompute: () => this.recompute()
    };
    this.maxHeight = createMaxHeightController(this.maxHeightDeps);
    this.fitDeps = {
      element: this.element,
      scrollContainer: this.scrollContainer,
      mode: this.mode,
      getMaxHeightCap: () => this.maxHeight.getCap()
    };
    this.snaps = new SnapResolver(
      this.snapPointsRaw,
      resolved.initialAllowed,
      this.mode,
      () => measureFitSize(this.fitDeps),
      (maxAxisSize) => {
        this.element.style[layoutAxis(this.mode)] = `${maxAxisSize}px`;
      }
    );
    const initial = this.snaps.findById(this.activeId);
    if (initial) this.size = initial.size;
    this.applySize(this.size);
    this.setRestClosed(this.size === 0);
    this.updateAriaSlider();
    this.scrollCache = createScrollCache({
      scrollContainer: this.scrollContainer,
      getMaxAxisSize: () => this.snaps.getMaxAxisSize()
    });
    this.featureCtx = this.buildFeatureContext(opts.autoCollapseAfter);
    this.attach();
    this.registerInStack();
    if (this.snaps.getMaxAxisSize() === 0 && typeof IntersectionObserver !== "undefined" && typeof document !== "undefined") {
      const io = new IntersectionObserver((entries2) => {
        for (const entry of entries2) {
          if (!entry.isIntersecting) continue;
          if (this.destroyed) return;
          this.snaps.recompute();
          this.healActiveSnap();
          io.disconnect();
          return;
        }
      });
      io.observe(this.element);
      this.teardowns.add(() => io.disconnect());
    }
    this.teardowns.add(
      installFitObserver({
        handle: this.handle,
        scrollContainer: this.scrollContainer,
        hasFitSnap: () => this.snapPointsRaw.some(
          (p) => p.size === "fit" || p.size === "content"
        ),
        isDestroyed: () => this.destroyed,
        isDragging: () => this.isDraggingAny(),
        recompute: () => this.recompute()
      })
    );
    if (resolved.radius !== void 0) this.setRadius(resolved.radius);
    if (resolved.maxHeight !== void 0) this.setMaxHeight(resolved.maxHeight);
    this.applyAutoAriaLabelledBy();
    this.runFeatureStage("post");
    this.warnOrphanFeatureOptions();
    if (this.size > 0) {
      this.handleOpen();
    }
  }
  buildFeatureContext(autoCollapseAfter) {
    return {
      element: this.element,
      scrollContainer: this.scrollContainer,
      sheetId: this.id,
      options: {
        routedTo: this.routedTo,
        closeOnBack: this.closeOnBack,
        closeOnRouteChange: this.closeOnRouteChange,
        persistKey: this.persistKey,
        autoCollapseAfter,
        fitContentToSnap: this.fitContentToSnap
      },
      isDestroyed: () => this.destroyed,
      isDragging: () => this.isDraggingAny(),
      isAnimating: () => this.animation.isAnimating,
      isTopSheet: () => this.isTopSheet,
      isVerticalAxis: () => this.mode === "bottom" || this.mode === "top",
      getSize: () => this.size,
      getActiveId: () => this.activeId,
      getAllowedIds: () => this.snaps.getAllowedIds().slice(),
      allowedIdsBySize: () => this.allowedIdsBySize(),
      getMaxAxisSize: () => this.snaps.getMaxAxisSize(),
      resolveSnap: (id) => this.snaps.findById(id),
      resolveActiveSnap: () => this.snaps.findById(this.activeId),
      setSize: (size) => {
        this.size = size;
      },
      setMaxAxisSize: (size) => {
        this.snaps.setMaxAxisSize(size);
      },
      applySize: (size) => this.applySize(size),
      recomputeSnaps: () => this.recomputeSnaps(),
      newCycle: () => {
        this.newCycle();
      },
      cancelInFlight: () => {
        this.animation.cancel();
      },
      resyncAfterResize: () => this.resyncAfterResize(),
      snapTo: (id) => {
        void this.snapTo(id);
      },
      close: (reason) => this.close(reason),
      attachDragSurface: (surface, kind) => this.attachDragSurface(surface, kind),
      on: (event, fn) => this.on(event, fn),
      addTeardown: (fn) => this.teardowns.add(fn)
    };
  }
  runFeatureStage(stage) {
    for (const feature of this.featureList) {
      if ((feature.stage ?? "post") !== stage) continue;
      const teardown = feature.install(this.featureCtx);
      if (teardown) this.teardowns.add(teardown);
    }
  }
  warnOrphanFeatureOptions() {
    const names = new Set(this.featureList.map((f) => f.name));
    if ((this.closeOnBack || this.routedTo !== void 0 || this.closeOnRouteChange) && !names.has("route")) {
      devWarn(
        "[BottomSheet] closeOnBack/routedTo/closeOnRouteChange need routeFeature() \u2014 option ignored"
      );
    }
    if (this.fitContentToSnap && !names.has("content-fit")) {
      devWarn(
        "[BottomSheet] fitContentToSnap needs contentFitFeature() \u2014 option ignored"
      );
    }
    if (this.persistKey && !names.has("persist")) {
      devWarn(
        "[BottomSheet] persistKey needs persistFeature() \u2014 snaps will not be saved"
      );
    }
  }
  get state() {
    return {
      size: this.size,
      activeId: this.activeId,
      isDragging: this.isDraggingAny(),
      isAnimating: this.animation.isAnimating,
      progress: this.computeProgress(this.size)
    };
  }
  on(event, fn) {
    return this.bus.on(event, fn);
  }
  use(plugin) {
    if (this.destroyed) {
      devWarn(
        `[BottomSheet] use("${plugin.name}") called on destroyed engine \u2014 ignored.`
      );
      return this;
    }
    const scoped = [];
    const scope = {
      add: (fn) => {
        if (typeof fn === "function") scoped.push(fn);
      }
    };
    let teardown;
    try {
      teardown = plugin.install(this, scope);
    } catch (err) {
      for (let i = scoped.length - 1; i >= 0; i--) {
        try {
          scoped[i]();
        } catch (cleanupErr) {
          queueMicrotask(() => {
            throw cleanupErr;
          });
        }
      }
      queueMicrotask(() => {
        throw err;
      });
      return this;
    }
    for (const fn of scoped) this.teardowns.add(fn);
    if (typeof teardown === "function") {
      this.teardowns.add(teardown);
    }
    return this;
  }
  setLinkedSheets(sheets) {
    if (this.destroyed) return;
    this.linkedSheets = sheets;
  }
  getAllowedIds() {
    return this.snaps.getAllowedIds().slice();
  }
  getResolvedSnaps() {
    return this.snaps.getResolvedSnaps();
  }
  async snapTo(id, velocityOrOpts = 0, _skipBeforeSnap = false) {
    if (this.destroyed) return;
    const opts = typeof velocityOrOpts === "object" ? velocityOrOpts : { velocity: velocityOrOpts };
    const velocityPxPerMs = opts.velocity ?? 0;
    const externalSignal = opts.signal;
    if (externalSignal?.aborted) return;
    const target = this.snaps.findById(id);
    if (!target) {
      devWarn(`[BottomSheet] unknown snap id: ${id}`);
      return;
    }
    if (!this.snaps.getAllowedIds().includes(id)) {
      devWarn(`[BottomSheet] snap "${id}" is not in allowed list`);
      return;
    }
    if (!_skipBeforeSnap && this.emitBeforeSnap(target, this.activeId)) {
      return;
    }
    const resumingOpen = this.opening;
    const signal = this.newCycle();
    const onExternalAbort = () => {
      this.animation.cancel();
      this.newCycle();
    };
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const wasClosed = this.size === 0 || resumingOpen;
    const previousId = this.activeId;
    const previousSize = this.size;
    this.scrollCache.cache(previousId, previousSize, target.size);
    this.activeId = id;
    const rawTargetSize = this.snapPointsRaw.find((p) => p.id === id)?.size;
    const opensToRest = id === "closed" || rawTargetSize === 0;
    if (wasClosed && !opensToRest) {
      this.opening = true;
      if (!resumingOpen) {
        this.promotedForOpen = true;
        sheetStack.promote(this.id);
      }
    }
    if (this.animation.viewTransitionsAvailable) {
      this.currentViewTransition?.skipTransition?.();
      const vt = document.startViewTransition(() => {
        this.applySize(target.size);
      });
      vt.ready?.catch(() => {
      });
      this.currentViewTransition = vt;
      try {
        await vt.finished;
      } catch {
      }
      if (this.currentViewTransition === vt) this.currentViewTransition = null;
    } else {
      await this.animation.animateTo(target.size, velocityPxPerMs);
    }
    externalSignal?.removeEventListener("abort", onExternalAbort);
    if (signal.aborted) return;
    this.opening = false;
    this.completeSnap(id, target.size, previousSize, wasClosed, false);
  }
  completeSnap(id, targetSize, previousSize, wasClosed, withHaptic) {
    this.scrollCache.restore(id, previousSize, targetSize);
    this.updateAriaSlider();
    this.emit("snap", {
      id,
      size: this.size,
      progress: this.computeProgress(this.size)
    });
    if (withHaptic) this.haptic();
    this.setRestClosed(targetSize === 0);
    if (wasClosed && targetSize > 0) this.emitOpenSequence(id);
    if (targetSize === 0) this.emitCloseSequence();
  }
  setRestClosed(closed) {
    if (closed === this.restClosed) return;
    this.restClosed = closed;
    if (closed) this.element.setAttribute("data-bs-rest", "closed");
    else this.element.removeAttribute("data-bs-rest");
  }
  emitOpenSequence(id) {
    this.emit("open", { id });
    this.handleOpen();
    notifyLinkedSheets(this.linkedSheets, this);
    this.emit("opened", { id });
  }
  emitCloseSequence() {
    this.emit("close", void 0);
    this.handleClose();
    this.emit("closed", void 0);
  }
  async dragTo(targetSize, velocityOrOpts = 0) {
    if (this.destroyed) return;
    const opts = typeof velocityOrOpts === "object" ? velocityOrOpts : { velocity: velocityOrOpts };
    const velocityPxPerMs = opts.velocity ?? 0;
    const externalSignal = opts.signal;
    if (externalSignal?.aborted) return;
    this.newCycle();
    const onExternalAbort = () => {
      this.animation.cancel();
      this.newCycle();
    };
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const clamped = Math.max(0, Math.min(targetSize, this.snaps.getMaxAxisSize()));
    await this.animation.animateTo(clamped, velocityPxPerMs);
    externalSignal?.removeEventListener("abort", onExternalAbort);
    if (this.destroyed || externalSignal?.aborted) return;
  }
  open(id) {
    if (this.destroyed) return Promise.resolve();
    const target = id ?? this.snaps.getAllowedIds().find((a) => (this.snaps.findById(a)?.size ?? 0) > 0) ?? this.activeId;
    return this.snapTo(target);
  }
  close(reason = "programmatic") {
    if (this.destroyed) return Promise.resolve();
    if (this.disableCloseFlag) return Promise.resolve();
    if (this.size > 0 && this.emitBeforeClose(reason)) return Promise.resolve();
    const closedId = this.snapPointsRaw.find((p) => p.id === "closed")?.id ?? this.snaps.getAllowedIds().find((a) => this.snaps.findById(a)?.size === 0) ?? this.snaps.getAllowedIds()[0];
    return this.snapTo(closedId ?? this.activeId);
  }
  canDismiss() {
    return !this.persistent && !this.disableCloseFlag && !this.destroyed;
  }
  setPersistent(value) {
    if (this.destroyed) return;
    this.persistent = value;
  }
  setDisableClose(value) {
    if (this.destroyed) return;
    this.disableCloseFlag = value;
  }
  setDisableDrag(value) {
    if (this.destroyed) return;
    this.disableDragFlag = value;
  }
  setDragFromContent(value) {
    if (this.destroyed) return;
    this.dragFromContentDefault = value;
  }
  setDragFrom(mode) {
    if (this.destroyed || mode === this.dragFromMode) return;
    this.gesture?.forceClearDragState();
    this.detachSheetGesture?.();
    this.dragFromMode = mode;
    this.mountSheetGesture();
  }
  getDragFrom() {
    return this.dragFromMode;
  }
  setMode(mode) {
    if (this.destroyed) return;
    const next = resolveMode(mode, this.element);
    if (next === this.mode) return;
    const wasVertical = this.mode === "bottom" || this.mode === "top";
    const nowVertical = next === "bottom" || next === "top";
    this.gesture?.forceClearDragState();
    this.detachSheetGesture?.();
    this.animation.cancel();
    this.element.style.removeProperty(layoutAxis(this.mode));
    this.mode = next;
    this.element.dataset.mode = next;
    this.transformTemplate = buildTransformTemplate(next);
    this.maxHeightDeps.mode = next;
    this.fitDeps.mode = next;
    this.snaps.setMode(next);
    this.scrim.setSheetMode(next);
    if (wasVertical !== nowVertical) {
      this.aria = new AriaSliderWriter(this.handle, next);
    }
    this.detachSliderKeyboard?.();
    this.mountSliderKeyboard();
    this.mountSheetGesture();
    this.recompute();
    const active = this.snaps.findById(this.activeId);
    if (active) this.applySize(active.size);
    this.updateAriaSlider();
  }
  getMode() {
    return this.mode;
  }
  isTop() {
    return this.isTopSheet;
  }
  depth() {
    return sheetStack.depthOf(this.id);
  }
  expand() {
    if (this.destroyed) return Promise.resolve();
    const ids = this.allowedIdsBySize();
    const target = ids[ids.length - 1];
    if (!target) return Promise.resolve();
    return this.snapTo(target);
  }
  collapse() {
    if (this.destroyed) return Promise.resolve();
    const ids = this.allowedIdsBySize();
    const nonZero = ids.find((id) => (this.snaps.findById(id)?.size ?? 0) > 0);
    const target = nonZero ?? ids[0];
    if (!target) return Promise.resolve();
    return this.snapTo(target);
  }
  setRadius(r) {
    if (this.destroyed) return;
    this.maxHeight.setRadius(r);
  }
  setMaxHeight(h) {
    if (this.destroyed) return;
    this.maxHeight.setMaxHeight(h);
  }
  setAllowed(ids, snap) {
    if (this.destroyed) return;
    this.snaps.setAllowedIds(ids);
    this.updateAriaSlider();
    if (snap && ids.includes(snap)) {
      void this.snapTo(snap, 0, true);
    } else if (!ids.includes(this.activeId)) {
      const fallback = ids[0];
      if (fallback) void this.snapTo(fallback, 0, true);
    }
  }
  setBackdropRange(range) {
    this.scrim.setBackdropRange(range, () => this.applySize(this.size));
  }
  setScreenRange(range) {
    this.scrim.setScreenRange(range, () => this.applySize(this.size));
  }
  setScrimColor(color) {
    this.scrim.setScrimColor(color);
  }
  setScrimBlur(blur) {
    this.scrim.setScrimBlur(blur);
  }
  setScrimInteractive(interactive) {
    this.scrim.setScrimInteractive(interactive);
  }
  setScrim(opts) {
    this.scrim.setScrim(opts, () => this.applySize(this.size));
  }
  setScrimMode(mode) {
    this.scrim.setScrimMode(mode, () => this.applySize(this.size));
  }
  setScrimTapToClose(enabled) {
    this.scrim.setScrimTapToClose(enabled);
  }
  setScrimEnabled(enabled) {
    this.scrim.setScrimEnabled(enabled, () => this.applySize(this.size));
  }
  setScrimOverlay(opts) {
    return this.scrim.setScrimOverlay(opts);
  }
  addAnchor(opts) {
    if (this.destroyed || typeof document === "undefined") return () => {
    };
    if (!this.anchorHost) {
      this.anchorHost = this.rootEl ?? this.element.parentElement ?? document.body;
      this.anchorHost.style.setProperty("--bs-size", `${this.size}px`);
      this.anchorHost.style.setProperty(
        "--bs-progress",
        String(this.computeProgress(this.size))
      );
    }
    const handle = attachAnchor(
      {
        mode: this.mode,
        host: this.anchorHost,
        getState: () => ({
          activeId: this.activeId,
          size: this.size,
          progress: this.computeProgress(this.size)
        }),
        on: (event, fn) => this.on(event, fn),
        isDestroyed: () => this.destroyed
      },
      opts
    );
    handle.syncZ(this.stackZ + 1);
    this.anchors.push(handle);
    const detach = () => {
      const idx = this.anchors.indexOf(handle);
      if (idx === -1) return;
      this.anchors.splice(idx, 1);
      handle.detach();
    };
    this.teardowns.add(detach);
    return detach;
  }
  setScrimStages(opts) {
    if (this.destroyed || typeof document === "undefined") return () => {
    };
    this.detachScrimStages?.();
    this.detachScrimStages = null;
    if (!opts) return () => {
    };
    const host = this.screenComponent?.parentElement;
    if (!host) {
      devWarn(
        "[BottomSheet] setScrimStages: no scrim element mounted \u2014 pass `scrim` to the engine first."
      );
      return () => {
      };
    }
    const detachInstalled = installScrimStages(
      {
        mode: this.mode,
        host,
        getState: () => ({
          activeId: this.activeId,
          size: this.size,
          progress: this.computeProgress(this.size)
        }),
        on: (event, fn) => this.on(event, fn),
        isDestroyed: () => this.destroyed
      },
      opts
    );
    const detach = () => {
      if (this.detachScrimStages === detach) this.detachScrimStages = null;
      detachInstalled();
    };
    this.detachScrimStages = detach;
    this.teardowns.add(() => this.detachScrimStages?.());
    return detach;
  }
  getScrimState() {
    return { mode: this.scrim.scrimMode, enabled: this.scrim.scrimEnabled };
  }
  setSnapPoints(points, allowed) {
    if (this.destroyed) return;
    this.animation.cancel();
    this.newCycle();
    this.snapPointsRaw = points;
    auditVhUsage(points);
    this.auditDuplicateSnapIds(points);
    this.snaps.setRaw(points);
    if (allowed) {
      this.snaps.setAllowedIds(allowed);
    } else {
      const present = this.snaps.getResolvedSnaps().map((s) => s.id);
      const kept = this.snaps.getAllowedIds().filter((id) => present.includes(id));
      this.snaps.setAllowedIds(kept.length ? kept : present);
    }
    this.scrollCache.clear();
    this.scrim.invalidateOpacityCache();
    const current = this.snaps.findById(this.activeId);
    if (current) {
      this.applySize(current.size);
    } else {
      const fallback = this.snaps.getResolvedSnaps().find((s) => this.snaps.getAllowedIds().includes(s.id)) ?? this.snaps.getResolvedSnaps()[0];
      if (fallback) {
        this.activeId = fallback.id;
        this.applySize(fallback.size);
      }
    }
    this.updateAriaSlider();
  }
  recompute() {
    if (this.destroyed) return;
    this.maxHeight.resolveCap();
    this.snaps.recompute();
    this.maxHeight.clampTo();
    this.scrim.invalidateOpacityCache();
    if (this.isDraggingAny()) return;
    this.healActiveSnap();
  }
  healActiveSnap() {
    const current = this.snaps.findById(this.activeId);
    if (!current) return;
    this.size = current.size;
    this.applySize(this.size);
    this.updateAriaSlider();
    if (this.size > 0 && !this.lifecycle.isInstalled && !this.opening && !this.animation.isAnimating) {
      this.emitOpenSequence(this.activeId);
    }
  }
  destroy() {
    this.destroyed = true;
    this.opening = false;
    this.currentAbort.abort();
    this.currentViewTransition?.skipTransition?.();
    this.currentViewTransition = null;
    this.bus.clear();
    this.animation.cancel();
    this.gesture?.forceClearDragState();
    this.contentGesture?.forceClearDragState();
    this.setRestClosed(false);
    this.teardowns.drain();
    this.scrim.destroy();
    this.animation.destroy();
    this.lifecycle.destroy();
    if (this.backdrop) {
      this.backdrop.style.opacity = "";
      this.backdrop.style.pointerEvents = "";
    }
    for (const host of [this.anchorHost, this.scrimParent, this.rootEl]) {
      if (!host) continue;
      host.style.removeProperty("--bs-size");
      host.style.removeProperty("--bs-progress");
    }
    if (this.screenComponent) {
      this.screenComponent.style.opacity = "";
      this.screenComponent.style.display = "";
    }
    this.sizeWriteSentinel.invalidate();
    this.progressWriteSentinel.invalidate();
  }
  emit(event, payload) {
    this.bus.emit(event, payload);
  }
  newCycle() {
    this.allowOvershoot = false;
    this.opening = false;
    this.currentAbort.abort();
    this.currentAbort = new AbortController();
    return this.currentAbort.signal;
  }
  emitBeforeSnap(target, previousId) {
    return emitCancelable(
      (payload) => this.emit("before-snap", payload),
      { id: target.id, size: target.size, previousId },
      "before-snap"
    );
  }
  emitBeforeClose(reason) {
    return emitCancelable(
      (payload) => this.emit("before-close", payload),
      { reason },
      "before-close"
    );
  }
  applyAutoAriaLabelledBy() {
    if (typeof document === "undefined") return;
    if (!this.lifecycle.focusTrapEnabled) return;
    if (this.element.getAttribute("aria-labelledby")) return;
    const scope = this.handle ?? this.element;
    const titled = scope.querySelector("[data-bs-title]") ?? scope.querySelector("h1,h2,h3,h4,h5,h6");
    if (!titled) return;
    if (!titled.id) {
      titled.id = nextInstanceId("bs-title");
    }
    this.element.setAttribute("aria-labelledby", titled.id);
  }
  recomputeSnaps() {
    this.maxHeight.resolveCap();
    this.snaps.setRaw(this.snapPointsRaw);
    this.maxHeight.clampTo();
    this.scrim.invalidateOpacityCache();
  }
  auditDuplicateSnapIds(points) {
    const seen = /* @__PURE__ */ new Set();
    for (const p of points) {
      if (seen.has(p.id)) {
        devWarn(
          `[BottomSheet] duplicate snap id "${p.id}" \u2014 only the first occurrence is reachable.`
        );
      }
      seen.add(p.id);
    }
  }
  getAllowedRange() {
    return this.snaps.getAllowedRange();
  }
  allowedIdsBySize() {
    return this.snaps.getAllowedIds().slice().sort(
      (a, b) => (this.snaps.findById(a)?.size ?? 0) - (this.snaps.findById(b)?.size ?? 0)
    );
  }
  updateAriaSlider() {
    this.aria.setValue(this.allowedIdsBySize(), this.activeId);
  }
  registerInStack() {
    this.teardowns.add(sheetStack.push({
      id: this.id,
      setZIndex: (z) => {
        this.stackZ = z;
        this.element.style.zIndex = String(z);
        if (this.backdrop) this.backdrop.style.zIndex = String(z - 1);
        for (const anchor of this.anchors) anchor.syncZ(z + 1);
      },
      setIsTop: (isTop) => {
        this.isTopSheet = isTop;
      },
      isOpen: () => this.size > 0 || this.opening,
      setDepth: (depth) => this.applyStackDepth(depth)
    }));
  }
  applyStackDepth(depth) {
    if (!this.stackEffectEnabled) return;
    this.element.setAttribute("data-stack-depth", String(depth));
    if (!this.stackEffectPrimed) {
      this.stackEffectPrimed = true;
      const isVertical = this.mode === "bottom" || this.mode === "top";
      this.element.style.transformOrigin = isVertical ? "50% 100%" : "0% 50%";
      this.element.style.transition = "scale 320ms cubic-bezier(0.29, 1.04, 0.84, 0.99)";
    }
    const scale = Math.max(1 - depth * 0.04, 0.86);
    this.element.style.scale = scale === 1 ? "" : String(scale);
  }
  buildGestureDeps(surface, gestureOptions) {
    return {
      handle: surface,
      element: this.element,
      mode: this.mode,
      gestureOptions,
      getRoot: () => this.rootEl,
      getDragContext: () => {
        const buf = this.dragContextBuf;
        const r = this.getAllowedRange();
        buf.size = this.size;
        buf.maxAxisSize = this.snaps.getMaxAxisSize();
        buf.range.min = r.min;
        buf.range.max = r.max;
        buf.rubberBandEnabled = this.rubberBandEnabled;
        return buf;
      },
      getDisableDrag: () => this.disableDragFlag,
      cancelAnimation: () => this.animation.cancel(),
      applySize: (size) => this.applySize(size),
      animateTo: (size, velocity) => this.animation.animateTo(size, velocity),
      settleAfterDrag: (delta, velocity, kind) => this.settleAfterDrag(delta, velocity, kind),
      emit: (event, payload) => this.emit(event, payload),
      listenerCount: (event) => this.bus.listenerCount(event)
    };
  }
  isContentDragAllowed() {
    if (this.disableDragFlag) return false;
    const point = this.snapPointsRaw.find((p) => p.id === this.activeId);
    return point?.dragFromContent ?? this.dragFromContentDefault;
  }
  decideContentDrag(surface, e, delta, crossDelta) {
    if (this.destroyed) return false;
    if (e.pointerType === "mouse") return false;
    if (this.gesture?.isDragging) return false;
    if (!this.isContentDragAllowed()) return false;
    if (!isDragAllowedFrom(e.target, "sheet")) return false;
    const decision = decideContentGesture({
      delta,
      crossDelta,
      sharesScrollAxis: this.mode === "bottom" || this.mode === "top",
      scrollTop: surface.scrollTop,
      atMaxSnap: this.size >= this.getAllowedRange().max - 0.5
    });
    if (decision === "pending") return null;
    return decision === "drag";
  }
  attachDragSurface(surface, kind) {
    if (this.destroyed || kind !== "content") return;
    if (this.contentGesture) return;
    const controller = new GestureController(
      this.buildGestureDeps(surface, {
        manageTouchAction: false,
        deferStart: (e, delta, crossDelta) => this.decideContentDrag(surface, e, delta, crossDelta)
      })
    );
    this.contentGesture = controller;
    const detachGestures = controller.install();
    const detachGuard = installTouchScrollGuard(
      surface,
      () => controller.isDragging
    );
    return () => {
      detachGuard();
      detachGestures();
      if (this.contentGesture === controller) this.contentGesture = void 0;
    };
  }
  sheetDragSurface() {
    return this.dragFromMode === "handle" ? this.handle : this.element;
  }
  canStartSheetDrag(e) {
    if (this.contentGesture?.isDragging) return false;
    const target = e.target;
    const scoped = typeof target?.closest === "function";
    if (scoped && target.closest(NO_DRAG_SELECTOR)) return false;
    if (this.handle !== this.element && scoped && this.handle.contains(target)) {
      return true;
    }
    if (!isDragAllowedFrom(e.target, this.dragFromMode)) return false;
    if (this.dragFromMode === "handle") return true;
    if (this.scrollContainer && scoped && this.scrollContainer.contains(target) && !target.closest(DRAG_ZONE_SELECTOR)) {
      return false;
    }
    return true;
  }
  mountSheetGesture() {
    const surface = this.sheetDragSurface();
    const controller = new GestureController(
      this.buildGestureDeps(surface, {
        shouldStart: (e) => this.canStartSheetDrag(e),
        manageTouchAction: this.dragFromMode === "handle"
      })
    );
    this.gesture = controller;
    const detachGestures = controller.install();
    const detachGuard = this.dragFromMode === "handle" ? null : installTouchScrollGuard(surface, () => controller.isDragging);
    this.detachSheetGesture = () => {
      detachGuard?.();
      detachGestures();
    };
  }
  attach() {
    this.mountSheetGesture();
    this.teardowns.add(() => {
      this.detachSheetGesture?.();
      this.detachSheetGesture = null;
    });
    try {
      this.attachFeatures();
    } catch (err) {
      this.teardowns.drain();
      try {
        this.scrim.destroy();
      } catch (destroyErr) {
        queueMicrotask(() => {
          throw destroyErr;
        });
      }
      try {
        this.animation.destroy();
      } catch (destroyErr) {
        queueMicrotask(() => {
          throw destroyErr;
        });
      }
      try {
        this.lifecycle.destroy();
      } catch (destroyErr) {
        queueMicrotask(() => {
          throw destroyErr;
        });
      }
      this.destroyed = true;
      throw err;
    }
  }
  attachFeatures() {
    this.runFeatureStage("attach");
    if (typeof window !== "undefined") {
      this.teardowns.add(installResizeObserver({
        element: this.element,
        getMode: () => this.mode,
        isDestroyed: () => this.destroyed,
        isDragging: () => this.isDraggingAny(),
        resolveActiveSnap: () => this.snaps.findById(this.activeId),
        getMaxAxisSize: () => this.snaps.getMaxAxisSize(),
        getSize: () => this.size,
        setMaxAxisSize: (size) => {
          this.snaps.setMaxAxisSize(size);
        },
        setSize: (size) => {
          this.size = size;
        },
        recomputeSnaps: () => this.recomputeSnaps(),
        applySize: (size) => this.applySize(size),
        cancelInFlight: () => {
          this.animation.cancel();
        },
        newCycle: () => {
          this.newCycle();
        },
        isAnimating: () => this.animation.isAnimating,
        resyncAfterCancel: () => this.resyncAfterResize()
      }));
      if (this.lifecycle.closeOnEscape) {
        const onKey = (e) => {
          if (this.destroyed || e.defaultPrevented) return;
          if (!this.canDismiss()) return;
          if (e.key === "Escape" && this.isTopSheet && this.size > 0) {
            void this.close("escape");
          }
        };
        document.addEventListener("keydown", onKey);
        this.teardowns.add(
          () => document.removeEventListener("keydown", onKey)
        );
      }
    }
    this.mountSliderKeyboard();
    this.scrim.attach();
  }
  mountSliderKeyboard() {
    const detach = installSliderKeyboard({
      handle: this.handle,
      mode: this.mode,
      isDestroyed: () => this.destroyed,
      getAllowedIds: () => this.allowedIdsBySize(),
      getActiveId: () => this.activeId,
      snapTo: (id) => {
        void this.snapTo(id);
      }
    });
    this.detachSliderKeyboard = detach;
    this.teardowns.add(() => {
      this.detachSliderKeyboard?.();
      this.detachSliderKeyboard = null;
    });
  }
  settleAfterDrag(delta, velocity, kind = "touch") {
    const signal = this.newCycle();
    const target = this.snaps.findDragSettleTarget({
      delta,
      velocity,
      pointerKind: kind,
      size: this.size,
      activeId: this.activeId,
      flickVelocity: this.flickVelocity,
      dragThreshold: this.dragThreshold
    });
    if (!target) {
      this.clearWillChangeIfIdle();
      return;
    }
    const previousId = this.activeId;
    if (target.id === previousId && target.size === this.size) {
      this.clearWillChangeIfIdle();
      return;
    }
    if (this.emitBeforeSnap(target, previousId)) {
      const restore2 = this.snaps.findById(previousId);
      if (restore2) {
        void this.animation.animateTo(restore2.size, 0);
      }
      return;
    }
    const previousSize = this.size;
    const previousSnapSize = this.snaps.findById(previousId)?.size;
    this.scrollCache.cache(previousId, previousSize, target.size);
    this.activeId = target.id;
    if (previousSnapSize === 0 && target.size > 0) {
      this.opening = true;
      this.promotedForOpen = true;
      sheetStack.promote(this.id);
    }
    const settleCap = this.snaps.getMaxAxisSize();
    const settleSize = settleCap > 0 ? Math.min(target.size, settleCap) : target.size;
    this.allowOvershoot = true;
    void this.animation.animateTo(settleSize, velocity).then(() => {
      if (signal.aborted) return;
      this.allowOvershoot = false;
      this.opening = false;
      this.completeSnap(
        target.id,
        target.size,
        previousSize,
        previousSnapSize === 0,
        true
      );
    });
  }
  isDraggingAny() {
    return (this.gesture?.isDragging ?? false) || (this.contentGesture?.isDragging ?? false);
  }
  clearWillChangeIfIdle() {
    if (this.animation.isAnimating || this.isDraggingAny()) return;
    this.element.style.willChange = "";
  }
  haptic() {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(HAPTIC_DURATION_MS);
      } catch {
      }
    }
  }
  applySize(size, skipTransform = false) {
    const cap = this.snaps.getMaxAxisSize();
    const clamped = cap > 0 && size > cap && !this.isDraggingAny() && !this.allowOvershoot ? cap : size;
    this.size = clamped;
    if (clamped > 0) this.setRestClosed(false);
    const offset = cap - clamped;
    const style = this.element.style;
    if (!skipTransform) style.transform = this.transformTemplate(offset);
    if (this.sizeWriteSentinel.shouldWrite(clamped, SIZE_WRITE_EPSILON)) {
      style.setProperty("--bs-size", `${clamped}px`);
      if (this.scrimParent) {
        this.scrimParent.style.setProperty("--bs-size", `${clamped}px`);
      }
      if (this.anchorHost && this.anchorHost !== this.scrimParent) {
        this.anchorHost.style.setProperty("--bs-size", `${clamped}px`);
      }
      if (this.rootEl && this.rootEl !== this.scrimParent && this.rootEl !== this.anchorHost) {
        this.rootEl.style.setProperty("--bs-size", `${clamped}px`);
      }
    }
    const progress = this.computeProgress(clamped);
    const progressChanged = this.progressWriteSentinel.shouldWrite(
      progress,
      OPACITY_WRITE_EPSILON
    );
    if (progressChanged) {
      style.setProperty("--bs-progress", String(progress));
      if (this.anchorHost) {
        this.anchorHost.style.setProperty("--bs-progress", String(progress));
      }
      if (this.rootEl && this.rootEl !== this.anchorHost) {
        this.rootEl.style.setProperty("--bs-progress", String(progress));
      }
    }
    this.scrim.applyOpacity(progress, progressChanged);
    if (progressChanged && this.bus.listenerCount("progress") > 0) {
      this.progressPayload.value = progress;
      this.progressPayload.size = clamped;
      this.emit("progress", this.progressPayload);
    }
  }
  computeProgress(size) {
    const { min, max } = this.getAllowedRange();
    const reachableMax = Math.min(max, this.snaps.getMaxAxisSize());
    if (reachableMax <= min) return 0;
    return Math.min(Math.max((size - min) / (reachableMax - min), 0), 1);
  }
  handleOpen() {
    if (this.promotedForOpen) this.promotedForOpen = false;
    else sheetStack.promote(this.id);
    try {
      this.lifecycle.install();
    } catch (err) {
      if (!this.destroyed) this.newCycle();
      this.handleClose();
      this.applySize(0);
      this.activeId = this.snapPointsRaw.find((p) => p.id === "closed")?.id ?? this.activeId;
      this.size = 0;
      queueMicrotask(() => {
        throw err;
      });
    }
  }
  resyncAfterResize() {
    if (this.destroyed) return;
    const target = this.snaps.findById(this.activeId);
    if (!target) return;
    this.updateAriaSlider();
    this.emit("snap", {
      id: target.id,
      size: this.size,
      progress: this.computeProgress(this.size)
    });
    if (target.size > 0 && !this.lifecycle.isInstalled) {
      this.emitOpenSequence(target.id);
    } else if (target.size === 0 && this.lifecycle.isInstalled) {
      this.emitCloseSequence();
    }
  }
  handleClose() {
    this.opening = false;
    this.promotedForOpen = false;
    this.lifecycle.release();
    sheetStack.update();
  }
};

// src/core/features/history-coordinator.ts
var entries = [];
var subscribers = /* @__PURE__ */ new Set();
var suppress = 0;
var internalDepth = 0;
var pendingRebrands = [];
var listenerInstalled = false;
var patchInstalled = false;
var origPushState = null;
var origReplaceState = null;
var patchedPushState = null;
var patchedReplaceState = null;
var hasWindow = () => typeof window !== "undefined";
var hasHistory = () => typeof history !== "undefined";
var brandMarker = (surface) => ({
  ...surface.markerState(),
  __bs: true
});
var runInternal = (fn) => {
  internalDepth += 1;
  try {
    fn();
  } finally {
    internalDepth -= 1;
  }
};
var notifyRouteChange = () => {
  const snapshot = Array.from(subscribers);
  for (const fn of snapshot) fn();
};
var ensureListener = () => {
  if (listenerInstalled || !hasWindow()) return;
  window.addEventListener("popstate", onPopState);
  listenerInstalled = true;
};
var maybeTeardownListener = () => {
  if (!listenerInstalled) return;
  if (entries.length > 0 || subscribers.size > 0 || suppress > 0) return;
  if (hasWindow()) window.removeEventListener("popstate", onPopState);
  listenerInstalled = false;
};
var installPatch = () => {
  if (patchInstalled || !hasHistory()) return;
  origPushState = history.pushState;
  origReplaceState = history.replaceState;
  patchedPushState = function(...args) {
    origPushState.apply(this, args);
    if (internalDepth === 0) notifyRouteChange();
  };
  patchedReplaceState = function(...args) {
    origReplaceState.apply(this, args);
    if (internalDepth === 0) notifyRouteChange();
  };
  history.pushState = patchedPushState;
  history.replaceState = patchedReplaceState;
  patchInstalled = true;
};
var removePatch = () => {
  if (!patchInstalled) return;
  if (history.pushState === patchedPushState && origPushState) {
    history.pushState = origPushState;
  }
  if (history.replaceState === patchedReplaceState && origReplaceState) {
    history.replaceState = origReplaceState;
  }
  origPushState = null;
  origReplaceState = null;
  patchedPushState = null;
  patchedReplaceState = null;
  patchInstalled = false;
};
function onPopState() {
  if (suppress > 0) {
    suppress -= 1;
    const rebrand = pendingRebrands.shift();
    if (rebrand) rebrand();
    maybeTeardownListener();
    return;
  }
  if (entries.length === 0) {
    notifyRouteChange();
    maybeTeardownListener();
    return;
  }
  let target = null;
  let targetIdx = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry.surface.isOpen()) continue;
    if (!target) {
      target = entry;
      targetIdx = i;
    }
    if (entry.surface.isTop()) {
      target = entry;
      targetIdx = i;
      break;
    }
  }
  if (!target) {
    const removed = entries.pop();
    if (removed) removed.live = false;
    maybeTeardownListener();
    return;
  }
  target.live = false;
  entries.splice(targetIdx, 1);
  const settled = target;
  void Promise.resolve(settled.surface.close()).then(() => {
    if (settled.surface.isOpen()) restore(settled);
  });
  maybeTeardownListener();
}
function restore(entry) {
  if (!hasWindow() || !hasHistory()) return;
  entry.live = true;
  runInternal(() => {
    try {
      history.pushState(brandMarker(entry.surface), "", entry.surface.url);
    } catch {
      entry.live = false;
    }
  });
  if (entry.live) {
    entries.push(entry);
    ensureListener();
  }
}
function pushBackMarker(surface) {
  const entry = { surface, priorUrl: void 0, live: false };
  if (!hasWindow() || !hasHistory()) {
    return entry;
  }
  entry.priorUrl = surface.url !== void 0 ? location.href : void 0;
  runInternal(() => {
    try {
      history.pushState(brandMarker(surface), "", surface.url);
      entry.live = true;
    } catch {
      entry.live = false;
    }
  });
  if (entry.live) {
    entries.push(entry);
    ensureListener();
  }
  return entry;
}
function popBackMarker(handle) {
  if (!hasWindow() || !hasHistory()) return;
  const entry = handle;
  const idx = entries.indexOf(entry);
  if (idx === -1 || !entry.live) return;
  const last = entries.length - 1;
  entry.live = false;
  entries.splice(idx, 1);
  let rebrand = null;
  if (idx !== last) {
    const rebrandSurface = entries[entries.length - 1].surface;
    const rebrandUrl = entry.priorUrl;
    rebrand = () => {
      runInternal(() => {
        history.replaceState(
          brandMarker(rebrandSurface),
          "",
          rebrandUrl !== void 0 ? rebrandUrl : location.href
        );
      });
    };
  }
  pendingRebrands.push(rebrand);
  suppress += 1;
  runInternal(() => {
    try {
      history.back();
    } catch {
      suppress = Math.max(0, suppress - 1);
      pendingRebrands.pop();
    }
  });
  maybeTeardownListener();
}
function subscribeRouteChange(fn) {
  if (!hasWindow() || !hasHistory()) return () => {
  };
  subscribers.add(fn);
  if (subscribers.size === 1) installPatch();
  ensureListener();
  return () => {
    if (!subscribers.has(fn)) return;
    subscribers.delete(fn);
    if (subscribers.size === 0) removePatch();
    maybeTeardownListener();
  };
}

// src/core/features/route.ts
function installRoute(deps) {
  if (typeof window === "undefined") {
    return () => {
    };
  }
  if (!deps.routedTo && !deps.closeOnBack) {
    return () => {
    };
  }
  let handle = null;
  const onOpen = () => {
    if (handle) return;
    handle = pushBackMarker({
      isOpen: () => !deps.isDestroyed() && deps.getSize() > 0,
      isTop: deps.isTopSheet,
      close: deps.close,
      markerState: () => deps.routedTo !== void 0 ? { __bsRouted: deps.sheetId } : { __bsSheet: deps.sheetId },
      url: deps.routedTo
    });
  };
  const onClose = () => {
    if (!handle) return;
    popBackMarker(handle);
    handle = null;
  };
  const unsubscribeOpen = deps.on("open", onOpen);
  const unsubscribeClose = deps.on("close", onClose);
  if (deps.getSize() > 0) onOpen();
  return () => {
    unsubscribeOpen();
    unsubscribeClose();
    if (handle) {
      popBackMarker(handle);
      handle = null;
    }
  };
}
function installRouteChange(deps) {
  return subscribeRouteChange(() => {
    if (deps.isDestroyed() || deps.getSize() <= 0) return;
    void deps.close();
  });
}

// src/core/features/persist.ts
function installPersist(engine, key) {
  const unsubscribe = engine.on("snap", ({ id }) => {
    if (typeof window === "undefined") return;
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(key, id);
    } catch {
    }
  });
  return unsubscribe;
}

// src/core/features/auto-collapse.ts
function installAutoCollapse(deps) {
  const { ms } = deps;
  if (ms === void 0 || ms <= 0) {
    return () => {
    };
  }
  let timer = null;
  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const fire = () => {
    if (deps.isDestroyed()) return;
    if (deps.isDragging()) return;
    const active = deps.resolveSnap(deps.getActiveId());
    if (!active || active.size === 0) return;
    let target = null;
    for (const id of deps.getAllowedIds()) {
      const snap = deps.resolveSnap(id);
      if (!snap || snap.size <= 0) continue;
      if (!target || snap.size < target.size) target = snap;
    }
    if (!target) return;
    if (target.id === active.id || target.size >= active.size) return;
    deps.snapTo(target.id);
  };
  const reset = () => {
    clearTimer();
    if (deps.isDestroyed()) return;
    timer = setTimeout(() => {
      timer = null;
      fire();
    }, ms);
  };
  const unsubscribe = deps.on("snap", () => reset());
  if ((deps.resolveSnap(deps.getActiveId())?.size ?? 0) > 0) reset();
  return () => {
    clearTimer();
    unsubscribe();
  };
}

// src/core/features/content-drag.ts
function installContentDrag(deps) {
  const detach = deps.attachDragSurface(deps.container, "content");
  return () => detach?.();
}

// src/core/features/visual-viewport.ts
var SAFETY_PAD = 8;
function installVisualViewport(deps) {
  if (typeof window === "undefined" || !window.visualViewport) {
    return () => {
    };
  }
  const vv = window.visualViewport;
  let rafId = null;
  const onResize = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (deps.isDestroyed()) return;
      deps.recomputeSnaps();
      const isVertical = deps.isVerticalAxis();
      const visible = isVertical ? vv.height : vv.width;
      const windowSize = isVertical ? window.innerHeight : window.innerWidth;
      const clamp = Math.max(0, Math.min(windowSize, visible) - SAFETY_PAD);
      if (clamp < deps.getMaxAxisSize()) {
        deps.setMaxAxisSize(clamp);
      }
      const wasAnimating = deps.isAnimating?.() ?? false;
      deps.cancelInFlight();
      deps.newCycle();
      const max = deps.getMaxAxisSize();
      deps.setSize(Math.min(deps.getSize(), max));
      const current = deps.resolveActiveSnap();
      if (current && !deps.isDragging()) {
        deps.applySize(Math.min(current.size, max));
        if (wasAnimating) deps.resyncAfterCancel?.();
      } else {
        deps.applySize(deps.getSize());
      }
    });
  };
  vv.addEventListener("resize", onResize);
  return () => {
    vv.removeEventListener("resize", onResize);
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}

// src/core/features/engine-features.ts
function routeFeature() {
  return {
    name: "route",
    install: (ctx) => {
      const teardowns = new TeardownStack();
      if (ctx.options.closeOnRouteChange) {
        teardowns.add(
          installRouteChange({
            isDestroyed: ctx.isDestroyed,
            getSize: ctx.getSize,
            close: () => ctx.close()
          })
        );
      }
      teardowns.add(
        installRoute({
          routedTo: ctx.options.routedTo,
          closeOnBack: ctx.options.closeOnBack,
          isTopSheet: ctx.isTopSheet,
          getSize: ctx.getSize,
          isDestroyed: ctx.isDestroyed,
          close: () => ctx.close("back"),
          on: ctx.on,
          sheetId: ctx.sheetId
        })
      );
      return () => teardowns.drain();
    }
  };
}
function persistFeature() {
  return {
    name: "persist",
    install: (ctx) => {
      const key = ctx.options.persistKey;
      if (!key) return;
      return installPersist({ on: ctx.on }, key);
    }
  };
}
function autoCollapseFeature() {
  return {
    name: "auto-collapse",
    install: (ctx) => installAutoCollapse({
      ms: ctx.options.autoCollapseAfter,
      isDestroyed: ctx.isDestroyed,
      isDragging: ctx.isDragging,
      getAllowedIds: ctx.getAllowedIds,
      getActiveId: ctx.getActiveId,
      resolveSnap: ctx.resolveSnap,
      snapTo: ctx.snapTo,
      on: ctx.on
    })
  };
}
function contentSwipeFeature() {
  return {
    name: "content-swipe",
    stage: "attach",
    install: (ctx) => {
      if (!ctx.scrollContainer) return;
      return installContentDrag({
        container: ctx.scrollContainer,
        attachDragSurface: ctx.attachDragSurface
      });
    }
  };
}
function visualViewportFeature() {
  return {
    name: "visual-viewport",
    install: (ctx) => {
      if (typeof window === "undefined") return;
      return installVisualViewport({
        element: ctx.element,
        isVerticalAxis: ctx.isVerticalAxis,
        isDestroyed: ctx.isDestroyed,
        isDragging: ctx.isDragging,
        recomputeSnaps: ctx.recomputeSnaps,
        resolveActiveSnap: ctx.resolveActiveSnap,
        getMaxAxisSize: ctx.getMaxAxisSize,
        getSize: ctx.getSize,
        setMaxAxisSize: ctx.setMaxAxisSize,
        setSize: ctx.setSize,
        applySize: ctx.applySize,
        cancelInFlight: ctx.cancelInFlight,
        newCycle: ctx.newCycle,
        isAnimating: ctx.isAnimating,
        resyncAfterCancel: ctx.resyncAfterResize
      });
    }
  };
}

// src/core/features/content-fit.ts
var INSET_VAR = "--bs-content-inset";
var SIZE_VAR = "--bs-size";
var CAP_VAR = "--bs-max-size";
var LIFT_VAR = "--bs-footer-lift-max";
var FIT_ATTR = "data-bs-fit-content";
function contentFitFeature() {
  return {
    name: "content-fit",
    install: (ctx) => {
      const scroller = ctx.scrollContainer;
      if (!ctx.options.fitContentToSnap || !scroller || typeof window === "undefined") {
        return;
      }
      const sheet = ctx.element;
      let inset = 0;
      let unpaddedMax = -1;
      let top = 0;
      const put = (name, px) => sheet.style.setProperty(name, `${px}px`);
      const hiddenAt = (size) => sheet.dataset.mode === "bottom" ? Math.max(0, ctx.getMaxAxisSize() - size) : 0;
      const follow = (size) => {
        if (unpaddedMax < 0) {
          unpaddedMax = scroller.scrollHeight - scroller.clientHeight - inset;
          top = scroller.scrollTop;
        }
        const limit = Math.max(0, unpaddedMax + hiddenAt(size));
        if (top > limit) {
          if (scroller.scrollTop > limit) scroller.scrollTop = limit;
          top = limit;
        }
      };
      const settle = () => {
        if (ctx.isDestroyed()) return;
        const size = ctx.getSize();
        unpaddedMax = -1;
        follow(size);
        inset = hiddenAt(size);
        put(LIFT_VAR, scroller.offsetHeight);
        put(INSET_VAR, inset);
        put(SIZE_VAR, size);
        put(CAP_VAR, ctx.getMaxAxisSize());
        unpaddedMax = -1;
      };
      const moving = () => ctx.isAnimating() || ctx.isDragging();
      const whenIdle = () => {
        if (!moving()) settle();
      };
      sheet.setAttribute(FIT_ATTR, "");
      settle();
      const offProgress = ctx.on(
        "progress",
        (p) => moving() ? follow(p.size) : settle()
      );
      const offSnap = ctx.on("snap", settle);
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(whenIdle);
      observer?.observe(document.documentElement);
      window.addEventListener("orientationchange", whenIdle);
      return () => {
        offProgress();
        offSnap();
        observer?.disconnect();
        window.removeEventListener("orientationchange", whenIdle);
        sheet.removeAttribute(FIT_ATTR);
        for (const name of [INSET_VAR, CAP_VAR, LIFT_VAR]) {
          sheet.style.removeProperty(name);
        }
      };
    }
  };
}

// src/core/default-features.ts
function defaultEngineFeatures() {
  return [
    contentSwipeFeature(),
    visualViewportFeature(),
    persistFeature(),
    autoCollapseFeature(),
    routeFeature(),
    contentFitFeature()
  ];
}

// src/core/BottomSheetEngine.ts
var BottomSheetEngine = class extends BottomSheetCore {
  constructor(opts) {
    super({
      ...opts,
      features: [...defaultEngineFeatures(), ...opts.features ?? []]
    });
  }
};

// src/core/lifecycle/sheet-manager.ts
var createSheetManager = (initial = {}) => {
  const registry = /* @__PURE__ */ new Map();
  for (const [key, config] of Object.entries(initial)) {
    registry.set(key, { ...config, key });
  }
  return {
    register(key, config) {
      registry.set(key, { ...config, key });
    },
    unregister(key) {
      registry.delete(key);
    },
    resolve(key) {
      return registry.get(key) ?? null;
    },
    keys() {
      return Array.from(registry.keys());
    },
    transition(prev, next) {
      if (prev) registry.get(prev)?.onClose?.(prev);
      if (next) registry.get(next)?.onOpen?.(next);
    }
  };
};

export { BottomSheetCore, BottomSheetEngine, SCRIM_PRESETS, applyOverlayPosition, autoCollapseFeature, contentSwipeFeature, createSheetManager, defaultEngineFeatures, installFocusTrap, installGestures, lockBodyScroll, persistFeature, resolveSheetAnchoredStyle, resolveSnap, resolveSnapList, routeFeature, runAnchorTransition, sheetStack, visualViewportFeature };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map