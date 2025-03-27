package config

import "time"

// getDefaultConfig retorna uma configuração padrão
func getDefaultConfig() Config {
	return Config{
		Server: ServerConfig{
			Port:            8080,
			ReadTimeout:     30 * time.Second,
			WriteTimeout:    30 * time.Second,
			ShutdownTimeout: 10 * time.Second,
		},
		Radar: RadarConfig{
			Host:                 "192.168.1.84",
			Port:                 2111,
			Protocol:             "ascii",
			SampleRate:           100 * time.Millisecond,
			MaxConsecutiveErrors: 5,
			ReconnectDelay:       2 * time.Second,
			Debug:                true,
		},
		Redis: RedisConfig{
			Host:     "localhost",
			Port:     6379,
			Password: "",
			DB:       0,
			Prefix:   "radar_sick",
			Enabled:  true,
		},
		PLC: PLCConfig{
			Enabled:      false,
			Host:         "192.168.1.100",
			Rack:         0,
			Slot:         1,
			UpdateRate:   500 * time.Millisecond,
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 5 * time.Second,
		},
	}
}
