package radar

import (
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"radar_go/internal/models"
	"radar_go/pkg/logger"
)

// RadarClient gerencia a comunicação com o radar
type RadarClient struct {
	conn      net.Conn
	host      string
	port      int
	connected bool
	protocol  string // "ascii" ou "binary"
	mutex     sync.Mutex
}

// NewRadarClient cria uma nova instância do cliente do radar
func NewRadarClient(host string, port int, protocol string) *RadarClient {
	return &RadarClient{
		host:     host,
		port:     port,
		protocol: strings.ToLower(protocol),
	}
}

// Connect estabelece conexão com o radar
func (r *RadarClient) Connect() error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	if r.connected {
		return nil
	}

	addr := fmt.Sprintf("%s:%d", r.host, r.port)
	logger.Infof("Tentando conectar ao radar em %s...", addr)

	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		return fmt.Errorf("erro ao conectar ao radar: %w", err)
	}

	r.conn = conn
	r.connected = true
	logger.Infof("Conectado ao radar em %s", addr)
	return nil
}

// SendCommand envia comando para o radar
func (r *RadarClient) SendCommand(cmd string) (string, error) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

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
		return "", fmt.Errorf("erro ao enviar comando: %w", err)
	}

	// Lê a resposta com timeout
	buffer := make([]byte, 4096)
	r.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	n, err := r.conn.Read(buffer)
	if err != nil {
		r.connected = false
		return "", fmt.Errorf("erro ao ler resposta: %w", err)
	}

	return string(buffer[:n]), nil
}

// DecodeValues decodifica a resposta do radar em métricas
func (r *RadarClient) DecodeValues(response string) (*models.RadarMetrics, error) {
	metrics := &models.RadarMetrics{
		Timestamp: time.Now(),
		Status:    "ok",
	}

	// Implementar a lógica de decodificação específica para o protocolo (ASCII ou binário)
	switch r.protocol {
	case "ascii":
		return r.decodeASCII(response, metrics)
	case "binary":
		return r.decodeBinary(response, metrics)
	default:
		return nil, fmt.Errorf("protocolo não suportado: %s", r.protocol)
	}
}

// SetConnected define o estado de conexão
func (r *RadarClient) SetConnected(connected bool) {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	r.connected = connected
}

// IsConnected verifica se o cliente está conectado
func (r *RadarClient) IsConnected() bool {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	return r.connected
}

// Close fecha a conexão com o radar
func (r *RadarClient) Close() {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	if r.conn != nil {
		r.conn.Close()
		r.connected = false
		logger.Info("Conexão com o radar fechada")
	}
}
