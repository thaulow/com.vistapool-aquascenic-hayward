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
