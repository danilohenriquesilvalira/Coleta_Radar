package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"

	"radar_go/internal/config"
	"radar_go/internal/models"
	"radar_go/pkg/logger"
)

// Service gerencia a conexão e operações com o Redis
type Service struct {
	client    *redis.Client
	ctx       context.Context
	cancel    context.CancelFunc
	prefix    string
	config    config.RedisConfig
	connected bool
	mutex     sync.RWMutex

	// Constantes específicas do serviço
	maxVelocityHistorySize int
	minVelocityChange      float64
}

// NewService cria um novo serviço Redis
func NewService(cfg config.RedisConfig) (*Service, error) {
	if !cfg.Enabled {
		logger.Info("Serviço Redis desabilitado por configuração")
		return &Service{
			config:                 cfg,
			connected:              false,
			maxVelocityHistorySize: 100,
			minVelocityChange:      0.01,
		}, nil
	}

	// Criar contexto cancelável
	ctx, cancel := context.WithCancel(context.Background())

	// Configurar endereço
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	// Criar cliente Redis
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	// Criar serviço
	service := &Service{
		client:                 client,
		ctx:                    ctx,
		cancel:                 cancel,
		prefix:                 cfg.Prefix,
		config:                 cfg,
		maxVelocityHistorySize: 100,
		minVelocityChange:      0.01,
	}

	// Testar conexão
	if err := service.TestConnection(); err != nil {
		logger.Warnf("Aviso: %v. O Redis será utilizado em modo offline.", err)
		service.connected = false
		return service, nil
	}

	service.connected = true
	return service, nil
}

// TestConnection testa a conexão com o Redis
func (s *Service) TestConnection() error {
	if !s.config.Enabled {
		return fmt.Errorf("serviço Redis desabilitado")
	}

	result, err := s.client.Ping(s.ctx).Result()
	if err != nil {
		return fmt.Errorf("erro ao conectar ao Redis: %w", err)
	}

	logger.Infof("Conexão com o Redis estabelecida. Resposta: %s", result)
	s.connected = true
	return nil
}

// IsConnected verifica se o serviço está conectado
func (s *Service) IsConnected() bool {
	s.mutex.RLock()
	defer s.mutex.RUnlock()
	return s.connected && s.config.Enabled
}

// WriteMetrics escreve métricas no Redis
func (s *Service) WriteMetrics(metrics *models.RadarMetrics) error {
	s.mutex.RLock()
	if !s.connected || !s.config.Enabled {
		s.mutex.RUnlock()
		return nil
	}
	s.mutex.RUnlock()

	// Criar uma pipeline para enviar vários comandos de uma vez
	pipe := s.client.Pipeline()
	timestamp := metrics.Timestamp.UnixNano() / int64(time.Millisecond)

	// Armazena o status do radar
	pipe.Set(s.ctx, fmt.Sprintf("%s:status", s.prefix), metrics.Status, 0)
	pipe.Set(s.ctx, fmt.Sprintf("%s:timestamp", s.prefix), timestamp, 0)

	// Adiciona posições ao Redis
	for i := 0; i < 7; i++ {
		key := fmt.Sprintf("%s:pos%d", s.prefix, i+1)

		// Armazenando o valor atual
		pipe.Set(s.ctx, key, metrics.Positions[i], 0)

		// Armazenando no histórico com timestamp
		histKey := fmt.Sprintf("%s:history", key)
		pipe.ZAdd(s.ctx, histKey, &redis.Z{
			Score:  float64(timestamp),
			Member: metrics.Positions[i],
		})

		// Limitando o tamanho do histórico (mantém últimos 1000 pontos)
		pipe.ZRemRangeByRank(s.ctx, histKey, 0, -1001)
	}

	// Adiciona velocidades ao Redis
	for i := 0; i < 7; i++ {
		key := fmt.Sprintf("%s:vel%d", s.prefix, i+1)

		// Armazenando o valor atual
		pipe.Set(s.ctx, key, metrics.Velocities[i], 0)

		// Armazenando no histórico com timestamp
		histKey := fmt.Sprintf("%s:history", key)
		pipe.ZAdd(s.ctx, histKey, &redis.Z{
			Score:  float64(timestamp),
			Member: metrics.Velocities[i],
		})

		// Limitando o tamanho do histórico (mantém últimos 1000 pontos)
		pipe.ZRemRangeByRank(s.ctx, histKey, 0, -1001)
	}

	// Executa a pipeline
	_, err := pipe.Exec(s.ctx)
	if err != nil {
		s.mutex.Lock()
		s.connected = false
		s.mutex.Unlock()
		return fmt.Errorf("erro ao escrever métricas no Redis: %w", err)
	}

	return nil
}

// WriteVelocityChanges escreve as mudanças de velocidade no Redis
func (s *Service) WriteVelocityChanges(changes []models.VelocityChange) error {
	s.mutex.RLock()
	if !s.connected || !s.config.Enabled || len(changes) == 0 {
		s.mutex.RUnlock()
		return nil
	}
	s.mutex.RUnlock()

	pipe := s.client.Pipeline()

	for _, change := range changes {
		// Criar estrutura para armazenar detalhes da mudança
		changeData := map[string]interface{}{
			"index":        change.Index,
			"old_value":    change.OldValue,
			"new_value":    change.NewValue,
			"change_value": change.ChangeValue,
			"timestamp":    change.Timestamp.UnixNano() / int64(time.Millisecond),
		}

		// Converter para JSON
		jsonData, err := json.Marshal(changeData)
		if err != nil {
			continue
		}

		// Chave única para esta mudança
		changeKey := fmt.Sprintf("%s:velocity_change:%d:%d",
			s.prefix,
			change.Index+1,
			change.Timestamp.UnixNano()/int64(time.Millisecond))

		// Armazena os detalhes da mudança
		pipe.Set(s.ctx, changeKey, string(jsonData), 0)

		// Adiciona à lista de mudanças recentes para cada velocidade
		velocityChangesKey := fmt.Sprintf("%s:vel%d:changes", s.prefix, change.Index+1)
		pipe.ZAdd(s.ctx, velocityChangesKey, &redis.Z{
			Score:  float64(change.Timestamp.UnixNano() / int64(time.Millisecond)),
			Member: changeKey,
		})

		// Limita o tamanho da lista de mudanças - corrigido para int64
		limit := int64(-1 * (s.maxVelocityHistorySize + 1))
		pipe.ZRemRangeByRank(s.ctx, velocityChangesKey, 0, limit)

		// Adiciona à lista global de mudanças de velocidade
		allChangesKey := fmt.Sprintf("%s:velocity_changes", s.prefix)
		pipe.ZAdd(s.ctx, allChangesKey, &redis.Z{
			Score:  float64(change.Timestamp.UnixNano() / int64(time.Millisecond)),
			Member: changeKey,
		})

		// Limita o tamanho da lista global - corrigido para int64
		pipe.ZRemRangeByRank(s.ctx, allChangesKey, 0, limit)

		// Atualiza o contador de mudanças para esta velocidade
		counterKey := fmt.Sprintf("%s:vel%d:change_count", s.prefix, change.Index+1)
		pipe.Incr(s.ctx, counterKey)
	}

	// Adiciona a última atualização global para o React Native
	latestDataKey := fmt.Sprintf("%s:latest_update", s.prefix)
	latestData := map[string]interface{}{
		"timestamp": time.Now().UnixNano() / int64(time.Millisecond),
		"changes":   changes,
	}
	jsonData, _ := json.Marshal(latestData)
	pipe.Set(s.ctx, latestDataKey, string(jsonData), 0)

	// Executa a pipeline
	_, err := pipe.Exec(s.ctx)
	if err != nil {
		s.mutex.Lock()
		s.connected = false
		s.mutex.Unlock()
		return fmt.Errorf("erro ao escrever mudanças de velocidade no Redis: %w", err)
	}

	logger.Debugf("Registradas %d mudanças de velocidade no Redis", len(changes))
	return nil
}

// WriteStatus escreve o status do radar no Redis
func (s *Service) WriteStatus(status models.RadarStatus) error {
	s.mutex.RLock()
	if !s.connected || !s.config.Enabled {
		s.mutex.RUnlock()
		return nil
	}
	s.mutex.RUnlock()

	// Criar uma pipeline para enviar vários comandos
	pipe := s.client.Pipeline()

	// Armazenar status básico
	pipe.Set(s.ctx, fmt.Sprintf("%s:status", s.prefix), status.Status, 0)
	pipe.Set(s.ctx, fmt.Sprintf("%s:timestamp", s.prefix),
		status.Timestamp.UnixNano()/int64(time.Millisecond), 0)

	// Armazenar informações de erro, se houver
	if status.LastError != "" {
		pipe.Set(s.ctx, fmt.Sprintf("%s:ultimo_erro", s.prefix), status.LastError, 0)
	}

	if status.ErrorCount > 0 {
		pipe.Set(s.ctx, fmt.Sprintf("%s:erros_consecutivos", s.prefix), status.ErrorCount, 0)
	}

	// Executar pipeline
	_, err := pipe.Exec(s.ctx)
	if err != nil {
		s.mutex.Lock()
		s.connected = false
		s.mutex.Unlock()
		return fmt.Errorf("erro ao escrever status no Redis: %w", err)
	}

	return nil
}

// GetStatus obtém o status atual do Redis
func (s *Service) GetStatus() (*models.RadarStatus, error) {
	s.mutex.RLock()
	if !s.connected || !s.config.Enabled {
		s.mutex.RUnlock()
		return nil, fmt.Errorf("Redis não conectado ou desabilitado")
	}
	s.mutex.RUnlock()

	// Obter status e timestamp
	statusCmd := s.client.Get(s.ctx, fmt.Sprintf("%s:status", s.prefix))
	if statusCmd.Err() != nil {
		return nil, fmt.Errorf("erro ao obter status: %w", statusCmd.Err())
	}

	timestampCmd := s.client.Get(s.ctx, fmt.Sprintf("%s:timestamp", s.prefix))
	if timestampCmd.Err() != nil && timestampCmd.Err() != redis.Nil {
		return nil, fmt.Errorf("erro ao obter timestamp: %w", timestampCmd.Err())
	}

	// Obter informações de erro
	lastErrorCmd := s.client.Get(s.ctx, fmt.Sprintf("%s:ultimo_erro", s.prefix))
	errorCountCmd := s.client.Get(s.ctx, fmt.Sprintf("%s:erros_consecutivos", s.prefix))

	// Construir objeto de status
	status := &models.RadarStatus{
		Status:    statusCmd.Val(),
		Timestamp: time.Now(), // Valor padrão
	}

	// Processar timestamp se disponível
	if timestampCmd.Err() == nil {
		ts, err := timestampCmd.Int64()
		if err == nil {
			status.Timestamp = time.Unix(0, ts*int64(time.Millisecond))
		}
	}

	// Processar erro se disponível
	if lastErrorCmd.Err() == nil {
		status.LastError = lastErrorCmd.Val()
	}

	// Processar contador de erros se disponível
	if errorCountCmd.Err() == nil {
		count, err := errorCountCmd.Int()
		if err == nil {
			status.ErrorCount = count
		}
	}

	return status, nil
}

// GetCurrentData obtém os dados atuais do radar do Redis
func (s *Service) GetCurrentData() (*models.RadarMetrics, error) {
	s.mutex.RLock()
	if !s.connected || !s.config.Enabled {
		s.mutex.RUnlock()
		return nil, fmt.Errorf("Redis não conectado ou desabilitado")
	}
	s.mutex.RUnlock()

	metrics := &models.RadarMetrics{
		Timestamp: time.Now(),
	}

	// Obter status
	statusCmd := s.client.Get(s.ctx, fmt.Sprintf("%s:status", s.prefix))
	if statusCmd.Err() == nil {
		metrics.Status = statusCmd.Val()
	} else {
		metrics.Status = "desconhecido"
	}

	// Obter timestamp
	timestampCmd := s.client.Get(s.ctx, fmt.Sprintf("%s:timestamp", s.prefix))
	if timestampCmd.Err() == nil {
		ts, err := timestampCmd.Int64()
		if err == nil {
			metrics.Timestamp = time.Unix(0, ts*int64(time.Millisecond))
		}
	}

	// Obter posições
	for i := 0; i < 7; i++ {
		posCmd := s.client.Get(s.ctx, fmt.Sprintf("%s:pos%d", s.prefix, i+1))
		if posCmd.Err() == nil {
			val, err := posCmd.Float64()
			if err == nil {
				metrics.Positions[i] = val
			}
		}
	}

	// Obter velocidades
	for i := 0; i < 7; i++ {
		velCmd := s.client.Get(s.ctx, fmt.Sprintf("%s:vel%d", s.prefix, i+1))
		if velCmd.Err() == nil {
			val, err := velCmd.Float64()
			if err == nil {
				metrics.Velocities[i] = val
			}
		}
	}

	return metrics, nil
}

// GetVelocityChanges obtém as mudanças recentes de velocidade
func (s *Service) GetVelocityChanges() ([]models.VelocityChange, error) {
	s.mutex.RLock()
	if !s.connected || !s.config.Enabled {
		s.mutex.RUnlock()
		return nil, fmt.Errorf("Redis não conectado ou desabilitado")
	}
	s.mutex.RUnlock()

	// Obter as últimas mudanças de velocidade
	changesKey := fmt.Sprintf("%s:velocity_changes", s.prefix)
	keysCmd := s.client.ZRevRange(s.ctx, changesKey, 0, 49)
	if keysCmd.Err() != nil {
		return nil, fmt.Errorf("erro ao obter mudanças de velocidade: %w", keysCmd.Err())
	}

	keys := keysCmd.Val()
	changes := make([]models.VelocityChange, 0, len(keys))

	// Obter os detalhes de cada mudança
	for _, key := range keys {
		dataCmd := s.client.Get(s.ctx, key)
		if dataCmd.Err() != nil {
			continue
		}

		var changeData map[string]interface{}
		if err := json.Unmarshal([]byte(dataCmd.Val()), &changeData); err != nil {
			continue
		}

		// Converter para o modelo VelocityChange
		change := models.VelocityChange{}

		// Índice
		if idx, ok := changeData["index"].(float64); ok {
			change.Index = int(idx)
		}

		// Valores
		if val, ok := changeData["old_value"].(float64); ok {
			change.OldValue = val
		}
		if val, ok := changeData["new_value"].(float64); ok {
			change.NewValue = val
		}
		if val, ok := changeData["change_value"].(float64); ok {
			change.ChangeValue = val
		}

		// Timestamp
		if ts, ok := changeData["timestamp"].(float64); ok {
			change.Timestamp = time.Unix(0, int64(ts)*int64(time.Millisecond))
		}

		changes = append(changes, change)
	}

	return changes, nil
}

// GetVelocityHistory obtém o histórico de uma velocidade específica
func (s *Service) GetVelocityHistory(index int) ([]models.HistoryPoint, error) {
	s.mutex.RLock()
	if !s.connected || !s.config.Enabled {
		s.mutex.RUnlock()
		return nil, fmt.Errorf("Redis não conectado ou desabilitado")
	}
	s.mutex.RUnlock()

	if index < 1 || index > 7 {
		return nil, fmt.Errorf("índice de velocidade inválido: %d", index)
	}

	// Obter histórico
	historyKey := fmt.Sprintf("%s:vel%d:history", s.prefix, index)
	dataCmd := s.client.ZRangeWithScores(s.ctx, historyKey, 0, -1)
	if dataCmd.Err() != nil {
		return nil, fmt.Errorf("erro ao obter histórico de velocidade: %w", dataCmd.Err())
	}

	// Processar resultados
	results := dataCmd.Val()
	history := make([]models.HistoryPoint, 0, len(results))

	for _, item := range results {
		// Valor da velocidade
		value, ok := item.Member.(string)
		if !ok {
			continue
		}

		val, err := strconv.ParseFloat(value, 64)
		if err != nil {
			continue
		}

		// Timestamp
		timestamp := time.Unix(0, int64(item.Score)*int64(time.Millisecond))

		history = append(history, models.HistoryPoint{
			Value:     val,
			Timestamp: timestamp,
		})
	}

	return history, nil
}

// Shutdown encerra graciosamente o serviço Redis
func (s *Service) Shutdown() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	s.cancel()

	if s.client != nil {
		if err := s.client.Close(); err != nil {
			logger.Errorf("Erro ao fechar conexão com Redis: %v", err)
		} else {
			logger.Info("Conexão com o Redis fechada")
		}
	}

	s.connected = false
}
