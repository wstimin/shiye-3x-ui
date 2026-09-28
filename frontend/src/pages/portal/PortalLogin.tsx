import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfigProvider, Form, Input, Layout, Menu, Popover, message } from 'antd';

import { FormProvider, useForm } from 'react-hook-form';
import { HttpUtil, LanguageManager } from '@/utils';
import { FormField, rhfZodValidate } from '@/components/form/rhf';
import { setMessageInstance } from '@/utils/messageBus';
import { PortalLoginSchema, type PortalLoginValues, type PortalPlans } from './portalModel';
import {
  PortalArrowIcon,
  PortalBoltIcon,
  PortalBrandMark,
  PortalChevronIcon,
  PortalLanguageIcon,
  PortalLockIcon,
  PortalServicesIcon,
  PortalShieldIcon,
  PortalStatusIcon,
  PortalUserIcon,
} from './PortalLoginIcons';
import { portalTheme } from './portalTheme';
import './PortalPage.css';

interface PortalLoginProps {
  plans: PortalPlans | null;
  onDone: () => void;
}

const JSON_POST_OPTIONS = {
  silent: true,
  headers: { 'Content-Type': 'application/json' },
} as const;

// Standalone customer sign-in; posts to the portal API, never to /login.
export default function PortalLogin({ plans, onDone }: PortalLoginProps) {
  const { t } = useTranslation();
  const [messageApi, messageContextHolder] = message.useMessage();

  useEffect(() => {
    setMessageInstance(messageApi);
  }, [messageApi]);

  const [submitting, setSubmitting] = useState(false);
  const methods = useForm<PortalLoginValues>({ defaultValues: { username: '', password: '' } });
  const [lang, setLang] = useState<string>(() => LanguageManager.getLanguage('subscription'));
  const [languageOpen, setLanguageOpen] = useState(false);

  const onLangChange = (next: string) => {
    setLang(next);
    LanguageManager.setLanguage(next, 'subscription');
    setLanguageOpen(false);
  };

  const onSubmit = async (values: PortalLoginValues) => {
    setSubmitting(true);
    try {
      const msg = await HttpUtil.post('/portal/api/auth/login', values, JSON_POST_OPTIONS);
      if (msg.success) {
        onDone();
      } else {
        messageApi.error(t('portal.loginFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const languageItems = useMemo(
    () =>
      (LanguageManager.supportedLanguages as { value: string; name: string; icon: string }[]).map(
        (item) => ({
          key: item.value,
          label: (
            <span className="portal-language-option">
              <span className="portal-language-code" aria-hidden="true">
                {item.value.split('-')[0].toUpperCase()}
              </span>
              <span>{item.name}</span>
            </span>
          ),
        }),
      ),
    [],
  );
  const currentLanguage = LanguageManager.supportedLanguages.find((item) => item.value === lang);
  const direction = lang === 'fa-IR' || lang === 'ar-EG' ? 'rtl' : 'ltr';
  const title = plans?.siteTitle || t('portal.defaultTitle');

  return (
    <ConfigProvider theme={portalTheme} direction={direction}>
      {messageContextHolder}
      <Layout className="portal-app x-user-center" dir={direction}>
        <Layout.Content className="portal-content portal-login-content">
          <div className="portal-login-orb portal-login-orb-one" aria-hidden="true" />
          <div className="portal-login-orb portal-login-orb-two" aria-hidden="true" />
          <div className="portal-login-orbit" aria-hidden="true">
            <span className="portal-login-orbit-ring portal-login-orbit-ring-one" />
            <span className="portal-login-orbit-ring portal-login-orbit-ring-two" />
            <span className="portal-login-orbit-node portal-login-orbit-node-one" />
            <span className="portal-login-orbit-node portal-login-orbit-node-two" />
          </div>
          <div className="portal-login-layout">
            <section className="portal-login-story" aria-label={title}>
              <div className="portal-login-brand">
                <span className="portal-login-logo">
                  <PortalBrandMark />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{t('portal.loginBrandCaption')}</small>
                </span>
              </div>
              <div className="portal-login-story-copy">
                <span className="portal-login-eyebrow">
                  <PortalStatusIcon /> {t('portal.loginStatus')}
                </span>
                <h1>{t('portal.loginHeroTitle')}</h1>
                <p>{t('portal.loginHeroDescription')}</p>
              </div>
              <div className="portal-login-benefits">
                <span>
                  <i className="is-blue">
                    <PortalServicesIcon />
                  </i>
                  <b>{t('portal.loginBenefitNodes')}</b>
                </span>
                <span>
                  <i className="is-violet">
                    <PortalBoltIcon />
                  </i>
                  <b>{t('portal.loginBenefitFast')}</b>
                </span>
                <span>
                  <i className="is-teal">
                    <PortalShieldIcon />
                  </i>
                  <b>{t('portal.loginBenefitSecure')}</b>
                </span>
              </div>
            </section>

            <section className="portal-login-card">
              <div className="portal-login-card-head">
                <div>
                  <span className="portal-login-card-kicker">{t('portal.loginKicker')}</span>
                  <h2>{t('portal.welcome')}</h2>
                  <p>{t('portal.loginSubtitle')}</p>
                </div>
                <Popover
                  rootClassName="light portal-language-popover"
                  placement={direction === 'rtl' ? 'bottomLeft' : 'bottomRight'}
                  trigger="click"
                  open={languageOpen}
                  onOpenChange={setLanguageOpen}
                  styles={{ content: { padding: 4 } }}
                  content={
                    <Menu
                      mode="vertical"
                      selectable
                      selectedKeys={[lang]}
                      items={languageItems}
                      onClick={({ key }) => onLangChange(key)}
                      style={{ border: 'none', minWidth: 170 }}
                    />
                  }
                >
                  <Button
                    className="portal-login-language"
                    aria-label={t('pages.settings.language')}
                  >
                    <PortalLanguageIcon className="portal-login-language-icon" />
                    <span>{currentLanguage?.name}</span>
                    <PortalChevronIcon className="portal-login-language-chevron" />
                  </Button>
                </Popover>
              </div>

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
                      prefix={
                        <span className="portal-field-icon">
                          <PortalUserIcon />
                        </span>
                      }
                      autoComplete="username"
                      size="large"
                      placeholder={t('portal.usernamePlaceholder')}
                      autoFocus
                    />
                  </FormField>

                  <FormField
                    name="password"
                    label={t('password')}
                    rules={{ validate: rhfZodValidate(PortalLoginSchema.shape.password) }}
                  >
                    <Input.Password
                      prefix={
                        <span className="portal-field-icon">
                          <PortalLockIcon />
                        </span>
                      }
                      autoComplete="current-password"
                      size="large"
                      placeholder={t('portal.passwordPlaceholder')}
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
                      <span>{t('login')}</span>
                      <PortalArrowIcon className="portal-login-submit-icon" />
                    </Button>
                  </Form.Item>
                </Form>
              </FormProvider>
              <p className="portal-login-footnote">
                <span />
                <PortalShieldIcon />
                {t('portal.loginFootnote')}
                <span />
              </p>
            </section>
          </div>
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}

// Bright loading shell shown only while the current session is checked.
export function PortalLoading() {
  return (
    <Layout className="portal-app x-user-center">
      <Layout.Content className="portal-content">
        <div className="portal-loading" aria-label="Loading">
          <span className="portal-loading-mark" />
        </div>
      </Layout.Content>
    </Layout>
  );
}
