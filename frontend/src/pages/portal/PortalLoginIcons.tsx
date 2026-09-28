interface PortalIconProps {
  className?: string;
}

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function PortalBrandMark({ className }: PortalIconProps) {
  return (
    <svg className={className} viewBox="0 0 56 56" role="img" aria-label="X">
      <defs>
        <linearGradient id="portal-brand-gradient" x1="7" y1="7" x2="49" y2="49">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="0.52" stopColor="#6d5ce7" />
          <stop offset="1" stopColor="#1cb8ad" />
        </linearGradient>
      </defs>
      <path
        className="portal-brand-route"
        d="M14 14 42 42M42 14 14 42"
        fill="none"
        stroke="url(#portal-brand-gradient)"
        strokeLinecap="round"
        strokeWidth="6"
      />
      <circle
        className="portal-brand-node portal-brand-node-one"
        cx="14"
        cy="14"
        r="6"
        fill="#3b82f6"
      />
      <circle
        className="portal-brand-node portal-brand-node-two"
        cx="42"
        cy="14"
        r="6"
        fill="#37b8bd"
      />
      <circle
        className="portal-brand-node portal-brand-node-three"
        cx="14"
        cy="42"
        r="6"
        fill="#735bea"
      />
      <circle
        className="portal-brand-node portal-brand-node-four"
        cx="42"
        cy="42"
        r="6"
        fill="#32bfc3"
      />
      <circle className="portal-brand-core" cx="28" cy="28" r="6.5" fill="#5b67e8" />
    </svg>
  );
}

export function PortalStatusIcon({ className }: PortalIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.4 12.1 2.2 2.2 5-5" />
    </svg>
  );
}

export function PortalServicesIcon({ className }: PortalIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <path d="M7.5 9h6M7.5 13h9" />
      <circle cx="17.3" cy="9" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PortalBoltIcon({ className }: PortalIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
      <path d="m13.6 2.8-7 10h5.1l-1.2 8.4 7-10h-5.1l1.2-8.4Z" />
    </svg>
  );
}

export function PortalShieldIcon({ className }: PortalIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
      <path d="M12 3.2 19 6v5.1c0 4.5-2.7 7.8-7 9.7-4.3-1.9-7-5.2-7-9.7V6l7-2.8Z" />
      <path d="m8.8 11.9 2.1 2.1 4.4-4.5" />
    </svg>
  );
}

export function PortalLanguageIcon({ className }: PortalIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h17M12 3c2.2 2.5 3.3 5.5 3.3 9S14.2 18.5 12 21c-2.2-2.5-3.3-5.5-3.3-9S9.8 5.5 12 3Z" />
    </svg>
  );
}

export function PortalUserIcon({ className }: PortalIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" />
    </svg>
  );
}

export function PortalLockIcon({ className }: PortalIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
      <rect x="5" y="10" width="14" height="10" rx="2.5" />
      <path d="M8.2 10V7.7a3.8 3.8 0 0 1 7.6 0V10M12 14.3v2.3" />
    </svg>
  );
}

export function PortalArrowIcon({ className }: PortalIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
      <path d="M5 12h13M14 7l5 5-5 5" />
    </svg>
  );
}

export function PortalChevronIcon({ className }: PortalIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
      <path d="m8 10 4 4 4-4" />
    </svg>
  );
}
