package config

import (
	"encoding/json"
	"os"
	"time"
)

// Config representa a configuração completa da aplicação
type Config struct {
	Server ServerConfig `json:"server"`
	Radar  RadarConfig  `json:"radar"`
	Redis  RedisConfig  `json:"redis"`
	PLC    PLCConfig    `json:"plc"`
}

// ServerConfig contém configurações do servidor HTTP/WebSocket
type ServerConfig struct {
	Port            int           `json:"port"`
	ReadTimeout     time.Duration `json:"readTimeout"`
	WriteTimeout    time.Duration `json:"writeTimeout"`
	ShutdownTimeout time.Duration `json:"shutdownTimeout"`
}

// RadarConfig contém configurações do Radar SICK
type RadarConfig struct {
	Host                 string        `json:"host"`
	Port                 int           `json:"port"`
	Protocol             string        `json:"protocol"`
	SampleRate           time.Duration `json:"sampleRate"`
	MaxConsecutiveErrors int           `json:"maxConsecutiveErrors"`
	ReconnectDelay       time.Duration `json:"reconnectDelay"`
	Debug                bool          `json:"debug"`
}

// RedisConfig contém configurações do Redis
type RedisConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Password string `json:"password"`
	DB       int    `json:"db"`
	Prefix   string `json:"prefix"`
	Enabled  bool   `json:"enabled"`
}

// PLCConfig contém configurações para comunicação com o PLC S71500
type PLCConfig struct {
	Enabled      bool          `json:"enabled"`
	Host         string        `json:"host"`
	Rack         int           `json:"rack"`
	Slot         int           `json:"slot"`
	UpdateRate   time.Duration `json:"updateRate"`
	ReadTimeout  time.Duration `json:"readTimeout"`
	WriteTimeout time.Duration `json:"writeTimeout"`
}

// Load carrega a configuração do arquivo ou usa valores padrão
func Load() (*Config, error) {
	config := getDefaultConfig()

	// Verificar se existe um arquivo de configuração
	if _, err := os.Stat("config.json"); err == nil {
		file, err := os.Open("config.json")
		if err != nil {
			return nil, err
		}
		defer file.Close()

		decoder := json.NewDecoder(file)
		if err := decoder.Decode(&config); err != nil {
			return nil, err
		}
	}

	// Sobrescrever com variáveis de ambiente, se existirem
	applyEnvironmentOverrides(&config)

	return &config, nil
}

// applyEnvironmentOverrides sobrescreve configurações com variáveis de ambiente
func applyEnvironmentOverrides(config *Config) {
	// Implementar a lógica para substituir configurações por variáveis de ambiente
	// Exemplo: RADAR_HOST, REDIS_PORT, SERVER_PORT, etc.
}
