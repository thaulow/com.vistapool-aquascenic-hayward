'use strict';

import Homey from 'homey';
import { HaywardApi } from '../../lib/HaywardApi';

class AquascenicDriver extends Homey.Driver {

  async onInit() {
    this.log('AquascenicDriver has been initialized');
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

    session.setHandler('pincode', async (code: string[]) => {
      poolId = code.join('').trim();

      if (!poolId) {
        throw new Error('Please enter your Pool ID.');
      }

      if (!api) {
        throw new Error('Not authenticated. Please go back and log in.');
      }

      const isValid = await api.testConnection(poolId);
      if (!isValid) {
        throw new Error('Could not find a pool with this ID. Please check the Pool ID in your Hayward/Aquascenic app.');
      }

      return true;
    });

    session.setHandler('list_devices', async () => {
      return [
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
