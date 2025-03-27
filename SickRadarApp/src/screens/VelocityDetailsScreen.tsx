import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
  Animated,
  Easing
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../App';
import ApiService, { VelocityChange } from '../services/api';
import Header from '../components/Header';
import RealTimeChart from '../components/RealTimeChart';
import { colors, spacing, animations } from '../styles/theme';

type VelocityDetailsScreenRouteProp = RouteProp<RootStackParamList, 'VelocityDetails'>;
type VelocityDetailsScreenNavigationProp = StackNavigationProp<RootStackParamList, 'VelocityDetails'>;

const VelocityDetailsScreen: React.FC = () => {
  const navigation = useNavigation<VelocityDetailsScreenNavigationProp>();
  const route = useRoute<VelocityDetailsScreenRouteProp>();
  const { index } = route.params;
  
  const [velocityChanges, setVelocityChanges] = useState<VelocityChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [velocityValue, setVelocityValue] = useState<number | null>(null);
  const [velocityHistory, setVelocityHistory] = useState<number[]>([]);
  
  // Animação para o valor atual
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const colorAnim = React.useRef(new Animated.Value(0)).current;
  
  // Carregar dados de velocidade
  const loadData = async () => {
    try {
      setError(null);
      
      // Obter mudanças de velocidade
      const changes = await ApiService.getVelocityChanges();
      const filteredChanges = changes.filter(change => change.index === index - 1);
      setVelocityChanges(filteredChanges);
      
      // Obter dados atuais para o valor atual
      const currentData = await ApiService.getCurrentData();
      if (currentData) {
        setVelocityValue(currentData.velocities[index - 1]);
      }
      
      // Obter histórico de velocidade
      const history = await ApiService.getVelocityHistory(index);
      if (history) {
        setVelocityHistory(history.map(point => point.value));
      }
    } catch (err) {
      setError('Falha ao carregar dados de velocidade');
      console.error('Erro ao carregar dados de velocidade:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  
  // Configurar atualizações em tempo real
  const setupRealTimeUpdates = () => {
    // Inscrever-se para atualizações de dados
    const unsubscribeData = ApiService.subscribeToCurrentData((data) => {
      if (data) {
        const newValue = data.velocities[index - 1];
        
        // Verificar se o valor mudou para animar
        if (velocityValue !== null && Math.abs(newValue - velocityValue) > 0.01) {
          animateValueChange(newValue > velocityValue);
        }
        
        setVelocityValue(newValue);
      }
    });
    
    // Inscrever-se para atualizações de histórico
    const unsubscribeHistory = ApiService.subscribeToVelocityHistory(
      index, 
      (history) => {
        setVelocityHistory(history.map(point => point.value));
      }
    );
    
    // Inscrever-se para mudanças de velocidade
    const unsubscribeChanges = ApiService.subscribeToVelocityChanges(
      (changes) => {
        const filteredChanges = changes.filter(change => change.index === index - 1);
        setVelocityChanges(filteredChanges);
      }
    );
    
    return () => {
      unsubscribeData();
      unsubscribeHistory();
      unsubscribeChanges();
    };
  };
  
  // Animar mudança de valor
  const animateValueChange = (increase: boolean) => {
    // Animar escala
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.2,
        duration: animations.durations.short,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: animations.durations.medium,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.ease),
      })
    ]).start();
    
    // Animar cor
    Animated.timing(colorAnim, {
      toValue: increase ? 1 : -1,
      duration: animations.durations.medium,
      useNativeDriver: false,
    }).start(() => {
      // Resetar animação de cor após completar
      Animated.timing(colorAnim, {
        toValue: 0,
        duration: animations.durations.medium,
        useNativeDriver: false,
      }).start();
    });
  };
  
  // Interpolar cor baseada na direção da mudança
  const textColor = colorAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [colors.error, colors.text.primary, colors.success]
  });
  
  // Carregar dados ao montar o componente
  useEffect(() => {
    loadData();
    
    // Configurar atualizações em tempo real
    const unsubscribe = setupRealTimeUpdates();
    
    // Limpar ao desmontar
    return () => {
      unsubscribe();
    };
  }, [index]);
  
  // Recarregar dados quando a tela estiver em foco
  useFocusEffect(
    useCallback(() => {
      loadData();
      // Limpar ao perder foco
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
  
  // Navegar para tela de histórico
  const navigateToHistory = () => {
    navigation.navigate('History', { index });
  };
  
  // Formatar timestamp
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString() + ' ' + 
           date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
  };
  
  // Renderizar tela de carregamento
  if (loading) {
    return (
      <View style={styles.container}>
        <Header 
          title={`Velocidade ${index}`} 
          showBack 
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.velocity[index - 1]} />
          <Text style={styles.loadingText}>Carregando dados de velocidade...</Text>
        </View>
      </View>
    );
  }
  
  // Renderizar tela de erro
  if (error) {
    return (
      <View style={styles.container}>
        <Header 
          title={`Velocidade ${index}`} 
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
  
  return (
    <View style={styles.container}>
      <Header 
        title={`Velocidade ${index}`} 
        showBack 
      />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Valor atual em destaque */}
        <View style={styles.currentValueCard}>
          <Text style={styles.currentValueLabel}>Valor Atual</Text>
          <View style={styles.currentValueContainer}>
            <Animated.Text 
              style={[
                styles.currentValue, 
                { 
                  color: textColor,
                  transform: [{ scale: scaleAnim }]
                }
              ]}
            >
              {velocityValue !== null ? velocityValue.toFixed(3) : '0.000'}
            </Animated.Text>
            <Text style={styles.currentValueUnit}>m/s</Text>
          </View>
        </View>
        
        {/* Gráfico de tendência */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Tendência de Velocidade</Text>
            <TouchableOpacity 
              style={styles.historyButton} 
              onPress={navigateToHistory}
            >
              <Text style={styles.historyButtonText}>Ver Histórico Completo</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.text.inverse} />
            </TouchableOpacity>
          </View>
          
          {velocityHistory.length > 1 ? (
            <RealTimeChart
              title=""
              data={velocityHistory}
              color={colors.velocity[index - 1]}
              yAxisSuffix=" m/s"
              bezier
              height={220}
            />
          ) : (
            <View style={styles.emptyChartContainer}>
              <Text style={styles.emptyChartText}>
                Não há dados suficientes para exibir o gráfico
              </Text>
            </View>
          )}
        </View>
        
        {/* Registro de mudanças */}
        <View style={styles.changesCard}>
          <Text style={styles.changesTitle}>Registro de Mudanças</Text>
          
          {velocityChanges.length > 0 ? (
            <View style={styles.changesContainer}>
              {velocityChanges.slice(0, 10).map((change, i) => {
                const isIncrease = change.change_value > 0;
                
                return (
                  <View key={i} style={styles.changeItem}>
                    <View style={styles.changeHeader}>
                      <Text style={styles.changeTimestamp}>
                        {formatTimestamp(change.timestamp)}
                      </Text>
                      <View style={[
                        styles.changeBadge,
                        { 
                          backgroundColor: isIncrease 
                            ? `${colors.success}20` 
                            : `${colors.error}20`
                        }
                      ]}>
                        <Text style={[
                          styles.changeBadgeText,
                          { color: isIncrease ? colors.success : colors.error }
                        ]}>
                          {isIncrease ? '+' : ''}{change.change_value.toFixed(3)} m/s
                        </Text>
                      </View>
                    </View>
                    
                    <View style={styles.changeDetails}>
                      <View style={styles.changeValues}>
                        <Text style={styles.changeValueLabel}>De:</Text>
                        <Text style={styles.changeValueText}>
                          {change.old_value.toFixed(3)} m/s
                        </Text>
                      </View>
                      
                      <Ionicons 
                        name="arrow-forward" 
                        size={16} 
                        color={colors.text.secondary} 
                        style={styles.changeArrow}
                      />
                      
                      <View style={styles.changeValues}>
                        <Text style={styles.changeValueLabel}>Para:</Text>
                        <Text style={styles.changeValueText}>
                          {change.new_value.toFixed(3)} m/s
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
              
              {velocityChanges.length > 10 && (
                <TouchableOpacity 
                  style={styles.viewMoreButton}
                  onPress={navigateToHistory}
                >
                  <Text style={styles.viewMoreText}>
                    Ver mais {velocityChanges.length - 10} mudanças
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.emptyChangesContainer}>
              <Ionicons name="information-circle-outline" size={24} color={colors.text.secondary} />
              <Text style={styles.emptyChangesText}>
                Nenhuma mudança de velocidade detectada
              </Text>
            </View>
          )}
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
  },
  loadingText: {
    marginTop: spacing.m,
    fontSize: 16,
    color: colors.text.secondary,
    textAlign: 'center',
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
  currentValueCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.m,
    marginBottom: spacing.m,
    alignItems: 'center',
    ...styles.elevation,
  },
  currentValueLabel: {
    fontSize: 16,
    color: colors.text.secondary,
    marginBottom: spacing.s,
  },
  currentValueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  currentValue: {
    fontSize: 48,
    fontWeight: 'bold',
  },
  currentValueUnit: {
    fontSize: 20,
    color: colors.text.secondary,
    marginLeft: spacing.s,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.m,
    marginBottom: spacing.m,
    ...styles.elevation,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.m,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
  },
  historyButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xs,
    borderRadius: 16,
  },
  historyButtonText: {
    color: colors.text.inverse,
    fontWeight: 'bold',
    fontSize: 12,
    marginRight: 4,
  },
  emptyChartContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: `${colors.primary}10`,
    borderRadius: 8,
  },
  emptyChartText: {
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  changesCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.m,
    ...styles.elevation,
  },
  changesTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: spacing.m,
  },
  changesContainer: {
    
  },
  changeItem: {
    backgroundColor: `${colors.primary}05`,
    borderRadius: 8,
    padding: spacing.m,
    marginBottom: spacing.m,
  },
  changeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.s,
  },
  changeTimestamp: {
    fontSize: 12,
    color: colors.text.secondary,
  },
  changeBadge: {
    borderRadius: 16,
    paddingHorizontal: spacing.s,
    paddingVertical: 2,
  },
  changeBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  changeDetails: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  changeValues: {
    flex: 1,
  },
  changeValueLabel: {
    fontSize: 12,
    color: colors.text.secondary,
  },
  changeValueText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
  },
  changeArrow: {
    marginHorizontal: spacing.s,
  },
  viewMoreButton: {
    alignItems: 'center',
    padding: spacing.m,
  },
  viewMoreText: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  emptyChangesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.m,
    backgroundColor: `${colors.primary}05`,
    borderRadius: 8,
  },
  emptyChangesText: {
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

export default VelocityDetailsScreen;