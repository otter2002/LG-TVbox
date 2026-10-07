/*
 * 极简 jinja2 渲染（drpy 的 cheerio.jinja2，用于筛选条件拼 URL）。
 * 支持：{{ 表达式 }}、{% if %}/{% elif %}/{% else %}/{% endif %}
 * 表达式：变量与点访问、字符串/数字、or / and / not、== != 比较、过滤器 |default() |safe |trim |lower |upper |string |int |urlencode
 * 未定义的变量按空字符串处理。
 */
'use strict';

const FILTERS = {
  default: (v, d, always) => (v === undefined || v === null || (always && !v) ? d : v),
  d: (v, d, always) => FILTERS.default(v, d, always),
  safe: (v) => v,
  string: (v) => (v == null ? '' : String(v)),
  trim: (v) => String(v == null ? '' : v).trim(),
  lower: (v) => String(v == null ? '' : v).toLowerCase(),
  upper: (v) => String(v == null ? '' : v).toUpperCase(),
  int: (v) => parseInt(v, 10) || 0,
  urlencode: (v) => encodeURIComponent(v == null ? '' : v)
};

// 在字符串字面量之外按分隔符切分
function splitTop(expr, sep) {
  const parts = [];
  let cur = '';
  let q = null;
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (q) {
      cur += c;
      if (c === '\\') { cur += expr[++i] || ''; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === sep && depth === 0 && expr[i + 1] !== sep && expr[i - 1] !== sep) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

// 把 python 风格的运算符替换为 JS（跳过字符串字面量）
function toJs(expr) {
  return expr.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(or|and|not|None|True|False|none|true|false)\b/g, (m, str, kw) => {
    if (str) return str;
    return { or: '||', and: '&&', not: '!', None: 'null', none: 'null', True: 'true', true: 'true', False: 'false', false: 'false' }[kw];
  });
}

const fnCache = new Map();
function compileExpr(expr) {
  let fn = fnCache.get(expr);
  if (fn) return fn;
  const parts = splitTop(expr, '|');
  const base = toJs(parts[0].trim() || 'undefined');
  const filters = parts.slice(1).map((f) => {
    const m = /^\s*(\w+)\s*(?:\(([\s\S]*)\))?\s*$/.exec(f);
    return m ? { name: m[1], args: m[2] ? toJs(m[2]) : '' } : null;
  }).filter(Boolean);
  let body = '(' + base + ')';
  filters.forEach((f) => {
    body = '__f[' + JSON.stringify(f.name) + '] ? __f[' + JSON.stringify(f.name) + '](' + body + (f.args ? ', ' + f.args : '') + ') : ' + body;
  });
  // eslint-disable-next-line no-new-func
  const raw = new Function('__s', '__f', 'with (__s) { return (' + body + '); }');
  fn = (scope) => {
    try {
      return raw(scope, FILTERS);
    } catch (e) {
      return undefined;
    }
  };
  fnCache.set(expr, fn);
  return fn;
}

// 让 with 语句对任何变量名都不抛 ReferenceError
function makeScope(data) {
  return new Proxy(data || {}, {
    has: (t, k) => typeof k === 'string' && k.indexOf('__') !== 0 && !(k in globalThis && !(k in t)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : t[k])
  });
}

function parse(tpl) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  const re = /\{\{([\s\S]*?)\}\}|\{%-?([\s\S]*?)-?%\}/g;
  let last = 0;
  let m;
  const top = () => stack[stack.length - 1];
  const push = (node) => {
    const t = top();
    (t.type === 'if' ? t.branches[t.branches.length - 1].children : t.children).push(node);
  };
  while ((m = re.exec(tpl))) {
    if (m.index > last) push({ type: 'text', value: tpl.slice(last, m.index) });
    last = re.lastIndex;
    if (m[1] !== undefined) {
      push({ type: 'expr', expr: m[1].trim() });
      continue;
    }
    const tag = m[2].trim();
    const kw = tag.split(/\s+/)[0];
    const rest = tag.slice(kw.length).trim();
    if (kw === 'if') {
      const node = { type: 'if', branches: [{ cond: rest, children: [] }] };
      push(node);
      stack.push(node);
    } else if (kw === 'elif' && top().type === 'if') {
      top().branches.push({ cond: rest, children: [] });
    } else if (kw === 'else' && top().type === 'if') {
      top().branches.push({ cond: null, children: [] });
    } else if (kw === 'endif' && top().type === 'if') {
      stack.pop();
    }
  }
  if (last < tpl.length) push({ type: 'text', value: tpl.slice(last) });
  return root;
}

function renderNodes(nodes, scope) {
  let out = '';
  nodes.forEach((n) => {
    if (n.type === 'text') out += n.value;
    else if (n.type === 'expr') {
      const v = compileExpr(n.expr)(scope);
      out += v === undefined || v === null ? '' : String(v);
    } else if (n.type === 'if') {
      const br = n.branches.find((b) => b.cond === null || compileExpr(b.cond)(scope));
      if (br) out += renderNodes(br.children, scope);
    }
  });
  return out;
}

const tplCache = new Map();
function render(tpl, data) {
  tpl = String(tpl == null ? '' : tpl);
  if (tpl.indexOf('{') < 0) return tpl;
  let tree = tplCache.get(tpl);
  if (!tree) {
    tree = parse(tpl);
    tplCache.set(tpl, tree);
  }
  return renderNodes(tree.children, makeScope(data));
}

module.exports = { render };
