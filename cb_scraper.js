#!/usr/bin/env node
/**
 * 央行购金数据：SAFE 自动解析 + CSV 兜底
 *
 * 数据源：
 *  - 中国月度：国家外汇管理局「官方储备资产」表格（默认 2026 年页面，可用 SAFE_URL 覆盖）
 *    解析其中「万盎司」行 → 吨；写回 data/china.csv
 *  - 全球季度：data/global.csv（WGC 季度数据无公开 API，需手工/其它脚本维护）
 *
 * 输出：cb.json
 *   { updated, shift, chinaZeroStreak, globalQ, source, note, china, global }
 *
 * 规则：中国连续 3 个月增持≈0 且全球最近两季净购金 <200 吨 → shift=5，否则 0。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SAFE = 'https://www.safe.gov.cn/safe/2026/0206/27116.html';
const OZ_TO_T = 0.311035; // 万盎司 → 吨

function parseCsv(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .filter(l => !/^month|^quarter/i.test(l))
    .map(l => l.split(',').map(s => s.trim()));
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 cb-feed' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
}

function cellsOf(row) {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
}

async function fetchSafeChina() {
  const url = process.env.SAFE_URL || DEFAULT_SAFE;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 cb-feed' } });
  if (!res.ok) throw new Error('SAFE HTTP ' + res.status);
  const text = new TextDecoder('utf-8').decode(await res.arrayBuffer());
  const rows = [...text.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
  let months = [];
  let units = null;
  for (const r of rows) {
    const c = cellsOf(r);
    if (months.length === 0) {
      const ms = c.filter(x => /^\d{4}\.\d{2}$/.test(x));
      if (ms.length >= 6) months = ms;
    }
    if (!units && c.some(x => /万盎司/.test(x))) units = c;
  }
  if (!months.length || !units) return [];
  const out = [];
  for (let i = 0; i < months.length; i++) {
    const cell = units[1 + 2 * i];
    const m = /^(\d+(?:\.\d+)?)万盎司$/.exec(cell || '');
    if (!m) continue;
    const oz = parseFloat(m[1]);
    if (!(oz > 0)) continue;
    const parts = months[i].split('.');
    out.push({ month: parts[0] + '-' + parts[1], tonnes: +(oz * OZ_TO_T).toFixed(1) });
  }
  return out;
}

function readChinaCsv() {
  const p = path.join(process.cwd(), 'data', 'china.csv');
  if (!fs.existsSync(p)) return [];
  return parseCsv(fs.readFileSync(p, 'utf8'))
    .map(r => ({ month: r[0], tonnes: Number(r[1]) }))
    .filter(x => x.month && !isNaN(x.tonnes));
}

function readGlobal() {
  const csv = path.join(process.cwd(), 'data', 'global.csv');
  if (fs.existsSync(csv)) {
    return parseCsv(fs.readFileSync(csv, 'utf8'))
      .map(r => ({ quarter: r[0], tonnes: Number(r[1]) }))
      .filter(x => x.quarter && !isNaN(x.tonnes));
  }
  const cfgPath = path.join(process.cwd(), 'cb_config.json');
  if (fs.existsSync(cfgPath)) {
    return (JSON.parse(fs.readFileSync(cfgPath, 'utf8')).global || []);
  }
  return [];
}

function writeChinaCsv(china) {
  const p = path.join(process.cwd(), 'data', 'china.csv');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const lines = ['month,tonnes'].concat(china.map(x => x.month + ',' + x.tonnes));
  fs.writeFileSync(p, lines.join('\n') + '\n');
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
  let china = [];
  let source = '';
  try {
    const safe = await fetchSafeChina();
    if (safe.length >= 6) {
      china = safe;
      source = 'SAFE ' + (process.env.SAFE_URL || DEFAULT_SAFE);
      writeChinaCsv(china);
    }
  } catch (e) {
    console.error('SAFE parse failed:', e.message);
  }
  if (china.length === 0) {
    china = readChinaCsv();
    source = 'data/china.csv';
  }
  const global = readGlobal();
  const { zeroStreak, lastTwo, shift } = compute(china, global);
  const out = {
    updated: new Date().toISOString().slice(0, 10),
    shift,
    chinaZeroStreak: zeroStreak,
    globalQ: lastTwo,
    source,
    note: shift === 5
      ? '中国连续3个月零增持且全球两季净购金<200吨：R2档位整体+5pp'
      : '央行购金维持节奏：R2维持8/15/22/30档',
    china,
    global
  };
  const p = path.join(process.cwd(), 'cb.json');
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log('written', p);
  console.log(JSON.stringify({ source, shift, chinaZeroStreak: zeroStreak, globalQ: lastTwo, chinaLast: china[china.length - 1] }, null, 2));
})();
