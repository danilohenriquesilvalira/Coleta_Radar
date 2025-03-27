package discovery

import (
	"context"
	"fmt"
	"net"
	"os"
	"sync"

	"radar_go/pkg/logger"

	"github.com/grandcat/zeroconf"
)

const (
	// ServiceName é o nome do serviço para descoberta na rede
	ServiceName = "sick-radar-monitor"

	// ServiceDomain é o domínio para descoberta na rede
	ServiceDomain = "local."

	// ServiceType define o tipo de serviço
	ServiceType = "_sickradar._tcp"
)

// DiscoveryService gerencia a descoberta do serviço na rede local
type DiscoveryService struct {
	server       *zeroconf.Server
	ctx          context.Context
	cancel       context.CancelFunc
	mutex        sync.Mutex
	instanceName string
	port         int
	running      bool
	serverIP     string
}

// NewDiscoveryService cria um novo serviço de descoberta
func NewDiscoveryService(port int) *DiscoveryService {
	ctx, cancel := context.WithCancel(context.Background())

	// Gerar um nome de instância único
	hostname, _ := os.Hostname()
	instanceName := fmt.Sprintf("%s-radar", hostname)

	return &DiscoveryService{
		ctx:          ctx,
		cancel:       cancel,
		port:         port,
		instanceName: instanceName,
		running:      false,
	}
}

// Start inicia o serviço de descoberta
func (s *DiscoveryService) Start() error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.running {
		return nil
	}

	// Obter o endereço IP local
	ip, err := s.getLocalIP()
	if err != nil {
		return fmt.Errorf("erro ao obter IP local: %w", err)
	}
	s.serverIP = ip

	// Iniciar o servidor zeroconf
	server, err := zeroconf.Register(
		s.instanceName, // Nome de instância
		ServiceType,    // Tipo de serviço
		ServiceDomain,  // Domínio
		s.port,         // Porta
		[]string{ // Metadados
			fmt.Sprintf("version=1.0"),
			fmt.Sprintf("ip=%s", ip),
			fmt.Sprintf("name=SICK Radar Monitor"),
		},
		nil, // Interfaces de rede (todas)
	)

	if err != nil {
		return fmt.Errorf("erro ao registrar serviço de descoberta: %w", err)
	}

	s.server = server
	s.running = true

	logger.Infof("Serviço de descoberta iniciado em %s:%d (mDNS: %s.%s)",
		ip, s.port, s.instanceName, ServiceType)

	return nil
}

// Stop para o serviço de descoberta
func (s *DiscoveryService) Stop() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if !s.running {
		return
	}

	if s.server != nil {
		s.server.Shutdown()
		s.server = nil
	}

	s.cancel()
	s.running = false

	logger.Info("Serviço de descoberta parado")
}

// GetServerIP retorna o IP do servidor
func (s *DiscoveryService) GetServerIP() string {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.serverIP
}

// GetPort retorna a porta do servidor
func (s *DiscoveryService) GetPort() int {
	return s.port
}

// getLocalIP obtém o endereço IP local
func (s *DiscoveryService) getLocalIP() (string, error) {
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

	return "", fmt.Errorf("não foi possível determinar o endereço IP local")
}

// GetInstanceName retorna o nome da instância do serviço
func (s *DiscoveryService) GetInstanceName() string {
	return s.instanceName
}

// IsRunning verifica se o serviço está em execução
func (s *DiscoveryService) IsRunning() bool {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.running
}
