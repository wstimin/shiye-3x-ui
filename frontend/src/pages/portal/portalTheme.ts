import type { ThemeConfig } from 'antd';
import { theme } from 'antd';

const primary = {
  colorPrimary: '#4169e1',
  colorPrimaryHover: '#5679e8',
  colorPrimaryActive: '#3156c8',
};

// The customer portal owns its visual theme. Keeping this in a side-effect-free
// module prevents the admin panel's persisted dark mode from touching /portal.
export const portalTheme: ThemeConfig = {
  hashed: false,
  algorithm: theme.defaultAlgorithm,
  token: {
    ...primary,
    borderRadius: 12,
    colorBgBase: '#ffffff',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBorder: '#dfe8f3',
    colorText: '#14213a',
    colorTextSecondary: '#718096',
    colorLink: primary.colorPrimary,
    colorInfo: primary.colorPrimary,
    fontFamily: 'Inter, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Button: primary,
    Progress: { remainingColor: 'rgba(37, 99, 235, 0.14)' },
  },
};
