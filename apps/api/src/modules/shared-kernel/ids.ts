import { v7 as uuidv7, validate, version } from 'uuid';

/** Branded identifier type: `Id<'Booking'>` cannot be passed where `Id<'Client'>` is expected. */
export type Id<TBrand extends string> = string & { readonly __brand: TBrand };

/** New time-ordered UUIDv7 (index-friendly primary keys). */
export function newId<TBrand extends string>(): Id<TBrand> {
  return uuidv7() as Id<TBrand>;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && validate(value);
}

export function parseId<TBrand extends string>(value: unknown): Id<TBrand> {
  if (!isUuid(value)) throw new TypeError(`Not a UUID: ${String(value)}`);
  return value as Id<TBrand>;
}

export function isUuidV7(value: string): boolean {
  return validate(value) && version(value) === 7;
}
