const trNumberFormat = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const trMoneyFormat = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export function formatKurus(value: number): string {
  return trMoneyFormat.format(value / 100);
}

export function formatKurusPlain(value: number): string {
  return trNumberFormat.format(value / 100);
}

export function parseTlToKurus(value: string | number): number {
  if (typeof value === 'number') {
    return Math.round(value * 100);
  }

  const normalized = value.trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100);
}

export function formatGramAsKg(value: number): string {
  return `${trNumberFormat.format(value / 1000)} kg`;
}

export function formatGramAsKgPlain(value: number): string {
  return trNumberFormat.format(value / 1000);
}

export function parseKgToGram(value: string | number): number {
  if (typeof value === 'number') {
    return Math.round(value * 1000);
  }

  const normalized = value.trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 1000);
}
