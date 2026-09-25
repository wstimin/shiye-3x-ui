package database

import (
	"path/filepath"
	"testing"

	"github.com/wstimin/shiye-3x-ui/v3/internal/database/model"
)

// Portal tables must exist right after InitDB and match the struct schema,
// so customer auth / coupons / ledger never hit "no such table".
func TestPortalModels_SettledAfterInitDB(t *testing.T) {
	if err := InitDB(filepath.Join(t.TempDir(), "x-ui.db")); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	t.Cleanup(func() { _ = CloseDB() })

	for _, mdl := range []any{&model.CustomerAccount{}, &model.CouponCode{}, &model.WalletTxn{}} {
		if !postgresModelSettled(mdl) {
			t.Errorf("%T not settled right after InitDB", mdl)
		}
	}
}

// Table names are fixed: existing backups and raw SQL assume them.
func TestPortalModels_TableNames(t *testing.T) {
	cases := map[interface{ TableName() string }]string{
		&model.CustomerAccount{}: "customer_accounts",
		&model.CouponCode{}:      "coupon_codes",
		&model.WalletTxn{}:       "wallet_txns",
	}
	for mdl, want := range cases {
		if got := mdl.TableName(); got != want {
			t.Errorf("%T table = %q, want %q", mdl, got, want)
		}
	}
}
