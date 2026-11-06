# cb-feed · 央行购金数据源

给「黄金纪律助手」提供 `cb.json` 的自动生成仓库：GitHub Actions 每天/每次修改后运行 `cb_scraper.js`，把结果提交回仓库，App 直接拉 raw 地址。

## 一、一次性设置（3 分钟）

### 1. 建仓库并推送

**方式 A：网页建仓（推荐，无需装工具）**

1. 打开 https://github.com/new
2. Repository name 填 `cb-feed`，选 **Public**（App 拉 raw 不需要 token），不要勾 README；
3. 创建后在本目录执行：

```bash
cd "C:\Users\Administrator\Desktop\黄金纪律助手\cb-feed"
git remote add origin https://github.com/<你的用户名>/cb-feed.git
git branch -M main
git push -u origin main
```

**方式 B：装 GitHub CLI 后一条命令**

```powershell
winget install GitHub.cli
gh auth login
cd "C:\Users\Administrator\Desktop\黄金纪律助手\cb-feed"
gh repo create cb-feed --public --source . --push
```

### 2. 打开 Actions 写权限

仓库 → **Settings → Actions → General → Workflow permissions** → 选 **Read and write permissions** → Save。

> 不打开的话，Actions 能生成 cb.json 但无法提交回去。

### 3. 手动跑一次

仓库 → **Actions → cb-feed → Run workflow**，约 20 秒后仓库里会出现/更新 `cb.json`。

## 二、App 里填地址

```
https://cdn.jsdelivr.net/gh/<你的用户名>/cb-feed@main/cb.json
```

App：**交易规则 → 参数 → 央行数据 URL → 保存参数**。`raw.githubusercontent.com` 的 CDN 缓存经常不刷新，建议用 jsDelivr（本仓库已默认）或 raw.githack。

之后每次刷新会拉取该地址；成功显示「自动 · 日期」，失败退回手动值。

## 三、数据怎么维护

- 默认读取仓库根目录的 `cb_config.json`；
- 每月（中国）或每季（全球）改一次数值并 commit，Actions 会重算 `cb.json`：

```json
{
  "china":  [{ "month": "2026-10", "tonnes": 2301.0 }],
  "global": [{ "quarter": "2026Q3", "tonnes": 321 }]
}
```

- 也可以不用仓库里的配置：在仓库 **Settings → Secrets and variables → Actions → Variables** 里加 `CHINA_CSV` / `GLOBAL_CSV` 指向外部 CSV（`month,tonnes` / `quarter,tonnes`），工作流会优先用它们。

## 四、计算规则

- 中国月度增持 = 相邻月吨数差；`|差| < 0.5t` 记为零增持；
- 中国连续 3 个月零增持 **且** 全球最近两季净购金均 <200 吨 → `shift=5`，否则 0。

## 五、本地验证

```bash
node cb_scraper.js
type cb.json
```

无需 npm 依赖，Node 18+ 自带 fetch。

## 六、说明

- 本仓库不抓取 PBOC/WGC 网页（它们没有稳定公开接口），只负责**汇总与发布**；
- 数据源可以是手工维护的 `cb_config.json`，也可以是外部 CSV / 你自己的爬虫；
- 仓库不含任何密钥，公开可读。

## 七、数据文件与地址

仓库里现在直接放两份 CSV，改它们即可：

| 文件 | 直链 |
| --- | --- |
| 中国月度 | https://cdn.jsdelivr.net/gh/toorwohlert-bit/cb-feed@main/data/china.csv |
| 全球季度 | https://cdn.jsdelivr.net/gh/toorwohlert-bit/cb-feed@main/data/global.csv |

格式：`month,tonnes`、`quarter,tonnes`。

官方参考（手工取数用，非 CSV）：

- PBOC 官方储备资产：http://www.pbc.gov.cn/diaochatongjisi/116219/116225/index.html
- 国家外汇管理局 官方储备资产：https://www.safe.gov.cn/safe/2026/0206/27116.html
- 世界黄金协会 黄金需求趋势：https://www.gold.org/goldhub/research/gold-demand-trends
- 东方财富 外汇和黄金储备（亿美元口径，仅参考）：https://data.eastmoney.com/cjsj/hjwh.html

脚本优先级：`data/*.csv` → `cb_config.json` → 环境变量 CSV。