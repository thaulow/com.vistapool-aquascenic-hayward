'use strict';

import Homey from 'homey';
import { HaywardApi, HaywardApiError, HaywardAuthError } from '../../lib/HaywardApi';
import { PoolData } from '../../lib/types';

interface CapabilityMapping {
  firestoreKey: string;
  capability: string;
  transform?: (value: any) => any;
}

interface SettableCapabilityMapping extends CapabilityMapping {
  firestorePath: string;
  reverseTransform?: (value: any) => any;
}

// Read-only capabilities always present on the device
const CAPABILITY_MAP: CapabilityMapping[] = [
  {
    firestoreKey: 'main_temperature',
    capability: 'measure_temperature',
  },
  {
    firestoreKey: 'modules_ph_current',
    capability: 'measure_ph',
    transform: (v: any) => Number(v) / 100,
  },
  {
    firestoreKey: 'modules_rx_current',
    capability: 'measure_orp',
    transform: (v: any) => Number(v),
  },
  {
    firestoreKey: 'hidro_current',
    capability: 'measure_salt_level',
    transform: (v: any) => Number(v) / 10,
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

// Read-only capabilities dynamically added if the device reports the data
const OPTIONAL_READ_MAP: CapabilityMapping[] = [
  {
    firestoreKey: 'modules_io_level',
    capability: 'status_ionization',
    transform: (v: any) => Number(v),
  },
];

// Filtration mode number-to-enum mapping
const FILTRATION_MODE_MAP: Record<number, string> = { 0: 'auto', 1: 'manual', 2: 'smart' };
const FILTRATION_MODE_REVERSE: Record<string, number> = { auto: 0, manual: 1, smart: 2 };

// Filtration speed number-to-enum mapping
const FILTRATION_SPEED_MAP: Record<number, string> = { 1: 'slow', 2: 'medium', 3: 'high' };
const FILTRATION_SPEED_REVERSE: Record<string, number> = { slow: 1, medium: 2, high: 3 };

// Backwash mode number-to-enum mapping
const BACKWASH_MODE_MAP: Record<number, string> = { 0: 'automatic', 1: 'manual' };
const BACKWASH_MODE_REVERSE: Record<string, number> = { automatic: 0, manual: 1 };

// Lighting mode number-to-enum mapping
const LIGHTING_MODE_MAP: Record<number, string> = { 0: 'automatic', 1: 'manual' };
const LIGHTING_MODE_REVERSE: Record<string, number> = { automatic: 0, manual: 1 };

// Relay mode number-to-enum mapping
const RELAY_MODE_MAP: Record<number, string> = { 0: 'auto', 1: 'manual' };
const RELAY_MODE_REVERSE: Record<string, number> = { auto: 0, manual: 1 };

// Ionization activation number-to-enum mapping
const ION_ACTIVATION_MAP: Record<number, string> = { 10: '10', 20: '20', 30: '30', 0: 'always' };
const ION_ACTIVATION_REVERSE: Record<string, number> = { '10': 10, '20': 20, '30': 30, always: 0 };

// Settable capabilities dynamically added if the device reports the corresponding data
// firestoreKey = key from polled data (read), firestorePath = dot-notation path for PATCH (write)
const SETTABLE_CAPABILITY_MAP: SettableCapabilityMapping[] = [
  // Hydrolysis level (hidro_level=1000 means 100.0%)
  {
    firestoreKey: 'hidro_level',
    capability: 'target_hydrolysis_level',
    firestorePath: 'hidro.level',
    transform: (v: number) => Math.round(v / 10),
    reverseTransform: (v: number) => v * 10,
  },
  // Cover (nested under hidro)
  {
    firestoreKey: 'hidro_cover',
    capability: 'cover_onoff',
    firestorePath: 'hidro.cover',
    transform: (v: any) => Boolean(v),
    reverseTransform: (v: boolean) => v ? 1 : 0,
  },
  // Chlorination shock
  {
    firestoreKey: 'hidro_cloration_enabled',
    capability: 'chlorination_shock',
    firestorePath: 'hidro.cloration.enabled',
    transform: (v: any) => Boolean(v),
    reverseTransform: (v: boolean) => v ? 1 : 0,
  },
  // pH setpoint (high value, stored as string "740" meaning 7.40)
  {
    firestoreKey: 'modules_ph_status_high_value',
    capability: 'target_ph',
    firestorePath: 'modules.ph.status.high.value',
    transform: (v: any) => Number(v) / 100,
    reverseTransform: (v: number) => String(Math.round(v * 100)),
  },
  // ORP/RX setpoint
  {
    firestoreKey: 'modules_rx_status_value',
    capability: 'target_rx',
    firestorePath: 'modules.rx.status.value',
  },
  // Filtration mode
  {
    firestoreKey: 'filtration_mode',
    capability: 'filtration_mode',
    firestorePath: 'filtration.mode',
    transform: (v: number) => FILTRATION_MODE_MAP[v] || 'auto',
    reverseTransform: (v: string) => FILTRATION_MODE_REVERSE[v] ?? 0,
  },
  // Filtration manual speed (manVel: 1=slow, 2=medium, 3=high)
  {
    firestoreKey: 'filtration_manVel',
    capability: 'filtration_speed',
    firestorePath: 'filtration.manVel',
    transform: (v: number) => FILTRATION_SPEED_MAP[v] || 'medium',
    reverseTransform: (v: string) => FILTRATION_SPEED_REVERSE[v] ?? 2,
  },
  // Backwash mode
  {
    firestoreKey: 'backwash_mode',
    capability: 'backwash_mode',
    firestorePath: 'backwash.mode',
    transform: (v: number) => BACKWASH_MODE_MAP[v] || 'automatic',
    reverseTransform: (v: string) => BACKWASH_MODE_REVERSE[v] ?? 0,
  },
  // Backwash on/off
  {
    firestoreKey: 'backwash_status',
    capability: 'backwash_onoff',
    firestorePath: 'backwash.status',
    transform: (v: any) => Boolean(v),
    reverseTransform: (v: boolean) => v ? 1 : 0,
  },
  // Backwash interval
  {
    firestoreKey: 'backwash_interval',
    capability: 'backwash_interval',
    firestorePath: 'backwash.interval',
  },
  // Lighting mode (light.mode, not lighting.mode)
  {
    firestoreKey: 'light_mode',
    capability: 'lighting_mode',
    firestorePath: 'light.mode',
    transform: (v: number) => LIGHTING_MODE_MAP[v] || 'automatic',
    reverseTransform: (v: string) => LIGHTING_MODE_REVERSE[v] ?? 0,
  },
  // Lighting on/off (light.status)
  {
    firestoreKey: 'light_status',
    capability: 'lighting_onoff',
    firestorePath: 'light.status',
    transform: (v: any) => Boolean(v),
    reverseTransform: (v: boolean) => v ? 1 : 0,
  },
  // Ionization intensity (modules.io.level)
  {
    firestoreKey: 'modules_io_level',
    capability: 'ionization_intensity',
    firestorePath: 'modules.io.level',
  },
  // Ionization activation (modules.io.activation)
  {
    firestoreKey: 'modules_io_activation',
    capability: 'ionization_activation',
    firestorePath: 'modules.io.activation',
    transform: (v: number) => ION_ACTIVATION_MAP[v] || 'always',
    reverseTransform: (v: string) => ION_ACTIVATION_REVERSE[v] ?? 0,
  },
  // Aux relay 1 (key=mode: 0=auto, 1=manual)
  {
    firestoreKey: 'relays_relay1_info_key',
    capability: 'aux_relay_1_mode',
    firestorePath: 'relays.relay1.info.key',
    transform: (v: number) => RELAY_MODE_MAP[v] || 'auto',
    reverseTransform: (v: string) => RELAY_MODE_REVERSE[v] ?? 0,
  },
  {
    firestoreKey: 'relays_relay1_info_onoff',
    capability: 'aux_relay_1_onoff',
    firestorePath: 'relays.relay1.info.onoff',
    transform: (v: any) => Boolean(v),
    reverseTransform: (v: boolean) => v ? 1 : 0,
  },
  // Aux relay 2
  {
    firestoreKey: 'relays_relay2_info_key',
    capability: 'aux_relay_2_mode',
    firestorePath: 'relays.relay2.info.key',
    transform: (v: number) => RELAY_MODE_MAP[v] || 'auto',
    reverseTransform: (v: string) => RELAY_MODE_REVERSE[v] ?? 0,
  },
  {
    firestoreKey: 'relays_relay2_info_onoff',
    capability: 'aux_relay_2_onoff',
    firestorePath: 'relays.relay2.info.onoff',
    transform: (v: any) => Boolean(v),
    reverseTransform: (v: boolean) => v ? 1 : 0,
  },
  // Aux relay 3
  {
    firestoreKey: 'relays_relay3_info_key',
    capability: 'aux_relay_3_mode',
    firestorePath: 'relays.relay3.info.key',
    transform: (v: number) => RELAY_MODE_MAP[v] || 'auto',
    reverseTransform: (v: string) => RELAY_MODE_REVERSE[v] ?? 0,
  },
  {
    firestoreKey: 'relays_relay3_info_onoff',
    capability: 'aux_relay_3_onoff',
    firestorePath: 'relays.relay3.info.onoff',
    transform: (v: any) => Boolean(v),
    reverseTransform: (v: boolean) => v ? 1 : 0,
  },
  // Aux relay 4
  {
    firestoreKey: 'relays_relay4_info_key',
    capability: 'aux_relay_4_mode',
    firestorePath: 'relays.relay4.info.key',
    transform: (v: number) => RELAY_MODE_MAP[v] || 'auto',
    reverseTransform: (v: string) => RELAY_MODE_REVERSE[v] ?? 0,
  },
  {
    firestoreKey: 'relays_relay4_info_onoff',
    capability: 'aux_relay_4_onoff',
    firestorePath: 'relays.relay4.info.onoff',
    transform: (v: any) => Boolean(v),
    reverseTransform: (v: boolean) => v ? 1 : 0,
  },
];

// Trigger card mappings: capability → { onTrue: triggerCardId, onFalse: triggerCardId }
const TRIGGER_MAP: Record<string, { onTrue: string; onFalse: string }> = {
  status_filtration: { onTrue: 'filtration_started', onFalse: 'filtration_stopped' },
  chlorination_shock: { onTrue: 'chlorination_shock_started', onFalse: 'chlorination_shock_stopped' },
  lighting_onoff: { onTrue: 'light_turned_on', onFalse: 'light_turned_off' },
};

const DEFAULT_POLL_INTERVAL_MINUTES = 5;

class AquascenicDevice extends Homey.Device {
  private api: HaywardApi | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private poolId: string = '';
  private registeredListeners: Set<string> = new Set();

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

      // Log ALL keys grouped by prefix for discovery
      const keys = Object.keys(data).sort();
      const grouped: Record<string, string[]> = {};
      for (const key of keys) {
        const prefix = key.split('_')[0];
        if (!grouped[prefix]) grouped[prefix] = [];
        grouped[prefix].push(`${key}=${JSON.stringify(data[key])}`);
      }
      for (const [prefix, entries] of Object.entries(grouped)) {
        this.log(`[${prefix}] ${entries.join(' | ')}`);
      }

      if (data.present === false) {
        this.setWarning('Pool controller is offline').catch(this.error);
      } else {
        this.unsetWarning().catch(this.error);
      }

      // Update read-only capabilities
      for (const mapping of CAPABILITY_MAP) {
        const rawValue = data[mapping.firestoreKey];
        if (rawValue === undefined || rawValue === null) continue;

        try {
          const value = mapping.transform ? mapping.transform(rawValue) : rawValue;
          if (this.hasCapability(mapping.capability)) {
            await this.checkAndFireTrigger(mapping.capability, value);
            await this.setCapabilityValue(mapping.capability, value).catch((err: Error) => {
              this.error(`Failed to set ${mapping.capability}:`, err.message);
            });
          }
        } catch (err) {
          this.error(`Error processing ${mapping.firestoreKey}:`, err);
        }
      }

      // Dynamically add optional read-only capabilities
      for (const mapping of OPTIONAL_READ_MAP) {
        const rawValue = data[mapping.firestoreKey];
        if (rawValue === undefined || rawValue === null) continue;

        try {
          if (!this.hasCapability(mapping.capability)) {
            this.log(`Device supports ${mapping.capability}, adding capability`);
            await this.addCapability(mapping.capability);
          }
          const value = mapping.transform ? mapping.transform(rawValue) : rawValue;
          await this.setCapabilityValue(mapping.capability, value).catch((err: Error) => {
            this.error(`Failed to set ${mapping.capability}:`, err.message);
          });
        } catch (err) {
          this.error(`Error processing optional ${mapping.firestoreKey}:`, err);
        }
      }

      // Dynamically add settable capabilities and register listeners
      for (const mapping of SETTABLE_CAPABILITY_MAP) {
        const rawValue = data[mapping.firestoreKey];
        if (rawValue === undefined || rawValue === null) continue;

        try {
          if (!this.hasCapability(mapping.capability)) {
            this.log(`Device supports ${mapping.capability}, adding settable capability`);
            await this.addCapability(mapping.capability);
          }

          // Register write listener once per capability
          if (!this.registeredListeners.has(mapping.capability)) {
            this.registerSettableListener(mapping);
            this.registeredListeners.add(mapping.capability);
          }

          const value = mapping.transform ? mapping.transform(rawValue) : rawValue;
          await this.checkAndFireTrigger(mapping.capability, value);
          await this.setCapabilityValue(mapping.capability, value).catch((err: Error) => {
            this.error(`Failed to set ${mapping.capability}:`, err.message);
          });
        } catch (err) {
          this.error(`Error processing settable ${mapping.firestoreKey}:`, err);
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

  private async checkAndFireTrigger(capability: string, newValue: any) {
    const trigger = TRIGGER_MAP[capability];
    if (!trigger) return;

    const oldValue = this.getCapabilityValue(capability);
    if (oldValue === null || oldValue === newValue) return;

    const cardId = newValue ? trigger.onTrue : trigger.onFalse;
    try {
      await this.homey.flow.getDeviceTriggerCard(cardId).trigger(this);
      this.log(`Fired trigger: ${cardId}`);
    } catch (err) {
      this.error(`Failed to fire trigger ${cardId}:`, err);
    }
  }

  private registerSettableListener(mapping: SettableCapabilityMapping) {
    this.registerCapabilityListener(mapping.capability, async (value: any) => {
      if (!this.api) throw new Error('Not connected');

      const writeValue = mapping.reverseTransform ? mapping.reverseTransform(value) : value;
      this.log(`Setting ${mapping.firestorePath} = ${JSON.stringify(writeValue)} (from ${JSON.stringify(value)})`);

      await this.api.updatePoolField(this.poolId, mapping.firestorePath, writeValue);

      // Poll after a short delay to let the device process the change
      this.homey.setTimeout(() => this.pollData(), 3000);
    });
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
