'use strict';

import Homey from 'homey';
import { HaywardApi } from '../../lib/HaywardApi';

class AquascenicDriver extends Homey.Driver {

  async onInit() {
    this.log('AquascenicDriver has been initialized');

    // Action cards
    this.homey.flow.getActionCard('enable_chlorination_shock')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('chlorination_shock', true);
      });

    this.homey.flow.getActionCard('disable_chlorination_shock')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('chlorination_shock', false);
      });

    this.homey.flow.getActionCard('turn_light_on')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('lighting_onoff', true);
      });

    this.homey.flow.getActionCard('turn_light_off')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('lighting_onoff', false);
      });

    this.homey.flow.getActionCard('turn_relay_on')
      .registerRunListener(async (args) => {
        const cap = `aux_relay_${args.relay}_onoff`;
        await args.device.triggerCapabilityListener(cap, true);
      });

    this.homey.flow.getActionCard('turn_relay_off')
      .registerRunListener(async (args) => {
        const cap = `aux_relay_${args.relay}_onoff`;
        await args.device.triggerCapabilityListener(cap, false);
      });

    this.homey.flow.getActionCard('start_backwash')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('backwash_onoff', true);
      });

    this.homey.flow.getActionCard('stop_backwash')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('backwash_onoff', false);
      });

    this.homey.flow.getActionCard('open_cover')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('cover_onoff', true);
      });

    this.homey.flow.getActionCard('close_cover')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('cover_onoff', false);
      });

    this.homey.flow.getActionCard('set_hydrolysis_level')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('target_hydrolysis_level', args.level);
      });

    this.homey.flow.getActionCard('set_filtration_mode')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('filtration_mode', args.mode);
      });

    this.homey.flow.getActionCard('turn_filtration_on')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('filtration_mode', 'manual');
      });

    this.homey.flow.getActionCard('turn_filtration_off')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('filtration_mode', 'auto');
      });

    this.homey.flow.getActionCard('set_filtration_speed')
      .registerRunListener(async (args) => {
        await args.device.triggerCapabilityListener('filtration_speed', args.speed);
      });

    // Condition cards
    this.homey.flow.getConditionCard('is_filtration_running')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('status_filtration') === true;
      });

    this.homey.flow.getConditionCard('is_light_on')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('lighting_onoff') === true;
      });

    this.homey.flow.getConditionCard('is_chlorination_shock_active')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('chlorination_shock') === true;
      });
  }

  async onPair(session: Homey.Driver.PairSession) {
    let email = '';
    let password = '';
    let api: HaywardApi | null = null;
    let poolId = '';

    session.setHandler('login', async (data: { username: string; password: string }) => {
      email = data.username;
      password = data.password;

      api = new HaywardApi(email, password, this.log.bind(this));

      const isValid = await api.testCredentials();
      if (!isValid) {
        throw new Error('Invalid email or password. Please check your Hayward/Aquascenic account credentials.');
      }
      return true;
    });

    session.setHandler('set_pool_id', async (id: string) => {
      this.log('set_pool_id called with:', id);
      poolId = id.trim();

      if (!poolId) {
        throw new Error('Please enter your Pool ID.');
      }

      if (!api) {
        throw new Error('Not authenticated. Please go back and log in.');
      }

      try {
        const data = await api.fetchPoolData(poolId);
        this.log('Pool data fetched successfully, keys:', Object.keys(data));
      } catch (err: any) {
        this.error('Pool ID validation failed:', err.message);
        throw new Error(`Could not find a pool with this ID: ${err.message}`);
      }

      return true;
    });

    session.setHandler('list_devices', async () => {
      this.log('list_devices called, poolId:', poolId);
      const devices = [
        {
          name: 'Aquascenic Pool',
          data: {
            id: poolId,
          },
          store: {
            email,
            password,
            poolId,
          },
        },
      ];
      this.log('Returning devices:', JSON.stringify(devices.map(d => ({ name: d.name, id: d.data.id }))));
      return devices;
    });
  }

  async onRepair(session: Homey.Driver.PairSession, device: Homey.Device) {
    session.setHandler('login', async (data: { username: string; password: string }) => {
      const poolId = device.getData().id;
      const api = new HaywardApi(data.username, data.password, this.log.bind(this));

      const isValid = await api.testCredentials();
      if (!isValid) {
        throw new Error('Invalid email or password.');
      }

      const poolValid = await api.testConnection(poolId);
      if (!poolValid) {
        throw new Error('Authentication succeeded but could not access the pool. Please check your account has access to this pool.');
      }

      await device.setStoreValue('email', data.username);
      await device.setStoreValue('password', data.password);

      device.emit('credentialsUpdated');

      await session.done();
      return true;
    });
  }
}

module.exports = AquascenicDriver;
