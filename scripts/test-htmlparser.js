// pdfh / pdfa / pd 语义测试，以及 ES 模块改写测试
const assert = require('assert');
const { pdfh, pdfa, pd, _toJq } = require('../service-src/lib/htmlparser');

const page = `<html><body>
<div class="list">
  <ul>
    <li class="item"><a href="/v/1.html" title="电影一"><img data-original="/img/1.jpg"></a><span class="note">  HD
    </span></li>
    <li class="item"><a href="/v/2.html" title="电影二"><img data-original="https://cdn.x.com/2.jpg"></a><span class="note">更新至5集</span></li>
    <li class="item"><a href="/v/3.html" title="电影三"><img style="background-image:url('/img/3.jpg')"></a><span class="note">完结</span></li>
  </ul>
</div>
<div class="desc">简介<span class="more">更多</span>正文</div>
<a class="m" href="magnet:?xt=abc">磁力</a>
</body></html>`;

assert.strictEqual(_toJq('.list&&ul&&li', false), '.list:eq(0) ul:eq(0) li');
assert.strictEqual(_toJq('.list&&li', true), '.list:eq(0) li:eq(0)');
assert.strictEqual(_toJq('#main&&li:eq(2)', true), '#main li:eq(2)');

const items = pdfa(page, '.list&&ul&&li');
assert.strictEqual(items.length, 3);
assert.strictEqual(pdfh(items[0], 'a&&title'), '电影一');
assert.strictEqual(pdfh(items[0], '.note&&Text'), 'HD');
assert.strictEqual(pdfh(items[1], 'span&&Text'), '更新至5集');
assert.strictEqual(pd(items[0], 'a&&href', 'https://site.com/list/'), 'https://site.com/v/1.html');
assert.strictEqual(pd(items[0], 'img&&data-original', 'https://site.com/'), 'https://site.com/img/1.jpg');
assert.strictEqual(pd(items[1], 'img&&data-original', 'https://site.com/'), 'https://cdn.x.com/2.jpg');
assert.strictEqual(pd(items[2], 'img&&style', 'https://site.com/'), 'https://site.com/img/3.jpg');
assert.strictEqual(pd(page, 'a.m&&href', 'https://site.com/'), 'magnet:?xt=abc');

assert.strictEqual(pdfh(page, '.item:eq(-1)&&a&&title'), '电影三');
assert.strictEqual(pdfh(page, '.item:eq(1)&&a&&title'), '电影二');
assert.strictEqual(pdfh(page, '.desc--.more&&Text'), '简介正文');
assert.strictEqual(pdfh(page, '.desc&&Text'), '简介更多正文');
assert.strictEqual(pdfh(page, '.nothing&&Text'), '');
assert.deepStrictEqual(pdfa(page, '.nothing&&li'), []);
assert.ok(pdfh(items[0], 'a&&Html').includes('<img'));
assert.strictEqual(pdfa(page, 'ul&&li:eq(0)').length, 1);

// ES 模块改写（使用构建产物中的 runtime 不方便，这里直接测源码）
// runtime.js 依赖 esbuild 的 .txt 加载器，所以用 require hook 提供文本
require.extensions['.txt'] = (m, f) => { m.exports = require('fs').readFileSync(f, 'utf8'); };
const { _transform } = require('../service-src/lib/runtime');
const t = _transform('import cheerio from"assets://js/lib/cheerio.min.js";import"assets://js/lib/crypto-js.js";import 模板 from"./模板.js";import{gbkTool}from"./gbk.js";var a=1;export default{a:a}');
assert.ok(t.includes('const cheerio = __require("assets://js/lib/cheerio.min.js", "cheerio").default;'));
assert.ok(t.includes('__require("assets://js/lib/crypto-js.js", "");'));
assert.ok(t.includes('const 模板 = __require("./模板.js", "模板").default;'));
assert.ok(t.includes('const {gbkTool} = __require("./gbk.js", "gbkTool");'));
assert.ok(t.includes('__exports.default = {a:a}'));
const t2 = _transform('export function gbkTool(){return 1}\nexport {x as y};');
assert.ok(t2.includes('function gbkTool(){return 1}') && t2.includes('__exports["gbkTool"] = gbkTool;') && t2.includes('__exports["y"] = x;'));

// jinja2
const { render } = require('../service-src/lib/jinja');
const fl = { area: '', year: '2024', by: 'hits' };
assert.strictEqual(render('/show/{{fl.cateId}}-{{fl.area}}-{{fl.by or "time"}}-{{fl.year}}.html', { fl }), '/show/--hits-2024.html');
assert.strictEqual(render('{{fl.area or "全部"}}|{{fl.lang|default("国语")}}', { fl }), '全部|国语');
assert.strictEqual(render('a{% if fl.year %}/year/{{fl.year}}{% endif %}{% if fl.area %}/area/{{fl.area}}{% else %}/all{% endif %}', { fl }), 'a/year/2024/all');
assert.strictEqual(render('{{ missing.deep.x }}x', {}), 'x');
assert.strictEqual(render('{% if fl.by == "hits" %}H{% elif fl.by %}O{% endif %}', { fl }), 'H');

console.log('htmlparser tests passed');
process.exit(0);
