package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"radar_go/internal/models"
	"radar_go/internal/radar"
	"radar_go/internal/redis"
	"radar_go/pkg/logger"
)

// Handler contém os handlers HTTP para a API
type Handler struct {
	radarService *radar.Service
	redisService *redis.Service
}

// NewHandler cria um novo handler de API
func NewHandler(radarService *radar.Service, redisService *redis.Service) *Handler {
	return &Handler{
		radarService: radarService,
		redisService: redisService,
	}
}

// GetStatus retorna o status atual do radar
func (h *Handler) GetStatus(w http.ResponseWriter, r *http.Request) {
	// Verificar método HTTP
	if r.Method != http.MethodGet {
		h.respondWithError(w, http.StatusMethodNotAllowed, "Método não permitido")
		return
	}

	var status models.RadarStatus

	// Se o Redis estiver disponível, tentar obter status de lá
	if h.redisService != nil && h.redisService.IsConnected() {
		redisStatus, err := h.redisService.GetStatus()
		if err == nil && redisStatus != nil {
			status = *redisStatus
		} else {
			// Fallback para o serviço do radar
			status = h.radarService.GetStatus()
		}
	} else {
		// Usar serviço do radar diretamente
		status = h.radarService.GetStatus()
	}

	// Formatar resposta
	response := map[string]interface{}{
		"status":    status.Status,
		"timestamp": status.Timestamp.UnixNano() / int64(time.Millisecond),
	}

	// Adicionar informações de erro, se houver
	if status.LastError != "" {
		response["lastError"] = status.LastError
	}
	if status.ErrorCount > 0 {
		response["errorCount"] = status.ErrorCount
	}

	h.respondWithJSON(w, http.StatusOK, response)
}

// GetCurrentData retorna os dados atuais do radar
func (h *Handler) GetCurrentData(w http.ResponseWriter, r *http.Request) {
	// Verificar método HTTP
	if r.Method != http.MethodGet {
		h.respondWithError(w, http.StatusMethodNotAllowed, "Método não permitido")
		return
	}

	var metrics *models.RadarMetrics

	// Se o Redis estiver disponível, tentar obter métricas de lá
	if h.redisService != nil && h.redisService.IsConnected() {
		redisMetrics, err := h.redisService.GetCurrentData()
		if err == nil && redisMetrics != nil {
			metrics = redisMetrics
		} else {
			// Fallback para o serviço do radar
			metrics = h.radarService.GetLastMetrics()
		}
	} else {
		// Usar serviço do radar diretamente
		metrics = h.radarService.GetLastMetrics()
	}

	// Verificar se temos métricas disponíveis
	if metrics == nil {
		h.respondWithError(w, http.StatusNotFound, "Nenhum dado disponível")
		return
	}

	// Formatar resposta
	response := map[string]interface{}{
		"positions":  metrics.Positions,
		"velocities": metrics.Velocities,
		"timestamp":  metrics.Timestamp.UnixNano() / int64(time.Millisecond),
		"status":     metrics.Status,
	}

	h.respondWithJSON(w, http.StatusOK, response)
}

// GetVelocityChanges retorna as mudanças recentes de velocidade
func (h *Handler) GetVelocityChanges(w http.ResponseWriter, r *http.Request) {
	// Verificar método HTTP
	if r.Method != http.MethodGet {
		h.respondWithError(w, http.StatusMethodNotAllowed, "Método não permitido")
		return
	}

	var changes []models.VelocityChange

	// Se o Redis estiver disponível, obter mudanças de lá
	if h.redisService != nil && h.redisService.IsConnected() {
		redisChanges, err := h.redisService.GetVelocityChanges()
		if err == nil {
			changes = redisChanges
		}
	}

	// Se não houver mudanças, responder com array vazio
	if changes == nil {
		changes = []models.VelocityChange{}
	}

	h.respondWithJSON(w, http.StatusOK, changes)
}

// GetVelocityHistory retorna o histórico de uma velocidade específica
func (h *Handler) GetVelocityHistory(w http.ResponseWriter, r *http.Request) {
	// Verificar método HTTP
	if r.Method != http.MethodGet {
		h.respondWithError(w, http.StatusMethodNotAllowed, "Método não permitido")
		return
	}

	// Extrair índice da URL
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 4 {
		h.respondWithError(w, http.StatusBadRequest, "Índice de velocidade não fornecido")
		return
	}

	indexStr := parts[len(parts)-1]
	index, err := strconv.Atoi(indexStr)
	if err != nil || index < 1 || index > 7 {
		h.respondWithError(w, http.StatusBadRequest, "Índice de velocidade inválido. Deve ser entre 1 e 7.")
		return
	}

	var history []models.HistoryPoint

	// Se o Redis estiver disponível, obter histórico de lá
	if h.redisService != nil && h.redisService.IsConnected() {
		redisHistory, err := h.redisService.GetVelocityHistory(index)
		if err == nil {
			history = redisHistory
		}
	}

	// Se não houver histórico, responder com array vazio
	if history == nil {
		history = []models.HistoryPoint{}
	}

	h.respondWithJSON(w, http.StatusOK, history)
}

// GetLatestUpdate retorna a última atualização
func (h *Handler) GetLatestUpdate(w http.ResponseWriter, r *http.Request) {
	// Verificar método HTTP
	if r.Method != http.MethodGet {
		h.respondWithError(w, http.StatusMethodNotAllowed, "Método não permitido")
		return
	}

	metrics := h.radarService.GetLastMetrics()
	if metrics == nil {
		h.respondWithError(w, http.StatusNotFound, "Nenhum dado disponível")
		return
	}

	// Formatar resposta
	response := map[string]interface{}{
		"timestamp": metrics.Timestamp.UnixNano() / int64(time.Millisecond),
		"changes":   metrics.VelocityChanges,
	}

	h.respondWithJSON(w, http.StatusOK, response)
}

// respondWithError responde com erro em formato JSON
func (h *Handler) respondWithError(w http.ResponseWriter, code int, message string) {
	h.respondWithJSON(w, code, map[string]string{"error": message})
}

// respondWithJSON responde com JSON
func (h *Handler) respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)

	if err := json.NewEncoder(w).Encode(payload); err != nil {
		logger.Errorf("Erro ao codificar resposta JSON: %v", err)
		// Se falhar ao codificar JSON, tentar responder com erro simples
		fmt.Fprintf(w, `{"error":"Erro interno ao processar resposta"}`)
	}
}
