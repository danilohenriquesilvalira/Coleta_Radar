package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"radar_go/internal/config"
	"radar_go/internal/server"
	"radar_go/pkg/logger"
)

func main() {
	// Configurar diretório de logs
	logDir := filepath.Join(".", "logs")
	os.MkdirAll(logDir, 0755)

	// Inicializar logger
	logger.Init()
	logger.SetLevel(logger.DEBUG) // Usar DEBUG para ter mais informações durante desenvolvimento
	logger.EnableFileLogging(logDir, "radar")
	defer logger.Sync()

	// Exibir banner de inicialização
	displayBanner()

	logger.Info("Iniciando SICK Radar Monitor")

	// Carregar configurações
	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("Erro ao carregar configurações", err)
	}

	// Garantir que temos a taxa de amostragem correta para desempenho ideal
	if cfg.Radar.SampleRate > 100*time.Millisecond {
		logger.Warn("Taxa de amostragem muito baixa. Definindo para 100ms (10Hz)")
		cfg.Radar.SampleRate = 100 * time.Millisecond
	}

	logger.Infof("Configuração carregada: Radar em %s:%d, Redis em %s:%d",
		cfg.Radar.Host, cfg.Radar.Port, cfg.Redis.Host, cfg.Redis.Port)
	logger.Infof("Taxa de amostragem: %v", cfg.Radar.SampleRate)

	// Criar e iniciar o servidor
	srv, err := server.NewServer(cfg)
	if err != nil {
		logger.Fatal("Erro ao criar servidor", err)
	}

	// Iniciar o servidor em uma goroutine separada
	go func() {
		logger.Infof("Servidor iniciado na porta %d", cfg.Server.Port)
		if err := srv.Start(); err != nil {
			logger.Fatal("Erro ao iniciar o servidor", err)
		}
	}()

	// Configurar captura de sinais para shutdown gracioso
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Desligando servidor...")

	// Criar contexto com timeout para o shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Desligar o servidor
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("Erro durante o shutdown do servidor", err)
	}

	logger.Info("Servidor encerrado com sucesso")
}

// displayBanner exibe um banner de inicialização
func displayBanner() {
	banner := `
 _______ __   __ _______            _____  _______ _______ _______  ______ 
 |______   \_/   |       |      |  |     | |_____| |  |  | |_____| |_____/ 
 ______|    |    |_____  |_____ |_ |_____| |     | |  |  | |     | |    \_
                                                                           
 _______ _______  ______       __   __ _______ __   _ _____ _______ _______  ______
 |  |  | |       |    _ |        \_/   |______ | \  |   |   |______ |_____| |_____/
 |  |  | |_____  |_____| .        |    |______ |  \_| __|__ |     | |     | |    \_  v1.0
                                                                   REAL-TIME EDITION
 `
	fmt.Println(banner)
	fmt.Printf("Iniciando em %s\n\n", time.Now().Format("2006-01-02 15:04:05"))
}
