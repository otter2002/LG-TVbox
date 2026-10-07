/*
 * 订阅源（TVBox 配置）管理与解析。
 *
 * 支持：
 *  - 标准 TVBox JSON（允许 // 和 /* *\/ 注释、尾逗号）
 *  - 整体 Base64，或 "图片 + ** + Base64" 的伪装格式
 *  - 多仓配置 {"urls":[{name,url}]} / {"storeHouse":[{sourceName,sourceUrl}]}
 *
 * 站点类型：0 = XML CMS，1 = JSON CMS，4 = 远程 JSON 接口，
 *          3 = 爬虫：其中 drpy2 JS 源由电视上的内置引擎运行，csp_ Java 源无法支持，会被跳过。
 */
(function (global) {
  'use strict';

  var SUPPORTED_TYPES = [0, 1, 4];
  // type 3 中由内置 drpy2 引擎运行的站点（api 指向 drpy2.min.js）
  var DRPY2_RE = /drpy2(\.min)?\.js(\?|$)/i;
  var memo = {};
  var version = 0; // 订阅/站点变化时递增，供页面判断是否需要刷新

  // 去掉 JSON 中的注释和尾逗号（会跳过字符串内容，不会误伤 http://）
  function cleanJson(s) {
    var out = '', i = 0, n = s.length, inStr = false;
    while (i < n) {
      var c = s.charAt(i);
      if (inStr) {
        out += c;
        if (c === '\\' && i + 1 < n) { out += s.charAt(i + 1); i += 2; continue; }
        if (c === '"') inStr = false;
        i++;
        continue;
      }
      if (c === '"') { inStr = true; out += c; i++; continue; }
      if (c === '/' && s.charAt(i + 1) === '/') {
        while (i < n && s.charAt(i) !== '\n') i++;
        continue;
      }
      if (c === '/' && s.charAt(i + 1) === '*') {
        var e = s.indexOf('*/', i + 2);
        i = e < 0 ? n : e + 2;
        continue;
      }
      if (c === '}' || c === ']') out = out.replace(/,\s*$/, '');
      out += c;
      i++;
    }
    return out;
  }

  function tryParse(text) {
    try { return JSON.parse(text); } catch (e) {}
    try { return JSON.parse(cleanJson(text)); } catch (e) {}
    return null;
  }

  function decode(raw) {
    var text = String(raw || '').replace(/^﻿/, '').trim();
    var json = tryParse(text);
    if (json) return json;

    // 图片伪装：xxx**Base64
    var star = text.lastIndexOf('**');
    if (star >= 0) {
      var tail = text.slice(star + 2).trim();
      if (/^[A-Za-z0-9+/=\s]+$/.test(tail)) {
        json = tryParse(U.b64decode(tail));
        if (json) return json;
      }
    }
    // 纯 Base64
    if (/^[A-Za-z0-9+/=\s]+$/.test(text)) {
      try {
        json = tryParse(U.b64decode(text));
        if (json) return json;
      } catch (e) {}
    }
    if (/^2423/.test(text)) throw new Error('该订阅已加密（AES），暂不支持');
    if (/^\s*</.test(text)) throw new Error('订阅地址返回的是网页而不是配置文件');
    throw new Error('无法解析订阅内容');
  }

  function normalize(json, base) {
    if (!json || typeof json !== 'object') throw new Error('订阅格式不正确');

    if (!Array.isArray(json.sites)) {
      if (Array.isArray(json.urls) && json.urls.length) {
        return {
          multi: json.urls.filter(function (u) { return u && u.url; }).map(function (u) {
            return { name: u.name || '', url: U.resolveUrl(u.url, base) };
          })
        };
      }
      if (Array.isArray(json.storeHouse) && json.storeHouse.length) {
        return {
          multi: json.storeHouse.filter(function (u) { return u && u.sourceUrl; }).map(function (u) {
            return { name: u.sourceName || '', url: U.resolveUrl(u.sourceUrl, base) };
          })
        };
      }
      throw new Error('订阅格式不正确：缺少 sites');
    }

    var keys = {};
    var sites = [];
    var skipped = 0;
    json.sites.forEach(function (s) {
      if (!s || typeof s.api !== 'string') return;
      var type = parseInt(s.type, 10);
      var drpy = type === 3 && DRPY2_RE.test(s.api);
      if (SUPPORTED_TYPES.indexOf(type) < 0 && !drpy) { skipped++; return; }
      var api = /^assets:/i.test(s.api) ? s.api.trim() : U.resolveUrl(s.api.trim(), base);
      if (!/^https?:\/\//i.test(api) && !(drpy && /^assets:/i.test(api))) return;
      var ext = typeof s.ext === 'string' ? s.ext.trim() : (s.ext ? JSON.stringify(s.ext) : '');
      // drpy 规则文件的相对路径相对于订阅地址
      if (drpy && typeof s.ext === 'string' && /^(\.{0,2}\/|https?:)/i.test(ext)) ext = U.resolveUrl(ext, base);
      var key = String(s.key || s.name || api);
      while (keys[key]) key += '_';
      keys[key] = 1;
      sites.push({
        key: key,
        name: String(s.name || key),
        type: type,
        api: api,
        searchable: !(s.searchable === 0 || s.searchable === '0'),
        playUrl: typeof s.playUrl === 'string' ? s.playUrl : '',
        // T4 接口要求把站点 ext 原样作为 extend 参数传回；drpy 则用于加载规则
        ext: ext,
        extObj: !!s.ext && typeof s.ext === 'object',
        engine: drpy ? 'drpy2' : '',
        categories: Array.isArray(s.categories) ? s.categories.map(String) : null
      });
    });

    var parses = (Array.isArray(json.parses) ? json.parses : []).filter(function (p) {
      return p && parseInt(p.type, 10) === 1 && /^https?:\/\//i.test(p.url || '');
    }).map(function (p) {
      return { name: String(p.name || ''), url: p.url };
    });

    return { sites: sites, parses: parses, total: json.sites.length, skipped: skipped, updated: Date.now() };
  }

  function fetchConfig(url) {
    return Http.get(url, { timeout: 20000 }).then(function (text) {
      return normalize(decode(text), url);
    });
  }

  function subs() { return Store.get('subs', []); }
  function saveSubs(list) { Store.set('subs', list); version++; }

  function activeSub() {
    var list = subs();
    var id = Store.get('activeSub');
    return list.find(function (s) { return s.id === id; }) || list[0] || null;
  }

  function setActiveSub(id) {
    Store.set('activeSub', id);
    version++;
  }

  function hostName(url) {
    try { return new URL(url).hostname; } catch (e) { return url; }
  }

  // 添加订阅。多仓配置会拆成多个订阅条目。返回 Promise<{added: [...], cfg}>
  function addSub(url, name) {
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error('请输入以 http:// 或 https:// 开头的地址'));
    return fetchConfig(url).then(function (cfg) {
      var list = subs();
      var added;
      if (cfg.multi) {
        if (!cfg.multi.length) throw new Error('多仓配置中没有可用仓库');
        added = cfg.multi.map(function (m, i) {
          return { id: U.uid(), name: (name ? name + ' - ' : '') + (m.name || ('仓库' + (i + 1))), url: m.url };
        });
      } else {
        added = [{ id: U.uid(), name: name || hostName(url), url: url }];
        memo[added[0].id] = cfg;
        Store.set('cfg.' + added[0].id, cfg);
      }
      saveSubs(list.concat(added));
      setActiveSub(added[0].id);
      return load(added[0]).then(function (c) { return { added: added, cfg: c }; });
    });
  }

  function removeSub(id) {
    saveSubs(subs().filter(function (s) { return s.id !== id; }));
    delete memo[id];
    Store.remove('cfg.' + id);
    Store.remove('site.' + id);
    if (Store.get('activeSub') === id) setActiveSub((subs()[0] || {}).id);
  }

  // 读取订阅配置：内存缓存 -> 本地缓存 -> 网络
  function load(sub, force) {
    if (!force && memo[sub.id]) return Promise.resolve(memo[sub.id]);
    var cached = !force && Store.get('cfg.' + sub.id);
    if (cached && cached.sites) {
      memo[sub.id] = cached;
      return Promise.resolve(cached);
    }
    return fetchConfig(sub.url).then(function (cfg) {
      if (cfg.multi) throw new Error('该地址是多仓配置，请删除后重新添加');
      memo[sub.id] = cfg;
      Store.set('cfg.' + sub.id, cfg);
      version++;
      return cfg;
    });
  }

  function activeSite(cfg, sub) {
    var key = Store.get('site.' + sub.id);
    return cfg.sites.find(function (s) { return s.key === key; }) || cfg.sites[0] || null;
  }

  function setActiveSite(sub, key) {
    Store.set('site.' + sub.id, key);
    version++;
  }

  // 当前订阅的配置；没有订阅时 resolve(null)
  function current() {
    var sub = activeSub();
    if (!sub) return Promise.resolve(null);
    return load(sub).then(function (cfg) {
      return { sub: sub, cfg: cfg, site: activeSite(cfg, sub) };
    });
  }

  global.Config = {
    subs: subs,
    activeSub: activeSub,
    setActiveSub: setActiveSub,
    addSub: addSub,
    removeSub: removeSub,
    load: load,
    current: current,
    activeSite: activeSite,
    setActiveSite: setActiveSite,
    version: function () { return version; },
    // 供测试使用
    _decode: decode,
    _normalize: normalize
  };
})(window);
