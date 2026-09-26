package service

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wstimin/shiye-3x-ui/v3/internal/database"
	"github.com/wstimin/shiye-3x-ui/v3/internal/database/model"
	"github.com/wstimin/shiye-3x-ui/v3/internal/util/common"
	"github.com/wstimin/shiye-3x-ui/v3/internal/util/crypto"
	"github.com/wstimin/shiye-3x-ui/v3/internal/util/random"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Portal billing setting keys (plain key-value rows, not AllSetting fields).
const (
	PortalPricePerDayCentsKey   = "portal.pricePerDayCents"
	PortalPricePerMonthCentsKey = "portal.pricePerMonthCents"
	PortalPlansKey              = "portal.plans"
	PortalPurchaseURLKey        = "portal.purchaseUrl"
	PortalSiteTitleKey          = "portal.siteTitle"
	PortalCardProviderURLKey    = "portal.cardProviderUrl"
	PortalCardProviderSecretKey = "portal.cardProviderSecret"
	PortalCardProviderSignKey   = "portal.cardProviderSign"
	PortalEnabledKey            = "portal.enabled"
	PortalListenKey             = "portal.listen"
	PortalPortKey               = "portal.port"
	PortalPublicURLKey          = "portal.publicUrl"
	PortalDefaultSiteTitle      = "X用户中心"

	CouponStatusUnused   = "unused"
	CouponStatusUsed     = "used"
	CouponStatusDisabled = "disabled"
	CouponStatusExpired  = "expired"

	WalletKindRedeem = "redeem"
	WalletKindRenew  = "renew"
	WalletKindAdjust = "adjust"
)

// maxPortalUsername caps credential length before bcrypt (72-byte limit).
const maxPortalUsername = 64

// Client expiry is updated through the existing client-apply path after the
// wallet transaction commits. Serialize portal renewals so two requests cannot
// both calculate from the same pre-update expiry and charge twice for one
// extension.
var portalRenewMu sync.Mutex

// PortalSettings is the complete persisted configuration for the independent
// customer portal. Saving it as one unit prevents a request from leaving only
// some form fields updated when a later field is invalid.
type PortalSettings struct {
	PricePerMonthCents int64
	Plans              string
	PurchaseURL        string
	SiteTitle          string
	CardProviderURL    string
	CardProviderSecret string
	CardProviderSign   string
	Enabled            bool
	Listen             string
	Port               int
	PublicURL          string
}

func normalizePortalPlans(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "[1,3,6]", nil
	}
	var values []any
	if err := json.Unmarshal([]byte(raw), &values); err != nil || len(values) == 0 {
		return "", common.NewError("renewal month options must be a non-empty JSON array")
	}
	seen := make(map[int]bool, len(values))
	for _, value := range values {
		months := 0
		switch item := value.(type) {
		case float64:
			months = int(item)
			if item != float64(months) {
				return "", common.NewError("renewal months must be whole numbers")
			}
		case map[string]any:
			number, ok := item["months"].(float64)
			months = int(number)
			if !ok || number != float64(months) {
				return "", common.NewError("each renewal option must contain a whole-number months value")
			}
		default:
			return "", common.NewError("invalid renewal month option")
		}
		if months < 1 || months > 120 {
			return "", common.NewError("renewal months must be between 1 and 120")
		}
		if seen[months] {
			return "", common.NewError("renewal month options cannot contain duplicates")
		}
		seen[months] = true
	}
	canonical, err := json.Marshal(values)
	if err != nil {
		return "", err
	}
	return string(canonical), nil
}

func (s *SettingService) normalizePortalSettings(settings PortalSettings) (PortalSettings, error) {
	if settings.PricePerMonthCents < 0 || (strconv.IntSize == 32 && settings.PricePerMonthCents > int64(^uint32(0)>>1)) {
		return settings, common.NewError("monthly price is outside the supported range")
	}
	plans, err := normalizePortalPlans(settings.Plans)
	if err != nil {
		return settings, err
	}
	purchaseURL, err := SanitizeHTTPURL(settings.PurchaseURL)
	if err != nil {
		return settings, err
	}
	providerURL, err := SanitizeHTTPURL(settings.CardProviderURL)
	if err != nil {
		return settings, err
	}
	publicURL, err := SanitizeHTTPURL(settings.PublicURL)
	if err != nil {
		return settings, err
	}
	settings.Listen = strings.TrimSpace(settings.Listen)
	if settings.Listen == "" {
		settings.Listen = "0.0.0.0"
	}
	if net.ParseIP(settings.Listen) == nil {
		return settings, common.NewError("portal listen address must be an IP address")
	}
	if settings.Port < 1 || settings.Port > 65535 {
		return settings, common.NewError("portal port must be between 1 and 65535")
	}
	panelPort, err := s.GetPort()
	if err != nil {
		return settings, err
	}
	if settings.Port == panelPort {
		return settings, common.NewError("portal port must differ from panel port")
	}
	settings.Plans = plans
	settings.PurchaseURL = purchaseURL
	settings.SiteTitle = strings.TrimSpace(settings.SiteTitle)
	if settings.SiteTitle == "" {
		settings.SiteTitle = PortalDefaultSiteTitle
	}
	settings.CardProviderURL = providerURL
	settings.CardProviderSecret = strings.TrimSpace(settings.CardProviderSecret)
	settings.CardProviderSign = strings.TrimSpace(settings.CardProviderSign)
	settings.PublicURL = strings.TrimRight(publicURL, "/")
	return settings, nil
}

// SavePortalSettings validates every editable field first, then writes all
// values in one database transaction.
func (s *SettingService) SavePortalSettings(settings PortalSettings) (PortalSettings, error) {
	normalized, err := s.normalizePortalSettings(settings)
	if err != nil {
		return settings, err
	}
	values := map[string]string{
		PortalPricePerMonthCentsKey: strconv.FormatInt(normalized.PricePerMonthCents, 10),
		PortalPlansKey:              normalized.Plans,
		PortalPurchaseURLKey:        normalized.PurchaseURL,
		PortalSiteTitleKey:          normalized.SiteTitle,
		PortalCardProviderURLKey:    normalized.CardProviderURL,
		PortalCardProviderSecretKey: normalized.CardProviderSecret,
		PortalCardProviderSignKey:   normalized.CardProviderSign,
		PortalEnabledKey:            strconv.FormatBool(normalized.Enabled),
		PortalListenKey:             normalized.Listen,
		PortalPortKey:               strconv.Itoa(normalized.Port),
		PortalPublicURLKey:          normalized.PublicURL,
	}
	err = database.GetDB().Transaction(func(tx *gorm.DB) error {
		for key, value := range values {
			var setting model.Setting
			findErr := tx.Where("key = ?", key).First(&setting).Error
			if database.IsNotFound(findErr) {
				if err := tx.Create(&model.Setting{Key: key, Value: value}).Error; err != nil {
					return err
				}
				continue
			}
			if findErr != nil {
				return findErr
			}
			if err := tx.Model(&setting).Update("value", value).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return normalized, err
}

func (s *SettingService) GetPortalSettings() (PortalSettings, error) {
	var out PortalSettings
	var err error
	if out.PricePerMonthCents, err = s.GetPortalPricePerMonthCents(); err != nil {
		return out, err
	}
	if out.Plans, err = s.GetPortalPlans(); err != nil {
		return out, err
	}
	if out.PurchaseURL, err = s.GetPortalPurchaseURL(); err != nil {
		return out, err
	}
	if out.SiteTitle, err = s.GetPortalSiteTitle(); err != nil {
		return out, err
	}
	if out.CardProviderURL, err = s.GetPortalCardProviderURL(); err != nil {
		return out, err
	}
	if out.CardProviderSecret, err = s.GetPortalCardProviderSecret(); err != nil {
		return out, err
	}
	if out.CardProviderSign, err = s.GetPortalCardProviderSign(); err != nil {
		return out, err
	}
	if out.Enabled, err = s.GetPortalEnabled(); err != nil {
		return out, err
	}
	if out.Listen, err = s.GetPortalListen(); err != nil {
		return out, err
	}
	if out.Port, err = s.GetPortalPort(); err != nil {
		return out, err
	}
	if out.PublicURL, err = s.GetPortalPublicURL(); err != nil {
		return out, err
	}
	return out, nil
}

// CreateCustomer creates a portal login bound to an existing client email.
func (s *ClientService) CreateCustomer(username, password, email string, monthlyPriceCents int64) (*model.CustomerAccount, error) {
	username = strings.TrimSpace(username)
	if username == "" || len(username) > maxPortalUsername {
		return nil, common.NewError("portal username is required (max 64 chars)")
	}
	if password == "" {
		return nil, common.NewError("portal password is required")
	}
	email = strings.TrimSpace(email)
	if email == "" {
		return nil, common.NewError("client email is required")
	}
	if monthlyPriceCents <= 0 {
		return nil, common.NewError("monthly price must be positive")
	}
	db := database.GetDB()
	if _, err := s.GetRecordByEmail(db, email); err != nil {
		return nil, err
	}
	var bound int64
	if err := db.Model(&model.CustomerAccount{}).
		Where("LOWER(email) = LOWER(?)", email).Count(&bound).Error; err != nil {
		return nil, err
	}
	if bound > 0 {
		return nil, common.NewError("client is already bound to a portal account")
	}
	hash, err := crypto.HashPasswordAsBcrypt(password)
	if err != nil {
		return nil, err
	}
	acc := &model.CustomerAccount{
		Username: username, PasswordHash: hash, Email: email,
		MonthlyPriceCents: monthlyPriceCents, Enable: true,
	}
	if err := db.Create(acc).Error; err != nil {
		return nil, err
	}
	return acc, nil
}

func (s *ClientService) UpdateCustomerProfile(username, email string, monthlyPriceCents int64) error {
	username = strings.TrimSpace(username)
	email = strings.TrimSpace(email)
	if email == "" {
		return common.NewError("client email is required")
	}
	if monthlyPriceCents <= 0 {
		return common.NewError("monthly price must be positive")
	}
	db := database.GetDB()
	if _, err := s.GetRecordByEmail(db, email); err != nil {
		return err
	}
	var bound int64
	if err := db.Model(&model.CustomerAccount{}).
		Where("LOWER(email) = LOWER(?) AND username <> ?", email, username).
		Count(&bound).Error; err != nil {
		return err
	}
	if bound > 0 {
		return common.NewError("client is already bound to a portal account")
	}
	return db.Model(&model.CustomerAccount{}).Where("username = ?", username).
		Updates(map[string]any{
			"email": email, "monthly_price_cents": monthlyPriceCents,
			"updated_at": time.Now().UnixMilli(),
		}).Error
}

// CheckCustomer verifies portal credentials, returning the account row.
func (s *ClientService) CheckCustomer(username, password string) (*model.CustomerAccount, error) {
	db := database.GetDB()
	acc := &model.CustomerAccount{}
	if err := db.Where("username = ?", strings.TrimSpace(username)).First(acc).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("invalid credentials")
		}
		return nil, err
	}
	if !acc.Enable || !crypto.CheckPasswordHash(acc.PasswordHash, password) {
		return nil, errors.New("invalid credentials")
	}
	return acc, nil
}

// SetCustomerEnable toggles portal login without touching the xray client.
func (s *ClientService) SetCustomerEnable(username string, enable bool) error {
	return database.GetDB().Model(&model.CustomerAccount{}).
		Where("username = ?", strings.TrimSpace(username)).
		Update("enable", enable).Error
}

// BumpCustomerEpoch invalidates existing portal sessions (password change).
func (s *ClientService) BumpCustomerEpoch(username string) error {
	return database.GetDB().Model(&model.CustomerAccount{}).
		Where("username = ?", strings.TrimSpace(username)).
		Update("login_epoch", time.Now().UnixMilli()).Error
}

// SetCustomerPassword rotates the login password and drops live sessions.
func (s *ClientService) SetCustomerPassword(username, password string) error {
	if strings.TrimSpace(password) == "" {
		return common.NewError("portal password is required")
	}
	hash, err := crypto.HashPasswordAsBcrypt(password)
	if err != nil {
		return err
	}
	db := database.GetDB()
	if err := db.Model(&model.CustomerAccount{}).
		Where("username = ?", strings.TrimSpace(username)).
		Updates(map[string]any{"password_hash": hash, "updated_at": time.Now().UnixMilli()}).Error; err != nil {
		return err
	}
	return s.BumpCustomerEpoch(username)
}

// GenerateCoupons mints count pure-amount codes, returning plaintext once.
// Only SHA-256 hashes persist, mirroring the ApiToken one-shot pattern.
func (s *ClientService) GenerateCoupons(count int, amountCents int64, prefix, batchNo string, expiresAt int64) ([]string, error) {
	if count < 1 || count > 1000 {
		return nil, common.NewError("coupon count must be 1-1000")
	}
	if amountCents <= 0 {
		return nil, common.NewError("coupon amount must be positive")
	}
	if batchNo == "" {
		batchNo = random.NumLower(8)
	}
	codes := make([]string, 0, count)
	rows := make([]model.CouponCode, 0, count)
	for range count {
		code := prefix + random.Seq(12)
		codes = append(codes, code)
		rows = append(rows, model.CouponCode{
			CodeHash: crypto.HashTokenSHA256(code), AmountCents: amountCents,
			Status: CouponStatusUnused, BatchNo: batchNo, Source: "local", ExpiresAt: expiresAt,
		})
	}
	if err := database.GetDB().Create(&rows).Error; err != nil {
		return nil, err
	}
	return codes, nil
}

// RedeemCoupon atomically consumes a code into the account balance.
func (s *ClientService) RedeemCoupon(username, code string) (int64, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return 0, common.NewError("coupon code is required")
	}
	db := database.GetDB()
	var balance int64
	err := db.Transaction(func(tx *gorm.DB) error {
		var acc model.CustomerAccount
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("username = ?", strings.TrimSpace(username)).First(&acc).Error; err != nil {
			return err
		}
		if !acc.Enable {
			return common.NewError("account is disabled")
		}
		var cp model.CouponCode
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("code_hash = ?", crypto.HashTokenSHA256(code)).First(&cp).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewError("invalid coupon code")
			}
			return err
		}
		now := time.Now().UnixMilli()
		switch {
		case cp.Status != CouponStatusUnused:
			return common.NewError("coupon already used")
		case cp.ExpiresAt != 0 && cp.ExpiresAt <= now:
			_ = tx.Model(&cp).Update("status", CouponStatusExpired).Error
			return common.NewError("coupon expired")
		}
		cp.Status, cp.UsedBy, cp.UsedAt = CouponStatusUsed, acc.Username, now
		if err := tx.Save(&cp).Error; err != nil {
			return err
		}
		balance = acc.BalanceCents + cp.AmountCents
		if err := tx.Model(&acc).Updates(map[string]any{
			"balance_cents": balance, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		return tx.Create(&model.WalletTxn{
			Username: acc.Username, Kind: WalletKindRedeem,
			AmountCents: cp.AmountCents, BalanceAfter: balance, Ref: cp.BatchNo,
		}).Error
	})
	if err != nil {
		return 0, err
	}
	return balance, nil
}

// SpendBalance deducts cents and appends the ledger row inside caller's tx.
func spendBalance(tx *gorm.DB, acc *model.CustomerAccount, amount int64, kind, ref string) (int64, error) {
	if amount <= 0 {
		return acc.BalanceCents, common.NewError("amount must be positive")
	}
	if acc.BalanceCents < amount {
		return acc.BalanceCents, common.NewError("insufficient balance")
	}
	balance := acc.BalanceCents - amount
	now := time.Now().UnixMilli()
	if err := tx.Model(acc).Updates(map[string]any{
		"balance_cents": balance, "updated_at": now,
	}).Error; err != nil {
		return acc.BalanceCents, err
	}
	if err := tx.Create(&model.WalletTxn{
		Username: acc.Username, Kind: kind,
		AmountCents: -amount, BalanceAfter: balance, Ref: ref,
	}).Error; err != nil {
		return acc.BalanceCents, err
	}
	acc.BalanceCents = balance
	return balance, nil
}

// MatchCouponHash constant-time matches a presented code (admin verify path).
func MatchCouponHash(presented string, hash string) bool {
	if presented == "" || hash == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(crypto.HashTokenSHA256(presented)), []byte(hash)) == 1
}

// RenewCustomer charges calendar months at the monthly price and extends the client's
// expiry to max(now, current) + months. Unlimited-expiry (0) clients cannot
// renew through the portal; an admin must change their plan instead.
func (s *ClientService) RenewCustomer(inboundSvc *InboundService, username string, months int) (int64, int64, error) {
	if months < 1 || months > 120 {
		return 0, 0, common.NewError("renew months must be 1-120")
	}
	portalRenewMu.Lock()
	defer portalRenewMu.Unlock()
	db := database.GetDB()
	var acc model.CustomerAccount
	if err := db.Where("username = ?", strings.TrimSpace(username)).First(&acc).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, 0, common.NewError("account not found")
		}
		return 0, 0, err
	}
	if !acc.Enable {
		return 0, acc.BalanceCents, common.NewError("account is disabled")
	}
	price := acc.MonthlyPriceCents
	if price <= 0 {
		var err error
		price, err = (&SettingService{}).GetPortalPricePerMonthCents()
		if err != nil {
			return 0, acc.BalanceCents, err
		}
	}
	cost := int64(months) * price
	if cost <= 0 {
		return 0, acc.BalanceCents, common.NewError("monthly price is not configured")
	}
	// Charge first (atomic sufficiency check), then extend; a failed
	// extension refunds with an adjust ledger row for admin reconciliation.
	var balance, newExpiry int64
	if err := db.Transaction(func(tx *gorm.DB) error {
		var locked model.CustomerAccount
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("username = ?", acc.Username).First(&locked).Error; err != nil {
			return err
		}
		if !locked.Enable {
			return common.NewError("account is disabled")
		}
		rec, err := s.GetRecordByEmail(tx, locked.Email)
		if err != nil {
			return err
		}
		if rec.ExpiryTime == 0 {
			return common.NewError("unlimited client cannot renew through portal")
		}
		now := time.Now().UnixMilli()
		base := rec.ExpiryTime
		if base < now {
			base = now
		}
		newExpiry = time.UnixMilli(base).AddDate(0, months, 0).UnixMilli()
		b, err := spendBalance(tx, &locked, cost, WalletKindRenew, "months")
		if err != nil {
			return err
		}
		balance = b
		acc = locked
		return nil
	}); err != nil {
		return 0, acc.BalanceCents, err
	}
	if _, err := s.ResetClientExpiryTimeByEmail(inboundSvc, acc.Email, newExpiry); err != nil {
		_ = db.Transaction(func(tx *gorm.DB) error {
			var locked model.CustomerAccount
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("username = ?", acc.Username).First(&locked).Error; err != nil {
				return err
			}
			balance = locked.BalanceCents + cost
			if err := tx.Model(&locked).Updates(map[string]any{
				"balance_cents": balance, "updated_at": time.Now().UnixMilli(),
			}).Error; err != nil {
				return err
			}
			return tx.Create(&model.WalletTxn{
				Username: locked.Username, Kind: WalletKindAdjust,
				AmountCents: cost, BalanceAfter: balance, Ref: "renew-refund",
			}).Error
		})
		return 0, balance, err
	}
	// Re-enable a client disabled by expiry/depletion when it is valid again.
	if traffic, tErr := inboundSvc.GetClientTrafficByEmail(acc.Email); tErr == nil && traffic != nil && !traffic.Enable {
		stillExpired := newExpiry > 0 && newExpiry <= time.Now().UnixMilli()
		stillDepleted := traffic.Total > 0 && traffic.Up+traffic.Down >= traffic.Total
		if !stillExpired && !stillDepleted {
			_, _, _ = s.BulkSetEnable(inboundSvc, []string{acc.Email}, true)
		}
	}
	return newExpiry, balance, nil
}

// Portal billing settings: plain key-value rows outside AllSetting.
func (s *SettingService) GetPortalPricePerDayCents() (int64, error) {
	v, err := s.getInt(PortalPricePerDayCentsKey)
	return int64(v), err
}

func (s *SettingService) GetPortalPricePerMonthCents() (int64, error) {
	v, err := s.getInt(PortalPricePerMonthCentsKey)
	if err == nil && v > 0 {
		return int64(v), nil
	}
	// Backward-compatible fallback for installations that used the earlier
	// daily key. Convert the old unit to a 30-day monthly amount instead of
	// silently treating a daily price as a monthly price.
	daily, dailyErr := s.GetPortalPricePerDayCents()
	if dailyErr != nil {
		return 0, dailyErr
	}
	if daily > 0 && daily > int64(^uint64(0)>>1)/30 {
		return 0, common.NewError("monthly price is too large")
	}
	return daily * 30, nil
}

func (s *SettingService) SetPortalPricePerMonthCents(cents int64) error {
	if cents < 0 {
		return common.NewError("monthly price cannot be negative")
	}
	return s.setInt(PortalPricePerMonthCentsKey, int(cents))
}

func (s *SettingService) SetPortalPricePerDayCents(cents int64) error {
	if cents < 0 {
		return common.NewError("daily price cannot be negative")
	}
	return s.setInt(PortalPricePerDayCentsKey, int(cents))
}

func (s *SettingService) GetPortalPlans() (string, error) {
	return s.getString(PortalPlansKey)
}

func (s *SettingService) SetPortalPlans(raw string) error {
	return s.setString(PortalPlansKey, raw)
}

func (s *SettingService) GetPortalPurchaseURL() (string, error) {
	return s.getString(PortalPurchaseURLKey)
}

func (s *SettingService) SetPortalPurchaseURL(raw string) error {
	clean, err := SanitizeHTTPURL(raw)
	if err != nil {
		return err
	}
	return s.setString(PortalPurchaseURLKey, clean)
}

func (s *SettingService) GetPortalSiteTitle() (string, error) {
	v, err := s.getString(PortalSiteTitleKey)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(v) == "" {
		return PortalDefaultSiteTitle, nil
	}
	return v, nil
}

func (s *SettingService) SetPortalSiteTitle(title string) error {
	return s.setString(PortalSiteTitleKey, strings.TrimSpace(title))
}

func (s *SettingService) GetPortalCardProviderURL() (string, error) {
	return s.getString(PortalCardProviderURLKey)
}

func (s *SettingService) SetPortalCardProviderURL(v string) error {
	clean, err := SanitizeHTTPURL(v)
	if err != nil {
		return err
	}
	return s.setString(PortalCardProviderURLKey, clean)
}

func (s *SettingService) GetPortalCardProviderSecret() (string, error) {
	return s.getString(PortalCardProviderSecretKey)
}

func (s *SettingService) SetPortalCardProviderSecret(v string) error {
	return s.setString(PortalCardProviderSecretKey, strings.TrimSpace(v))
}

func (s *SettingService) GetPortalCardProviderSign() (string, error) {
	return s.getString(PortalCardProviderSignKey)
}

func (s *SettingService) SetPortalCardProviderSign(v string) error {
	return s.setString(PortalCardProviderSignKey, strings.TrimSpace(v))
}

func (s *SettingService) GetPortalEnabled() (bool, error) {
	return s.getBool(PortalEnabledKey)
}

func (s *SettingService) SetPortalEnabled(enabled bool) error {
	return s.setBool(PortalEnabledKey, enabled)
}

func (s *SettingService) GetPortalListen() (string, error) {
	return s.getString(PortalListenKey)
}

func (s *SettingService) SetPortalListen(listen string) error {
	listen = strings.TrimSpace(listen)
	if listen != "" && net.ParseIP(listen) == nil {
		return common.NewError("portal listen address must be an IP address")
	}
	return s.setString(PortalListenKey, listen)
}

func (s *SettingService) GetPortalPort() (int, error) {
	return s.getInt(PortalPortKey)
}

func (s *SettingService) SetPortalPort(port int) error {
	if port < 1 || port > 65535 {
		return common.NewError("portal port must be between 1 and 65535")
	}
	panelPort, err := s.GetPort()
	if err != nil {
		return err
	}
	if port == panelPort {
		return common.NewError("portal port must differ from panel port")
	}
	return s.setInt(PortalPortKey, port)
}

func (s *SettingService) GetPortalPublicURL() (string, error) {
	return s.getString(PortalPublicURLKey)
}

func (s *SettingService) SetPortalPublicURL(raw string) error {
	clean, err := SanitizeHTTPURL(raw)
	if err != nil {
		return err
	}
	return s.setString(PortalPublicURLKey, strings.TrimRight(clean, "/"))
}
