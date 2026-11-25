# dsh-couch 插件

用二维码和 10 分钟有效的配对码把手机配对到 DeepSeek Harness，通过你自己部署的
relay 远程控制正在运行的 Harness。

本包是插件端。请先从 [dsh-couch 仓库](https://github.com/zy445566/dsh-couch)
部署 relay（`docker compose up -d`），然后：

1. **设置 → 插件 → 添加插件** → `@zy445566/dsh-couch`。
2. 打开一个会话，点击会话标题栏右侧的手机图标。
3. 填写 relay 地址（例如 `http://203.0.113.10:8787`），保存并测试，然后生成
   二维码和配对码。
4. 手机扫码并输入 6 位配对码；手机会在当前会话打开 DSH 界面。

二维码和配对码 10 分钟内有效。配对后的手机拥有**与桌面浏览器相同的完整
控制权限**（工具、审批、设置）。请只配对你信任的手机；用完后在弹窗中点击
**断开手机** 或 **停止远程访问**。

插件需要 DSH Web GUI（`connection` 与 `webServer` 服务），终端-only profile
不可用。服务器地址和隧道身份保存在 `$DSH_HOME/dsh-couch/state.json`（0600）；
DSH 浏览器 cookie 只存在于 Harness 进程内。DSH 重启不会自动恢复远程访问，
点击 **上线** 即可恢复之前保存的配对。

已在 DeepSeek Harness `0.2.2-rc.5` 上测试。relay 部署、HTTPS、安全说明和限制
见仓库 README。MIT 协议。
