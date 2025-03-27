package plc

import (
	"context"
	"sync"
	"time"

	"radar_go/internal/config"
	"radar_go/internal/models"
	"radar_go/pkg/logger"
)

// MapPoint representa um ponto de mapeamento entre o radar e o PLC
type MapPoint struct {
	DBNumber    int    // Número do bloco de dados
	ByteOffset  int    // Offset em bytes
	DataType    string // Tipo de dados: "float", "int", "bool"
	Description string // Descrição do ponto
}

// PLCService gerencia a comunicação com o PLC
type PLCService struct {
	client           *S7Client
	config           config.PLCConfig
	ctx              context.Context
	cancel           context.CancelFunc
	velocityMapping  []MapPoint // Mapeamento das velocidades para o PLC
	positionMapping  []MapPoint // Mapeamento das posições para o PLC
	statusMapping    MapPoint   // Mapeamento do status do radar
	updateFrequency  time.Duration
	lastMetrics      *models.RadarMetrics
	metricsSubscribe chan models.RadarMetrics
	mutex            sync.RWMutex
	running          bool
}

// NewPLCService cria um novo serviço de PLC
func NewPLCService(cfg config.PLCConfig) *PLCService {
	ctx, cancel := context.WithCancel(context.Background())

	return &PLCService{
		client:           NewS7Client(cfg),
		config:           cfg,
		ctx:              ctx,
		cancel:           cancel,
		updateFrequency:  cfg.UpdateRate,
		metricsSubscribe: make(chan models.RadarMetrics, 10),
		running:          false,
	}
}

// Start inicia o serviço de comunicação com o PLC
func (s *PLCService) Start() error {
	if !s.config.Enabled {
		logger.Info("Serviço PLC desabilitado por configuração")
		return nil
	}

	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.running {
		return nil
	}

	// Iniciar conexão com o PLC
	if err := s.client.Connect(); err != nil {
		return err
	}

	// Configurar mapeamentos
	s.configureDefaultMapping()

	// Iniciar goroutine para atualização contínua
	go s.runUpdateLoop()

	s.running = true
	logger.Info("Serviço PLC iniciado")
	return nil
}

// Stop para o serviço de comunicação com o PLC
func (s *PLCService) Stop() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if !s.running {
		return
	}

	s.cancel()
	s.client.Disconnect()
	s.running = false
	logger.Info("Serviço PLC parado")
}

// IsRunning verifica se o serviço está em execução
func (s *PLCService) IsRunning() bool {
	s.mutex.RLock()
	defer s.mutex.RUnlock()
	return s.running
}

// UpdateMetrics atualiza as métricas no PLC
func (s *PLCService) UpdateMetrics(metrics models.RadarMetrics) {
	if !s.config.Enabled || !s.running {
		return
	}

	// Enviar métricas para o canal
	select {
	case s.metricsSubscribe <- metrics:
		// Enviado com sucesso
	default:
		// Canal cheio, descartar mensagem
		logger.Warn("Canal de métricas para PLC está cheio, descartando atualização")
	}
}

// configureDefaultMapping configura o mapeamento padrão entre o radar e o PLC
func (s *PLCService) configureDefaultMapping() {
	// Mapeamento de velocidades (exemplo)
	s.velocityMapping = make([]MapPoint, 7)
	for i := 0; i < 7; i++ {
		s.velocityMapping[i] = MapPoint{
			DBNumber:    10,           // DB10
			ByteOffset:  i * 4,        // 0, 4, 8, 12, 16, 20, 24
			DataType:    "float",      // Float (REAL)
			Description: "Velocidade", // Descrição
		}
	}

	// Mapeamento de posições (exemplo)
	s.positionMapping = make([]MapPoint, 7)
	for i := 0; i < 7; i++ {
		s.positionMapping[i] = MapPoint{
			DBNumber:    10,        // DB10
			ByteOffset:  28 + i*4,  // 28, 32, 36, 40, 44, 48, 52
			DataType:    "float",   // Float (REAL)
			Description: "Posição", // Descrição
		}
	}

	// Mapeamento de status (exemplo)
	s.statusMapping = MapPoint{
		DBNumber:    10,       // DB10
		ByteOffset:  56,       // Byte 56
		DataType:    "int",    // INT
		Description: "Status", // Descrição
	}
}

// runUpdateLoop executa o loop de atualização contínua para o PLC
func (s *PLCService) runUpdateLoop() {
	ticker := time.NewTicker(s.updateFrequency)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return

		case metrics := <-s.metricsSubscribe:
			// Atualizar as métricas armazenadas
			s.mutex.Lock()
			s.lastMetrics = &metrics
			s.mutex.Unlock()

		case <-ticker.C:
			// Verificar se há métricas para enviar
			s.mutex.RLock()
			metrics := s.lastMetrics
			s.mutex.RUnlock()

			if metrics != nil {
				s.sendMetricsToPLC(*metrics)
			}
		}
	}
}

// sendMetricsToPLC envia as métricas para o PLC
func (s *PLCService) sendMetricsToPLC(metrics models.RadarMetrics) {
	// Verificar conexão
	if !s.client.IsConnected() {
		if err := s.client.Connect(); err != nil {
			logger.Error("Falha ao reconectar ao PLC", err)
			return
		}
	}

	// Implementar lógica para enviar dados para o PLC
	// Por exemplo, converter velocidades para o formato correto e enviar para os endereços mapeados
	logger.Debug("Enviando métricas para o PLC")

	// Lógica de envio seria implementada aqui
	// Exemplo (pseudocódigo):
	// for i, velocity := range metrics.Velocities {
	//     mapping := s.velocityMapping[i]
	//     data := floatToBytes(velocity)
	//     s.client.WriteDataBlock(mapping.DBNumber, mapping.ByteOffset, data)
	// }
}

// Shutdown encerra graciosamente o serviço
func (s *PLCService) Shutdown() {
	s.Stop()
	close(s.metricsSubscribe)
}
