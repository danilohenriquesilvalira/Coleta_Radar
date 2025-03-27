// src/services/websocket.ts
import { EventEmitter } from 'events';
import discoveryService, { ServerInfo } from './discovery';

// Tipos
export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export interface ConnectionConfig {
  url: string;
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  reconnectDelay: number;
}

class WebSocketService {
  private socket: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000; // 3 segundos
  private eventEmitter = new EventEmitter();
  private pingInterval: NodeJS.Timeout | null = null;
  private lastPongTime = 0;
  private config: ConnectionConfig | null = null;
  private currentServer: ServerInfo | null = null;
  private serverUrl: string = '';
  private autoDiscoverOnFailure: boolean = true;

  constructor() {
    // Aumentar o limite máximo de listeners para evitar warnings de memory leak
    this.eventEmitter.setMaxListeners(20);
  }

  // Configurar o serviço
  public configure(config: Partial<ConnectionConfig>): void {
    this.config = {
      url: config.url || this.serverUrl,
      autoReconnect: config.autoReconnect !== undefined ? config.autoReconnect : true,
      maxReconnectAttempts: config.maxReconnectAttempts || 5,
      reconnectDelay: config.reconnectDelay || 3000
    };
    
    this.serverUrl = this.config.url;
    this.maxReconnectAttempts = this.config.maxReconnectAttempts;
    this.reconnectDelay = this.config.reconnectDelay;
  }

  // Conectar ao WebSocket usando servidor descoberto
  public async connectToDiscoveredServer(): Promise<boolean> {
    // Verificar se há um último servidor usado
    let server = discoveryService.getLastUsedServer();
    
    // Se não houver um servidor usado anteriormente, iniciar descoberta
    if (!server) {
      // Iniciar descoberta
      discoveryService.startDiscovery();
      
      // Esperar por 3 segundos para descobrir servidores
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Parar descoberta
      discoveryService.stopDiscovery();
      
      // Obter servidores descobertos
      const servers = discoveryService.getDiscoveredServers();
      
      if (servers.length > 0) {
        // Usar o primeiro servidor descoberto
        server = servers[0];
      } else {
        console.error('Nenhum servidor encontrado na descoberta');
        return false;
      }
    }
    
    // Conectar ao servidor
    return this.connectToServer(server);
  }

  // Conectar a um servidor específico
  public async connectToServer(server: ServerInfo): Promise<boolean> {
    try {
      // Salvar servidor atual
      this.currentServer = server;
      this.serverUrl = server.wsUrl;
      
      // Configurar com o novo URL
      this.configure({
        url: server.wsUrl
      });
      
      // Conectar
      await this.connect();
      
      // Salvar como último servidor usado
      await discoveryService.setLastUsedServer(server);
      
      return true;
    } catch (error) {
      console.error(`Erro ao conectar ao servidor ${server.ip}:${server.port}:`, error);
      return false;
    }
  }

  // Conectar ao WebSocket
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        console.log('WebSocket já conectado');
        resolve();
        return;
      }

      // Limpar qualquer timeout de reconexão existente
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      // Verificar URL
      if (!this.serverUrl) {
        reject(new Error('URL do WebSocket não definido'));
        return;
      }

      console.log(`Conectando ao WebSocket em ${this.serverUrl}...`);
      this.socket = new WebSocket(this.serverUrl);

      this.socket.onopen = () => {
        console.log('WebSocket conectado');
        this.reconnectAttempts = 0;
        this.startPingPong();
        this.eventEmitter.emit('connected');
        resolve();
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          
          // Tratar mensagens de pong separadamente
          if (message.type === 'pong') {
            this.lastPongTime = Date.now();
            return;
          }
          
          // Emitir evento com o tipo da mensagem
          this.eventEmitter.emit(message.type, message);
          
          // Também emitir um evento genérico 'message'
          this.eventEmitter.emit('message', message);
        } catch (error) {
          console.error('Erro ao analisar mensagem WebSocket:', error);
        }
      };

      this.socket.onerror = (error) => {
        console.error('Erro WebSocket:', error);
        this.eventEmitter.emit('error', error);
      };

      this.socket.onclose = (event) => {
        console.log(`WebSocket fechado: ${event.code} ${event.reason}`);
        this.stopPingPong();
        this.eventEmitter.emit('disconnected');

        // Tentar reconectar se a conexão não foi fechada intencionalmente e autoReconnect estiver ativado
        if (this.config?.autoReconnect !== false) {
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * this.reconnectAttempts;
            console.log(`Reconectando em ${delay / 1000} segundos... (Tentativa ${this.reconnectAttempts})`);
            
            this.reconnectTimeout = setTimeout(() => {
              this.connect().catch(() => {
                // Reconexão falhou, já logado no método connect
              });
            }, delay);
          } else {
            console.error('Máximo de tentativas de reconexão atingido');
            
            // Se auto-descoberta em falha estiver ativada, tentar descobrir novos servidores
            if (this.autoDiscoverOnFailure) {
              console.log('Tentando descobrir novos servidores...');
              this.connectToDiscoveredServer().catch(() => {
                // Erro ao descobrir servidores, já logado no método
              });
            }
            
            this.eventEmitter.emit('max_reconnect_attempts');
            reject(new Error('Máximo de tentativas de reconexão atingido'));
          }
        }
      };
    });
  }

  // Iniciar ping-pong para manter a conexão ativa
  private startPingPong() {
    this.stopPingPong(); // Limpar qualquer intervalo existente
    
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        // Enviar mensagem de ping
        this.socket.send(JSON.stringify({ type: 'ping', time: Date.now() }));
        
        // Verificar se recebemos um pong recentemente (dentro de 10 segundos)
        const now = Date.now();
        if (this.lastPongTime > 0 && now - this.lastPongTime > 10000) {
          console.warn('Nenhum pong recebido em 10 segundos, a conexão pode estar morta');
          this.socket.close();
        }
      }
    }, 30000); // Enviar ping a cada 30 segundos
  }

  // Parar o intervalo de ping-pong
  private stopPingPong() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Desconectar do WebSocket
  public disconnect() {
    this.stopPingPong();
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  // Enviar uma mensagem para o servidor WebSocket
  public send(message: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      console.error('WebSocket não conectado');
    }
  }

  // Solicitar histórico de velocidade para um índice específico
  public requestVelocityHistory(index: number) {
    this.send({
      type: 'get_history',
      params: { index }
    });
  }

  // Solicitar status atual
  public requestStatus() {
    this.send({
      type: 'get_status'
    });
  }

  // Adicionar event listener
  public on(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.on(event, listener);
    return () => this.eventEmitter.off(event, listener);
  }

  // Remover event listener
  public off(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.off(event, listener);
  }

  // Verificar se o WebSocket está conectado
  public isConnected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  // Obter servidor atual
  public getCurrentServer(): ServerInfo | null {
    return this.currentServer;
  }
  
  // Definir se deve auto-descobrir em falha
  public setAutoDiscoverOnFailure(value: boolean): void {
    this.autoDiscoverOnFailure = value;
  }
}

// Criar instância singleton
const webSocketService = new WebSocketService();

export default webSocketService;