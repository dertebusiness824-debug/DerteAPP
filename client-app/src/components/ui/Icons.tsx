import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/** Iconos de trazo limpio, en línea con el panel B2B (sin dependencias). */
function Icon({ children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
  </Icon>
);

export const CalendarIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3.5V6M16 3.5V6" />
  </Icon>
);

export const HeartIcon = ({ filled = false, ...props }: IconProps & { filled?: boolean }) => (
  <Icon fill={filled ? 'currentColor' : 'none'} {...props}>
    <path d="M12 20s-7-4.35-7-9.5A4.5 4.5 0 0 1 12 7.5 4.5 4.5 0 0 1 19 10.5c0 5.15-7 9.5-7 9.5z" />
  </Icon>
);

export const UserIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M4.5 20.5c1.3-3.6 4-5.5 7.5-5.5s6.2 1.9 7.5 5.5" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);

export const PinIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 21s6.5-5.5 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15.5 12 21 12 21z" />
    <circle cx="12" cy="10" r="2.4" />
  </Icon>
);

export const NavigationIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 20 21l-8-4.5L4 21z" />
  </Icon>
);

export const PhoneIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5z" />
  </Icon>
);

export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const BoltIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" />
  </Icon>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Icon>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
  </Icon>
);

export const CarIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 15.5V12l1.8-4.2A2 2 0 0 1 7.6 6.5h8.8a2 2 0 0 1 1.8 1.3L20 12v3.5" />
    <path d="M4 15.5h16v2.5h-2.5v-2.5M6.5 18v-2.5" />
    <circle cx="7.5" cy="15.5" r="1.2" />
    <circle cx="16.5" cy="15.5" r="1.2" />
  </Icon>
);

export const WrenchIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.5 3.5a5 5 0 0 0-4.3 7.6l-6.2 6.2 2.7 2.7 6.2-6.2A5 5 0 0 0 20 9.5l-3-1-1.5-1.5z" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const MapIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m3.5 6.5 5-2 7 2.5 5-2v13l-5 2-7-2.5-5 2z" />
    <path d="M8.5 4.5v13M15.5 7v13" />
  </Icon>
);

export const ListIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h2M4 12h2M4 17h2M9 7h11M9 12h11M9 17h11" />
  </Icon>
);

export const ShieldIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5 19 6v6c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const LogoMark = (props: IconProps) => (
  <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
    <g stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 42c0-10 8-18 18-18h10" />
      <path d="M36 18l10 6-6 10" />
      <path d="M50 22c0 10-8 18-18 18H22" />
      <path d="M28 46l-10-6 6-10" />
    </g>
  </svg>
);
