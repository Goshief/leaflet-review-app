const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(ISO_DATE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return value;
}

export function sanitizeLeafletValidity(validFrom: string | null | undefined, validTo: string | null | undefined) {
  const from = validIsoDate(validFrom);
  const to = validIsoDate(validTo);
  if (from && to && from > to) return { valid_from: null, valid_to: null, safe: false as const };
  return {
    valid_from: from,
    valid_to: to,
    safe: (!validFrom || from !== null) && (!validTo || to !== null),
  };
}
