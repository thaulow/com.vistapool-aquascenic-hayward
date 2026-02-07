'use strict';

import { FirestoreValue, FirestoreFields } from './types';

/**
 * Extract a plain JS value from a Firestore typed-value wrapper.
 */
export function extractValue(firestoreValue: FirestoreValue): any {
  if ('stringValue' in firestoreValue) return firestoreValue.stringValue;
  if ('integerValue' in firestoreValue) return parseInt(firestoreValue.integerValue, 10);
  if ('doubleValue' in firestoreValue) return firestoreValue.doubleValue;
  if ('booleanValue' in firestoreValue) return firestoreValue.booleanValue;
  if ('nullValue' in firestoreValue) return null;
  if ('timestampValue' in firestoreValue) return firestoreValue.timestampValue;
  if ('arrayValue' in firestoreValue) {
    return (firestoreValue.arrayValue.values || []).map(extractValue);
  }
  if ('mapValue' in firestoreValue) {
    return parseFields(firestoreValue.mapValue.fields);
  }
  return undefined;
}

/**
 * Parse a Firestore fields object into a plain JS object.
 */
export function parseFields(fields: FirestoreFields): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = extractValue(value);
  }
  return result;
}

/**
 * Flatten a nested object into underscore-separated keys.
 * { main: { temperature: 28.5 } } => { "main_temperature": 28.5 }
 */
/**
 * Convert a plain JS value to a Firestore typed-value wrapper.
 */
export function toFirestoreValue(value: any): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    const fields: FirestoreFields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

/**
 * Build a nested Firestore fields structure from a dot-notation path and value.
 * e.g. buildNestedFields('hidro.level', 50) => { hidro: { mapValue: { fields: { level: { integerValue: "50" } } } } }
 */
export function buildNestedFields(fieldPath: string, value: any): FirestoreFields {
  const parts = fieldPath.split('.');
  if (parts.length === 1) {
    return { [parts[0]]: toFirestoreValue(value) };
  }
  const [first, ...rest] = parts;
  return {
    [first]: {
      mapValue: { fields: buildNestedFields(rest.join('.'), value) },
    },
  };
}

export function flattenObject(
  obj: Record<string, any>,
  prefix: string = '',
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}_${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }
  return result;
}
