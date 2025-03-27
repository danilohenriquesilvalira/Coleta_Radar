package server

import (
	"encoding/json"
	"net/http"
	"time"

	"radar_go/internal/api"
	"radar_go/internal/websocket"
	"radar_go/pkg/logger"
)

// setupRoutes configura todas as rotas do servidor
func (s *Server) setupRoutes() {
	// Criar handlers
	wsHandler := websocket.NewHandler(s.wsHub)
	apiHandler := api.NewHandler(s.radarService, s.redisService)

	// Endpoint de saúde
	s.router.HandleFunc("/health", s.healthHandler)

	// Endpoint de informações do servidor
	s.router.HandleFunc("/info", s.infoHandler)

	// Endpoints de descoberta
	s.router.HandleFunc("/api/discover", s.discoverHandler)

	// WebSocket
	s.router.Handle("/ws", wsHandler)
	s.router.HandleFunc("/ws/health", wsHandler.GetHealthHandler())

	// API REST
	s.router.HandleFunc("/api/status", apiHandler.GetStatus)
	s.router.HandleFunc("/api/current", apiHandler.GetCurrentData)
	s.router.HandleFunc("/api/velocity-changes", apiHandler.GetVelocityChanges)
	s.router.HandleFunc("/api/velocity-history/", apiHandler.GetVelocityHistory)
	s.router.HandleFunc("/api/latest-update", apiHandler.GetLatestUpdate)
	s.router.HandleFunc("/api/server-info", s.serverInfoHandler)

	// Static assets (opcional)
	fs := http.FileServer(http.Dir("./static"))
	s.router.Handle("/", fs)

	// Middleware para logging e CORS
	s.wrapWithMiddleware()
}

// healthHandler responde com o status de saúde do servidor
func (s *Server) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Verificar status dos serviços
	radarStatus := "ok"
	if s.radarService != nil && !s.radarService.IsRunning() {
		radarStatus = "offline"
	}

	plcStatus := "disabled"
	if s.config.PLC.Enabled {
		if s.plcService != nil && s.plcService.IsRunning() {
			plcStatus = "ok"
		} else {
			plcStatus = "offline"
		}
	}

	redisStatus := "ok"
	if s.redisService != nil && !s.redisService.IsConnected() {
		redisStatus = "offline"
	}

	discoveryStatus := "ok"
	if s.discoveryService != nil && !s.discoveryService.IsRunning() {
		discoveryStatus = "offline"
	}

	// Construir resposta
	response := map[string]interface{}{
		"status":    "ok",
		"timestamp": time.Now(),
		"services": map[string]string{
			"radar":     radarStatus,
			"redis":     redisStatus,
			"plc":       plcStatus,
			"websocket": "ok",
			"discovery": discoveryStatus,
		},
	}

	// Se algum serviço crítico estiver offline, alterar status geral
	if radarStatus == "offline" || redisStatus == "offline" {
		response["status"] = "degraded"
	}

	// Enviar resposta
	json.NewEncoder(w).Encode(response)
}

// infoHandler retorna informações básicas sobre o servidor
func (s *Server) infoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Obter informações do servidor
	info := s.GetServerInfo()

	// Calcular tempo online
	uptime := time.Since(info.StartTime).Round(time.Second)

	// Construir resposta
	response := map[string]interface{}{
		"name":        "SICK Radar Monitor",
		"version":     info.Version,
		"ip":          info.IP,
		"port":        info.Port,
		"websocket":   info.WebSocketURL,
		"api":         info.APIURL,
		"startTime":   info.StartTime,
		"uptime":      uptime.String(),
		"connections": info.Connections,
	}

	// Enviar resposta
	json.NewEncoder(w).Encode(response)
}

// serverInfoHandler retorna informações completas sobre o servidor
func (s *Server) serverInfoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Obter informações do servidor
	info := s.GetServerInfo()

	// Adicionar informações do serviço de descoberta
	discoveryInfo := map[string]interface{}{
		"enabled":      s.discoveryService != nil,
		"running":      s.discoveryService != nil && s.discoveryService.IsRunning(),
		"instanceName": s.discoveryService.GetInstanceName(),
		"serviceType":  "sick-radar-monitor",
	}

	// Calcular tempo online
	uptime := time.Since(info.StartTime).Round(time.Second)

	// Construir resposta
	response := map[string]interface{}{
		"server": map[string]interface{}{
			"name":        "SICK Radar Monitor",
			"version":     info.Version,
			"ip":          info.IP,
			"port":        info.Port,
			"websocket":   info.WebSocketURL,
			"api":         info.APIURL,
			"startTime":   info.StartTime,
			"uptime":      uptime.String(),
			"connections": info.Connections,
		},
		"discovery": discoveryInfo,
		"services": map[string]interface{}{
			"radar": map[string]interface{}{
				"running": s.radarService != nil && s.radarService.IsRunning(),
				"host":    s.config.Radar.Host,
				"port":    s.config.Radar.Port,
			},
			"redis": map[string]interface{}{
				"enabled":   s.config.Redis.Enabled,
				"connected": s.redisService != nil && s.redisService.IsConnected(),
				"host":      s.config.Redis.Host,
				"port":      s.config.Redis.Port,
			},
			"plc": map[string]interface{}{
				"enabled": s.config.PLC.Enabled,
				"running": s.plcService != nil && s.plcService.IsRunning(),
				"host":    s.config.PLC.Host,
			},
		},
	}

	// Enviar resposta
	json.NewEncoder(w).Encode(response)
}

// discoverHandler fornece informações para descoberta manual
func (s *Server) discoverHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Obter informações do servidor
	info := s.GetServerInfo()

	// Construir resposta
	response := map[string]interface{}{
		"name":        "SICK Radar Monitor",
		"ip":          info.IP,
		"port":        info.Port,
		"wsUrl":       info.WebSocketURL,
		"apiUrl":      info.APIURL,
		"version":     info.Version,
		"wsEndpoint":  "/ws",
		"apiEndpoint": "/api",
	}

	// Enviar resposta
	json.NewEncoder(w).Encode(response)
}

// wrapWithMiddleware adiciona middleware às rotas
func (s *Server) wrapWithMiddleware() {
	originalHandler := s.router

	s.router = http.NewServeMux()

	// Adicionar middleware a todas as rotas
	s.router.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Adicionar cabeçalhos CORS
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		// Se for uma requisição OPTIONS, retornar imediatamente
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		// Logging da requisição
		logger.Infof("%s %s %s", r.Method, r.URL.Path, r.RemoteAddr)

		// Processar requisição pelo handler original
		originalHandler.ServeHTTP(w, r)

		// Logging do tempo de resposta
		duration := time.Since(start)
		logger.Debugf("Requisição %s %s completada em %v", r.Method, r.URL.Path, duration)
	})
}
