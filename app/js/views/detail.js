/* 影片详情：信息 + 线路切换 + 选集 */
(function (global) {
  'use strict';
  var h = U.h;

  global.DetailView = function (site, vodId, preview) {
    var info = h('div.detail-info');
    var actions = h('div.detail-actions', { 'data-region': 'actions' });
    var tabs = h('div.tabs.scroll-x', { 'data-region': 'tabs', 'data-remember': '' });
    var eps = h('div.eps', { 'data-region': 'eps', 'data-remember': '' });
    var epsWrap = h('div.eps-wrap', null, [tabs, eps]);
    var page = h('div.page.detail.scroll-y', null, [info, actions, epsWrap]);
    var el = h('div.view', null, [UI.header(site.name), page]);

    var st = { vod: null, sources: [], src: 0, reverse: false, cfg: null };

    function renderInfo(vod) {
      U.clear(info);
      var meta = [vod.vod_year, vod.vod_area, vod.type_name].filter(Boolean).join(' · ');
      U.append(info, [
        h('div.detail-poster', null, U.lazyImg(vod.vod_pic)),
        h('div.detail-text', null, [
          h('div.detail-title', { text: vod.vod_name }),
          meta ? h('div.detail-meta', { text: meta }) : null,
          vod.vod_remarks ? h('div.detail-meta.accent', { text: vod.vod_remarks }) : null,
          vod.vod_director ? h('div.detail-line', { text: '导演：' + U.stripHtml(vod.vod_director) }) : null,
          vod.vod_actor ? h('div.detail-line', { text: '主演：' + U.stripHtml(vod.vod_actor) }) : null,
          vod.vod_content ? h('div.detail-desc', { text: U.stripHtml(vod.vod_content) }) : null
        ])
      ]);
    }

    function renderActions() {
      U.clear(actions);
      if (!st.sources.length) return;
      var hist = PlayHistory.get(site, vodId);
      var label = '▶ 立即播放';
      if (hist && st.sources[hist.src] && st.sources[hist.src].eps[hist.ep]) {
        label = '▶ 继续播放 ' + st.sources[hist.src].eps[hist.ep].name;
      }
      U.append(actions, [
        UI.button(label, function () {
          if (hist && st.sources[hist.src] && st.sources[hist.src].eps[hist.ep]) play(hist.src, hist.ep, hist.time);
          else play(st.src, 0, 0);
        }, 'primary.play-btn'),
        UI.button(st.reverse ? '正序' : '倒序', function () {
          st.reverse = !st.reverse;
          renderActions();
          renderEps();
          Nav.focus(actions.children[1]);
        }),
        UI.button('搜索同名', function () { App.push(SearchView(st.vod.vod_name)); })
      ]);
    }

    function renderTabs() {
      U.clear(tabs);
      st.sources.forEach(function (s, i) {
        var t = h('div.tab.focusable' + (i === st.src ? '.active' : ''), {
          text: s.name + ' (' + s.eps.length + ')',
          onclick: function () { selectSrc(i); }
        });
        tabs.appendChild(t);
      });
    }

    function selectSrc(i) {
      st.src = i;
      [].forEach.call(tabs.children, function (t, j) { t.classList.toggle('active', j === i); });
      renderEps();
    }

    function renderEps() {
      U.clear(eps);
      var src = st.sources[st.src];
      if (!src) return;
      var hist = PlayHistory.get(site, vodId);
      var order = src.eps.map(function (_, i) { return i; });
      if (st.reverse) order.reverse();
      var frag = document.createDocumentFragment();
      order.forEach(function (i) {
        var ep = src.eps[i];
        var played = hist && hist.src === st.src && hist.ep === i;
        frag.appendChild(h('div.ep.focusable' + (played ? '.active' : ''), {
          text: ep.name, title: ep.name,
          onclick: function () {
            var resume = hist && hist.src === st.src && hist.ep === i ? hist.time : 0;
            play(st.src, i, resume);
          }
        }));
      });
      eps.appendChild(frag);
    }

    function play(src, ep, time) {
      App.push(PlayerView({
        site: site, vod: st.vod, sources: st.sources, parses: st.cfg ? st.cfg.parses : [],
        src: src, ep: ep, time: time || 0
      }));
    }

    function load() {
      if (preview) renderInfo(preview);
      U.clear(epsWrap.lastChild);
      var spin = UI.spinner('正在获取详情…');
      page.appendChild(spin);
      var cfgP = Config.current().then(function (c) { return c && c.cfg; }).catch(function () { return null; });
      Promise.all([Source.detail(site, vodId), cfgP]).then(function (rs) {
        if (spin.parentNode) spin.parentNode.removeChild(spin);
        var vod = rs[0];
        st.cfg = rs[1];
        st.vod = vod;
        st.sources = Source.playSources(vod);
        var hist = PlayHistory.get(site, vodId);
        if (hist && st.sources[hist.src]) st.src = hist.src;
        renderInfo(vod);
        if (!st.sources.length) {
          U.append(actions, UI.message('该影片没有可播放的地址', '搜索同名', function () { App.push(SearchView(vod.vod_name)); }));
          Nav.focusFirst();
          return;
        }
        renderActions();
        renderTabs();
        renderEps();
        if (App.top() === view) Nav.focus(actions.firstChild);
      }).catch(function (err) {
        if (spin.parentNode) spin.parentNode.removeChild(spin);
        U.clear(actions);
        U.append(actions, UI.message('获取详情失败：' + err.message, '重试', function () { U.clear(actions); load(); }));
        if (App.top() === view) Nav.focusFirst();
      });
    }

    var view = {
      el: el,
      onShow: function (first) {
        if (!first && st.vod) {
          // 从播放器返回：刷新"继续播放"和已播放剧集
          var hist = PlayHistory.get(site, vodId);
          if (hist && st.sources[hist.src] && hist.src !== st.src) {
            selectSrc(hist.src);
          } else renderEps();
          renderActions();
          Nav.focus(actions.firstChild);
        }
      }
    };
    load();
    return view;
  };
})(window);
