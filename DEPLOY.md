# 部署与托管指南（邀请码测试系统）

本系统 = 纯 Node.js（零依赖）+ 原生 `http`，前端是静态文件。
要能让**小红书买家**访问，需要一台「有公网地址 + 能跑 Node + 磁盘持久」的主机。

> ⚠️ 最重要的一条：**邀请码和会话存在磁盘上的 `data/codes.json`、`data/sessions.json`**。
> 如果部署到「文件系统每次重启都会重置」的平台（如某些 Serverless / Vercel），已发出的邀请码会丢、已登录的会话会失效。
> 付费卖码场景，**务必选「带持久磁盘」的平台**，或把存储改成数据库（见方式 D）。

---

## 0）本地先跑通（部署前必做）

```bash
cd invite-test-system
node server.js
# 打开 http://localhost:3000  → 输入邀请码页
# 打开 http://localhost:3000/admin → 默认密码 admin123!（先改掉，见下）
```

跑 `node test_local.js` 做一次逻辑自检（30 项全过即正常）。

---

## 1）部署前必改的两件事

1. **改管理员密码**：默认 `admin123!` 只是占位。
   - 最快：部署后首次运行会自动生成 `config.json`，打开它把 `adminPass` 改成强密码；
   - 更稳：**用环境变量 `ADMIN_PASS` 注入**（不写进仓库）。
2. **确认端口**：代码已支持 `process.env.PORT`，平台注入端口即可，无需改代码。

---

## 2）方式 A：Railway（最省事，推荐）

带持久磁盘 + 自动 HTTPS 子域名，适合直接给买家用。

> ⚠️ **关键**：Railway 的容器文件系统是**临时的**，每次重新部署 / 重启都会清空写入的文件。
> 因此**必须挂一个 Volume（持久卷）**，并用 `DATA_DIR` 把数据目录指过去，否则已发出的邀请码和会话会全部丢失。

1. 把 `invite-test-system` 整个目录推到 GitHub（`.gitignore` 已排除 `data/`、`config.json`、`node_modules/`，仓库里不会含密码和已生成的码）。
2. 打开 railway.app → 用 GitHub 登录 → New Project → **Deploy from GitHub repo** → 选你的仓库。
   - Railway 自动识别 Node 项目：Build 跑 `npm install`（零依赖秒过），Start 跑 `npm start`（= `node server.js`）。
3. 项目 → **Variables** 添加环境变量：
   - `ADMIN_PASS` = 你的强密码（**必设**，覆盖默认 `admin123!`）
   - `DATA_DIR` = `/data`（指向下面挂的持久卷；不设则默认用仓库根的 data/，但那在临时文件系统里会丢）
   - `PORT` **不用设**（Railway 自动注入，代码已支持）
4. 项目 → **Volumes** → New Volume：Mount Path 填 **`/data`**（必须和上面的 `DATA_DIR` 一致）；容量 1 GB 足够。
5. 部署完成后，Railway 分配 `xxx.up.railway.app` 域名，HTTPS 自动就绪。
6. 打开 `https://xxx.up.railway.app/admin`，用 `ADMIN_PASS` 登录，生成邀请码，把明文码私信给小红书买家即可。

> 费用提醒：Railway 不是完全免费，有用量额度（Hobby 计划含每月额度，超出按量计费），请关注账单。

---

## 3）方式 B：Render

1. 推到 GitHub。
2. render.com 新建 **Web Service** → 连仓库。
   - Build Command：`（空，零依赖）` 或 `npm install`
   - Start Command：`node server.js`
   - 选一个有 **Disk**（持久磁盘）的方案，Mount Path 填 `/data`（与代码里的 `data/` 对应）。
3. 自动给 `xxx.onrender.com` 子域名 + HTTPS。
4. 在 Environment 里加 `ADMIN_PASS`。

---

## 4）方式 C：自有云服务器 / VPS（阿里云 / 腾讯云轻量 / 任意 Linux）

适合要**自有域名**和长期稳定运营。

```bash
# 服务器上（需先装 Node >= 18）
git clone <你的仓库> invite-test-system && cd invite-test-system
npm install   # 零依赖，秒过
ADMIN_PASS='你的强密码' node server.js
```

生产建议用进程守护 + 反代：
- `pm2 start server.js --name invite-test`（开机自启：`pm2 startup`）
- 用 Nginx/Caddy 反代到 `localhost:3000`，并在反代层套 SSL（Let's Encrypt）。
  - 之后把 Cookie 的 `Secure` 打开（见末尾），HTTPS 下更安全。

域名：在 DNS 把你的域名 A 记录指向服务器 IP，Nginx 配 server_name，Certbot 申请证书即可。

---

## 5）方式 D：WorkBuddy cloud-service 托管（需要授权）

如果你的账号已开通 cloud-service（托管版 Serverless + 数据库），
我可以把现在的「本地 JSON 文件存储」改成「云端数据库」，这样：
- 不用自己管服务器 / 持久磁盘；
- 多实例也能共享邀请码与会话；
- 自动 HTTPS + 域名。

这步需要你**授权连接 cloud-service**，并允许我改 `server.js` 的存储层
（把 `readJSON/writeJSONAtomic` 这一层换成数据库读写的适配器）。要的话说一声，我来改。

---

## 6）给小红书买家的完整流程

1. 你登录 `/admin` → 选数量生成邀请码 → **明文码只显示这一次**，复制保存。
2. 小红书成交后，把码私信给买家。
3. 买家打开你的公网地址 → 输码 → 进入 16 题诊断 → 看专属本命色报告。
4. 码**一次性**：用过即作废，别人拿到也进不去。

---

## 7）安全 / 运维提醒

- 公网务必 **HTTPS**（买家输码走加密；且 `Set-Cookie` 在 HTTPS 下才能加 `Secure`）。
- 想让 Cookie 仅 HTTPS 传输：在 `server.js` 的 `setCookie` 里把
  `'HttpOnly', 'SameSite=Lax', 'Path=/'` 改为加 `'; Secure'`（仅生产 HTTPS 时加，否则本地 http 会收不到 cookie）。
- `data/`、`config.json` 已加入 `.gitignore`，**不要**把密码或已生成的码提交到公开仓库。
- 邀请码过期：默认 30 天（`config.json` 的 `codeValidityDays`，设 `0` 表示永不过期）。
- 会话有效期：默认 120 分钟（`sessionTtlMinutes`），超时后需重新输码。
