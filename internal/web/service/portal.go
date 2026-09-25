package service

import (
	"crypto/subtle"
	"errors"
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

// CreateCustomer creates a portal login bound to an existing client email.
func (s *ClientService) CreateCustomer(username, password, email string) (*model.CustomerAccount, error) {
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
	db := database.GetDB()
	if _, err := s.GetRecordByEmail(db, email); err != nil {
		return nil, err
	}
	hash, err := crypto.HashPasswordAsBcrypt(password)
	if err != nil {
		return nil, err
	}
	acc := &model.CustomerAccount{Username: username, PasswordHash: hash, Email: email, Enable: true}
	if err := db.Create(acc).Error; err != nil {
		return nil, err
	}
	return acc, nil
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
	price, err := (&SettingService{}).GetPortalPricePerMonthCents()
	if err != nil {
		return 0, acc.BalanceCents, err
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
