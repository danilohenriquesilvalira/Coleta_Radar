package models

import "time"

// RadarMetrics armazena as métricas decodificadas do radar
type RadarMetrics struct {
	Positions       [7]float64       `json:"positions"`
	Velocities      [7]float64       `json:"velocities"`
	LastVelocities  [7]float64       `json:"-"` // Para rastrear mudanças, não exportado para JSON
	Timestamp       time.Time        `json:"timestamp"`
	Status          string           `json:"status"`
	VelocityChanges []VelocityChange `json:"velocityChanges,omitempty"` // Registra quais velocidades mudaram
}

// VelocityChange representa uma mudança específica em uma velocidade
type VelocityChange struct {
	Index       int       `json:"index"`        // Índice da velocidade (0-6)
	OldValue    float64   `json:"old_value"`    // Valor anterior
	NewValue    float64   `json:"new_value"`    // Valor novo
	ChangeValue float64   `json:"change_value"` // Diferença
	Timestamp   time.Time `json:"timestamp"`    // Momento da mudança
}

// RadarStatus representa o status atual do radar
type RadarStatus struct {
	Status         string    `json:"status"`
	Timestamp      time.Time `json:"timestamp"`
	LastError      string    `json:"lastError,omitempty"`
	ErrorCount     int       `json:"errorCount,omitempty"`
	ConnectionInfo string    `json:"connectionInfo,omitempty"`
}

// HistoryPoint representa um ponto de histórico para uma velocidade ou posição
type HistoryPoint struct {
	Value     float64   `json:"value"`
	Timestamp time.Time `json:"timestamp"`
}

// RadarCommand representa um comando a ser enviado para o radar
type RadarCommand struct {
	Command string `json:"command"`
	Timeout int    `json:"timeout,omitempty"`
}
