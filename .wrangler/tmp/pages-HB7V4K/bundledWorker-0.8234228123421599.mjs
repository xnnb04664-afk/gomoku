var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
if (!("__unenv__" in performance)) {
  const proto = Performance.prototype;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key !== "constructor" && !(key in performance)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc) {
        Object.defineProperty(performance, key, desc);
      }
    }
  }
}
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert: assert2,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// C:/Users/ZhuanZ1/AppData/Roaming/npm/node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// _worker.js
var worker_default = {
  async fetch(request, env2) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    const json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
    }), "json");
    function generateSecureHex(len = 24) {
      const bytes = new Uint8Array(len);
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    __name(generateSecureHex, "generateSecureHex");
    async function hashWithSalt(text, salt) {
      const enc = new TextEncoder();
      const combined = enc.encode(`${text}__GOMOKU_PEPPER_2026__${salt}`);
      const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
      return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    __name(hashWithSalt, "hashWithSalt");
    function sanitizeText(str, maxLen = 12) {
      if (!str || typeof str !== "string") return "";
      return str.trim().replace(/[<>'"`&]/g, "").slice(0, maxLen);
    }
    __name(sanitizeText, "sanitizeText");
    const RANDOM_AVATARS = ["\u{1F431}", "\u{1F436}", "\u{1F43C}", "\u{1F981}", "\u{1F98A}", "\u{1F42F}", "\u{1F430}", "\u{1F438}", "\u{1F984}", "\u{1F338}", "\u{1F466}", "\u{1F467}", "\u{1F9D9}\u200D\u2642\uFE0F", "\u{1F977}", "\u2728", "\u{1F43E}", "\u{1F43B}", "\u{1F428}", "\u{1F916}", "\u{1F451}"];
    const NAME_PREFIXES = ["\u900D\u9065", "\u7075\u52A8", "\u75BE\u98CE", "\u661F\u6708", "\u9752\u4E91", "\u7AF9\u6797", "\u50B2\u96EA", "\u542C\u96E8", "\u843D\u6A31", "\u5E7B\u5F71", "\u5929\u5143", "\u7834\u6653", "\u60A0\u7136", "\u6625\u98CE", "\u5F08\u5FC3", "\u65E0\u75D5"];
    const NAME_SUFFIXES = ["\u68CB\u4ED9", "\u5F08\u5BA2", "\u5C11\u4FA0", "\u795E\u7B97", "\u9690\u58EB", "\u5148\u950B", "\u68CB\u5723", "\u5947\u624D", "\u840C\u5BA2", "\u68CB\u738B", "\u884C\u8005", "\u5251\u5BA2"];
    function generateRandomNickname() {
      const pre = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
      const suf = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
      const num = Math.floor(10 + Math.random() * 90);
      return pre + suf + "_" + num;
    }
    __name(generateRandomNickname, "generateRandomNickname");
    function generateRandomAvatar() {
      return RANDOM_AVATARS[Math.floor(Math.random() * RANDOM_AVATARS.length)];
    }
    __name(generateRandomAvatar, "generateRandomAvatar");
    function sanitizeAvatar(avatar) {
      if (!avatar || typeof avatar !== "string") return "\u{1F466}";
      if (avatar.length <= 4) return avatar;
      const regex = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
      if (!regex.test(avatar)) return "\u{1F466}";
      if (avatar.length > 14e3) return "\u{1F466}";
      return avatar;
    }
    __name(sanitizeAvatar, "sanitizeAvatar");
    if (env2.DB) {
      try {
        await env2.DB.prepare(`
          CREATE TABLE IF NOT EXISTS users (
            uid TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            password_hash TEXT,
            salt TEXT,
            security_q TEXT,
            security_a_hash TEXT,
            security_salt TEXT,
            failed_reset_count INTEGER DEFAULT 0,
            reset_locked_until INTEGER DEFAULT 0,
            token TEXT,
            token_expires_at INTEGER DEFAULT 0,
            failed_login_count INTEGER DEFAULT 0,
            locked_until INTEGER DEFAULT 0,
            nickname TEXT,
            avatar TEXT DEFAULT '\u{1F466}',
            score INTEGER DEFAULT 1000,
            wins INTEGER DEFAULT 0,
            total_games INTEGER DEFAULT 0,
            last_game_at INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `).run();
        const cols = [
          "password_hash TEXT",
          "salt TEXT",
          "token TEXT",
          "token_expires_at INTEGER DEFAULT 0",
          "failed_login_count INTEGER DEFAULT 0",
          "locked_until INTEGER DEFAULT 0",
          "last_game_at INTEGER DEFAULT 0",
          "security_q TEXT",
          "security_a_hash TEXT",
          "security_salt TEXT",
          "failed_reset_count INTEGER DEFAULT 0",
          "reset_locked_until INTEGER DEFAULT 0"
        ];
        for (const col of cols) {
          try {
            await env2.DB.prepare(`ALTER TABLE users ADD COLUMN ${col}`).run();
          } catch (e) {
          }
        }
      } catch (e) {
        await env2.DB.prepare(`
          CREATE TABLE IF NOT EXISTS match_queue (
            uid TEXT PRIMARY KEY,
            nickname TEXT,
            avatar TEXT,
            score INTEGER DEFAULT 1000,
            status TEXT DEFAULT 'waiting',
            matched_with TEXT,
            matched_color TEXT,
            matched_nickname TEXT,
            matched_avatar TEXT,
            matched_score INTEGER,
            room_code TEXT,
            updated_at INTEGER
          )
        `).run();
        console.warn("DB check error:", e.message);
      }
    }
    if (url.pathname === "/") {
      return json({ status: "ok", game: "\u4E94\u5B50\u68CB\u5927\u5E08\u5B89\u5168\u67B6\u6784\u4E2D\u67A2 v4.0 (\u81EA\u52A8\u90E8\u7F72\u5C31\u7EEA)" });
    }
    if (url.pathname === "/api/auth/guest" && request.method === "POST") {
      if (!env2.DB) return json({ code: 1, msg: "\u6570\u636E\u5E93\u672A\u8FDE\u63A5" }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid, token } = body;
        const now = Date.now();
        const thirtyDays = 30 * 24 * 3600 * 1e3;
        if (uid && token) {
          const user = await env2.DB.prepare(
            "SELECT uid, username, nickname, avatar, score, wins, total_games, token, token_expires_at FROM users WHERE uid = ? AND token = ?"
          ).bind(String(uid), String(token)).first();
          if (user && (!user.token_expires_at || user.token_expires_at > now)) {
            return json({ code: 0, data: user });
          }
        }
        let newUid = String(Math.floor(1e5 + Math.random() * 9e5));
        for (let i = 0; i < 5; i++) {
          const check = await env2.DB.prepare("SELECT uid FROM users WHERE uid = ? OR username = ?").bind(newUid, newUid).first();
          if (!check) break;
          newUid = String(Math.floor(1e5 + Math.random() * 9e5));
        }
        const newToken = generateSecureHex(24);
        const expiresAt = now + thirtyDays;
        const defaultName = generateRandomNickname();
        const defaultAvatar = generateRandomAvatar();
        await env2.DB.prepare(`
          INSERT INTO users (uid, token, token_expires_at, nickname, avatar, score, wins, total_games)
          VALUES (?, ?, ?, ?, ?, 1000, 0, 0)
        `).bind(newUid, newToken, expiresAt, defaultName, defaultAvatar).run();
        return json({
          code: 0,
          data: {
            uid: newUid,
            username: null,
            nickname: defaultName,
            avatar: defaultAvatar,
            score: 1e3,
            wins: 0,
            total_games: 0,
            token: newToken
          }
        });
      } catch (err) {
        return json({ code: 1, msg: "\u6E38\u5BA2\u521B\u5EFA\u5F02\u5E38: " + err.message }, 500);
      }
    }
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      if (!env2.DB) return json({ code: 1, msg: "\u6570\u636E\u5E93\u672A\u8FDE\u63A5" }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { username, password, nickname, avatar, uid, token, securityQuestion, securityAnswer } = body;
        if (!username || typeof username !== "string" || !username.trim()) {
          return json({ code: 1, msg: "\u8BF7\u8F93\u5165\u6709\u6548\u7684\u8D26\u53F7\u540D\u79F0" });
        }
        if (username.trim().length > 32) {
          return json({ code: 1, msg: "\u8D26\u53F7\u540D\u79F0\u957F\u5EA6\u6700\u591A 32 \u4E2A\u5B57\u7B26" });
        }
        if (!password || typeof password !== "string" || password.length < 6 || password.length > 32) {
          return json({ code: 1, msg: "\u5BC6\u7801\u957F\u5EA6\u987B\u81F3\u5C11 6 \u4F4D\uFF08\u652F\u6301 6~32 \u4F4D\uFF09" });
        }
        const safeUsername = username.trim().replace(/[<>'"`]/g, "");
        const safeNick = sanitizeText(nickname, 12) || safeUsername;
        const safeAvatar = sanitizeAvatar(avatar);
        const exist = await env2.DB.prepare("SELECT uid FROM users WHERE username = ? OR uid = ?").bind(safeUsername, safeUsername).first();
        if (exist) {
          return json({ code: 1, msg: "\u8BE5\u8D26\u53F7\u540D\u79F0\u5DF2\u88AB\u6CE8\u518C\uFF0C\u8BF7\u6362\u4E00\u4E2A" });
        }
        const now = Date.now();
        const expiresAt = now + 30 * 24 * 3600 * 1e3;
        const salt = generateSecureHex(16);
        const passwordHash = await hashWithSalt(password, salt);
        const newToken = generateSecureHex(24);
        const safeQ = sanitizeText(securityQuestion, 60) || "\u4F60\u6700\u559C\u6B22\u7684\u4EBA\u662F\u8C01\uFF1F";
        const cleanAnswer = securityAnswer && typeof securityAnswer === "string" ? securityAnswer.trim().toLowerCase() : "";
        const secSalt = generateSecureHex(16);
        const secAnswerHash = cleanAnswer ? await hashWithSalt(cleanAnswer, secSalt) : null;
        if (uid && token) {
          const guest = await env2.DB.prepare("SELECT uid, username FROM users WHERE uid = ? AND token = ?").bind(String(uid), String(token)).first();
          if (guest && !guest.username) {
            await env2.DB.prepare(`
              UPDATE users
              SET username = ?, password_hash = ?, salt = ?, token = ?, token_expires_at = ?,
                  security_q = ?, security_a_hash = ?, security_salt = ?,
                  failed_login_count = 0, locked_until = 0, nickname = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP
              WHERE uid = ?
            `).bind(safeUsername, passwordHash, salt, newToken, expiresAt, safeQ, secAnswerHash, secSalt, safeNick, safeAvatar, uid).run();
            const updated = await env2.DB.prepare("SELECT uid, username, nickname, avatar, score, wins, total_games, token, security_q FROM users WHERE uid = ?").bind(uid).first();
            return json({ code: 0, msg: "\u8D26\u53F7\u7ED1\u5B9A\u5347\u7EA7\u6210\u529F\uFF01", data: updated });
          }
        }
        const newUid = String(Math.floor(1e5 + Math.random() * 9e5));
        await env2.DB.prepare(`
          INSERT INTO users (uid, username, password_hash, salt, token, token_expires_at, security_q, security_a_hash, security_salt, failed_login_count, locked_until, nickname, avatar, score, wins, total_games)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1000, 0, 0)
        `).bind(newUid, safeUsername, passwordHash, salt, newToken, expiresAt, safeQ, secAnswerHash, secSalt, safeNick, safeAvatar).run();
        const created = await env2.DB.prepare("SELECT uid, username, nickname, avatar, score, wins, total_games, token, security_q FROM users WHERE uid = ?").bind(newUid).first();
        return json({ code: 0, msg: "\u6CE8\u518C\u6210\u529F\u5E76\u5DF2\u81EA\u52A8\u767B\u5F55\uFF01", data: created });
      } catch (err) {
        return json({ code: 1, msg: "\u6CE8\u518C\u5F02\u5E38: " + err.message }, 500);
      }
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (!env2.DB) return json({ code: 1, msg: "\u6570\u636E\u5E93\u672A\u8FDE\u63A5" }, 500);
      try {
        const { username, password } = await request.json().catch(() => ({}));
        if (!username || !password) return json({ code: 1, msg: "\u8BF7\u8F93\u5165\u8D26\u53F7\u4E0E\u5BC6\u7801" });
        const now = Date.now();
        const user = await env2.DB.prepare("SELECT * FROM users WHERE (username = ? OR uid = ?)").bind(String(username).trim(), String(username).trim()).first();
        if (!user) {
          return json({ code: 1, msg: "\u8D26\u53F7\u6216\u5BC6\u7801\u4E0D\u6B63\u786E" });
        }
        if (user.locked_until && user.locked_until > now) {
          const remain = Math.ceil((user.locked_until - now) / 1e3);
          return json({ code: 429, msg: `\u5BC6\u7801\u8F93\u9519\u8FC7\u591A\uFF0C\u8D26\u53F7\u4FDD\u62A4\u6027\u9501\u5B9A\u4E2D\uFF01\u8BF7\u5728 ${remain} \u79D2\u540E\u518D\u8BD5` });
        }
        const calcHash = await hashWithSalt(password, user.salt);
        if (calcHash !== user.password_hash) {
          const newFailCount = (user.failed_login_count || 0) + 1;
          if (newFailCount >= 5) {
            const lockTime = now + 5 * 60 * 1e3;
            await env2.DB.prepare("UPDATE users SET failed_login_count = ?, locked_until = ? WHERE uid = ?").bind(newFailCount, lockTime, user.uid).run();
            return json({ code: 429, msg: "\u5BC6\u7801\u8FDE\u7EED\u9519\u8BEF\u6EE1 5 \u6B21\uFF01\u4E3A\u9632\u6B62\u88AB\u76D7\uFF0C\u8D26\u53F7\u5DF2\u88AB\u9501\u5B9A 5 \u5206\u949F" });
          } else {
            await env2.DB.prepare("UPDATE users SET failed_login_count = ? WHERE uid = ?").bind(newFailCount, user.uid).run();
            return json({ code: 1, msg: `\u8D26\u53F7\u6216\u5BC6\u7801\u9519\u8BEF\uFF08\u8FDE\u7EED\u9519\u8BEF 5 \u6B21\u9501\u5B9A\uFF0C\u8FD8\u53EF\u5C1D\u8BD5 ${5 - newFailCount} \u6B21\uFF09` });
          }
        }
        const freshToken = generateSecureHex(24);
        const expiresAt = now + 30 * 24 * 3600 * 1e3;
        await env2.DB.prepare(`
          UPDATE users
          SET failed_login_count = 0, locked_until = 0, token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE uid = ?
        `).bind(freshToken, expiresAt, user.uid).run();
        return json({
          code: 0,
          msg: "\u767B\u5F55\u6210\u529F\uFF01",
          data: {
            uid: user.uid,
            username: user.username,
            nickname: user.nickname,
            avatar: user.avatar,
            score: user.score,
            wins: user.wins,
            total_games: user.total_games,
            security_q: user.security_q,
            token: freshToken
          }
        });
      } catch (err) {
        return json({ code: 1, msg: "\u767B\u5F55\u5F02\u5E38: " + err.message }, 500);
      }
    }
    if (url.pathname === "/api/auth/get_security_q" && request.method === "POST") {
      if (!env2.DB) return json({ code: 1, msg: "\u6570\u636E\u5E93\u672A\u8FDE\u63A5" }, 500);
      try {
        const { username } = await request.json().catch(() => ({}));
        if (!username) return json({ code: 1, msg: "\u8BF7\u8F93\u5165\u8981\u627E\u56DE\u7684\u8D26\u53F7" });
        const user = await env2.DB.prepare("SELECT uid, username, security_q, reset_locked_until FROM users WHERE (username = ? OR uid = ?)").bind(String(username).trim(), String(username).trim()).first();
        if (!user) {
          return json({ code: 1, msg: "\u8BE5\u8D26\u53F7\u4E0D\u5B58\u5728" });
        }
        const now = Date.now();
        if (user.reset_locked_until && user.reset_locked_until > now) {
          const remain = Math.ceil((user.reset_locked_until - now) / 1e3);
          return json({ code: 429, msg: `\u5BC6\u4FDD\u56DE\u7B54\u9519\u8BEF\u8FC7\u591A\uFF0C\u627E\u56DE\u529F\u80FD\u9501\u5B9A\u4E2D\uFF01\u8BF7\u5728 ${remain} \u79D2\u540E\u518D\u8BD5` });
        }
        if (!user.security_q) {
          return json({ code: 1, msg: "\u8BE5\u8D26\u53F7\u672A\u8BBE\u7F6E\u5BC6\u4FDD\u95EE\u9898\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458" });
        }
        return json({ code: 0, data: { username: user.username, question: user.security_q } });
      } catch (err) {
        return json({ code: 1, msg: "\u67E5\u8BE2\u5BC6\u4FDD\u5F02\u5E38: " + err.message }, 500);
      }
    }
    if (url.pathname === "/api/auth/reset_password" && request.method === "POST") {
      if (!env2.DB) return json({ code: 1, msg: "\u6570\u636E\u5E93\u672A\u8FDE\u63A5" }, 500);
      try {
        const { username, securityAnswer, newPassword } = await request.json().catch(() => ({}));
        if (!username || !securityAnswer || !newPassword) {
          return json({ code: 1, msg: "\u8BF7\u5B8C\u6574\u586B\u5199\u8D26\u53F7\u3001\u5BC6\u4FDD\u7B54\u6848\u4E0E\u65B0\u5BC6\u7801" });
        }
        if (newPassword.length < 6 || newPassword.length > 32) {
          return json({ code: 1, msg: "\u65B0\u5BC6\u7801\u957F\u5EA6\u987B\u81F3\u5C11 6 \u4F4D\uFF08\u652F\u6301 6~32 \u4F4D\uFF09" });
        }
        const now = Date.now();
        const user = await env2.DB.prepare("SELECT * FROM users WHERE (username = ? OR uid = ?)").bind(String(username).trim(), String(username).trim()).first();
        if (!user) return json({ code: 1, msg: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
        if (user.reset_locked_until && user.reset_locked_until > now) {
          const remain = Math.ceil((user.reset_locked_until - now) / 1e3);
          return json({ code: 429, msg: `\u627E\u56DE\u529F\u80FD\u51B7\u5374\u9501\u5B9A\u4E2D\uFF0C\u8BF7\u5728 ${remain} \u79D2\u540E\u518D\u8BD5` });
        }
        const cleanAnswer = securityAnswer.trim().toLowerCase();
        const calcAnswerHash = await hashWithSalt(cleanAnswer, user.security_salt);
        if (calcAnswerHash !== user.security_a_hash) {
          const newFail = (user.failed_reset_count || 0) + 1;
          if (newFail >= 3) {
            const lockUntil = now + 10 * 60 * 1e3;
            await env2.DB.prepare("UPDATE users SET failed_reset_count = ?, reset_locked_until = ? WHERE uid = ?").bind(newFail, lockUntil, user.uid).run();
            return json({ code: 429, msg: "\u5BC6\u4FDD\u8FDE\u7EED\u7B54\u9519\u5DF2\u6EE1 3 \u6B21\uFF01\u4E3A\u9632\u7834\u89E3\uFF0C\u627E\u56DE\u5BC6\u7801\u529F\u80FD\u5DF2\u9501\u5B9A 10 \u5206\u949F" });
          } else {
            await env2.DB.prepare("UPDATE users SET failed_reset_count = ? WHERE uid = ?").bind(newFail, user.uid).run();
            return json({ code: 1, msg: `\u5BC6\u4FDD\u7B54\u6848\u4E0D\u6B63\u786E\uFF08\u8FD8\u53EF\u5C1D\u8BD5 ${3 - newFail} \u6B21\uFF09` });
          }
        }
        const newSalt = generateSecureHex(16);
        const newPwdHash = await hashWithSalt(newPassword, newSalt);
        const newToken = generateSecureHex(24);
        const expiresAt = now + 30 * 24 * 3600 * 1e3;
        await env2.DB.prepare(`
          UPDATE users
          SET password_hash = ?, salt = ?, token = ?, token_expires_at = ?,
              failed_reset_count = 0, reset_locked_until = 0,
              failed_login_count = 0, locked_until = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE uid = ?
        `).bind(newPwdHash, newSalt, newToken, expiresAt, user.uid).run();
        return json({
          code: 0,
          msg: "\u5BC6\u7801\u91CD\u7F6E\u6210\u529F\uFF01\u5DF2\u81EA\u52A8\u767B\u5F55",
          data: {
            uid: user.uid,
            username: user.username,
            nickname: user.nickname,
            avatar: user.avatar,
            score: user.score,
            wins: user.wins,
            total_games: user.total_games,
            token: newToken
          }
        });
      } catch (err) {
        return json({ code: 1, msg: "\u91CD\u7F6E\u5BC6\u7801\u5F02\u5E38: " + err.message }, 500);
      }
    }
    if (url.pathname === "/api/match/join" && request.method === "POST") {
      if (!env2.DB) return json({ code: 1, msg: "\u6570\u636E\u5E93\u672A\u8FDE\u63A5" }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid, nickname, avatar, score } = body;
        if (!uid) return json({ code: 1, msg: "\u7F3A\u5C11\u7528\u6237\u4FE1\u606F" });
        const now = Date.now();
        const safeNick = sanitizeText(nickname, 12) || "\u68CB\u58EB";
        const safeAvatar = sanitizeAvatar(avatar);
        const safeScore = parseInt(score, 10) || 1e3;
        await env2.DB.prepare('DELETE FROM match_queue WHERE updated_at < ? AND status = "waiting"').bind(now - 25e3).run();
        const opponent = await env2.DB.prepare(
          'SELECT * FROM match_queue WHERE status = "waiting" AND uid != ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 1'
        ).bind(String(uid), now - 2e4).first();
        if (opponent) {
          const roomCode = String(Math.floor(1e5 + Math.random() * 9e5));
          await env2.DB.prepare(`
            UPDATE match_queue
            SET status = 'matched', matched_with = ?, matched_color = 'black',
                matched_nickname = ?, matched_avatar = ?, matched_score = ?,
                room_code = ?, updated_at = ?
            WHERE uid = ?
          `).bind(String(uid), safeNick, safeAvatar, safeScore, roomCode, now, opponent.uid).run();
          await env2.DB.prepare(`
            INSERT INTO match_queue (uid, nickname, avatar, score, status, matched_with, matched_color, matched_nickname, matched_avatar, matched_score, room_code, updated_at)
            VALUES (?, ?, ?, ?, 'matched', ?, 'white', ?, ?, ?, ?, ?)
            ON CONFLICT(uid) DO UPDATE SET
              status = 'matched', matched_with = excluded.matched_with, matched_color = 'white',
              matched_nickname = excluded.matched_nickname, matched_avatar = excluded.matched_avatar,
              matched_score = excluded.matched_score, room_code = excluded.room_code, updated_at = excluded.updated_at
          `).bind(String(uid), safeNick, safeAvatar, safeScore, opponent.uid, opponent.nickname, opponent.avatar, opponent.score, roomCode, now).run();
          return json({
            code: 0,
            status: "matched",
            role: "client",
            color: "white",
            roomCode,
            opponent: {
              uid: opponent.uid,
              nickname: opponent.nickname,
              avatar: opponent.avatar,
              score: opponent.score
            }
          });
        }
        await env2.DB.prepare(`
          INSERT INTO match_queue (uid, nickname, avatar, score, status, matched_with, matched_color, matched_nickname, matched_avatar, matched_score, room_code, updated_at)
          VALUES (?, ?, ?, ?, 'waiting', NULL, NULL, NULL, NULL, NULL, NULL, ?)
          ON CONFLICT(uid) DO UPDATE SET
            nickname = excluded.nickname, avatar = excluded.avatar, score = excluded.score,
            status = 'waiting', matched_with = NULL, matched_color = NULL, matched_nickname = NULL,
            matched_avatar = NULL, matched_score = NULL, room_code = NULL, updated_at = excluded.updated_at
        `).bind(String(uid), safeNick, safeAvatar, safeScore, now).run();
        return json({ code: 0, status: "waiting" });
      } catch (err) {
        return json({ code: 1, msg: "\u5339\u914D\u670D\u52A1\u5F02\u5E38: " + err.message }, 500);
      }
    }
    if (url.pathname === "/api/match/poll" && request.method === "POST") {
      if (!env2.DB) return json({ code: 1, msg: "\u6570\u636E\u5E93\u672A\u8FDE\u63A5" }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid } = body;
        if (!uid) return json({ code: 1, msg: "\u7F3A\u5C11 uid" });
        const now = Date.now();
        const record = await env2.DB.prepare("SELECT * FROM match_queue WHERE uid = ?").bind(String(uid)).first();
        if (!record) {
          return json({ code: 0, status: "cancelled" });
        }
        if (record.status === "matched") {
          await env2.DB.prepare("DELETE FROM match_queue WHERE uid = ?").bind(String(uid)).run();
          return json({
            code: 0,
            status: "matched",
            role: record.matched_color === "black" ? "host" : "client",
            color: record.matched_color,
            roomCode: record.room_code,
            opponent: {
              uid: record.matched_with,
              nickname: record.matched_nickname,
              avatar: record.matched_avatar,
              score: record.matched_score
            }
          });
        }
        await env2.DB.prepare("UPDATE match_queue SET updated_at = ? WHERE uid = ?").bind(now, String(uid)).run();
        return json({ code: 0, status: "waiting" });
      } catch (err) {
        return json({ code: 1, msg: "\u8F6E\u8BE2\u5F02\u5E38: " + err.message }, 500);
      }
    }
    if (url.pathname === "/api/match/cancel" && request.method === "POST") {
      if (!env2.DB) return json({ code: 1, msg: "\u6570\u636E\u5E93\u672A\u8FDE\u63A5" }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const { uid } = body;
        if (uid) {
          await env2.DB.prepare("DELETE FROM match_queue WHERE uid = ?").bind(String(uid)).run();
        }
        return json({ code: 0, msg: "\u5DF2\u6210\u529F\u53D6\u6D88\u5339\u914D" });
      } catch (err) {
        return json({ code: 1, msg: "\u53D6\u6D88\u5F02\u5E38: " + err.message }, 500);
      }
    }
    if (url.pathname === "/api/rank" && request.method === "GET") {
      if (env2.DB) {
        const { results } = await env2.DB.prepare(`
          SELECT uid, nickname AS name, avatar, score, wins, total_games
          FROM users
          ORDER BY score DESC, wins DESC
          LIMIT 30
        `).all();
        return json({ code: 0, data: results || [] });
      }
      return json({ code: 0, data: [] });
    }
    if (url.pathname === "/api/report_game" && request.method === "POST") {
      if (!env2.DB) return json({ code: 1, msg: "\u6570\u636E\u5E93\u672A\u8FDE\u63A5" }, 500);
      try {
        const { uid, token, isWin } = await request.json().catch(() => ({}));
        if (!uid || !token) {
          return json({ code: 401, msg: "\u672A\u6388\u6743\uFF1A\u7F3A\u5931\u8EAB\u4EFD\u51ED\u8BC1" });
        }
        const now = Date.now();
        const user = await env2.DB.prepare("SELECT uid, score, last_game_at, token_expires_at FROM users WHERE uid = ? AND token = ?").bind(String(uid), String(token)).first();
        if (!user) {
          return json({ code: 403, msg: "\u672A\u6388\u6743\uFF1AToken \u65E0\u6548\u6216\u5DF2\u5931\u6548" });
        }
        if (user.token_expires_at && user.token_expires_at < now) {
          return json({ code: 401, msg: "\u767B\u5F55\u51ED\u8BC1\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55" });
        }
        if (user.last_game_at && now - user.last_game_at < 15e3) {
          return json({ code: 429, msg: "\u5BF9\u5C40\u7ED3\u7B97\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u5019\u518D\u8BD5" });
        }
        const scoreDelta = isWin ? 25 : -15;
        await env2.DB.prepare(`
          UPDATE users
          SET score = MAX(0, score + ?),
              wins = wins + ?,
              total_games = total_games + 1,
              last_game_at = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE uid = ?
        `).bind(scoreDelta, isWin ? 1 : 0, now, uid).run();
        const updated = await env2.DB.prepare("SELECT score, wins, total_games FROM users WHERE uid = ?").bind(uid).first();
        return json({ code: 0, msg: "\u6218\u7EE9\u5B89\u5168\u5F52\u6863\u6210\u529F", data: updated });
      } catch (err) {
        return json({ code: 1, msg: "\u7ED3\u7B97\u5F02\u5E38: " + err.message }, 500);
      }
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=bundledWorker-0.8234228123421599.mjs.map
