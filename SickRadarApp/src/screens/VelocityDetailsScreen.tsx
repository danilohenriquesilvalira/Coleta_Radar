import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  RefreshControl
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import ApiService, { VelocityChange } from '../services/api';
import { LineChart } from 'react-native-chart-kit';
import { Dimensions } from 'react-native';

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

  // Load velocity changes
  const loadData = async () => {
    try {
      setError(null);
      const changes = await ApiService.getVelocityChanges();
      
      // Filter for this velocity index
      const filteredChanges = changes.filter(change => change.index === index - 1);
      setVelocityChanges(filteredChanges);
    } catch (err) {
      setError('Failed to load velocity data');
      console.error('Error loading velocity changes:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Load data on component mount
  useEffect(() => {
    loadData();
    
    // Set up polling for real-time updates
    const interval = setInterval(() => {
      loadData();
    }, 2000);
    
    // Clean up on unmount
    return () => clearInterval(interval);
  }, [index]);

  // Handle refresh
  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Navigate to history screen
  const navigateToHistory = () => {
    navigation.navigate('History', { index });
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // If loading
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Loading velocity data...</Text>
      </View>
    );
  }

  // If error
  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadData}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Prepare chart data
  const chartData = {
    labels: velocityChanges.slice(-10).map((_, i) => `${i + 1}`),
    datasets: [
      {
        data: velocityChanges.slice(-10).map(change => change.new_value),
        color: (opacity = 1) => `rgba(33, 150, 243, ${opacity})`,
        strokeWidth: 2
      }
    ],
    legend: ["Velocity (m/s)"]
  };

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Chart Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Velocity {index} Trend</Text>
        {velocityChanges.length > 1 ? (
          <LineChart
            data={chartData}
            width={Dimensions.get('window').width - 32}
            height={220}
            chartConfig={{
              backgroundColor: '#fff',
              backgroundGradientFrom: '#fff',
              backgroundGradientTo: '#fff',
              decimalPlaces: 2,
              color: (opacity = 1) => `rgba(33, 150, 243, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
              style: {
                borderRadius: 16
              }
            }}
            bezier
            style={{
              marginVertical: 8,
              borderRadius: 16
            }}
          />
        ) : (
          <Text style={styles.noDataText}>Not enough data points for chart</Text>
        )}
        <TouchableOpacity style={styles.historyButton} onPress={navigateToHistory}>
          <Text style={styles.historyButtonText}>View Full History</Text>
        </TouchableOpacity>
      </View>

      {/* Changes Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent Changes</Text>
        {velocityChanges.length > 0 ? (
          velocityChanges.slice().reverse().map((change, i) => (
            <View key={i} style={styles.changeItem}>
              <View style={styles.changeValueContainer}>
                <Text style={styles.oldValue}>{change.old_value.toFixed(3)}</Text>
                <Text style={styles.arrow}>→</Text>
                <Text style={styles.newValue}>{change.new_value.toFixed(3)}</Text>
                <Text style={[
                  styles.changeValue,
                  { color: change.change_value > 0 ? '#4CAF50' : '#F44336' }
                ]}>
                  {change.change_value > 0 ? '+' : ''}{change.change_value.toFixed(3)}
                </Text>
              </View>
              <Text style={styles.changeTimestamp}>{formatTimestamp(change.timestamp)}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.noDataText}>No recent changes detected</Text>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#F44336',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    margin: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  noDataText: {
    textAlign: 'center',
    color: '#666',
    fontSize: 14,
    marginVertical: 20,
  },
  historyButton: {
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 10,
  },
  historyButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  changeItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  changeValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  oldValue: {
    fontSize: 16,
    color: '#666',
  },
  arrow: {
    fontSize: 16,
    color: '#666',
    marginHorizontal: 8,
  },
  newValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  changeValue: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 'auto',
  },
  changeTimestamp: {
    fontSize: 12,
    color: '#999',
  },
});

export default VelocityDetailsScreen;