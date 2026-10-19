'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'js', 'startup-splash.js');
const source = fs.readFileSync(sourcePath, 'utf8');
let totalStrokes = 0;
let nextTimerId = 1;
let nextFrameId = 1;
let scheduledFrame = null;
let currentTime = 1000;
const windowListeners = Object.create(null);
const documentListeners = Object.create(null);
const canvases = [];
const timers = new Map();
const rootClasses = new Set();
const documentClasses = new Set();

class MockContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.globalAlpha = 1;
  }
  setTransform() {}
  clearRect() {}
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  ellipse() {}
  arc() {}
  fill() {}
  stroke() { totalStrokes++; }
  drawImage(source) {
    if (!this.canvas.drawSources) this.canvas.drawSources = [];
    this.canvas.drawSources.push(source);
  }
  createRadialGradient() {
    return { addColorStop() {} };
  }
}

class MockCanvas {
  constructor(isBoard = false) {
    this.isBoard = isBoard;
    this.width = 320;
    this.height = 320;
    this.offsetWidth = 320;
    this.offsetHeight = 320;
    this.drawSources = [];
    this.context = new MockContext(this);
  }
  getContext(kind) {
    return kind === '2d' ? this.context : null;
  }
  getBoundingClientRect() {
    return { width: this.offsetWidth, height: this.offsetHeight };
  }
}

const boardCanvas = new MockCanvas(true);
const skipButton = { addEventListener() {} };
const root = {
  hidden: false,
  dataset: {},
  classList: {
    add(name) { rootClasses.add(name); },
    remove(name) { rootClasses.delete(name); }
  },
  querySelector(selector) {
    if (selector === '[data-startup-board]') return boardCanvas;
    if (selector === '[data-startup-skip]') return skipButton;
    return null;
  },
  setAttribute() {},
  addEventListener() {},
  dispatchEvent() {}
};

const document = {
  hidden: false,
  documentElement: {
    classList: {
      add(name) { documentClasses.add(name); },
      remove(name) { documentClasses.delete(name); }
    }
  },
  getElementById(id) { return id === 'startupSplash' ? root : null; },
  createElement(tag) {
    assert.strictEqual(tag, 'canvas');
    const canvas = new MockCanvas();
    canvases.push(canvas);
    return canvas;
  },
  addEventListener(name, callback) { documentListeners[name] = callback; }
};

const window = {
  devicePixelRatio: 1,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  matchMedia() { return { matches: false }; },
  dispatchEvent() {},
  addEventListener(name, callback) { windowListeners[name] = callback; },
  removeEventListener(name, callback) { if (windowListeners[name] === callback) delete windowListeners[name]; },
  requestAnimationFrame(callback) {
    scheduledFrame = callback;
    return nextFrameId++;
  },
  cancelAnimationFrame() { scheduledFrame = null; },
  setTimeout(callback) { const id = nextTimerId++; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); }
};

class MockEvent {
  constructor(type, options) { this.type = type; this.detail = options && options.detail; }
}

const sandbox = {
  window,
  document,
  navigator: {},
  performance: { now() { return currentTime; } },
  Event: MockEvent,
  CustomEvent: MockEvent,
  Math,
  Number,
  Object,
  Boolean,
  console
};

vm.runInNewContext(source, sandbox, { filename: sourcePath });

assert.strictEqual(canvases.length, 3, 'two stone sprites and one cached board layer should be created');
const cachedBoard = canvases[2];
assert.strictEqual(totalStrokes, 15, 'initial board layer should draw its 15 grid strokes once');
assert.strictEqual(boardCanvas.drawSources.filter(image => image === cachedBoard).length, 1,
  'initial frame should draw the cached board layer once');

for (const frameTime of [1016, 1050, 1150]) {
  const frame = scheduledFrame;
  assert.strictEqual(typeof frame, 'function', 'animation should schedule the next frame');
  scheduledFrame = null;
  currentTime = frameTime;
  frame(frameTime);
  assert.strictEqual(totalStrokes, 15, 'same-size animation frames must reuse the cached grid');
}
assert.strictEqual(boardCanvas.drawSources.filter(image => image === cachedBoard).length, 4,
  'each animation frame should composite the cached board once');

boardCanvas.offsetWidth = 400;
boardCanvas.offsetHeight = 360;
windowListeners.resize();
assert.strictEqual(totalStrokes, 30, 'resizing should rebuild the grid exactly once');
assert.strictEqual(cachedBoard.width, 400);
assert.strictEqual(cachedBoard.height, 360);
assert.strictEqual(boardCanvas.drawSources.filter(image => image === cachedBoard).length, 5,
  'resize redraw should composite the rebuilt cache once');

const frameAfterResize = scheduledFrame;
assert.strictEqual(typeof frameAfterResize, 'function');
scheduledFrame = null;
frameAfterResize(1200);
assert.strictEqual(totalStrokes, 30, 'frames after resize should reuse the rebuilt grid');
assert.strictEqual(boardCanvas.drawSources.filter(image => image === cachedBoard).length, 6);

window.devicePixelRatio = 2;
windowListeners.resize();
assert.strictEqual(totalStrokes, 45, 'DPR changes must rebuild the cache');
assert.strictEqual(cachedBoard.width, 800);
assert.strictEqual(cachedBoard.height, 720);
window.GomokuStartupSplash.skip();
assert.strictEqual(scheduledFrame, null, 'skip cancels the animation frame');
assert.strictEqual(windowListeners.resize, undefined, 'dismiss removes the dormant resize renderer');
for (const callback of [...timers.values()]) callback();
assert.strictEqual(root.hidden, true);
assert.strictEqual(cachedBoard.width, 0, 'dismiss releases the cached grid buffer');

console.log(JSON.stringify({
  pass: true,
  sourceExecuted: true,
  initialGridBuilds: 1,
  sameSizeFrames: 3,
  resizeGridBuilds: 1,
  framesAfterResize: 1,
  initialGridStrokes: 15,
  totalGridStrokes: totalStrokes
}));
