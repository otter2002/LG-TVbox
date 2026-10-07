/*
 * drpy2 运行时：在 vm 沙箱中加载 drpy2 引擎和站点规则，并提供安卓 TVBox 的宿主环境。
 *
 * 宿主函数：req（同步请求）、pdfh/pdfa/pd（网页解析）、joinUrl、local（持久存储）
 * 内置库：cheerio（含 jp = JSONPath）、CryptoJS、JSON5、pako
 * drpy2 是 ES 模块：这里把 import/export 改写成 __require/__exports 后在沙箱里执行。
 * 引擎 import 的地址失效时，按变量名回退到内置副本（模板、gbkTool）。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const { JSONPath } = require('jsonpath-plus');
const JSON5 = require('json5');
const pako = require('pako');
const html = require('./htmlparser');
const jinja = require('./jinja');
const { syncFetch } = require('./syncfetch');

const VENDOR = {
  drpy2: require('../vendor/drpy2.min.txt'),
  muban: require('../vendor/muban.txt'),
  gbk: require('../vendor/gbk.txt')
};

const DEBUG = !!process.env.TVBOX_DEBUG;
const TEXT_TTL = 30 * 60 * 1000;
const MAX_INSTANCES = 12;
const LIB_UA = 'okhttp/3.12.0';

const CHEERIO_SHIM = {
  load: cheerio.load,
  jp: (p, json) => JSONPath({ path: p, json, wrap: true }),
  jinja2: (tpl, data) => jinja.render(tpl, data)
};

// ---------------- 文本缓存（引擎、依赖库、规则文件） ----------------
const textCache = new Map();
function fetchText(url) {
  const c = textCache.get(url);
  if (c && Date.now() - c.t < TEXT_TTL) return c.text;
  const r = syncFetch(url, { timeout: 15000, headers: { 'User-Agent': LIB_UA } });
  const ok = r.code >= 200 && r.code < 400 && r.content && !/^\s*<(!doctype|html)/i.test(r.content);
  const text = ok ? r.content : null;
  textCache.set(url, { text, t: Date.now() });
  return text;
}

// ---------------- local 持久存储 ----------------
const LOCAL_FILE = path.join(os.tmpdir(), 'tvbox-drpy-local.json');
let localData = null;
let localTimer = null;
function localStore() {
  if (!localData) {
    try { localData = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch (e) { localData = {}; }
  }
  return localData;
}
function localSave() {
  clearTimeout(localTimer);
  localTimer = setTimeout(() => {
    try { fs.writeFileSync(LOCAL_FILE, JSON.stringify(localData)); } catch (e) {}
  }, 500);
}
const LOCAL = {
  get: (rkey, k) => {
    const s = localStore()[rkey];
    return s && s[k] != null ? s[k] : '';
  },
  set: (rkey, k, v) => {
    const d = localStore();
    (d[rkey] = d[rkey] || {})[k] = String(v);
    localSave();
  },
  delete: (rkey, k) => {
    const d = localStore();
    if (d[rkey]) delete d[rkey][k];
    localSave();
  }
};

// ---------------- ES 模块改写 ----------------
const NAME = '[\\p{L}\\p{N}_$]+';
const IMPORT_RE = new RegExp(
  '^\\s*(?:(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/)\\s*)*import\\s*' +
  '(?:(' + NAME + ')\\s*from\\s*|\\{([^}]*)\\}\\s*from\\s*|\\*\\s*as\\s*(' + NAME + ')\\s*from\\s*)?' +
  '(["\'])([^"\']+)\\4\\s*;?', 'u');

function transform(code) {
  code = code.replace(/^﻿/, '');
  let pre = '';
  let m;
  while ((m = IMPORT_RE.exec(code))) {
    const def = m[1], named = m[2], ns = m[3], spec = m[5];
    const hint = JSON.stringify(def || ns || (named || '').trim());
    const call = '__require(' + JSON.stringify(spec) + ', ' + hint + ')';
    if (def) pre += 'const ' + def + ' = ' + call + '.default;\n';
    else if (named) pre += 'const {' + named.replace(/\s+as\s+/g, ': ') + '} = ' + call + ';\n';
    else if (ns) pre += 'const ' + ns + ' = ' + call + ';\n';
    else pre += call + ';\n';
    code = code.slice(m[0].length);
  }
  let post = '';
  code = code.replace(/(^|[;\n}])\s*export\s+default\s*/, '$1__exports.default = ');
  code = code.replace(new RegExp('(^|[;\\n}])\\s*export\\s+(function\\*?|class|const|let|var)\\s+(' + NAME + ')', 'gu'),
    (all, p, kw, name) => {
      post += '__exports[' + JSON.stringify(name) + '] = ' + name + ';\n';
      return p + kw + ' ' + name;
    });
  code = code.replace(/(^|[;\n}])\s*export\s*\{([^}]*)\}\s*;?/g, (all, p, list) => {
    list.split(',').map((s) => s.trim()).filter(Boolean).forEach((item) => {
      const parts = item.split(/\s+as\s+/);
      post += '__exports[' + JSON.stringify(parts[1] || parts[0]) + '] = ' + parts[0] + ';\n';
    });
    return p;
  });
  return pre + code + '\n' + post;
}

const scriptCache = new Map();
function evalModule(inst, id, code) {
  let script = scriptCache.get(id);
  if (!script || script.__len !== code.length) {
    // ES 模块是严格模式；否则规则里 eval 出的 var 会与外层 let 冲突
    script = new vm.Script('(function (__require, __exports) {\'use strict\';\n' + transform(code) + '\n})', { filename: id });
    script.__len = code.length;
    scriptCache.set(id, script);
  }
  const fn = script.runInContext(inst.ctx);
  const exportsObj = {};
  fn((spec, hint) => requireFrom(inst, id, spec, hint || ''), exportsObj);
  return exportsObj;
}

function requireFrom(inst, baseId, spec, hint) {
  const s = spec.toLowerCase();
  if (s.includes('cheerio')) return { default: CHEERIO_SHIM };
  if (s.includes('crypto-js')) return { default: CryptoJS };
  if (s.includes('json5')) return { default: JSON5 };
  if (s.includes('pako')) return { default: pako };

  let abs = null;
  if (/^https?:\/\//i.test(spec)) abs = spec;
  else if (/^\.{0,2}\//.test(spec) && /^https?:\/\//i.test(baseId)) abs = new URL(spec, baseId).href;

  let id = abs;
  let code = abs ? fetchText(abs) : null;
  if (!code) {
    const key = hint + ' ' + spec;
    if (/模板|muban/i.test(key)) { id = 'vendor:muban'; code = VENDOR.muban; }
    else if (/gbk/i.test(key)) { id = 'vendor:gbk'; code = VENDOR.gbk; }
    else {
      inst.console.log('[drpy] 跳过无法加载的依赖: ' + spec);
      return {};
    }
  }
  if (inst.modules.has(id)) return inst.modules.get(id);
  const exp = evalModule(inst, id, code);
  inst.modules.set(id, exp);
  return exp;
}

// ---------------- 宿主 req ----------------
function hostReq(inst, url, opt) {
  opt = opt || {};
  const method = String(opt.method || 'GET').toUpperCase();
  const headers = Object.assign({}, opt.headers || {});
  const hasCt = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
  let body = null;
  if (opt.data != null) {
    if (typeof opt.data === 'object') {
      if (String(opt.postType || '').toLowerCase() === 'form') {
        body = new URLSearchParams(opt.data).toString();
        if (!hasCt) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        body = JSON.stringify(opt.data);
        if (!hasCt) headers['Content-Type'] = 'application/json';
      }
    } else body = String(opt.data);
  } else if (opt.body != null) body = String(opt.body);

  if (method === 'GET' && inst.extUrl && url === inst.extUrl) {
    const t = fetchText(url);
    if (t) return { content: t, headers: {}, code: 200 };
  }
  const r = syncFetch(url, {
    method,
    headers,
    body: method === 'GET' ? null : body,
    timeout: parseInt(opt.timeout, 10) || 15000,
    redirect: opt.redirect === 0 || opt.redirect === false ? 'manual' : 'follow',
    buffer: parseInt(opt.buffer, 10) || 0
  });
  if (r.error) inst.console.log('[req] ' + url + ' 失败: ' + r.error);
  return { content: r.content || '', headers: r.headers || {}, code: r.code || 0 };
}

// ---------------- 实例 ----------------
// 每个站点保留最近的日志，便于排查（action "__logs" 可取回）
const siteLogs = new Map();
function makeConsole(key) {
  let ring = siteLogs.get(key);
  if (!ring) siteLogs.set(key, (ring = []));
  const out = (...a) => {
    let line;
    try {
      line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ').slice(0, 300);
    } catch (e) {
      line = String(a[0]);
    }
    ring.push(line);
    if (ring.length > 60) ring.shift();
    if (DEBUG) process.stdout.write('[' + key + '] ' + line + '\n');
  };
  return { log: out, info: out, warn: out, error: out, debug: out };
}

function createInstance(site) {
  const inst = { key: site.key, modules: new Map(), console: makeConsole(site.key), extUrl: null };
  inst.ctx = vm.createContext({
    console: inst.console,
    req: (url, opt) => hostReq(inst, url, opt),
    local: LOCAL,
    pdfh: html.pdfh,
    pdfa: html.pdfa,
    pd: html.pd,
    joinUrl: html.urljoin,
    CryptoJS,
    JSON5,
    pako,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, TextEncoder, TextDecoder,
    atob: (s) => Buffer.from(String(s), 'base64').toString('latin1'),
    btoa: (s) => Buffer.from(String(s), 'latin1').toString('base64')
  });

  let libId = site.api;
  let code = /^https?:\/\//i.test(libId) ? fetchText(libId) : null;
  if (!code) {
    libId = 'vendor:drpy2';
    code = VENDOR.drpy2;
  }
  const exp = evalModule(inst, libId, code);
  const sp = exp.default || exp;
  if (!sp || typeof sp.init !== 'function') throw new Error('爬虫引擎加载失败');

  let ext = site.ext;
  if (site.extObj) {
    try { ext = JSON.parse(ext); } catch (e) {}
  }
  if (typeof ext === 'string' && /^https?:\/\//i.test(ext)) inst.extUrl = ext;
  sp.init(ext);
  inst.sp = sp;
  return inst;
}

const instances = new Map();
function getInstance(site) {
  const id = site.key + '|' + site.api + '|' + site.ext;
  let inst = instances.get(id);
  if (inst) {
    instances.delete(id);
  } else {
    inst = createInstance(site);
    if (instances.size >= MAX_INSTANCES) instances.delete(instances.keys().next().value);
  }
  instances.set(id, inst);
  return inst;
}

async function call(site, action, args) {
  if (action === '__logs') return (siteLogs.get(site.key) || []).slice();
  const inst = getInstance(site);
  const fn = inst.sp[action];
  if (typeof fn !== 'function') throw new Error('该站点不支持: ' + action);
  let r = fn.apply(inst.sp, args || []);
  if (r && typeof r.then === 'function') r = await r;
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch (e) {}
  }
  return r == null ? null : JSON.parse(JSON.stringify(r));
}

module.exports = { call, _transform: transform };
