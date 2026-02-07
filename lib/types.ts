'use strict';

// Firebase Auth response from signInWithPassword
export interface FirebaseAuthResponse {
  idToken: string;
  email: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  registered: boolean;
}

// Firebase token refresh response
export interface FirebaseTokenRefreshResponse {
  access_token: string;
  expires_in: string;
  token_type: string;
  refresh_token: string;
  id_token: string;
  user_id: string;
  project_id: string;
}

// Firestore value type wrappers
export type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields: FirestoreFields } }
  | { arrayValue: { values: FirestoreValue[] } }
  | { timestampValue: string };

export interface FirestoreFields {
  [key: string]: FirestoreValue;
}

export interface FirestoreDocument {
  name: string;
  fields: FirestoreFields;
  createTime: string;
  updateTime: string;
}

// Flattened pool data after parsing
export interface PoolData {
  [key: string]: any;
}

// Auth tokens stored in memory
export interface AuthTokens {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
  localId: string;
}
