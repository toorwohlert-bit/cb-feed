#!/usr/bin/env node
/**
 * 央行购金数据抓取/汇总脚本
 *
 * 输入（任选其一）：
 *  1) cb_config.json 手工/其他脚本维护：
 *     {
 *       "china":  [{"month":"2026-07","tonnes":2298.5}, ...],
 *       "global": [{"quarter":"2026Q2","tonnes":180}, {"quarter":"2026Q3","tonnes":321}]
 *     }
 *  2) 环境变量 CHINA_CSV / GLOBAL_CSV 指向 CSV（month,tonnes / quarter,tonnes）
 *
 * 输出：cb.json
 *   { updated, shift, chinaZeroStreak, globalQ:[prev,last], china:[...], global:[...], note }
 *
 * 规则：中国连续 3 个月增持≈0 且全球最近两个季度净购金 <200 吨 → shift=5，否则 0。
 */
const fs = require('fs');
const path = require('path');

function parseCsv(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).filter(l => !/^month|^quarter/i.test(l))
    .map(l => l.split(',').map(s => s.trim()));
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
}

async function loadSeries() {
  const cfgPath = path.join(process.cwd(), 'cb_config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return { china: cfg.china || [], global: cfg.global || [], src: 'cb_config.json' };
  }
  let china = [];
  let global = [];
  if (process.env.CHINA_CSV) {
    const rows = parseCsv(await fetchText(process.env.CHINA_CSV));
    china = rows.map(r => ({ month: r[0], tonnes: Number(r[1]) })).filter(x => x.month && !isNaN(x.tonnes));
  }
  if (process.env.GLOBAL_CSV) {
    const rows = parseCsv(await fetchText(process.env.GLOBAL_CSV));
    global = rows.map(r => ({ quarter: r[0], tonnes: Number(r[1]) })).filter(x => x.quarter && !isNaN(x.tonnes));
  }
  return { china, global, src: 'CSV' };
}

function compute(china, global) {
  china.sort((a, b) => a.month.localeCompare(b.month));
  const deltas = [];
  for (let i = 1; i < china.length; i++) {
    deltas.push(Number((china[i].tonnes - china[i - 1].tonnes).toFixed(2)));
  }
  let zeroStreak = 0;
  for (let i = deltas.length - 1; i >= 0; i--) {
    if (Math.abs(deltas[i]) < 0.5) zeroStreak++;
    else break;
  }
  global.sort((a, b) => a.quarter.localeCompare(b.quarter));
  const lastTwo = global.slice(-2).map(g => g.tonnes);
  const globalWeak = lastTwo.length >= 2 && lastTwo[0] < 200 && lastTwo[1] < 200;
  const shift = (zeroStreak >= 3 && globalWeak) ? 5 : 0;
  return { zeroStreak, lastTwo, shift };
}

(async () => {
  const { china, global, src } = await loadSeries();
  const { zeroStreak, lastTwo, shift } = compute(china, global);
  const out = {
    updated: new Date().toISOString().slice(0, 10),
    shift,
    chinaZeroStreak: zeroStreak,
    globalQ: lastTwo,
    source: src,
    note: shift === 5
      ? '中国连续3个月零增持且全球两季净购金<200吨：R2档位整体+5pp'
      : '央行购金维持节奏：R2维持8/15/22/30档',
    china,
    global
  };
  const p = path.join(process.cwd(), 'cb.json');
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log('written', p);
  console.log(JSON.stringify({ shift, chinaZeroStreak: zeroStreak, globalQ: lastTwo }, null, 2));
})();
