package logger

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

// Level representa o nível de log
type Level int

const (
	// DEBUG nível para mensagens detalhadas de depuração
	DEBUG Level = iota
	// INFO nível para informações gerais
	INFO
	// WARN nível para avisos
	WARN
	// ERROR nível para erros
	ERROR
	// FATAL nível para erros fatais (encerra o programa)
	FATAL
)

var (
	// Nível mínimo de log
	logLevel = INFO

	// Saídas de log
	logOutput     io.Writer = os.Stdout
	errorOutput   io.Writer = os.Stderr
	fileOutput    io.WriteCloser
	fileOutputErr io.WriteCloser

	// Formato de timestamp
	timeFormat = "2006-01-02 15:04:05.000"

	// Logs padrão - importante: definir depois da inicialização
	infoLogger  *log.Logger
	warnLogger  *log.Logger
	errorLogger *log.Logger
	debugLogger *log.Logger

	// Flag para incluir o nome do arquivo nos logs
	includeFile = true

	// Mutex para operações de configuração
	mu sync.Mutex

	// Inicialização já realizada
	initialized = false
)

// Init inicializa o logger
func Init() {
	mu.Lock()
	defer mu.Unlock()

	if initialized {
		return
	}

	// Configurar loggers
	infoLogger = log.New(logOutput, "", 0)
	warnLogger = log.New(logOutput, "", 0)
	errorLogger = log.New(errorOutput, "", 0)
	debugLogger = log.New(logOutput, "", 0)

	initialized = true
}

// SetLevel define o nível mínimo de log
func SetLevel(level Level) {
	mu.Lock()
	defer mu.Unlock()
	logLevel = level
}

// GetLevel retorna o nível atual de log
func GetLevel() Level {
	mu.Lock()
	defer mu.Unlock()
	return logLevel
}

// IsDebugEnabled verifica se o nível de debug está habilitado
func IsDebugEnabled() bool {
	return GetLevel() <= DEBUG
}

// SetOutput define a saída para todos os logs
func SetOutput(w io.Writer) {
	mu.Lock()
	defer mu.Unlock()

	logOutput = w
	errorOutput = w

	// Recriar loggers com a nova saída
	infoLogger = log.New(w, "", 0)
	warnLogger = log.New(w, "", 0)
	errorLogger = log.New(w, "", 0)
	debugLogger = log.New(w, "", 0)
}

// SetTimeFormat define o formato de timestamp
func SetTimeFormat(format string) {
	mu.Lock()
	defer mu.Unlock()
	timeFormat = format
}

// EnableFileLogging habilita o log para arquivo
func EnableFileLogging(logDir, prefix string) error {
	mu.Lock()
	defer mu.Unlock()

	// Criar diretório, se não existir
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return fmt.Errorf("erro ao criar diretório de log: %w", err)
	}

	// Obter data/hora atual para nome do arquivo
	timestamp := time.Now().Format("20060102_150405")
	if prefix != "" {
		prefix = prefix + "_"
	}

	// Criar arquivo de log normal
	logFilePath := filepath.Join(logDir, fmt.Sprintf("%s%s.log", prefix, timestamp))
	logFile, err := os.OpenFile(logFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("erro ao criar arquivo de log: %w", err)
	}

	// Criar arquivo de log de erro
	errFilePath := filepath.Join(logDir, fmt.Sprintf("%s%s_error.log", prefix, timestamp))
	errFile, err := os.OpenFile(errFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		logFile.Close()
		return fmt.Errorf("erro ao criar arquivo de log de erro: %w", err)
	}

	// Fechar arquivos anteriores, se existirem
	if fileOutput != nil {
		fileOutput.Close()
	}
	if fileOutputErr != nil {
		fileOutputErr.Close()
	}

	// Configurar novos arquivos
	fileOutput = logFile
	fileOutputErr = errFile

	// Configurar saídas mistas (terminal + arquivo)
	multiOut := io.MultiWriter(logOutput, logFile)
	multiErr := io.MultiWriter(errorOutput, errFile)

	infoLogger = log.New(multiOut, "", 0)
	warnLogger = log.New(multiOut, "", 0)
	debugLogger = log.New(multiOut, "", 0)
	errorLogger = log.New(multiErr, "", 0)

	// Registrar início do log
	Info("Logging iniciado")
	return nil
}

// Sync persiste os logs em disco (para IO bufferizado)
func Sync() {
	mu.Lock()
	defer mu.Unlock()

	// Fechar arquivos de log
	if fileOutput != nil {
		fileOutput.Close()
		fileOutput = nil
	}
	if fileOutputErr != nil {
		fileOutputErr.Close()
		fileOutputErr = nil
	}
}

// GetLogger retorna uma interface que pode ser usada por outros pacotes
func GetLogger() *log.Logger {
	return infoLogger
}

// logMessage escreve uma mensagem de log com o nível especificado
func logMessage(level Level, format string, args ...interface{}) {
	if level < logLevel {
		return
	}

	// Obter timestamp
	timestamp := time.Now().Format(timeFormat)

	var loggerToUse *log.Logger
	var prefix string

	switch level {
	case DEBUG:
		loggerToUse = debugLogger
		prefix = "DEBUG"
	case INFO:
		loggerToUse = infoLogger
		prefix = "INFO "
	case WARN:
		loggerToUse = warnLogger
		prefix = "WARN "
	case ERROR:
		loggerToUse = errorLogger
		prefix = "ERROR"
	case FATAL:
		loggerToUse = errorLogger
		prefix = "FATAL"
	}

	// Fonte do log (arquivo e linha)
	var source string
	if includeFile {
		_, file, line, ok := runtime.Caller(2)
		if ok {
			// Extrair somente o nome do arquivo (sem o caminho)
			file = filepath.Base(file)
			source = fmt.Sprintf(" [%s:%d]", file, line)
		}
	}

	// Formatar mensagem
	var msg string
	if len(args) == 0 {
		msg = format
	} else {
		msg = fmt.Sprintf(format, args...)
	}

	// Verificar se o logger foi inicializado
	if loggerToUse == nil {
		// Fallback para stderr
		fmt.Fprintf(os.Stderr, "[%s] %s%s: %s\n", timestamp, prefix, source, msg)
	} else {
		// Escrever log
		loggerToUse.Printf("[%s] %s%s: %s", timestamp, prefix, source, msg)
	}

	// Se for FATAL, finalizar o programa
	if level == FATAL {
		panic(msg)
	}
}

// Debug escreve mensagem de log com nível DEBUG
func Debug(msg string) {
	logMessage(DEBUG, "%s", msg)
}

// Debugf escreve mensagem de log formatada com nível DEBUG
func Debugf(format string, args ...interface{}) {
	logMessage(DEBUG, format, args...)
}

// Info escreve mensagem de log com nível INFO
func Info(msg string) {
	logMessage(INFO, "%s", msg)
}

// Infof escreve mensagem de log formatada com nível INFO
func Infof(format string, args ...interface{}) {
	logMessage(INFO, format, args...)
}

// Warn escreve mensagem de log com nível WARN
func Warn(msg string) {
	logMessage(WARN, "%s", msg)
}

// Warnf escreve mensagem de log formatada com nível WARN
func Warnf(format string, args ...interface{}) {
	logMessage(WARN, format, args...)
}

// Error escreve mensagem de log com nível ERROR
func Error(msg string, err error) {
	if err != nil {
		logMessage(ERROR, "%s: %v", msg, err)
	} else {
		logMessage(ERROR, "%s", msg)
	}
}

// Errorf escreve mensagem de log formatada com nível ERROR
func Errorf(format string, args ...interface{}) {
	logMessage(ERROR, format, args...)
}

// Fatal escreve mensagem de log com nível FATAL e encerra o programa
func Fatal(msg string, err error) {
	if err != nil {
		logMessage(FATAL, "%s: %v", msg, err)
	} else {
		logMessage(FATAL, "%s", msg)
	}
}

// Fatalf escreve mensagem de log formatada com nível FATAL e encerra o programa
func Fatalf(format string, args ...interface{}) {
	logMessage(FATAL, format, args...)
}
