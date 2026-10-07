// 在 Node 中对订阅解析和播放列表拆分做冒烟测试：npm test
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const store = {};
const ctx = {
  console, URL, setTimeout, clearTimeout, Promise, JSON,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  escape, decodeURIComponent,
  navigator: { userAgent: 'node' },
  location: { protocol: 'file:' },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  document: { getElementById: () => null, createElement: () => ({}) }
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['util.js', 'store.js', 'http.js', 'config.js', 'source.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8'), ctx, { filename: f });
}
const { Config, Source } = ctx;

// 1. 注释 + 尾逗号 + 相对路径
const raw = `{
  // 注释
  "spider": "./jar/a.jar",
  "sites": [
    {"key":"a","name":"量子","type":1,"api":"https://cj.example.com/api.php/provide/vod/", /* 块注释 */ },
    {"key":"b","name":"XML","type":0,"api":"./api.php?ac=list"},
    {"key":"c","name":"爬虫","type":3,"api":"csp_Xxx"},
    {"key":"a","name":"重名","type":1,"api":"http://x.com/api", "searchable":0},
  ],
  "parses":[{"name":"json","type":1,"url":"https://jx.example.com/?url="},{"name":"web","type":0,"url":"https://w.example.com/?url="}],
}`;
let cfg = Config._normalize(Config._decode(raw), 'https://host.example.com/tv/config.json');
assert.strictEqual(cfg.sites.length, 3);
assert.strictEqual(cfg.total, 4);
assert.strictEqual(cfg.sites[1].api, 'https://host.example.com/tv/api.php?ac=list');
assert.strictEqual(cfg.sites[2].key, 'a_');
assert.strictEqual(cfg.sites[2].searchable, false);
assert.strictEqual(cfg.parses.length, 1);
assert.strictEqual(cfg.skipped, 1);

// T4：ext 原样保留（对象转 JSON 字符串）
cfg = Config._normalize({ sites: [
  { key: 't', name: 'T4', type: 4, api: 'http://h:5757/api/腾云?pwd=1', ext: '../json/a.json$名' },
  { key: 'o', name: 'T4o', type: 4, api: 'http://h:5757/api/x', ext: { a: 1 } }
] }, 'http://h:5757/config/1');
assert.strictEqual(cfg.sites[0].ext, '../json/a.json$名');
assert.strictEqual(cfg.sites[1].ext, '{"a":1}');

// 2. Base64 / 图片伪装
const json = JSON.stringify({ sites: [{ key: 'x', name: '中文', type: 1, api: 'https://a.com/api' }] });
const b64 = Buffer.from(json, 'utf8').toString('base64');
assert.strictEqual(Config._decode(b64).sites[0].name, '中文');
assert.strictEqual(Config._decode('\x89PNG garbage**' + b64).sites[0].name, '中文');

// 3. 多仓
cfg = Config._normalize({ urls: [{ name: '仓1', url: './a.json' }] }, 'https://h.com/x/');
assert.strictEqual(cfg.multi[0].url, 'https://h.com/x/a.json');

// 4. 播放列表拆分
const srcs = Source.playSources({
  vod_play_from: 'm3u8$$$mp4$$$empty',
  vod_play_url: '第1集$https://a.com/1.m3u8#第2集$https://a.com/2.m3u8#$$$https://b.com/1.mp4$$$'
});
assert.strictEqual(srcs.length, 2);
assert.strictEqual(srcs[0].eps.length, 2);
assert.strictEqual(srcs[0].eps[1].name, '第2集');
assert.strictEqual(srcs[1].eps[0].name, '第1集');
assert.strictEqual(srcs[1].eps[0].url, 'https://b.com/1.mp4');

assert.ok(Source.isDirect('https://a.com/x/index.m3u8?t=1'));
assert.ok(!Source.isDirect('https://v.qq.com/x/cover/abc.html'));

// 5. drpy2（type 3）站点识别，规则路径相对订阅地址
cfg = Config._normalize({ sites: [
  { key: 'd1', name: 'D1', type: 3, api: './lib/drpy2.min.js', ext: './js/快看.js' },
  { key: 'd2', name: 'D2', type: 3, api: 'assets://js/lib/drpy2.min.js', ext: 'https://x.com/r.js' },
  { key: 'j', name: 'Java', type: 3, api: 'csp_XBPQ', ext: './XBPQ/a.json' },
  { key: 'v1', name: 'drpy1', type: 3, api: './lib/drpy.min.js', ext: './js/a.js' }
] }, 'https://h.com/repo/js.json');
assert.strictEqual(cfg.sites.length, 2);
assert.strictEqual(cfg.skipped, 2);
assert.strictEqual(cfg.sites[0].engine, 'drpy2');
assert.strictEqual(cfg.sites[0].api, 'https://h.com/repo/lib/drpy2.min.js');
assert.strictEqual(decodeURIComponent(cfg.sites[0].ext), 'https://h.com/repo/js/快看.js');
assert.strictEqual(cfg.sites[1].api, 'assets://js/lib/drpy2.min.js');

// 6. 播放页提取视频地址
const pages = {
  'https://s.com/play/1.html': '<script>var player_aaaa={"flag":"play","encrypt":0,"url":"https:\/\/cdn.s.com\/v\/index.m3u8","from":"lz"}</script>',
  'https://s.com/play/2.html': '<script>var player_aaaa={"encrypt":2,"url":"' + Buffer.from(escape('https://cdn.s.com/2.m3u8')).toString('base64') + '"}</script>',
  'https://s.com/play/3.html': '<video src="https://a.b/c.mp4?t=1"></video>',
  'https://s.com/play/4.html': '<html>nothing</html>'
};
ctx.Http.get = (u) => Promise.resolve(pages[u]);
(async () => {
  assert.strictEqual(await Source.sniffPage('https://s.com/play/1.html'), 'https://cdn.s.com/v/index.m3u8');
  assert.strictEqual(await Source.sniffPage('https://s.com/play/2.html'), 'https://cdn.s.com/2.m3u8');
  assert.strictEqual(await Source.sniffPage('https://s.com/play/3.html'), 'https://a.b/c.mp4?t=1');
  await assert.rejects(Source.sniffPage('https://s.com/play/4.html'));
  console.log('all parse tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
