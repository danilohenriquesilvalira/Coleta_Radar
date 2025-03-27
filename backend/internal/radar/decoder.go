package radar

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"radar_go/internal/models"
	"radar_go/pkg/logger"
)

// decodeASCII decodifica a resposta no formato ASCII
func (r *RadarClient) decodeASCII(response string, metrics *models.RadarMetrics) (*models.RadarMetrics, error) {
	if len(response) == 0 {
		return nil, fmt.Errorf("resposta vazia do radar")
	}

	// Exibir resposta para depuração
	if logger.IsDebugEnabled() {
		logger.Debug("Resposta ASCII do radar:")
		logger.Debug(response)

		// Converter para hexadecimal para depuração
		hexDump := ""
		for i, c := range response {
			if i < 50 { // Limita para os primeiros 50 caracteres
				hexDump += fmt.Sprintf("%02X ", c)
			}
		}
		logger.Debug("Hex dump dos primeiros 50 bytes:")
		logger.Debug(hexDump)
	}

	// Remove caracteres de controle e divide em tokens
	cleanedResponse := strings.Map(func(r rune) rune {
		if r < 32 || r > 126 {
			return ' ' // Substitui caracteres de controle por espaço
		}
		return r
	}, response)

	tokens := strings.Fields(cleanedResponse)

	// Processar o bloco de posições (P3DX1)
	if err := r.processPositionBlock(tokens, metrics); err != nil {
		logger.Warnf("Erro ao processar bloco de posições: %v", err)
		// Continuar mesmo com erro, para tentar processar velocidades
	}

	// Processar o bloco de velocidades (V3DX1)
	if err := r.processVelocityBlock(tokens, metrics); err != nil {
		logger.Warnf("Erro ao processar bloco de velocidades: %v", err)
		// Continuar mesmo com erro, métricas podem estar parcialmente preenchidas
	}

	return metrics, nil
}

// decodeBinary decodifica a resposta no formato binário
func (r *RadarClient) decodeBinary(response string, metrics *models.RadarMetrics) (*models.RadarMetrics, error) {
	// Implementar decodificação binária se necessário
	// Atualmente, apenas o modo ASCII é suportado
	return nil, fmt.Errorf("protocolo binário ainda não implementado")
}

// processPositionBlock processa o bloco de posições na resposta
func (r *RadarClient) processPositionBlock(tokens []string, metrics *models.RadarMetrics) error {
	// Procura o bloco de posições (P3DX1)
	posIdx := -1
	for i, token := range tokens {
		if token == "P3DX1" {
			posIdx = i
			break
		}
	}

	if posIdx == -1 || posIdx+3 >= len(tokens) {
		return fmt.Errorf("bloco de posição (P3DX1) não encontrado ou formato inesperado")
	}

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

	logger.Debugf("Bloco de Posição (P3DX1) encontrado. Escala: %f", scale)

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

		logger.Debugf("  pos%d: HEX=%s -> DEC=%d -> %.3fm", i+1, valHex, decimalValue, posMeters)
	}

	return nil
}

// processVelocityBlock processa o bloco de velocidades na resposta
func (r *RadarClient) processVelocityBlock(tokens []string, metrics *models.RadarMetrics) error {
	// Procura o bloco de velocidades (V3DX1)
	velIdx := -1
	for i, token := range tokens {
		if token == "V3DX1" {
			velIdx = i
			break
		}
	}

	if velIdx == -1 || velIdx+3 >= len(tokens) {
		return fmt.Errorf("bloco de velocidade (V3DX1) não encontrado ou formato inesperado")
	}

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

	logger.Debugf("Bloco de Velocidade (V3DX1) encontrado. Escala: %f", scale)

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

		logger.Debugf("  vel%d: HEX=%s -> DEC=%d -> %.3fm/s", i+1, valHex, decimalValue, velMS)
	}

	return nil
}

// hexStringToFloat32 converte uma string hexadecimal IEEE-754 para float32
func hexStringToFloat32(hexStr string) float32 {
	// Converte a string hexadecimal para um uint32
	val, err := strconv.ParseUint(hexStr, 16, 32)
	if err != nil {
		logger.Errorf("Erro ao converter %s para float: %v", hexStr, err)
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
