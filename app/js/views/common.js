/* 页面公用组件 */
(function (global) {
  'use strict';
  var h = U.h;

  // 影片卡片；opts.showSite 时显示站点名，opts.progress 显示进度条(0~1)
  function vodCard(vod, onClick, opts) {
    opts = opts || {};
    var poster = h('div.poster', null, [
      h('div.poster-name', { text: vod.vod_name }),
      U.lazyImg(vod.vod_pic),
      vod.vod_remarks ? h('span.remarks', { text: vod.vod_remarks }) : null,
      opts.progress != null ? h('div.progress', null, h('i', { style: { width: Math.round(opts.progress * 100) + '%' } })) : null
    ]);
    return h('div.card.focusable', { onclick: function () { onClick(vod); } }, [
      poster,
      h('div.card-title', { text: vod.vod_name }),
      opts.sub ? h('div.card-sub', { text: opts.sub }) : null
    ]);
  }

  function button(text, onClick, cls) {
    return h('div.btn.focusable' + (cls ? '.' + cls : ''), { onclick: onClick, text: text });
  }

  function message(text, actionText, action) {
    return h('div.message', null, [
      h('div.message-text', { text: text }),
      actionText ? button(actionText, action, 'primary') : null
    ]);
  }

  function spinner(text) {
    return h('div.loading', null, [h('div.spinner'), h('div', { text: text || '加载中…' })]);
  }

  // 可遥控输入框；onEnter 在软键盘/遥控确认时触发
  function input(placeholder, onEnter, value) {
    var el = h('input.input.focusable', { type: 'text', placeholder: placeholder, value: value || '', spellcheck: 'false', autocomplete: 'off' });
    el.__onEnter = onEnter;
    return el;
  }

  function header(title, right) {
    return h('div.header', { 'data-region': 'header' }, [
      h('div.logo', null, ['TV', h('span', { text: 'Box' })]),
      title ? h('div.header-title', { text: title }) : null,
      h('div.spacer')
    ].concat(right || []));
  }

  global.UI = { vodCard: vodCard, button: button, message: message, spinner: spinner, input: input, header: header };
})(window);
