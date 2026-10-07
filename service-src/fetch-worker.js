/*
 * 请求线程：替爬虫线程发 HTTP 请求。爬虫线程用 Atomics.wait 同步等待结果，
 * 这样 drpy 里同步写法的 req() 才能工作。
 */
'use strict';
const { workerData } = require('worker_threads');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const iconv = require('iconv-lite');

const { port, sab } = workerData;
const signal = new Int32Array(sab);
const MAX_BYTES = 30 * 1024 * 1024;
const agentOpts = { keepAlive: true, maxSockets: 8 };
const httpAgent = new http.Agent(agentOpts);
// 很多影视站证书不规范，和安卓端行为保持一致：不校验证书
const httpsAgent = new https.Agent(Object.assign({ rejectUnauthorized: false }, agentOpts));

function charsetOf(contentType) {
  const m = /charset=["']?([\w-]+)/i.exec(contentType || '');
  return m ? m[1].toLowerCase() : '';
}

function decodeBody(buf, resHeaders, reqHeaders, mode) {
  if (mode === 2) return buf.toString('base64');
  if (mode === 1) return Array.from(buf);
  let cs = charsetOf(resHeaders['content-type']);
  if (!cs) {
    const reqCt = Object.keys(reqHeaders).find((k) => k.toLowerCase() === 'content-type');
    if (reqCt) cs = charsetOf(reqHeaders[reqCt]);
  }
  if (!cs) {
    const head = buf.subarray(0, 2048).toString('latin1');
    const m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
    if (m) cs = m[1].toLowerCase();
  }
  if (cs && cs !== 'utf-8' && cs !== 'utf8' && iconv.encodingExists(cs)) return iconv.decode(buf, cs);
  return buf.toString('utf8');
}

function request(opts, redirects) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(opts.url);
    } catch (e) {
      return resolve({ code: 0, content: '', headers: {}, error: 'invalid url' });
    }
    const isHttps = u.protocol === 'https:';
    const headers = Object.assign({ 'Accept-Encoding': 'gzip, deflate, br' }, opts.headers || {});
    let body = opts.body;
    if (body != null && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-length')) {
      body = Buffer.from(String(body));
      headers['Content-Length'] = body.length;
    }
    let done = false;
    const finish = (r) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    const req = (isHttps ? https : http).request(u, {
      method: opts.method || 'GET',
      headers,
      agent: isHttps ? httpsAgent : httpAgent
    }, (res) => {
      const loc = res.headers.location;
      if (opts.redirect !== 'manual' && res.statusCode >= 300 && res.statusCode < 400 && loc && redirects < 8) {
        res.resume();
        const next = Object.assign({}, opts, { url: new URL(loc, u).href });
        if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && next.method === 'POST')) {
          next.method = 'GET';
          next.body = null;
        }
        return request(next, redirects + 1).then(finish);
      }
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      let size = 0;
      stream.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy();
          finish({ code: 0, content: '', headers: {}, error: 'response too large' });
        } else chunks.push(c);
      });
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        finish({
          code: res.statusCode,
          headers: res.headers,
          content: decodeBody(buf, res.headers, headers, opts.buffer),
          url: u.href
        });
      });
      stream.on('error', (e) => finish({ code: 0, content: '', headers: {}, error: e.message }));
    });
    req.on('error', (e) => finish({ code: 0, content: '', headers: {}, error: e.message }));
    req.setTimeout(opts.timeout || 15000, () => {
      req.destroy();
      finish({ code: 0, content: '', headers: {}, error: 'timeout' });
    });
    if (body != null) req.write(body);
    req.end();
  });
}

port.on('message', (msg) => {
  request(msg.opts, 0).then((res) => {
    res.id = msg.id;
    port.postMessage(res);
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
  });
});
