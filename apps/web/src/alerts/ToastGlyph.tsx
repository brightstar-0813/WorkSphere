import type { ToastTone } from "./notify";

const size = 18;

export function ToastGlyph({ tone }: { tone: ToastTone }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true as const,
  };

  if (tone === "success") {
    return (
      <svg {...common}>
        <path
          d="M20 6.5 9.5 17 4 11.5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (tone === "danger") {
    return (
      <svg {...common}>
        <path
          d="M12 8v5.5M12 16.5h.01M12 3.5 2.8 19.5h18.4L12 3.5Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (tone === "warning") {
    return (
      <svg {...common}>
        <path
          d="M12 9v4.25M12 16.5h.01M10.3 4.8 2.6 18.2a1.9 1.9 0 0 0 1.65 2.85h15.5a1.9 1.9 0 0 0 1.65-2.85L13.7 4.8a1.9 1.9 0 0 0-3.4 0Z"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (tone === "schedule") {
    return (
      <svg {...common}>
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.9" />
        <path d="M8 3.5v3M16 3.5v3M3.5 10h17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 8v5M12 16.2h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
