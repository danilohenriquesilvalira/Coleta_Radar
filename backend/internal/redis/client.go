package redis

import (
	"context"
	"fmt"
	"time"

	"radar_go/internal/config"
	"radar_go/pkg/logger"

	"github.com/go-redis/redis/v8"
)

// Client encapsula a conexão e operações com o Redis
type Client struct {
	client    *redis.Client
	ctx       context.Context
	prefix    string
	config    config.RedisConfig
	connected bool
}

// NewClient cria um novo cliente Redis
func NewClient(cfg config.RedisConfig) *Client {
	// Criar contexto base
	ctx := context.Background()

	// Se Redis estiver desabilitado, retornar cliente vazio
	if !cfg.Enabled {
		logger.Info("Cliente Redis desabilitado por configuração")
		return &Client{
			ctx:       ctx,
			config:    cfg,
			connected: false,
			prefix:    cfg.Prefix,
		}
	}

	// Configurar endereço
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	// Criar cliente Redis
	redisClient := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	client := &Client{
		client:    redisClient,
		ctx:       ctx,
		config:    cfg,
		prefix:    cfg.Prefix,
		connected: false,
	}

	return client
}

// Connect tenta estabelecer conexão com o Redis
func (c *Client) Connect() error {
	if !c.config.Enabled {
		return fmt.Errorf("cliente Redis desabilitado por configuração")
	}

	if c.client == nil {
		return fmt.Errorf("cliente Redis não inicializado")
	}

	// Testar a conexão com ping
	ctx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
	defer cancel()

	if _, err := c.client.Ping(ctx).Result(); err != nil {
		c.connected = false
		return fmt.Errorf("erro ao conectar ao Redis: %w", err)
	}

	c.connected = true
	logger.Infof("Conexão estabelecida com Redis em %s:%d", c.config.Host, c.config.Port)
	return nil
}

// IsConnected verifica se o cliente está conectado
func (c *Client) IsConnected() bool {
	if !c.config.Enabled || c.client == nil {
		return false
	}

	// Se ainda não tentou conectar, tenta agora
	if !c.connected {
		ctx, cancel := context.WithTimeout(c.ctx, 2*time.Second)
		defer cancel()

		if _, err := c.client.Ping(ctx).Result(); err != nil {
			return false
		}
		c.connected = true
	}

	return c.connected
}

// Close fecha a conexão com o Redis
func (c *Client) Close() error {
	if c.client == nil {
		return nil
	}

	if err := c.client.Close(); err != nil {
		return fmt.Errorf("erro ao fechar conexão Redis: %w", err)
	}

	c.connected = false
	logger.Info("Conexão com Redis fechada")
	return nil
}

// Pipeline cria uma nova pipeline de comandos Redis
func (c *Client) Pipeline() redis.Pipeliner {
	if c.client == nil {
		return nil
	}
	return c.client.Pipeline()
}

// GetContext retorna o contexto utilizado pelo cliente
func (c *Client) GetContext() context.Context {
	return c.ctx
}

// GetPrefix retorna o prefixo utilizado para chaves
func (c *Client) GetPrefix() string {
	return c.prefix
}

// GetClient retorna o cliente Redis subjacente
func (c *Client) GetClient() *redis.Client {
	return c.client
}

// FormatKey formata uma chave com o prefixo configurado
func (c *Client) FormatKey(key string) string {
	return fmt.Sprintf("%s:%s", c.prefix, key)
}

// Set define um valor em uma chave com expiração opcional
func (c *Client) Set(key string, value interface{}, expiration time.Duration) error {
	if !c.IsConnected() {
		return fmt.Errorf("Redis não conectado")
	}

	fullKey := c.FormatKey(key)
	cmd := c.client.Set(c.ctx, fullKey, value, expiration)
	return cmd.Err()
}

// Get obtém o valor de uma chave
func (c *Client) Get(key string) (string, error) {
	if !c.IsConnected() {
		return "", fmt.Errorf("Redis não conectado")
	}

	fullKey := c.FormatKey(key)
	cmd := c.client.Get(c.ctx, fullKey)
	return cmd.Result()
}

// Del remove uma ou mais chaves
func (c *Client) Del(keys ...string) (int64, error) {
	if !c.IsConnected() {
		return 0, fmt.Errorf("Redis não conectado")
	}

	fullKeys := make([]string, len(keys))
	for i, key := range keys {
		fullKeys[i] = c.FormatKey(key)
	}

	cmd := c.client.Del(c.ctx, fullKeys...)
	return cmd.Result()
}

// Exists verifica se uma chave existe
func (c *Client) Exists(key string) (bool, error) {
	if !c.IsConnected() {
		return false, fmt.Errorf("Redis não conectado")
	}

	fullKey := c.FormatKey(key)
	cmd := c.client.Exists(c.ctx, fullKey)
	if cmd.Err() != nil {
		return false, cmd.Err()
	}

	return cmd.Val() > 0, nil
}

// HSet define um campo em um hash
func (c *Client) HSet(key, field string, value interface{}) error {
	if !c.IsConnected() {
		return fmt.Errorf("Redis não conectado")
	}

	fullKey := c.FormatKey(key)
	cmd := c.client.HSet(c.ctx, fullKey, field, value)
	return cmd.Err()
}

// HGet obtém o valor de um campo em um hash
func (c *Client) HGet(key, field string) (string, error) {
	if !c.IsConnected() {
		return "", fmt.Errorf("Redis não conectado")
	}

	fullKey := c.FormatKey(key)
	cmd := c.client.HGet(c.ctx, fullKey, field)
	return cmd.Result()
}

// ZAdd adiciona um ou mais membros a um conjunto ordenado
func (c *Client) ZAdd(key string, score float64, member interface{}) error {
	if !c.IsConnected() {
		return fmt.Errorf("Redis não conectado")
	}

	fullKey := c.FormatKey(key)
	cmd := c.client.ZAdd(c.ctx, fullKey, &redis.Z{
		Score:  score,
		Member: member,
	})
	return cmd.Err()
}

// ZRange obtém um range de elementos de um conjunto ordenado
func (c *Client) ZRange(key string, start, stop int64) ([]string, error) {
	if !c.IsConnected() {
		return nil, fmt.Errorf("Redis não conectado")
	}

	fullKey := c.FormatKey(key)
	cmd := c.client.ZRange(c.ctx, fullKey, start, stop)
	return cmd.Result()
}

// ZRangeWithScores obtém um range de elementos com scores de um conjunto ordenado
func (c *Client) ZRangeWithScores(key string, start, stop int64) ([]redis.Z, error) {
	if !c.IsConnected() {
		return nil, fmt.Errorf("Redis não conectado")
	}

	fullKey := c.FormatKey(key)
	cmd := c.client.ZRangeWithScores(c.ctx, fullKey, start, stop)
	return cmd.Result()
}

// ZRemRangeByRank remove elementos de um conjunto ordenado por rank
func (c *Client) ZRemRangeByRank(key string, start, stop int64) (int64, error) {
	if !c.IsConnected() {
		return 0, fmt.Errorf("Redis não conectado")
	}

	fullKey := c.FormatKey(key)
	cmd := c.client.ZRemRangeByRank(c.ctx, fullKey, start, stop)
	return cmd.Result()
}

// Incr incrementa o valor de uma chave
func (c *Client) Incr(key string) (int64, error) {
	if !c.IsConnected() {
		return 0, fmt.Errorf("Redis não conectado")
	}

	fullKey := c.FormatKey(key)
	cmd := c.client.Incr(c.ctx, fullKey)
	return cmd.Result()
}
