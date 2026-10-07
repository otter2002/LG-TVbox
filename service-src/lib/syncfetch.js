/* 在爬虫线程里同步发请求：把请求交给请求线程，然后 Atomics.wait 阻塞等待结果 */
'use strict';
const path = require('path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

let worker = null;
let port = null;
let signal = null;
let seq = 0;

function ensure() {
  if (worker) return;
  const sab = new SharedArrayBuffer(4);
  signal = new Int32Array(sab);
  const ch = new MessageChannel();
  port = ch.port1;
  worker = new Worker(path.join(__dirname, 'fetch-worker.js'), {
    workerData: { port: ch.port2, sab },
    transferList: [ch.port2]
  });
  worker.unref();
  worker.on('error', () => { worker = null; });
  worker.on('exit', () => { worker = null; });
}

// opts: {method, headers, body, timeout, redirect: 'follow'|'manual', buffer: 0|1|2}
// 返回 {code, headers, content, error?}，网络错误不抛异常（与安卓端 req 行为一致）
function syncFetch(url, opts) {
  ensure();
  const id = ++seq;
  const timeout = (opts && opts.timeout) || 15000;
  port.postMessage({ id, opts: Object.assign({}, opts, { url }) });
  const deadline = Date.now() + timeout + 5000;
  for (;;) {
    // 先清标志再取消息：请求线程总是"先发消息再置标志"，所以不会漏掉唤醒
    Atomics.store(signal, 0, 0);
    let msg;
    while ((msg = receiveMessageOnPort(port))) {
      if (msg.message.id === id) return msg.message;
      // 丢弃之前超时请求迟到的结果
    }
    const left = deadline - Date.now();
    if (left <= 0) return { code: 0, headers: {}, content: '', error: 'timeout' };
    Atomics.wait(signal, 0, 0, left);
  }
}

module.exports = { syncFetch };
