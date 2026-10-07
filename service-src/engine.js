/*
 * 内置爬虫引擎入口（webOS JS 服务与电脑调试服务器共用）。
 *   const engine = createEngine({poolSize: 3});
 *   engine.call({key, api, ext, extObj}, 'search', ['关键词', false, '1']) -> Promise<object>
 */
'use strict';
const path = require('path');
const { Worker } = require('worker_threads');

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function createEngine(opts) {
  opts = opts || {};
  const size = opts.poolSize || 3;
  const slots = new Array(size).fill(null);
  const pending = new Map();
  let seq = 0;

  function spawn(i) {
    const w = new Worker(path.join(__dirname, 'spider-worker.js'));
    const fail = (err) => {
      if (slots[i] === w) slots[i] = null;
      for (const [id, p] of pending) {
        if (p.worker === w) {
          pending.delete(id);
          clearTimeout(p.timer);
          p.reject(err);
        }
      }
    };
    w.on('message', (m) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.data);
      else p.reject(new Error(m.error));
    });
    w.on('error', (e) => fail(new Error('爬虫线程出错: ' + e.message)));
    w.on('exit', () => fail(new Error('爬虫线程已退出')));
    slots[i] = w;
    return w;
  }

  function call(site, action, args, timeout) {
    if (!site || !site.api) return Promise.reject(new Error('缺少站点信息'));
    const i = hash(String(site.key) + site.api) % size;
    const w = slots[i] || spawn(i);
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('爬虫执行超时'));
        // 线程可能卡在同步请求里，直接重建
        w.terminate();
      }, timeout || 60000);
      pending.set(id, { resolve, reject, timer, worker: w });
      w.postMessage({ id, site, action, args: args || [] });
    });
  }

  return {
    call,
    busy: () => pending.size,
    destroy: () => slots.forEach((w) => w && w.terminate())
  };
}

module.exports = { createEngine };
