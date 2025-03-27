import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
  Animated
} from 'react-native';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import ApiService, { HistoryPoint } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import RealTimeChart from '../components/RealTimeChart';
import { colors, spacing } from '../styles/theme';

type HistoryScreenRouteProp = RouteProp<RootStackParamList, 'History'>;

const FILTER_OPTIONS = [
  { id: 'hour', label: '1 Hora', icon: 'time-outline' },
  { id: 'day', label: '24 Horas', icon: 'today-outline' },
  { id: 'week', label: '1 Semana', icon: 'calendar-outline' },
  { id: 'all', label: 'Tudo', icon: 'infinite-outline' }
];

const HistoryScreen: React.FC = () => {
  const route = useRoute<HistoryScreenRouteProp>();
  const { index } = route.params;
  
  const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
  const [filteredData, setFilteredData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'hour' | 'day' | 'week' | 'all'>('hour');
  const [stats, setStats] = useState({ min: 0, max: 0, avg: 0, count: 0 });
  
  // Animações para os valores estatísticos
  const [animatedStats] = useState({
    min: new Animated.Value(0),
    max: new Animated.Value(0),
    avg: new Animated.Value(0),
    count: new Animated.Value(0)
  });
  
  // Carregar dados do histórico
  const loadData = async () => {
    try {
      setError(null);
      const history = await ApiService.getVelocityHistory(index);
      setHistoryData(history);
      
      // Filtrar dados com base no intervalo de tempo selecionado
      filterData(history, timeRange);
    } catch (err) {
      setError('Falha ao carregar histórico de velocidade');
      console.error('Erro ao carregar histórico de velocidade:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  
  // Filtrar dados com base no intervalo de tempo
  const filterData = (data: HistoryPoint[], range: 'hour' | 'day' | 'week' | 'all') => {
    if (!data || data.length === 0) {
      setFilteredData([]);
      setStats({ min: 0, max: 0, avg: 0, count: 0 });
      return;
    }
    
    const now = Date.now();
    let filtered = [...data];
    
    switch (range) {
      case 'hour':
        filtered = data.filter(item => (now - item.timestamp) < 60 * 60 * 1000);
        break;
      case 'day':
        filtered = data.filter(item => (now - item.timestamp) < 24 * 60 * 60 * 1000);
        break;
      case 'week':
        filtered = data.filter(item => (now - item.timestamp) < 7 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      default:
        // Use all data
        break;
    }
    
    setFilteredData(filtered);
    
    // Calcular estatísticas
    if (filtered.length > 0) {
      const values = filtered.map(item => item.value);
      const newStats = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((sum, val) => sum + val, 0) / values.length,
        count: filtered.length
      };
      
      // Animar as mudanças nos valores estatísticos
      animateStatsChange(newStats);
      
      setStats(newStats);
    } else {
      setStats({ min: 0, max: 0, avg: 0, count: 0 });
    }
  };
  
  // Animar mudanças nas estatísticas
  const animateStatsChange = (newStats: typeof stats) => {
    // Animar cada estatística
    Animated.parallel([
      Animated.timing(animatedStats.min, {
        toValue: newStats.min,
        duration: 500,
        useNativeDriver: false
      }),
      Animated.timing(animatedStats.max, {
        toValue: newStats.max,
        duration: 500,
        useNativeDriver: false
      }),
      Animated.timing(animatedStats.avg, {
        toValue: newStats.avg,
        duration: 500,
        useNativeDriver: false
      }),
      Animated.timing(animatedStats.count, {
        toValue: newStats.count,
        duration: 500,
        useNativeDriver: false
      })
    ]).start();
  };
  
  // Carregar dados ao montar o componente
  useEffect(() => {
    loadData();
    
    // Configurar atualização em tempo real
    const unsubscribe = ApiService.subscribeToVelocityHistory(index, (history) => {
      setHistoryData(history);
      filterData(history, timeRange);
    });
    
    // Limpar ao desmontar
    return () => {
      unsubscribe();
    };
  }, [index]);
  
  // Observar mudanças no filtro de tempo
  useEffect(() => {
    filterData(historyData, timeRange);
  }, [timeRange]);
  
  // Recarregar dados quando a tela estiver em foco
  useFocusEffect(
    useCallback(() => {
      loadData();
      return () => {
        // Cleanup
      };
    }, [index])
  );
  
  // Atualizar manualmente
  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };
  
  // Mudar o intervalo de tempo
  const changeTimeRange = (range: 'hour' | 'day' | 'week' | 'all') => {
    setTimeRange(range);
  };
  
  // Formatar o tempo para exibição no gráfico
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  // Renderizar tela de carregamento
  if (loading) {
    return (
      <View style={styles.container}>
        <Header 
          title={`Histórico da Velocidade ${index}`} 
          showBack 
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.velocity[index - 1]} />
          <Text style={styles.loadingText}>Carregando histórico...</Text>
        </View>
      </View>
    );
  }
  
  // Renderizar tela de erro
  if (error) {
    return (
      <View style={styles.container}>
        <Header 
          title={`Histórico da Velocidade ${index}`} 
          showBack 
        />
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadData}>
            <Text style={styles.retryButtonText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  
  // Preparar dados para o gráfico
  const chartData = filteredData.map(point => point.value);
  
  // Preparar labels de tempo para o gráfico
  const timestamps = filteredData.map(point => point.timestamp);
  
  // Se tivermos muitos pontos, limitar o número de labels exibidas
  let labels: string[] = [];
  if (timestamps.length > 0) {
    const step = Math.max(1, Math.floor(timestamps.length / 6));
    labels = timestamps
      .filter((_, i) => i % step === 0)
      .map(formatTime);
  }
  
  return (
    <View style={styles.container}>
      <Header 
        title={`Histórico da Velocidade ${index}`} 
        showBack 
      />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Filtros de tempo */}
        <View style={styles.filterContainer}>
          {FILTER_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.filterButton,
                timeRange === option.id && styles.filterButtonActive
              ]}
              onPress={() => changeTimeRange(option.id as any)}
            >
              <Ionicons 
                name={option.icon as any} 
                size={16} 
                color={timeRange === option.id ? colors.text.inverse : colors.text.primary} 
              />
              <Text style={[
                styles.filterText,
                timeRange === option.id && styles.filterTextActive
              ]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        
        {/* Estatísticas */}
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>Estatísticas</Text>
          
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Ionicons name="arrow-down-outline" size={24} color={colors.error} />
              <Animated.Text style={styles.statValue}>
                {animatedStats.min.interpolate({
                  inputRange: [0, stats.min],
                  outputRange: ['0.000', stats.min.toFixed(3)]
                })}
              </Animated.Text>
              <Text style={styles.statLabel}>Mínimo (m/s)</Text>
            </View>
            
            <View style={styles.statItem}>
              <Ionicons name="arrow-up-outline" size={24} color={colors.success} />
              <Animated.Text style={styles.statValue}>
                {animatedStats.max.interpolate({
                  inputRange: [0, stats.max],
                  outputRange: ['0.000', stats.max.toFixed(3)]
                })}
              </Animated.Text>
              <Text style={styles.statLabel}>Máximo (m/s)</Text>
            </View>
            
            <View style={styles.statItem}>
              <Ionicons name="analytics-outline" size={24} color={colors.primary} />
              <Animated.Text style={styles.statValue}>
                {animatedStats.avg.interpolate({
                  inputRange: [0, stats.avg],
                  outputRange: ['0.000', stats.avg.toFixed(3)]
                })}
              </Animated.Text>
              <Text style={styles.statLabel}>Média (m/s)</Text>
            </View>
            
            <View style={styles.statItem}>
              <Ionicons name="list-outline" size={24} color={colors.text.secondary} />
              <Animated.Text style={styles.statValue}>
                {animatedStats.count.interpolate({
                  inputRange: [0, stats.count],
                  outputRange: ['0', stats.count.toString()]
                })}
              </Animated.Text>
              <Text style={styles.statLabel}>Leituras</Text>
            </View>
          </View>
        </View>
        
        {/* Gráfico */}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Histórico de Velocidade {index}</Text>
          
          {filteredData.length > 1 ? (
            <>
              <RealTimeChart 
                title=""
                data={chartData}
                labels={labels}
                color={colors.velocity[index - 1]}
                yAxisSuffix=" m/s"
                height={300}
                bezier={filteredData.length < 100} // Desativar bezier para muitos pontos
                formatXLabel={(value) => value}
              />
              <Text style={styles.chartNote}>
                Mostrando {filteredData.length} pontos de dados
              </Text>
            </>
          ) : (
            <View style={styles.emptyChartContainer}>
              <Ionicons name="information-circle-outline" size={32} color={colors.text.secondary} />
              <Text style={styles.emptyChartText}>
                Não há dados suficientes para o período selecionado
              </Text>
            </View>
          )}
        </View>
        
        {/* Informação de atualizações */}
        <View style={styles.infoContainer}>
          <Ionicons name="refresh-outline" size={20} color={colors.primary} />
          <Text style={styles.infoText}>
            Os dados são atualizados automaticamente em tempo real
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.m,
    paddingBottom: spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.m,
  },
  loadingText: {
    marginTop: spacing.m,
    fontSize: 16,
    color: colors.text.secondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.m,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.m,
    marginBottom: spacing.m,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.text.inverse,
    fontSize: 16,
    fontWeight: 'bold',
  },
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.m,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderRadius: 16,
    ...styles.elevation,
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterText: {
    marginLeft: 4,
    fontSize: 12,
    color: colors.text.primary,
    fontWeight: '500',
  },
  filterTextActive: {
    color: colors.text.inverse,
    fontWeight: 'bold',
  },
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.m,
    marginBottom: spacing.m,
    ...styles.elevation,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: spacing.m,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statItem: {
    width: '48%',
    backgroundColor: `${colors.primary}05`,
    borderRadius: 8,
    padding: spacing.m,
    marginBottom: spacing.m,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginVertical: spacing.xs,
  },
  statLabel: {
    fontSize: 12,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.m,
    marginBottom: spacing.m,
    ...styles.elevation,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: spacing.m,
  },
  chartNote: {
    fontSize: 12,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.s,
  },
  emptyChartContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: `${colors.primary}05`,
    borderRadius: 8,
  },
  emptyChartText: {
    marginTop: spacing.s,
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${colors.primary}10`,
    padding: spacing.m,
    borderRadius: 8,
    marginBottom: spacing.m,
  },
  infoText: {
    marginLeft: spacing.s,
    fontSize: 14,
    color: colors.text.secondary,
  },
  elevation: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});

export default HistoryScreen;