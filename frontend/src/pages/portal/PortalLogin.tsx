import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ConfigProvider,
  Form,
  Input,
  Layout,
  Menu,
  Popover,
  Space,
  Spin,
  message,
} from 'antd';
import {
  LockOutlined,
  MoonFilled,
  MoonOutlined,
  SunOutlined,
  TranslationOutlined,
  UserOutlined,
} from '@ant-design/icons';

import { FormProvider, useForm } from 'react-hook-form';
import { HttpUtil, LanguageManager } from '@/utils';
import { FormField, rhfZodValidate } from '@/components/form/rhf';
import { setMessageInstance } from '@/utils/messageBus';
import { buildAntdThemeConfig, pauseAnimationsUntilLeave, useTheme } from '@/hooks/useTheme';
import { PortalLoginSchema, type PortalLoginValues, type PortalPlans } from './portalModel';
import './PortalPage.css';

interface PortalLoginProps {
  plans: PortalPlans | null;
  onDone: () => void;
}

// Standalone customer sign-in; posts to the portal API, never to /login.
export default function PortalLogin({ plans, onDone }: PortalLoginProps) {
  const { t } = useTranslation();
  const { isDark, isUltra, toggleTheme, toggleUltra } = useTheme();
  const [messageApi, messageContextHolder] = message.useMessage();

  useEffect(() => {
    setMessageInstance(messageApi);
  }, [messageApi]);

  const [submitting, setSubmitting] = useState(false);
  const methods = useForm<PortalLoginValues>({ defaultValues: { username: '', password: '' } });
  const [lang, setLang] = useState<string>(() => LanguageManager.getLanguage('subscription'));

  const onLangChange = (next: string) => {
    setLang(next);
    LanguageManager.setLanguage(next, 'subscription');
  };

  const onSubmit = async (values: PortalLoginValues) => {
    setSubmitting(true);
    try {
      const msg = await HttpUtil.post('/portal/api/auth/login', values, { silent: true });
      if (msg.success) {
        onDone();
      } else {
        messageApi.error(t('portal.loginFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const cycleTheme = () => {
    pauseAnimationsUntilLeave('portal-theme-cycle');
    if (!isDark) {
      toggleTheme();
      if (isUltra) toggleUltra();
    } else if (!isUltra) {
      toggleUltra();
    } else {
      toggleUltra();
      toggleTheme();
    }
  };

  const langMenuItems = (
    LanguageManager.supportedLanguages as { value: string; name: string; icon: string }[]
  ).map((l) => ({
    key: l.value,
    label: (
      <Space size={8}>
        <span aria-hidden="true">{l.icon}</span>
        <span>{l.name}</span>
      </Space>
    ),
  }));

  const themeIcon = !isDark ? <SunOutlined /> : !isUltra ? <MoonOutlined /> : <MoonFilled />;
  const title = plans?.siteTitle || 'X用户中心';

  return (
    <ConfigProvider theme={buildAntdThemeConfig(false, false)}>
      {messageContextHolder}
      <Layout className="portal-app x-user-center">
        <Layout.Content className="portal-content">
          <div className="portal-toolbar">
            <Button
              id="portal-theme-cycle"
              shape="circle"
              size="large"
              className="toolbar-btn"
              aria-label={t('menu.theme')}
              title={t('menu.theme')}
              icon={themeIcon}
              onClick={cycleTheme}
            />
            <Popover
              rootClassName={isDark ? 'dark' : 'light'}
              placement="bottomRight"
              trigger="click"
              styles={{ content: { padding: 4 } }}
              content={
                <Menu
                  mode="vertical"
                  selectable
                  selectedKeys={[lang]}
                  items={langMenuItems}
                  onClick={({ key }) => onLangChange(key)}
                  style={{ border: 'none', minWidth: 160 }}
                />
              }
            >
              <Button
                shape="circle"
                size="large"
                className="toolbar-btn"
                aria-label={t('pages.settings.language')}
                icon={<TranslationOutlined />}
              />
            </Popover>
          </div>

          <div className="portal-wrapper">
            <div className="portal-card">
              <div className="brand">
                <span className="brand-name">{title}</span>
                <span className="brand-accent" aria-hidden="true" />
              </div>
              <h2 className="welcome">{t('portal.welcome')}</h2>

              <FormProvider {...methods}>
                <Form
                  layout="vertical"
                  className="portal-form"
                  onFinish={methods.handleSubmit(onSubmit)}
                >
                  <FormField
                    name="username"
                    label={t('username')}
                    rules={{ validate: rhfZodValidate(PortalLoginSchema.shape.username) }}
                  >
                    <Input
                      prefix={<UserOutlined />}
                      autoComplete="username"
                      size="large"
                      placeholder={t('username')}
                      autoFocus
                    />
                  </FormField>

                  <FormField
                    name="password"
                    label={t('password')}
                    rules={{ validate: rhfZodValidate(PortalLoginSchema.shape.password) }}
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      autoComplete="current-password"
                      size="large"
                      placeholder={t('password')}
                    />
                  </FormField>

                  <Form.Item className="submit-row">
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={submitting}
                      size="large"
                      block
                    >
                      {t('login')}
                    </Button>
                  </Form.Item>
                </Form>
              </FormProvider>
            </div>
          </div>
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}

// Loading shell keeps hooks in one component while auth state resolves.
export function PortalLoading() {
  return (
    <Layout className="portal-app x-user-center">
      <Layout.Content className="portal-content">
        <div className="portal-loading">
          <Spin size="large" />
        </div>
      </Layout.Content>
    </Layout>
  );
}
