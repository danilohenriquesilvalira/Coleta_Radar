package api

import (
	"net/http"
	"time"

	"radar_go/pkg/logger"
)

// Middleware representa uma função de middleware HTTP
type Middleware func(http.Handler) http.Handler

// Chain combina múltiplos middlewares em uma única função
func Chain(middlewares ...Middleware) Middleware {
	return func(next http.Handler) http.Handler {
		for i := len(middlewares) - 1; i >= 0; i-- {
			next = middlewares[i](next)
		}
		return next
	}
}

// LoggingMiddleware registra informações sobre requisições HTTP
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Registrar requisição
		logger.Infof("%s %s %s", r.Method, r.URL.Path, r.RemoteAddr)

		// Criar um wrapper para o ResponseWriter para capturar o status code
		rw := newResponseWriter(w)
		next.ServeHTTP(rw, r)

		// Registrar resposta
		duration := time.Since(start)
		logger.Infof("%d %s %s %s (%.3fs)", rw.statusCode, r.Method, r.URL.Path, r.RemoteAddr, duration.Seconds())
	})
}

// RecoveryMiddleware recupera de panics na aplicação
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				logger.Errorf("Panic capturado: %v", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()

		next.ServeHTTP(w, r)
	})
}

// CorsMiddleware adiciona cabeçalhos CORS à resposta
func CorsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Definir cabeçalhos CORS
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		// Tratar requisições OPTIONS
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// responseWriter é um wrapper para http.ResponseWriter que captura o status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

// newResponseWriter cria um novo responseWriter
func newResponseWriter(w http.ResponseWriter) *responseWriter {
	return &responseWriter{w, http.StatusOK}
}

// WriteHeader implementa a interface http.ResponseWriter
func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}
