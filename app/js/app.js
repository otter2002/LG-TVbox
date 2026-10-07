/*
 * 页面栈路由 + 全局按键分发。
 * 页面对象：{el, onKey(e, keyCode)?, onShow(first)?, onHide()?, onBack()?, destroy()?, focusSelector?}
 */
(function (global) {
  'use strict';

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 461, ESC: 27, BACKSPACE: 8,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 179, STOP: 413, FF: 417, RW: 412,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406
  };

  var rootEl = document.getElementById('app');
  var stack = [];
  var exitArmed = 0;

  function top() { return stack[stack.length - 1] || null; }

  function push(view) {
    var prev = top();
    if (prev) {
      prev.savedFocus = Nav.current();
      prev.el.classList.add('hidden');
      if (prev.onHide) prev.onHide();
    }
    stack.push(view);
    rootEl.appendChild(view.el);
    Nav.setRoot(view.el);
    if (view.onShow) view.onShow(true);
    if (!Nav.current()) Nav.focusFirst(view.focusSelector);
  }

  function pop() {
    var view = stack.pop();
    if (view.destroy) view.destroy();
    if (view.el.parentNode) view.el.parentNode.removeChild(view.el);
    var prev = top();
    prev.el.classList.remove('hidden');
    Nav.setRoot(prev.el);
    var f = prev.savedFocus;
    if (f && prev.el.contains(f) && Nav.isVisible(f)) Nav.focus(f);
    if (prev.onShow) prev.onShow(false);
    if (!Nav.current()) Nav.focusFirst(prev.focusSelector);
  }

  function back() {
    var view = top();
    if (view && view.onBack && view.onBack() === true) return;
    if (stack.length > 1) return pop();
    // 根页面：连按两次返回退出
    var now = Date.now();
    if (now - exitArmed < 2000) return exit();
    exitArmed = now;
    U.toast('再按一次返回键退出');
  }

  function exit() {
    if (global.PalmSystem && global.PalmSystem.platformBack) global.PalmSystem.platformBack();
    else global.close();
  }

  // 输入框：方向键聚焦时只做高亮，按确认键才真正 focus() 弹出软键盘
  function handleEditing(e, k, input) {
    if (k === KEY.ENTER) {
      e.preventDefault();
      input.blur();
      if (input.__onEnter) input.__onEnter(input.value);
      return true;
    }
    if (k === KEY.BACK || k === KEY.ESC) {
      e.preventDefault();
      input.blur();
      return true;
    }
    if (k === KEY.LEFT && input.selectionStart > 0) return true;
    if (k === KEY.RIGHT && input.selectionEnd < input.value.length) return true;
    if (k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN) {
      input.blur();
      return false; // 继续走方向导航
    }
    return true; // 其它按键交给输入框
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
      if (handleEditing(e, k, ae)) return;
    }
    var view = top();
    if (view && view.onKey && view.onKey(e, k) === true) {
      e.preventDefault();
      return;
    }
    switch (k) {
      case KEY.LEFT: Nav.move('left'); break;
      case KEY.RIGHT: Nav.move('right'); break;
      case KEY.UP: Nav.move('up'); break;
      case KEY.DOWN: Nav.move('down'); break;
      case KEY.ENTER:
        var c = Nav.current();
        if (!c) break;
        if (c.tagName === 'INPUT') c.focus();
        else c.click();
        break;
      case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE:
        back();
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // 以 1920 宽为设计稿，1rem = 16px
  function fit() {
    document.documentElement.style.fontSize = (global.innerWidth / 1920 * 16) + 'px';
  }
  global.addEventListener('resize', fit);
  fit();

  global.KEY = KEY;
  global.App = { push: push, back: back, pop: pop, top: top, exit: exit };

  document.addEventListener('DOMContentLoaded', start);
  if (document.readyState !== 'loading') start();
  var started = false;
  function start() {
    if (started) return;
    started = true;
    push(HomeView());
  }
})(window);
