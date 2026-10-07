/* 站点选择 */
(function (global) {
  'use strict';
  var h = U.h;

  global.SitesView = function () {
    var list = h('div.site-grid');
    var body = h('div.page.scroll-y', { 'data-region': 'sites' }, list);
    var el = h('div.view', null, [UI.header('选择站点'), body]);

    Config.current().then(function (ctx) {
      if (!ctx) {
        U.append(list, UI.message('还没有添加订阅源', '去设置', function () { App.pop(); App.push(SettingsView()); }));
        Nav.focusFirst();
        return;
      }
      ctx.cfg.sites.forEach(function (site) {
        var active = ctx.site && site.key === ctx.site.key;
        var item = h('div.site-item.focusable' + (active ? '.active' : ''), {
          onclick: function () {
            Config.setActiveSite(ctx.sub, site.key);
            App.back();
          }
        }, [
          h('div.site-name', { text: site.name }),
          h('div.site-meta', { text: Source.typeLabel(site.type) + (site.searchable ? ' · 可搜索' : '') })
        ]);
        list.appendChild(item);
      });
      if (!ctx.cfg.sites.length) U.append(list, UI.message('该订阅中没有可用站点'));
      Nav.focusFirst('.site-item.active');
    }).catch(function (err) {
      U.append(list, UI.message('加载失败：' + err.message));
    });

    return { el: el };
  };
})(window);
