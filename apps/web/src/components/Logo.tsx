type LogoProps = {
  size?: number;
  className?: string;
  withWordmark?: boolean;
  wordmark?: string;
  light?: boolean;
};

export function Logo({
  size = 36,
  className = "",
  withWordmark = false,
  wordmark = "WorkSphere",
  light = false,
}: LogoProps) {
  return (
    <div className={`ws-logo${withWordmark ? " with-wordmark" : ""} ${className}`.trim()}>
      <img
        src="/logo.png"
        width={size}
        height={size}
        alt=""
        className="ws-logo-mark"
        draggable={false}
      />
      {withWordmark && (
        <span className={`ws-logo-word${light ? " light" : ""}`}>{wordmark}</span>
      )}
    </div>
  );
}
