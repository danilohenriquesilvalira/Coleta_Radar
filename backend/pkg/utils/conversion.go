package utils

import (
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// FloatToBytes converte um valor float64 para bytes (formato IEEE 754)
func FloatToBytes(val float64) []byte {
	bits := math.Float64bits(val)
	bytes := make([]byte, 8)
	binary.BigEndian.PutUint64(bytes, bits)
	return bytes
}

// BytesToFloat converte bytes para float64 (formato IEEE 754)
func BytesToFloat(bytes []byte) float64 {
	bits := binary.BigEndian.Uint64(bytes)
	return math.Float64frombits(bits)
}

// Float32ToBytes converte um valor float32 para bytes (formato IEEE 754)
func Float32ToBytes(val float32) []byte {
	bits := math.Float32bits(val)
	bytes := make([]byte, 4)
	binary.BigEndian.PutUint32(bytes, bits)
	return bytes
}

// BytesToFloat32 converte bytes para float32 (formato IEEE 754)
func BytesToFloat32(bytes []byte) float32 {
	bits := binary.BigEndian.Uint32(bytes)
	return math.Float32frombits(bits)
}

// IntToBytes converte um valor int para bytes
func IntToBytes(val int) []byte {
	bytes := make([]byte, 4)
	binary.BigEndian.PutUint32(bytes, uint32(val))
	return bytes
}

// BytesToInt converte bytes para int
func BytesToInt(bytes []byte) int {
	return int(binary.BigEndian.Uint32(bytes))
}

// Int16ToBytes converte um valor int16 para bytes
func Int16ToBytes(val int16) []byte {
	bytes := make([]byte, 2)
	binary.BigEndian.PutUint16(bytes, uint16(val))
	return bytes
}

// BytesToInt16 converte bytes para int16
func BytesToInt16(bytes []byte) int16 {
	return int16(binary.BigEndian.Uint16(bytes))
}

// HexStringToFloat32 converte uma string hexadecimal IEEE-754 para float32
func HexStringToFloat32(hexStr string) float32 {
	// Remover prefixo "0x" se existir
	hexStr = strings.TrimPrefix(hexStr, "0x")

	// Converter string hexadecimal para uint32
	val, err := strconv.ParseUint(hexStr, 16, 32)
	if err != nil {
		return 0.0
	}

	// Converter uint32 para float32 usando IEEE-754
	return math.Float32frombits(uint32(val))
}

// SmallHexToInt converte uma string hexadecimal pequena para int
func SmallHexToInt(hexStr string) (int, error) {
	// Remover prefixo "0x" se existir
	hexStr = strings.TrimPrefix(hexStr, "0x")

	// Converter para int
	val, err := strconv.ParseInt(hexStr, 16, 32)
	if err != nil {
		return 0, err
	}

	return int(val), nil
}

// FormatFloat formata um float com precisão específica
func FormatFloat(value float64, precision int) string {
	format := "%." + strconv.Itoa(precision) + "f"
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf(format, value), "0"), ".")
}
