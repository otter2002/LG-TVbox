/*
 * 站点接口适配，统一输出 MacCMS 风格的数据：
 *   vod = {vod_id, vod_name, vod_pic, vod_remarks, vod_year, vod_area, type_name,
 *          vod_actor, vod_director, vod_content, vod_play_from, vod_play_url}
 *
 * type 0  XML CMS   api?ac=list | ac=videolist&t=&pg= | ac=videolist&wd= | ac=videolist&ids=
 * type 1  JSON CMS  api?ac=list | ac=detail&t=&pg=    | ac=detail&wd=    | ac=detail&ids=
 * type 4  远程接口  api?filter=true | ac=detail&t=&pg= | wd=&quick=0       | ac=detail&ids= | flag=&play=
 * type 3  drpy2 爬虫：交给内置爬虫引擎执行 home/homeVod/category/detail/search/play
 */
(function (global) {
  'use strict';
  // type 4 的所有请求都会附带 extend=站点 ext（drpy-node 等 T4 服务需要）

  function buildUrl(api, params) {
    var q = Object.keys(params).filter(function (k) {
      return params[k] !== undefined && params[k] !== null && params[k] !== '';
    }).map(function (k) {
      return k + '=' + encodeURIComponent(params[k]);
    }).join('&');
    if (!q) return api;
    if (api.indexOf('?') < 0) return api + '?' + q;
    return api + (/[?&]$/.test(api) ? '' : '&') + q;
  }

  function str(v) { return v == null ? '' : String(v); }

  function normVod(v) {
    return {
      vod_id: str(v.vod_id),
      vod_name: str(v.vod_name),
      // drpy 等会在图片地址后附加 @Referer=... 之类的请求头，浏览器无法使用，去掉
      vod_pic: str(v.vod_pic).replace(/@(Referer|User-Agent|Headers|Cookie)=.*$/i, ''),
      vod_remarks: str(v.vod_remarks),
      vod_year: str(v.vod_year),
      vod_area: str(v.vod_area),
      type_name: str(v.type_name),
      vod_actor: str(v.vod_actor),
      vod_director: str(v.vod_director),
      vod_content: str(v.vod_content || v.vod_blurb),
      vod_play_from: str(v.vod_play_from),
      vod_play_url: str(v.vod_play_url)
    };
  }

  function fromJson(j) {
    j = j || {};
    var list = (Array.isArray(j.list) ? j.list : []).map(normVod).filter(function (v) { return v.vod_id; });
    var page = parseInt(j.page, 10) || 1;
    var pagecount = parseInt(j.pagecount, 10);
    if (!pagecount) pagecount = list.length ? page + 1 : page;
    var classes = (Array.isArray(j['class']) ? j['class'] : []).map(function (c) {
      return { id: str(c.type_id), name: str(c.type_name) };
    }).filter(function (c) { return c.id && c.name; });
    return { classes: classes, list: list, page: page, pagecount: pagecount };
  }

  function fromXml(text) {
    var doc = new DOMParser().parseFromString(text.replace(/^﻿/, '').trim(), 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML 解析失败');
    var classes = [].map.call(doc.querySelectorAll('class > ty'), function (ty) {
      return { id: str(ty.getAttribute('id')), name: ty.textContent.trim() };
    });
    var listEl = doc.querySelector('list');
    var list = [].map.call(doc.querySelectorAll('list > video'), function (v) {
      function t(name) {
        var e = v.getElementsByTagName(name)[0];
        return e ? e.textContent.trim() : '';
      }
      var from = [], urls = [];
      [].forEach.call(v.getElementsByTagName('dd'), function (dd, i) {
        from.push(dd.getAttribute('flag') || ('线路' + (i + 1)));
        urls.push(dd.textContent.trim());
      });
      return {
        vod_id: t('id'), vod_name: t('name'), vod_pic: t('pic'), vod_remarks: t('note'),
        vod_year: t('year'), vod_area: t('area'), type_name: t('type'), vod_actor: t('actor'),
        vod_director: t('director'), vod_content: t('des'),
        vod_play_from: from.join('$$$'), vod_play_url: urls.join('$$$')
      };
    });
    var page = listEl ? parseInt(listEl.getAttribute('page'), 10) || 1 : 1;
    var pagecount = listEl ? parseInt(listEl.getAttribute('pagecount'), 10) || page : page;
    return { classes: classes, list: list, page: page, pagecount: pagecount };
  }

  function request(site, params) {
    if (site.type === 4 && site.ext) params.extend = site.ext;
    var url = buildUrl(site.api, params);
    if (site.type === 0) return Http.get(url).then(fromXml);
    return Http.getJson(url).then(fromJson);
  }

  function filterClasses(site, classes) {
    if (!site.categories || !site.categories.length) return classes;
    var allow = site.categories;
    return classes.filter(function (c) { return allow.indexOf(c.name) >= 0; });
  }

  function tagSite(site, list) {
    list.forEach(function (v) { v.site = site; });
    return list;
  }

  var listAc = function (site) { return site.type === 0 ? 'videolist' : 'detail'; };

  // 调用内置爬虫引擎
  function spider(site, action, args, timeout) {
    return Http.spider({
      site: { key: site.key, api: site.api, ext: site.ext, extObj: !!site.extObj },
      action: action,
      args: args
    }, timeout);
  }

  // 首页：分类 + 推荐列表
  function home(site) {
    if (site.type === 3) {
      var hv = spider(site, 'homeVod', []).catch(function () { return {}; });
      return Promise.all([spider(site, 'home', [false]), hv]).then(function (rs) {
        var r = fromJson(rs[0]);
        return { classes: filterClasses(site, r.classes), list: tagSite(site, fromJson(rs[1]).list) };
      });
    }
    if (site.type === 4) {
      return request(site, { filter: 'true' }).then(function (r) {
        return { classes: filterClasses(site, r.classes), list: tagSite(site, r.list) };
      });
    }
    var cls = request(site, { ac: 'list' });
    var latest = request(site, { ac: listAc(site), pg: 1 }).catch(function () { return { list: [] }; });
    return Promise.all([cls, latest]).then(function (rs) {
      return { classes: filterClasses(site, rs[0].classes), list: tagSite(site, rs[1].list), pagecount: rs[1].pagecount };
    });
  }

  // 分类列表（tid 为空表示"推荐/最新"）
  function category(site, tid, pg) {
    if ((site.type === 4 || site.type === 3) && !tid) return Promise.resolve({ list: [], page: pg, pagecount: 1 });
    if (site.type === 3) {
      return spider(site, 'category', [tid, String(pg), false, {}]).then(function (j) {
        var r = fromJson(j);
        return { list: tagSite(site, r.list), page: r.page, pagecount: r.pagecount };
      });
    }
    return request(site, { ac: listAc(site), t: tid, pg: pg }).then(function (r) {
      return { list: tagSite(site, r.list), page: r.page, pagecount: r.pagecount };
    });
  }

  function search(site, wd) {
    if (site.type === 3) {
      return spider(site, 'search', [wd, false, '1'], 30000).then(function (j) { return tagSite(site, fromJson(j).list); });
    }
    var params = site.type === 4 ? { wd: wd, quick: 0, pg: 1 } : { ac: listAc(site), wd: wd };
    return request(site, params).then(function (r) { return tagSite(site, r.list); });
  }

  function detail(site, id) {
    var p = site.type === 3
      ? spider(site, 'detail', [id]).then(fromJson)
      : request(site, { ac: listAc(site), ids: id });
    return p.then(function (r) {
      if (!r.list.length) throw new Error('没有找到影片详情');
      var vod = r.list[0];
      vod.site = site;
      return vod;
    });
  }

  // 拆分播放列表：[{name: '线路', eps: [{name, url}]}]
  function playSources(vod) {
    var froms = vod.vod_play_from ? vod.vod_play_from.split('$$$') : [];
    var urls = vod.vod_play_url ? vod.vod_play_url.split('$$$') : [];
    var out = [];
    urls.forEach(function (group, i) {
      var eps = group.split('#').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s, j) {
        var k = s.indexOf('$');
        var name = k >= 0 ? s.slice(0, k).trim() : '';
        var url = k >= 0 ? s.slice(k + 1).trim() : s;
        return { name: name || ('第' + (j + 1) + '集'), url: url };
      }).filter(function (ep) { return ep.url; });
      if (eps.length) out.push({ name: (froms[i] || ('线路' + (i + 1))).trim(), eps: eps });
    });
    return out;
  }

  var DIRECT_RE = /\.(m3u8|mp4|m4v|flv|mkv|mov|webm|ts|mpd)(\?|#|$)|\/m3u8(\?|\/|$)/i;
  function isDirect(url) { return DIRECT_RE.test(url); }
  var OFFICIAL_RE = /\b(iqiyi|qq|youku|mgtv|bilibili|sohu|le|pptv|1905|miguvideo)\.com\//i;

  // 使用 JSON 解析接口，返回 {url}
  function jsonParse(prefix, url) {
    return Http.getJson(prefix + url, { timeout: 15000 }).then(function (j) {
      var u = j && (j.url || (j.data && j.data.url));
      if (!u || !/^https?:\/\//i.test(u)) throw new Error('解析失败');
      return u;
    });
  }

  // 从播放页中提取视频地址（替代安卓端的"嗅探"）：
  // 苹果CMS 播放页的 player_aaaa={...} 变量，或页面里直接出现的 m3u8/mp4 地址
  function sniffPage(pageUrl) {
    return Http.get(pageUrl, { timeout: 15000 }).then(function (html) {
      var m = /player_[a-z0-9_]+\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i.exec(html);
      if (m) {
        try {
          var p = JSON.parse(m[1]);
          var u = str(p.url);
          if (String(p.encrypt) === '1') u = unescape(u);
          else if (String(p.encrypt) === '2') u = unescape(atob(u));
          if (isDirect(u)) return U.resolveUrl(u, pageUrl);
        } catch (e) {}
      }
      // 兼容 JSON 里转义的 https:\/\/xxx.m3u8
      var m2 = /https?:(?:\\?\/){2}[^"'\s<>]+?\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/i.exec(html);
      if (m2) return m2[0].replace(/\\\//g, '/');
      throw new Error('页面中未找到视频地址');
    });
  }

  // 处理 type 3/4 的 play 返回值 {parse, jx, url, playUrl}
  function handlePlayResult(j, base, parses) {
    j = j || {};
    var u = U.resolveUrl(str(j.url), base);
    if (j.playUrl) u = j.playUrl + u;
    if (!u) throw new Error('接口没有返回播放地址');
    if ((str(j.parse) === '1' || str(j.jx) === '1') && !isDirect(u)) {
      // 需要解析：先尝试从页面提取，再交给 JSON 解析接口
      return sniffPage(u).catch(function () {
        return parses.length ? tryParses(u, parses) : Promise.reject();
      }).catch(function () {
        if (OFFICIAL_RE.test(u)) throw new Error('该线路是官方平台地址，需要网页解析，电视上无法播放，请换其他线路');
        throw new Error('该线路需要网页嗅探才能播放，暂不支持，请换其他线路');
      });
    }
    return u;
  }

  function tryParses(url, parses) {
    var i = 0;
    function next(lastErr) {
      if (i >= parses.length) return Promise.reject(lastErr || new Error('没有可用的解析接口'));
      var p = parses[i++];
      return jsonParse(p.url, url).catch(next);
    }
    return next();
  }

  // 解析出真正可播放的地址
  function resolvePlay(site, flag, url, parses) {
    parses = parses || [];
    if (site.type === 3) {
      return spider(site, 'play', [flag, url, []]).then(function (j) {
        return handlePlayResult(j, url, parses);
      });
    }
    if (site.type === 4) {
      var params = { flag: flag, play: url };
      if (site.ext) params.extend = site.ext;
      return Http.getJson(buildUrl(site.api, params)).then(function (j) {
        return handlePlayResult(j, site.api, parses);
      });
    }
    if (site.playUrl) {
      return jsonParse(site.playUrl, url).catch(function () {
        return isDirect(url) ? url : tryParses(url, parses);
      });
    }
    if (isDirect(url) || !parses.length) return Promise.resolve(url);
    // 不是直链（例如视频网站页面地址）：交给解析接口；全部失败时仍尝试直接播放
    return tryParses(url, parses).catch(function () { return url; });
  }

  global.Source = {
    home: home,
    category: category,
    search: search,
    detail: detail,
    playSources: playSources,
    resolvePlay: resolvePlay,
    isDirect: isDirect,
    sniffPage: sniffPage,
    typeLabel: function (t) { return t === 0 ? 'XML' : t === 1 ? 'JSON' : t === 3 ? 'JS爬虫' : 'API'; }
  };
})(window);
