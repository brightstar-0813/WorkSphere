/** Bid amount display helpers shared by Admin and Reports. */

export function regionCodeFromProfileName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("-").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const suffix = parts[parts.length - 1]!;
  if (!/^[A-Za-z]{2,3}$/.test(suffix)) return null;
  return suffix.toUpperCase();
}

export function formatMinorCompact(minor: number, currency: string, locale: string): string {
  const major = minor / 100;
  const whole = Number.isInteger(major);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(major);
  } catch {
    return `${major.toFixed(whole ? 0 : 2)} ${currency || "USD"}`;
  }
}

export function formatCurrencyMap(
  amountsByCurrency: Record<string, number>,
  locale: string,
): string {
  const entries = Object.entries(amountsByCurrency).filter(([, minor]) => minor !== 0);
  if (entries.length === 0) return "";
  return entries
    .map(([currency, minor]) => formatMinorCompact(minor, currency, locale))
    .join("+");
}

export function formatLabeledAmountLine(
  items: Array<{ label: string; amountsByCurrency: Record<string, number> }>,
  locale: string,
  emptyLabel: string,
): string {
  const parts = items
    .map(({ label, amountsByCurrency }) => {
      const amount = formatCurrencyMap(amountsByCurrency, locale);
      if (!amount) return null;
      return `${label}:${amount}`;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" | ") : emptyLabel;
}

export function addAmountMinor(
  map: Record<string, number>,
  amountMinor: number | null | undefined,
  currency: string,
) {
  if (amountMinor == null) return;
  const code = currency || "USD";
  map[code] = (map[code] ?? 0) + amountMinor;
}

export type ProfileAmountRow = {
  profileId: string;
  profileName: string;
  amountsByCurrency: Record<string, number>;
};

/** Build "Profile1:$10 | Profile2:$20" and "US:$30 | PH:$30" lines from profile totals. */
export function buildProfileRegionLines(
  profiles: ProfileAmountRow[],
  locale: string,
  emptyLabel: string,
): { profilesLine: string; regionsLine: string } {
  const profileItems = profiles
    .filter((p) => Object.values(p.amountsByCurrency).some((n) => n !== 0))
    .sort((a, b) => a.profileName.localeCompare(b.profileName))
    .map((p) => ({ label: p.profileName, amountsByCurrency: p.amountsByCurrency }));

  const regionMap = new Map<string, Record<string, number>>();
  for (const p of profiles) {
    const region = regionCodeFromProfileName(p.profileName);
    if (!region) continue;
    const bucket = regionMap.get(region) ?? {};
    for (const [currency, minor] of Object.entries(p.amountsByCurrency)) {
      if (minor === 0) continue;
      bucket[currency] = (bucket[currency] ?? 0) + minor;
    }
    regionMap.set(region, bucket);
  }

  const regionItems = [...regionMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, amountsByCurrency]) => ({ label, amountsByCurrency }));

  return {
    profilesLine: formatLabeledAmountLine(profileItems, locale, emptyLabel),
    regionsLine: formatLabeledAmountLine(regionItems, locale, emptyLabel),
  };
}
