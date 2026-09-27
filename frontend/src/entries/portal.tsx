import { createRoot } from 'react-dom/client';
import { message } from 'antd';
import 'antd/dist/reset.css';

import { setupHttp } from '@/api/http-init';
import { readyI18n } from '@/i18n/react';
import { QueryProvider } from '@/api/QueryProvider';
import PortalPage from '@/pages/portal/PortalPage';

setupHttp();

const messageContainer = document.getElementById('message');
if (messageContainer) {
  message.config({ getContainer: () => messageContainer });
}

readyI18n('subscription').then((i18n) => {
  const activeLanguage = i18n.resolvedLanguage || i18n.language || 'en-US';
  document.documentElement.lang = activeLanguage;
  document.documentElement.dir =
    activeLanguage === 'ar-EG' || activeLanguage === 'fa-IR' ? 'rtl' : 'ltr';
  const root = document.getElementById('app');
  if (root) {
    createRoot(root).render(
      <QueryProvider>
        <PortalPage />
      </QueryProvider>,
    );
  }
});
