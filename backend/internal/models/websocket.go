package models

import "time"

// WebSocketMessage representa a estrutura base de todas as mensagens WebSocket
type WebSocketMessage struct {
	Type      string      `json:"type"`            // Tipo da mensagem: "metrics", "status", "velocity_changes", etc.
	Timestamp time.Time   `json:"timestamp"`       // Timestamp da mensagem
	Data      interface{} `json:"data,omitempty"`  // Dados adicionais específicos do tipo
	Error     string      `json:"error,omitempty"` // Mensagem de erro, se houver
}

// MetricsMessage é uma mensagem específica para métricas do radar
type MetricsMessage struct {
	WebSocketMessage
	Positions  [7]float64 `json:"positions"`
	Velocities [7]float64 `json:"velocities"`
	Status     string     `json:"status"`
}

// VelocityChangeMessage é uma mensagem específica para mudanças de velocidade
type VelocityChangeMessage struct {
	WebSocketMessage
	Changes []VelocityChange `json:"changes"`
}

// StatusMessage é uma mensagem específica para atualizações de status
type StatusMessage struct {
	WebSocketMessage
	Status     string `json:"status"`
	LastError  string `json:"lastError,omitempty"`
	ErrorCount int    `json:"errorCount,omitempty"`
}

// HistoryMessage é uma mensagem específica para histórico de velocidade
type HistoryMessage struct {
	WebSocketMessage
	Index   int            `json:"index"`
	History []HistoryPoint `json:"history"`
}

// CommandMessage é uma mensagem de comando do cliente para o servidor
type CommandMessage struct {
	Type   string      `json:"type"`             // Tipo de comando: "get_history", "get_status", etc.
	Params interface{} `json:"params,omitempty"` // Parâmetros adicionais
	ID     string      `json:"id,omitempty"`     // ID opcional para correlacionar solicitações/respostas
}

// ClientCommand representa um comando enviado pelo cliente
type ClientCommand struct {
	Command  string      `json:"command"`
	Params   interface{} `json:"params,omitempty"`
	ClientID string      `json:"-"` // Usado internamente, não enviado no JSON
}

// PingMessage representa um ping enviado pelo cliente
type PingMessage struct {
	WebSocketMessage
	Time int64 `json:"time"` // Timestamp em milissegundos
}

// PongMessage representa um pong enviado pelo servidor
type PongMessage struct {
	WebSocketMessage
	Time       int64 `json:"time"`       // Timestamp original do ping
	ServerTime int64 `json:"serverTime"` // Timestamp do servidor em milissegundos
}
