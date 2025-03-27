package websocket

import (
	"encoding/json"
	"net/http"
	"time"

	"radar_go/pkg/logger"

	"github.com/gorilla/websocket"
)

const (
	// Tamanho máximo de mensagem permitido do cliente
	maxWebSocketMessageSize = 512 * 1024 // 512KB
)

// Upgrader específico para WebSocket com configurações de segurança
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// CheckOrigin: Permite personalizar verificação de origem
	CheckOrigin: checkOrigin,
}

// Handler gerencia conexões WebSocket
type Handler struct {
	hub *Hub
}

// NewHandler cria um novo gerenciador de WebSocket
func NewHandler(hub *Hub) *Handler {
	return &Handler{
		hub: hub,
	}
}

// ServeHTTP implementa a interface http.Handler
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.HandleWebSocket(w, r)
}

// HandleWebSocket gerencia requisições WebSocket
func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Atualizar configurações do upgrader
	upgrader.ReadBufferSize = 1024
	upgrader.WriteBufferSize = 1024

	// Fazer upgrade da conexão HTTP para WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Errorf("Erro ao fazer upgrade para WebSocket: %v", err)
		return
	}

	// Configurar limites de tamanho de mensagem
	conn.SetReadLimit(maxWebSocketMessageSize)

	// Obter informações do cliente
	userAgent := r.UserAgent()
	ipAddress := getIPAddress(r)

	logger.Infof("Nova conexão WebSocket de %s (%s)", ipAddress, userAgent)

	// Criar cliente
	client := newClient(h.hub, conn, userAgent, ipAddress)

	// Registrar cliente no hub
	h.hub.register <- client

	// Iniciar goroutines de leitura e escrita
	go client.writePump()
	go client.readPump()
}

// checkOrigin verifica a origem da requisição WebSocket
func checkOrigin(r *http.Request) bool {
	// Por padrão, aceita todas as origens
	// Em produção, você pode querer restringir com base no cabeçalho Origin
	// origin := r.Header.Get("Origin")
	// return isAllowedOrigin(origin)
	return true
}

// getIPAddress extrai o endereço IP do cliente
func getIPAddress(r *http.Request) string {
	// Tentar obter o IP real caso esteja atrás de proxy
	ipAddress := r.Header.Get("X-Real-IP")
	if ipAddress == "" {
		ipAddress = r.Header.Get("X-Forwarded-For")
	}
	if ipAddress == "" {
		ipAddress = r.RemoteAddr
	}
	return ipAddress
}

// GetHealthHandler retorna um handler para verificação de saúde do WebSocket
func (h *Handler) GetHealthHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		// Preparar resposta de status
		status := struct {
			Status    string    `json:"status"`
			Clients   int       `json:"clients"`
			Timestamp time.Time `json:"timestamp"`
		}{
			Status:    "ok",
			Clients:   h.hub.ClientCount(),
			Timestamp: time.Now(),
		}

		// Escrever resposta
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(status)
	}
}
