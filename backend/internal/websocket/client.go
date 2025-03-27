package websocket

import (
	"bytes"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"radar_go/internal/models"
	"radar_go/pkg/logger"
)

const (
	// Tempo permitido para escrever uma mensagem para o peer.
	writeWait = 10 * time.Second

	// Tempo permitido para ler a próxima mensagem do peer.
	pongWait = 60 * time.Second

	// Envia pings ao peer com esse intervalo. Deve ser menor que pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Tamanho máximo da mensagem permitido.
	maxMessageSize = 512 * 1024 // 512KB

	// Tamanho do buffer de canal para mensagens de saída.
	sendBufferSize = 256
)

// Client representa uma conexão WebSocket individual
type Client struct {
	hub *Hub

	// Conexão WebSocket.
	conn *websocket.Conn

	// Buffer de mensagens para envio.
	send chan []byte

	// ID único do cliente
	id string

	// Informações do cliente (IP, agente, etc.)
	userAgent string
	ipAddress string

	// Timestamp da conexão
	connectedAt time.Time
}

// newClient cria um novo cliente WebSocket
func newClient(hub *Hub, conn *websocket.Conn, userAgent, ipAddress string) *Client {
	return &Client{
		hub:         hub,
		conn:        conn,
		send:        make(chan []byte, sendBufferSize),
		id:          uuid.New().String(),
		userAgent:   userAgent,
		ipAddress:   ipAddress,
		connectedAt: time.Now(),
	}
}

// readPump bombeia mensagens do WebSocket para o hub.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseGoingAway,
				websocket.CloseAbnormalClosure) {
				logger.Errorf("Erro de leitura WebSocket: %v", err)
			}
			break
		}

		// Processar a mensagem recebida
		c.processIncomingMessage(message)
	}
}

// writePump bombeia mensagens do hub para a conexão WebSocket.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// O hub fechou o canal.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Adicionar mensagens na fila ao escritor atual
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// processIncomingMessage processa uma mensagem recebida do cliente
func (c *Client) processIncomingMessage(message []byte) {
	// Decodificar mensagem JSON
	var cmd models.CommandMessage
	decoder := json.NewDecoder(bytes.NewReader(message))
	decoder.DisallowUnknownFields() // Rejeitar campos desconhecidos

	if err := decoder.Decode(&cmd); err != nil {
		logger.Errorf("Erro ao decodificar mensagem do cliente %s: %v", c.id, err)
		c.sendErrorMessage("invalid_format", "Formato de mensagem inválido")
		return
	}

	// Processar com base no tipo de comando
	switch cmd.Type {
	case "ping":
		// Responder com pong
		c.handlePing(cmd)
	case "get_history":
		// Processar solicitação de histórico
		c.handleGetHistory(cmd)
	case "get_status":
		// Processar solicitação de status
		c.handleGetStatus(cmd)
	default:
		// Encaminhar comando para o hub processar
		c.hub.commands <- models.ClientCommand{
			Command:  cmd.Type,
			Params:   cmd.Params,
			ClientID: c.id,
		}
	}
}

// handlePing processa comandos de ping e envia um pong
func (c *Client) handlePing(cmd models.CommandMessage) {
	var ping models.PingMessage
	if params, ok := cmd.Params.(map[string]interface{}); ok {
		if timeVal, ok := params["time"].(float64); ok {
			ping.Time = int64(timeVal)
		}
	}

	// Responder com pong
	pong := models.PongMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "pong",
			Timestamp: time.Now(),
		},
		Time:       ping.Time,
		ServerTime: time.Now().UnixNano() / int64(time.Millisecond),
	}

	if jsonMsg, err := serializeMessage(pong); err == nil {
		c.send <- jsonMsg
	}
}

// handleGetHistory processa solicitações de histórico
func (c *Client) handleGetHistory(cmd models.CommandMessage) {
	// Implementar lógica para obter e enviar histórico
	var index int
	if params, ok := cmd.Params.(map[string]interface{}); ok {
		if indexVal, ok := params["index"].(float64); ok {
			index = int(indexVal)
		}
	}

	// Encaminhar solicitação para o hub
	c.hub.commands <- models.ClientCommand{
		Command:  "get_history",
		Params:   map[string]interface{}{"index": index, "requestId": cmd.ID},
		ClientID: c.id,
	}
}

// handleGetStatus processa solicitações de status
func (c *Client) handleGetStatus(cmd models.CommandMessage) {
	// Encaminhar solicitação para o hub
	c.hub.commands <- models.ClientCommand{
		Command:  "get_status",
		Params:   map[string]interface{}{"requestId": cmd.ID},
		ClientID: c.id,
	}
}

// sendErrorMessage envia uma mensagem de erro para o cliente
func (c *Client) sendErrorMessage(code string, message string) {
	errorMsg := models.WebSocketMessage{
		Type:      "error",
		Timestamp: time.Now(),
		Error:     message,
		Data:      map[string]string{"code": code},
	}

	if jsonMsg, err := serializeMessage(errorMsg); err == nil {
		c.send <- jsonMsg
	}
}

// serializeMessage serializa uma estrutura para JSON
func serializeMessage(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}
