import type { ReactNode } from "react";

const paths = {
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  viewers: (
    <>
      <circle cx="12" cy="10" r="3" />
      <circle cx="5" cy="6" r="2.5" />
      <circle cx="19" cy="6" r="2.5" />
      <path d="M7 20h10l-1.5-5h-7L7 20ZM2 14l1.5-4H7m15 4-1.5-4H17" />
    </>
  ),
  donation: (
    <>
      <path d="M3 20V11l12-9a13 13 0 0 1 6 9v9H3ZM3 11h18" />
      <circle cx="9" cy="15.5" r="1.5" />
      <circle cx="14" cy="7" r="1.5" />
      <circle cx="18" cy="11" r="1.5" />
    </>
  ),
  timeline: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  bookmark: <path d="M6 4h12v17l-6-4-6 4V4Z" />,
  poll: (
    <>
      <path d="M5 20V10m7 10V4m7 16v-7" />
      <path d="M3 20h18" />
    </>
  ),
  roulette: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 3v7m2 2h7m-9 2v7m-9-9h7m-4.4-6.4 5 5m2.8 2.8 5 5m0-12.8-5 5m-2.8 2.8-5 5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="m3 3 18 18M9.5 5.3 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.1 3.8M6.2 6.2C3.4 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.5" />
    </>
  ),
  settings: (
    <>
      <path d="m9 4 1-2h4l1 2 2 1 2-.2 2 3-1 2v4l1 2-2 3-2-.2-2 1-1 2h-4l-1-2-2-1-2 .2-2-3 1-2v-4l-1-2 2-3 2 .2 2-1Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  message: <path d="M20 4H4v12h4l4 4v-4h8V4ZM8 8h8M8 12h5" />,
  sparkles: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  export: (
    <>
      <path d="M12 15V3m-4 4 4-4 4 4" />
      <path d="M5 12v8h14v-8" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="m8 4 12 8-12 8V4Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" />,
  tray: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8m-4-4v4m-3-10 3 3 3-3m-3-3v6" />
    </>
  ),
  link: (
    <>
      <path
        d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"
        transform="translate(1 1)"
      />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7V3l-3 3a8 8 0 1 0 2.5 10M20 3h-4" />
    </>
  ),
  minimize: <path d="M5 12h14" />,
  maximize: <rect x="5" y="5" width="14" height="14" rx=".6" />,
  restore: (
    <>
      <path d="M8 5V3h13v13h-2" />
      <rect x="3" y="8" width="13" height="13" rx=".6" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={"icon " + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

export function PlatformIcon({
  platform,
  size = 24,
}: {
  platform: "chzzk" | "youtube";
  size?: number;
}) {
  return (
    <svg
      className={"platform-icon " + platform}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {platform === "youtube" ? (
        <>
          <rect
            x="1"
            y="4.5"
            width="22"
            height="15"
            rx="5"
            fill="currentColor"
          />
          <path d="m10 8 7 4-7 4V8Z" fill="white" />
        </>
      ) : (
        <>
          <path d="M14 2 3 13h7l-1 9 12-13h-8l1-7Z" fill="currentColor" />
          <path d="m9 4-5 5h4l1-5Z" fill="currentColor" opacity=".5" />
        </>
      )}
    </svg>
  );
}
