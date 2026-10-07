/* localStorage 持久化 + 播放记录 + 搜索记录 */
(function (global) {
  'use strict';
  var PREFIX = 'tvbox.';

  var Store = {
    get: function (key, def) {
      try {
        var v = localStorage.getItem(PREFIX + key);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set: function (key, val) {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(val));
      } catch (e) {
        console.warn('Store.set failed', key, e);
      }
    },
    remove: function (key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) {}
    }
  };

  var MAX_HISTORY = 100;
  var History = {
    list: function () { return Store.get('history', []); },
    key: function (site, vodId) { return site.api + '|' + vodId; },
    get: function (site, vodId) {
      var k = History.key(site, vodId);
      return History.list().find(function (it) { return it.key === k; }) || null;
    },
    // item: {site, vodId, name, pic, src, ep, epName, time, duration}
    save: function (item) {
      item.key = History.key(item.site, item.vodId);
      item.ts = Date.now();
      var list = History.list().filter(function (it) { return it.key !== item.key; });
      list.unshift(item);
      Store.set('history', list.slice(0, MAX_HISTORY));
    },
    remove: function (key) {
      Store.set('history', History.list().filter(function (it) { return it.key !== key; }));
    },
    clear: function () { Store.set('history', []); }
  };

  var SearchHistory = {
    list: function () { return Store.get('searchHistory', []); },
    add: function (wd) {
      var list = SearchHistory.list().filter(function (w) { return w !== wd; });
      list.unshift(wd);
      Store.set('searchHistory', list.slice(0, 20));
    },
    clear: function () { Store.set('searchHistory', []); }
  };

  global.Store = Store;
  global.PlayHistory = History;
  global.SearchHistory = SearchHistory;
})(window);
