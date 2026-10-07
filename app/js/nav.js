/*
 * 遥控器空间导航（方向键焦点移动）。
 * - 可聚焦元素加 class "focusable"，获得焦点时加 "focused"
 * - 容器加 data-region="xxx"：跨区域移动时，若区域带 data-remember，
 *   优先回到区域内 .active 元素或上次聚焦的元素
 * - 容器加 class "scroll-y" / "scroll-x"：焦点移动时自动滚动保持可见
 */
(function (global) {
  'use strict';

  var root = document.body;
  var cur = null;

  function isVisible(el) {
    if (el.disabled || el.offsetParent === null) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function focusables() {
    return [].filter.call(root.querySelectorAll('.focusable'), isVisible);
  }

  function regionOf(el) {
    return el && el.closest ? el.closest('[data-region]') : null;
  }

  function ensureVisible(el) {
    var margin = parseFloat(getComputedStyle(document.documentElement).fontSize) * 3;
    var p = el.parentElement;
    while (p && p !== document.body) {
      var cl = p.classList;
      if (cl.contains('scroll-y') || cl.contains('scroll-x')) {
        var pr = p.getBoundingClientRect(), er = el.getBoundingClientRect();
        if (cl.contains('scroll-y')) {
          if (er.top < pr.top + margin) p.scrollTop -= pr.top + margin - er.top;
          else if (er.bottom > pr.bottom - margin) p.scrollTop += er.bottom - (pr.bottom - margin);
        }
        if (cl.contains('scroll-x')) {
          if (er.left < pr.left + margin) p.scrollLeft -= pr.left + margin - er.left;
          else if (er.right > pr.right - margin) p.scrollLeft += er.right - (pr.right - margin);
        }
      }
      p = p.parentElement;
    }
  }

  function focus(el, noScroll) {
    if (cur === el) return;
    if (cur) cur.classList.remove('focused');
    cur = el || null;
    if (!el) return;
    el.classList.add('focused');
    var reg = regionOf(el);
    if (reg) reg.__last = el;
    if (!noScroll) ensureVisible(el);
    el.dispatchEvent(new CustomEvent('navfocus', { bubbles: true }));
  }

  function rememberTarget(reg) {
    if (!reg || !reg.hasAttribute('data-remember')) return null;
    var act = reg.querySelector('.focusable.active');
    if (act && isVisible(act)) return act;
    var last = reg.__last;
    if (last && reg.contains(last) && isVisible(last)) return last;
    return null;
  }

  function move(dir) {
    var list = focusables();
    if (!cur || list.indexOf(cur) < 0) {
      if (list.length) focus(list[0]);
      return false;
    }
    var a = cur.getBoundingClientRect();
    var acx = a.left + a.width / 2, acy = a.top + a.height / 2;
    var best = null, bestScore = Infinity;
    list.forEach(function (el) {
      if (el === cur) return;
      var b = el.getBoundingClientRect();
      var bcx = b.left + b.width / 2, bcy = b.top + b.height / 2;
      var main, gap, off;
      if (dir === 'left' || dir === 'right') {
        if (dir === 'right' ? bcx <= acx + 1 : bcx >= acx - 1) return;
        main = dir === 'right' ? b.left - a.right : a.left - b.right;
        gap = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
        off = Math.abs(bcy - acy);
      } else {
        if (dir === 'down' ? bcy <= acy + 1 : bcy >= acy - 1) return;
        main = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
        gap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
        off = Math.abs(bcx - acx);
      }
      var score = Math.max(0, main) + gap * 4 + off * 0.1;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (!best) return false;
    var from = regionOf(cur), to = regionOf(best);
    if (to && to !== from) best = rememberTarget(to) || best;
    focus(best);
    return true;
  }

  function setRoot(el) {
    root = el || document.body;
    if (cur && !root.contains(cur)) {
      cur.classList.remove('focused');
      cur = null;
    }
  }

  function focusFirst(preferSelector) {
    var el = preferSelector ? root.querySelector(preferSelector) : null;
    if (!el || !isVisible(el)) el = focusables()[0];
    if (el) focus(el);
  }

  // 鼠标/Magic Remote 指针：悬停即聚焦
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest && e.target.closest('.focusable');
    if (el && root.contains(el) && el !== cur) focus(el, true);
  });

  global.Nav = {
    move: move,
    focus: focus,
    focusFirst: focusFirst,
    setRoot: setRoot,
    root: function () { return root; },
    current: function () { return cur && root.contains(cur) ? cur : null; },
    isVisible: isVisible
  };
})(window);
