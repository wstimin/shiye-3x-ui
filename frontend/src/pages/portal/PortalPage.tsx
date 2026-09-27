import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Select,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { TabsProps } from 'antd';
import {
  ApiOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CopyOutlined,
  DownloadOutlined,
  GiftOutlined,
  GlobalOutlined,
  HomeOutlined,
  LinkOutlined,
  LogoutOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  ThunderboltFilled,
  UnorderedListOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';

import { ClipboardManager, HttpUtil, IntlUtil, LanguageManager, SizeFormatter } from '@/utils';
import { setMessageInstance } from '@/utils/messageBus';
import { buildAntdThemeConfig } from '@/hooks/useTheme';
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
import './PortalPage.css';
import '../sub/SubPage.css';

const ACCENT = {
  primary: '#2563eb',
  hover: '#3b76ef',
  active: '#1d4ed8',
  rail: 'rgba(37, 99, 235, 0.14)',
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
  overview: { kicker: '工作台', title: '账户总览' },
  nodes: { kicker: '服务管理', title: '节点与订阅' },
  wallet: { kicker: '财务中心', title: '余额与续期' },
  account: { kicker: '个人中心', title: '账户设置' },
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
    const baseTheme = buildAntdThemeConfig(false, false);
    const primary = {
      colorPrimary: ACCENT.primary,
      colorPrimaryHover: ACCENT.hover,
      colorPrimaryActive: ACCENT.active,
    };
    return {
      ...baseTheme,
      token: {
        ...baseTheme.token,
        ...primary,
        colorBgBase: '#ffffff',
        colorBgContainer: '#ffffff',
        colorBgElevated: '#ffffff',
        colorBorder: '#dfe8f3',
        colorText: '#14213a',
        colorTextSecondary: '#718096',
        colorLink: ACCENT.primary,
        colorInfo: ACCENT.primary,
      },
      components: {
        ...baseTheme.components,
        Button: { ...baseTheme.components?.Button, ...primary },
        Progress: { ...baseTheme.components?.Progress, remainingColor: ACCENT.rail },
      },
    };
  }, []);

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
  const daysLeft = expireMs > 0 ? Math.max(0, Math.ceil((expireMs - nowMs) / 86_400_000)) : null;
  const trafficPercent = usagePercent(totalUsed, totalQuota);
  const remainingTraffic = totalQuota > 0 ? Math.max(0, totalQuota - totalUsed) : 0;

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
          <ApiOutlined />
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

  const versionLabel = window.X_UI_CUR_VER ? `v${window.X_UI_CUR_VER}` : '';
  const languageOptions = LanguageManager.supportedLanguages.map((item) => ({
    value: item.value,
    label: (
      <span className="portal-language-option">
        <span>{item.icon}</span>
        <span>{item.name}</span>
      </span>
    ),
  }));

  const metrics = [
    {
      key: 'balance',
      label: t('portal.balance'),
      value: formatCents(balance),
      hint: '可用于节点续期',
      icon: <WalletOutlined />,
      tone: 'blue',
    },
    {
      key: 'expiry',
      label: '剩余时间',
      value: daysLeft === null ? '长期有效' : `${daysLeft} 天`,
      hint:
        expireMs > 0
          ? `到期 ${IntlUtil.formatDate(expireMs, 'gregorian', lang)}`
          : '当前账户无到期限制',
      icon: <CalendarOutlined />,
      tone: 'violet',
    },
    {
      key: 'traffic',
      label: '本期已用',
      value: SizeFormatter.sizeFormat(totalUsed),
      hint: totalQuota > 0 ? `共 ${SizeFormatter.sizeFormat(totalQuota)}` : '不限流量',
      icon: <ArrowUpOutlined />,
      tone: 'cyan',
    },
    {
      key: 'nodes',
      label: '可用节点',
      value: `${runningNodes} / ${nodes.length}`,
      hint: runningNodes === nodes.length ? '全部运行正常' : '部分节点不可用',
      icon: <GlobalOutlined />,
      tone: 'green',
    },
  ];

  return (
    <ConfigProvider theme={themeConfig} direction={direction}>
      {messageContextHolder}
      <Layout className={pageClass} dir={direction}>
        <aside className="portal-sidebar" aria-label={`${siteTitle}导航`}>
          <div className="sidebar-brand">
            <span className="sidebar-logo">X</span>
            <span className="sidebar-brand-copy">
              <strong>{siteTitle}</strong>
              <small>客户服务中心</small>
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
                <GiftOutlined />
              </span>
              <span>
                <strong>购买卡密</strong>
                <small>前往商城充值余额</small>
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
                {siteTitle} <i>/</i> {sectionCopy.kicker}
              </span>
              <h1>{sectionCopy.title}</h1>
            </div>
            <div className="portal-topbar-actions">
              <Select
                className="portal-language-select"
                value={lang}
                onChange={onLangChange}
                options={languageOptions}
                suffixIcon={<GlobalOutlined />}
                popupMatchSelectWidth={180}
                aria-label="选择语言"
              />
              <button
                type="button"
                className="portal-user-chip"
                onClick={() => switchSection('account')}
              >
                <Avatar size={38} icon={<UserOutlined />} />
                <span>
                  <b>{me.username}</b>
                  <small>
                    <i /> 账户正常
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
            <div key={activeSection} className="portal-view">
              {activeSection === 'overview' && (
                <>
                  <section className="portal-welcome-strip">
                    <div className="portal-welcome-copy">
                      <span className="portal-status-pill">
                        <CheckCircleFilled /> 服务运行正常
                      </span>
                      <h2>
                        欢迎回来，<strong>{me.username}</strong>
                      </h2>
                      <p>节点、订阅与账户信息已经为你准备好。</p>
                      <div className="portal-hero-actions">
                        <Button
                          type="primary"
                          icon={<LinkOutlined />}
                          onClick={() => switchSection('nodes')}
                        >
                          查看订阅
                        </Button>
                        <Button
                          icon={<ClockCircleOutlined />}
                          onClick={() => setRenew((current) => ({ ...current, open: true }))}
                        >
                          {t('portal.renew')}
                        </Button>
                      </div>
                    </div>
                    <div className="portal-hero-visual" aria-hidden="true">
                      <span className="portal-orbit portal-orbit-one" />
                      <span className="portal-orbit portal-orbit-two" />
                      <span className="portal-hero-core">
                        <ThunderboltFilled />
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
                          <h3>本月流量</h3>
                        </div>
                        <strong className="portal-traffic-percent">
                          {totalQuota > 0 ? `${trafficPercent.toFixed(1)}%` : '不限量'}
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
                            <ArrowDownOutlined /> 已使用
                          </span>
                          <strong>{SizeFormatter.sizeFormat(totalUsed)}</strong>
                        </div>
                        <div>
                          <span>剩余流量</span>
                          <strong>
                            {totalQuota > 0 ? SizeFormatter.sizeFormat(remainingTraffic) : '∞'}
                          </strong>
                        </div>
                        <div>
                          <span>总额度</span>
                          <strong>
                            {totalQuota > 0 ? SizeFormatter.sizeFormat(totalQuota) : '不限量'}
                          </strong>
                        </div>
                      </div>
                    </section>

                    <section className="portal-surface portal-quick-panel">
                      <div className="portal-section-heading">
                        <div>
                          <span className="portal-section-eyebrow">SHORTCUTS</span>
                          <h3>快捷操作</h3>
                        </div>
                      </div>
                      <div className="portal-quick-actions">
                        <button type="button" onClick={() => switchSection('nodes')}>
                          <span className="is-blue">
                            <QrcodeOutlined />
                          </span>
                          <b>导入订阅</b>
                          <small>复制链接或扫码导入</small>
                          <RightOutlined />
                        </button>
                        <button type="button" onClick={() => switchSection('wallet')}>
                          <span className="is-violet">
                            <GiftOutlined />
                          </span>
                          <b>卡密充值</b>
                          <small>兑换卡密到账户余额</small>
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
                  <section className="portal-surface portal-node-section">
                    <div className="portal-section-heading">
                      <div>
                        <span className="portal-section-eyebrow">AVAILABLE NODES</span>
                        <h3>{t('portal.myNodes')}</h3>
                      </div>
                      <span className="portal-live-badge">
                        <i /> {runningNodes} 个运行中
                      </span>
                    </div>
                    {nodes.length > 0 ? nodeRows(nodes) : <Empty description={t('noData')} />}
                  </section>
                  {tabs.length > 0 ? (
                    <section className="portal-surface portal-subscription-section">
                      <div className="portal-section-heading">
                        <div>
                          <span className="portal-section-eyebrow">SUBSCRIPTION</span>
                          <h3>订阅与客户端</h3>
                        </div>
                      </div>
                      <Tabs className="portal-tabs" tabBarGutter={24} items={tabs} />
                    </section>
                  ) : (
                    <Empty description="当前账号暂无可用订阅" className="portal-empty" />
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
                      <span>账户可用余额</span>
                      <strong>{formatCents(balance)}</strong>
                      <small>余额可直接用于续期已绑定的节点</small>
                    </div>
                    <Button
                      type="primary"
                      icon={<ClockCircleOutlined />}
                      onClick={() => setRenew((current) => ({ ...current, open: true }))}
                    >
                      立即续期
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
                      <p className="portal-section-description">
                        输入有效卡密，金额会立即充值到账户余额。
                      </p>
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
                            <GiftOutlined />
                          </span>
                          <span className="portal-purchase-copy">
                            <strong>还没有卡密？</strong>
                            <small>前往购买页面，完成后回到这里兑换</small>
                          </span>
                          <span className="portal-purchase-button">
                            立即购买 <RightOutlined />
                          </span>
                        </a>
                      )}
                    </section>
                    <section className="portal-surface portal-expiry-panel">
                      <span className="portal-section-eyebrow">SERVICE TERM</span>
                      <h3>当前有效期</h3>
                      <div className="portal-expiry-value">
                        <CalendarOutlined />
                        <strong>
                          {expireMs > 0
                            ? IntlUtil.formatDate(expireMs, 'gregorian', lang)
                            : t('subscription.noExpiry')}
                        </strong>
                      </div>
                      <span>{daysLeft === null ? '长期有效' : `剩余 ${daysLeft} 天`}</span>
                      <Button icon={<ReloadOutlined />} onClick={refresh}>
                        刷新数据
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
                      <Empty description="暂无余额流水" className="portal-empty" />
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
                        <i /> 账户状态正常
                      </span>
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
                    <Button danger icon={<LogoutOutlined />} onClick={onLogout}>
                      {t('logout')}
                    </Button>
                  </div>
                  <p className="portal-account-note">登录资料由管理员在客户门户管理中维护。</p>
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
