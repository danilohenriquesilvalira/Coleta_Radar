package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-redis/redis/v8"
)

// Configurações globais
const (
	// Configurações do radar
	RadarHost    = "192.168.1.84"
	RadarPort    = 2111 // Porta AUX para monitoramento (ASCII)
	ProtocolType = "ascii"

	// Configurações do Redis
	RedisAddr     = "localhost:6379"
	RedisPassword = ""
	RedisDB       = 0
	RedisPrefix   = "radar_sick"

	// Configurações gerais
	SampleRate           = 100 * time.Millisecond // 10 Hz
	MaxConsecutiveErrors = 5
	ReconnectDelay       = 2 * time.Second
	DebuggingEnabled     = true

	// Configurações para detecção de mudanças
	MinVelocityChange      = 0.01 // Mudança mínima de velocidade para ser registrada (m/s)
	MaxVelocityHistorySize = 100  // Número máximo de eventos de mudança a armazenar
)

// RadarMetrics armazena as métricas decodificadas do radar
type RadarMetrics struct {
	Positions       [7]float64
	Velocities      [7]float64
	LastVelocities  [7]float64 // Para rastrear mudanças
	Timestamp       time.Time
	Status          string
	VelocityChanges []VelocityChange // Registra quais velocidades mudaram
}

// VelocityChange representa uma mudança específica em uma velocidade
type VelocityChange struct {
	Index       int       // Índice da velocidade (0-6)
	OldValue    float64   // Valor anterior
	NewValue    float64   // Valor novo
	ChangeValue float64   // Diferença
	Timestamp   time.Time // Momento da mudança
}

// SickRadar gerencia a conexão com o radar
type SickRadar struct {
	conn      net.Conn
	host      string
	port      int
	connected bool
	protocol  string // "ascii" ou "binary"
}

// NewSickRadar cria uma nova instância do radar
func NewSickRadar(host string, port int, protocol string) *SickRadar {
	return &SickRadar{
		host:     host,
		port:     port,
		protocol: strings.ToLower(protocol),
	}
}

// Connect estabelece conexão com o radar
func (r *SickRadar) Connect() error {
	if r.connected {
		return nil
	}

	addr := fmt.Sprintf("%s:%d", r.host, r.port)
	log.Printf("Tentando conectar ao radar em %s...", addr)

	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		return fmt.Errorf("erro ao conectar ao radar: %v", err)
	}

	r.conn = conn
	r.connected = true
	log.Printf("Conectado ao radar em %s", addr)
	return nil
}

// SendCommand envia comando para o radar
func (r *SickRadar) SendCommand(cmd string) (string, error) {
	if !r.connected {
		if err := r.Connect(); err != nil {
			return "", err
		}
	}

	// Adiciona os caracteres STX (0x02) e ETX (0x03) ao comando
	command := fmt.Sprintf("\x02%s\x03", cmd)
	_, err := r.conn.Write([]byte(command))
	if err != nil {
		r.connected = false
		return "", fmt.Errorf("erro ao enviar comando: %v", err)
	}

	// Lê a resposta com timeout
	buffer := make([]byte, 4096)
	r.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	n, err := r.conn.Read(buffer)
	if err != nil {
		r.connected = false
		return "", fmt.Errorf("erro ao ler resposta: %v", err)
	}

	return string(buffer[:n]), nil
}

// hexStringToFloat32 converte uma string hexadecimal IEEE-754 para float32
func hexStringToFloat32(hexStr string) float32 {
	// Converte a string hexadecimal para um uint32
	val, err := strconv.ParseUint(hexStr, 16, 32)
	if err != nil {
		log.Printf("Erro ao converter %s para float: %v", hexStr, err)
		return 0.0
	}

	// Converte o uint32 para float32 usando IEEE-754
	return math.Float32frombits(uint32(val))
}

// smallHexToInt converte um valor hexadecimal pequeno para int
func smallHexToInt(hexStr string) int {
	val, err := strconv.ParseInt(hexStr, 16, 32)
	if err != nil {
		return 0
	}
	return int(val)
}

// DecodeValues decodifica a resposta do radar em métricas
func (r *SickRadar) DecodeValues(response string) (*RadarMetrics, error) {
	metrics := &RadarMetrics{
		Timestamp: time.Now(),
		Status:    "ok",
	}

	if DebuggingEnabled {
		fmt.Println("\nResposta ASCII do radar:")
		fmt.Println(response)

		// Converte para hexadecimal para depuração
		hexDump := ""
		for i, c := range response {
			if i < 50 { // Limita para os primeiros 50 caracteres
				hexDump += fmt.Sprintf("%02X ", c)
			}
		}
		fmt.Println("Hex dump dos primeiros 50 bytes:")
		fmt.Println(hexDump)
	}

	// Remove caracteres de controle e divide em tokens
	cleanedResponse := strings.Map(func(r rune) rune {
		if r < 32 || r > 126 {
			return ' ' // Substitui caracteres de controle por espaço
		}
		return r
	}, response)

	tokens := strings.Fields(cleanedResponse)

	// Processa o bloco de posições (P3DX1)
	posIdx := -1
	for i, token := range tokens {
		if token == "P3DX1" {
			posIdx = i
			break
		}
	}

	if posIdx != -1 && posIdx+3 < len(tokens) {
		// Extrai a escala em formato float
		scaleHex := tokens[posIdx+1]
		scale := hexStringToFloat32(scaleHex)

		// O terceiro token (após o token não utilizado) indica o número de valores que seguem
		numValues := 7 // Padrão para 7 posições
		if posIdx+3 < len(tokens) {
			if valCount, err := strconv.Atoi(tokens[posIdx+3]); err == nil {
				numValues = valCount
				if numValues > 7 {
					numValues = 7 // Limitamos a 7 para manter a compatibilidade
				}
			}
		}

		fmt.Printf("\nBloco de Posição (P3DX1) encontrado. Escala: %f\n", scale)

		// Processa os valores de posição (começando após o contador de valores)
		for i := 0; i < numValues && posIdx+i+4 < len(tokens); i++ {
			valHex := tokens[posIdx+i+4]

			// Converte valor hexadecimal para decimal
			decimalValue := smallHexToInt(valHex)

			// Aplica a escala correta (divide por 1000 para ter metros)
			posMeters := float64(decimalValue) * float64(scale) / 1000.0

			if i < 7 { // Garante que não exceda o array
				metrics.Positions[i] = posMeters
			}

			fmt.Printf("  pos%d: HEX=%s -> DEC=%d -> %.3fm\n", i+1, valHex, decimalValue, posMeters)
		}
	} else {
		fmt.Println("Bloco de Posição (P3DX1) não encontrado ou formato inesperado.")
	}

	// Processa o bloco de velocidades (V3DX1)
	velIdx := -1
	for i, token := range tokens {
		if token == "V3DX1" {
			velIdx = i
			break
		}
	}

	if velIdx != -1 && velIdx+3 < len(tokens) {
		// Extrai a escala em formato float
		scaleHex := tokens[velIdx+1]
		scale := hexStringToFloat32(scaleHex)

		// O terceiro token (após o token não utilizado) indica o número de valores que seguem
		numValues := 7 // Padrão para 7 velocidades
		if velIdx+3 < len(tokens) {
			if valCount, err := strconv.Atoi(tokens[velIdx+3]); err == nil {
				numValues = valCount
				if numValues > 7 {
					numValues = 7 // Limitamos a 7 para manter a compatibilidade
				}
			}
		}

		fmt.Printf("\nBloco de Velocidade (V3DX1) encontrado. Escala: %f\n", scale)

		// Processa os valores de velocidade (começando após o contador de valores)
		for i := 0; i < numValues && velIdx+i+4 < len(tokens); i++ {
			valHex := tokens[velIdx+i+4]

			// Converte valor hexadecimal para decimal
			decimalValue := smallHexToInt(valHex)

			// Para valores de velocidade, pode ser necessário interpretar como valor com sinal
			if decimalValue > 32767 {
				decimalValue -= 65536
			}

			// Aplica a escala (sem divisão por 1000)
			velMS := float64(decimalValue) * float64(scale)

			if i < 7 { // Garante que não exceda o array
				metrics.Velocities[i] = velMS
			}

			fmt.Printf("  vel%d: HEX=%s -> DEC=%d -> %.3fm/s\n", i+1, valHex, decimalValue, velMS)
		}
	} else {
		fmt.Println("Bloco de Velocidade (V3DX1) não encontrado ou formato inesperado.")
	}

	return metrics, nil
}

// DetectVelocityChanges detecta mudanças nas velocidades
func DetectVelocityChanges(metrics *RadarMetrics, lastVelocities [7]float64) {
	// Limpa o array de mudanças
	metrics.VelocityChanges = []VelocityChange{}

	// Verifica cada velocidade individualmente
	for i := 0; i < 7; i++ {
		// Calcula a diferença
		change := metrics.Velocities[i] - lastVelocities[i]

		// Se a mudança for significativa (maior que o limiar), registra
		if math.Abs(change) >= MinVelocityChange {
			metrics.VelocityChanges = append(metrics.VelocityChanges, VelocityChange{
				Index:       i,
				OldValue:    lastVelocities[i],
				NewValue:    metrics.Velocities[i],
				ChangeValue: change,
				Timestamp:   metrics.Timestamp,
			})

			if DebuggingEnabled {
				fmt.Printf("Mudança detectada na velocidade %d: %.3f -> %.3f (Δ%.3f)\n",
					i+1, lastVelocities[i], metrics.Velocities[i], change)
			}
		}
	}

	// Atualiza as velocidades anteriores para a próxima comparação
	copy(metrics.LastVelocities[:], metrics.Velocities[:])
}

// Close fecha a conexão com o radar
func (r *SickRadar) Close() {
	if r.conn != nil {
		r.conn.Close()
		r.connected = false
		log.Println("Conexão com o radar fechada")
	}
}

// RedisWriter gerencia a conexão com o Redis
type RedisWriter struct {
	client  *redis.Client
	ctx     context.Context
	prefix  string
	enabled bool
}

// NewRedisWriter cria uma nova instância do escritor Redis
func NewRedisWriter(addr, password string, db int, prefix string) *RedisWriter {
	ctx := context.Background()
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	return &RedisWriter{
		client:  client,
		ctx:     ctx,
		prefix:  prefix,
		enabled: true,
	}
}

// TestConnection testa a conexão com o Redis
func (r *RedisWriter) TestConnection() error {
	if !r.enabled {
		return nil
	}

	_, err := r.client.Ping(r.ctx).Result()
	if err != nil {
		return fmt.Errorf("erro ao conectar ao Redis: %v", err)
	}

	log.Println("Conexão com o Redis estabelecida")
	return nil
}

// WriteMetrics escreve métricas no Redis
func (r *RedisWriter) WriteMetrics(metrics *RadarMetrics) error {
	if !r.enabled {
		return nil
	}

	// Cria uma pipeline para enviar vários comandos de uma vez
	pipe := r.client.Pipeline()
	timestamp := metrics.Timestamp.UnixNano() / int64(time.Millisecond)

	// Armazena o status do radar
	pipe.Set(r.ctx, fmt.Sprintf("%s:status", r.prefix), metrics.Status, 0)
	pipe.Set(r.ctx, fmt.Sprintf("%s:timestamp", r.prefix), timestamp, 0)

	// Adiciona posições ao Redis
	for i := 0; i < 7; i++ {
		key := fmt.Sprintf("%s:pos%d", r.prefix, i+1)

		// Armazenando o valor atual
		pipe.Set(r.ctx, key, metrics.Positions[i], 0)

		// Armazenando no histórico com timestamp
		histKey := fmt.Sprintf("%s:history", key)
		pipe.ZAdd(r.ctx, histKey, &redis.Z{
			Score:  float64(timestamp),
			Member: metrics.Positions[i],
		})

		// Limitando o tamanho do histórico (mantém últimos 1000 pontos)
		pipe.ZRemRangeByRank(r.ctx, histKey, 0, -1001)
	}

	// Adiciona velocidades ao Redis
	for i := 0; i < 7; i++ {
		key := fmt.Sprintf("%s:vel%d", r.prefix, i+1)

		// Armazenando o valor atual
		pipe.Set(r.ctx, key, metrics.Velocities[i], 0)

		// Armazenando no histórico com timestamp
		histKey := fmt.Sprintf("%s:history", key)
		pipe.ZAdd(r.ctx, histKey, &redis.Z{
			Score:  float64(timestamp),
			Member: metrics.Velocities[i],
		})

		// Limitando o tamanho do histórico (mantém últimos 1000 pontos)
		pipe.ZRemRangeByRank(r.ctx, histKey, 0, -1001)
	}

	// Executa a pipeline
	_, err := pipe.Exec(r.ctx)
	if err != nil {
		return fmt.Errorf("erro ao escrever métricas no Redis: %v", err)
	}

	return nil
}

// WriteVelocityChanges escreve as mudanças de velocidade no Redis
func (r *RedisWriter) WriteVelocityChanges(changes []VelocityChange) error {
	if !r.enabled || len(changes) == 0 {
		return nil
	}

	pipe := r.client.Pipeline()

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
			r.prefix,
			change.Index+1,
			change.Timestamp.UnixNano()/int64(time.Millisecond))

		// Armazena os detalhes da mudança
		pipe.Set(r.ctx, changeKey, string(jsonData), 0)

		// Adiciona à lista de mudanças recentes para cada velocidade
		velocityChangesKey := fmt.Sprintf("%s:vel%d:changes", r.prefix, change.Index+1)
		pipe.ZAdd(r.ctx, velocityChangesKey, &redis.Z{
			Score:  float64(change.Timestamp.UnixNano() / int64(time.Millisecond)),
			Member: changeKey,
		})

		// Limita o tamanho da lista de mudanças
		pipe.ZRemRangeByRank(r.ctx, velocityChangesKey, 0, -MaxVelocityHistorySize-1)

		// Adiciona à lista global de mudanças de velocidade
		allChangesKey := fmt.Sprintf("%s:velocity_changes", r.prefix)
		pipe.ZAdd(r.ctx, allChangesKey, &redis.Z{
			Score:  float64(change.Timestamp.UnixNano() / int64(time.Millisecond)),
			Member: changeKey,
		})

		// Limita o tamanho da lista global
		pipe.ZRemRangeByRank(r.ctx, allChangesKey, 0, -MaxVelocityHistorySize-1)

		// Atualiza o contador de mudanças para esta velocidade
		counterKey := fmt.Sprintf("%s:vel%d:change_count", r.prefix, change.Index+1)
		pipe.Incr(r.ctx, counterKey)
	}

	// Adiciona a última atualização global para o React Native
	latestDataKey := fmt.Sprintf("%s:latest_update", r.prefix)
	latestData := map[string]interface{}{
		"timestamp": time.Now().UnixNano() / int64(time.Millisecond),
		"changes":   changes,
	}
	jsonData, _ := json.Marshal(latestData)
	pipe.Set(r.ctx, latestDataKey, string(jsonData), 0)

	// Executa a pipeline
	_, err := pipe.Exec(r.ctx)
	if err != nil {
		return fmt.Errorf("erro ao escrever mudanças de velocidade no Redis: %v", err)
	}

	if DebuggingEnabled && len(changes) > 0 {
		fmt.Printf("Registradas %d mudanças de velocidade no Redis\n", len(changes))
	}

	return nil
}

// Close fecha a conexão com o Redis
func (r *RedisWriter) Close() {
	if r.client != nil {
		if err := r.client.Close(); err != nil {
			log.Printf("Erro ao fechar conexão com Redis: %v", err)
		} else {
			log.Println("Conexão com o Redis fechada")
		}
	}
}

func main() {
	// Configuração de log
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.Println("=== Iniciando Coleta do Radar SICK ===")

	// Configura o radar com a porta apropriada para o protocolo
	radar := NewSickRadar(RadarHost, RadarPort, ProtocolType)

	// Configura o Redis
	redis := NewRedisWriter(RedisAddr, RedisPassword, RedisDB, RedisPrefix)

	// Garante que as conexões sejam fechadas ao final
	defer radar.Close()
	defer redis.Close()

	// Testa conexão com Redis
	if err := redis.TestConnection(); err != nil {
		log.Printf("Aviso: %v. O Redis será desabilitado.", err)
		redis.enabled = false
	}

	// Instruções para React Native
	fmt.Println("\n=== Informações para integração com React Native ===")
	fmt.Println("Dados armazenados no Redis que podem ser consultados pelo React Native:")
	fmt.Printf("1. Última atualização: %s:latest_update\n", RedisPrefix)
	fmt.Printf("2. Valores atuais: %s:vel1, %s:vel2, ...\n", RedisPrefix, RedisPrefix)
	fmt.Printf("3. Mudanças recentes: %s:velocity_changes (últimas %d mudanças)\n", RedisPrefix, MaxVelocityHistorySize)
	fmt.Printf("4. Mudanças por velocidade: %s:vel1:changes, %s:vel2:changes, ...\n", RedisPrefix, RedisPrefix)
	fmt.Printf("5. Contador de mudanças: %s:vel1:change_count, %s:vel2:change_count, ...\n", RedisPrefix, RedisPrefix)
	fmt.Println("=============================================")

	log.Printf("Iniciando coleta de dados do radar usando protocolo %s. Taxa de amostragem: %v",
		ProtocolType, SampleRate)
	log.Println("Pressione Ctrl+C para interromper.")

	// Configura canal para capturar sinais de interrupção
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Configura ticker para coletar dados periodicamente
	ticker := time.NewTicker(SampleRate)
	defer ticker.Stop()

	// Variáveis para controle de estado
	var consecutiveErrors int = 0
	var lastErrorMsg string
	var radarStatus string = "ok"
	var lastVelocities [7]float64

	// Loop principal
	for {
		select {
		case <-sigChan:
			log.Println("\nProcesso interrompido pelo usuário.")
			return
		case <-ticker.C:
			// Envia comando para o radar
			response, err := radar.SendCommand("sRN LMDradardata")
			if err != nil {
				consecutiveErrors++
				lastErrorMsg = err.Error()

				log.Printf("Erro ao enviar comando: %v. Tentando reconectar... (Tentativa %d)",
					err, consecutiveErrors)
				radar.connected = false

				if consecutiveErrors > MaxConsecutiveErrors {
					radarStatus = "falha_comunicacao"
					log.Printf("ALERTA: Múltiplas falhas de comunicação com o radar. "+
						"Verifique a conexão física! Último erro: %s", lastErrorMsg)

					// Notifica o status no Redis se estiver habilitado
					if redis.enabled {
						pipe := redis.client.Pipeline()
						pipe.Set(redis.ctx, redis.prefix+":status", radarStatus, 0)
						pipe.Set(redis.ctx, redis.prefix+":ultimo_erro", lastErrorMsg, 0)
						pipe.Set(redis.ctx, redis.prefix+":erros_consecutivos", consecutiveErrors, 0)
						pipe.Exec(redis.ctx)
					}

					// Pausa mais longa após muitas falhas consecutivas
					time.Sleep(ReconnectDelay)
				}

				continue
			}

			// Resetar contador de erros se comunicação bem sucedida
			if consecutiveErrors > 0 {
				log.Printf("Comunicação com o radar restaurada após %d tentativas", consecutiveErrors)
				consecutiveErrors = 0
				radarStatus = "ok"

				// Atualiza status no Redis
				if redis.enabled {
					redis.client.Set(redis.ctx, redis.prefix+":status", radarStatus, 0)
				}
			}

			// Decodifica a resposta
			metrics, err := radar.DecodeValues(response)
			if err != nil {
				log.Printf("Erro ao decodificar valores: %v", err)
				continue
			}

			if metrics != nil {
				// Verifica se o radar está obstruído (todas posições zero)
				allZero := true
				for _, pos := range metrics.Positions {
					if pos != 0 {
						allZero = false
						break
					}
				}

				if allZero {
					metrics.Status = "obstruido"
					log.Println("ALERTA: Radar possivelmente obstruído - todas as posições são zero!")
				}

				// Detecta mudanças nas velocidades
				DetectVelocityChanges(metrics, lastVelocities)

				// Atualiza para a próxima comparação
				lastVelocities = metrics.Velocities

				// Envia dados para o Redis
				if redis.enabled {
					// Sempre envia métricas completas
					if err := redis.WriteMetrics(metrics); err != nil {
						log.Printf("Erro ao escrever métricas no Redis: %v", err)
					}

					// Se houver mudanças de velocidade, registra separadamente
					if len(metrics.VelocityChanges) > 0 {
						if err := redis.WriteVelocityChanges(metrics.VelocityChanges); err != nil {
							log.Printf("Erro ao escrever mudanças de velocidade no Redis: %v", err)
						}
					}
				}
			} else {
				log.Println("Nenhuma métrica válida extraída da resposta")
			}
		}
	}
}
