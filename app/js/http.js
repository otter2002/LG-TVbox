/*
 * 网络请求。
 * - 电视上：优先直接 XHR（webOS 本地应用通常不受 CORS 限制）；若失败则回退到随包安装的
 *   JS 服务 luna://com.lgwebos.tvbox.service/fetch（Node 端发请求，无 CORS，并带浏览器 UA）。
 * - 电脑浏览器调试：通过 dev-server.js 的 /proxy 转发，绕开 CORS。
 */
(function (global) {
  'use strict';

  var IS_WEBOS = typeof global.PalmSystem !== 'undefined' || /web0s|webos/i.test(navigator.userAgent);
  var DEV_PROXY = !IS_WEBOS && /^https?:$/.test(location.protocol);
  var SERVICE_URI = 'luna://com.lgwebos.tvbox.service/';
  var DEFAULT_TIMEOUT = 15000;

  // 'xhr' | 'service'，记住上次可用的方式
  var mode = Store.get('netMode', 'xhr');

  function HttpError(msg, status) {
    var e = new Error(msg);
    e.status = status;
    return e;
  }

  function viaXhr(url, timeout) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', DEV_PROXY ? '/proxy?url=' + encodeURIComponent(url) : url, true);
      x.timeout = timeout;
      x.onload = function () {
        if (x.status >= 200 && x.status < 400) resolve(x.responseText);
        else reject(HttpError('HTTP ' + x.status, x.status));
      };
      x.onerror = function () { reject(HttpError('网络错误', 0)); };
      x.ontimeout = function () { reject(HttpError('请求超时', -1)); };
      x.send();
    });
  }

  var pending = []; // 防止 PalmServiceBridge 在回调前被回收
  // 调用随包安装的 JS 服务，resolve 原始响应对象
  function lunaCall(method, params, timeout) {
    return new Promise(function (resolve, reject) {
      if (typeof global.PalmServiceBridge === 'undefined') {
        return reject(HttpError('系统服务不可用', 0));
      }
      var bridge = new global.PalmServiceBridge();
      var done = false;
      pending.push(bridge);
      function finish(fn, arg) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        var i = pending.indexOf(bridge);
        if (i >= 0) pending.splice(i, 1);
        fn(arg);
      }
      var timer = setTimeout(function () { finish(reject, HttpError('请求超时', -1)); }, timeout + 3000);
      bridge.onservicecallback = function (msg) {
        var res;
        try { res = JSON.parse(msg); } catch (e) { return finish(reject, e); }
        finish(resolve, res);
      };
      bridge.call(SERVICE_URI + method, JSON.stringify(params));
    });
  }

  function viaService(url, timeout) {
    return lunaCall('fetch', { url: url, timeout: timeout }, timeout).then(function (res) {
      if (res.returnValue && res.status >= 200 && res.status < 400) return res.body;
      throw HttpError(res.errorText || ('HTTP ' + res.status), res.status || 0);
    });
  }

  // 内置爬虫引擎：电视上走 JS 服务，电脑调试时走 dev-server 的 /spider
  function spider(payload, timeout) {
    timeout = timeout || 45000;
    payload.timeout = timeout;
    if (IS_WEBOS) {
      return lunaCall('spider', payload, timeout + 5000).then(function (res) {
        if (res.returnValue) return res.data;
        throw new Error(res.errorText || '爬虫执行失败');
      });
    }
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', '/spider', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.timeout = timeout + 5000;
      x.onload = function () {
        var res;
        try { res = JSON.parse(x.responseText); } catch (e) { return reject(new Error('调试服务器响应异常')); }
        if (res.ok) resolve(res.data);
        else reject(new Error(res.error || '爬虫执行失败'));
      };
      x.onerror = function () { reject(new Error('无法连接调试服务器')); };
      x.ontimeout = function () { reject(new Error('爬虫执行超时')); };
      x.send(JSON.stringify(payload));
    });
  }

  function get(url, opts) {
    var timeout = (opts && opts.timeout) || DEFAULT_TIMEOUT;
    if (!IS_WEBOS) return viaXhr(url, timeout);
    if (mode === 'service') {
      return viaService(url, timeout).catch(function (err) {
        // 服务不可用（例如未打包服务）时退回 XHR
        if (err.status !== 0) throw err;
        return viaXhr(url, timeout);
      });
    }
    return viaXhr(url, timeout).catch(function (err) {
      if (err.status !== 0) throw err; // 只有疑似 CORS/网络错误才尝试服务
      return viaService(url, timeout).then(function (body) {
        mode = 'service';
        Store.set('netMode', mode);
        return body;
      }, function () { throw err; });
    });
  }

  function getJson(url, opts) {
    return get(url, opts).then(function (text) {
      try {
        return JSON.parse(text.replace(/^﻿/, '').trim());
      } catch (e) {
        throw new Error('接口返回的不是有效 JSON');
      }
    });
  }

  global.IS_WEBOS = IS_WEBOS;
  global.Http = {
    get: get,
    getJson: getJson,
    spider: spider,
    mode: function () { return mode; },
    resetMode: function () { mode = 'xhr'; Store.set('netMode', mode); }
  };
})(window);
