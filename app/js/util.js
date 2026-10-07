/* 通用工具函数。目标运行环境：webOS 4+ (Chromium 53)，因此不使用 async/await、可选链等语法。 */
(function (global) {
  'use strict';

  // h('div.card.focusable', {text: 'x', onclick: fn}, [children])
  function h(tag, props, children) {
    var parts = tag.split('.');
    var el = document.createElement(parts[0] || 'div');
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'text') el.textContent = v;
        else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
        else if (k === 'value') el.value = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (s) { el.style[s] = v[s]; });
        } else if (k.indexOf('on') === 0 && typeof v === 'function') {
          el.addEventListener(k.slice(2), v);
        } else el.setAttribute(k, v === true ? '' : v);
      });
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    if (children == null || children === false) return el;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  // 接口返回的简介经常带 HTML，用 DOMParser 解析成纯文本（不会执行脚本）
  function stripHtml(s) {
    if (!s) return '';
    if (!/[<&]/.test(s)) return s.trim();
    try {
      var doc = new DOMParser().parseFromString(String(s), 'text/html');
      return (doc.body.textContent || '').replace(/\s+\n/g, '\n').trim();
    } catch (e) {
      return String(s).replace(/<[^>]*>/g, '').trim();
    }
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60), ss = sec % 60;
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return (hh ? hh + ':' + p(mm) : p(mm)) + ':' + p(ss);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  // 以 limit 并发执行 worker(item)，isCancelled() 返回 true 时停止派发新任务
  function pool(items, limit, worker, isCancelled) {
    return new Promise(function (resolve) {
      var i = 0, active = 0, done = 0;
      if (!items.length) return resolve();
      function next() {
        if (isCancelled && isCancelled()) return resolve();
        while (active < limit && i < items.length) {
          var item = items[i++];
          active++;
          Promise.resolve(item).then(worker).catch(function () {}).then(function () {
            active--;
            done++;
            if (done === items.length) resolve();
            else next();
          });
        }
      }
      next();
    });
  }

  var scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = function () { delete scripts[src]; reject(new Error('加载失败: ' + src)); };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  function b64decode(s) {
    var bin = atob(s.replace(/\s+/g, ''));
    try {
      return decodeURIComponent(escape(bin));
    } catch (e) {
      return bin;
    }
  }

  function resolveUrl(url, base) {
    if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    try {
      return new URL(url, base).href;
    } catch (e) {
      return url;
    }
  }

  var toastTimer;
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2500);
  }

  // 海报懒加载
  var io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting || en.intersectionRatio > 0) {
        var img = en.target;
        io.unobserve(img);
        img.src = img.getAttribute('data-src');
      }
    });
  }, { rootMargin: '400px' }) : null;

  function lazyImg(src, cls) {
    var img = h('img' + (cls ? '.' + cls : ''), { referrerpolicy: 'no-referrer', alt: '' });
    img.onerror = function () {
      img.style.visibility = 'hidden';
    };
    if (!src) {
      img.style.visibility = 'hidden';
      return img;
    }
    if (io) {
      img.setAttribute('data-src', src);
      io.observe(img);
    } else img.src = src;
    return img;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  global.U = {
    h: h, append: append, clear: clear, stripHtml: stripHtml, fmtTime: fmtTime,
    debounce: debounce, pool: pool, loadScript: loadScript, b64decode: b64decode,
    resolveUrl: resolveUrl, toast: toast, lazyImg: lazyImg, uid: uid
  };
})(window);
