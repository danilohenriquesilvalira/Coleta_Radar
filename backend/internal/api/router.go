package api

import (
	"net/http"
	"strings"

	"radar_go/internal/radar"
	"radar_go/internal/redis"
	"radar_go/pkg/logger"
)

// Router gerencia as rotas da API
type Router struct {
	handler     *Handler
	mux         *http.ServeMux
	basePath    string
	middlewares []Middleware
}

// NewRouter cria um novo router para a API
func NewRouter(radarService *radar.Service, redisService *redis.Service, basePath string) *Router {
	handler := NewHandler(radarService, redisService)

	// Normalizar base path
	if basePath != "" && !strings.HasPrefix(basePath, "/") {
		basePath = "/" + basePath
	}
	if basePath != "" && strings.HasSuffix(basePath, "/") {
		basePath = basePath[:len(basePath)-1]
	}

	// Configurar middlewares padrão
	middlewares := []Middleware{
		LoggingMiddleware,
		RecoveryMiddleware,
		CorsMiddleware,
	}

	return &Router{
		handler:     handler,
		mux:         http.NewServeMux(),
		basePath:    basePath,
		middlewares: middlewares,
	}
}

// Setup configura todas as rotas
func (r *Router) Setup() {
	// Rota para verificar status
	r.mux.Handle(r.path("/status"), r.applyMiddleware(http.HandlerFunc(r.handler.GetStatus)))

	// Rota para obter dados atuais
	r.mux.Handle(r.path("/current"), r.applyMiddleware(http.HandlerFunc(r.handler.GetCurrentData)))

	// Rota para obter mudanças de velocidade
	r.mux.Handle(r.path("/velocity-changes"), r.applyMiddleware(http.HandlerFunc(r.handler.GetVelocityChanges)))

	// Rota para obter histórico de velocidade
	r.mux.Handle(r.path("/velocity-history/"), r.applyMiddleware(http.HandlerFunc(r.handler.GetVelocityHistory)))

	// Rota para obter última atualização
	r.mux.Handle(r.path("/latest-update"), r.applyMiddleware(http.HandlerFunc(r.handler.GetLatestUpdate)))

	logger.Infof("API configurada com base path: %s", r.basePath)
}

// Handler retorna o handler HTTP final com todos os middlewares aplicados
func (r *Router) Handler() http.Handler {
	return r.applyMiddleware(r.mux)
}

// AddMiddleware adiciona um novo middleware
func (r *Router) AddMiddleware(middleware Middleware) {
	r.middlewares = append(r.middlewares, middleware)
}

// path retorna o caminho completo para uma rota
func (r *Router) path(route string) string {
	if !strings.HasPrefix(route, "/") {
		route = "/" + route
	}
	return r.basePath + route
}

// applyMiddleware aplica todos os middlewares ao handler
func (r *Router) applyMiddleware(handler http.Handler) http.Handler {
	if len(r.middlewares) == 0 {
		return handler
	}

	return Chain(r.middlewares...)(handler)
}

// ServeHTTP implementa a interface http.Handler
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	handler := r.Handler()
	handler.ServeHTTP(w, req)
}
