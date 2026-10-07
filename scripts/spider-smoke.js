/*
 * 用真实订阅冒烟测试内置 drpy 引擎：
 *   node scripts/spider-smoke.js <订阅地址> [站点数量=10] [搜索词=我的] [起始序号=0]
 * 对每个 drpy2 站点依次执行 home → category → detail → play → search，输出各步结果。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createEngine } = require('../services/engine.js');

const [cfgUrl, limitArg, wordArg, offsetArg] = process.argv.slice(2);
if (!cfgUrl) {
  console.log('用法: node scripts/spider-smoke.js <订阅地址> [站点数量] [搜索词] [起始序号]');
  process.exit(1);
}
const LIMIT = parseInt(limitArg, 10) || 10;
const WORD = wordArg || '我的';
const OFFSET = parseInt(offsetArg, 10) || 0;

// 复用前端的订阅解析逻辑
const ctx = {
  console, URL, setTimeout, clearTimeout, Promise, JSON, escape, decodeURIComponent,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  navigator: { userAgent: 'node' }, location: { protocol: 'file:' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => null, createElement: () => ({}) }
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['util.js', 'store.js', 'http.js', 'config.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8'), ctx, { filename: f });
}

const short = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').slice(0, 40);

(async () => {
  const text = await (await fetch(cfgUrl, { headers: { 'User-Agent': 'okhttp/3.12.0' } })).text();
  const cfg = ctx.Config._normalize(ctx.Config._decode(text), cfgUrl);
  const sites = cfg.sites.filter((s) => s.engine === 'drpy2').slice(OFFSET, OFFSET + LIMIT);
  console.log(`订阅共 ${cfg.total} 个站点，drpy2 ${cfg.sites.filter((s) => s.engine === 'drpy2').length} 个，本次测试 ${sites.length} 个\n`);

  const engine = createEngine({ poolSize: 3 });
  const rows = [];
  async function test(site) {
    const s = { key: site.key, api: site.api, ext: site.ext, extObj: site.extObj };
    const row = { name: site.name.trim(), steps: {} };
    const step = async (name, fn) => {
      const t = Date.now();
      try {
        const r = await fn();
        row.steps[name] = { ok: true, ms: Date.now() - t, info: r };
        return r;
      } catch (e) {
        row.steps[name] = { ok: false, ms: Date.now() - t, info: e.message };
        return null;
      }
    };
    const home = await step('home', async () => {
      const r = await engine.call(s, 'home', [false]);
      const cls = (r && r.class) || [];
      if (!cls.length) throw new Error('无分类');
      return cls;
    });
    let vod = null;
    if (home) {
      const list = await step('category', async () => {
        const r = await engine.call(s, 'category', [String(home[0].type_id), '1', false, {}]);
        if (!r || !r.list || !r.list.length) throw new Error('列表为空');
        return r.list;
      });
      if (list) vod = list[0];
    }
    const searchList = await step('search', async () => {
      const r = await engine.call(s, 'search', [WORD, false, '1'], 30000);
      if (!r || !r.list || !r.list.length) throw new Error('无结果');
      return r.list;
    });
    if (!vod && searchList) vod = searchList[0];
    if (vod) {
      const det = await step('detail', async () => {
        const r = await engine.call(s, 'detail', [String(vod.vod_id)]);
        const v = r && r.list && r.list[0];
        if (!v || !v.vod_play_url) throw new Error('无播放列表');
        return v;
      });
      if (det) {
        const from = det.vod_play_from.split('$$$')[0];
        const ep = det.vod_play_url.split('$$$')[0].split('#')[0];
        const id = ep.includes('$') ? ep.slice(ep.indexOf('$') + 1) : ep;
        await step('play', async () => {
          const r = await engine.call(s, 'play', [from, id, []]);
          if (!r || !r.url) throw new Error('无地址');
          return (r.parse == 1 || r.jx == 1 ? '[需解析] ' : '') + r.url;
        });
      }
    }
    rows.push(row);
    const fmt = (k) => {
      const st = row.steps[k];
      if (!st) return `${k}:-`;
      return `${k}:${st.ok ? '✓' : '✗'}${(st.ms / 1000).toFixed(1)}s`;
    };
    console.log(`${row.name.padEnd(16)} ${['home', 'category', 'detail', 'play', 'search'].map(fmt).join('  ')}`);
    for (const [k, st] of Object.entries(row.steps)) {
      if (!st.ok) console.log(`    ${k} 失败: ${short(st.info)}`);
      else if (k === 'play') console.log(`    play => ${String(st.info).slice(0, 100)}`);
    }
    if (Object.values(row.steps).some((st) => !st.ok)) {
      const logs = await engine.call(s, '__logs', []).catch(() => []);
      const netErr = logs.filter((l) => l.startsWith('[req]'));
      row.netError = netErr.length > 0;
      const tail = netErr.length ? netErr.slice(-2) : logs.filter((l) => /错误|失败|error/i.test(l)).slice(-2);
      tail.forEach((l) => console.log('    日志: ' + l.slice(0, 160)));
    }
  }
  const queue = sites.slice();
  await Promise.all([0, 1, 2].map(async () => {
    while (queue.length) await test(queue.shift());
  }));

  const pass = (k) => rows.filter((r) => r.steps[k] && r.steps[k].ok).length;
  console.log(`\n汇总（${rows.length} 个站点）: home ${pass('home')}  category ${pass('category')}  detail ${pass('detail')}  play ${pass('play')}  search ${pass('search')}`);
  const direct = rows.filter((r) => r.steps.play && r.steps.play.ok && !String(r.steps.play.info).startsWith('[需解析]')).length;
  console.log(`play 直接得到地址: ${direct}，需解析/嗅探: ${pass('play') - direct}`);
  const failed = rows.filter((r) => !(r.steps.home && r.steps.home.ok));
  console.log(`首页失败 ${failed.length} 个，其中网络错误（网站失效/拦截）${failed.filter((r) => r.netError).length} 个`);
  engine.destroy();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
