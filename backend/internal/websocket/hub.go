package websocket

import (
	"context"
	"sync"
	"time"

	"radar_go/internal/models"
	"radar_go/pkg/logger"
)

// Hub gerencia todas as conexões WebSocket e distribuição de mensagens
type Hub struct {
	// Clientes registrados
	clients map[*Client]bool

	// Canal para registrar clientes
	register chan *Client

	// Canal para desregistrar clientes
	unregister chan *Client

	// Canal para mensagens de broadcast
	broadcast chan []byte

	// Comando recebido dos clientes
	commands chan models.ClientCommand

	// Mutex para operações concorrentes no mapa de clientes
	mu sync.RWMutex

	// Última métrica enviada (para evitar duplicação)
	lastMetrics     *models.RadarMetrics
	lastMetricsTime time.Time
	metricsLock     sync.RWMutex

	// Estatísticas
	stats struct {
		totalMessages      int64
		totalClients       int64
		messagesPerSecond  float64
		lastStatsReset     time.Time
		messagesSinceReset int64
	}
	statsLock sync.Mutex

	// Sinal para encerramento do hub
	ctx    context.Context
	cancel context.CancelFunc
}

// NewHub cria uma nova instância do Hub
func NewHub() *Hub {
	ctx, cancel := context.WithCancel(context.Background())

	h := &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte, 256), // Buffer aumentado para evitar bloqueios
		commands:   make(chan models.ClientCommand, 100),
		ctx:        ctx,
		cancel:     cancel,
	}

	h.stats.lastStatsReset = time.Now()

	return h
}

// Run inicia o loop principal do hub para gerenciar clientes e mensagens
func (h *Hub) Run() {
	logger.Info("Iniciando WebSocket Hub")

	// Ticker para estatísticas periódicas
	statsTicker := time.NewTicker(30 * time.Second)
	defer statsTicker.Stop()

	// Ticker para limpar buffers de clientes inativos
	cleanupTicker := time.NewTicker(5 * time.Second)
	defer cleanupTicker.Stop()

	for {
		select {
		case <-h.ctx.Done():
			// Contexto cancelado, encerrar o hub
			logger.Info("Encerrando WebSocket Hub")
			h.closeAllClients()
			return

		case client := <-h.register:
			// Registrar novo cliente
			h.mu.Lock()
			h.clients[client] = true
			clientCount := len(h.clients)
			h.mu.Unlock()

			logger.Infof("Novo cliente WebSocket conectado. ID: %s. Total: %d", client.id, clientCount)

			// Atualizar estatísticas
			h.statsLock.Lock()
			h.stats.totalClients++
			h.statsLock.Unlock()

			// Enviar dados iniciais para o cliente
			go h.sendInitialDataToClient(client)

		case client := <-h.unregister:
			// Desregistrar cliente
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)

				logger.Infof("Cliente WebSocket desconectado. ID: %s. Total: %d", client.id, len(h.clients))
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			// Enviar mensagem para todos os clientes
			h.mu.RLock()
			clientCount := len(h.clients)

			// Atualizar estatísticas
			h.statsLock.Lock()
			h.stats.totalMessages++
			h.stats.messagesSinceReset++
			h.statsLock.Unlock()

			if clientCount == 0 {
				h.mu.RUnlock()
				continue // Nenhum cliente conectado, pular broadcast
			}

			// Broadcast otimizado
			deadClients := make([]*Client, 0, 4) // Pré-alocar para alguns clientes mortos

			for client := range h.clients {
				select {
				case client.send <- message:
					// Mensagem enviada com sucesso
				default:
					// Canal do cliente está cheio, marcar para desconexão
					deadClients = append(deadClients, client)
				}
			}
			h.mu.RUnlock()

			// Lidar com clientes mortos fora do lock para evitar contenção
			for _, client := range deadClients {
				h.unregister <- client
			}

		case cmd := <-h.commands:
			// Processar comando de um cliente
			go h.handleClientCommand(cmd)

		case <-statsTicker.C:
			// Calcular taxa de mensagens por segundo
			h.statsLock.Lock()
			elapsed := time.Since(h.stats.lastStatsReset).Seconds()
			if elapsed > 0 {
				h.stats.messagesPerSecond = float64(h.stats.messagesSinceReset) / elapsed
			}

			// Resetar contador para próximo cálculo
			h.stats.messagesSinceReset = 0
			h.stats.lastStatsReset = time.Now()

			// Obter estatísticas para log
			mps := h.stats.messagesPerSecond
			total := h.stats.totalMessages
			h.statsLock.Unlock()

			// Obter número de clientes
			h.mu.RLock()
			clientCount := len(h.clients)
			h.mu.RUnlock()

			logger.Infof("Estatísticas WebSocket: %d clientes, %.2f msgs/seg, total: %d mensagens",
				clientCount, mps, total)

		case <-cleanupTicker.C:
			// Enviar ping para todos os clientes para manter conexões ativas
			h.sendPingToAllClients()
		}
	}
}

// BroadcastMetrics envia métricas do radar para todos os clientes
func (h *Hub) BroadcastMetrics(metrics models.RadarMetrics) {
	// Verificar se devemos limitar a taxa de envio
	h.metricsLock.Lock()

	// Se a última métrica foi enviada há menos de 50ms, ignorar
	// exceto se houver mudanças significativas
	shouldSend := true
	if h.lastMetrics != nil {
		timeSinceLastSend := time.Since(h.lastMetricsTime)

		if timeSinceLastSend < 50*time.Millisecond {
			// Verificar se há alguma mudança significativa nas velocidades
			significantChange := false

			for i := 0; i < 7; i++ {
				// Considerar mudança de 0.05 m/s como significativa
				if abs(metrics.Velocities[i]-h.lastMetrics.Velocities[i]) > 0.05 {
					significantChange = true
					break
				}
			}

			// Se não houver mudança significativa, ignorar esta atualização
			if !significantChange {
				shouldSend = false
			}
		}
	}

	// Atualizar última métrica enviada
	h.lastMetrics = &metrics
	h.lastMetricsTime = time.Now()
	h.metricsLock.Unlock()

	if !shouldSend {
		return
	}

	// Criar mensagem
	message := models.MetricsMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "metrics",
			Timestamp: time.Now(),
		},
		Positions:  metrics.Positions,
		Velocities: metrics.Velocities,
		Status:     metrics.Status,
	}

	// Serializar e enviar a mensagem
	if jsonMessage, err := SerializeMessage(message); err == nil {
		h.broadcast <- jsonMessage
	} else {
		logger.Error("Erro ao serializar mensagem de métricas", err)
	}
}

// BroadcastVelocityChanges envia mudanças de velocidade para todos os clientes
func (h *Hub) BroadcastVelocityChanges(changes []models.VelocityChange) {
	if len(changes) == 0 {
		return
	}

	message := models.VelocityChangeMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "velocity_changes",
			Timestamp: time.Now(),
		},
		Changes: changes,
	}

	// Serializar e enviar a mensagem
	if jsonMessage, err := SerializeMessage(message); err == nil {
		h.broadcast <- jsonMessage
	} else {
		logger.Error("Erro ao serializar mensagem de mudanças de velocidade", err)
	}
}

// BroadcastStatus envia atualização de status para todos os clientes
func (h *Hub) BroadcastStatus(status models.RadarStatus) {
	message := models.StatusMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "status",
			Timestamp: time.Now(),
		},
		Status:     status.Status,
		LastError:  status.LastError,
		ErrorCount: status.ErrorCount,
	}

	// Serializar e enviar a mensagem
	if jsonMessage, err := SerializeMessage(message); err == nil {
		h.broadcast <- jsonMessage
	} else {
		logger.Error("Erro ao serializar mensagem de status", err)
	}
}

// handleClientCommand processa comandos recebidos dos clientes
func (h *Hub) handleClientCommand(cmd models.ClientCommand) {
	logger.Infof("Comando recebido do cliente %s: %s", cmd.ClientID, cmd.Command)

	switch cmd.Command {
	case "get_history":
		if params, ok := cmd.Params.(map[string]interface{}); ok {
			if indexFloat, ok := params["index"].(float64); ok {
				index := int(indexFloat)
				h.sendVelocityHistory(cmd.ClientID, index)
			}
		}
	case "get_status":
		h.sendCurrentStatus(cmd.ClientID)
	case "ping":
		h.sendPong(cmd.ClientID, cmd.Params)
	default:
		logger.Warnf("Comando desconhecido: %s", cmd.Command)
	}
}

// sendVelocityHistory envia histórico de velocidade para um cliente específico
func (h *Hub) sendVelocityHistory(clientID string, index int) {
	// Implementar integração com o Redis para obter histórico
	// e enviar apenas para o cliente solicitante
}

// sendCurrentStatus envia status atual para um cliente específico
func (h *Hub) sendCurrentStatus(clientID string) {
	// Implementar integração com o serviço de radar para obter status atual
	// e enviar apenas para o cliente solicitante
}

// sendPong envia resposta de pong para um cliente específico
func (h *Hub) sendPong(clientID string, params interface{}) {
	client := h.getClientByID(clientID)
	if client == nil {
		return
	}

	// Extrair timestamp do ping
	var pingTime int64
	if paramsMap, ok := params.(map[string]interface{}); ok {
		if timeVal, ok := paramsMap["time"].(float64); ok {
			pingTime = int64(timeVal)
		}
	}

	// Criar mensagem de pong
	pong := models.PongMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "pong",
			Timestamp: time.Now(),
		},
		Time:       pingTime,
		ServerTime: time.Now().UnixNano() / int64(time.Millisecond),
	}

	// Serializar e enviar apenas para o cliente solicitante
	if jsonMsg, err := SerializeMessage(pong); err == nil {
		client.send <- jsonMsg
	}
}

// sendInitialDataToClient envia dados iniciais para um novo cliente
func (h *Hub) sendInitialDataToClient(client *Client) {
	// Implementar lógica para enviar dados iniciais, como:
	// - Status atual
	// - Métricas atuais

	// Enviar mensagem de boas-vindas
	welcome := models.WebSocketMessage{
		Type:      "welcome",
		Timestamp: time.Now(),
		Data: map[string]interface{}{
			"message":  "Conectado ao servidor SICK Radar Monitor",
			"clientId": client.id,
		},
	}

	if jsonMsg, err := SerializeMessage(welcome); err == nil {
		client.send <- jsonMsg
	}
}

// Shutdown encerra graciosamente o hub
func (h *Hub) Shutdown() {
	h.cancel()
	// Aguardar um pequeno tempo para processamento finalizar
	time.Sleep(100 * time.Millisecond)
}

// closeAllClients fecha todas as conexões dos clientes
func (h *Hub) closeAllClients() {
	h.mu.Lock()
	defer h.mu.Unlock()

	logger.Info("Fechando todas as conexões de clientes WebSocket")
	for client := range h.clients {
		close(client.send)
		delete(h.clients, client)
	}
}

// ClientCount retorna o número atual de clientes conectados
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// getClientByID retorna um cliente pelo seu ID
func (h *Hub) getClientByID(clientID string) *Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		if client.id == clientID {
			return client
		}
	}
	return nil
}

// sendPingToAllClients envia ping para todos os clientes
func (h *Hub) sendPingToAllClients() {
	ping := models.PingMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "ping",
			Timestamp: time.Now(),
		},
		Time: time.Now().UnixNano() / int64(time.Millisecond),
	}

	if jsonMsg, err := SerializeMessage(ping); err == nil {
		h.mu.RLock()
		if len(h.clients) > 0 {
			h.broadcast <- jsonMsg
		}
		h.mu.RUnlock()
	}
}

// abs retorna o valor absoluto de um float64
func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}
