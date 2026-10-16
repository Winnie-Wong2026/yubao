# 聿宝星球云服务器部署

本目录用于 `yubao.hxin.cc` 的独立部署。生产目录固定为：

- 应用：`/opt/yubao-dailyplan/app`
- 数据：`/opt/yubao-dailyplan/data`
- 上传：`/opt/yubao-dailyplan/uploads`
- 备份：`/opt/yubao-dailyplan/backups`
- 日志：`/var/log/yubao-dailyplan`
- Caddy 站点：`/etc/caddy/sites/yubao.hxin.cc.caddy`

Compose 项目、容器、网络和卷均使用 `yubao-dailyplan` 前缀。应用只绑定
`127.0.0.1:8787`，公网流量仅由 `yubao.hxin.cc` 的 Caddy 站点接入。
