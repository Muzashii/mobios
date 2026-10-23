import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const make = (path: React.ReactNode) =>
  function Icon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {path}
      </svg>
    );
  };

export const IconCursor = make(<path d="M5 3l14 7-6 2-2 6z" />);
export const IconCut = make(
  <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
  </>,
);
export const IconPin = make(
  <>
    <rect x="8" y="3" width="8" height="6" rx="1" />
    <path d="M10 9v8l2 4 2-4V9" />
  </>,
);
export const IconPaint = make(
  <>
    <path d="M19 11h-1a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h9" />
    <path d="M12 11v3a2 2 0 0 0 2 2v0a1 1 0 0 1 1 1v4h-4v-4" />
  </>,
);
export const IconExplode = make(
  <>
    <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </>,
);
export const IconUndo = make(<path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />);
export const IconRedo = make(<path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />);
export const IconExport = make(<path d="M12 3v12M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />);
export const IconOpen = make(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
export const IconEye = make(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconEyeOff = make(<path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />);
export const IconLock = make(
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);
export const IconUnlock = make(
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.5-2" />
  </>,
);
export const IconTrash = make(<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />);
export const IconFocus = make(<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />);
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);
export const IconMoon = make(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);
export const IconCommand = make(<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />);
export const IconCube = make(
  <>
    <path d="M12 2l9 5v10l-9 5-9-5V7z" />
    <path d="M12 22V12M21 7l-9 5-9-5" />
  </>,
);
export const IconCheck = make(<path d="M5 12l5 5 9-10" />);
export const IconX = make(<path d="M6 6l12 12M18 6L6 18" />);
export const IconAlert = make(<path d="M12 3l10 18H2zM12 10v4M12 17.5v.5" />);
export const IconInfo = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.5" />
  </>,
);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconRuler = make(<path d="M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2" />);
export const IconLogo = make(<path d="M8 3h9l-3 7.5h6L9 21l3-8H6z" fill="currentColor" stroke="none" />);
export const IconFile = make(<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6" />);
export const IconBed = make(
  <>
    <path d="M3 17l9 4 9-4-9-4z" />
    <path d="M3 17V8l9-4 9 4v9" strokeDasharray="2 2" />
  </>,
);
