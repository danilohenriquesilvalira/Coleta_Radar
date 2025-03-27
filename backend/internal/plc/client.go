package plc

import (
	"encoding/binary"
	"fmt"
	"math"
	"sync"
	"time"

	"radar_go/internal/config"
	"radar_go/pkg/logger"

	"github.com/robinson/gos7"
)

// S7Client encapsula a comunicação com o PLC S7-1500
type S7Client struct {
	client       gos7.Client
	handler      *gos7.TCPClientHandler
	config       config.PLCConfig
	connected    bool
	lastError    error
	connectMutex sync.Mutex
}

// NewS7Client cria um novo cliente para PLC S7
func NewS7Client(cfg config.PLCConfig) *S7Client {
	return &S7Client{
		config:    cfg,
		connected: false,
	}
}

// Connect estabelece conexão com o PLC
func (c *S7Client) Connect() error {
	c.connectMutex.Lock()
	defer c.connectMutex.Unlock()

	if c.connected {
		return nil
	}

	// Desconectar se já houver conexão anterior
	if c.handler != nil {
		c.handler.Close()
	}

	// Criar configuração para o S7
	handler := gos7.NewTCPClientHandler(c.config.Host, c.config.Rack, c.config.Slot)
	handler.Timeout = c.config.ReadTimeout
	handler.IdleTimeout = 70 * time.Second
	// Não usar logger.GetLogger() aqui, pois pode não ser compatível
	// Remova ou comente esta linha:
	// handler.Logger = logger.GetLogger()

	// Conectar
	if err := handler.Connect(); err != nil {
		c.lastError = fmt.Errorf("erro ao conectar ao PLC: %w", err)
		logger.Error("Falha ao conectar ao PLC", err)
		return c.lastError
	}

	c.handler = handler
	c.client = gos7.NewClient(handler)
	c.connected = true
	logger.Infof("Conectado ao PLC em %s (Rack: %d, Slot: %d)",
		c.config.Host, c.config.Rack, c.config.Slot)

	return nil
}

// Disconnect fecha a conexão com o PLC
func (c *S7Client) Disconnect() {
	c.connectMutex.Lock()
	defer c.connectMutex.Unlock()

	if c.handler != nil {
		c.handler.Close()
		c.handler = nil
		c.client = nil
		c.connected = false
		logger.Info("Desconectado do PLC")
	}
}

// IsConnected verifica se o cliente está conectado
func (c *S7Client) IsConnected() bool {
	c.connectMutex.Lock()
	defer c.connectMutex.Unlock()
	return c.connected
}

// CheckConnection testa a conexão com o PLC
func (c *S7Client) CheckConnection() error {
	c.connectMutex.Lock()
	defer c.connectMutex.Unlock()

	if !c.connected {
		return fmt.Errorf("não conectado ao PLC")
	}

	// Tentar ler um byte do DB1 para testar a conexão
	buffer := make([]byte, 1)
	err := c.client.AGReadDB(1, 0, 1, buffer)
	if err != nil {
		c.connected = false
		c.lastError = fmt.Errorf("erro ao testar conexão com PLC: %w", err)
		return c.lastError
	}

	return nil
}

// ReadDataBlock lê um bloco de dados do PLC
func (c *S7Client) ReadDataBlock(dbNumber int, startOffset int, size int) ([]byte, error) {
	if err := c.ensureConnected(); err != nil {
		return nil, err
	}

	buffer := make([]byte, size)
	if err := c.client.AGReadDB(dbNumber, startOffset, size, buffer); err != nil {
		c.connected = false
		return nil, fmt.Errorf("erro ao ler DB%d: %w", dbNumber, err)
	}

	return buffer, nil
}

// WriteDataBlock escreve em um bloco de dados do PLC
func (c *S7Client) WriteDataBlock(dbNumber int, startOffset int, data []byte) error {
	if err := c.ensureConnected(); err != nil {
		return err
	}

	if err := c.client.AGWriteDB(dbNumber, startOffset, len(data), data); err != nil {
		c.connected = false
		return fmt.Errorf("erro ao escrever DB%d: %w", dbNumber, err)
	}

	return nil
}

// ReadFloat lê um valor float (REAL) do PLC
func (c *S7Client) ReadFloat(dbNumber int, offset int) (float32, error) {
	data, err := c.ReadDataBlock(dbNumber, offset, 4)
	if err != nil {
		return 0, err
	}

	// Converter bytes para float32 (formato IEEE 754)
	bits := binary.BigEndian.Uint32(data)
	return math.Float32frombits(bits), nil
}

// WriteFloat escreve um valor float (REAL) no PLC
func (c *S7Client) WriteFloat(dbNumber int, offset int, value float32) error {
	data := make([]byte, 4)
	bits := math.Float32bits(value)
	binary.BigEndian.PutUint32(data, bits)

	return c.WriteDataBlock(dbNumber, offset, data)
}

// ReadInt lê um valor inteiro (INT) do PLC
func (c *S7Client) ReadInt(dbNumber int, offset int) (int16, error) {
	data, err := c.ReadDataBlock(dbNumber, offset, 2)
	if err != nil {
		return 0, err
	}

	return int16(binary.BigEndian.Uint16(data)), nil
}

// WriteInt escreve um valor inteiro (INT) no PLC
func (c *S7Client) WriteInt(dbNumber int, offset int, value int16) error {
	data := make([]byte, 2)
	binary.BigEndian.PutUint16(data, uint16(value))

	return c.WriteDataBlock(dbNumber, offset, data)
}

// ReadDInt lê um valor inteiro de 32 bits (DINT) do PLC
func (c *S7Client) ReadDInt(dbNumber int, offset int) (int32, error) {
	data, err := c.ReadDataBlock(dbNumber, offset, 4)
	if err != nil {
		return 0, err
	}

	return int32(binary.BigEndian.Uint32(data)), nil
}

// WriteDInt escreve um valor inteiro de 32 bits (DINT) no PLC
func (c *S7Client) WriteDInt(dbNumber int, offset int, value int32) error {
	data := make([]byte, 4)
	binary.BigEndian.PutUint32(data, uint32(value))

	return c.WriteDataBlock(dbNumber, offset, data)
}

// ReadBool lê um valor booleano (BOOL) do PLC
func (c *S7Client) ReadBool(dbNumber int, offset int, bitIndex int) (bool, error) {
	if bitIndex < 0 || bitIndex > 7 {
		return false, fmt.Errorf("índice de bit inválido: %d (deve ser 0-7)", bitIndex)
	}

	data, err := c.ReadDataBlock(dbNumber, offset, 1)
	if err != nil {
		return false, err
	}

	return (data[0] & (1 << bitIndex)) != 0, nil
}

// WriteBool escreve um valor booleano (BOOL) no PLC
func (c *S7Client) WriteBool(dbNumber int, offset int, bitIndex int, value bool) error {
	if bitIndex < 0 || bitIndex > 7 {
		return fmt.Errorf("índice de bit inválido: %d (deve ser 0-7)", bitIndex)
	}

	data, err := c.ReadDataBlock(dbNumber, offset, 1)
	if err != nil {
		return err
	}

	if value {
		// Definir bit
		data[0] |= (1 << bitIndex)
	} else {
		// Limpar bit
		data[0] &= ^(1 << bitIndex)
	}

	return c.WriteDataBlock(dbNumber, offset, data)
}

// ensureConnected garante que o cliente está conectado
func (c *S7Client) ensureConnected() error {
	if !c.connected {
		return c.Connect()
	}
	return nil
}

// GetLastError retorna o último erro ocorrido
func (c *S7Client) GetLastError() error {
	return c.lastError
}

// GetConfig retorna a configuração do cliente
func (c *S7Client) GetConfig() config.PLCConfig {
	return c.config
}
