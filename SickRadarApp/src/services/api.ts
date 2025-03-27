// src/services/api.ts
import axios, { AxiosInstance } from 'axios';
import webSocketService from './websocket';
import discoveryService, { ServerInfo } from './discovery';

// Tipos
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

// Cache para dados
const dataCache = {
  status: null as RadarStatus | null,
  currentData: null as CurrentData | null,
  velocityChanges: [] as VelocityChange[],
  velocityHistory: new Map<number, HistoryPoint[]>(),
  lastUpdate: null as LatestUpdate | null,
  listeners: new Map<string, Set<(data: any) => void>>(),
};

// API service
class ApiService {
  private apiClient: AxiosInstance | null = null;
  private currentServer: ServerInfo | null = null;
  private wsInitialized: boolean = false;
  private apiBaseUrl: string = '';

  // Inicializar o serviço de API
  public async initialize(): Promise<boolean> {
    try {
      // Tentar conectar via descoberta
      const connected = await this.connectToDiscoveredServer();
      
      if (connected) {
        await this.initializeWebSocket();
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Erro ao inicializar API service:', error);
      return false;
    }
  }

  // Conectar ao servidor descoberto
  private async connectToDiscoveredServer(): Promise<boolean> {
    try {
      // Tentar conectar ao WebSocket usando o serviço de descoberta
      const connected = await webSocketService.connectToDiscoveredServer();
      
      if (connected) {
        // Obter servidor atual
        const server = webSocketService.getCurrentServer();
        
        if (server) {
          // Configurar cliente de API
          this.configureApiClient(server.apiUrl);
          this.currentServer = server;
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Erro ao conectar ao servidor descoberto:', error);
      return false;
    }
  }

  // Conectar a um servidor específico
  public async connectToServer(server: ServerInfo): Promise<boolean> {
    try {
      // Conectar ao WebSocket
      const connected = await webSocketService.connectToServer(server);
      
      if (connected) {
        // Configurar cliente de API
        this.configureApiClient(server.apiUrl);
        this.currentServer = server;
        
        // Inicializar WebSocket se ainda não estiver inicializado
        if (!this.wsInitialized) {
          await this.initializeWebSocket();
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Erro ao conectar ao servidor ${server.ip}:${server.port}:`, error);
      return false;
    }
  }

  // Configurar cliente de API
  private configureApiClient(baseURL: string): void {
    this.apiBaseUrl = baseURL;
    
    this.apiClient = axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // Inicializar WebSocket
  private async initializeWebSocket(): Promise<void> {
    if (this.wsInitialized) return;
    
    // Configurar listeners do WebSocket
    this.setupWebSocketListeners();
    
    // Se não estiver conectado, tentar conectar
    if (!webSocketService.isConnected()) {
      try {
        await webSocketService.connect();
      } catch (error) {
        console.error('Falha ao conectar ao WebSocket:', error);
        // Continuar com fallback REST
      }
    }
    
    this.wsInitialized = true;
  }

  // Configurar listeners do WebSocket
  private setupWebSocketListeners(): void {
    // Atualizações de status
    webSocketService.on('status', (data) => {
      dataCache.status = {
        status: data.status,
        timestamp: data.timestamp,
      };
      this.notifyListeners('status', dataCache.status);
    });

    // Atualizações de dados atuais
    webSocketService.on('current_data', (data) => {
      dataCache.currentData = {
        positions: data.positions,
        velocities: data.velocities,
        timestamp: data.timestamp,
      };
      this.notifyListeners('currentData', dataCache.currentData);
    });

    // Atualizações de métricas (combina posições e velocidades)
    webSocketService.on('metrics', (data) => {
      dataCache.currentData = {
        positions: data.positions,
        velocities: data.velocities,
        timestamp: data.timestamp.toString(),
      };
      
      if (data.status) {
        dataCache.status = {
          status: data.status,
          timestamp: data.timestamp.toString(),
        };
        this.notifyListeners('status', dataCache.status);
      }
      
      this.notifyListeners('currentData', dataCache.currentData);
    });

    // Mudanças de velocidade
    webSocketService.on('velocity_changes', (data) => {
      // Adicionar novas mudanças ao início do array
      dataCache.velocityChanges = [...data.changes, ...dataCache.velocityChanges]
        // Remover duplicatas
        .filter((change, index, self) => 
          index === self.findIndex(c => c.timestamp === change.timestamp && c.index === change.index)
        )
        // Manter apenas as últimas 100 mudanças
        .slice(0, 100);
      
      this.notifyListeners('velocityChanges', dataCache.velocityChanges);
    });

    // Histórico de velocidade para um índice específico
    webSocketService.on('velocity_history', (data) => {
      const index = data.index;
      dataCache.velocityHistory.set(index, data.history);
      this.notifyListeners(`velocityHistory_${index}`, data.history);
    });

    // Eventos de conexão
    webSocketService.on('connected', () => {
      console.log('WebSocket conectado - solicitando dados iniciais');
      webSocketService.requestStatus();
    });

    webSocketService.on('disconnected', () => {
      console.log('WebSocket desconectado');
    });
  }

  // Notificar listeners de mudanças de dados
  private notifyListeners(type: string, data: any): void {
    const listeners = dataCache.listeners.get(type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Erro ao notificar listener para ${type}:`, error);
        }
      });
    }
  }

  // Obter status do radar
  public async getStatus(): Promise<RadarStatus> {
    // Tentar cache do WebSocket primeiro
    if (dataCache.status) {
      return dataCache.status;
    }
    
    // Verificar se cliente de API está configurado
    if (!this.apiClient) {
      throw new Error('Cliente de API não configurado');
    }
    
    // Fallback para API REST
    try {
      webSocketService.requestStatus(); // Solicitar dados frescos via WebSocket
      const response = await this.apiClient.get('/status');
      dataCache.status = response.data;
      return response.data;
    } catch (error) {
      console.error('Erro ao buscar status:', error);
      throw error;
    }
  }

  // Inscrever-se para atualizações de status
  public subscribeToStatus(callback: (status: RadarStatus) => void): () => void {
    const type = 'status';
    if (!dataCache.listeners.has(type)) {
      dataCache.listeners.set(type, new Set());
    }
    dataCache.listeners.get(type)!.add(callback);
    
    // Chamar com dados atuais se disponíveis
    if (dataCache.status) {
      callback(dataCache.status);
    }
    
    // Retornar função para cancelar inscrição
    return () => {
      const listeners = dataCache.listeners.get(type);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  // Obter dados atuais de velocidade e posição
  public async getCurrentData(): Promise<CurrentData> {
    // Tentar cache do WebSocket primeiro
    if (dataCache.currentData) {
      return dataCache.currentData;
    }
    
    // Verificar se cliente de API está configurado
    if (!this.apiClient) {
      throw new Error('Cliente de API não configurado');
    }
    
    // Fallback para API REST
    try {
      const response = await this.apiClient.get('/current');
      dataCache.currentData = response.data;
      return response.data;
    } catch (error) {
      console.error('Erro ao buscar dados atuais:', error);
      throw error;
    }
  }

  // Inscrever-se para atualizações de dados atuais
  public subscribeToCurrentData(callback: (data: CurrentData) => void): () => void {
    const type = 'currentData';
    if (!dataCache.listeners.has(type)) {
      dataCache.listeners.set(type, new Set());
    }
    dataCache.listeners.get(type)!.add(callback);
    
    // Chamar com dados atuais se disponíveis
    if (dataCache.currentData) {
      callback(dataCache.currentData);
    }
    
    // Retornar função para cancelar inscrição
    return () => {
      const listeners = dataCache.listeners.get(type);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  // Obter mudanças recentes de velocidade
  public async getVelocityChanges(): Promise<VelocityChange[]> {
    // Tentar cache do WebSocket primeiro
    if (dataCache.velocityChanges.length > 0) {
      return dataCache.velocityChanges;
    }
    
    // Verificar se cliente de API está configurado
    if (!this.apiClient) {
      throw new Error('Cliente de API não configurado');
    }
    
    // Fallback para API REST
    try {
      const response = await this.apiClient.get('/velocity-changes');
      dataCache.velocityChanges = response.data;
      return response.data;
    } catch (error) {
      console.error('Erro ao buscar mudanças de velocidade:', error);
      throw error;
    }
  }

  // Inscrever-se para atualizações de mudanças de velocidade
  public subscribeToVelocityChanges(callback: (changes: VelocityChange[]) => void): () => void {
    const type = 'velocityChanges';
    if (!dataCache.listeners.has(type)) {
      dataCache.listeners.set(type, new Set());
    }
    dataCache.listeners.get(type)!.add(callback);
    
    // Chamar com dados atuais se disponíveis
    if (dataCache.velocityChanges.length > 0) {
      callback(dataCache.velocityChanges);
    }
    
    // Retornar função para cancelar inscrição
    return () => {
      const listeners = dataCache.listeners.get(type);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  // Obter histórico de velocidade para um índice específico
  public async getVelocityHistory(index: number): Promise<HistoryPoint[]> {
    // Tentar cache do WebSocket primeiro
    const cachedHistory = dataCache.velocityHistory.get(index);
    if (cachedHistory) {
      return cachedHistory;
    }
    
    // Solicitar via WebSocket para atualizações futuras
    webSocketService.requestVelocityHistory(index);
    
    // Verificar se cliente de API está configurado
    if (!this.apiClient) {
      throw new Error('Cliente de API não configurado');
    }
    
    // Fallback para API REST
    try {
      const response = await this.apiClient.get(`/velocity-history/${index}`);
      dataCache.velocityHistory.set(index, response.data);
      return response.data;
    } catch (error) {
      console.error(`Erro ao buscar histórico de velocidade para índice ${index}:`, error);
      throw error;
    }
  }

  // Inscrever-se para atualizações de histórico de velocidade para um índice específico
  public subscribeToVelocityHistory(
    index: number, 
    callback: (history: HistoryPoint[]) => void
  ): () => void {
    const type = `velocityHistory_${index}`;
    if (!dataCache.listeners.has(type)) {
      dataCache.listeners.set(type, new Set());
    }
    dataCache.listeners.get(type)!.add(callback);
    
    // Chamar com dados atuais se disponíveis
    const cachedHistory = dataCache.velocityHistory.get(index);
    if (cachedHistory) {
      callback(cachedHistory);
    } else {
      // Solicitar dados se não estiverem em cache
      webSocketService.requestVelocityHistory(index);
    }
    
    // Retornar função para cancelar inscrição
    return () => {
      const listeners = dataCache.listeners.get(type);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  // Obter última atualização
  public async getLatestUpdate(): Promise<LatestUpdate> {
    // Verificar se cliente de API está configurado
    if (!this.apiClient) {
      throw new Error('Cliente de API não configurado');
    }
    
    // Fallback para API REST
    try {
      const response = await this.apiClient.get('/latest-update');
      dataCache.lastUpdate = response.data;
      return response.data;
    } catch (error) {
      console.error('Erro ao buscar última atualização:', error);
      throw error;
    }
  }

  // Verificar status da conexão WebSocket
  public isWebSocketConnected(): boolean {
    return webSocketService.isConnected();
  }

  // Forçar reconexão do WebSocket
  public async reconnectWebSocket(): Promise<void> {
    webSocketService.disconnect();
    await webSocketService.connect();
  }

  // Obter servidor atual
  public getCurrentServer(): ServerInfo | null {
    return this.currentServer;
  }

  // Iniciar descoberta de servidores
  public startServerDiscovery(): void {
    discoveryService.startDiscovery();
  }

  // Parar descoberta de servidores
  public stopServerDiscovery(): void {
    discoveryService.stopDiscovery();
  }

  // Obter servidores descobertos
  public getDiscoveredServers(): ServerInfo[] {
    return discoveryService.getDiscoveredServers();
  }

  // Adicionar servidor manualmente
  public async addManualServer(ip: string, port: number): Promise<ServerInfo | null> {
    return discoveryService.addManualServer(ip, port);
  }
}

// Criar instância singleton
const apiService = new ApiService();

export default apiService;