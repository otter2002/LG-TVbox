/* 首页：顶部操作栏 + 左侧分类 + 右侧影片网格（滚动到底自动加载下一页） */
(function (global) {
  'use strict';
  var h = U.h;
  var COLS = 6;

  global.HomeView = function () {
    var siteBtn = UI.button('选择站点', function () { App.push(SitesView()); }, 'site-btn');
    var head = UI.header(null, [
      siteBtn,
      UI.button('搜索', function () { App.push(SearchView()); }),
      UI.button('历史', function () { App.push(HistoryView()); }),
      UI.button('设置', function () { App.push(SettingsView()); })
    ]);
    var cats = h('div.sidebar.scroll-y', { 'data-region': 'cats', 'data-remember': '' });
    var grid = h('div.grid');
    var status = h('div.grid-status');
    var main = h('div.main.scroll-y', { 'data-region': 'grid' }, [grid, status]);
    var body = h('div.body', null, [cats, main]);
    var el = h('div.view.home', null, [head, body]);

    var st = { ctx: null, site: null, tid: null, page: 0, pagecount: 0, loading: false, token: 0, count: 0, seenVersion: -1 };

    function showMessage(text, actionText, action) {
      st.site = null;
      U.clear(cats);
      U.clear(grid);
      status.textContent = '';
      U.append(grid, UI.message(text, actionText, action));
    }

    function init() {
      st.seenVersion = Config.version();
      st.token++;
      U.clear(cats);
      U.clear(grid);
      U.append(grid, UI.spinner('正在加载订阅…'));
      var token = st.token;
      Config.current().then(function (ctx) {
        if (token !== st.token) return;
        if (!ctx) {
          siteBtn.textContent = '选择站点';
          return showMessage('还没有添加订阅源\n请在设置中输入 TVBox 订阅地址', '添加订阅', function () { App.push(SettingsView()); });
        }
        st.ctx = ctx;
        if (!ctx.site) {
          siteBtn.textContent = '无可用站点';
          return showMessage('该订阅中没有可用站点\n（仅支持 type 0/1/4 的 CMS 接口站点）', '打开设置', function () { App.push(SettingsView()); });
        }
        loadSite(ctx.site);
      }).catch(function (err) {
        if (token !== st.token) return;
        showMessage('订阅加载失败：' + err.message, '重试', init);
      });
    }

    function loadSite(site) {
      st.site = site;
      siteBtn.textContent = site.name;
      var token = ++st.token;
      U.clear(cats);
      U.clear(grid);
      status.textContent = '';
      U.append(grid, UI.spinner('正在加载 ' + site.name + '…'));
      Source.home(site).then(function (r) {
        if (token !== st.token) return;
        var classes = [{ id: '', name: '推荐' }].concat(r.classes);
        classes.forEach(function (c) {
          var item = h('div.cat.focusable', { text: c.name, onclick: function () { selectCat(c.id, item); } });
          item.addEventListener('navfocus', function () { autoSelect(c.id, item); });
          cats.appendChild(item);
        });
        selectCat('', cats.firstChild, r.list, r.pagecount);
        var cur = Nav.current();
        if (App.top() === view && (!cur || !body.contains(cur))) Nav.focus(cats.firstChild);
      }).catch(function (err) {
        if (token !== st.token) return;
        showMessage('站点加载失败：' + err.message + '\n可以在顶部切换其他站点', '切换站点', function () { App.push(SitesView()); });
      });
    }

    // 焦点停留在分类上 450ms 后自动切换
    var autoSelect = U.debounce(function (tid, item) {
      if (Nav.current() === item && st.tid !== tid) selectCat(tid, item);
    }, 450);

    function selectCat(tid, item, presetList, presetPagecount) {
      [].forEach.call(cats.children, function (c) { c.classList.toggle('active', c === item); });
      st.tid = tid;
      st.page = 0;
      st.pagecount = 1;
      st.count = 0;
      st.loading = false;
      st.token++;
      U.clear(grid);
      main.scrollTop = 0;
      if (presetList && presetList.length) {
        st.page = 1;
        st.pagecount = presetPagecount || 1;
        appendList(presetList);
        updateStatus();
      } else {
        loadMore();
      }
    }

    function appendList(list) {
      var frag = document.createDocumentFragment();
      list.forEach(function (vod) {
        frag.appendChild(UI.vodCard(vod, openVod));
      });
      grid.appendChild(frag);
      st.count += list.length;
    }

    function updateStatus() {
      if (st.loading) status.textContent = '加载中…';
      else if (!st.count) status.textContent = '暂无内容';
      else if (st.page >= st.pagecount) status.textContent = '没有更多了';
      else status.textContent = '';
    }

    function loadMore() {
      if (!st.site || st.loading || (st.page && st.page >= st.pagecount)) return;
      st.loading = true;
      updateStatus();
      var token = st.token;
      var pg = st.page + 1;
      Source.category(st.site, st.tid, pg).then(function (r) {
        if (token !== st.token) return;
        st.loading = false;
        st.page = pg;
        st.pagecount = r.list.length ? Math.max(r.pagecount, pg) : pg;
        appendList(r.list);
        updateStatus();
      }).catch(function (err) {
        if (token !== st.token) return;
        st.loading = false;
        status.textContent = '加载失败：' + err.message;
      });
    }

    // 焦点到达倒数两行时预加载下一页
    grid.addEventListener('navfocus', function (e) {
      var idx = [].indexOf.call(grid.children, e.target);
      if (idx >= 0 && idx >= st.count - COLS * 2) loadMore();
    });
    main.addEventListener('scroll', function () {
      if (main.scrollTop + main.clientHeight >= main.scrollHeight - 200) loadMore();
    });

    function openVod(vod) {
      App.push(DetailView(vod.site, vod.vod_id, vod));
    }

    var view = {
      el: el,
      focusSelector: '.cat.active',
      onShow: function (first) {
        if (!first && st.seenVersion !== Config.version()) {
          init();
          Nav.focusFirst();
        }
      }
    };
    init();
    return view;
  };
})(window);
