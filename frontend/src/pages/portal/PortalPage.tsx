import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Input,
  InputNumber,
  Layout,
  Modal,
  Segmented,
  Statistic,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { TabsProps } from 'antd';
import {
  ClockCircleOutlined,
  CopyOutlined,
  CustomerServiceOutlined,
  DownloadOutlined,
  HomeOutlined,
  LinkOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ThunderboltFilled,
  UnorderedListOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';

import { ClipboardManager, HttpUtil, IntlUtil, LanguageManager } from '@/utils';
import { setMessageInstance } from '@/utils/messageBus';
import { buildAntdThemeConfig, useTheme } from '@/hooks/useTheme';
import SubAppsTab from '../sub/SubAppsTab';
import SubConfigsTab from '../sub/SubConfigsTab';
import { buildSubApps, detectPlatform, resolveSubStatus } from '../sub/subPageModel';
import SubHero from '../sub/SubHero';
import {
  formatCents,
  planCostCents,
  PortalRedeemSchema,
  type PortalMe,
  type PortalNode,
  type PortalPlans,
  type PortalSubLinks,
  type PortalTxn,
} from './portalModel';
import PortalLogin, { PortalLoading } from './PortalLogin';
import './PortalPage.css';
import '../sub/SubPage.css';

const ACCENT = {
  light: {
    primary: '#1677ff',
    hover: '#4096ff',
    active: '#0958d9',
    rail: 'rgba(22, 119, 255, 0.16)',
  },
  dark: {
    primary: '#4998ff',
    hover: '#6cb0ff',
    active: '#2378e5',
    rail: 'rgba(73, 152, 255, 0.18)',
  },
};

const JSON_POST_OPTIONS = {
  silent: true,
  headers: { 'Content-Type': 'application/json' },
} as const;

interface RenewState {
  open: boolean;
  months: number;
  customMonths: number | null;
}

type PortalSection = 'overview' | 'nodes' | 'wallet' | 'account';

const PORTAL_SECTION_COPY: Record<PortalSection, { kicker: string; title: string }> = {
  overview: { kicker: '客户中心 / 概览', title: '账户总览' },
  nodes: { kicker: '客户中心 / 我的节点', title: '节点与订阅' },
  wallet: { kicker: '客户中心 / 余额与续期', title: '余额与续期' },
  account: { kicker: '客户中心 / 账户设置', title: '账户设置' },
};

async function fetchMe(silent = true): Promise<PortalMe | null> {
  // An unauthenticated visitor belongs on the portal login screen. The shared
  // panel transport normally redirects every 401 to the application root;
  // here that root redirects back to /portal and would create a reload loop.
  const msg = await HttpUtil.get<PortalMe>('/portal/api/auth/me', undefined, {
    silent,
    redirectOnUnauthorized: false,
  });
  if (msg.success && msg.obj) {
    const obj = msg.obj as unknown as PortalMe;
    if (obj.username) return obj;
  }
  return null;
}

export default function PortalPage() {
  const { t } = useTranslation();
  const { isDark, antdThemeConfig } = useTheme();
  const [messageApi, messageContextHolder] = message.useMessage();
  useEffect(() => {
    setMessageInstance(messageApi);
  }, [messageApi]);

  const [booted, setBooted] = useState(false);
  const [me, setMe] = useState<PortalMe | null>(null);
  const [plans, setPlans] = useState<PortalPlans | null>(null);
  const [nodes, setNodes] = useState<PortalNode[]>([]);
  const [subs, setSubs] = useState<PortalSubLinks | null>(null);
  const [txns, setTxns] = useState<PortalTxn[]>([]);
  const [lang, setLang] = useState<string>(() => LanguageManager.getLanguage('subscription'));
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [renew, setRenew] = useState<RenewState>({ open: false, months: 1, customMonths: 1 });
  const [activeSection, setActiveSection] = useState<PortalSection>('overview');

  const refresh = useCallback(async () => {
    const [account, pMsg] = await Promise.all([
      fetchMe(),
      HttpUtil.get<PortalPlans>('/portal/api/plans', undefined, { silent: true }),
    ]);
    if (pMsg.success && pMsg.obj) setPlans(pMsg.obj as PortalPlans);
    setMe(account);
    if (!account) return;
    setNowMs(Date.now());
    const [nMsg, sMsg, tMsg] = await Promise.all([
      HttpUtil.get<PortalNode[]>('/portal/api/nodes', undefined, { silent: true }),
      HttpUtil.get<PortalSubLinks>('/portal/api/sub/links', undefined, { silent: true }),
      HttpUtil.get<PortalTxn[]>('/portal/api/wallet/txns', undefined, { silent: true }),
    ]);
    if (nMsg.success && Array.isArray(nMsg.obj)) setNodes(nMsg.obj as PortalNode[]);
    if (sMsg.success && sMsg.obj) setSubs(sMsg.obj as PortalSubLinks);
    if (tMsg.success && Array.isArray(tMsg.obj)) setTxns(tMsg.obj as PortalTxn[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pMsg = await HttpUtil.get<PortalPlans>('/portal/api/plans', undefined, {
        silent: true,
      });
      if (!cancelled && pMsg.success && pMsg.obj) setPlans(pMsg.obj as PortalPlans);
      const account = await fetchMe();
      if (cancelled) return;
      setMe(account);
      setBooted(true);
      if (account) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const reloadVisiblePortal = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', reloadVisiblePortal);
    document.addEventListener('visibilitychange', reloadVisiblePortal);
    return () => {
      window.removeEventListener('focus', reloadVisiblePortal);
      document.removeEventListener('visibilitychange', reloadVisiblePortal);
    };
  }, [refresh]);

  const onLangChange = useCallback((next: string) => {
    setLang(next);
    LanguageManager.setLanguage(next, 'subscription');
  }, []);

  const copy = useCallback(
    async (value: string, toast?: string) => {
      if (!value) return;
      const ok = await ClipboardManager.copyText(value);
      if (ok) messageApi.success(toast ?? t('copied'));
    },
    [t, messageApi],
  );

  const onRedeem = useCallback(async () => {
    const parsed = PortalRedeemSchema.safeParse({ code: redeemCode.trim() });
    if (!parsed.success) {
      messageApi.error(t('portal.codeRequired'));
      return;
    }
    setRedeeming(true);
    try {
      const msg = await HttpUtil.post<{ balanceCents: number }>(
        '/portal/api/wallet/redeem',
        { code: parsed.data.code },
        JSON_POST_OPTIONS,
      );
      if (msg.success) {
        messageApi.success(t('portal.redeemSuccess'));
        setRedeemCode('');
        await refresh();
      } else {
        messageApi.error(msg.msg || t('portal.redeemFailed'));
      }
    } finally {
      setRedeeming(false);
    }
  }, [redeemCode, messageApi, t, refresh]);

  const selectedMonths = renew.customMonths ?? renew.months;
  const monthlyPrice = me?.pricePerMonthCents ?? plans?.pricePerMonthCents ?? 0;
  const selectedCost = planCostCents(selectedMonths, monthlyPrice);

  const onRenew = useCallback(async () => {
    setRenewing(true);
    try {
      const msg = await HttpUtil.post<{ expiryTime: number; balanceCents: number }>(
        '/portal/api/billing/renew',
        { months: selectedMonths },
        JSON_POST_OPTIONS,
      );
      if (msg.success) {
        messageApi.success(t('portal.renewSuccess'));
        setRenew((r) => ({ ...r, open: false }));
        await refresh();
      } else {
        messageApi.error(msg.msg || t('portal.renewFailed'));
      }
    } finally {
      setRenewing(false);
    }
  }, [selectedMonths, messageApi, t, refresh]);

  const onLogout = useCallback(async () => {
    await HttpUtil.post('/portal/api/auth/logout', {}, JSON_POST_OPTIONS);
    setMe(null);
    setNodes([]);
    setSubs(null);
    setTxns([]);
  }, []);

  const themeConfig = useMemo(() => {
    const accent = isDark ? ACCENT.dark : ACCENT.light;
    const primary = {
      colorPrimary: accent.primary,
      colorPrimaryHover: accent.hover,
      colorPrimaryActive: accent.active,
    };
    return {
      ...buildAntdThemeConfig(false, false),
      token: {
        ...antdThemeConfig.token,
        ...primary,
        colorLink: accent.primary,
        colorInfo: accent.primary,
      },
      components: {
        ...antdThemeConfig.components,
        Button: { ...antdThemeConfig.components?.Button, ...primary },
        Progress: { ...antdThemeConfig.components?.Progress, remainingColor: accent.rail },
      },
    };
  }, [antdThemeConfig, isDark]);

  const direction = lang === 'fa-IR' || lang === 'ar-EG' ? 'rtl' : 'ltr';
  // The customer portal is intentionally a bright, branded surface. Keep
  // the persisted panel theme from turning this page into a dark UI.
  const pageClass = 'portal-page x-user-center';

  const siteTitle = plans?.siteTitle || 'X用户中心';

  useEffect(() => {
    document.title = siteTitle;
  }, [siteTitle]);

  const balance = me?.balanceCents ?? 0;
  const totalUsed = (me?.traffic?.up ?? 0) + (me?.traffic?.down ?? 0);
  const totalQuota = me?.traffic?.total ?? 0;
  const runningNodes = nodes.filter((node) => node.enable).length;
  const expireMs = me?.expiryTime ?? 0;
  const heroData = useMemo(
    () => ({
      status: resolveSubStatus(
        { enabled: true, usedByte: totalUsed, totalByte: totalQuota, expireMs },
        nowMs,
      ),
      daysLeft: expireMs > 0 ? Math.max(0, Math.ceil((expireMs - nowMs) / 86_400_000)) : null,
      usedByte: totalUsed,
      totalByte: totalQuota,
      expireMs,
      lastOnlineMs: 0,
      download: '',
      upload: '',
      used: '',
      total: totalQuota > 0 ? '' : '∞',
      remained: '',
      datepicker: 'gregorian' as const,
    }),
    [totalUsed, totalQuota, expireMs, nowMs],
  );

  const apps = useMemo(
    () =>
      buildSubApps({
        subUrl: subs?.subUrl ?? '',
        sId: me?.email ?? '',
        subTitle: siteTitle,
      }),
    [subs, me, siteTitle],
  );
  const initialPlatform = detectPlatform(navigator.userAgent);

  const subRows = useMemo(() => {
    if (!subs) return [];
    return [
      {
        kind: 'SUB',
        color: 'green',
        url: subs.subUrl ?? '',
        title: siteTitle,
        downloadable: false,
      },
      {
        kind: 'JSON',
        color: 'purple',
        url: subs.subJsonUrl ?? '',
        title: `${siteTitle} JSON`,
        downloadable: true,
      },
      {
        kind: 'CLASH',
        color: 'gold',
        url: subs.subClashUrl ?? '',
        title: 'Clash / Mihomo',
        downloadable: true,
      },
    ].filter((row) => row.url);
  }, [subs, siteTitle]);

  const tabs = useMemo(() => {
    const items: NonNullable<TabsProps['items']> = [];
    if (subRows.length > 0) {
      items.push({
        key: 'subscription',
        icon: <LinkOutlined />,
        label: t('subscription.tabLinks'),
        children: (
          <div className="sub-rows">
            {subRows.map((row) => (
              <div key={row.kind} className="sub-row">
                <Tag color={row.color} className="sub-row-tag">
                  {row.kind}
                </Tag>
                <div className="sub-row-main">
                  <span className="sub-row-title" dir="ltr">
                    {row.title}
                  </span>
                  <div className="sub-row-url" dir="ltr" title={row.url}>
                    {row.url}
                  </div>
                </div>
                <div className="sub-row-actions">
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => copy(row.url)}
                    aria-label={t('copy')}
                    title={t('copy')}
                  />
                  {row.downloadable && (
                    <Button
                      href={`${row.url}${row.url.includes('?') ? '&' : '?'}view=raw`}
                      target="_blank"
                      rel="noopener noreferrer"
                      icon={<DownloadOutlined />}
                      aria-label={t('download')}
                      title={t('download')}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        ),
      });
    }
    if (subs?.subUrl) {
      items.push({
        key: 'apps',
        icon: <QrcodeOutlined />,
        label: t('subscription.tabApps'),
        children: (
          <SubAppsTab
            apps={apps}
            initialPlatform={initialPlatform}
            onOpen={(url) => window.open(url, '_blank')}
          />
        ),
      });
    }
    if (subs && subs.links.length > 0) {
      items.push({
        key: 'configs',
        icon: <UnorderedListOutlined />,
        label: (
          <>
            {t('subscription.tabConfigs')}
            <span className="sub-tab-count">{subs.links.length}</span>
          </>
        ),
        children: <SubConfigsTab links={subs.links} onCopy={copy} />,
      });
    }
    return items;
  }, [t, subRows, subs, apps, initialPlatform, copy]);

  if (!booted) {
    return <PortalLoading />;
  }
  if (!me) {
    return <PortalLogin plans={plans} onDone={refresh} />;
  }

  const sectionCopy = PORTAL_SECTION_COPY[activeSection];
  const switchSection = (section: PortalSection) => {
    setActiveSection(section);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const navItems = [
    { key: 'overview' as const, label: '概览', icon: <HomeOutlined /> },
    {
      key: 'nodes' as const,
      label: '我的节点',
      icon: <ThunderboltFilled />,
      count: nodes.length,
    },
    { key: 'wallet' as const, label: '余额与续期', icon: <WalletOutlined /> },
    { key: 'account' as const, label: '账户设置', icon: <SafetyCertificateOutlined /> },
  ];

  const nodeRows = (visibleNodes: PortalNode[]) =>
    visibleNodes.map((n) => (
      <div key={`${n.protocol}-${n.remark}`} className="portal-node-row">
        <span className="portal-node-icon">
          <ThunderboltFilled />
        </span>
        <div className="portal-node-main">
          <span className="portal-node-remark" dir="auto">
            {n.remark}
          </span>
          <span className="portal-node-protocol">{n.protocol} · 加密连接</span>
        </div>
        {n.enable ? (
          <span className="portal-node-pulse">
            <i />
            运行中
          </span>
        ) : (
          <Tag color="red">{t('disabled')}</Tag>
        )}
      </div>
    ));

  const balanceCards = (
    <div className="portal-balance-row">
      <Card size="small" className="portal-balance-card">
        <Statistic
          title={t('portal.balance')}
          value={formatCents(balance)}
          prefix={<WalletOutlined />}
        />
      </Card>
      <Card size="small" className="portal-balance-card">
        <Statistic
          title={t('subscription.expiry')}
          value={
            expireMs > 0
              ? IntlUtil.formatDate(expireMs, 'gregorian', lang)
              : t('subscription.noExpiry')
          }
        />
      </Card>
    </div>
  );

  return (
    <ConfigProvider theme={themeConfig} direction={direction}>
      {messageContextHolder}
      <Layout className={pageClass} dir={direction}>
        <aside className="portal-sidebar" aria-label="X用户中心导航">
          <div className="sidebar-brand">
            <span className="sidebar-logo">X</span>
            <span>X用户中心</span>
          </div>
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`sidebar-nav-item${activeSection === item.key ? ' is-active' : ''}`}
                aria-current={activeSection === item.key ? 'page' : undefined}
                onClick={() => switchSection(item.key)}
              >
                {item.icon}
                {item.label}
                {'count' in item && <span className="sidebar-count">{item.count}</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-help">
            <div className="sidebar-help-icon">
              <CustomerServiceOutlined />
            </div>
            <strong>需要帮助？</strong>
            <span>联系客服获取支持</span>
            <a href={plans?.purchaseUrl || '#'} target="_blank" rel="noopener noreferrer">
              联系支持 →
            </a>
          </div>
          <div className="sidebar-version">X Center · v1.0</div>
        </aside>
        <Layout className="portal-main">
          <header className="portal-topbar">
            <div>
              <span className="portal-kicker">{sectionCopy.kicker}</span>
              <h1>{sectionCopy.title}</h1>
            </div>
            <div className="portal-topbar-user">
              <Avatar size={40} icon={<UserOutlined />} />
              <div>
                <b>{me.username}</b>
                <span>账户正常</span>
              </div>
              <Button
                type="text"
                icon={<SettingOutlined />}
                aria-label="账户设置"
                onClick={() => switchSection('account')}
              />
            </div>
          </header>
          <nav className="portal-mobile-nav" aria-label="客户中心导航">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={activeSection === item.key ? 'is-active' : ''}
                aria-current={activeSection === item.key ? 'page' : undefined}
                onClick={() => switchSection(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <Layout.Content className="portal-content-wrap">
            <Card className="portal-card-main">
              <header className="portal-header">
                <div className="portal-brand">
                  <span className="portal-brand-title" dir="auto">
                    {siteTitle}
                  </span>
                  <div className="portal-brand-id">
                    <bdi>{me.email}</bdi>
                  </div>
                </div>
                <div className="portal-toolbar">
                  <Segmented
                    value={lang}
                    onChange={(v) => onLangChange(String(v))}
                    options={LanguageManager.supportedLanguages.map((l) => ({
                      value: l.value,
                      label: (
                        <span title={l.name} aria-label={l.name}>
                          {l.icon}
                        </span>
                      ),
                    }))}
                  />
                  <Button size="small" onClick={onLogout}>
                    {t('logout')}
                  </Button>
                </div>
              </header>
              <div key={activeSection} className="portal-view">
                {activeSection === 'overview' && (
                  <>
                    <div className="portal-welcome-strip">
                      <div>
                        <span className="portal-welcome-label">欢迎回来</span>
                        <h2>{me.username}，今天也要保持连接</h2>
                        <p>你的专属服务运行良好，所有节点都在实时守护。</p>
                      </div>
                      <div className="portal-welcome-orb">
                        <ThunderboltFilled />
                      </div>
                    </div>
                    <SubHero {...heroData} lang={lang} />
                    {balanceCards}
                    <div className="portal-actions">
                      <Button
                        type="primary"
                        icon={<ClockCircleOutlined />}
                        onClick={() => setRenew((r) => ({ ...r, open: true }))}
                      >
                        {t('portal.renew')}
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={refresh}>
                        {t('refresh')}
                      </Button>
                    </div>
                    {nodes.length > 0 && (
                      <section className="portal-section">
                        <div className="portal-section-heading">
                          <div>
                            <span className="portal-section-eyebrow">LIVE CONNECTIONS</span>
                            <h3>{t('portal.myNodes')}</h3>
                          </div>
                          <Button type="link" onClick={() => switchSection('nodes')}>
                            查看全部 <RightOutlined />
                          </Button>
                        </div>
                        {nodeRows(nodes.slice(0, 3))}
                      </section>
                    )}
                  </>
                )}

                {activeSection === 'nodes' && (
                  <>
                    <section className="portal-section portal-section-first">
                      <div className="portal-section-heading">
                        <div>
                          <span className="portal-section-eyebrow">LIVE CONNECTIONS</span>
                          <h3>{t('portal.myNodes')}</h3>
                        </div>
                        <Tag color="green">{runningNodes} 个运行中</Tag>
                      </div>
                      {nodes.length > 0 ? nodeRows(nodes) : <Empty description={t('noData')} />}
                    </section>
                    {tabs.length > 0 ? (
                      <Tabs className="portal-tabs" tabBarGutter={24} items={tabs} />
                    ) : (
                      <Empty description="当前账号暂无可用订阅" className="portal-empty" />
                    )}
                  </>
                )}

                {activeSection === 'wallet' && (
                  <>
                    {balanceCards}
                    <div className="portal-actions">
                      <Button
                        type="primary"
                        icon={<ClockCircleOutlined />}
                        onClick={() => setRenew((r) => ({ ...r, open: true }))}
                      >
                        {t('portal.renew')}
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={refresh}>
                        {t('refresh')}
                      </Button>
                    </div>
                    <section className="portal-section">
                      <h3>{t('portal.recharge')}</h3>
                      <div className="portal-recharge-row">
                        <Input
                          value={redeemCode}
                          onChange={(e) => setRedeemCode(e.target.value)}
                          placeholder={t('portal.codePlaceholder')}
                          onPressEnter={onRedeem}
                        />
                        <Button type="primary" loading={redeeming} onClick={onRedeem}>
                          {t('portal.redeem')}
                        </Button>
                      </div>
                      {plans?.purchaseUrl && (
                        <div className="portal-purchase-card">
                          <div className="portal-purchase-icon">
                            <CustomerServiceOutlined />
                          </div>
                          <div className="portal-purchase-copy">
                            <strong>购买卡密</strong>
                            <span>前往购买页面，购买后回到这里输入卡密充值余额</span>
                          </div>
                          <a
                            className="portal-purchase-button"
                            href={plans.purchaseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            立即购买 <RightOutlined />
                          </a>
                        </div>
                      )}
                    </section>
                    <section className="portal-section">
                      <h3>{t('portal.history')}</h3>
                      {txns.length > 0 ? (
                        <div className="portal-txns">
                          {txns.slice(0, 20).map((txn) => (
                            <div key={txn.id} className="portal-txn-row">
                              <Tag color={txn.amountCents >= 0 ? 'green' : 'red'}>
                                {txn.amountCents >= 0 ? '+' : ''}
                                {formatCents(txn.amountCents)}
                              </Tag>
                              <span className="portal-txn-kind">
                                {t(`portal.txn_${txn.kind}`, txn.kind)}
                              </span>
                              <span className="portal-txn-date">
                                {IntlUtil.formatDate(txn.createdAt, 'gregorian', lang)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty description="暂无余额流水" className="portal-empty" />
                      )}
                    </section>
                  </>
                )}

                {activeSection === 'account' && (
                  <section className="portal-section portal-section-first portal-account-section">
                    <div className="portal-account-avatar">
                      <Avatar size={58} icon={<UserOutlined />} />
                      <div>
                        <h3>{me.username}</h3>
                        <span>账户状态正常</span>
                      </div>
                    </div>
                    <div className="portal-account-grid">
                      <div>
                        <span>登录用户名</span>
                        <strong>{me.username}</strong>
                      </div>
                      <div>
                        <span>绑定客户端邮箱</span>
                        <strong>{me.email}</strong>
                      </div>
                    </div>
                    <div className="portal-account-actions">
                      <Button icon={<ReloadOutlined />} onClick={refresh}>
                        刷新账户资料
                      </Button>
                      <Button danger onClick={onLogout}>
                        {t('logout')}
                      </Button>
                    </div>
                    <p className="portal-account-note">登录资料由管理员在客户门户管理中维护。</p>
                  </section>
                )}
              </div>
            </Card>
          </Layout.Content>
        </Layout>
      </Layout>

      <Modal
        open={renew.open}
        onCancel={() => setRenew((r) => ({ ...r, open: false }))}
        onOk={onRenew}
        confirmLoading={renewing}
        okText={t('portal.confirmRenew', { cost: formatCents(selectedCost) })}
        cancelText={t('cancel')}
        title={t('portal.renewTitle')}
        destroyOnHidden
      >
        <div className="portal-renew-custom">
          <span>{t('portal.customDays')}</span>
          <InputNumber
            min={1}
            max={120}
            value={renew.customMonths ?? 1}
            onChange={(v) =>
              setRenew((r) => ({ ...r, customMonths: typeof v === 'number' ? v : null }))
            }
          />
        </div>
        <p className="portal-renew-hint">
          {t('portal.renewHint', {
            balance: formatCents(balance),
            cost: formatCents(selectedCost),
          })}
        </p>
      </Modal>
    </ConfigProvider>
  );
}
