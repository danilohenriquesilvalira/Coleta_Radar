package server

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"radar_go/internal/config"
	"radar_go/internal/discovery"
	"radar_go/internal/plc"
	"radar_go/internal/radar"
	"radar_go/internal/redis"
	"radar_go/internal/websocket"
	"radar_go/pkg/logger"
)

// Server encapsula o servidor HTTP com todos os componentes
type Server struct {
	config           *config.Config
	httpServer       *http.Server
	router           *http.ServeMux
	radarService     *radar.Service
	redisService     *redis.Service
	plcService       *plc.PLCService
	wsHub            *websocket.Hub
	discoveryService *discovery.DiscoveryService
	serverInfo       ServerInfo
}

// ServerInfo contém informações sobre o servidor
type ServerInfo struct {
	IP           string
	Port         int
	StartTime    time.Time
	Connections  int
	Version      string
	WebSocketURL string
	APIURL       string
}

// NewServer cria uma nova instância do servidor
func NewServer(cfg *config.Config) (*Server, error) {
	// Criar instância do servidor
	server := &Server{
		config: cfg,
		router: http.NewServeMux(),
		serverInfo: ServerInfo{
			StartTime: time.Now(),
			Version:   "1.0.0",
			Port:      cfg.Server.Port,
		},
	}

	// Determinar IP do servidor
	ip, err := server.getLocalIP()
	if err != nil {
		return nil, fmt.Errorf("erro ao obter IP local: %w", err)
	}
	server.serverInfo.IP = ip

	// Configurar URLs
	server.serverInfo.WebSocketURL = fmt.Sprintf("ws://%s:%d/ws", ip, cfg.Server.Port)
	server.serverInfo.APIURL = fmt.Sprintf("http://%s:%d/api", ip, cfg.Server.Port)

	// Inicializar componentes
	if err := server.initComponents(); err != nil {
		return nil, err
	}

	// Configurar rotas
	server.setupRoutes()

	// Configurar servidor HTTP
	server.httpServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:      server.router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  120 * time.Second,
	}

	return server, nil
}

// initComponents inicializa todos os componentes do servidor
func (s *Server) initComponents() error {
	// Inicializar hub WebSocket
	s.wsHub = websocket.NewHub()
	go s.wsHub.Run()

	// Inicializar serviço Redis
	redisService, err := redis.NewService(s.config.Redis)
	if err != nil {
		return fmt.Errorf("erro ao inicializar serviço Redis: %w", err)
	}
	s.redisService = redisService

	// Inicializar serviço do Radar
	radarService, err := radar.NewService(s.config.Radar, s.redisService, s.wsHub)
	if err != nil {
		return fmt.Errorf("erro ao inicializar serviço do Radar: %w", err)
	}
	s.radarService = radarService

	// Inicializar serviço do PLC (se habilitado)
	if s.config.PLC.Enabled {
		s.plcService = plc.NewPLCService(s.config.PLC)

		// Registrar serviço PLC para receber atualizações do radar
		s.radarService.RegisterMetricsHandler(s.plcService.UpdateMetrics)
	}

	// Inicializar serviço de descoberta
	s.discoveryService = discovery.NewDiscoveryService(s.config.Server.Port)

	return nil
}

// Start inicia o servidor e todos os serviços
func (s *Server) Start() error {
	// Iniciar serviço de descoberta
	if err := s.discoveryService.Start(); err != nil {
		logger.Warnf("Erro ao iniciar serviço de descoberta: %v", err)
		// Não abortar operação se falhar
	}

	// Iniciar serviço do Radar
	if err := s.radarService.Start(); err != nil {
		return fmt.Errorf("erro ao iniciar serviço do Radar: %w", err)
	}

	// Iniciar serviço do PLC (se habilitado)
	if s.config.PLC.Enabled && s.plcService != nil {
		if err := s.plcService.Start(); err != nil {
			logger.Errorf("Erro ao iniciar serviço PLC: %v", err)
			// Não abortar se o PLC falhar
		}
	}

	// Mostrar informações do servidor
	s.logServerInfo()

	// Iniciar servidor HTTP
	logger.Infof("Iniciando servidor HTTP na porta %d", s.config.Server.Port)
	if err := s.httpServer.ListenAndServe(); err != http.ErrServerClosed {
		return fmt.Errorf("erro ao iniciar servidor HTTP: %w", err)
	}

	return nil
}

// Shutdown encerra graciosamente o servidor e todos os serviços
func (s *Server) Shutdown(ctx context.Context) error {
	logger.Info("Iniciando shutdown do servidor")

	// Encerrar o servidor HTTP
	if err := s.httpServer.Shutdown(ctx); err != nil {
		logger.Errorf("Erro ao encerrar servidor HTTP: %v", err)
	}

	// Encerrar serviço de descoberta
	if s.discoveryService != nil {
		s.discoveryService.Stop()
	}

	// Encerrar serviços
	if s.radarService != nil {
		s.radarService.Stop()
	}

	if s.plcService != nil {
		s.plcService.Shutdown()
	}

	if s.wsHub != nil {
		s.wsHub.Shutdown()
	}

	if s.redisService != nil {
		s.redisService.Shutdown()
	}

	logger.Info("Shutdown completo")
	return nil
}

// getLocalIP obtém o endereço IP local
func (s *Server) getLocalIP() (string, error) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "", err
	}

	for _, addr := range addrs {
		// Verificar se é um endereço IP
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				return ipnet.IP.String(), nil
			}
		}
	}

	return "localhost", nil
}

// GetServerInfo retorna informações sobre o servidor
func (s *Server) GetServerInfo() ServerInfo {
	info := s.serverInfo
	info.Connections = s.wsHub.ClientCount()
	return info
}

// logServerInfo exibe informações do servidor no log
func (s *Server) logServerInfo() {
	logger.Info("===============================================")
	logger.Info("            SICK Radar Monitor Server          ")
	logger.Info("===============================================")
	logger.Infof("Versão: %s", s.serverInfo.Version)
	logger.Infof("Endereço IP: %s", s.serverInfo.IP)
	logger.Infof("Porta HTTP: %d", s.serverInfo.Port)
	logger.Infof("WebSocket URL: %s", s.serverInfo.WebSocketURL)
	logger.Infof("API URL: %s", s.serverInfo.APIURL)
	logger.Infof("mDNS: %s.%s.%s",
		s.discoveryService.GetInstanceName(),
		discovery.ServiceType,
		discovery.ServiceDomain)
	logger.Info("===============================================")
	logger.Info("Servidor pronto para conexões!")
}
