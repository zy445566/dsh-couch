# dsh-couch

用二维码 + 6 位配对码把手机配对到 DeepSeek Harness，通过你自己部署的 relay
远程控制正在运行的 Harness。

- `@zy445566/dsh-couch`：DeepSeek Harness 插件（发布到 npm）。
- `packages/relay`：部署在公网服务器上的 Node relay。
- DSH 机器不需要公网入站端口：插件主动向 relay 建立 WebSocket 隧道。
- relay 只开一个端口；每条隧道位于随机 `/<slug>/` 路径下。
- 手机上运行的是真实的 DSH Web 界面，并自动打开当前会话。
- **配对后的手机拥有与桌面浏览器相同的完整控制权限**（工具、审批、设置）。
  请只配对你信任的手机。

## 快速开始

### 1. 部署 relay

在一台手机能访问的服务器上：

```bash
cd docker
cp .env.example .env
# 设置 PUBLIC_HOST（或域名），强烈建议同时配置 TLS
docker compose up -d --build
```

只开放 relay 需要的端口（默认 `8787`），然后检查：

```bash
curl http://服务器地址:8787/healthz
```

`PUBLIC_HOST` 是二维码中使用的地址。如果插件通过公网域名连接、relay 实际在
反向代理后面，请设置 `PUBLIC_HOST` 和 `PUBLIC_SCHEME=https`，并把 `/`（包括
WebSocket upgrade）转发到 `8787`。

### 2. 安装插件

在 DeepSeek Harness 中打开 **设置 → 插件 → 添加插件**，输入
`@zy445566/dsh-couch`（开发时也可以安装本地目录）。打开任意会话，会话标题栏
右侧会出现手机图标。

### 3. 配对

1. 点击手机图标。
2. 填写 relay 地址，例如 `http://203.0.113.10:8787`，点击 **保存并测试**。
3. 点击 **生成配对码**。二维码和 6 位配对码出现，10 分钟内有效。
4. 用手机扫描二维码，打开 relay 配对页，输入配对码。
5. 手机自动跳转到 DSH 界面。可以“添加到主屏幕”。

桌面弹窗可以 **断开手机**（撤销该手机，隧道保持在线以便重新配对）或
**停止远程访问**（撤销并关闭隧道）。撤销后手机立即失效。

## 安全说明

- 二维码包含 192 位配对 token；6 位配对码只显示在桌面。配对码单次使用、最多
  尝试 5 次、10 分钟过期。
- relay 只保存隧道密钥和设备 token 的 SHA-256 哈希。设备 cookie 为
  `HttpOnly`、`SameSite=Lax`、按路径隔离；撤销时删除。
- DSH 的浏览器会话 cookie 不会离开 Harness 进程：插件在本机换取 launch token
  对应的 cookie，只用于 loopback 请求；手机只持有 relay 的设备 cookie。
- relay 不是开放代理：它不接受目标 URL，只转发到通过密钥认证的那条隧道。
- **公网 relay 请使用 HTTPS。** 明文 HTTP 下，路径上的攻击者可以窃取或劫持
  已配对的会话。可以用 TLS 反向代理（设置 `PUBLIC_SCHEME=https`），或给 relay
  提供证书（`TLS_CERT_FILE`/`TLS_KEY_FILE`）。
- 自托管 relay 能看到它转发的流量；本版本没有插件到 relay 的端到端加密。
- DSH 重启后**不会自动上线**。重新打开弹窗点击 **上线** 即可恢复之前保存的
  配对。

## 限制

- 每条隧道一个手机。
- 手机是 owner，不是受限 viewer。如果需要受限分享，请使用 DSH 实验性的
  LiveShare 功能。
- 手机加载的是桌面 Web 界面；窄屏时可以折叠侧边栏，v1 不提供专门移动端聊天
  界面。
- relay 数据卷丢失会让设备 cookie 失效，需要重新配对。
- 已在 DeepSeek Harness `0.2.2-rc.5` 上测试；manifest 声明
  `engines.dsh = ">=0.2.2-rc.5 <0.3.0"`。

## 故障排查

| 现象 | 检查 |
|---|---|
| 无法连接 relay | 端口是否开放、地址是否正确、HTTPS 证书是否被 Node 信任（私有 CA 可设 `NODE_EXTRA_CA_CERTS`） |
| 配对页提示桌面端离线 | DSH 是否在运行、是否点击了 **上线** |
| 配对码被拒绝 | 配对码 10 分钟过期，最多 5 次；重新生成 |
| 手机能打开但不能发送消息 | 反向代理必须转发 WebSocket upgrade |
| 提示插件状态文件被重置 | `$DSH_HOME/dsh-couch/state.json` 损坏，旧文件已备份；重新配对 |
| relay 重启后手机失效 | 保留 relay 数据卷；否则重新配对 |

状态文件：

- 插件：`$DSH_HOME/dsh-couch/state.json`（0600）。
- Relay：`$DATA_DIR/state.json`（0600，Docker 默认使用命名卷）。

## 开发

```bash
pnpm install
pnpm test
node packages/relay/bin/relay.js   # 默认数据目录 ./data
```

relay 测试与插件测试会启动真实 relay + 假 DSH 上游，覆盖配对、HTTP/WebSocket
代理、撤销、持久化和插件状态机。

发布插件：

走手动的 **Publish npm** workflow（`.github/workflows/publish-npm.yml`），使用
npm Trusted Publishing（OIDC）认证，仓库里不需要 `NPM_TOKEN` secret。首次使用需在
npmjs.com 上该包的 Settings → Publishing access → Add trusted publisher 里选择
GitHub Actions，并填写：组织或用户 `zy445566`、仓库 `dsh-couch`、workflow 文件名
`publish-npm.yml`、environment 留空。

在 Actions 页面对 `main` 运行该 workflow，可选参数：

- `version`：要发布的版本；留空则使用 `packages/dsh-couch/package.json`。已发布的
  版本、或会让 `latest` 倒退的版本会被拒绝。
- `dist-tag`：默认 `latest`；预发布用 `next`。
- `dry-run`：只构建并校验 tarball，不真正发布。

Job 会安装依赖、同步协议副本、跑 `pnpm test`、发布 `packages/dsh-couch` 并附带
provenance 证明，最后在 summary 里给出结果。`version` 参数只改写 tarball 里的
`package.json`；如果希望仓库也记录版本号，请把版本改动提交进去。如需在本地发布：

```bash
pnpm sync-protocol
pnpm test
cd packages/dsh-couch
npm publish --access public
```

MIT 协议。第三方归属见 [NOTICE](NOTICE)。
