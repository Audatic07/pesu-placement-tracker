export type SearchParams = Record<string, string | string[] | undefined>;

export function singleParams(params: SearchParams): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [
    key, Array.isArray(value) ? value[0] : value,
  ]));
}

export function positiveInteger(value: string | undefined, fallback = 1): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function choice<T extends string>(value: string | undefined, choices: readonly T[]): T | undefined {
  return choices.find((candidate) => candidate === value);
}

export function list(value: string | undefined): string[] | undefined {
  const values = [...new Set(value?.split(",").map((part) => part.trim()).filter(Boolean))];
  return values.length ? values : undefined;
}

export function choiceList<T extends string>(value: string | undefined, choices: readonly T[]): T[] | undefined {
  const values = list(value)?.flatMap((part) => {
    const valid = choice(part, choices);
    return valid === undefined ? [] : [valid];
  });
  return values?.length ? values : undefined;
}

export function resolveBatchYear(
  requested: string | undefined,
  years: number[],
  preferred: number | null,
  currentYear = new Date().getFullYear(),
): number {
  const year = positiveInteger(requested, 0);
  return years.find((candidate) => candidate === year) ?? preferred ?? years[0] ?? currentYear;
}
