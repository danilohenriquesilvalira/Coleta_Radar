// src/services/api.ts
import axios from 'axios';

// API base URL - change this to your server address
const API_BASE_URL = 'http://192.168.1.100:3000/api';

// Types
export interface RadarStatus {
  status: string;
  timestamp: string;
}

export interface VelocityChange {
  index: number;
  old_value: number;
  new_value: number;
  change_value: number;
  timestamp: number;
}

export interface CurrentData {
  positions: number[];
  velocities: number[];
  timestamp: string;
}

export interface HistoryPoint {
  value: number;
  timestamp: number;
}

export interface LatestUpdate {
  timestamp: number;
  changes: VelocityChange[];
}

// API client
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// API service
const ApiService = {
  // Get radar status
  getStatus: async (): Promise<RadarStatus> => {
    const response = await apiClient.get('/status');
    return response.data;
  },

  // Get current velocity and position data
  getCurrentData: async (): Promise<CurrentData> => {
    const response = await apiClient.get('/current');
    return response.data;
  },

  // Get recent velocity changes
  getVelocityChanges: async (): Promise<VelocityChange[]> => {
    const response = await apiClient.get('/velocity-changes');
    return response.data;
  },

  // Get velocity history for a specific index
  getVelocityHistory: async (index: number): Promise<HistoryPoint[]> => {
    const response = await apiClient.get(`/velocity-history/${index}`);
    return response.data;
  },

  // Get latest update
  getLatestUpdate: async (): Promise<LatestUpdate> => {
    const response = await apiClient.get('/latest-update');
    return response.data;
  }
};

export default ApiService;