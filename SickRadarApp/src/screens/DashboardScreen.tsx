import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  View, 
  StyleSheet, 
  ScrollView, 
  RefreshControl,
  Alert,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  Dimensions
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import ApiService, { CurrentData, RadarStatus } from '../services/api';
import Header from '../components/Header';
import StatusBadge from '../components/StatusBadge';
import MetricCard from '../components/MetricCard';
import RealTimeChart from '../components/RealTimeChart';
import { colors, spacing } from '../styles/theme';

type DashboardScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Dashboard'>;

const DashboardScreen: React.FC = () => {
  const navigation = useNavigation<DashboardScreenNavigationProp>();
  const [radarData, setRadarData] = useState<CurrentData | null>(null);
  const [radarStatus, setRadarStatus] = useState<RadarStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Estado para histórico de velocidades para o mini-gráfico
  const [velocityHistory, setVelocityHistory] = useState<Array<Array<number>>>([[], [], [], [], [], [], []]);
  const maxHistoryPoints = 20; // Número máximo de pontos no histórico
  
  // Ref para armazenar os últimos dados para comparação
  const lastDataRef = useRef<CurrentData | null>(null);
  
  // Função para carregar dados
  const loadData = async () => {
    try {
      setError(null);
      
      // Obter status do radar
      const status = await ApiService.getStatus();
      setRadarStatus(status);
      
      // Obter dados atuais
      const currentData = await ApiService.getCurrentData();
      
      // Atualizar histórico de velocidades
      if (currentData) {
        updateVelocityHistory(currentData);
        setRadarData(currentData);
      }
    } catch (err) {
      setError('Falha ao carregar dados do radar. Verifique sua conexão.');
      console.error('Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  
  // Atualizar histórico de velocidades
  const updateVelocityHistory = (data: CurrentData) => {
    setVelocityHistory(prev => {
      const newHistory = [...prev];
      
      // Adicionar novos valores ao histórico
      data.velocities.forEach((velocity, index) => {
        newHistory[index] = [...prev[index], velocity];
        
        // Limitar tamanho do histórico
        if (newHistory[index].length > maxHistoryPoints) {
          newHistory[index] = newHistory[index].slice(-maxHistoryPoints);
        }
      });
      
      return newHistory;
    });
  };
  
  // Calcular tendência para uma velocidade
  const getVelocityTrend = (index: number): { trend: 'up' | 'down' | 'stable' | null, value: number } => {
    if (!radarData || !lastDataRef.current) {
      return { trend: null, value: 0 };
    }
    
    const current = radarData.velocities[index];
    const previous = lastDataRef.current.velocities[index];
    const diff = current - previous;
    
    // Se a diferença for muito pequena, considerar estável
    if (Math.abs(diff) < 0.01) {
      return { trend: 'stable', value: 0 };
    }
    
    return {
      trend: diff > 0 ? 'up' : 'down',
      value: diff
    };
  };
  
  // Função para configurar subscription de dados em tempo real
  const setupRealTimeUpdates = () => {
    // Subscrever para atualizações de status
    const unsubscribeStatus = ApiService.subscribeToStatus((status) => {
      setRadarStatus(status);
    });
    
    // Subscrever para atualizações de dados
    const unsubscribeData = ApiService.subscribeToCurrentData((data) => {
      // Armazenar dados atuais para comparação
      lastDataRef.current = radarData;
      
      // Atualizar dados
      setRadarData(data);
      
      // Atualizar histórico
      updateVelocityHistory(data);
    });
    
    return () => {
      unsubscribeStatus();
      unsubscribeData();
    };
  };
  
  // Carregar dados ao montar o componente
  useEffect(() => {
    loadData();
    
    // Configurar atualizações em tempo real
    const unsubscribe = setupRealTimeUpdates();
    
    return () => {
      unsubscribe();
    };
  }, []);
  
  // Recarregar dados quando a tela estiver em foco
  useFocusEffect(
    useCallback(() => {
      loadData();
      return () => {
        // Cleanup
      };
    }, [])
  );
  
  // Verificar conexão WebSocket
  const checkWebSocketConnection = () => {
    const isConnected = ApiService.isWebSocketConnected();
    if (!isConnected) {
      Alert.alert(
        'Aviso',
        'A conexão WebSocket está desconectada. Deseja tentar reconectar?',
        [
          {
            text: 'Sim',
            onPress: async () => {
              try {
                await ApiService.reconnectWebSocket();
                Alert.alert('Sucesso', 'Reconexão realizada com sucesso.');
              } catch (error) {
                Alert.alert('Erro', 'Falha na reconexão. Tente novamente mais tarde.');
              }
            }
          },
          {
            text: 'Não',
            style: 'cancel'
          }
        ]
      );
    } else {
      Alert.alert('Informação', 'Conexão WebSocket ativa.');
    }
  };
  
  // Ir para tela de detalhes de velocidade
  const navigateToVelocityDetails = (index: number) => {
    navigation.navigate('VelocityDetails', { index });
  };
  
  // Atualizar manualmente
  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };
  
  // Formatar timestamp
  const formatTimestamp = (timestamp: string | undefined) => {
    if (!timestamp) return 'Desconhecido';
    const date = new Date(parseInt(timestamp));
    return date.toLocaleString();
  };
  
  // Renderizar indicador de carregamento
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Header title="SICK Radar Monitor" showStatus={false} />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Carregando dados do radar...</Text>
      </View>
    );
  }
  
  // Renderizar tela de erro
  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Header title="SICK Radar Monitor" showStatus={false} />
        <View style={styles.errorContent}>
          <Ionicons name="warning-outline" size={64} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadData}>
            <Text style={styles.retryButtonText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  
  // Determinar qual velocidade tem o maior valor para o gráfico de destaque
  let featuredVelocityIndex = 0;
  let maxVelocity = -Infinity;
  
  if (radarData) {
    radarData.velocities.forEach((velocity, index) => {
      if (Math.abs(velocity) > Math.abs(maxVelocity)) {
        maxVelocity = velocity;
        featuredVelocityIndex = index;
      }
    });
  }
  
  return (
    <View style={styles.container}>
      <Header 
        title="SICK Radar Monitor" 
        showStatus={true} 
        status={radarStatus?.status || 'desconhecido'}
        rightIcon="refresh"
        onRightPress={loadData}
      />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={styles.sectionTitle}>Status do Sistema</Text>
            <StatusBadge status={radarStatus?.status || 'desconhecido'} large />
          </View>
          <Text style={styles.timestamp}>
            Última atualização: {formatTimestamp(radarStatus?.timestamp)}
          </Text>
          
          {radarStatus?.lastError && (
            <View style={styles.errorInfo}>
              <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
              <Text style={styles.errorInfoText}>{radarStatus.lastError}</Text>
            </View>
          )}
        </View>
        
        {/* Gráfico de Velocidade em Destaque */}
        {radarData && (
          <RealTimeChart
            title={`Velocidade ${featuredVelocityIndex + 1} (Tempo Real)`}
            data={velocityHistory[featuredVelocityIndex]}
            color={colors.velocity[featuredVelocityIndex]}
            yAxisSuffix=" m/s"
            bezier
            height={200}
          />
        )}
        
        {/* Velocidades Grid */}
        <Text style={styles.sectionTitle}>Velocidades (m/s)</Text>
        <View style={styles.metricsGrid}>
          {radarData?.velocities.map((velocity, index) => {
            const { trend, value } = getVelocityTrend(index);
            return (
              <MetricCard
                key={`vel-${index}`}
                title={`Velocidade ${index + 1}`}
                value={velocity}
                unit="m/s"
                color={colors.velocity[index]}
                trend={trend}
                trendValue={value}
                precision={3}
                onPress={() => navigateToVelocityDetails(index + 1)}
              />
            );
          })}
        </View>
        
        {/* Posições Grid */}
        <Text style={styles.sectionTitle}>Posições (m)</Text>
        <View style={styles.metricsGrid}>
          {radarData?.positions.map((position, index) => (
            <MetricCard
              key={`pos-${index}`}
              title={`Posição ${index + 1}`}
              value={position}
              unit="m"
              color={colors.position[index]}
              precision={3}
            />
          ))}
        </View>
        
        {/* Informações de conexão */}
        <View style={styles.connectionInfo}>
          <Text style={styles.connectionStatus}>
            Estado WebSocket: {ApiService.isWebSocketConnected() ? 
            <Text style={{ color: colors.success }}>Conectado</Text> : 
            <Text style={{ color: colors.error }}>Desconectado</Text>}
          </Text>
          <TouchableOpacity 
            style={styles.connectionButton} 
            onPress={checkWebSocketConnection}
          >
            <Text style={styles.connectionButtonText}>Verificar conexão</Text>
          </TouchableOpacity>
        </View>
        
        {/* Dica de uso */}
        <View style={styles.tipContainer}>
          <Ionicons name="information-circle-outline" size={20} color={colors.info} />
          <Text style={styles.tipText}>
            Toque em qualquer velocidade para ver detalhes e histórico.
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
    paddingBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  errorContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.text.inverse,
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusCard: {
    backgroundColor: colors.surface,
    margin: spacing.m,
    padding: spacing.m,
    borderRadius: 12,
    ...styles.elevation,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.s,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginHorizontal: spacing.m,
    marginTop: spacing.m,
    marginBottom: spacing.s,
  },
  timestamp: {
    fontSize: 14,
    color: colors.text.secondary,
  },
  errorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.s,
    backgroundColor: `${colors.warning}20`,
    padding: spacing.s,
    borderRadius: 4,
  },
  errorInfoText: {
    fontSize: 14,
    color: colors.text.secondary,
    marginLeft: spacing.xs,
    flex: 1,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: spacing.s,
  },
  connectionInfo: {
    backgroundColor: colors.surface,
    margin: spacing.m,
    padding: spacing.m,
    borderRadius: 12,
    ...styles.elevation,
    alignItems: 'center',
  },
  connectionStatus: {
    fontSize: 16,
    color: colors.text.primary,
    marginBottom: spacing.m,
  },
  connectionButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  connectionButtonText: {
    color: colors.text.inverse,
    fontWeight: 'bold',
  },
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.m,
    marginBottom: spacing.m,
    padding: spacing.m,
    backgroundColor: `${colors.info}10`,
    borderRadius: 8,
  },
  tipText: {
    fontSize: 14,
    color: colors.text.secondary,
    marginLeft: spacing.s,
    flex: 1,
  },
  elevation: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});

export default DashboardScreen;