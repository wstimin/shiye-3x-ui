import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Button,
  ConfigProvider,
  Empty,
  Input,
  InputNumber,
  Layout,
  Modal,
  Progress,
  QRCode,
  Select,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { TabsProps } from 'antd';
import {
  ArrowDownOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudServerOutlined,
  CopyOutlined,
  DashboardOutlined,
  DownloadOutlined,
  GiftOutlined,
  GlobalOutlined,
  IdcardOutlined,
  LinkOutlined,
  LogoutOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  RightOutlined,
  RocketOutlined,
  SafetyCertificateFilled,
  ShoppingCartOutlined,
  UnorderedListOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';

import { ClipboardManager, HttpUtil, IntlUtil, LanguageManager, SizeFormatter } from '@/utils';
import { setMessageInstance } from '@/utils/messageBus';
import SubAppsTab from '../sub/SubAppsTab';
import SubConfigsTab from '../sub/SubConfigsTab';
import { buildSubApps, detectPlatform, usagePercent } from '../sub/subPageModel';
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
import { portalTheme } from './portalTheme';
import './PortalPage.css';
import '../sub/SubPage.css';

const JSON_POST_OPTIONS = {
  silent: true,
  headers: { 'Content-Type': 'application/json' },
} as const;

interface RenewState {
  open: boolean;
  months: number;
  customMonths: number | null;
  email: string;
}

type PortalSection = 'overview' | 'nodes' | 'wallet' | 'account';

const PORTAL_SECTION_COPY: Record<PortalSection, { kicker: string; title: string }> = {
  overview: { kicker: 'portal.sectionOverviewKicker', title: 'portal.sectionOverviewTitle' },
  nodes: { kicker: 'portal.sectionNodesKicker', title: 'portal.sectionNodesTitle' },
  wallet: { kicker: 'portal.sectionWalletKicker', title: 'portal.sectionWalletTitle' },
  account: { kicker: 'portal.sectionAccountKicker', title: 'portal.sectionAccountTitle' },
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
  const lang = LanguageManager.getLanguage('subscription');
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [renew, setRenew] = useState<RenewState>({
    open: false,
    months: 1,
    customMonths: 1,
    email: '',
  });
  const [qrSubscription, setQrSubscription] = useState<{ title: string; url: string } | null>(null);
  const [activeSection, setActiveSection] = useState<PortalSection>('overview');

  const refreshPromise = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (refreshPromise.current) return refreshPromise.current;
    const request = (async () => {
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
    })().finally(() => {
      refreshPromise.current = null;
    });
    refreshPromise.current = request;
    return request;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (cancelled) return;
      setBooted(true);
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
  const portalBindings = useMemo(
    () =>
      me?.bindings?.length
        ? me.bindings
        : me
          ? [
              {
                email: me.email,
                pricePerMonthCents: me.pricePerMonthCents,
                expiryTime: me.expiryTime,
                traffic: me.traffic,
              },
            ]
          : [],
    [me],
  );
  const selectedBinding =
    portalBindings.find((binding) => binding.email === renew.email) ?? portalBindings[0];
  const monthlyPrice =
    selectedBinding?.pricePerMonthCents ?? me?.pricePerMonthCents ?? plans?.pricePerMonthCents ?? 0;
  const selectedCost = planCostCents(selectedMonths, monthlyPrice);

  const onRenew = useCallback(async () => {
    setRenewing(true);
    try {
      const msg = await HttpUtil.post<{ expiryTime: number; balanceCents: number }>(
        '/portal/api/billing/renew',
        { months: selectedMonths, email: selectedBinding?.email ?? '' },
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
  }, [selectedMonths, selectedBinding?.email, messageApi, t, refresh]);

  const onLogout = useCallback(async () => {
    await HttpUtil.post('/portal/api/auth/logout', {}, JSON_POST_OPTIONS);
    setMe(null);
    setNodes([]);
    setSubs(null);
    setTxns([]);
  }, []);

  const direction = lang === 'fa-IR' || lang === 'ar-EG' ? 'rtl' : 'ltr';
  // The customer portal is intentionally a bright, branded surface. Keep
  // the persisted panel theme from turning this page into a dark UI.
  const pageClass = 'portal-page x-user-center';

  const siteTitle = plans?.siteTitle || t('portal.defaultTitle');

  useEffect(() => {
    document.title = siteTitle;
  }, [siteTitle]);

  const balance = me?.balanceCents ?? 0;
  const totalUsed = portalBindings.reduce(
    (sum, binding) => sum + (binding.traffic?.up ?? 0) + (binding.traffic?.down ?? 0),
    0,
  );
  const totalQuota = portalBindings.reduce(
    (sum, binding) => sum + (binding.traffic?.total ?? 0),
    0,
  );
  const runningNodes = nodes.filter((node) => node.enable).length;
  const finiteExpiries = portalBindings
    .map((binding) => binding.expiryTime)
    .filter((expiry) => expiry > 0);
  const expireMs = finiteExpiries.length > 0 ? Math.min(...finiteExpiries) : 0;
  const daysLeft = expireMs > 0 ? Math.max(0, Math.ceil((expireMs - nowMs) / 86_400_000)) : null;
  const trafficPercent = usagePercent(totalUsed, totalQuota);
  const remainingTraffic = totalQuota > 0 ? Math.max(0, totalQuota - totalUsed) : 0;

  const subscriptionItems = useMemo(
    () =>
      subs?.subscriptions?.length
        ? subs.subscriptions
        : subs
          ? [
              {
                email: me?.email ?? '',
                links: subs.links,
                subUrl: subs.subUrl,
                subJsonUrl: subs.subJsonUrl,
                subClashUrl: subs.subClashUrl,
              },
            ]
          : [],
    [subs, me?.email],
  );
  const primarySubscription = subscriptionItems[0];
  const apps = useMemo(
    () =>
      buildSubApps({
        subUrl: primarySubscription?.subUrl ?? '',
        sId: primarySubscription?.email ?? '',
        subTitle: siteTitle,
      }),
    [primarySubscription, siteTitle],
  );
  const initialPlatform = detectPlatform(navigator.userAgent);

  const subRows = useMemo(() => {
    return subscriptionItems.flatMap((subscription) =>
      [
        {
          key: `${subscription.email}-SUB`,
          kind: 'SUB',
          color: 'green',
          url: subscription.subUrl ?? '',
          title: `${siteTitle} · ${subscription.email}`,
          downloadable: false,
        },
        {
          key: `${subscription.email}-JSON`,
          kind: 'JSON',
          color: 'purple',
          url: subscription.subJsonUrl ?? '',
          title: `${siteTitle} JSON · ${subscription.email}`,
          downloadable: true,
        },
        {
          key: `${subscription.email}-CLASH`,
          kind: 'CLASH',
          color: 'gold',
          url: subscription.subClashUrl ?? '',
          title: `Clash / Mihomo · ${subscription.email}`,
          downloadable: true,
        },
      ].filter((row) => row.url),
    );
  }, [subscriptionItems, siteTitle]);

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
              <div key={row.key} className="sub-row">
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
                    icon={<QrcodeOutlined />}
                    onClick={() => setQrSubscription({ title: row.title, url: row.url })}
                    aria-label={t('portal.showQrCode')}
                    title={t('portal.showQrCode')}
                  />
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
    if (primarySubscription?.subUrl) {
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
    const configLinks = subscriptionItems.flatMap((subscription) => subscription.links || []);
    if (configLinks.length > 0) {
      items.push({
        key: 'configs',
        icon: <UnorderedListOutlined />,
        label: (
          <>
            {t('subscription.tabConfigs')}
            <span className="sub-tab-count">{configLinks.length}</span>
          </>
        ),
        children: <SubConfigsTab links={configLinks} onCopy={copy} />,
      });
    }
    return items;
  }, [
    t,
    subRows,
    primarySubscription?.subUrl,
    subscriptionItems,
    apps,
    initialPlatform,
    copy,
    setQrSubscription,
  ]);

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
    { key: 'overview' as const, label: t('portal.navOverview'), icon: <DashboardOutlined /> },
    {
      key: 'nodes' as const,
      label: t('portal.myNodes'),
      icon: <GlobalOutlined />,
      count: nodes.length,
    },
    { key: 'wallet' as const, label: t('portal.navWallet'), icon: <WalletOutlined /> },
    { key: 'account' as const, label: t('portal.navAccount'), icon: <IdcardOutlined /> },
  ];

  const nodeRows = (visibleNodes: PortalNode[]) =>
    visibleNodes.map((n) => (
      <div key={`${n.email}-${n.protocol}-${n.remark}`} className="portal-node-row">
        <span className="portal-node-icon">
          <CloudServerOutlined />
        </span>
        <div className="portal-node-main">
          <span className="portal-node-remark" dir="auto">
            {n.remark}
          </span>
          <span className="portal-node-protocol">
            {n.protocol} · {n.email}
          </span>
        </div>
        {n.enable ? (
          <span className="portal-node-pulse">
            <i />
            {t('portal.running')}
          </span>
        ) : (
          <Tag color="red">{t('disabled')}</Tag>
        )}
      </div>
    ));

  const versionLabel = window.X_UI_CUR_VER ? `v${window.X_UI_CUR_VER}` : '';
  const metrics = [
    {
      key: 'balance',
      label: t('portal.balance'),
      value: formatCents(balance),
      hint: t('portal.balanceHint'),
      icon: <WalletOutlined />,
      tone: 'blue',
    },
    {
      key: 'expiry',
      label: t('portal.remainingTime'),
      value: daysLeft === null ? t('portal.longTerm') : t('portal.daysCount', { count: daysLeft }),
      hint:
        expireMs > 0
          ? t('portal.expiresOn', { date: IntlUtil.formatDate(expireMs, 'gregorian', lang) })
          : t('portal.noExpiryLimit'),
      icon: <CalendarOutlined />,
      tone: 'violet',
    },
    {
      key: 'traffic',
      label: t('portal.periodUsed'),
      value: SizeFormatter.sizeFormat(totalUsed),
      hint:
        totalQuota > 0
          ? t('portal.totalTrafficHint', { total: SizeFormatter.sizeFormat(totalQuota) })
          : t('portal.unlimitedTraffic'),
      icon: <BarChartOutlined />,
      tone: 'cyan',
    },
    {
      key: 'nodes',
      label: t('portal.availableNodes'),
      value: `${runningNodes} / ${nodes.length}`,
      hint:
        runningNodes === nodes.length
          ? t('portal.allNodesHealthy')
          : t('portal.someNodesUnavailable'),
      icon: <CloudServerOutlined />,
      tone: 'green',
    },
  ];

  return (
    <ConfigProvider theme={portalTheme} direction={direction}>
      {messageContextHolder}
      <Layout className={pageClass} dir={direction}>
        <aside
          className="portal-sidebar"
          aria-label={t('portal.portalNavigation', { title: siteTitle })}
        >
          <div className="sidebar-brand">
            <span className="sidebar-logo" aria-hidden="true">
              <SafetyCertificateFilled />
            </span>
            <span className="sidebar-brand-copy">
              <strong>{siteTitle}</strong>
              <small>{t('portal.serviceCenter')}</small>
            </span>
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
          {plans?.purchaseUrl && (
            <a
              className="sidebar-purchase"
              href={plans.purchaseUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="sidebar-purchase-icon">
                <ShoppingCartOutlined />
              </span>
              <span>
                <strong>{t('portal.buyCode')}</strong>
                <small>{t('portal.buyCodeHint')}</small>
              </span>
              <RightOutlined />
            </a>
          )}
          <div className="sidebar-version">X Center {versionLabel}</div>
        </aside>
        <Layout className="portal-main">
          <header className="portal-topbar">
            <div className="portal-title-group">
              <span className="portal-kicker">
                {siteTitle} <i>/</i> {t(sectionCopy.kicker)}
              </span>
              <h1>{t(sectionCopy.title)}</h1>
            </div>
            <div className="portal-topbar-actions">
              <button
                type="button"
                className="portal-user-chip"
                onClick={() => switchSection('account')}
              >
                <Avatar size={38} icon={<UserOutlined />} />
                <span>
                  <b>{me.username}</b>
                  <small>
                    <i /> {t('portal.accountHealthy')}
                  </small>
                </span>
              </button>
              <Button
                className="portal-logout-button"
                type="text"
                icon={<LogoutOutlined />}
                aria-label={t('logout')}
                title={t('logout')}
                onClick={onLogout}
              />
            </div>
          </header>
          <nav className="portal-mobile-nav" aria-label={t('portal.mobileNavigation')}>
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
            <div key={activeSection} className="portal-view">
              {activeSection === 'overview' && (
                <>
                  <section className="portal-welcome-strip">
                    <div className="portal-welcome-copy">
                      <span className="portal-status-pill">
                        <CheckCircleFilled /> {t('portal.serviceHealthy')}
                      </span>
                      <h2>{t('portal.welcomeUser', { username: me.username })}</h2>
                      <p>{t('portal.welcomeDescription')}</p>
                      <div className="portal-hero-actions">
                        <Button
                          type="primary"
                          icon={<LinkOutlined />}
                          onClick={() => switchSection('nodes')}
                        >
                          {t('portal.viewSubscription')}
                        </Button>
                        <Button
                          icon={<ClockCircleOutlined />}
                          onClick={() =>
                            setRenew((current) => ({
                              ...current,
                              open: true,
                              email: current.email || portalBindings[0]?.email || '',
                            }))
                          }
                        >
                          {t('portal.renew')}
                        </Button>
                      </div>
                    </div>
                    <div className="portal-hero-visual" aria-hidden="true">
                      <span className="portal-orbit portal-orbit-one" />
                      <span className="portal-orbit portal-orbit-two" />
                      <span className="portal-hero-core">
                        <RocketOutlined />
                      </span>
                      <span className="portal-hero-node portal-hero-node-one" />
                      <span className="portal-hero-node portal-hero-node-two" />
                    </div>
                  </section>

                  <div className="portal-metric-grid">
                    {metrics.map((metric) => (
                      <article key={metric.key} className={`portal-metric-card is-${metric.tone}`}>
                        <span className="portal-metric-icon">{metric.icon}</span>
                        <div>
                          <span className="portal-metric-label">{metric.label}</span>
                          <strong>{metric.value}</strong>
                          <small>{metric.hint}</small>
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className="portal-dashboard-grid">
                    <section className="portal-surface portal-traffic-panel">
                      <div className="portal-section-heading">
                        <div>
                          <span className="portal-section-eyebrow">TRAFFIC</span>
                          <h3>{t('portal.monthlyTraffic')}</h3>
                        </div>
                        <strong className="portal-traffic-percent">
                          {totalQuota > 0 ? `${trafficPercent.toFixed(1)}%` : t('portal.unlimited')}
                        </strong>
                      </div>
                      <Progress
                        percent={totalQuota > 0 ? trafficPercent : 100}
                        showInfo={false}
                        strokeColor={{ from: '#2563eb', to: '#16b8c8' }}
                        trailColor="#eaf0f8"
                      />
                      <div className="portal-traffic-stats">
                        <div>
                          <span>
                            <ArrowDownOutlined /> {t('portal.usedTraffic')}
                          </span>
                          <strong>{SizeFormatter.sizeFormat(totalUsed)}</strong>
                        </div>
                        <div>
                          <span>{t('portal.remainingTraffic')}</span>
                          <strong>
                            {totalQuota > 0 ? SizeFormatter.sizeFormat(remainingTraffic) : '∞'}
                          </strong>
                        </div>
                        <div>
                          <span>{t('portal.totalQuota')}</span>
                          <strong>
                            {totalQuota > 0
                              ? SizeFormatter.sizeFormat(totalQuota)
                              : t('portal.unlimited')}
                          </strong>
                        </div>
                      </div>
                    </section>

                    <section className="portal-surface portal-quick-panel">
                      <div className="portal-section-heading">
                        <div>
                          <span className="portal-section-eyebrow">SHORTCUTS</span>
                          <h3>{t('portal.quickActions')}</h3>
                        </div>
                      </div>
                      <div className="portal-quick-actions">
                        <button type="button" onClick={() => switchSection('nodes')}>
                          <span className="is-blue">
                            <QrcodeOutlined />
                          </span>
                          <b>{t('portal.importSubscription')}</b>
                          <small>{t('portal.importSubscriptionHint')}</small>
                          <RightOutlined />
                        </button>
                        <button type="button" onClick={() => switchSection('wallet')}>
                          <span className="is-violet">
                            <GiftOutlined />
                          </span>
                          <b>{t('portal.rechargeWithCode')}</b>
                          <small>{t('portal.rechargeWithCodeHint')}</small>
                          <RightOutlined />
                        </button>
                      </div>
                    </section>
                  </div>

                  {nodes.length > 0 && (
                    <section className="portal-surface portal-node-section">
                      <div className="portal-section-heading">
                        <div>
                          <span className="portal-section-eyebrow">AVAILABLE NODES</span>
                          <h3>{t('portal.myNodes')}</h3>
                        </div>
                        <Button type="link" onClick={() => switchSection('nodes')}>
                          {t('portal.viewAll')} <RightOutlined />
                        </Button>
                      </div>
                      {nodeRows(nodes.slice(0, 3))}
                    </section>
                  )}
                </>
              )}

              {activeSection === 'nodes' && (
                <>
                  <section className="portal-surface portal-node-section">
                    <div className="portal-section-heading">
                      <div>
                        <span className="portal-section-eyebrow">AVAILABLE NODES</span>
                        <h3>{t('portal.myNodes')}</h3>
                      </div>
                      <span className="portal-live-badge">
                        <i /> {t('portal.runningCount', { count: runningNodes })}
                      </span>
                    </div>
                    {nodes.length > 0 ? nodeRows(nodes) : <Empty description={t('noData')} />}
                  </section>
                  {tabs.length > 0 ? (
                    <section className="portal-surface portal-subscription-section">
                      <div className="portal-section-heading">
                        <div>
                          <span className="portal-section-eyebrow">SUBSCRIPTION</span>
                          <h3>{t('portal.subscriptionsAndClients')}</h3>
                        </div>
                      </div>
                      <Tabs className="portal-tabs" tabBarGutter={24} items={tabs} />
                    </section>
                  ) : (
                    <Empty description={t('portal.noSubscriptions')} className="portal-empty" />
                  )}
                </>
              )}

              {activeSection === 'wallet' && (
                <>
                  <section className="portal-wallet-hero">
                    <div className="portal-wallet-icon">
                      <WalletOutlined />
                    </div>
                    <div>
                      <span>{t('portal.availableBalance')}</span>
                      <strong>{formatCents(balance)}</strong>
                      <small>{t('portal.availableBalanceHint')}</small>
                    </div>
                    <Button
                      type="primary"
                      icon={<ClockCircleOutlined />}
                      onClick={() =>
                        setRenew((current) => ({
                          ...current,
                          open: true,
                          email: current.email || portalBindings[0]?.email || '',
                        }))
                      }
                    >
                      {t('portal.renewNow')}
                    </Button>
                  </section>
                  <div className="portal-wallet-grid">
                    <section className="portal-surface portal-redeem-panel">
                      <div className="portal-section-heading">
                        <div>
                          <span className="portal-section-eyebrow">REDEEM</span>
                          <h3>{t('portal.recharge')}</h3>
                        </div>
                      </div>
                      <p className="portal-section-description">{t('portal.redeemDescription')}</p>
                      <div className="portal-recharge-row">
                        <Input
                          value={redeemCode}
                          onChange={(event) => setRedeemCode(event.target.value)}
                          placeholder={t('portal.codePlaceholder')}
                          onPressEnter={onRedeem}
                        />
                        <Button type="primary" loading={redeeming} onClick={onRedeem}>
                          {t('portal.redeem')}
                        </Button>
                      </div>
                      {plans?.purchaseUrl && (
                        <a
                          className="portal-purchase-card"
                          href={plans.purchaseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span className="portal-purchase-icon">
                            <ShoppingCartOutlined />
                          </span>
                          <span className="portal-purchase-copy">
                            <strong>{t('portal.noCodeYet')}</strong>
                            <small>{t('portal.purchaseDescription')}</small>
                          </span>
                          <span className="portal-purchase-button">
                            {t('portal.buyNow')} <RightOutlined />
                          </span>
                        </a>
                      )}
                    </section>
                    <section className="portal-surface portal-expiry-panel">
                      <span className="portal-section-eyebrow">SERVICE TERM</span>
                      <h3>{t('portal.currentValidity')}</h3>
                      <div className="portal-expiry-value">
                        <CalendarOutlined />
                        <strong>
                          {expireMs > 0
                            ? IntlUtil.formatDate(expireMs, 'gregorian', lang)
                            : t('subscription.noExpiry')}
                        </strong>
                      </div>
                      <span>
                        {daysLeft === null
                          ? t('portal.longTerm')
                          : t('portal.daysRemaining', { count: daysLeft })}
                      </span>
                      <Button icon={<ReloadOutlined />} onClick={refresh}>
                        {t('portal.refreshData')}
                      </Button>
                    </section>
                  </div>
                  <section className="portal-surface portal-history-section">
                    <div className="portal-section-heading">
                      <div>
                        <span className="portal-section-eyebrow">TRANSACTIONS</span>
                        <h3>{t('portal.history')}</h3>
                      </div>
                    </div>
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
                      <Empty description={t('portal.noTransactions')} className="portal-empty" />
                    )}
                  </section>
                </>
              )}

              {activeSection === 'account' && (
                <section className="portal-surface portal-account-section">
                  <div className="portal-account-avatar">
                    <Avatar size={58} icon={<UserOutlined />} />
                    <div>
                      <h3>{me.username}</h3>
                      <span className="portal-live-badge">
                        <i /> {t('portal.accountHealthy')}
                      </span>
                    </div>
                  </div>
                  <div className="portal-account-grid">
                    <div>
                      <span>{t('portal.loginUsername')}</span>
                      <strong>{me.username}</strong>
                    </div>
                  </div>
                  <div className="portal-account-actions">
                    <Button icon={<ReloadOutlined />} onClick={refresh}>
                      {t('portal.refreshAccount')}
                    </Button>
                    <Button danger icon={<LogoutOutlined />} onClick={onLogout}>
                      {t('logout')}
                    </Button>
                  </div>
                  <p className="portal-account-note">{t('portal.accountManagedByAdmin')}</p>
                </section>
              )}
            </div>
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
        {portalBindings.length > 1 && (
          <div className="portal-renew-target">
            <span>{t('portal.selectRenewClient')}</span>
            <Select
              value={selectedBinding?.email}
              options={portalBindings.map((binding) => ({
                value: binding.email,
                label: `${binding.email} · ${t('portal.pricePerMonth', { price: formatCents(binding.pricePerMonthCents) })}`,
              }))}
              onChange={(email) => setRenew((current) => ({ ...current, email }))}
            />
          </div>
        )}
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
          {t('portal.renewItem', {
            item: selectedBinding?.email || '—',
            price: formatCents(monthlyPrice),
          })}
          <br />
          {t('portal.renewHint', {
            balance: formatCents(balance),
            cost: formatCents(selectedCost),
          })}
        </p>
      </Modal>
      <Modal
        rootClassName="portal-qr-modal"
        open={Boolean(qrSubscription)}
        onCancel={() => setQrSubscription(null)}
        footer={null}
        centered
        width={420}
        title={
          <div className="portal-qr-modal-title">
            <span>
              <QrcodeOutlined />
            </span>
            <div>
              <strong>{t('portal.subscriptionQr')}</strong>
              <small>{t('portal.subscriptionQrHint')}</small>
            </div>
          </div>
        }
        destroyOnHidden
      >
        {qrSubscription && (
          <div className="portal-sub-qr">
            <div className="portal-sub-qr-badge">
              <SafetyCertificateFilled />
              {t('portal.secureSubscription')}
            </div>
            <div className="portal-sub-qr-frame">
              <i aria-hidden="true" />
              <QRCode
                value={qrSubscription.url}
                size={224}
                color="#172554"
                bgColor="#ffffff"
                bordered={false}
                errorLevel="H"
              />
            </div>
            <div className="portal-sub-qr-copy">
              <strong>{qrSubscription.title}</strong>
              <span>{t('portal.scanQrDescription')}</span>
            </div>
            <div className="portal-sub-qr-link">
              <LinkOutlined />
              <span>{qrSubscription.url}</span>
            </div>
            <Button
              type="primary"
              size="large"
              block
              icon={<CopyOutlined />}
              onClick={() => copy(qrSubscription.url)}
            >
              {t('portal.copySubscriptionLink')}
            </Button>
          </div>
        )}
      </Modal>
    </ConfigProvider>
  );
}
