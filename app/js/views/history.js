/* 播放记录 */
(function (global) {
  'use strict';
  var h = U.h;

  global.HistoryView = function () {
    var grid = h('div.grid');
    var clearBtn = UI.button('清空记录', function () {
      PlayHistory.clear();
      render();
      U.toast('已清空播放记录');
    }, 'danger');
    var body = h('div.page.scroll-y', { 'data-region': 'history' }, grid);
    var el = h('div.view', null, [UI.header('播放记录', clearBtn), body]);

    function render() {
      U.clear(grid);
      var list = PlayHistory.list();
      if (!list.length) {
        U.append(grid, UI.message('还没有播放记录'));
        return;
      }
      list.forEach(function (it) {
        var vod = { vod_id: it.vodId, vod_name: it.name, vod_pic: it.pic, vod_remarks: it.epName };
        var progress = it.duration ? it.time / it.duration : null;
        grid.appendChild(UI.vodCard(vod, function () {
          App.push(DetailView(it.site, it.vodId, vod));
        }, { sub: it.site.name + ' · ' + U.fmtTime(it.time), progress: progress }));
      });
    }

    render();
    return {
      el: el,
      focusSelector: '.card',
      onShow: function (first) {
        if (!first) {
          render();
          Nav.focusFirst('.card');
        }
      }
    };
  };
})(window);
