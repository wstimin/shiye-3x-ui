package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/wstimin/shiye-3x-ui/v3/internal/util/common"
)

const (
	kmglxtProviderSource = "kmglxt"
	kmglxtProviderBatch  = "KMGLXT"
	kmglxtMaxResponse    = 1 << 20
)

type KMGLXTConfig struct {
	BaseURL   string
	AppKey    string
	AppSecret string
}

type kmglxtCardData struct {
	Card            string      `json:"card"`
	Type            string      `json:"type"`
	Amount          json.Number `json:"amount"`
	RemainingAmount json.Number `json:"remaining_amount"`
}

type kmglxtResponse struct {
	Code    int            `json:"code"`
	Message string         `json:"message"`
	Data    kmglxtCardData `json:"data"`
}

func normalizeKMGLXTEndpoint(baseURL, action string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", common.NewError("卡密接口地址无效")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", common.NewError("卡密接口地址不能包含账号、查询参数或片段")
	}

	path := strings.TrimRight(u.Path, "/")
	for _, suffix := range []string{
		"/api/v1/card/verify",
		"/api/v1/card/activate",
		"/api/v1/card/query",
	} {
		if strings.HasSuffix(path, suffix) {
			path = strings.TrimSuffix(path, suffix)
			break
		}
	}
	switch {
	case strings.HasSuffix(path, "/api/v1/card"):
		path += "/" + action
	case strings.HasSuffix(path, "/api/v1"):
		path += "/card/" + action
	case strings.HasSuffix(path, "/api"):
		path += "/v1/card/" + action
	default:
		path += "/api/v1/card/" + action
	}
	u.Path, u.RawPath = path, ""
	return u.String(), nil
}

func kmglxtNonce() (string, error) {
	var raw [16]byte
	if _, err := cryptorand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}

func kmglxtSign(appKey, appSecret, timestamp, nonce string, body []byte) string {
	bodyDigest := sha256.Sum256(body)
	payload := appKey + "\n" + timestamp + "\n" + nonce + "\n" + hex.EncodeToString(bodyDigest[:])
	mac := hmac.New(sha256.New, []byte(appSecret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func callKMGLXT(ctx context.Context, client *http.Client, config KMGLXTConfig, action, code string) (kmglxtResponse, error) {
	var result kmglxtResponse
	endpoint, err := normalizeKMGLXTEndpoint(config.BaseURL, action)
	if err != nil {
		return result, err
	}
	body, err := json.Marshal(struct {
		Card string `json:"card"`
	}{Card: code})
	if err != nil {
		return result, err
	}
	nonce, err := kmglxtNonce()
	if err != nil {
		return result, common.NewError("无法生成卡密请求签名")
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return result, common.NewError("无法创建卡密接口请求")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-App-Key", config.AppKey)
	req.Header.Set("X-Timestamp", timestamp)
	req.Header.Set("X-Nonce", nonce)
	req.Header.Set("X-Sign", kmglxtSign(config.AppKey, config.AppSecret, timestamp, nonce, body))

	resp, err := client.Do(req)
	if err != nil {
		return result, common.NewError("连接第三方卡密系统失败")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return result, common.NewErrorf("第三方卡密系统返回 HTTP %d", resp.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, kmglxtMaxResponse))
	decoder.UseNumber()
	if err := decoder.Decode(&result); err != nil {
		return result, common.NewError("第三方卡密系统返回了无法识别的数据")
	}
	if result.Code != 0 {
		message := strings.TrimSpace(result.Message)
		if message == "" {
			message = "卡密验证失败"
		}
		return result, common.NewErrorf("%s（错误码 %d）", message, result.Code)
	}
	return result, nil
}

func yuanNumberToCents(value json.Number) (int64, error) {
	if value == "" {
		return 0, errors.New("missing amount")
	}
	yuan, err := value.Float64()
	if err != nil || math.IsNaN(yuan) || math.IsInf(yuan, 0) || yuan <= 0 || yuan > float64(math.MaxInt64)/100 {
		return 0, errors.New("invalid amount")
	}
	centsFloat := yuan * 100
	cents := math.Round(centsFloat)
	if math.Abs(centsFloat-cents) > 0.000001 {
		return 0, errors.New("amount has more than two decimal places")
	}
	return int64(cents), nil
}

// RedeemKMGLXTMoneyCard verifies the card type before activating it. The
// provider owns card consumption; this panel owns the customer's wallet.
func RedeemKMGLXTMoneyCard(ctx context.Context, config KMGLXTConfig, code string) (int64, string, error) {
	config.BaseURL = strings.TrimSpace(config.BaseURL)
	config.AppKey = strings.TrimSpace(config.AppKey)
	config.AppSecret = strings.TrimSpace(config.AppSecret)
	if config.BaseURL == "" || config.AppKey == "" || config.AppSecret == "" {
		return 0, "", common.NewError("第三方卡密接口未完整配置")
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return 0, "", common.NewError("请输入卡密")
	}

	requestCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	verified, err := callKMGLXT(requestCtx, client, config, "verify", code)
	if err != nil {
		return 0, "", err
	}
	if verified.Data.Type != "money" {
		return 0, "", common.NewError("该卡不是金额卡，不能充值余额")
	}
	verifiedCents, err := yuanNumberToCents(verified.Data.RemainingAmount)
	if err != nil {
		return 0, "", common.NewError("第三方卡密金额无效")
	}

	activated, err := callKMGLXT(requestCtx, client, config, "activate", code)
	if err != nil {
		return 0, "", err
	}
	if activated.Data.Type != "money" {
		return 0, "", common.NewError("第三方返回的卡密类型不一致")
	}
	amountCents, err := yuanNumberToCents(activated.Data.Amount)
	if err != nil {
		return 0, "", common.NewError("第三方卡密金额无效")
	}
	if amountCents != verifiedCents {
		return 0, "", common.NewError("第三方卡密金额在验卡和激活时不一致")
	}
	providerCard := strings.ToUpper(strings.TrimSpace(activated.Data.Card))
	if providerCard == "" {
		providerCard = code
	}
	return amountCents, providerCard, nil
}

func providerReference(card string) string {
	digest := sha256.Sum256([]byte(card))
	return fmt.Sprintf("%s:%s", kmglxtProviderBatch, hex.EncodeToString(digest[:6]))
}
