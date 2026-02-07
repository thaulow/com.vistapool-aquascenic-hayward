'use strict';

import {
  FirebaseAuthResponse,
  FirebaseTokenRefreshResponse,
  FirestoreDocument,
  AuthTokens,
  PoolData,
} from './types';
import { parseFields, flattenObject } from './FirestoreParser';

const API_KEY = 'AIzaSyBLaxiyZ2nS1KgRBqWe-NY4EG7OzG5fKpE';
const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
const TOKEN_URL = `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/hayward-europe/databases/(default)/documents';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class HaywardApiError extends Error {
  public statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'HaywardApiError';
    this.statusCode = statusCode;
  }
}

export class HaywardAuthError extends HaywardApiError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = 'HaywardAuthError';
  }
}

export class HaywardApi {
  private tokens: AuthTokens | null = null;
  private email: string;
  private password: string;
  private log: (...args: any[]) => void;

  constructor(
    email: string,
    password: string,
    log: (...args: any[]) => void = console.log,
  ) {
    this.email = email;
    this.password = password;
    this.log = log;
  }

  async authenticate(): Promise<AuthTokens> {
    this.log('Authenticating with Firebase...');
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: this.email,
        password: this.password,
        returnSecureToken: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as any;
      const errorMessage = errorBody?.error?.message || `HTTP ${response.status}`;
      throw new HaywardAuthError(`Authentication failed: ${errorMessage}`, response.status);
    }

    const data = await response.json() as FirebaseAuthResponse;
    const expiresInMs = parseInt(data.expiresIn, 10) * 1000;

    this.tokens = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + expiresInMs,
      localId: data.localId,
    };

    this.log('Authentication successful');
    return this.tokens;
  }

  async refreshToken(): Promise<AuthTokens> {
    if (!this.tokens?.refreshToken) {
      throw new HaywardAuthError('No refresh token available, must re-authenticate');
    }

    this.log('Refreshing Firebase token...');
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.tokens.refreshToken)}`,
    });

    if (!response.ok) {
      this.tokens = null;
      throw new HaywardAuthError(`Token refresh failed: HTTP ${response.status}`, response.status);
    }

    const data = await response.json() as FirebaseTokenRefreshResponse;
    const expiresInMs = parseInt(data.expires_in, 10) * 1000;

    this.tokens = {
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + expiresInMs,
      localId: data.user_id,
    };

    this.log('Token refreshed successfully');
    return this.tokens;
  }

  async ensureValidToken(): Promise<string> {
    if (!this.tokens) {
      await this.authenticate();
      return this.tokens!.idToken;
    }

    if (Date.now() >= this.tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      try {
        await this.refreshToken();
      } catch {
        this.log('Token refresh failed, attempting full re-authentication');
        await this.authenticate();
      }
    }

    return this.tokens!.idToken;
  }

  async fetchPoolData(poolId: string): Promise<PoolData> {
    const idToken = await this.ensureValidToken();
    const url = `${FIRESTORE_BASE}/pools/${poolId}`;

    let response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401 || response.status === 403) {
      this.tokens = null;
      const newToken = await this.ensureValidToken();
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${newToken}`,
          'Content-Type': 'application/json',
        },
      });
    }

    if (!response.ok) {
      throw new HaywardApiError(`Failed to fetch pool data: HTTP ${response.status}`, response.status);
    }

    const doc = await response.json() as FirestoreDocument;
    const parsed = parseFields(doc.fields);
    return flattenObject(parsed) as PoolData;
  }

  async testConnection(poolId: string): Promise<boolean> {
    try {
      await this.fetchPoolData(poolId);
      return true;
    } catch {
      return false;
    }
  }

  async testCredentials(): Promise<boolean> {
    try {
      await this.authenticate();
      return true;
    } catch {
      return false;
    }
  }

  updateCredentials(email: string, password: string): void {
    this.email = email;
    this.password = password;
    this.tokens = null;
  }
}
