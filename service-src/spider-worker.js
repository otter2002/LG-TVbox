/* 爬虫线程：串行执行发给它的爬虫调用。同一站点总是路由到同一线程，以复用已初始化的实例 */
'use strict';
const { parentPort } = require('worker_threads');
const runtime = require('./lib/runtime');

parentPort.on('message', async (m) => {
  try {
    const data = await runtime.call(m.site, m.action, m.args);
    parentPort.postMessage({ id: m.id, ok: true, data });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: (e && e.message) || String(e) });
  }
});
