/*
 * drpy 宿主函数 pdfh / pdfa / pd 的实现（对应安卓 TVBox 中基于 jsoup 的原生实现）。
 *
 * 规则语法：
 *   "选择器1&&选择器2&&属性"   && 表示逐级向下选择，最后一段是取值方式
 *   取值方式：Text（规范化文本）/ Html（内部 HTML）/ 任意属性名（href、data-original、style…）
 *   选择器可带 :eq(n)（支持负数）、--排除选择器（如 "div--span"）
 *   pdfh 每一级默认取第一个元素（自动补 :eq(0)）；pdfa 最后一级返回全部元素的 outerHTML
 */
'use strict';
const cheerio = require('cheerio');

const NOADD_INDEX = /:eq|:lt|:gt|:first|:last|^body$|^#/;
const URLJOIN_ATTR = /(url|src|href|-original|-src|-play|-url|style)$|^(data-|url-|src-)/i;
const SPECIAL_URL = /^(ftp|magnet|thunder|ws):/i;

// drpy 会对同一段 HTML 连续调用多次 pdfh，缓存最近一次的解析结果
let lastHtml = null;
let lastDoc = null;
function load(html) {
  if (html !== lastHtml) {
    lastDoc = cheerio.load(html);
    lastHtml = html;
  }
  return lastDoc;
}

function normText(s) {
  return String(s || '').replace(/[\s ]+/g, ' ').trim();
}

// 把 "a&&b&&c" 转成 "a:eq(0) b:eq(0) c"（first=true 时最后一级也补 :eq(0)）
function toJq(parse, first) {
  if (parse.includes('&&')) {
    const parts = parse.split('&&');
    return parts.map((p, i) => {
      const last = p.split(' ').pop();
      return !NOADD_INDEX.test(last) && (first || i < parts.length - 1) ? p + ':eq(0)' : p;
    }).join(' ');
  }
  const last = parse.split(' ').pop();
  return !NOADD_INDEX.test(last) && first ? parse + ':eq(0)' : parse;
}

function stepInfo(step) {
  let rule = step;
  let index = null;
  let excludes = null;
  if (step.includes(':eq')) {
    rule = step.split(':')[0];
    let pos = step.split(':')[1];
    if (rule.includes('--')) {
      const rs = rule.split('--');
      excludes = rs.slice(1);
      rule = rs[0];
    } else if (pos.includes('--')) {
      const rs = pos.split('--');
      excludes = rs.slice(1);
      pos = rs[0];
    }
    index = parseInt(pos.replace('eq(', '').replace(')', ''), 10) || 0;
  } else if (step.includes('--')) {
    const rs = step.split('--');
    excludes = rs.slice(1);
    rule = rs[0];
  }
  return { rule, index, excludes };
}

function selectStep($, ret, step) {
  const info = stepInfo(step);
  let els;
  if (!ret) {
    els = $(info.rule);
  } else {
    // jsoup 的 select 会把元素自身也纳入匹配
    els = ret.filter(info.rule).add(ret.find(info.rule));
  }
  if (info.index !== null) {
    els = els.eq(info.index < 0 ? els.length + info.index : info.index);
  }
  if (info.excludes && els.length) {
    els = els.clone();
    info.excludes.forEach((ex) => els.find(ex).remove());
  }
  return els;
}

function urljoin(base, rel) {
  try {
    return new URL(rel, base).href;
  } catch (e) {
    return rel;
  }
}

function parseDomForUrl(html, rule, addUrl) {
  if (!html || !rule) return '';
  html = String(html);
  const $ = load(html);
  if (rule === 'body&&Text' || rule === 'Text') return normText($.root().text());
  if (rule === 'body&&Html' || rule === 'Html') return $.html();
  let option = '';
  if (rule.includes('&&')) {
    const rs = rule.split('&&');
    option = rs.pop();
    rule = rs.join('&&');
  }
  rule = toJq(rule, true);
  let ret = null;
  for (const step of rule.split(' ').filter(Boolean)) {
    ret = selectStep($, ret, step);
    if (!ret.length && option) return '';
  }
  if (!ret) return '';
  if (!option) return ret.toArray().map((e) => $.html(e)).join('\n');
  if (option === 'Text') return ret.toArray().map((e) => normText($(e).text())).filter(Boolean).join(' ');
  if (option === 'Html') return ret.toArray().map((e) => $(e).html()).join('\n');

  let result = '';
  for (const e of ret.toArray()) {
    const v = $(e).attr(option);
    if (v !== undefined) {
      result = v;
      break;
    }
  }
  if (/style/i.test(option) && result.includes('url(')) {
    const m = result.match(/url\((.*?)\)/);
    if (m) result = m[1].replace(/^['"]|['"]$/g, '');
  }
  if (result && addUrl && URLJOIN_ATTR.test(option) && !SPECIAL_URL.test(result)) {
    result = result.includes('http') ? result.slice(result.indexOf('http')) : urljoin(addUrl, result);
  }
  return result;
}

function parseDomForArray(html, rule) {
  if (!html || !rule) return [];
  const $ = load(String(html));
  rule = toJq(rule, false);
  let ret = null;
  for (const step of rule.split(' ').filter(Boolean)) {
    ret = selectStep($, ret, step);
    if (!ret.length) return [];
  }
  return ret ? ret.toArray().map((e) => $.html(e)) : [];
}

module.exports = {
  pdfh: (html, rule) => parseDomForUrl(html, rule, ''),
  pdfa: (html, rule) => parseDomForArray(html, rule),
  pd: (html, rule, baseUrl) => parseDomForUrl(html, rule, baseUrl || ''),
  urljoin,
  _toJq: toJq
};
