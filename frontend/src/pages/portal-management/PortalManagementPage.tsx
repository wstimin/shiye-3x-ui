import { useCallback, useEffect, useState } from 'react';
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
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  WalletOutlined,
} from '@ant-design/icons';

import AppSidebar from '@/layouts/AppSidebar';
import { HttpUtil } from '@/utils';
import { setMessageInstance } from '@/utils/messageBus';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTheme } from '@/hooks/useTheme';
import './PortalManagementPage.css';

interface CustomerRow {
  username: string;
  email: string;
  balanceCents: number;
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
}

interface CustomerFormValues {
  username: string;
  password: string;
  email: string;
}

interface CouponFormValues {
  count: number;
  amountCents: number;
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
};

const money = (cents: number) => `¥ ${(cents / 100).toFixed(2)}`;

function apiObject<T>(result: { success?: boolean; obj?: unknown }, fallback: T): T {
  return result.success && result.obj !== undefined ? (result.obj as T) : fallback;
}

export default function PortalManagementPage() {
  const { antdThemeConfig } = useTheme();
  const { isMobile } = useMediaQuery();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [billing, setBilling] = useState<BillingValues>(emptyBilling);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingBilling, setSavingBilling] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerForm] = Form.useForm<CustomerFormValues>();
  const [billingForm] = Form.useForm<BillingValues>();
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
      billingForm.setFieldsValue({ ...nextBilling, cardProviderSecret: '', cardProviderSign: '' });
      setCustomers(apiObject<CustomerRow[]>(customerMsg, []));
      setCoupons(apiObject<CouponRow[]>(couponMsg, []));
    } finally {
      setLoading(false);
    }
  }, [billingForm]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const saveBilling = async (values: BillingValues) => {
    setSavingBilling(true);
    try {
      const result = await HttpUtil.post('/panel/api/portal/billing', values, { silent: true });
      if (!result.success) throw new Error(result.msg || '保存失败');
      setBilling({ ...billing, ...values });
      messageApi.success('门户设置已保存');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingBilling(false);
    }
  };

  const createCustomer = async (values: CustomerFormValues) => {
    const result = await HttpUtil.post('/panel/api/portal/customers', values, { silent: true });
    if (!result.success) {
      messageApi.error(result.msg || '创建客户失败');
      return;
    }
    messageApi.success('客户账号已创建');
    setCustomerModalOpen(false);
    customerForm.resetFields();
    await load();
  };

  const toggleCustomer = async (row: CustomerRow, enable: boolean) => {
    const result = await HttpUtil.post(`/panel/api/portal/customers/${encodeURIComponent(row.username)}`, { enable }, { silent: true });
    if (!result.success) messageApi.error(result.msg || '更新客户状态失败');
    else await load();
  };

  const deleteCustomer = (row: CustomerRow) => {
    Modal.confirm({
      title: '删除客户账号？',
      content: `将删除 ${row.username} 的门户登录和余额流水，不会删除节点客户端。`,
      okButtonProps: { danger: true },
      onOk: async () => {
        const result = await HttpUtil.post(`/panel/api/portal/customers/${encodeURIComponent(row.username)}/delete`, {}, { silent: true });
        if (!result.success) throw new Error(result.msg || '删除失败');
        messageApi.success('客户账号已删除');
        await load();
      },
    });
  };

  const generateCoupons = async (values: CouponFormValues) => {
    const result = await HttpUtil.post<{ codes: string[] }>('/panel/api/portal/coupons/generate', values, { silent: true });
    if (!result.success || !result.obj) {
      messageApi.error(result.msg || '生成卡密失败');
      return;
    }
    setGeneratedCodes(result.obj.codes || []);
    messageApi.success(`已生成 ${result.obj.codes?.length || 0} 张卡密`);
    await load();
  };

  const disableCoupon = async (row: CouponRow) => {
    const result = await HttpUtil.post(`/panel/api/portal/coupons/${row.id}/disable`, {}, { silent: true });
    if (!result.success) messageApi.error(result.msg || '作废失败');
    else await load();
  };

  const copyCodes = async () => {
    if (!generatedCodes.length) return;
    await navigator.clipboard?.writeText(generatedCodes.join('\n'));
    messageApi.success('卡密已复制');
  };

  const customerColumns: TableProps<CustomerRow>['columns'] = [
    { title: '登录用户', dataIndex: 'username', key: 'username' },
    { title: '绑定客户端邮箱', dataIndex: 'email', key: 'email' },
    { title: '余额', dataIndex: 'balanceCents', key: 'balance', render: (v: number) => money(v) },
    { title: '状态', dataIndex: 'enable', key: 'enable', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag> },
    {
      title: '操作', key: 'actions', render: (_, row) => (
        <Space>
          <Switch size="small" checked={row.enable} checkedChildren="启用" unCheckedChildren="停用" onChange={(v) => void toggleCustomer(row, v)} />
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => deleteCustomer(row)} />
        </Space>
      ),
    },
  ];

  const couponColumns: TableProps<CouponRow>['columns'] = [
    { title: '批次', dataIndex: 'batchNo', key: 'batchNo' },
    { title: '金额', dataIndex: 'amountCents', key: 'amount', render: (v: number) => money(v) },
    { title: '来源', dataIndex: 'source', key: 'source' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag color={v === 'unused' ? 'green' : v === 'used' ? 'blue' : 'default'}>{v}</Tag> },
    { title: '使用用户', dataIndex: 'usedBy', key: 'usedBy', render: (v: string) => v || '—' },
    { title: '操作', key: 'actions', render: (_, row) => row.status === 'unused' ? <Button size="small" danger onClick={() => void disableCoupon(row)}>作废</Button> : null },
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
                <Typography.Text className="portal-management-kicker">CUSTOMER CENTER</Typography.Text>
                <Typography.Title level={2}>客户门户管理</Typography.Title>
                <Typography.Paragraph>在这里可视化管理客户账号、余额卡密、月计费和购买入口。</Typography.Paragraph>
              </div>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
            </div>

            <Row gutter={[16, 16]}>
              <Col xs={24} xl={15}>
                <Card title={<Space><SettingOutlined />门户计费与品牌</Space>} className="portal-management-card">
                  <Form form={billingForm} layout="vertical" initialValues={billing} onFinish={(v) => void saveBilling(v)}>
                    <Row gutter={16}>
                      <Col xs={24} sm={8}><Form.Item label="每月价格（分）" name="pricePerMonthCents" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
                      <Col xs={24} sm={16}><Form.Item label="用户中心名称" name="siteTitle"><Input placeholder="X用户中心" /></Form.Item></Col>
                    </Row>
                    <Form.Item label="套餐显示信息（可选）" name="plans" extra="例如 [1,3,6]，实际扣款仍按每月价格计算"><Input placeholder="[1,3,6]" /></Form.Item>
                    <Form.Item label="卡密购买跳转链接" name="purchaseUrl" extra="这是用户点击购买卡密时跳转的链接，与三方接口地址独立"><Input prefix={<LinkOutlined />} placeholder="https://shop.example.com/codes" /></Form.Item>
                    <Divider>三方卡密系统接口预留</Divider>
                    <Alert type="info" showIcon message="这里只保存接口配置，具体协议由你的卡密系统适配。密钥留空表示保持原值。" style={{ marginBottom: 16 }} />
                    <Form.Item label="卡密接口地址" name="cardProviderUrl"><Input placeholder="https://example.com/api" /></Form.Item>
                    <Row gutter={16}>
                      <Col xs={24} sm={12}><Form.Item label="接口 Secret" name="cardProviderSecret"><Input.Password placeholder="留空保持原值" /></Form.Item></Col>
                      <Col xs={24} sm={12}><Form.Item label="签名密钥" name="cardProviderSign"><Input.Password placeholder="留空保持原值" /></Form.Item></Col>
                    </Row>
                    <Button type="primary" htmlType="submit" loading={savingBilling}>保存门户设置</Button>
                  </Form>
                </Card>
              </Col>
              <Col xs={24} xl={9}>
                <Card className="portal-management-card portal-management-summary">
                  <Statistic title="客户账号" value={customers.length} prefix={<SafetyCertificateOutlined />} />
                  <Divider />
                  <Statistic title="卡密记录" value={coupons.length} prefix={<WalletOutlined />} />
                  <Divider />
                  <Typography.Text type="secondary">门户地址：/portal</Typography.Text>
                </Card>
              </Col>
            </Row>

            <Card title="客户账号" className="portal-management-card" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCustomerModalOpen(true)}>创建客户</Button>}>
              <Table rowKey="username" size={isMobile ? 'small' : 'middle'} loading={loading} columns={customerColumns} dataSource={customers} scroll={{ x: 680 }} pagination={{ pageSize: 8 }} />
            </Card>

            <Row gutter={[16, 16]}>
              <Col xs={24} xl={9}>
                <Card title="生成余额卡密" className="portal-management-card">
                  <Form form={couponForm} layout="vertical" initialValues={{ count: 10, amountCents: 2000 }} onFinish={(v) => void generateCoupons(v)}>
                    <Row gutter={12}><Col span={12}><Form.Item label="数量" name="count" rules={[{ required: true }]}><InputNumber min={1} max={1000} style={{ width: '100%' }} /></Form.Item></Col><Col span={12}><Form.Item label="金额（分）" name="amountCents" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col></Row>
                    <Form.Item label="前缀" name="prefix"><Input placeholder="VIP-" /></Form.Item>
                    <Form.Item label="批次号" name="batchNo"><Input placeholder="例如 2026-09" /></Form.Item>
                    <Button type="primary" htmlType="submit" block>生成卡密</Button>
                  </Form>
                  {generatedCodes.length > 0 && <div className="portal-generated-codes"><Space style={{ marginBottom: 8 }}><Typography.Text strong>本次生成的卡密</Typography.Text><Button size="small" icon={<CopyOutlined />} onClick={() => void copyCodes()}>复制全部</Button></Space><Input.TextArea value={generatedCodes.join('\n')} readOnly autoSize={{ minRows: 4, maxRows: 10 }} /></div>}
                </Card>
              </Col>
              <Col xs={24} xl={15}>
                <Card title="卡密记录" className="portal-management-card"><Table rowKey="id" size="small" loading={loading} columns={couponColumns} dataSource={coupons} scroll={{ x: 620 }} pagination={{ pageSize: 8 }} /></Card>
              </Col>
            </Row>
          </Layout.Content>
        </Layout>
      </Layout>
      <Modal title="创建客户账号" open={customerModalOpen} destroyOnHidden onCancel={() => setCustomerModalOpen(false)} onOk={() => customerForm.submit()} okText="创建" cancelText="取消">
        <Form form={customerForm} layout="vertical" onFinish={(v) => void createCustomer(v)}>
          <Form.Item label="登录用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}><Input /></Form.Item>
          <Form.Item label="登录密码" name="password" rules={[{ required: true, message: '请输入密码' }]}><Input.Password /></Form.Item>
          <Form.Item label="绑定客户端邮箱" name="email" rules={[{ required: true, message: '请输入已存在的客户端邮箱' }]}><Input placeholder="必须是后台已有客户端邮箱" /></Form.Item>
        </Form>
      </Modal>
    </ConfigProvider>
  );
}
