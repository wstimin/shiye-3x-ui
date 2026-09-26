package service

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/wstimin/shiye-3x-ui/v3/internal/database"
	"github.com/wstimin/shiye-3x-ui/v3/internal/database/model"
)

func setupPortalDB(t *testing.T) {
	t.Helper()
	dbDir := t.TempDir()
	t.Setenv("XUI_DB_FOLDER", dbDir)
	if err := database.InitDB(filepath.Join(dbDir, "x-ui.db")); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	t.Cleanup(func() { _ = database.CloseDB() })
}

func seedPortalClient(t *testing.T, svc *ClientService, inboundSvc *InboundService, email string, expiry int64) {
	t.Helper()
	db := database.GetDB()
	ib := &model.Inbound{
		Tag: "portal-" + strings.ReplaceAll(email, "@", "-"), Enable: true, Port: 0,
		Protocol: model.VLESS, Settings: `{"clients":[]}`,
	}
	if err := db.Create(ib).Error; err != nil {
		t.Fatalf("create inbound: %v", err)
	}
	id := "11111111-2222-4333-8444-555555555555"
	if _, err := svc.Create(inboundSvc, &ClientCreatePayload{
		Client:     model.Client{Email: email, ID: id, ExpiryTime: expiry, Enable: true},
		InboundIds: []int{ib.Id},
	}); err != nil {
		t.Fatalf("create client: %v", err)
	}
}

func TestCreateAndCheckCustomer(t *testing.T) {
	setupPortalDB(t)
	svc, inboundSvc := ClientService{}, InboundService{}
	seedPortalClient(t, &svc, &inboundSvc, "c1@example.com", 1800000000000)

	if _, err := svc.CreateCustomer("alice", "s3cret-pw", "c1@example.com", 100); err != nil {
		t.Fatalf("CreateCustomer: %v", err)
	}
	// Duplicate username must fail.
	if _, err := svc.CreateCustomer("alice", "other", "c1@example.com", 100); err == nil {
		t.Fatal("duplicate username accepted")
	}
	// Unknown client email must fail.
	if _, err := svc.CreateCustomer("bob", "pw", "ghost@example.com", 100); err == nil {
		t.Fatal("unknown email accepted")
	}
	acc, err := svc.CheckCustomer("alice", "s3cret-pw")
	if err != nil {
		t.Fatalf("CheckCustomer: %v", err)
	}
	if acc.Email != "c1@example.com" || acc.BalanceCents != 0 {
		t.Fatalf("unexpected account state: %+v", acc)
	}
	if _, err := svc.CheckCustomer("alice", "wrong"); err == nil {
		t.Fatal("wrong password accepted")
	}
	// Disabled account cannot log in.
	if err := svc.SetCustomerEnable("alice", false); err != nil {
		t.Fatalf("SetCustomerEnable: %v", err)
	}
	if _, err := svc.CheckCustomer("alice", "s3cret-pw"); err == nil {
		t.Fatal("disabled account accepted")
	}
}

func TestRedeemCoupon(t *testing.T) {
	setupPortalDB(t)
	svc, inboundSvc := ClientService{}, InboundService{}
	seedPortalClient(t, &svc, &inboundSvc, "c2@example.com", 1800000000000)
	if _, err := svc.CreateCustomer("carol", "pw", "c2@example.com", 100); err != nil {
		t.Fatalf("CreateCustomer: %v", err)
	}
	codes, err := svc.GenerateCoupons(2, 500, "T-", "batch1", 0)
	if err != nil {
		t.Fatalf("GenerateCoupons: %v", err)
	}
	if len(codes) != 2 || !strings.HasPrefix(codes[0], "T-") {
		t.Fatalf("unexpected codes: %v", codes)
	}
	// Plaintext must not persist.
	var row model.CouponCode
	if err := database.GetDB().First(&row).Error; err != nil {
		t.Fatalf("read coupon: %v", err)
	}
	if strings.Contains(row.CodeHash, codes[0][:4]) || len(row.CodeHash) != 64 {
		t.Fatalf("coupon stored unhashed: %q", row.CodeHash)
	}
	bal, err := svc.RedeemCoupon("carol", codes[0])
	if err != nil {
		t.Fatalf("RedeemCoupon: %v", err)
	}
	if bal != 500 {
		t.Fatalf("balance = %d, want 500", bal)
	}
	// Double redeem must fail.
	if _, err := svc.RedeemCoupon("carol", codes[0]); err == nil {
		t.Fatal("double redeem accepted")
	}
	// Unknown code must fail.
	if _, err := svc.RedeemCoupon("carol", "nope-12345678"); err == nil {
		t.Fatal("unknown code accepted")
	}
	var txns []model.WalletTxn
	if err := database.GetDB().Where("username = ?", "carol").Find(&txns).Error; err != nil {
		t.Fatalf("read txns: %v", err)
	}
	if len(txns) != 1 || txns[0].Kind != WalletKindRedeem || txns[0].AmountCents != 500 || txns[0].BalanceAfter != 500 {
		t.Fatalf("unexpected ledger: %+v", txns)
	}
}

func TestRenewCustomer(t *testing.T) {
	setupPortalDB(t)
	svc, inboundSvc := ClientService{}, InboundService{}
	if err := (&SettingService{}).SetPortalPricePerMonthCents(100); err != nil {
		t.Fatalf("SetPortalPrice: %v", err)
	}
	// Expired client: renewal starts from now, not the past expiry.
	seedPortalClient(t, &svc, &inboundSvc, "c3@example.com", 1000000000000)
	if _, err := svc.CreateCustomer("dave", "pw", "c3@example.com", 100); err != nil {
		t.Fatalf("CreateCustomer: %v", err)
	}
	codes, err := svc.GenerateCoupons(1, 10000, "", "b2", 0)
	if err != nil {
		t.Fatalf("GenerateCoupons: %v", err)
	}
	if _, err := svc.RedeemCoupon("dave", codes[0]); err != nil {
		t.Fatalf("RedeemCoupon: %v", err)
	}
	before := database.GetDB()
	if before == nil {
		t.Fatal("nil DB")
	}
	newExpiry, balance, err := svc.RenewCustomer(&inboundSvc, "dave", 30)
	if err != nil {
		t.Fatalf("RenewCustomer: %v", err)
	}
	if balance != 10000-3000 {
		t.Fatalf("balance = %d, want 7000", balance)
	}
	rec, err := svc.GetRecordByEmail(database.GetDB(), "c3@example.com")
	if err != nil {
		t.Fatalf("GetRecordByEmail: %v", err)
	}
	want := newExpiry
	if newExpiry <= 1000000000000 {
		t.Fatalf("newExpiry not extended past old expiry: %d", newExpiry)
	}
	if rec.ExpiryTime != want {
		t.Fatalf("record expiry = %d, want %d", rec.ExpiryTime, newExpiry)
	}
	// Inbound JSON must carry the same expiry.
	ids, err := svc.GetInboundIdsForEmail(database.GetDB(), "c3@example.com")
	if err != nil {
		t.Fatalf("GetInboundIdsForEmail: %v", err)
	}
	for _, id := range ids {
		ib, err := inboundSvc.GetInbound(id)
		if err != nil {
			t.Fatalf("GetInbound: %v", err)
		}
		clients, err := inboundSvc.GetClients(ib)
		if err != nil {
			t.Fatalf("GetClients: %v", err)
		}
		for _, cl := range clients {
			if cl.Email == "c3@example.com" && cl.ExpiryTime != newExpiry {
				t.Fatalf("inbound %d client expiry = %d, want %d", id, cl.ExpiryTime, newExpiry)
			}
		}
	}
	// Insufficient balance must fail without touching expiry.
	if _, _, err := svc.RenewCustomer(&inboundSvc, "dave", 3650); err == nil {
		t.Fatal("unaffordable renew accepted")
	}
}

func TestRenewCustomer_UnlimitedRejected(t *testing.T) {
	setupPortalDB(t)
	svc, inboundSvc := ClientService{}, InboundService{}
	seedPortalClient(t, &svc, &inboundSvc, "c4@example.com", 0)
	if _, err := svc.CreateCustomer("erin", "pw", "c4@example.com", 100); err != nil {
		t.Fatalf("CreateCustomer: %v", err)
	}
	if _, _, err := svc.RenewCustomer(&inboundSvc, "erin", 30); err == nil {
		t.Fatal("unlimited client renew accepted")
	}
}
