/* 聚合搜索：同时搜索当前订阅里所有可搜索站点，结果边搜边显示 */
(function (global) {
  'use strict';
  var h = U.h;
  var CONCURRENCY = 5;

  global.SearchView = function (initialWord) {
    var input = UI.input('输入片名、演员…，按确认键打开键盘', function (v) { doSearch(v); }, initialWord);
    var searchBtn = UI.button('搜索', function () { doSearch(input.value); }, 'primary');
    var onlyMatch = UI.button('只看标题匹配: 开', function () {
      st.onlyMatch = !st.onlyMatch;
      onlyMatch.textContent = '只看标题匹配: ' + (st.onlyMatch ? '开' : '关');
      if (st.word) doSearch(st.word);
    });
    var bar = h('div.search-bar', { 'data-region': 'search' }, [input, searchBtn, onlyMatch]);
    var words = h('div.chips', { 'data-region': 'words' });
    var status = h('div.search-status');
    var grid = h('div.grid');
    var body = h('div.page.scroll-y', { 'data-region': 'results' }, [words, status, grid]);
    var el = h('div.view', null, [UI.header('搜索'), bar, body]);

    var st = { token: 0, word: '', onlyMatch: true };

    function renderWords() {
      U.clear(words);
      var list = SearchHistory.list();
      if (!list.length) return;
      words.appendChild(h('span.chips-label', { text: '搜索记录' }));
      list.forEach(function (w) {
        words.appendChild(h('div.chip.focusable', { text: w, onclick: function () { input.value = w; doSearch(w); } }));
      });
      words.appendChild(h('div.chip.focusable.danger', {
        text: '清空', onclick: function () { SearchHistory.clear(); renderWords(); Nav.focus(input); }
      }));
    }

    function doSearch(wd) {
      wd = (wd || '').trim();
      if (!wd) {
        Nav.focus(input);
        U.toast('请输入关键词');
        return;
      }
      st.word = wd;
      var token = ++st.token;
      SearchHistory.add(wd);
      U.clear(words);
      U.clear(grid);
      status.textContent = '正在搜索…';

      Config.current().then(function (ctx) {
        if (token !== st.token) return;
        if (!ctx) {
          status.textContent = '还没有添加订阅源';
          return;
        }
        var sites = ctx.cfg.sites.filter(function (s) { return s.searchable; });
        var done = 0, found = 0, failed = 0;
        function update(final) {
          status.textContent = (final ? '搜索完成' : '搜索中 ' + done + '/' + sites.length) +
            '，找到 ' + found + ' 个结果' + (failed ? '（' + failed + ' 个站点失败）' : '');
        }
        update();
        var kw = wd.toLowerCase();
        return U.pool(sites, CONCURRENCY, function (site) {
          return Source.search(site, wd).then(function (list) {
            if (token !== st.token) return;
            if (st.onlyMatch) list = list.filter(function (v) { return v.vod_name.toLowerCase().indexOf(kw) >= 0; });
            var frag = document.createDocumentFragment();
            list.forEach(function (vod) {
              frag.appendChild(UI.vodCard(vod, function () {
                App.push(DetailView(site, vod.vod_id, vod));
              }, { sub: site.name }));
            });
            grid.appendChild(frag);
            found += list.length;
          }, function () { failed++; }).then(function () {
            if (token !== st.token) return;
            done++;
            update();
          });
        }, function () { return token !== st.token; }).then(function () {
          if (token === st.token) update(true);
        });
      }).catch(function (err) {
        if (token === st.token) status.textContent = '搜索失败：' + err.message;
      });
    }

    renderWords();
    if (initialWord) setTimeout(function () { doSearch(initialWord); }, 0);

    return {
      el: el,
      focusSelector: '.input',
      destroy: function () { st.token++; }
    };
  };
})(window);
