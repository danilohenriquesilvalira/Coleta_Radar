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

	// Sinal para encerramento do hub
	ctx    context.Context
	cancel context.CancelFunc
}

// NewHub cria uma nova instância do Hub
func NewHub() *Hub {
	ctx, cancel := context.WithCancel(context.Background())

	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte),
		commands:   make(chan models.ClientCommand),
		ctx:        ctx,
		cancel:     cancel,
	}
}

// Run inicia o loop principal do hub para gerenciar clientes e mensagens
func (h *Hub) Run() {
	logger.Info("Iniciando WebSocket Hub")

	// Ticker para estatísticas periódicas
	statsTicker := time.NewTicker(1 * time.Minute)
	defer statsTicker.Stop()

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
			h.mu.Unlock()
			logger.Infof("Novo cliente WebSocket conectado. ID: %s. Total: %d", client.id, len(h.clients))

			// Enviar dados iniciais para o cliente
			go h.sendInitialDataToClient(client)

		case client := <-h.unregister:
			// Desregistrar cliente
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			logger.Infof("Cliente WebSocket desconectado. ID: %s. Total: %d", client.id, len(h.clients))

		case message := <-h.broadcast:
			// Enviar mensagem para todos os clientes
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
					// Mensagem enviada com sucesso
				default:
					// Canal do cliente está cheio, desconectar cliente
					h.mu.RUnlock()
					h.unregister <- client
					h.mu.RLock()
				}
			}
			h.mu.RUnlock()

		case cmd := <-h.commands:
			// Processar comando de um cliente
			go h.handleClientCommand(cmd)

		case <-statsTicker.C:
			// Exibir estatísticas periódicas
			h.mu.RLock()
			clientCount := len(h.clients)
			h.mu.RUnlock()
			logger.Infof("Estatísticas WebSocket: %d clientes conectados", clientCount)
		}
	}
}

// BroadcastMetrics envia métricas do radar para todos os clientes
func (h *Hub) BroadcastMetrics(metrics models.RadarMetrics) {
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
	if jsonMessage, err := serializeMessage(message); err == nil {
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
	if jsonMessage, err := serializeMessage(message); err == nil {
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
	if jsonMessage, err := serializeMessage(message); err == nil {
		h.broadcast <- jsonMessage
	} else {
		logger.Error("Erro ao serializar mensagem de status", err)
	}
}

// handleClientCommand processa comandos recebidos dos clientes
func (h *Hub) handleClientCommand(cmd models.ClientCommand) {
	logger.Infof("Comando recebido do cliente %s: %s", cmd.ClientID, cmd.Command)

	// Implementar lógica para processar comandos específicos
	// Por exemplo: "get_history", "get_status", etc.
}

// sendInitialDataToClient envia dados iniciais para um novo cliente
func (h *Hub) sendInitialDataToClient(client *Client) {
	// Implementar lógica para enviar dados iniciais, como:
	// - Status atual
	// - Métricas atuais
	// - etc.
}

// Shutdown encerra graciosamente o hub
func (h *Hub) Shutdown() {
	h.cancel()
}

// closeAllClients fecha todas as conexões dos clientes
func (h *Hub) closeAllClients() {
	h.mu.Lock()
	defer h.mu.Unlock()

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
