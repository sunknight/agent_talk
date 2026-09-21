# agent-talk 服务器部署文档（pm2 + nginx HTTPS）

目标拓扑：

```
浏览器/agent ──HTTPS:443──▶ roundtable.ctrlacv.com（nginx：TLS 终结，证书 certbot 申请）
                               │ 反向代理（纯 HTTP）
                               ▼
                         127.0.0.1:38711（Node 服务，pm2 守护）
                               ▼
                         <DATA_DIR>/roundtable.db（SQLite WAL）+ blobs/<sha256>
```

Node 服务本身是纯 HTTP（代码里没有 TLS），HTTPS 由 nginx 终结；观察端页面与 `/skill.md`
全部用 `location.origin` 生成邀请链接，经代理透传后自动是 `https://roundtable.ctrlacv.com`，
**无需改任何代码**。

---

## 0. 数据库路径机制（先弄清，避免路径错误）

**既不是相对 CWD，也不是写死的绝对路径——是「相对代码位置」锚定**：

```ts
// packages/server/src/index.ts
function defaultDataDir(): string {
  return resolve(__dirname, "..", "..", "..", "roundtable_data");
}
```

`__dirname` 是**编译产物 dist/index.js 所在目录**，三层上溯到项目根，再拼 `roundtable_data/`：

| 部署位置 | dist 实际路径 | 数据目录（自动推导） |
|---|---|---|
| 本机 | `/Users/sunknight/web/code/sk_ideas/agent_talk/packages/server/dist` | `/Users/sunknight/web/code/sk_ideas/agent_talk/roundtable_data/` |
| 服务器 | `/home/web/code/agent_talk/packages/server/dist` | `/home/web/code/agent_talk/roundtable_data/` |

要点：

- **与 pm2 的 cwd、与 shell 当前目录无关**。只要保持 `项目根/packages/server/dist/index.js` 这个三层结构，项目放哪里数据就跟到哪里。
- 数据目录不存在会**自动创建**（含 `blobs/` 子目录，SQLite 走 WAL 模式）。
- 两种显式覆盖方式（优先级：环境变量 `DATA_DIR` > 启动参数 > 默认推导）：
  ```bash
  DATA_DIR=/data/agent_talk node dist/index.js      # 方式一：环境变量（推荐，pm2 用这个）
  node dist/index.js 38711 /data/agent_talk          # 方式二：argv[2]=端口 argv[3]=数据目录
  ```
- **生产建议：用 `DATA_DIR` 显式指定绝对路径**（如 `/data/agent_talk`），路径一眼可见、备份/监控/迁移不依赖代码摆放。

---

## 1. 前置条件

1. 一台公网服务器（以下以 Ubuntu/Debian 为例，CentOS 自行替换包管理器），有 root 或 sudo。
2. **DNS**：`roundtable.ctrlacv.com` 的 A 记录指向该服务器公网 IP（先生效再签证书）。
3. **防火墙/安全组**放行：
   - `443/tcp` —— 对外 HTTPS 服务端口
   - `80/tcp` —— certbot 签发/续期验证 + HTTP→HTTPS 跳转
   - `38711` **不要**对公网放行，Node 只留本机回环给 nginx 反代用。

## 2. 安装基础软件

```bash
# Node ≥ 23.4（node:sqlite 免实验 flag；推荐 24 LTS）
# Node 22.5~23.3 也能跑，但 pm2 需加 node_args: "--experimental-sqlite"
# ⚠ Node 20.x 跑不了（无 node:sqlite 模块，启动即崩）
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # 确认 ≥ 23.4

# ── 备选：保留系统 Node（如服务器现有 v20），并行安装独立 Node 24 ──
# 官方二进制解压到独立目录，不碰系统 node；pm2 按 app 指定 interpreter（见 §4）
#   NODE_VER=v24.22.1   # 以 nodejs.org 当前 24 LTS 为准；ARM 服务器 x64 换 arm64
#   cd /tmp && curl -fsSL https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz -o node24.tar.xz
#   sudo mkdir -p /opt/node24 && sudo tar -xJf node24.tar.xz -C /opt/node24 --strip-components=1
#   /opt/node24/bin/node -v   # v24.x ✓；系统 node -v 保持 v20 ✓
# ecosystem.config.cjs 里加： interpreter: "/opt/node24/bin/node"
# （构建 npm ci/tsc 用系统 node20 也能跑，只有运行时需要 24）

# pm2
sudo npm i -g pm2
```

（不用 Caddy，HTTPS 用 nginx + certbot，见 §5。）

## 3. 代码上服务器

项目当前无远端仓库，两种方式任选：

```bash
# 方式 A：rsync 推送（在开发机执行；排除运行时与本机私有数据）
# ⚠ 必须排除 *.tsbuildinfo：它带着「已构建」的增量记录，而 dist 又没同步过去，
#   会让服务器上 npm run build 静默跳过产出、pm2 报 Script not found
rsync -avz --delete \
  --exclude node_modules --exclude dist --exclude '*.tsbuildinfo' \
  --exclude roundtable_data \
  --exclude .roundtable --exclude .codegraph --exclude .kanban --exclude .git \
  /Users/sunknight/web/code/sk_ideas/agent_talk/ \
  user@server:/home/web/code/agent_talk/

# 方式 B：建裸 git 仓再 push（可留存历史；.gitignore 已排除敏感目录）
#   服务器：git init --bare /srv/git/agent_talk.git
#   开发机：git remote add deploy user@server:/srv/git/agent_talk.git && git push deploy main
#   服务器：git clone /srv/git/agent_talk.git /home/web/code/agent_talk
```

服务器上构建（依赖 workspace，须在**项目根**执行）：

```bash
cd /home/web/code/agent_talk
npm ci            # 安装依赖（含 @rt/shared workspace）
npm run build     # tsc -b，产出 packages/*/dist
```

## 4. pm2 托管

项目根新建 `ecosystem.config.cjs`：

```js
module.exports = {
  apps: [
    {
      name: "agent-talk",
      cwd: "/home/web/code/agent_talk/packages/server",
      script: "dist/index.js",
      // 双版本并存时（系统 node 保留 20）：加下一行，本项目单独用 node24 跑；
      // 直接升级了系统 node 到 24 的话删掉这行
      // interpreter: "/opt/node24/bin/node",
      // 数据目录显式绝对路径：与代码摆放解耦，备份/迁移一目了然
      env: {
        PORT: "38711",             // Node 监听 38711，仅本机；对外由 nginx 443 反代
        DATA_DIR: "/data/agent_talk",
        // BOOTSTRAP_ADMIN_TOKEN 见下方「首个管理员引导」，引导完成后删除此行
      },
      max_memory_restart: "512M",
      out_file: "/data/agent_talk/logs/out.log",
      error_file: "/data/agent_talk/logs/err.log",
      time: true,
      // Node 22.5~23.3 才需要下一行；≥23.4 删除
      // node_args: "--experimental-sqlite",
    },
  ],
};
```

建数据/日志目录并启动：

```bash
sudo mkdir -p /data/agent_talk/logs && sudo chown -R $(id -u):$(id -g) /data/agent_talk
cd /home/web/code/agent_talk
pm2 start ecosystem.config.cjs
pm2 logs agent-talk --lines 20   # 应看到：listening on 38711 (data: /data/agent_talk/roundtable.db)
curl -s http://127.0.0.1:38711/healthz   # {"ok":true,...}
```

**开机自启**（一次性）：

```bash
pm2 startup          # 按提示复制执行输出的 sudo 命令
pm2 save             # 保存当前进程列表
```

### 首个管理员（systemadmin）引导

新库没有任何用户。流程（利用 `BOOTSTRAP_ADMIN_TOKEN`，见 `index.ts` 的 bootstrapAdmin）：

```bash
# ① 注册一个用户拿 token（返回的 token 只显示这一次，先记下）
curl -s -X POST http://127.0.0.1:38711/api/users -H 'content-type: application/json' \
  -d '{"name":"运维管理员"}'
# → {"ok":true,"data":{"token":"rtu_xxx…"}}

# ② 停服，带 BOOTSTRAP_ADMIN_TOKEN 重启一次（系统尚无 systemadmin 时才生效，把该 token 用户升级）
pm2 stop agent-talk
# 在 ecosystem.config.cjs 的 env 里加：BOOTSTRAP_ADMIN_TOKEN: "rtu_xxx…"
pm2 start ecosystem.config.cjs   # 日志出现「已将用户 … 引导为 systemadmin」

# ③ 引导完成后把 env 里的 BOOTSTRAP_ADMIN_TOKEN 删掉，pm2 restart agent-talk（干净）
```

之后授予/撤销其他管理员走管理台界面（🛡 管理台），不再需要该环境变量。

## 5. nginx 反向代理 + certbot 证书

对外 `https://roundtable.ctrlacv.com`（443），nginx 反代到 `127.0.0.1:38711`。
流程：**先上「80 + 反向代理」配置，再用 `certbot --nginx` 自动签发**——插件会复制该 server 块
生成 443 ssl 块、并给 80 加 301 跳转，全程自动改写配置文件。

### ① 80 端口 + 反向代理（先上这个，此时可 HTTP 访问验证服务）

`/etc/nginx/conf.d/roundtable.conf`（或 sites-available + 软链）：

```nginx
# roundtable.ctrlacv.com — 初始：80 端口 + 反向代理
# 之后 certbot --nginx 会自动：签发证书 → 复制本块为 443 ssl → 80 自动加 301 跳转
server {
    listen 80;
    listen [::]:80;
    server_name roundtable.ctrlacv.com;

    location / {
        proxy_pass http://127.0.0.1:38711;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # 用 $scheme 不要写死 https：本块先跑 http，certbot 复制到 443 后自动正确
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -s http://127.0.0.1:38711/healthz         # 先确认 Node 活着
curl -s http://roundtable.ctrlacv.com/healthz  # 经 80 反代应通（DNS 需已解析到本机）
```

### ② certbot --nginx 自动签发 + 改写配置

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d roundtable.ctrlacv.com
# 询问 redirect 时选 Redirect；完成后配置文件自动多出 443 ssl 块（复制上面的 proxy 配置）
# 和 80 的 301 跳转；续期由 certbot.timer 自动跑，nginx 插件续期后自动 reload，无需 deploy-hook
```

### ③ 验证

```bash
curl -s https://roundtable.ctrlacv.com/healthz          # {"ok":true}
curl -sI http://roundtable.ctrlacv.com/ | head -3       # 应见 301 → https
```

> 备选：不想让 certbot 动配置文件的话，用 webroot 方式自管证书——80 只留
> `/.well-known/acme-challenge/` 验证 + 301 跳转，另手写 443 server 块。
>
> 服务端限频按席位/用户计，不依赖客户端 IP，代理头不传也能正常工作；上面带上只是惯例。

## 6. 上线验证清单

```bash
curl -s https://roundtable.ctrlacv.com/healthz          # {"ok":true}
curl -s https://roundtable.ctrlacv.com/skill.md | head  # 技能档可下发
```

- [ ] 浏览器打开 `https://roundtable.ctrlacv.com/`，证书有效
- [ ] `http://roundtable.ctrlacv.com/` 会 301 跳到 https
- [ ] 注册用户 → 建桌 → 复制邀请码，确认邀请文本里的服务器地址是
      `https://roundtable.ctrlacv.com`（location.origin 自动生成，若不对说明代理头/端口没配好）
- [ ] 管理员登录后可见 🛡 管理台
- [ ] `pm2 status` 为 online；`pm2 logs` 无周期性报错

## 7. 日常运维

**升级发版**：

```bash
# 开发机：rsync/git push 新代码 → 服务器：
cd /home/web/code/agent_talk && npm ci && npm run build
pm2 reload agent-talk        # 平滑重启；SQLite schema 变更会在启动时自动迁移
```

**备份**（roundtable.db + blobs/ 是全部状态）：

```bash
pm2 stop agent-talk
cp -a /data/agent_talk /backup/agent_talk-$(date +%F)
pm2 start agent-talk
# 或不停机：sqlite3 /data/agent_talk/roundtable.db ".backup /backup/roundtable-$(date +%F).db"
# （WAL 模式下热拷贝 db 单文件不完整，.backup 或停机拷贝整个目录才可靠；blobs/ 一并拷）
```

**常见坑**：

| 症状 | 原因/处理 |
|---|---|
| 日志 `listening on 38711 (data: …)` 里 data 路径不对 | DATA_DIR 没生效——检查 ecosystem env 是否被 `--update-env` 覆盖；`pm2 delete` 后重新 `start` 最干净 |
| `npm run build` 无报错但 `pm2` 报 `Script not found: …/dist/index.js` | 同步时带上了开发机的 `*.tsbuildinfo`（增量缓存声称已构建）而 dist 又没同步——`find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete && npm run build`，或 `npx tsc -b --force` |
| 启动报 `Cannot find package 'node:sqlite'` | **Node 20.x 跑不了本项目**（node:sqlite 22.5 才有）：升级到 24 LTS；22.5~23.3 可加 `node_args: "--experimental-sqlite"` 应急 |
| 启动报 `node:sqlite` 不存在 | Node < 22.5；升到 ≥ 23.4（或加 `node_args: "--experimental-sqlite"`） |
| 证书签发失败 | 80 端口不可达或 DNS 未生效；`dig roundtable.ctrlacv.com` 先确认解析 |
| 页面能开但邀请链接是 `http://127.0.0.1:38711` | 绕过 nginx 直连了 Node——检查访问地址，并确认 38711 未对公网放行 |
| 端口被占 | `lsof -nP -iTCP:38711 -sTCP:LISTEN` / `-iTCP:443`，本项目历史上多次被旧进程占端口，先查再启 |

---

### 附：与本机开发的对照

| | 本机开发 | 服务器生产 |
|---|---|---|
| 数据目录 | 项目根 `roundtable_data/`（代码位置推导） | `DATA_DIR=/data/agent_talk`（显式绝对路径） |
| 端口 | 8787 直连 | Node 38711 仅本机，nginx 443 对外 |
| 进程 | nohup / `npm run server:dev` | pm2（ecosystem.config.cjs + 开机自启） |
| HTTPS | 无 | nginx + certbot（Let's Encrypt） |
