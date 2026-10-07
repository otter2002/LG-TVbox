/*
 * 播放器
 *  确认/播放暂停键：暂停/继续     左/右：快退/快进（长按加速）
 *  上/下：打开选集面板             返回：关闭面板 / 退出播放
 *  快进/快退媒体键：±30 秒         播放结束自动下一集
 */
(function (global) {
  'use strict';
  var h = U.h;

  global.PlayerView = function (opts) {
    var site = opts.site, vod = opts.vod, sources = opts.sources, parses = opts.parses || [];
    var video = h('video.video', { preload: 'auto' });
    var title = h('div.p-title');
    var played = h('b'), buffered = h('i'), knob = h('em');
    var bar = h('div.p-bar', null, [buffered, played, knob]);
    var timeCur = h('span'), timeDur = h('span');
    var osd = h('div.p-osd', null, [
      h('div.p-top', null, title),
      h('div.p-bottom', null, [
        bar,
        h('div.p-time', null, [timeCur, h('span.p-hint', { text: '↑↓ 选集 · ←→ 快进快退 · OK 暂停' }), timeDur])
      ])
    ]);
    var msg = h('div.p-msg.hidden');
    var pauseIcon = h('div.p-pause.hidden', { text: '❚❚' });
    var tabs = h('div.tabs.scroll-x', { 'data-region': 'ptabs', 'data-remember': '' });
    var eps = h('div.p-eps.scroll-x', { 'data-region': 'peps', 'data-remember': '' });
    var panel = h('div.ep-panel.hidden', null, [tabs, eps]);
    var el = h('div.view.player', null, [video, osd, pauseIcon, msg, panel]);

    var st = { src: opts.src, ep: opts.ep, token: 0, startAt: opts.time || 0, lastSave: 0, panel: false, seekTarget: null, seekCount: 0, lastSeekKey: 0 };
    var hls = null, osdTimer = null, seekTimer = null;

    function curEp() { return sources[st.src].eps[st.ep]; }

    function showMsg(text, spinner) {
      U.clear(msg);
      if (spinner) msg.appendChild(h('div.spinner'));
      msg.appendChild(h('div', { text: text }));
      msg.classList.remove('hidden');
    }
    function hideMsg() { msg.classList.add('hidden'); }

    function showOsd(sticky) {
      osd.classList.remove('osd-hidden');
      clearTimeout(osdTimer);
      if (!sticky && !video.paused) osdTimer = setTimeout(function () { osd.classList.add('osd-hidden'); }, 4000);
      renderProgress();
    }

    function renderProgress() {
      var d = video.duration;
      var t = st.seekTarget != null ? st.seekTarget : video.currentTime;
      var pct = isFinite(d) && d > 0 ? Math.min(1, t / d) : 0;
      played.style.width = (pct * 100) + '%';
      knob.style.left = (pct * 100) + '%';
      if (isFinite(d) && d > 0 && video.buffered.length) {
        buffered.style.width = Math.min(100, video.buffered.end(video.buffered.length - 1) / d * 100) + '%';
      } else buffered.style.width = '0';
      timeCur.textContent = U.fmtTime(t);
      timeDur.textContent = isFinite(d) ? U.fmtTime(d) : '直播';
    }

    function destroyHls() {
      if (hls) {
        try { hls.destroy(); } catch (e) {}
        hls = null;
      }
    }

    function setSource(url) {
      destroyHls();
      var isM3u8 = /m3u8/i.test(url);
      if (isM3u8 && !video.canPlayType('application/vnd.apple.mpegurl') && !IS_WEBOS) {
        // 电脑浏览器调试时用 hls.js；电视自带 HLS 支持
        return U.loadScript('lib/hls.min.js').then(function () {
          if (global.Hls && global.Hls.isSupported()) {
            hls = new global.Hls({
              // 调试时分片请求同样走 dev-server 代理，避免 CORS
              xhrSetup: function (xhr, u) {
                if (/^https?:$/.test(location.protocol)) xhr.open('GET', '/proxy?url=' + encodeURIComponent(u), true);
              }
            });
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(global.Hls.Events.ERROR, function (_, data) {
              if (data && data.fatal) onError();
            });
          } else video.src = url;
          video.play().catch(function () {});
        }, function () {
          video.src = url;
          video.play().catch(function () {});
        });
      }
      video.src = url;
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    }

    function play(src, ep, startAt) {
      save();
      st.src = src;
      st.ep = ep;
      st.startAt = startAt || 0;
      st.seekTarget = null;
      var token = ++st.token;
      var e = curEp();
      title.textContent = vod.vod_name + '  ·  ' + e.name + (sources.length > 1 ? '  ·  ' + sources[src].name : '');
      video.removeAttribute('src');
      try { video.load(); } catch (err) {}
      showOsd(true);
      showMsg('正在解析播放地址…', true);
      Source.resolvePlay(site, sources[src].name, e.url, parses).then(function (url) {
        if (token !== st.token) return;
        showMsg('正在缓冲…', true);
        setSource(url);
      }).catch(function (err) {
        if (token !== st.token) return;
        showMsg('解析失败：' + err.message + '\n按 ↑ 键切换线路或剧集');
      });
      renderPanel();
    }

    function onError() {
      showMsg('播放失败（地址无效或格式不支持）\n按 ↑ 键切换线路或剧集');
      showOsd(true);
    }

    function save(force) {
      if (!sources[st.src]) return;
      var t = video.currentTime || 0;
      if (!force && t < 5) return;
      var d = video.duration;
      PlayHistory.save({
        site: site, vodId: vod.vod_id, name: vod.vod_name, pic: vod.vod_pic,
        src: st.src, ep: st.ep, epName: curEp().name,
        time: isFinite(d) && d > 0 && t > d - 15 ? 0 : t,
        duration: isFinite(d) ? d : 0
      });
    }

    function nextEp() {
      if (st.ep + 1 < sources[st.src].eps.length) {
        play(st.src, st.ep + 1, 0);
        U.toast('自动播放下一集：' + curEp().name);
        return true;
      }
      return false;
    }

    function togglePause() {
      if (video.paused) video.play();
      else video.pause();
    }

    function seek(delta) {
      var d = video.duration;
      if (!isFinite(d) || d <= 0) return;
      var now = Date.now();
      st.seekCount = now - st.lastSeekKey < 500 ? st.seekCount + 1 : 0;
      st.lastSeekKey = now;
      var step = st.seekCount < 6 ? 10 : st.seekCount < 16 ? 30 : 60;
      if (Math.abs(delta) > 10) step = Math.abs(delta);
      if (st.seekTarget == null) st.seekTarget = video.currentTime;
      st.seekTarget = Math.max(0, Math.min(d - 1, st.seekTarget + (delta > 0 ? step : -step)));
      showOsd();
      clearTimeout(seekTimer);
      seekTimer = setTimeout(function () {
        video.currentTime = st.seekTarget;
        st.seekTarget = null;
        renderProgress();
      }, 600);
    }

    // ---------- 选集面板 ----------
    function renderPanel() {
      U.clear(tabs);
      if (sources.length > 1) {
        sources.forEach(function (s, i) {
          tabs.appendChild(h('div.tab.focusable' + (i === st.src ? '.active' : ''), {
            text: s.name,
            onclick: function () {
              var ep = Math.min(st.ep, s.eps.length - 1);
              play(i, ep, st.ep === ep ? video.currentTime : 0);
              closePanel();
            }
          }));
        });
      }
      U.clear(eps);
      sources[st.src].eps.forEach(function (ep, i) {
        eps.appendChild(h('div.ep.focusable' + (i === st.ep ? '.active' : ''), {
          text: ep.name,
          onclick: function () {
            if (i !== st.ep) play(st.src, i, 0);
            closePanel();
          }
        }));
      });
    }

    function openPanel() {
      st.panel = true;
      panel.classList.remove('hidden');
      showOsd(true);
      Nav.setRoot(panel);
      Nav.focusFirst('.ep.active');
    }

    function closePanel() {
      st.panel = false;
      panel.classList.add('hidden');
      Nav.setRoot(el);
      showOsd();
    }

    // ---------- 视频事件 ----------
    video.addEventListener('loadedmetadata', function () {
      if (st.startAt > 5 && isFinite(video.duration) && st.startAt < video.duration - 10) {
        video.currentTime = st.startAt;
      }
      st.startAt = 0;
      renderProgress();
    });
    video.addEventListener('waiting', function () { showMsg('缓冲中…', true); });
    video.addEventListener('playing', function () { hideMsg(); pauseIcon.classList.add('hidden'); showOsd(); });
    video.addEventListener('pause', function () { if (!video.ended) { pauseIcon.classList.remove('hidden'); showOsd(true); } save(); });
    video.addEventListener('timeupdate', function () {
      if (!osd.classList.contains('osd-hidden')) renderProgress();
      var now = Date.now();
      if (now - st.lastSave > 10000) {
        st.lastSave = now;
        save();
      }
    });
    video.addEventListener('ended', function () {
      save(true);
      if (!nextEp()) {
        showMsg('已播放完毕');
        showOsd(true);
      }
    });
    video.addEventListener('error', function () {
      if (video.getAttribute('src') && !hls) onError();
    });
    el.addEventListener('click', function (e) {
      if (e.target === video) togglePause();
    });

    function onKey(e, k) {
      if (st.panel) {
        if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { closePanel(); return true; }
        return false; // 方向键/确认交给默认导航
      }
      switch (k) {
        case KEY.ENTER: case KEY.PLAY_PAUSE: togglePause(); showOsd(); return true;
        case KEY.PLAY: video.play(); return true;
        case KEY.PAUSE: video.pause(); return true;
        case KEY.LEFT: seek(-10); return true;
        case KEY.RIGHT: seek(10); return true;
        case KEY.RW: seek(-30); return true;
        case KEY.FF: seek(30); return true;
        case KEY.UP: case KEY.DOWN: openPanel(); return true;
        case KEY.STOP: App.back(); return true;
        case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE:
          if (osd.classList.contains('osd-hidden') && !video.paused) {
            showOsd();
            U.toast('再按一次返回键退出播放', 2000);
            return true;
          }
          return false; // 交给路由退出
      }
      return false;
    }

    return {
      el: el,
      onKey: onKey,
      onShow: function (first) {
        if (first) play(st.src, st.ep, st.startAt);
      },
      destroy: function () {
        save();
        st.token++;
        clearTimeout(osdTimer);
        clearTimeout(seekTimer);
        destroyHls();
        video.pause();
        video.removeAttribute('src');
        try { video.load(); } catch (e) {}
      }
    };
  };
})(window);
