package radar

import (
	"context"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"radar_go/internal/config"
	"radar_go/internal/models"
	"radar_go/internal/redis"
	"radar_go/internal/websocket"
	"radar_go/pkg/logger"
)

// MetricsHandler é um tipo de função para lidar com métricas do radar
type MetricsHandler func(metrics models.RadarMetrics)

// Service gerencia a comunicação com o radar SICK
type Service struct {
	client            *RadarClient
	config            config.RadarConfig
	redisService      *redis.Service
	wsHub             *websocket.Hub
	ctx               context.Context
	cancel            context.CancelFunc
	running           bool
	mutex             sync.RWMutex
	status            models.RadarStatus
	lastVelocities    [7]float64
	metricsHandlers   []MetricsHandler
	handlersLock      sync.RWMutex
	consecutiveErrors int
	lastErrorMsg      string
	lastMetrics       *models.RadarMetrics

	// Estatísticas de desempenho
	stats struct {
		totalCycles      int64
		cycleDurations   []time.Duration
		lastCycleTime    time.Time
		cycleStartTime   time.Time
		avgCycleDuration time.Duration
	}
	statsLock sync.Mutex

	// Flags de otimização
	asyncRedis     bool // Flag para envio assíncrono para o Redis
	throttleOutput bool // Flag para limitar saída de log
}

// NewService cria um novo serviço para o radar
func NewService(cfg config.RadarConfig, redisService *redis.Service, wsHub *websocket.Hub) (*Service, error) {
	// Criar contexto cancelável
	ctx, cancel := context.WithCancel(context.Background())

	// Criar cliente do radar
	client := NewRadarClient(cfg.Host, cfg.Port, cfg.Protocol)

	// Criar serviço
	service := &Service{
		client:         client,
		config:         cfg,
		redisService:   redisService,
		wsHub:          wsHub,
		ctx:            ctx,
		cancel:         cancel,
		running:        false,
		asyncRedis:     true, // Ativar por padrão
		throttleOutput: true, // Limitar output de logs por padrão
		status: models.RadarStatus{
			Status:    "initializing",
			Timestamp: time.Now(),
		},
	}

	// Inicializar buffer para durações de ciclo
	service.stats.cycleDurations = make([]time.Duration, 0, 100)
	service.stats.lastCycleTime = time.Now()

	return service, nil
}

// Start inicia o serviço do radar
func (s *Service) Start() error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.running {
		return nil
	}

	logger.Infof("Iniciando serviço do radar (host: %s, porta: %d)", s.config.Host, s.config.Port)

	// Tentar conectar ao radar
	if err := s.client.Connect(); err != nil {
		logger.Warnf("Erro na conexão inicial com o radar: %v. Tentando novamente no ciclo de coleta.", err)
		// Não retornar erro aqui, deixar o loop de coleta tentar reconectar
	}

	// Iniciar goroutine para coletar dados
	go s.collectData()

	// Iniciar goroutine para monitorar estatísticas
	go s.monitorStats()

	s.running = true
	return nil
}

// Stop para o serviço do radar
func (s *Service) Stop() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if !s.running {
		return
	}

	logger.Info("Parando serviço do radar")
	s.cancel()
	s.client.Close()
	s.running = false
}

// IsRunning verifica se o serviço está em execução
func (s *Service) IsRunning() bool {
	s.mutex.RLock()
	defer s.mutex.RUnlock()
	return s.running
}

// RegisterMetricsHandler registra uma função para receber atualizações de métricas
func (s *Service) RegisterMetricsHandler(handler MetricsHandler) {
	s.handlersLock.Lock()
	defer s.handlersLock.Unlock()
	s.metricsHandlers = append(s.metricsHandlers, handler)
}

// GetStatus retorna o status atual do radar
func (s *Service) GetStatus() models.RadarStatus {
	s.mutex.RLock()
	defer s.mutex.RUnlock()
	return s.status
}

// GetLastMetrics retorna as últimas métricas coletadas
func (s *Service) GetLastMetrics() *models.RadarMetrics {
	s.mutex.RLock()
	defer s.mutex.RUnlock()
	return s.lastMetrics
}

// SetAsyncRedis configura o envio assíncrono para o Redis
func (s *Service) SetAsyncRedis(async bool) {
	s.asyncRedis = async
}

// SetThrottleOutput configura a limitação de saída de log
func (s *Service) SetThrottleOutput(throttle bool) {
	s.throttleOutput = throttle
}

// collectData executa o loop principal de coleta de dados do radar
func (s *Service) collectData() {
	ticker := time.NewTicker(s.config.SampleRate)
	defer ticker.Stop()

	cycleCounter := 0

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			// Registrar tempo de início do ciclo
			s.statsLock.Lock()
			s.stats.cycleStartTime = time.Now()
			s.statsLock.Unlock()

			// Processar ciclo
			s.processTick()

			// Registrar duração do ciclo
			cycleDuration := time.Since(s.stats.cycleStartTime)
			s.statsLock.Lock()
			atomic.AddInt64(&s.stats.totalCycles, 1)

			// Registrar duração para cálculo de média
			s.stats.cycleDurations = append(s.stats.cycleDurations, cycleDuration)
			if len(s.stats.cycleDurations) > 100 {
				// Manter apenas as últimas 100 amostras
				s.stats.cycleDurations = s.stats.cycleDurations[1:]
			}

			s.statsLock.Unlock()

			// Log periódico de desempenho
			cycleCounter++
			if cycleCounter%100 == 0 && !s.throttleOutput {
				s.logPerformanceStats()
				cycleCounter = 0
			}
		}
	}
}

// processTick processa um ciclo de coleta de dados
func (s *Service) processTick() {
	// Enviar comando para o radar
	response, err := s.client.SendCommand("sRN LMDradardata")
	if err != nil {
		s.handleConnectionError(err)
		return
	}

	// Resetar contador de erros se comunicação bem sucedida
	if s.consecutiveErrors > 0 {
		logger.Infof("Comunicação com o radar restaurada após %d tentativas", s.consecutiveErrors)
		s.consecutiveErrors = 0
		s.updateStatus("ok", "")
	}

	// Decodificar a resposta
	metrics, err := s.client.DecodeValues(response)
	if err != nil {
		logger.Errorf("Erro ao decodificar valores: %v", err)
		return
	}

	if metrics != nil {
		// Verificar se o radar está obstruído (todas posições zero)
		allZero := true
		for _, pos := range metrics.Positions {
			if pos != 0 {
				allZero = false
				break
			}
		}

		if allZero {
			metrics.Status = "obstruido"
			logger.Warn("ALERTA: Radar possivelmente obstruído - todas as posições são zero!")
		}

		// Detectar mudanças nas velocidades
		s.detectVelocityChanges(metrics)

		// Atualizar métricas internamente
		s.updateMetrics(*metrics)

		// PRIORIDADE 1: Enviar para o WebSocket imediatamente
		if s.wsHub != nil {
			// Broadcast rápido dos dados via WebSocket
			s.wsHub.BroadcastMetrics(*metrics)

			// Se houver mudanças de velocidade, enviar também
			if len(metrics.VelocityChanges) > 0 {
				s.wsHub.BroadcastVelocityChanges(metrics.VelocityChanges)
			}
		}

		// PRIORIDADE 2: Notificar handlers de métricas
		s.notifyMetricsHandlers(*metrics)

		// PRIORIDADE 3: Salvar no Redis (potencialmente assíncrono)
		if s.redisService != nil && s.redisService.IsConnected() {
			if s.asyncRedis {
				// Usar goroutine para não bloquear o ciclo de coleta
				go func(m *models.RadarMetrics) {
					if err := s.redisService.WriteMetrics(m); err != nil {
						logger.Errorf("Erro ao escrever métricas no Redis: %v", err)
					}

					// Se houver mudanças de velocidade, registrar separadamente
					if len(m.VelocityChanges) > 0 {
						if err := s.redisService.WriteVelocityChanges(m.VelocityChanges); err != nil {
							logger.Errorf("Erro ao escrever mudanças de velocidade no Redis: %v", err)
						}
					}
				}(metrics)
			} else {
				// Versão síncrona (bloqueia até concluir)
				if err := s.redisService.WriteMetrics(metrics); err != nil {
					logger.Errorf("Erro ao escrever métricas no Redis: %v", err)
				}

				if len(metrics.VelocityChanges) > 0 {
					if err := s.redisService.WriteVelocityChanges(metrics.VelocityChanges); err != nil {
						logger.Errorf("Erro ao escrever mudanças de velocidade no Redis: %v", err)
					}
				}
			}
		}
	} else {
		logger.Warn("Nenhuma métrica válida extraída da resposta")
	}
}

// detectVelocityChanges detecta mudanças nas velocidades
func (s *Service) detectVelocityChanges(metrics *models.RadarMetrics) {
	// Limiar mínimo para considerar uma mudança (configurável)
	const minVelocityChange = 0.01

	// Limpa o array de mudanças
	metrics.VelocityChanges = []models.VelocityChange{}

	// Obter últimas velocidades
	s.mutex.RLock()
	lastVelocities := s.lastVelocities
	s.mutex.RUnlock()

	// Verifica cada velocidade individualmente
	for i := 0; i < 7; i++ {
		// Calcula a diferença
		change := metrics.Velocities[i] - lastVelocities[i]

		// Se a mudança for significativa (maior que o limiar), registra
		if math.Abs(change) >= minVelocityChange {
			metrics.VelocityChanges = append(metrics.VelocityChanges, models.VelocityChange{
				Index:       i,
				OldValue:    lastVelocities[i],
				NewValue:    metrics.Velocities[i],
				ChangeValue: change,
				Timestamp:   metrics.Timestamp,
			})

			if s.config.Debug && !s.throttleOutput {
				logger.Debugf("Mudança detectada na velocidade %d: %.3f -> %.3f (Δ%.3f)",
					i+1, lastVelocities[i], metrics.Velocities[i], change)
			}
		}
	}

	// Atualizar as velocidades anteriores para a próxima comparação
	s.mutex.Lock()
	copy(s.lastVelocities[:], metrics.Velocities[:])
	s.mutex.Unlock()
}

// handleConnectionError trata erros de conexão com o radar
func (s *Service) handleConnectionError(err error) {
	s.consecutiveErrors++
	s.lastErrorMsg = err.Error()

	logger.Errorf("Erro ao comunicar com o radar: %v. Tentativa %d",
		err, s.consecutiveErrors)

	// Marcar cliente como desconectado
	s.client.SetConnected(false)

	// Se exceder o número máximo de tentativas, atualizar status
	if s.consecutiveErrors > s.config.MaxConsecutiveErrors {
		s.updateStatus("falha_comunicacao", s.lastErrorMsg)

		// Esperar antes da próxima tentativa
		time.Sleep(s.config.ReconnectDelay)
	}
}

// updateStatus atualiza o status do radar
func (s *Service) updateStatus(status string, errorMsg string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	s.status = models.RadarStatus{
		Status:     status,
		Timestamp:  time.Now(),
		LastError:  errorMsg,
		ErrorCount: s.consecutiveErrors,
	}

	// Atualizar status no Redis
	if s.redisService != nil && s.redisService.IsConnected() {
		s.redisService.WriteStatus(s.status)
	}

	// Enviar atualização de status via WebSocket
	if s.wsHub != nil {
		s.wsHub.BroadcastStatus(s.status)
	}

	// Log
	if status != "ok" {
		logger.Warnf("Status do radar alterado para %s: %s", status, errorMsg)
	} else if s.consecutiveErrors > 0 {
		logger.Info("Status do radar restaurado para 'ok'")
	}
}

// updateMetrics atualiza as métricas internas
func (s *Service) updateMetrics(metrics models.RadarMetrics) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	// Criar cópia das métricas
	metricsCopy := metrics
	s.lastMetrics = &metricsCopy
}

// notifyMetricsHandlers notifica todos os handlers registrados
func (s *Service) notifyMetricsHandlers(metrics models.RadarMetrics) {
	s.handlersLock.RLock()
	handlers := s.metricsHandlers
	s.handlersLock.RUnlock()

	for _, handler := range handlers {
		handler(metrics) // Chamada síncrona
	}
}

// notifyMetricsHandlersAsync notifica todos os handlers registrados de forma assíncrona
func (s *Service) notifyMetricsHandlersAsync(metrics models.RadarMetrics) {
	s.handlersLock.RLock()
	handlers := s.metricsHandlers
	s.handlersLock.RUnlock()

	for _, handler := range handlers {
		go handler(metrics) // Chamada assíncrona
	}
}

// monitorStats monitora estatísticas de desempenho
func (s *Service) monitorStats() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.logPerformanceStats()
		}
	}
}

// logPerformanceStats registra estatísticas de desempenho
func (s *Service) logPerformanceStats() {
	s.statsLock.Lock()
	defer s.statsLock.Unlock()

	totalCycles := s.stats.totalCycles

	// Calcular duração média do ciclo
	var avgDuration time.Duration
	if len(s.stats.cycleDurations) > 0 {
		var sum time.Duration
		for _, d := range s.stats.cycleDurations {
			sum += d
		}
		avgDuration = sum / time.Duration(len(s.stats.cycleDurations))
		s.stats.avgCycleDuration = avgDuration
	}

	// Registrar estatísticas
	logger.Infof("Estatísticas de desempenho: %d ciclos totais, duração média: %v",
		totalCycles, avgDuration)

	// Limpar histórico de durações para não consumir muita memória
	if len(s.stats.cycleDurations) > 500 {
		s.stats.cycleDurations = s.stats.cycleDurations[:100]
	}
}
