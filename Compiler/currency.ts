export interface CurrencyMetadata {
  code: string;
  minorUnitDigits: number;
}

export const CURRENCY_METADATA: Record<
  string,
  CurrencyMetadata
> = {
  EUR: { code: "EUR", minorUnitDigits: 2 },
  USD: { code: "USD", minorUnitDigits: 2 },
  GBP: { code: "GBP", minorUnitDigits: 2 },
  JPY: { code: "JPY", minorUnitDigits: 0 },
  KWD: { code: "KWD", minorUnitDigits: 3 },
};

export function getCurrencyMetadata(
  currency: string,
): CurrencyMetadata {
  const metadata = CURRENCY_METADATA[currency];

  if (metadata === undefined) {
    throw new Error(
      `Unsupported currency "${currency}".`,
    );
  }

  return metadata;
}