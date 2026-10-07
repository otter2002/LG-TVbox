/*
 * webOS JS 服务：替前端发 HTTP 请求（无 CORS 限制，可带浏览器 UA、自动跟随重定向、解压 gzip）。
 * 调用：luna://com.lgwebos.tvbox.service/fetch  {url, timeout}
 * 返回：{returnValue, status, body} 或 {returnValue:false, errorText}
 *
 * 注意：老款电视的 Node 版本很旧（webOS 4 为 Node 0.12），这里只用 ES5 语法和内置模块。
 */
var Service = require('webos-service');
var http = require('http');
var https = require('https');
var zlib = require('zlib');
var urlLib = require('url');

var service = new Service('com.lgwebos.tvbox.service');
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
var MAX_BYTES = 20 * 1024 * 1024;

function fetchUrl(target, timeout, redirects, cb) {
  var done = false;
  function finish(err, res) {
    if (done) return;
    done = true;
    cb(err, res);
  }

  var u = urlLib.parse(target);
  var mod = u.protocol === 'https:' ? https : http;
  var req = mod.request({
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port,
    path: u.path,
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Encoding': 'gzip, deflate' },
    // 老电视的根证书往往过期，否则大量 https 站点无法访问
    rejectUnauthorized: false
  }, function (res) {
    var loc = res.headers.location;
    if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirects < 5) {
      res.resume();
      return fetchUrl(urlLib.resolve(target, loc), timeout, redirects + 1, finish);
    }
    var stream = res;
    var enc = (res.headers['content-encoding'] || '').toLowerCase();
    if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
    else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
    var chunks = [];
    var size = 0;
    stream.on('data', function (c) {
      size += c.length;
      if (size > MAX_BYTES) {
        req.abort();
        return finish(new Error('response too large'));
      }
      chunks.push(c);
    });
    stream.on('end', function () {
      finish(null, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
    });
    stream.on('error', finish);
  });
  req.on('error', finish);
  req.setTimeout(timeout, function () {
    req.abort();
    finish(new Error('timeout'));
  });
  req.end();
}

service.register('fetch', function (message) {
  var p = message.payload || {};
  if (typeof p.url !== 'string' || !/^https?:\/\//i.test(p.url)) {
    return message.respond({ returnValue: false, errorText: 'invalid url' });
  }
  fetchUrl(p.url, p.timeout || 15000, 0, function (err, res) {
    if (err) message.respond({ returnValue: false, errorText: err.message });
    else message.respond({ returnValue: true, status: res.status, body: res.body });
  });
});

/*
 * 内置爬虫引擎（drpy2 等 JS 爬虫）。需要 webOS TV 22+（Node 12+），推荐 webOS 24+。
 * 调用：luna://com.lgwebos.tvbox.service/spider  {site:{key,api,ext,extObj}, action, args, timeout}
 * 返回：{returnValue:true, data} 或 {returnValue:false, errorText}
 */
var engine = null;
var keepAlive = null;
var idleTimer = null;
var IDLE_MS = 10 * 60 * 1000;

function getEngine() {
  if (!engine) engine = require('./engine.js').createEngine({ poolSize: 3 });
  return engine;
}

// 有爬虫调用时保持服务常驻（引擎缓存了站点实例），空闲 10 分钟后释放
function touchKeepAlive() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(function () {
    if (keepAlive) {
      try { service.activityManager.complete(keepAlive, function () {}); } catch (e) {}
      keepAlive = null;
    }
    if (engine) {
      engine.destroy();
      engine = null;
    }
  }, IDLE_MS);
  if (!keepAlive) {
    try {
      service.activityManager.create('keepAlive', function (activity) { keepAlive = activity; });
    } catch (e) {}
  }
}

service.register('spider', function (message) {
  var p = message.payload || {};
  var eng;
  try {
    eng = getEngine();
  } catch (e) {
    return message.respond({ returnValue: false, errorText: '当前电视系统不支持内置爬虫引擎：' + e.message });
  }
  touchKeepAlive();
  eng.call(p.site, p.action, p.args || [], p.timeout).then(function (data) {
    message.respond({ returnValue: true, data: data });
  }, function (err) {
    message.respond({ returnValue: false, errorText: err.message });
  });
});
