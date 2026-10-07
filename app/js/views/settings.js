/* 设置：订阅源管理 */
(function (global) {
  'use strict';
  var h = U.h;

  global.SettingsView = function () {
    var urlInput = UI.input('订阅地址，例如 https://example.com/tvbox.json', function () { Nav.focus(nameInput); });
    var nameInput = UI.input('名称（可选）', function () { add(); });
    var addBtn = UI.button('添加订阅', add, 'primary');
    var addRow = h('div.form-row', { 'data-region': 'add' }, [urlInput, nameInput, addBtn]);
    var drpyHost = UI.input('drpy-node 地址，例如 http://192.168.1.10:5757', function () { Nav.focus(drpyPwd); });
    var drpyPwd = UI.input('访问密码 (pwd)', function () { addDrpy(); });
    var drpyBtn = UI.button('添加爬虫服务器', addDrpy, 'primary');
    var drpyRow = h('div.form-row', { 'data-region': 'drpy' }, [drpyHost, drpyPwd, drpyBtn]);
    var subList = h('div.sub-list', { 'data-region': 'subs' });
    var info = h('div.settings-info');
    var misc = h('div.form-row', { 'data-region': 'misc' }, [
      UI.button('切换站点', function () { App.push(SitesView()); }),
      UI.button('清空播放记录', function () { PlayHistory.clear(); U.toast('已清空播放记录'); }),
      UI.button('清空搜索记录', function () { SearchHistory.clear(); U.toast('已清空搜索记录'); }),
      UI.button('重置网络模式', function () { Http.resetMode(); U.toast('已重置为直接请求模式'); })
    ]);

    var page = h('div.page.settings.scroll-y', null, [
      h('div.section-title', { text: '添加订阅源' }),
      h('div.section-tip', { text: '支持 TVBox 标准 JSON 配置（含多仓），可使用 CMS 类型站点（type 0/1/4）进行浏览与搜索。按确认键编辑输入框。' }),
      addRow,
      h('div.section-title', { text: '爬虫服务器（可选）' }),
      h('div.section-tip', { text: 'drpy2 JS 爬虫源已由电视内置引擎直接运行，无需服务器。如需使用 Python/PHP 等其它爬虫源，可在局域网部署 drpy-node 后在此添加。' }),
      drpyRow,
      h('div.section-title', { text: '我的订阅' }),
      subList,
      info,
      h('div.section-title', { text: '其他' }),
      misc,
      h('div.section-tip', { text: 'TVBox for webOS v1.0.0 · 网络模式：' + (IS_WEBOS ? (Http.mode() === 'service' ? '系统服务代理' : '直接请求') : '开发代理') })
    ]);
    var el = h('div.view', null, [UI.header('设置'), page]);
    var busy = false;

    function addDrpy() {
      var host = drpyHost.value.trim().replace(/\/+$/, '');
      if (!host) {
        Nav.focus(drpyHost);
        U.toast('请先输入 drpy-node 地址');
        return;
      }
      if (!/^https?:\/\//i.test(host)) host = 'http://' + host;
      if (!/:\d+$/.test(host.replace(/^https?:\/\//i, ''))) host += ':5757';
      var pwd = drpyPwd.value.trim();
      var url = host + '/config/1?healthy=1' + (pwd ? '&pwd=' + encodeURIComponent(pwd) : '');
      add(url, 'drpy-node', function () { drpyHost.value = ''; drpyPwd.value = ''; }, drpyBtn, '添加爬虫服务器');
    }

    function add(presetUrl, presetName, onDone, btn, btnText) {
      if (busy) return;
      if (typeof presetUrl !== 'string') presetUrl = null;
      btn = btn || addBtn;
      btnText = btnText || '添加订阅';
      var url = presetUrl || urlInput.value.trim();
      if (!url) {
        Nav.focus(urlInput);
        U.toast('请先输入订阅地址');
        return;
      }
      busy = true;
      btn.textContent = '正在加载…';
      Config.addSub(url, presetName || nameInput.value.trim()).then(function (r) {
        busy = false;
        btn.textContent = btnText;
        if (onDone) onDone();
        else {
          urlInput.value = '';
          nameInput.value = '';
        }
        var c = r.cfg;
        U.toast(r.added.length > 1
          ? '已添加 ' + r.added.length + ' 个仓库'
          : '添加成功：' + c.sites.length + ' 个可用站点（共 ' + c.total + ' 个）', 4000);
        render();
      }).catch(function (err) {
        busy = false;
        btn.textContent = btnText;
        U.toast('添加失败：' + err.message, 5000);
      });
    }

    function refresh(sub, btn) {
      btn.textContent = '刷新中…';
      Config.load(sub, true).then(function (c) {
        U.toast('已刷新：' + c.sites.length + ' 个可用站点');
        render();
      }).catch(function (err) {
        btn.textContent = '刷新';
        U.toast('刷新失败：' + err.message, 4000);
      });
    }

    function render() {
      var focusedIdx = [].indexOf.call(subList.querySelectorAll('.focusable'), Nav.current());
      U.clear(subList);
      U.clear(info);
      var subs = Config.subs();
      var active = Config.activeSub();
      if (!subs.length) {
        subList.appendChild(h('div.section-tip', { text: '暂无订阅' }));
      }
      subs.forEach(function (sub) {
        var isActive = active && active.id === sub.id;
        var refreshBtn;
        subList.appendChild(h('div.sub-item' + (isActive ? '.current' : ''), null, [
          h('div.sub-text', null, [
            h('div.sub-name', { text: (isActive ? '● ' : '') + sub.name }),
            h('div.sub-url', { text: sub.url })
          ]),
          UI.button(isActive ? '使用中' : '使用', function () {
            Config.setActiveSub(sub.id);
            render();
            U.toast('已切换到：' + sub.name);
          }, isActive ? 'active' : null),
          refreshBtn = UI.button('刷新', function () { refresh(sub, refreshBtn); }),
          UI.button('删除', function () {
            Config.removeSub(sub.id);
            render();
            U.toast('已删除');
          }, 'danger')
        ]));
      });
      if (active) {
        Config.load(active).then(function (c) {
          var site = Config.activeSite(c, active);
          info.textContent = '当前订阅：' + c.sites.length + ' 个可用站点 / 共 ' + c.total + ' 个，' +
            c.parses.length + ' 个解析接口' + (site ? '，当前站点：' + site.name : '') +
            (c.sites.some(function (x) { return x.type === 3; }) ? '（含 ' + c.sites.filter(function (x) { return x.type === 3; }).length + ' 个 JS 爬虫站点）' : '') +
            (c.skipped ? '。已跳过 ' + c.skipped + ' 个不支持的站点（如 csp_ Java 爬虫）' : '');
        }).catch(function (err) {
          info.textContent = '当前订阅加载失败：' + err.message;
        });
      }
      if (focusedIdx >= 0) {
        var items = subList.querySelectorAll('.focusable');
        var target = items[Math.min(focusedIdx, items.length - 1)];
        if (target) Nav.focus(target);
        else Nav.focus(urlInput);
      }
    }

    render();
    return {
      el: el,
      focusSelector: '.input',
      onShow: function (first) { if (!first) render(); }
    };
  };
})(window);
