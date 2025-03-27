// src/types/react-native-zeroconf.d.ts
declare module 'react-native-zeroconf' {
  export interface Service {
    name: string;
    type: string;
    domain: string;
    host: string;
    port: number;
    addresses: string[];
    txt?: {
      [key: string]: string;
    };
  }

  export interface ZeroconfOptions {
    timeout?: number;
  }

  export default class Zeroconf {
    constructor();

    /**
     * Scans for services of specified protocol type.
     * @param type - The type to scan for, e.g. "_sickradar._tcp."
     * @param domain - The domain to scan on, default 'local.'
     * @param timeout - Optional timeout in seconds
     */
    scan(type: string, domain?: string, timeout?: number): void;

    /**
     * Stop current scan.
     */
    stop(): void;

    /**
     * Get all currently resolved services.
     */
    getServices(): { [key: string]: Service };

    /**
     * Remove all listeners.
     */
    removeDeviceListeners(): void;

    /**
     * Remove all services.
     */
    removeAllServices(): void;

    /**
     * Add Listener.
     */
    on(eventName: 'resolved' | 'remove' | 'error' | 'start' | 'stop' | 'update', callback: Function): void;

    /**
     * Remove listener.
     */
    off(eventName: 'resolved' | 'remove' | 'error' | 'start' | 'stop' | 'update', callback: Function): void;

    /**
     * Publish a new service.
     */
    publishService(type: string, protocol: string, domain: string, name: string, port: number, txt?: object): void;

    /**
     * Unpublish a service.
     */
    unpublishService(name: string): void;

    /**
     * Subscribe to a multicast address.
     */
    subscribe(address: string): void;

    /**
     * Unsubscribe from a multicast address.
     */
    unsubscribe(address: string): void;
  }
}