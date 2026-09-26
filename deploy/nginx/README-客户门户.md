# 客户门户独立域名

客户门户和现有后台仍由同一个 XUI 进程提供服务。Nginx 只负责提供客户域名入口；要真正隐藏 XUI 后台端口，还必须把 XUI 监听地址改为 `127.0.0.1`。

## 推荐配置

1. 把 `user.example.com` 的 DNS A/AAAA 记录指向服务器。
2. 在服务器执行 `x-ui`，进入 `29. 客户门户管理` → `3. 设置/修改客户域名并生效`。
3. 输入客户域名和证书路径。没有证书时会先生成 HTTP 配置；申请证书后再次运行该项即可切换到 HTTPS。
4. 让 Nginx 通过 `80/443` 接收客户请求并转发到本机 XUI 端口。
5. 如果不希望后台端口暴露公网，在同一个菜单进入第 4 项，选择“启用安全模式”。这会让 XUI 只监听 `127.0.0.1`，客户域名仍可正常访问。

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

后台的 `${webBasePath}/panel`、`${webBasePath}/panel/api` 等路径在客户域名上返回 `404`。

启用安全模式后，后台不能再通过公网 `服务器IP:后台端口` 直接访问。管理员可通过 SSH 隧道访问：

```bash
ssh -L 2222:127.0.0.1:后台端口 root@服务器公网IP
```

然后打开 `http://127.0.0.1:2222`。如需后台独立域名，应另建一个仅允许管理员访问的 Nginx 站点，并继续把上游指向 `127.0.0.1:后台端口`。

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
- 客户账号创建时绑定的是后台已有客户端邮箱；这个绑定决定用户能看到哪些节点和订阅链接。门户的月价是通用价格，按“月数 × 每月价格”从余额扣除，不会把不同链接自动分成不同价格。
- 购买链接是独立跳转地址，只用于用户购买卡密；三方卡密接口只负责接口预留，两者不会互相绑定。
- Nginx 只隐藏后台路径，不能隐藏仍绑定在公网地址上的监听端口。需要隐藏端口时必须启用菜单第 4 项安全模式。
