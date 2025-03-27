// src/services/websocket.ts
import { EventEmitter } from 'events';
import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';
import discoveryService, { ServerInfo } from './discovery';

// Tipos
export interface WebSocketMessage {
  type: string;
  timestamp: number;
  [key: string]: any;
}

export interface ConnectionConfig {
  url: string;
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  pingInterval: number;
  pongTimeout: number;
}

// Definição de constantes
const DEFAULT_PING_INTERVAL = 30000; // 30 segundos
const DEFAULT_PONG_TIMEOUT = 10000;  // 10 segundos
const DEFAULT_RECONNECT_DELAY = 3000; // 3 segundos
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const WEBSOCKET_BUFFER_SIZE = 50; // Limitar buffer para evitar memory leaks

class WebSocketService {
  private socket: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS;
  private reconnectDelay = DEFAULT_RECONNECT_DELAY;
  private eventEmitter = new EventEmitter();
  private pingInterval: NodeJS.Timeout | null = null;
  private pongWatchdog: NodeJS.Timeout | null = null;
  private lastPongTime = 0;
  private config: ConnectionConfig | null = null;
  private currentServer: ServerInfo | null = null;
  private serverUrl: string = '';
  private autoDiscoverOnFailure: boolean = true;
  
  // Controle de performance
  private messageBuffer: WebSocketMessage[] = [];
  private messageCounter = 0;
  private lastMetricsTimestamp = 0;
  private lastStatsReport = 0;
  private messagesPerSecond = 0;
  private messageRateUpdateInterval: NodeJS.Timeout | null = null;
  private isProcessingMessage = false;
  private queuedMessages: Array<MessageEvent> = [];
  private processingInterval: NodeJS.Timeout | null = null;
  private lastNetworkCheck = 0;
  private isNetworkConnected = true;
  private throttleMessages = true;
  
  constructor() {
    // Aumentar o limite máximo de listeners para evitar warnings de memory leak
    this.eventEmitter.setMaxListeners(20);
    
    // Inicializar monitoramento de rede
    this.setupNetworkMonitoring();
    
    // Iniciar processamento de mensagens em fila
    this.startMessageProcessing();
    
    // Iniciar monitoramento de taxa de mensagens
    this.startMessageRateMonitoring();
  }

  // Configurar o serviço
  public configure(config: Partial<ConnectionConfig>): void {
    this.config = {
      url: config.url || this.serverUrl,
      autoReconnect: config.autoReconnect !== undefined ? config.autoReconnect : true,
      maxReconnectAttempts: config.maxReconnectAttempts || DEFAULT_MAX_RECONNECT_ATTEMPTS,
      reconnectDelay: config.reconnectDelay || DEFAULT_RECONNECT_DELAY,
      pingInterval: config.pingInterval || DEFAULT_PING_INTERVAL,
      pongTimeout: config.pongTimeout || DEFAULT_PONG_TIMEOUT
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
      // Verificar se a rede está conectada
      this.checkNetworkBeforeConnect().then(isConnected => {
        if (!isConnected) {
          reject(new Error('Sem conexão de rede'));
          return;
        }
        
        // Se já estiver conectado, não fazer nada
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
          // Adicionar à fila para processamento em vez de processar imediatamente
          this.queuedMessages.push(event);
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
    });
  }

  // Verificar rede antes de conectar
  private async checkNetworkBeforeConnect(): Promise<boolean> {
    // Verificar apenas uma vez a cada 5 segundos
    const now = Date.now();
    if (now - this.lastNetworkCheck < 5000) {
      return this.isNetworkConnected;
    }
    
    this.lastNetworkCheck = now;
    
    try {
      const netInfo = await NetInfo.fetch();
      this.isNetworkConnected = netInfo.isConnected ?? false;
      return this.isNetworkConnected;
    } catch (error) {
      console.error('Erro ao verificar estado da rede:', error);
      return true; // Assumir conectado em caso de erro
    }
  }

  // Iniciar ping-pong para manter a conexão ativa
  private startPingPong() {
    this.stopPingPong(); // Limpar qualquer intervalo existente
    
    // Definir intervalo de ping conforme configuração
    const pingIntervalTime = this.config?.pingInterval || DEFAULT_PING_INTERVAL;
    const pongTimeoutTime = this.config?.pongTimeout || DEFAULT_PONG_TIMEOUT;
    
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        // Enviar mensagem de ping
        this.send({ type: 'ping', time: Date.now() });
        
        // Iniciar watchdog para verificar resposta
        if (this.pongWatchdog) clearTimeout(this.pongWatchdog);
        
        this.pongWatchdog = setTimeout(() => {
          console.warn(`Nenhum pong recebido em ${pongTimeoutTime/1000} segundos, a conexão pode estar morta`);
          
          // Fechar conexão se não receber pong
          if (this.socket) {
            this.socket.close();
            this.socket = null;
          }
        }, pongTimeoutTime);
      }
    }, pingIntervalTime);
  }

  // Parar o intervalo de ping-pong
  private stopPingPong() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.pongWatchdog) {
      clearTimeout(this.pongWatchdog);
      this.pongWatchdog = null;
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
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    if (this.messageRateUpdateInterval) {
      clearInterval(this.messageRateUpdateInterval);
      this.messageRateUpdateInterval = null;
    }
    
    // Limpar filas
    this.queuedMessages = [];
    this.messageBuffer = [];
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

  // Processar uma mensagem recebida
  private processMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data) as WebSocketMessage;
      this.messageCounter++;
      
      // Tratar mensagens de pong separadamente
      if (message.type === 'pong') {
        this.lastPongTime = Date.now();
        
        // Limpar watchdog de pong
        if (this.pongWatchdog) {
          clearTimeout(this.pongWatchdog);
          this.pongWatchdog = null;
        }
        
        return;
      }
      
      // Controle de throttling para mensagens de métricas
      if (message.type === 'metrics') {
        // Se estiver no modo de limitação, verificar se deve processar
        if (this.throttleMessages) {
          const now = Date.now();
          
          // Processar apenas uma mensagem de métricas a cada 100ms
          if (this.lastMetricsTimestamp > 0 && (now - this.lastMetricsTimestamp) < 100) {
            return; // Ignorar esta mensagem
          }
          
          this.lastMetricsTimestamp = now;
        }
      }
      
      // Adicionar ao buffer para debug/análise
      this.messageBuffer.push(message);
      if (this.messageBuffer.length > WEBSOCKET_BUFFER_SIZE) {
        this.messageBuffer.shift(); // Remover mensagem mais antiga
      }
      
      // Emitir evento com o tipo da mensagem
      this.eventEmitter.emit(message.type, message);
      
      // Também emitir um evento genérico 'message'
      this.eventEmitter.emit('message', message);
    } catch (error) {
      console.error('Erro ao analisar mensagem WebSocket:', error);
    }
  }

  // Iniciar processamento de mensagens em fila
  private startMessageProcessing() {
    // Processar mensagens na fila a cada 16ms (aproximadamente 60 fps)
    this.processingInterval = setInterval(() => {
      if (this.queuedMessages.length > 0 && !this.isProcessingMessage) {
        this.isProcessingMessage = true;
        
        // Processar apenas um lote por vez para evitar bloqueios longos
        const batchSize = Math.min(5, this.queuedMessages.length);
        const batch = this.queuedMessages.splice(0, batchSize);
        
        for (const event of batch) {
          this.processMessage(event);
        }
        
        this.isProcessingMessage = false;
      }
    }, 16);
  }

  // Configurar monitoramento de rede
  private setupNetworkMonitoring() {
    if (Platform.OS !== 'web') {
      // Registrar listeners para estado de conexão
      NetInfo.addEventListener(state => {
        const isConnected = state.isConnected ?? false;
        
        // Se a conexão mudou
        if (this.isNetworkConnected !== isConnected) {
          this.isNetworkConnected = isConnected;
          
          if (isConnected) {
            console.log('Conexão de rede restaurada');
            
            // Se WebSocket estiver fechado, tentar reconectar
            if (!this.isConnected()) {
              this.connect().catch(error => {
                console.error('Erro ao reconectar após restauração de rede:', error);
              });
            }
          } else {
            console.log('Conexão de rede perdida');
          }
        }
      });
    }
  }

  // Iniciar monitoramento da taxa de mensagens
  private startMessageRateMonitoring() {
    // Atualizar taxa de mensagens a cada segundo
    this.messageRateUpdateInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.lastStatsReport) / 1000;
      
      if (elapsed > 0) {
        this.messagesPerSecond = this.messageCounter / elapsed;
        
        // Periodicamente mostrar estatísticas (a cada 10 segundos)
        if (elapsed > 10) {
          // Reseta contador
          this.messageCounter = 0;
          this.lastStatsReport = now;
          
          // Logar estatísticas
          if (this.isConnected()) {
            console.log(`WebSocket stats: ${this.messagesPerSecond.toFixed(1)} msgs/sec, buffer: ${this.queuedMessages.length} msgs`);
          }
        }
      }
    }, 1000);
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
  
  // Definir throttling de mensagens
  public setThrottleMessages(value: boolean): void {
    this.throttleMessages = value;
  }
  
  // Obter estatísticas
  public getStats(): any {
    return {
      messagesPerSecond: this.messagesPerSecond,
      queuedMessages: this.queuedMessages.length,
      messageBufferSize: this.messageBuffer.length,
      isNetworkConnected: this.isNetworkConnected,
      reconnectAttempts: this.reconnectAttempts,
      lastPongTime: this.lastPongTime > 0 ? new Date(this.lastPongTime).toISOString() : 'never'
    };
  }
  
  // Limpar buffer de mensagens
  public clearMessageBuffer(): void {
    this.messageBuffer = [];
    this.queuedMessages = [];
  }
}

// Criar instância singleton
const webSocketService = new WebSocketService();

export default webSocketService;