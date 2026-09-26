package controller

import (
	"net/http"
	"strings"

	"github.com/wstimin/shiye-3x-ui/v3/internal/database"
	"github.com/wstimin/shiye-3x-ui/v3/internal/database/model"
	"github.com/wstimin/shiye-3x-ui/v3/internal/web/middleware"
	"github.com/wstimin/shiye-3x-ui/v3/internal/web/service"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	gsessions "github.com/gorilla/sessions"
)

const portalSessionKey = "portal_user"

// Portal session store: same secret as admin, separate cookie name, so the
// two logins never share state. Set once at router init via SetPortalSessionStore.
var portalStore sessions.Store

// SetPortalSessionStore installs the portal cookie store (called from web.go).
func SetPortalSessionStore(secret []byte, opts sessions.Options) {
	st := cookie.NewStore(secret)
	st.Options(opts)
	portalStore = st
}

// PortalController serves the customer login portal: auth + the customer's
// own nodes, wallet and renewal. It mounts at /portal and /portal/api on the
// same engine/port as the admin panel and never touches admin state.
type PortalController struct {
	BaseController
	clientService  service.ClientService
	inboundService service.InboundService
	settingService service.SettingService
}

// NewPortalController registers portal page + API routes.
func NewPortalController(g *gin.RouterGroup) *PortalController {
	a := &PortalController{}
	a.initRouter(g)
	return a
}

func (a *PortalController) initRouter(g *gin.RouterGroup) {
	g.GET("/portal", a.portalPage)
	g.GET("/portal/", a.portalPage)

	api := g.Group("/portal/api")
	api.GET("/plans", a.publicPlans)
	api.POST("/auth/login", a.login)
	api.POST("/auth/logout", a.logout)
	authed := api.Group("", a.checkPortalLogin)
	authed.GET("/auth/me", a.me)
	authed.GET("/nodes", a.nodes)
	authed.GET("/sub/links", a.subLinks)
	authed.POST("/wallet/redeem", a.redeem)
	authed.GET("/wallet/txns", a.txns)
	authed.POST("/billing/renew", a.renew)

	// This controller registers the portal admin routes separately from the
	// main API controller, so attach the same API protections explicitly.
	admin := g.Group("/panel/api/portal")
	apiAuth := &APIController{}
	admin.Use(apiAuth.checkAPIAuth)
	admin.Use(apiAuth.enforceTokenScope)
	admin.Use(middleware.ConfigEnvelopeMiddleware())
	admin.Use(middleware.CSRFMiddleware())
	admin.GET("/customers", a.adminListCustomers)
	admin.POST("/customers", a.adminCreateCustomer)
	admin.POST("/customers/:username", a.adminUpdateCustomer)
	admin.POST("/customers/:username/delete", a.adminDeleteCustomer)
	admin.POST("/coupons/generate", a.adminGenerateCoupons)
	admin.GET("/coupons", a.adminListCoupons)
	admin.POST("/coupons/:id/disable", a.adminDisableCoupon)
	admin.GET("/billing", a.adminGetBilling)
	admin.POST("/billing", a.adminUpdateBilling)
}

// portalSession returns the customer-portal session (separate cookie),
// mirroring gin-contrib's own session struct (lazy load + writer-bound save).
func portalSession(c *gin.Context) sessions.Session {
	if portalStore == nil {
		return stubPortalSession()
	}
	return &portalGinSession{store: portalStore, name: "customer-portal", request: c.Request, writer: c.Writer}
}

// portalGinSession is gin-contrib's session struct reimplemented for the
// second cookie name; the shared DefaultKey slot can only hold one.
type portalGinSession struct {
	store   sessions.Store
	sess    *gsessions.Session
	name    string
	request *http.Request
	writer  http.ResponseWriter
	written bool
}

func (p *portalGinSession) load() *gsessions.Session {
	if p.sess == nil {
		p.sess, _ = p.store.Get(p.request, p.name)
		if p.sess == nil {
			p.sess, _ = p.store.New(p.request, p.name)
		}
	}
	return p.sess
}

func (p *portalGinSession) ID() string       { return p.load().ID }
func (p *portalGinSession) Get(k any) any    { return p.load().Values[k] }
func (p *portalGinSession) Set(k any, v any) { p.load().Values[k] = v; p.written = true }
func (p *portalGinSession) Delete(k any)     { delete(p.load().Values, k); p.written = true }
func (p *portalGinSession) Clear() {
	for k := range p.load().Values {
		delete(p.load().Values, k)
	}
	p.written = true
}
func (p *portalGinSession) AddFlash(v any, _ ...string) { p.Set("_flash", v) }
func (p *portalGinSession) Flashes(_ ...string) []any   { return nil }
func (p *portalGinSession) Options(o sessions.Options) {
	p.load().Options = o.ToGorillaOptions()
	p.written = true
}

func (p *portalGinSession) Save() error {
	if !p.written || p.sess == nil {
		return nil
	}
	if err := p.sess.Save(p.request, p.writer); err != nil {
		return err
	}
	p.written = false
	return nil
}

// stubPortalSession keeps unit tests (no portal store) functional.
func stubPortalSession() sessions.Session {
	return &portalMemSession{data: map[any]any{}}
}

type portalMemSession struct {
	data map[any]any
}

func (m *portalMemSession) ID() string                  { return "test" }
func (m *portalMemSession) Get(k any) any               { return m.data[k] }
func (m *portalMemSession) Set(k any, v any)            { m.data[k] = v }
func (m *portalMemSession) Delete(k any)                { delete(m.data, k) }
func (m *portalMemSession) Clear()                      { m.data = map[any]any{} }
func (m *portalMemSession) AddFlash(v any, _ ...string) { m.data["_flash"] = v }
func (m *portalMemSession) Flashes(_ ...string) []any   { return nil }
func (m *portalMemSession) Options(_ sessions.Options)  {}
func (m *portalMemSession) Save() error                 { return nil }

// portalPage serves the portal SPA shell.
func (a *PortalController) portalPage(c *gin.Context) {
	serveDistPage(c, "portal.html")
}

// checkPortalLogin guards authed portal routes via the portal session.
func (a *PortalController) checkPortalLogin(c *gin.Context) {
	s := portalSession(c)
	username, _ := s.Get(portalSessionKey).(string)
	if strings.TrimSpace(username) == "" {
		if isAjax(c) {
			pureJsonMsg(c, http.StatusUnauthorized, false, "login required")
		} else {
			c.Header("Cache-Control", "no-store")
			c.Redirect(http.StatusTemporaryRedirect, c.GetString("base_path")+"portal")
		}
		c.Abort()
		return
	}
	var acc model.CustomerAccount
	if err := database.GetDB().Where("username = ?", username).First(&acc).Error; err != nil {
		c.Abort()
		pureJsonMsg(c, http.StatusUnauthorized, false, "login required")
		return
	}
	if !acc.Enable {
		c.Abort()
		pureJsonMsg(c, http.StatusUnauthorized, false, "login required")
		return
	}
	if epoch, _ := s.Get("portal_epoch").(int64); epoch != acc.LoginEpoch {
		c.Abort()
		pureJsonMsg(c, http.StatusUnauthorized, false, "login required")
		return
	}
	c.Set("portal_username", acc.Username)
	c.Set("portal_email", acc.Email)
	c.Next()
}

type portalLoginForm struct {
	Username string `json:"username" form:"username"`
	Password string `json:"password" form:"password"`
}

// login authenticates a customer and opens a portal session.
func (a *PortalController) login(c *gin.Context) {
	var form portalLoginForm
	if err := c.ShouldBind(&form); err != nil {
		pureJsonMsg(c, http.StatusOK, false, "invalid request")
		return
	}
	if strings.TrimSpace(form.Username) == "" || form.Password == "" {
		pureJsonMsg(c, http.StatusOK, false, "invalid credentials")
		return
	}
	remoteIP := getRemoteIp(c)
	if blockedUntil, ok := defaultLoginLimiter.allow(remoteIP, "portal:"+form.Username); !ok {
		_ = blockedUntil
		pureJsonMsg(c, http.StatusOK, false, "invalid credentials")
		return
	}
	acc, err := a.clientService.CheckCustomer(form.Username, form.Password)
	if err != nil {
		defaultLoginLimiter.registerFailure(remoteIP, "portal:"+form.Username)
		pureJsonMsg(c, http.StatusOK, false, "invalid credentials")
		return
	}
	defaultLoginLimiter.registerSuccess(remoteIP, "portal:"+form.Username)
	s := portalSession(c)
	s.Set(portalSessionKey, acc.Username)
	s.Set("portal_epoch", acc.LoginEpoch)
	if err := s.Save(); err != nil {
		pureJsonMsg(c, http.StatusOK, false, "login failed")
		return
	}
	// Portal POSTs carry no CSRF middleware; the SameSite=Lax session
	// cookie blocks cross-site POST navigation, matching the sub server.
	pureJsonMsg(c, http.StatusOK, true, "ok")
}

// logout closes the portal session only; the admin session is untouched.
func (a *PortalController) logout(c *gin.Context) {
	s := portalSession(c)
	s.Clear()
	_ = s.Save()
	pureJsonMsg(c, http.StatusOK, true, "ok")
}

// portalAuthed resolves username+email set by checkPortalLogin.
func portalAuthed(c *gin.Context) (string, string) {
	u, _ := c.Get("portal_username")
	e, _ := c.Get("portal_email")
	username, _ := u.(string)
	email, _ := e.(string)
	return username, email
}

// me returns the customer's balance, expiry and traffic summary.
func (a *PortalController) me(c *gin.Context) {
	username, email := portalAuthed(c)
	var acc model.CustomerAccount
	if err := database.GetDB().Where("username = ?", username).First(&acc).Error; err != nil {
		jsonMsg(c, "", err)
		return
	}
	traffic, err := a.inboundService.GetClientTrafficByEmail(email)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	rec, err := a.clientService.GetRecordByEmail(database.GetDB(), email)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, gin.H{
		"username": username, "email": email,
		"balanceCents": acc.BalanceCents,
		"expiryTime":   rec.ExpiryTime,
		"traffic":      traffic,
	}, nil)
}

// portalNode is the whitelisted node view: no tag/port/listen/settings.
type portalNode struct {
	Remark   string `json:"remark"`
	Protocol string `json:"protocol"`
	Enable   bool   `json:"enable"`
	Up       int64  `json:"up"`
	Down     int64  `json:"down"`
	Total    int64  `json:"total"`
	Expiry   int64  `json:"expiryTime"`
}

// nodes lists the customer's own nodes with traffic.
func (a *PortalController) nodes(c *gin.Context) {
	_, email := portalAuthed(c)
	rec, err := a.clientService.GetRecordByEmail(database.GetDB(), email)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	inboundIds, err := a.clientService.GetInboundIdsForEmail(database.GetDB(), email)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	out := make([]portalNode, 0, len(inboundIds))
	for _, id := range inboundIds {
		ib, err := a.inboundService.GetInbound(id)
		if err != nil {
			continue
		}
		if !ib.Enable {
			continue
		}
		node := portalNode{Remark: ib.Remark, Protocol: string(ib.Protocol), Enable: true, Expiry: rec.ExpiryTime}
		if t, err := a.inboundService.GetClientTrafficByEmail(email); err == nil && t != nil {
			node.Enable = t.Enable
			node.Up, node.Down, node.Total = t.Up, t.Down, t.Total
		}
		out = append(out, node)
	}
	jsonObj(c, out, nil)
}

// subLinks returns the customer's share links + raw/JSON/Clash sub URLs.
// JSON/Clash URLs appear only when the admin enabled them (parity).
func (a *PortalController) subLinks(c *gin.Context) {
	_, email := portalAuthed(c)
	host := resolveHost(c)
	links, err := a.inboundService.GetAllClientLinks(host, email)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	rec, err := a.clientService.GetRecordByEmail(database.GetDB(), email)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	subPath, _ := a.settingService.GetSubPath()
	subJSONPath, _ := a.settingService.GetSubJsonPath()
	subClashPath, _ := a.settingService.GetSubClashPath()
	subURI, _ := a.settingService.GetSubURI()
	subJSONURI, _ := a.settingService.GetSubJsonURI()
	subClashURI, _ := a.settingService.GetSubClashURI()
	subJSONEnable, _ := a.settingService.GetSubJsonEnable()
	subClashEnable, _ := a.settingService.GetSubClashEnable()
	base := a.settingService.BuildSubURIBase(host)
	join := func(u, id string) string {
		if u == "" || id == "" {
			return ""
		}
		if strings.HasSuffix(u, "/") {
			return u + id
		}
		return u + "/" + id
	}
	single := func(configured, basePath, id string) string {
		if configured != "" {
			return join(configured, id)
		}
		return join(base+basePath, id)
	}
	resp := gin.H{"links": links}
	if subID := rec.SubID; subID != "" {
		resp["subUrl"] = single(subURI, subPath, subID)
		if subJSONEnable {
			resp["subJsonUrl"] = single(subJSONURI, subJSONPath, subID)
		}
		if subClashEnable {
			resp["subClashUrl"] = single(subClashURI, subClashPath, subID)
		}
	}
	jsonObj(c, resp, nil)
}

type redeemForm struct {
	Code string `json:"code"`
}

// redeem converts a coupon code into balance.
func (a *PortalController) redeem(c *gin.Context) {
	username, _ := portalAuthed(c)
	var form redeemForm
	if err := c.ShouldBindJSON(&form); err != nil {
		jsonMsg(c, "", err)
		return
	}
	balance, err := a.clientService.RedeemCoupon(username, form.Code)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, gin.H{"balanceCents": balance}, nil)
}

// txns lists the customer's own wallet ledger.
func (a *PortalController) txns(c *gin.Context) {
	username, _ := portalAuthed(c)
	var rows []model.WalletTxn
	if err := database.GetDB().Where("username = ?", username).
		Order("id DESC").Limit(100).Find(&rows).Error; err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, rows, nil)
}

// publicPlans exposes monthly billing info and the separate purchase URL (no auth).
func (a *PortalController) publicPlans(c *gin.Context) {
	price, _ := a.settingService.GetPortalPricePerMonthCents()
	plans, _ := a.settingService.GetPortalPlans()
	purchaseURL, _ := a.settingService.GetPortalPurchaseURL()
	title, _ := a.settingService.GetPortalSiteTitle()
	jsonObj(c, gin.H{
		"pricePerMonthCents": price, "plans": plans,
		"purchaseUrl": purchaseURL, "siteTitle": title,
	}, nil)
}

type renewForm struct {
	Months int `json:"months"`
}

// renew extends the customer's expiry by calendar months, charged from balance.
func (a *PortalController) renew(c *gin.Context) {
	username, _ := portalAuthed(c)
	var form renewForm
	if err := c.ShouldBindJSON(&form); err != nil {
		jsonMsg(c, "", err)
		return
	}
	newExpiry, balance, err := a.clientService.RenewCustomer(&a.inboundService, username, form.Months)
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, gin.H{"expiryTime": newExpiry, "balanceCents": balance}, nil)
}

// Admin surface below: mounted under /panel/api, so the API controller's
// session/token auth + CSRF already guard every route. Responses omit
// password hashes and coupon plaintext (hashes only, one-shot on create).

type adminCustomerForm struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Email    string `json:"email"`
	Enable   *bool  `json:"enable"`
}

// adminListCustomers returns portal logins (no password hashes) newest first.
func (a *PortalController) adminListCustomers(c *gin.Context) {
	var rows []model.CustomerAccount
	if err := database.GetDB().Order("id DESC").Limit(500).Find(&rows).Error; err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		out = append(out, gin.H{
			"username": r.Username, "email": r.Email,
			"balanceCents": r.BalanceCents, "enable": r.Enable,
			"createdAt": r.CreatedAt, "updatedAt": r.UpdatedAt,
		})
	}
	jsonObj(c, out, nil)
}

// adminCreateCustomer binds a portal login to a client email at creation time.
func (a *PortalController) adminCreateCustomer(c *gin.Context) {
	var form adminCustomerForm
	if err := c.ShouldBindJSON(&form); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	acc, err := a.clientService.CreateCustomer(form.Username, form.Password, form.Email)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, gin.H{"username": acc.Username, "email": acc.Email, "enable": acc.Enable}, nil)
}

// adminUpdateCustomer rotates the password and/or flips the enable switch.
// A password change bumps the epoch so live portal sessions drop.
func (a *PortalController) adminUpdateCustomer(c *gin.Context) {
	username := c.Param("username")
	var form adminCustomerForm
	if err := c.ShouldBindJSON(&form); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	if form.Enable != nil {
		if err := a.clientService.SetCustomerEnable(username, *form.Enable); err != nil {
			jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
			return
		}
	}
	if strings.TrimSpace(form.Password) != "" {
		if err := a.clientService.SetCustomerPassword(username, form.Password); err != nil {
			jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
			return
		}
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientUpdateSuccess"), nil)
}

// adminDeleteCustomer removes the login and its wallet ledger, not the client.
func (a *PortalController) adminDeleteCustomer(c *gin.Context) {
	username := strings.TrimSpace(c.Param("username"))
	db := database.GetDB()
	if err := db.Where("username = ?", username).Delete(&model.CustomerAccount{}).Error; err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	_ = db.Where("username = ?", username).Delete(&model.WalletTxn{}).Error
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientDeleteSuccess"), nil)
}

type adminCouponForm struct {
	Count       int    `json:"count"`
	AmountCents int64  `json:"amountCents"`
	Prefix      string `json:"prefix"`
	BatchNo     string `json:"batchNo"`
	ExpiresAt   int64  `json:"expiresAt"`
}

// adminGenerateCoupons mints a batch and returns plaintext once for display.
func (a *PortalController) adminGenerateCoupons(c *gin.Context) {
	var form adminCouponForm
	if err := c.ShouldBindJSON(&form); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	codes, err := a.clientService.GenerateCoupons(form.Count, form.AmountCents, form.Prefix, form.BatchNo, form.ExpiresAt)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonObj(c, gin.H{"codes": codes}, nil)
}

// adminListCoupons lists batches newest first; hashes stay server-side.
func (a *PortalController) adminListCoupons(c *gin.Context) {
	var rows []model.CouponCode
	if err := database.GetDB().Order("id DESC").Limit(500).Find(&rows).Error; err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		out = append(out, gin.H{
			"id": r.Id, "amountCents": r.AmountCents, "status": r.Status,
			"batchNo": r.BatchNo, "source": r.Source, "usedBy": r.UsedBy,
			"usedAt": r.UsedAt, "expiresAt": r.ExpiresAt, "createdAt": r.CreatedAt,
		})
	}
	jsonObj(c, out, nil)
}

// adminDisableCoupon voids an unused code so it can never be redeemed.
func (a *PortalController) adminDisableCoupon(c *gin.Context) {
	id := c.Param("id")
	if err := database.GetDB().Model(&model.CouponCode{}).
		Where("id = ? AND status = ?", id, service.CouponStatusUnused).
		Update("status", service.CouponStatusDisabled).Error; err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientUpdateSuccess"), nil)
}

// adminGetBilling returns the portal pricing + branding the admin configured.
func (a *PortalController) adminGetBilling(c *gin.Context) {
	price, _ := a.settingService.GetPortalPricePerMonthCents()
	plans, _ := a.settingService.GetPortalPlans()
	purchaseURL, _ := a.settingService.GetPortalPurchaseURL()
	title, _ := a.settingService.GetPortalSiteTitle()
	providerURL, _ := a.settingService.GetPortalCardProviderURL()
	jsonObj(c, gin.H{
		"pricePerMonthCents": price, "plans": plans,
		"purchaseUrl": purchaseURL, "siteTitle": title,
		"cardProviderUrl": providerURL, "cardProviderConfigured": providerURL != "",
	}, nil)
}

type adminBillingForm struct {
	PricePerMonthCents int64  `json:"pricePerMonthCents"`
	Plans              string `json:"plans"`
	PurchaseURL        string `json:"purchaseUrl"`
	SiteTitle          string `json:"siteTitle"`
	CardProviderURL    string `json:"cardProviderUrl"`
	CardProviderSecret string `json:"cardProviderSecret"`
	CardProviderSign   string `json:"cardProviderSign"`
}

// adminUpdateBilling persists monthly price, plan presets, purchase URL, title.
func (a *PortalController) adminUpdateBilling(c *gin.Context) {
	var form adminBillingForm
	if err := c.ShouldBindJSON(&form); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	if err := a.settingService.SetPortalPricePerMonthCents(form.PricePerMonthCents); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	if err := a.settingService.SetPortalPlans(form.Plans); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	if err := a.settingService.SetPortalPurchaseURL(form.PurchaseURL); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	if err := a.settingService.SetPortalSiteTitle(form.SiteTitle); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	if err := a.settingService.SetPortalCardProviderURL(form.CardProviderURL); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	if strings.TrimSpace(form.CardProviderSecret) != "" {
		if err := a.settingService.SetPortalCardProviderSecret(form.CardProviderSecret); err != nil {
			jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
			return
		}
	}
	if err := a.settingService.SetPortalCardProviderSign(form.CardProviderSign); err != nil {
		jsonMsg(c, I18nWeb(c, "somethingWentWrong"), err)
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.inbounds.toasts.inboundClientUpdateSuccess"), nil)
}
