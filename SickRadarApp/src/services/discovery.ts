// src/services/discovery.ts
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Zeroconf from 'react-native-zeroconf';

// Constantes para armazenamento
const STORAGE_SERVER_INFO = 'radar_server_info';
const STORAGE_LAST_USED_SERVER = 'radar_last_used_server';

// Tipos
export interface ServerInfo {
  name: string;
  ip: string;
  port: number;
  wsUrl: string;
  apiUrl: string;
  version: string;
  manual?: boolean;
  lastConnected?: number;
}

class DiscoveryService {
  private zeroconf: Zeroconf | null = null;
  private discoveredServers: ServerInfo[] = [];
  private isDiscovering: boolean = false;
  private manualServers: ServerInfo[] = [];
  private lastUsedServer: ServerInfo | null = null;
  private discoveryTimeout: NodeJS.Timeout | null = null;

  constructor() {
    // Inicializar Zeroconf se não estiver na web
    if (Platform.OS !== 'web') {
      try {
        this.zeroconf = new Zeroconf();
        this.setupZeroconf();
      } catch (error) {
        console.error('Erro ao inicializar Zeroconf:', error);
        // Continuar mesmo sem Zeroconf
      }
    }

    // Carregar servidores salvos
    this.loadSavedServers();
  }

  // Configurar Zeroconf
  private setupZeroconf() {
    if (!this.zeroconf) return;

    this.zeroconf.on('resolved', (service: any) => {
      try {
        // Extrair informações do serviço
        const ip = service.addresses?.[0] || '';
        const port = service.port || 8080;
        
        // Verificar se o serviço é do tipo correto
        if (service.type === '_sickradar._tcp.' && ip) {
          // Criar servidor
          const server: ServerInfo = {
            name: service.name || 'SICK Radar Monitor',
            ip,
            port,
            wsUrl: `ws://${ip}:${port}/ws`,
            apiUrl: `http://${ip}:${port}/api`,
            version: service.txt?.version || '1.0.0',
            lastConnected: Date.now()
          };
          
          // Adicionar à lista de servidores descobertos
          this.addDiscoveredServer(server);
        }
      } catch (error) {
        console.error('Erro ao processar serviço Zeroconf:', error);
      }
    });

    this.zeroconf.on('error', (error: any) => {
      console.error('Erro Zeroconf:', error);
    });
  }

  // Iniciar descoberta de servidores
  public startDiscovery(): void {
    if (this.isDiscovering) return;
    
    this.isDiscovering = true;
    
    // Limpar timeout anterior se existir
    if (this.discoveryTimeout) {
      clearTimeout(this.discoveryTimeout);
    }
    
    // Limpar lista de servidores descobertos (mantendo os manuais)
    this.discoveredServers = [...this.manualServers];
    
    // Usar Zeroconf se disponível
    if (this.zeroconf) {
      try {
        this.zeroconf.scan('_sickradar._tcp.', 'local.');
        console.log('Iniciando descoberta de servidores via Zeroconf');
      } catch (error) {
        console.error('Erro ao iniciar Zeroconf:', error);
      }
    }

    // Descoberta manual via IP na rede local
    this.discoverManually();
    
    // Definir timeout para parar a descoberta após 10 segundos
    this.discoveryTimeout = setTimeout(() => {
      this.stopDiscovery();
    }, 10000);
  }

  // Parar descoberta
  public stopDiscovery(): void {
    if (!this.isDiscovering) return;
    
    if (this.zeroconf) {
      try {
        this.zeroconf.stop();
      } catch (error) {
        console.error('Erro ao parar Zeroconf:', error);
      }
    }
    
    if (this.discoveryTimeout) {
      clearTimeout(this.discoveryTimeout);
      this.discoveryTimeout = null;
    }
    
    this.isDiscovering = false;
    console.log('Descoberta de servidores finalizada');
  }

  // Descoberta manual na rede local
  private async discoverManually(): Promise<void> {
    try {
      // Obter informações da rede
      const netInfo = await NetInfo.fetch();
      
      if (!netInfo.isConnected) {
        console.log('Sem conexão de rede para descoberta manual');
        return;
      }
      
      // Tentar o último servidor usado
      if (this.lastUsedServer) {
        this.tryServer(this.lastUsedServer);
      }
      
      // Tentar servidores manuais salvos
      for (const server of this.manualServers) {
        this.tryServer(server);
      }
      
      // Se estiver em redes comuns, tentar alguns IPs padrão
      if (netInfo.type === 'wifi' || netInfo.type === 'ethernet') {
        // Tentar IPs comuns em redes locais
        const commonPorts = [8080, 3000, 8000];
        
        // Tentativa 1: Tentar o gateway da rede (geralmente 192.168.1.1)
        const gateway = netInfo.details?.ipAddress || '';
        if (gateway && gateway.startsWith('192.168.')) {
          const baseIP = gateway.substring(0, gateway.lastIndexOf('.') + 1);
          
          // Verificar os primeiros 20 IPs na mesma subrede
          const checkPromises: Promise<void>[] = [];
          for (let i = 1; i <= 20; i++) {
            const ip = `${baseIP}${i}`;
            for (const port of commonPorts) {
              checkPromises.push(this.probeServer(ip, port));
            }
          }
          
          // Realizar verificações em paralelo com limite de concorrência
          // Verificar em grupos de 5 para não sobrecarregar a rede
          for (let i = 0; i < checkPromises.length; i += 5) {
            await Promise.all(checkPromises.slice(i, i + 5));
            // Pequena pausa entre grupos de verificação
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
      }
    } catch (error) {
      console.error('Erro na descoberta manual:', error);
    }
  }

  // Verificar se um servidor responde na porta esperada
  private async probeServer(ip: string, port: number): Promise<void> {
    try {
      // Primeiro, verificar se a porta está aberta com timeout curto
      const url = `http://${ip}:${port}/health`;
      const response = await axios.get(url, { timeout: 1000 });
      
      if (response.status === 200) {
        try {
          // Verificar se é realmente nosso servidor com endpoint /api/discover
          const discoverUrl = `http://${ip}:${port}/api/discover`;
          const discoverResponse = await axios.get(discoverUrl, { timeout: 1000 });
          
          if (discoverResponse.data) {
            const { name, wsUrl, apiUrl, version } = discoverResponse.data;
            
            const server: ServerInfo = {
              name: name || 'SICK Radar Monitor',
              ip,
              port,
              wsUrl: wsUrl || `ws://${ip}:${port}/ws`,
              apiUrl: apiUrl || `http://${ip}:${port}/api`,
              version: version || '1.0.0',
              manual: false,  // Descoberto automaticamente
              lastConnected: Date.now()
            };
            
            this.addDiscoveredServer(server);
            console.log(`Servidor encontrado: ${ip}:${port} (${name || 'SICK Radar Monitor'})`);
          }
        } catch (error) {
          // Não é nosso servidor, ignorar
        }
      }
    } catch (error) {
      // Silenciosamente ignorar erros de conexão (esperado para a maioria dos IPs)
    }
  }

  // Verificar se um servidor conhecido ainda está ativo
  private async tryServer(server: ServerInfo): Promise<boolean> {
    try {
      const url = `http://${server.ip}:${server.port}/health`;
      const response = await axios.get(url, { timeout: 2000 });
      
      if (response.data?.status === 'ok' || response.data?.status === 'degraded') {
        // Atualizar timestamp
        server.lastConnected = Date.now();
        this.addDiscoveredServer(server);
        console.log(`Servidor ativo: ${server.ip}:${server.port} (${server.name})`);
        return true;
      }
    } catch (error) {
      // Servidor não está respondendo
      console.log(`Servidor inativo: ${server.ip}:${server.port}`);
    }
    
    return false;
  }

  // Adicionar servidor à lista de descobertos
  private addDiscoveredServer(server: ServerInfo): void {
    // Verificar se já existe
    const existingIndex = this.discoveredServers.findIndex(s => 
      s.ip === server.ip && s.port === server.port);
    
    if (existingIndex >= 0) {
      // Atualizar servidor existente
      this.discoveredServers[existingIndex] = {
        ...this.discoveredServers[existingIndex],
        ...server
      };
    } else {
      // Adicionar novo servidor
      this.discoveredServers.push(server);
    }
  }

  // Adicionar servidor manualmente
  public async addManualServer(ip: string, port: number): Promise<ServerInfo | null> {
    try {
      // Tentar conectar ao servidor
      const url = `http://${ip}:${port}/api/discover`;
      const response = await axios.get(url, { timeout: 3000 });
      
      if (response.data) {
        const { name, wsUrl, apiUrl, version } = response.data;
        
        const server: ServerInfo = {
          name: name || 'SICK Radar Monitor',
          ip,
          port,
          wsUrl: wsUrl || `ws://${ip}:${port}/ws`,
          apiUrl: apiUrl || `http://${ip}:${port}/api`,
          version: version || '1.0.0',
          manual: true,
          lastConnected: Date.now()
        };
        
        // Adicionar à lista de servidores
        this.addDiscoveredServer(server);
        
        // Adicionar à lista de servidores manuais
        const existingIndex = this.manualServers.findIndex(s => 
          s.ip === server.ip && s.port === server.port);
        
        if (existingIndex >= 0) {
          // Atualizar servidor existente
          this.manualServers[existingIndex] = server;
        } else {
          // Adicionar novo servidor
          this.manualServers.push(server);
        }
        
        // Salvar servidores manuais
        this.saveManualServers();
        
        return server;
      }
    } catch (error) {
      console.error(`Erro ao adicionar servidor manual ${ip}:${port}:`, error);
    }
    
    return null;
  }

  // Remover servidor manual
  public async removeManualServer(ip: string, port: number): Promise<void> {
    // Remover da lista de servidores manuais
    this.manualServers = this.manualServers.filter(s => 
      !(s.ip === ip && s.port === port));
    
    // Remover da lista de servidores descobertos se for manual
    this.discoveredServers = this.discoveredServers.filter(s => 
      !(s.ip === ip && s.port === port && s.manual));
    
    // Salvar servidores manuais
    this.saveManualServers();
  }

  // Obter todos os servidores descobertos
  public getDiscoveredServers(): ServerInfo[] {
    return [...this.discoveredServers].sort((a, b) => {
      // Ordenar por último conectado (mais recente primeiro)
      const aTime = a.lastConnected || 0;
      const bTime = b.lastConnected || 0;
      return bTime - aTime;
    });
  }

  // Obter servidores manuais
  public getManualServers(): ServerInfo[] {
    return [...this.manualServers];
  }

  // Obter último servidor usado
  public getLastUsedServer(): ServerInfo | null {
    return this.lastUsedServer;
  }

  // Definir servidor usado
  public async setLastUsedServer(server: ServerInfo): Promise<void> {
    this.lastUsedServer = server;
    
    // Salvar no AsyncStorage
    try {
      await AsyncStorage.setItem(STORAGE_LAST_USED_SERVER, JSON.stringify(server));
    } catch (error) {
      console.error('Erro ao salvar último servidor:', error);
    }
  }

  // Carregar servidores salvos
  private async loadSavedServers(): Promise<void> {
    try {
      // Carregar servidores manuais
      const savedServers = await AsyncStorage.getItem(STORAGE_SERVER_INFO);
      if (savedServers) {
        this.manualServers = JSON.parse(savedServers);
        
        // Adicionar à lista de servidores descobertos
        for (const server of this.manualServers) {
          this.addDiscoveredServer(server);
        }
      }
      
      // Carregar último servidor usado
      const lastServer = await AsyncStorage.getItem(STORAGE_LAST_USED_SERVER);
      if (lastServer) {
        this.lastUsedServer = JSON.parse(lastServer);
      }
    } catch (error) {
      console.error('Erro ao carregar servidores salvos:', error);
    }
  }

  // Salvar servidores manuais
  private async saveManualServers(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_SERVER_INFO, 
        JSON.stringify(this.manualServers)
      );
    } catch (error) {
      console.error('Erro ao salvar servidores manuais:', error);
    }
  }

  // Verificar se está descobrindo
  public isCurrentlyDiscovering(): boolean {
    return this.isDiscovering;
  }
}

// Criar instância singleton
const discoveryService = new DiscoveryService();

export default discoveryService;