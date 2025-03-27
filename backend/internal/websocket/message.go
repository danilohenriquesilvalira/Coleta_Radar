package websocket

import (
	"encoding/json"
	"time"

	"radar_go/internal/models"
)

// Funções utilitárias para criação e processamento de mensagens WebSocket

// NewMetricsMessage cria uma nova mensagem de métricas
func NewMetricsMessage(metrics models.RadarMetrics) *models.MetricsMessage {
	return &models.MetricsMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "metrics",
			Timestamp: time.Now(),
		},
		Positions:  metrics.Positions,
		Velocities: metrics.Velocities,
		Status:     metrics.Status,
	}
}

// NewStatusMessage cria uma nova mensagem de status
func NewStatusMessage(status models.RadarStatus) *models.StatusMessage {
	return &models.StatusMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "status",
			Timestamp: time.Now(),
		},
		Status:     status.Status,
		LastError:  status.LastError,
		ErrorCount: status.ErrorCount,
	}
}

// NewVelocityChangeMessage cria uma nova mensagem de mudanças de velocidade
func NewVelocityChangeMessage(changes []models.VelocityChange) *models.VelocityChangeMessage {
	return &models.VelocityChangeMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "velocity_changes",
			Timestamp: time.Now(),
		},
		Changes: changes,
	}
}

// NewHistoryMessage cria uma nova mensagem com histórico de velocidade
func NewHistoryMessage(index int, history []models.HistoryPoint) *models.HistoryMessage {
	return &models.HistoryMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "velocity_history",
			Timestamp: time.Now(),
		},
		Index:   index,
		History: history,
	}
}

// NewErrorMessage cria uma nova mensagem de erro
func NewErrorMessage(message string, errorCode string) models.WebSocketMessage {
	return models.WebSocketMessage{
		Type:      "error",
		Timestamp: time.Now(),
		Error:     message,
		Data: map[string]string{
			"code": errorCode,
		},
	}
}

// SerializeMessage serializa uma mensagem para JSON
func SerializeMessage(message interface{}) ([]byte, error) {
	return json.Marshal(message)
}

// ParseClientCommand analisa um comando recebido do cliente
func ParseClientCommand(data []byte) (models.CommandMessage, error) {
	var command models.CommandMessage
	err := json.Unmarshal(data, &command)
	return command, err
}

// CreatePongResponse cria uma resposta para um ping do cliente
func CreatePongResponse(pingTime int64) *models.PongMessage {
	return &models.PongMessage{
		WebSocketMessage: models.WebSocketMessage{
			Type:      "pong",
			Timestamp: time.Now(),
		},
		Time:       pingTime,
		ServerTime: time.Now().UnixNano() / int64(time.Millisecond),
	}
}
