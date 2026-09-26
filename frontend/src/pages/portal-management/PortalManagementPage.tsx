import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  ConfigProvider,
  Divider,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  WalletOutlined,
} from '@ant-design/icons';

import AppSidebar from '@/layouts/AppSidebar';
import { HttpUtil } from '@/utils';
import { setMessageInstance } from '@/utils/messageBus';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTheme } from '@/hooks/useTheme';
import { useClientOptions } from '@/api/queries/useClientOptions';
import './PortalManagementPage.css';

interface CustomerRow {
  username: string;
  email: string;
  balanceCents: number;
  monthlyPriceCents: number;
  enable: boolean;
  createdAt: number;
}

interface CouponRow {
  id: number;
  amountCents: number;
  status: string;
  batchNo: string;
  source: string;
  usedBy: string;
  usedAt: number;
  expiresAt: number;
  createdAt: number;
}

interface BillingValues {
  pricePerMonthCents: number;
  plans: string;
  purchaseUrl: string;
  siteTitle: string;
  cardProviderUrl: string;
  cardProviderSecret: string;
  cardProviderSign: string;
  portalEnabled: boolean;
  portalListen: string;
  portalPort: number;
  portalPublicUrl: string;
}

interface BillingFormValues extends Omit<BillingValues, 'pricePerMonthCents'> {
  pricePerMonthYuan: number;
}

interface CustomerFormValues {
  username: string;
  password: string;
  email: string;
  monthlyPriceYuan: number;
}

interface ProviderFormValues {
  cardProviderUrl: string;
  cardProviderSecret: string;
  cardProviderSign: string;
}

interface CouponFormValues {
  count: number;
  amountYuan: number;
  prefix?: string;
  batchNo?: string;
  expiresAt?: number;
}

const emptyBilling: BillingValues = {
  pricePerMonthCents: 0,
  plans: '',
  purchaseUrl: '',
  siteTitle: 'X用户中心',
  cardProviderUrl: '',
  cardProviderSecret: '',
  cardProviderSign: '',
  portalEnabled: true,
  portalListen: '0.0.0.0',
  portalPort: 2054,
  portalPublicUrl: '',
};

const money = (cents: number) => `¥ ${(cents / 100).toFixed(2)}`;
const centsToYuan = (cents: number) => Number((cents / 100).toFixed(2));
const yuanToCents = (yuan: number) => Math.round(Number(yuan) * 100);

function portalAddress(settings: BillingValues): string {
  const configured = settings.portalPublicUrl.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.pathname === '/' || url.pathname === '') url.pathname = '/portal';
      return url.toString().replace(/\/$/, '');
    } catch {
      return configured;
    }
  }
  const rawHost = window.location.hostname;
  const host = rawHost.includes(':') ? `[${rawHost}]` : rawHost;
  return `${window.location.protocol}//${host}:${settings.portalPort}/portal`;
}

function apiObject<T>(result: { success?: boolean; obj?: unknown }, fallback: T): T {
  return result.success && result.obj !== undefined ? (result.obj as T) : fallback;
}

export default function PortalManagementPage() {
  const { antdThemeConfig } = useTheme();
  const { isMobile } = useMediaQuery();
  const { data: clientEmails = [], isLoading: clientsLoading } = useClientOptions();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [billing, setBilling] = useState<BillingValues>(emptyBilling);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingBilling, setSavingBilling] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRow | null>(null);
  const [customerForm] = Form.useForm<CustomerFormValues>();
  const [billingForm] = Form.useForm<BillingFormValues>();
  const [providerForm] = Form.useForm<ProviderFormValues>();
  const [couponForm] = Form.useForm<CouponFormValues>();

  useEffect(() => {
    const publishMessage = setMessageInstance;
    const task = window.setTimeout(() => publishMessage(messageApi), 0);
    return () => window.clearTimeout(task);
  }, [messageApi]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [billingMsg, customerMsg, couponMsg] = await Promise.all([
        HttpUtil.get('/panel/api/portal/billing', undefined, { silent: true }),
        HttpUtil.get('/panel/api/portal/customers', undefined, { silent: true }),
        HttpUtil.get('/panel/api/portal/coupons', undefined, { silent: true }),
      ]);
      const nextBilling = { ...emptyBilling, ...apiObject<Partial<BillingValues>>(billingMsg, {}) };
      setBilling(nextBilling);
      billingForm.setFieldsValue({
        ...nextBilling,
        pricePerMonthYuan: centsToYuan(nextBilling.pricePerMonthCents),
      });
      providerForm.setFieldsValue({
        cardProviderUrl: nextBilling.cardProviderUrl,
        cardProviderSecret: '',
        cardProviderSign: '',
      });
      setCustomers(apiObject<CustomerRow[]>(customerMsg, []));
      setCoupons(apiObject<CouponRow[]>(couponMsg, []));
    } finally {
      setLoading(false);
    }
  }, [billingForm, providerForm]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const saveBilling = async (
    values: Partial<BillingFormValues>,
    providerValues?: ProviderFormValues,
  ) => {
    const pricePerMonthYuan = values.pricePerMonthYuan ?? centsToYuan(billing.pricePerMonthCents);
    const payload: BillingValues = {
      ...billing,
      plans: values.plans ?? billing.plans,
      purchaseUrl: values.purchaseUrl ?? billing.purchaseUrl,
      siteTitle: values.siteTitle ?? billing.siteTitle,
      portalEnabled: values.portalEnabled ?? billing.portalEnabled,
      portalListen: values.portalListen ?? billing.portalListen,
      portalPort: values.portalPort ?? billing.portalPort,
      portalPublicUrl: values.portalPublicUrl ?? billing.portalPublicUrl,
      ...providerValues,
      pricePerMonthCents: yuanToCents(pricePerMonthYuan),
    };
    setSavingBilling(true);
    try {
      const result = await HttpUtil.post<{ restartScheduled: boolean }>(
        '/panel/api/portal/billing',
        payload,
        { silent: true },
      );
      if (!result.success) throw new Error(result.msg || '保存失败');
      setBilling(payload);
      messageApi.success(result.obj?.restartScheduled ? '设置已保存，服务正在重启' : '设置已保存');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingBilling(false);
    }
  };

  const saveCustomer = async (values: CustomerFormValues) => {
    const payload = {
      username: values.username,
      password: values.password,
      email: values.email,
      monthlyPriceCents: yuanToCents(values.monthlyPriceYuan),
    };
    const endpoint = editingCustomer
      ? `/panel/api/portal/customers/${encodeURIComponent(editingCustomer.username)}`
      : '/panel/api/portal/customers';
    const result = await HttpUtil.post(endpoint, payload, { silent: true });
    if (!result.success) {
      messageApi.error(result.msg || '保存客户失败');
      return;
    }
    messageApi.success(editingCustomer ? '客户账号已更新' : '客户账号已创建');
    setCustomerModalOpen(false);
    setEditingCustomer(null);
    customerForm.resetFields();
    await load();
  };

  const openCreateCustomer = () => {
    setEditingCustomer(null);
    customerForm.setFieldsValue({
      username: '',
      password: '',
      email: '',
      monthlyPriceYuan: centsToYuan(billing.pricePerMonthCents) || 1,
    });
    setCustomerModalOpen(true);
  };

  const openEditCustomer = (row: CustomerRow) => {
    setEditingCustomer(row);
    customerForm.setFieldsValue({
      username: row.username,
      password: '',
      email: row.email,
      monthlyPriceYuan: centsToYuan(row.monthlyPriceCents),
    });
    setCustomerModalOpen(true);
  };

  const toggleCustomer = async (row: CustomerRow, enable: boolean) => {
    const result = await HttpUtil.post(
      `/panel/api/portal/customers/${encodeURIComponent(row.username)}`,
      { enable },
      { silent: true },
    );
    if (!result.success) messageApi.error(result.msg || '更新客户状态失败');
    else await load();
  };

  const deleteCustomer = (row: CustomerRow) => {
    Modal.confirm({
      title: '删除客户账号？',
      content: `将删除 ${row.username} 的门户登录和余额流水，不会删除节点客户端。`,
      okButtonProps: { danger: true },
      onOk: async () => {
        const result = await HttpUtil.post(
          `/panel/api/portal/customers/${encodeURIComponent(row.username)}/delete`,
          {},
          { silent: true },
        );
        if (!result.success) throw new Error(result.msg || '删除失败');
        messageApi.success('客户账号已删除');
        await load();
      },
    });
  };

  const generateCoupons = async (values: CouponFormValues) => {
    const { amountYuan, ...rest } = values;
    const result = await HttpUtil.post<{ codes: string[] }>(
      '/panel/api/portal/coupons/generate',
      {
        ...rest,
        amountCents: yuanToCents(amountYuan),
      },
      { silent: true },
    );
    if (!result.success || !result.obj) {
      messageApi.error(result.msg || '生成卡密失败');
      return;
    }
    setGeneratedCodes(result.obj.codes || []);
    messageApi.success(`已生成 ${result.obj.codes?.length || 0} 张卡密`);
    await load();
  };

  const disableCoupon = async (row: CouponRow) => {
    const result = await HttpUtil.post(
      `/panel/api/portal/coupons/${row.id}/disable`,
      {},
      { silent: true },
    );
    if (!result.success) messageApi.error(result.msg || '作废失败');
    else await load();
  };

  const copyCodes = async () => {
    if (!generatedCodes.length) return;
    await navigator.clipboard?.writeText(generatedCodes.join('\n'));
    messageApi.success('卡密已复制');
  };

  const boundByEmail = useMemo(
    () => new Map(customers.map((customer) => [customer.email.toLowerCase(), customer.username])),
    [customers],
  );
  const clientSelectOptions = useMemo(
    () =>
      [...new Set(clientEmails)].map((email) => {
        const owner = boundByEmail.get(email.toLowerCase());
        return {
          value: email,
          label: owner ? `${email}（已绑定：${owner}）` : email,
          disabled: Boolean(owner && owner !== editingCustomer?.username),
        };
      }),
    [boundByEmail, clientEmails, editingCustomer?.username],
  );

  const customerColumns: TableProps<CustomerRow>['columns'] = [
    { title: '登录用户', dataIndex: 'username', key: 'username' },
    {
      title: '绑定客户端',
      dataIndex: 'email',
      key: 'email',
      render: (email: string) => (
        <Space size={6}>
          <Typography.Text copyable>{email}</Typography.Text>
          <Tag color="blue">已绑定</Tag>
        </Space>
      ),
    },
    {
      title: '每月价格',
      dataIndex: 'monthlyPriceCents',
      key: 'monthlyPriceCents',
      render: (v: number) => money(v),
    },
    { title: '余额', dataIndex: 'balanceCents', key: 'balance', render: (v: number) => money(v) },
    {
      title: '状态',
      dataIndex: 'enable',
      key: 'enable',
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, row) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEditCustomer(row)}>
            编辑
          </Button>
          <Switch
            size="small"
            checked={row.enable}
            checkedChildren="启用"
            unCheckedChildren="停用"
            onChange={(v) => void toggleCustomer(row, v)}
          />
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => deleteCustomer(row)}
          />
        </Space>
      ),
    },
  ];

  const couponColumns: TableProps<CouponRow>['columns'] = [
    { title: '批次', dataIndex: 'batchNo', key: 'batchNo' },
    { title: '金额', dataIndex: 'amountCents', key: 'amount', render: (v: number) => money(v) },
    { title: '来源', dataIndex: 'source', key: 'source' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => (
        <Tag color={v === 'unused' ? 'green' : v === 'used' ? 'blue' : 'default'}>{v}</Tag>
      ),
    },
    { title: '使用用户', dataIndex: 'usedBy', key: 'usedBy', render: (v: string) => v || '—' },
    {
      title: '操作',
      key: 'actions',
      render: (_, row) =>
        row.status === 'unused' ? (
          <Button size="small" danger onClick={() => void disableCoupon(row)}>
            作废
          </Button>
        ) : null,
    },
  ];

  return (
    <ConfigProvider theme={antdThemeConfig}>
      {messageContextHolder}
      <Layout className="portal-management-page">
        <AppSidebar />
        <Layout className="content-shell">
          <Layout.Content className="content-area portal-management-content">
            <div className="portal-management-heading">
              <div>
                <Typography.Text className="portal-management-kicker">
                  CUSTOMER CENTER
                </Typography.Text>
                <Typography.Title level={2}>客户门户管理</Typography.Title>
                <Typography.Paragraph>
                  在这里可视化管理客户账号、余额卡密、月计费和购买入口。
                </Typography.Paragraph>
              </div>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
                刷新
              </Button>
            </div>

            <Row gutter={[16, 16]} className="portal-management-overview">
              <Col xs={12} lg={6}>
                <Card className="portal-stat-card">
                  <Statistic
                    title="客户账号"
                    value={customers.length}
                    prefix={<SafetyCertificateOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={12} lg={6}>
                <Card className="portal-stat-card">
                  <Statistic title="卡密记录" value={coupons.length} prefix={<WalletOutlined />} />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card className="portal-access-card">
                  <div>
                    <Space>
                      <GlobalOutlined />
                      <Typography.Text strong>独立用户端</Typography.Text>
                      <Tag color={billing.portalEnabled ? 'green' : 'default'}>
                        {billing.portalEnabled ? '已启用' : '已停用'}
                      </Tag>
                    </Space>
                    <Typography.Text className="portal-address" copyable>
                      {portalAddress(billing)}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      用户端口 {billing.portalPort}，与管理后台端口完全分离
                    </Typography.Text>
                  </div>
                  <Button
                    type="primary"
                    icon={<LinkOutlined />}
                    href={portalAddress(billing)}
                    target="_blank"
                    rel="noreferrer"
                    disabled={!billing.portalEnabled}
                  >
                    打开用户端
                  </Button>
                </Card>
              </Col>
            </Row>

            <Tabs
              className="portal-management-tabs"
              defaultActiveKey="access"
              items={[
                {
                  key: 'access',
                  label: '门户与访问',
                  children: (
                    <Card className="portal-management-card" title="独立用户端设置">
                      <Alert
                        type="info"
                        showIcon
                        message="用户中心使用独立监听端口，不会开放管理后台页面。修改监听配置后服务会自动重启。"
                        style={{ marginBottom: 18 }}
                      />
                      <Form
                        form={billingForm}
                        layout="vertical"
                        onFinish={(v) => void saveBilling(v)}
                      >
                        <Row gutter={16}>
                          <Col xs={24} md={8}>
                            <Form.Item
                              label="启用独立用户端"
                              name="portalEnabled"
                              valuePropName="checked"
                            >
                              <Switch checkedChildren="启用" unCheckedChildren="停用" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item
                              label="用户端监听地址"
                              name="portalListen"
                              extra="公网访问填写 0.0.0.0"
                            >
                              <Input placeholder="0.0.0.0" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item
                              label="用户端独立端口"
                              name="portalPort"
                              rules={[{ required: true }]}
                            >
                              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item
                          label="用户端公开地址（可选）"
                          name="portalPublicUrl"
                          extra="填写独立域名或反向代理地址；留空时自动使用当前公网域名/IP和上面的用户端口"
                        >
                          <Input
                            prefix={<GlobalOutlined />}
                            placeholder="https://user.example.com/portal"
                          />
                        </Form.Item>
                        <Divider>页面与续期</Divider>
                        <Row gutter={16}>
                          <Col xs={24} md={12}>
                            <Form.Item label="用户中心名称" name="siteTitle">
                              <Input placeholder="X用户中心" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item
                              label="旧账号默认月费（元）"
                              name="pricePerMonthYuan"
                              extra="新账号在客户设置中单独定价"
                            >
                              <InputNumber
                                min={0}
                                precision={2}
                                step={0.01}
                                addonAfter="元"
                                style={{ width: '100%' }}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item label="续期月数选项" name="plans" extra="例如 [1,3,6]">
                          <Input placeholder="[1,3,6]" />
                        </Form.Item>
                        <Form.Item
                          label="卡密购买跳转链接"
                          name="purchaseUrl"
                          extra="用户点击购买卡密时打开的地址，与第三方卡密接口独立"
                        >
                          <Input
                            prefix={<LinkOutlined />}
                            placeholder="https://shop.example.com/codes"
                          />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={savingBilling}>
                          保存并应用
                        </Button>
                      </Form>
                    </Card>
                  ),
                },
                {
                  key: 'customers',
                  label: '客户与价格',
                  children: (
                    <Card
                      title="客户账号与客户端绑定"
                      className="portal-management-card"
                      extra={
                        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateCustomer}>
                          创建客户
                        </Button>
                      }
                    >
                      <Alert
                        type="info"
                        showIcon
                        message="每个账号绑定一个现有客户端，并使用该账号自己的月费价格。"
                        style={{ marginBottom: 16 }}
                      />
                      <Table
                        rowKey="username"
                        size={isMobile ? 'small' : 'middle'}
                        loading={loading}
                        columns={customerColumns}
                        dataSource={customers}
                        scroll={{ x: 860 }}
                        pagination={{ pageSize: 8 }}
                      />
                    </Card>
                  ),
                },
                {
                  key: 'coupons',
                  label: '余额卡密',
                  children: (
                    <Row gutter={[16, 16]}>
                      <Col xs={24} xl={9}>
                        <Card title="生成余额卡密" className="portal-management-card">
                          <Form
                            form={couponForm}
                            layout="vertical"
                            initialValues={{ count: 10, amountYuan: 20 }}
                            onFinish={(v) => void generateCoupons(v)}
                          >
                            <Row gutter={12}>
                              <Col span={12}>
                                <Form.Item label="数量" name="count" rules={[{ required: true }]}>
                                  <InputNumber min={1} max={1000} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={12}>
                                <Form.Item
                                  label="金额（元）"
                                  name="amountYuan"
                                  rules={[{ required: true }]}
                                >
                                  <InputNumber
                                    min={0.01}
                                    precision={2}
                                    step={0.01}
                                    addonAfter="元"
                                    style={{ width: '100%' }}
                                  />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Form.Item label="前缀" name="prefix">
                              <Input placeholder="VIP-" />
                            </Form.Item>
                            <Form.Item label="批次号" name="batchNo">
                              <Input placeholder="例如 2026-09" />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" block>
                              生成卡密
                            </Button>
                          </Form>
                          {generatedCodes.length > 0 && (
                            <div className="portal-generated-codes">
                              <Space style={{ marginBottom: 8 }}>
                                <Typography.Text strong>本次生成的卡密</Typography.Text>
                                <Button
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={() => void copyCodes()}
                                >
                                  复制全部
                                </Button>
                              </Space>
                              <Input.TextArea
                                value={generatedCodes.join('\n')}
                                readOnly
                                autoSize={{ minRows: 4, maxRows: 10 }}
                              />
                            </div>
                          )}
                        </Card>
                      </Col>
                      <Col xs={24} xl={15}>
                        <Card title="卡密记录" className="portal-management-card">
                          <Table
                            rowKey="id"
                            size="small"
                            loading={loading}
                            columns={couponColumns}
                            dataSource={coupons}
                            scroll={{ x: 620 }}
                            pagination={{ pageSize: 8 }}
                          />
                        </Card>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'provider',
                  label: '第三方卡密接口',
                  children: (
                    <Card className="portal-management-card" title="第三方卡密系统接口预留">
                      <Alert
                        type="info"
                        showIcon
                        message="这里只保存接口配置，具体协议由你的卡密系统适配。密钥留空表示保持原值。"
                        style={{ marginBottom: 16 }}
                      />
                      <Form
                        form={providerForm}
                        layout="vertical"
                        onFinish={(v) => void saveBilling({}, v)}
                      >
                        <Form.Item label="卡密接口地址" name="cardProviderUrl">
                          <Input placeholder="https://example.com/api" />
                        </Form.Item>
                        <Row gutter={16}>
                          <Col xs={24} md={12}>
                            <Form.Item label="接口 Secret" name="cardProviderSecret">
                              <Input.Password placeholder="留空保持原值" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item label="签名密钥" name="cardProviderSign">
                              <Input.Password placeholder="留空保持原值" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Button type="primary" htmlType="submit" loading={savingBilling}>
                          保存接口配置
                        </Button>
                      </Form>
                    </Card>
                  ),
                },
              ]}
            />
          </Layout.Content>
        </Layout>
      </Layout>
      <Modal
        title={editingCustomer ? `编辑客户：${editingCustomer.username}` : '创建客户账号'}
        open={customerModalOpen}
        destroyOnHidden
        onCancel={() => {
          setCustomerModalOpen(false);
          setEditingCustomer(null);
        }}
        onOk={() => customerForm.submit()}
        okText={editingCustomer ? '保存' : '创建'}
        cancelText="取消"
      >
        <Form form={customerForm} layout="vertical" onFinish={(v) => void saveCustomer(v)}>
          <Form.Item
            label="登录用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input disabled={Boolean(editingCustomer)} />
          </Form.Item>
          <Form.Item
            label={editingCustomer ? '新登录密码（留空保持不变）' : '登录密码'}
            name="password"
            rules={editingCustomer ? [] : [{ required: true, message: '请输入密码' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="绑定客户端邮箱（决定用户的节点和链接）"
            name="email"
            rules={[{ required: true, message: '请选择已存在的客户端' }]}
          >
            <Select
              showSearch
              loading={clientsLoading}
              options={clientSelectOptions}
              placeholder="搜索并选择后台已有客户端"
              optionFilterProp="label"
              notFoundContent={clientsLoading ? '正在加载客户端…' : '没有可绑定的客户端'}
            />
          </Form.Item>
          <Form.Item
            label="该客户每月价格（元）"
            name="monthlyPriceYuan"
            rules={[{ required: true, message: '请输入该客户的月费' }]}
          >
            <InputNumber
              min={0.01}
              precision={2}
              step={0.01}
              addonAfter="元/月"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </ConfigProvider>
  );
}
