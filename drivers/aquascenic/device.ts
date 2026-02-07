'use strict';

import Homey from 'homey';
import { HaywardApi, HaywardApiError, HaywardAuthError } from '../../lib/HaywardApi';
import { PoolData } from '../../lib/types';

interface CapabilityMapping {
  firestoreKey: string;
  capability: string;
  transform?: (value: any) => any;
}

const CAPABILITY_MAP: CapabilityMapping[] = [
  {
    firestoreKey: 'main_temperature',
    capability: 'measure_temperature',
  },
  {
    firestoreKey: 'modules_ph_current',
    capability: 'measure_ph',
    transform: (v: number) => v / 100,
  },
  {
    firestoreKey: 'modules_rx_status_value',
    capability: 'measure_orp',
  },
  {
    firestoreKey: 'hidro_level',
    capability: 'measure_salt_level',
  },
  {
    firestoreKey: 'hidro_cellTotalTime',
    capability: 'measure_salt_cell_hours',
    transform: (v: number) => Math.round(v / 3600),
  },
  {
    firestoreKey: 'filtration_status',
    capability: 'status_filtration',
    transform: (v: any) => Boolean(v),
  },
  {
    firestoreKey: 'hidro_is_electrolysis',
    capability: 'status_electrolysis',
    transform: (v: any) => Boolean(v),
  },
  {
    firestoreKey: 'main_RSSI',
    capability: 'measure_wifi_signal',
  },
];

const DEFAULT_POLL_INTERVAL_MINUTES = 5;

class AquascenicDevice extends Homey.Device {
  private api: HaywardApi | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private poolId: string = '';

  async onInit() {
    this.log('AquascenicDevice has been initialized');
    this.log('Device data:', JSON.stringify(this.getData()));
    this.log('Device store keys:', JSON.stringify(Object.keys(this.getStore())));

    const email = this.getStoreValue('email');
    const password = this.getStoreValue('password');
    this.poolId = this.getStoreValue('poolId') || this.getData().id;
    this.log('Pool ID:', this.poolId);

    if (!email || !password) {
      this.log('Missing credentials - email:', !!email, 'password:', !!password);
      this.setUnavailable('No credentials configured. Please repair the device.').catch(this.error);
      return;
    }

    this.api = new HaywardApi(email, password, this.log.bind(this));

    this.on('credentialsUpdated', () => {
      this.onCredentialsUpdated();
    });

    await this.pollData();
    this.startPolling();
  }

  private startPolling() {
    this.stopPolling();

    const intervalMinutes = this.getSetting('poll_interval') || DEFAULT_POLL_INTERVAL_MINUTES;
    const intervalMs = intervalMinutes * 60 * 1000;

    this.log(`Starting polling every ${intervalMinutes} minutes`);
    this.pollInterval = this.homey.setInterval(() => this.pollData(), intervalMs);
  }

  private stopPolling() {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async pollData() {
    if (!this.api) return;

    try {
      const data = await this.api.fetchPoolData(this.poolId);
      this.log('Poll data keys:', Object.keys(data).join(', '));

      // Log values for each mapped capability
      for (const m of CAPABILITY_MAP) {
        this.log(`  ${m.capability}: raw=${data[m.firestoreKey]}`);
      }

      if (data.present === false) {
        this.setWarning('Pool controller is offline').catch(this.error);
      } else {
        this.unsetWarning().catch(this.error);
      }

      for (const mapping of CAPABILITY_MAP) {
        const rawValue = data[mapping.firestoreKey];
        if (rawValue === undefined || rawValue === null) continue;

        try {
          const value = mapping.transform ? mapping.transform(rawValue) : rawValue;
          if (this.hasCapability(mapping.capability)) {
            await this.setCapabilityValue(mapping.capability, value).catch((err: Error) => {
              this.error(`Failed to set ${mapping.capability}:`, err.message);
            });
          }
        } catch (err) {
          this.error(`Error processing ${mapping.firestoreKey}:`, err);
        }
      }

      await this.updateInfoSettings(data);

      if (!this.getAvailable()) {
        await this.setAvailable();
      }
    } catch (err) {
      if (err instanceof HaywardAuthError) {
        this.error('Authentication error:', err.message);
        this.setUnavailable('Authentication failed. Please repair the device to update credentials.').catch(this.error);
      } else if (err instanceof HaywardApiError) {
        this.error('API error:', err.message);
        this.setWarning(`Cloud error: ${err.message}`).catch(this.error);
      } else {
        this.error('Unexpected error during polling:', err);
        this.setWarning('Communication error with cloud service').catch(this.error);
      }
    }
  }

  private async updateInfoSettings(data: PoolData) {
    const updates: Record<string, string> = {};

    if (data.main_version !== undefined) {
      updates.firmware_version = String(data.main_version);
    }
    if (data.main_wifiVersion !== undefined) {
      updates.wifi_version = String(data.main_wifiVersion);
    }
    updates.pool_id = this.poolId;

    try {
      await this.setSettings(updates);
    } catch (err) {
      this.error('Failed to update device settings:', err);
    }
  }

  private async onCredentialsUpdated() {
    this.log('Credentials updated, re-initializing API client');
    const email = this.getStoreValue('email');
    const password = this.getStoreValue('password');

    if (this.api) {
      this.api.updateCredentials(email, password);
    } else {
      this.api = new HaywardApi(email, password, this.log.bind(this));
    }

    await this.pollData();
    await this.setAvailable();
  }

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    if (changedKeys.includes('poll_interval')) {
      this.log(`Poll interval changed to ${newSettings.poll_interval} minutes`);
      this.startPolling();
    }
  }

  onDeleted() {
    this.log('AquascenicDevice has been deleted');
    this.stopPolling();
  }

  async onUninit() {
    this.stopPolling();
  }
}

module.exports = AquascenicDevice;
