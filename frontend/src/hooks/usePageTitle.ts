import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

const TITLE_KEYS: Record<string, string> = {
  '/': 'menu.dashboard',
  '/inbounds': 'menu.inbounds',
  '/clients': 'menu.clients',
  '/groups': 'menu.groups',
  '/nodes': 'menu.nodes',
  '/hosts': 'menu.hosts',
  '/settings': 'menu.settings',
  '/xray': 'menu.xray',
  '/outbound': 'menu.outbounds',
  '/routing': 'menu.routing',
  '/api-docs': 'menu.apiDocs',
  '/portal-management': 'menu.portalManagement',
};

export function usePageTitle() {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    const key = TITLE_KEYS[pathname];
    const title = key
      ? key === 'menu.portalManagement'
        ? t(key, '客户门户管理')
        : t(key)
      : '3X-UI';
    const host = window.location.hostname;
    document.title = host ? `${host} - ${title}` : title;
  }, [pathname, t]);
}
