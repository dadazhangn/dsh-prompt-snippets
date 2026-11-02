# 发布到 npm（让插件进入官方市场索引）

## 为什么必须发 npm

`awesome-dsh-plugin` 的官方市场索引（`https://awesome-dsh-plugin.com/index.json`，由 npm 包
`dsh-plugin-catalog` 分发）**只收 npm source**。`scripts/lib/market-index.mjs` 的原文是：

> The GitHub-only half of the list cannot be expressed yet — format 1 wants a commit SHA
> per Git version, and this repository records none.

代码层面 `buildMarketIndex` 对没有 npm 映射的条目直接 `skipped.noNpm += 1; continue`。
后果很具体：条目 YAML 已被合并（PR #9994，站点详情页能打开），但如果插件是 git-only，
它就**永远不会出现在「发现」标签页的可安装列表里**。

另外，`dshmarket` README 第 14 行说明了索引分发的位置问题：

> dsh 给索引源的时间只有 15 秒，而 GitHub Pages 上的那两份
> （`https://awesome-dsh-plugin.com/index.json` 与 `https://dshmarket.com/index.json`）
> 在部分网络下会超过。npm 分发的索引在哪里都快。

本机实测印证：直连 `raw.githubusercontent.com` 与 `cdn.jsdelivr.net/gh/` 全部 `ECONNRESET`，
而 `registry.npmjs.org` ping 200、`registry.npmmirror.com` 302。**自托管 raw URL 索引在这种
网络下根本拉不到，只有 npm 分发的索引稳。**

所以走 npm 发布是唯一能同时解决「进官方索引」和「索引可被拉取」的路径。

## 发布前的状态（已全部就绪）

| 项 | 值 |
|---|---|
| 包名 | `dsh-prompt-snippets`（registry 返回 404，未被占用） |
| 版本 | `1.1.0` |
| `private` | 已移除 |
| `license` | MIT（`LICENSE` 已加） |
| `publishConfig` | `access: public`，`registry: https://registry.npmjs.org/` |
| `engines.dsh` | `>=0.2.1-rc.3` |
| `files` | 9 个文件，31146 B tarball / 106472 B 解包 |
| 自测 | 253 条断言全通，真实数据零接触 |

`npm pack --dry-run` 的实际内容：

```
LICENSE 1067 · README.md 7785 · client.js 49040 · cordis.patch.yml 70
icon.svg 235 · index.js 46507 · locale/en.json 163 · locale/zh.json 160
package.json 1445
```

`ROADMAP.md` 与 `PUBLISH.md` 不打包（不在 `files` 里）。

## 发布步骤

### 1. 登录 npm（需要你自己做，我没法代劳）

```powershell
cd C:\Users\20884\Desktop\dsh\prompt-snippets
& 'D:\nodejs\npm.cmd' login
```

当前 `npm whoami` 报 `ENEEDAUTH`，即本机没有 npm 凭据。`~/.npmrc` 里也没有 token 行。

如果浏览器登录不方便，用 token 方式（token 在 https://www.npmjs.com/settings/dadazhangn/tokens
生成，选 Automation 类型）：

```powershell
& 'D:\nodejs\npm.cmd' config set //registry.npmjs.org/:_authToken=<TOKEN>
```

### 2. 确认身份与包名可用

```powershell
& 'D:\nodejs\npm.cmd' whoami          # 应输出 dadazhangn
& 'D:\nodejs\npm.cmd' view dsh-prompt-snippets version   # 应报 404
```

### 3. ~~提交代码并打 tag~~ ✅ 已完成

提交 `bd616e8df8f7d987229d6c22563038f5a9508436`
（`chore: prepare npm publish (license, engines, publishConfig, install docs)`），
已推送到 `origin/master`，tag `v1.1.0` 已推送并确认指向同一 commit。

命令留档（本次已执行）：

```powershell
cd C:\Users\20884\Desktop\dsh\prompt-snippets
git add -A
git commit -m "chore: prepare npm publish (license, engines, publishConfig, install docs)"
$t = (& 'D:\GitHub CLI\gh.exe' auth token).Trim()
git push "https://x-access-token:$t@github.com/dadazhangn/dsh-prompt-snippets.git" master
git tag v1.1.0
git push "https://x-access-token:$t@github.com/dadazhangn/dsh-prompt-snippets.git" v1.1.0
```

> push 必须用 token URL：`git-credential-manager` 在沙箱里起不来，会报
> `couldn't create signal pipe, Win32 error 5` + `could not read Username`。
> msys 的 `fatal error - couldn't create signal pipe` 仍会打印在 stdout，但推送本身成功
> （看 `e2d70db..bd616e8  master -> master` 那行）。


### 4. 发布

```powershell
& 'D:\nodejs\npm.cmd' publish
```

`private` 已移除、`publishConfig.access` 是 `public`，直接发即可。

### 5. 验证线上包

```powershell
& 'D:\nodejs\npm.cmd' view dsh-prompt-snippets version
& 'D:\nodejs\npm.cmd' view dsh-prompt-snippets dist.tarball
```

再跑一次真实安装（用临时 DSH_HOME，不要污染现有 profile）：

```powershell
$env:DSH_HOME = "$env:TEMP\dsh-vtest"
& 'D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile vtest add dsh-prompt-snippets
& 'D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' --profile vtest --dump-config
```

注意 `--dump-config` 是 **dsh 顶层**的参数，不是 `plugin` 子命令的（`dsh plugin --dump-config`
会报 `Unknown option`）。期望看到：

```
> # == dsh-prompt-snippets
> - id: prompt-snippets
>   name: dsh-prompt-snippets
```

验证完删掉 `$env:TEMP\dsh-vtest`。

> 上面这套「装 tarball → 校验 7 个源文件 SHA256 与仓库逐一致 → `--dump-config` 出现
> `id: prompt-snippets`」已在本次用 `npm pack` 产出的 `dsh-prompt-snippets-1.1.0.tgz`
> 完整跑通过一次，临时环境已清理。


### 6. 让索引收录

npm 发布后还需要两步，因为索引由 `awesome-dsh-plugin` 的 `data/npm-map.json` 驱动：

1. **往 `data/npm-map.json` 加映射**。当前该文件 152 条记录里没有我们这条。字段形状是
   URL → `{ npm, publishedAt }`：
   ```json
   "https://github.com/dadazhangn/dsh-prompt-snippets": {
     "npm": "dsh-prompt-snippets",
     "publishedAt": <npm 发布时间的 Unix 秒>
   }
   ```
   `publishedAt` 必须与 npm registry 上的 `time[version]` 一致，否则 `buildMarketIndex`
   产出的 `publishTimestamp` 与真实发布时间对不上。取法：
   ```powershell
   & 'D:\nodejs\npm.cmd' view dsh-prompt-snippets time --json
   ```

2. **提 PR** 到 `awesome-dsh-plugin/awesome-dsh-plugin`，改这一个文件即可。PR #9994 已经
   合并了插件条目 YAML，所以只需要补 npm 映射这一处。合并后 CI 重建
   `docs/index.json` → 发布 `dsh-plugin-catalog` → 两个站点与「发现」标签页同时生效。

> 注意：条目 YAML 里 `category` 是 `ui`，而本地 `market-submission/market-index.json`
> 用的是 `prompting`。以已合并的 YAML 为准，改索引时别把分类改回去。

## 兜底方案（npm 走不通时）

如果 npm 发布暂时不可行，可以用自己的索引 URL。但有两个硬约束：

1. **Host 拒绝重定向**（`plugin-market/README.zh.md`：拒绝重定向，只能经重定向访问的索引
   必须以其最终 URL 配置）。
2. **索引必须在 15 秒内取到**（`fetchTimeoutMs` 默认 `15000`），国内网络下
   `raw.githubusercontent.com` / `cdn.jsdelivr.net/gh/` 都会超时或被 RST。

可行的托管位置（都必须可直连、无重定向）：自己的服务器、对象存储（OSS/COS/R2）的公开 URL、
或 gitee 之类国内可达的静态托管。索引内容就是 `market-submission/market-index.json`
（format 1，已过 `_verify-index.mjs` 权威校验），它同时带 git source 的 commit SHA，
所以 **git-only 插件在自己的索引里是合法的** —— 限制只存在于 awesome 的构建脚本里。

用户侧的配置路径：**插件 → 发现 → 索引源 → 添加索引源**，粘贴该 URL。

## 时间戳陷阱

`Get-Date -UFormat %s` 在 PowerShell 里会差 +8 小时（返回本地时间当 UTC 用）。
取真实 Unix 秒用：

```powershell
git show -s --format=%ct HEAD     # commit 时间
& 'D:\nodejs\npm.cmd' view dsh-prompt-snippets time --json   # npm 发布时间
```
