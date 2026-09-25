# 客户门户独立域名

客户门户和现有后台仍由同一个 XUI 进程提供服务。这个配置只在 Nginx 增加一个客户域名入口，不修改后台原有端口、监听地址或后台域名。

## 推荐配置

1. 把 `user.example.com` 的 DNS A/AAAA 记录指向服务器。
2. 在服务器执行 `x-ui`，进入 `29. 客户门户管理` → `3. 设置/修改客户域名并生效`。
3. 输入客户域名和证书路径。没有证书时会先生成 HTTP 配置；申请证书后再次运行该项即可切换到 HTTPS。
4. 让 Nginx 通过 `80/443` 接收客户请求并转发到当前 XUI 端口。XUI 当前后台的 URL 和端口不会被菜单改动。

以后要换域名时，重复执行第 3 项并输入新域名即可。脚本会覆盖门户反向代理配置、执行 `nginx -t`，
校验成功后 reload Nginx；旧域名不再由这份配置提供门户服务。

脚本会根据当前 XUI 是否配置了证书，自动选择 HTTP 或 HTTPS 上游；如果 XUI 本身使用 HTTPS，
Nginx 会关闭上游证书校验，因为连接目标是本机回环地址。

生成的配置文件：

```text
/etc/nginx/conf.d/3x-ui-customer-portal.conf
/etc/nginx/snippets/3x-ui-portal-proxy.conf
```

客户域名只放行以下资源：

- `${webBasePath}/portal` 和 `${webBasePath}/portal/`；
- `${webBasePath}/portal/api/*`；
- 门户使用的 `assets`、PWA 和图标资源。

后台的 `${webBasePath}/panel`、`${webBasePath}/panel/api` 等路径在客户域名上返回 `404`。后台仍可通过原来的地址访问。

## 证书示例

```bash
certbot certonly --nginx -d user.example.com
```

证书签发后，再运行一次菜单中的配置生成项，默认会读取：

```text
/etc/letsencrypt/live/user.example.com/fullchain.pem
/etc/letsencrypt/live/user.example.com/privkey.pem
```

如果使用其他证书位置，直接在菜单中填写完整路径。

## 注意

- 客户端订阅链接仍按后台的订阅设置生成；客户门户只负责登录、节点展示、卡密充值和按月续期。
- 这套配置不会把 XUI 的后台端口改成公网不可达，也不会改变已有后台入口。如需进一步隐藏后台端口，可另行把 XUI 监听 IP 改为 `127.0.0.1`，但那属于单独的部署调整。
