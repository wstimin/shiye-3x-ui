package service

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/wstimin/shiye-3x-ui/v3/internal/database"
	"github.com/wstimin/shiye-3x-ui/v3/internal/database/model"
	"github.com/wstimin/shiye-3x-ui/v3/internal/web/entity"
)

const managedSubscriptionProxyOriginKey = "subscriptionProxyOrigin"

var managedPortalProxyConfigCandidates = []string{
	"/etc/nginx/conf.d/3x-ui-customer-portal.conf",
	"/etc/nginx/http.d/3x-ui-customer-portal.conf",
	"/etc/nginx/sites-enabled/3x-ui-customer-portal.conf",
	"/usr/local/etc/nginx/conf.d/3x-ui-customer-portal.conf",
	"/usr/local/etc/nginx/servers/3x-ui-customer-portal.conf",
}

var managedSubscriptionUpstreamPattern = regexp.MustCompile(`(?m)(server[\t ]+127\.0\.0\.1:)\d+(;[\t ]*#[\t ]*3X-UI_SUBSCRIPTION_UPSTREAM[\t ]*)$`)

func runNginxCommand(nginx string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, nginx, args...).CombinedOutput()
	if ctx.Err() != nil {
		return output, fmt.Errorf("nginx command timed out: %w", ctx.Err())
	}
	return output, err
}

func normalizeSubscriptionProxyOrigin(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("subscription proxy origin must be a complete http(s) URL")
	}
	return u.Scheme + "://" + u.Host, nil
}

func normalizeSubscriptionPath(raw string) string {
	path := strings.TrimSpace(raw)
	if path == "" {
		return "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if !strings.HasSuffix(path, "/") {
		path += "/"
	}
	return path
}

func subscriptionProxyURL(origin, path string) string {
	return strings.TrimRight(origin, "/") + normalizeSubscriptionPath(path)
}

func upsertSettingTx(tx *gorm.DB, key, value string) error {
	var setting model.Setting
	err := tx.Where("key = ?", key).First(&setting).Error
	if database.IsNotFound(err) {
		return tx.Create(&model.Setting{Key: key, Value: value}).Error
	}
	if err != nil {
		return err
	}
	return tx.Model(&setting).Update("value", value).Error
}

// ConfigureManagedSubscriptionProxy makes the customer portal's public origin
// the canonical subscription origin. Nginx terminates public TLS, while the
// subscription server stays on loopback using plain HTTP.
func (s *SettingService) ConfigureManagedSubscriptionProxy(rawOrigin string) error {
	origin, err := normalizeSubscriptionProxyOrigin(rawOrigin)
	if err != nil {
		return err
	}
	settings, err := s.GetAllSetting()
	if err != nil {
		return err
	}
	values := map[string]string{
		managedSubscriptionProxyOriginKey: origin,
		"subListen":                       "127.0.0.1",
		"subDomain":                       "",
		"subCertFile":                     "",
		"subKeyFile":                      "",
		"subURI":                          subscriptionProxyURL(origin, settings.SubPath),
		"subJsonURI":                      subscriptionProxyURL(origin, settings.SubJsonPath),
		"subClashURI":                     subscriptionProxyURL(origin, settings.SubClashPath),
	}
	return database.GetDB().Transaction(func(tx *gorm.DB) error {
		for key, value := range values {
			if err := upsertSettingTx(tx, key, value); err != nil {
				return err
			}
		}
		return nil
	})
}

// ApplyManagedSubscriptionProxySettings keeps every panel surface on the same
// public subscription origin even when an administrator edits paths or the
// internal subscription port in the regular settings page.
func (s *SettingService) ApplyManagedSubscriptionProxySettings(settings *entity.AllSetting) (bool, error) {
	origin, err := s.getString(managedSubscriptionProxyOriginKey)
	if err != nil {
		return false, err
	}
	if strings.TrimSpace(origin) == "" {
		return false, nil
	}
	origin, err = normalizeSubscriptionProxyOrigin(origin)
	if err != nil {
		return false, err
	}
	settings.SubListen = "127.0.0.1"
	settings.SubDomain = ""
	settings.SubCertFile = ""
	settings.SubKeyFile = ""
	settings.SubURI = subscriptionProxyURL(origin, settings.SubPath)
	settings.SubJsonURI = subscriptionProxyURL(origin, settings.SubJsonPath)
	settings.SubClashURI = subscriptionProxyURL(origin, settings.SubClashPath)
	return true, nil
}

func (s *SettingService) ManagedSubscriptionProxyEnabled() bool {
	origin, err := s.getString(managedSubscriptionProxyOriginKey)
	return err == nil && strings.TrimSpace(origin) != ""
}

func findManagedPortalProxyConfig() string {
	for _, candidate := range managedPortalProxyConfigCandidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

// SyncManagedSubscriptionProxyPort atomically updates only the private Nginx
// upstream. Public subscription URLs remain on the customer domain and port
// 443. A failed syntax check or reload restores the previous configuration.
func SyncManagedSubscriptionProxyPort(port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("subscription port %d is invalid", port)
	}
	configPath := findManagedPortalProxyConfig()
	if configPath == "" {
		return fmt.Errorf("managed customer portal Nginx configuration was not found; configure the customer domain again")
	}
	original, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}
	if !managedSubscriptionUpstreamPattern.Match(original) {
		return fmt.Errorf("managed subscription upstream marker is missing; configure the customer domain again")
	}
	updated := managedSubscriptionUpstreamPattern.ReplaceAll(original, []byte(`${1}`+strconv.Itoa(port)+`${2}`))
	if string(updated) == string(original) {
		return nil
	}
	info, err := os.Stat(configPath)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(configPath), ".3x-ui-customer-portal-*.conf")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err = tmp.Write(updated); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Chmod(info.Mode().Perm()); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmpPath, configPath); err != nil {
		return err
	}
	restore := func() {
		_ = os.WriteFile(configPath, original, info.Mode().Perm())
	}
	nginx, err := exec.LookPath("nginx")
	if err != nil {
		restore()
		return fmt.Errorf("nginx executable was not found: %w", err)
	}
	if output, testErr := runNginxCommand(nginx, "-t"); testErr != nil {
		restore()
		return fmt.Errorf("nginx configuration test failed: %s", strings.TrimSpace(string(output)))
	}
	if output, reloadErr := runNginxCommand(nginx, "-s", "reload"); reloadErr != nil {
		restore()
		_, _ = runNginxCommand(nginx, "-s", "reload")
		return fmt.Errorf("nginx reload failed: %s", strings.TrimSpace(string(output)))
	}
	return nil
}
