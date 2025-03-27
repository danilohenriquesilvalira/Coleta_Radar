import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Dimensions
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import ApiService, { HistoryPoint } from '../services/api';
import { LineChart } from 'react-native-chart-kit';

type HistoryScreenRouteProp = RouteProp<RootStackParamList, 'History'>;

const HistoryScreen: React.FC = () => {
  const route = useRoute<HistoryScreenRouteProp>();
  const { index } = route.params;
  
  const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'hour' | 'day' | 'all'>('hour');

  // Load history data
  const loadData = async () => {
    try {
      setError(null);
      const history = await ApiService.getVelocityHistory(index);
      setHistoryData(history);
    } catch (err) {
      setError('Failed to load velocity history');
      console.error('Error loading velocity history:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Load data on component mount
  useEffect(() => {
    loadData();
  }, [index]);

  // Handle refresh
  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Filter data based on selected time range
  const getFilteredData = () => {
    const now = Date.now();
    
    switch (timeRange) {
      case 'hour':
        return historyData.filter(item => (now - item.timestamp) < 60 * 60 * 1000);
      case 'day':
        return historyData.filter(item => (now - item.timestamp) < 24 * 60 * 60 * 1000);
      case 'all':
      default:
        return historyData;
    }
  };

  // If loading
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Loading velocity history...</Text>
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

  // Get filtered data
  const filteredData = getFilteredData();

  // Prepare chart data - show last 20 points max
  const displayData = filteredData.slice(-20);
  const chartData = {
    labels: displayData.map((_, i) => `${i + 1}`),
    datasets: [
      {
        data: displayData.map(point => point.value),
        color: (opacity = 1) => `rgba(33, 150, 243, ${opacity})`,
        strokeWidth: 2
      }
    ],
    legend: ["Velocity (m/s)"]
  };

  // Prepare stats
  const stats = {
    min: Math.min(...filteredData.map(item => item.value)),
    max: Math.max(...filteredData.map(item => item.value)),
    avg: filteredData.reduce((sum, item) => sum + item.value, 0) / filteredData.length || 0,
    count: filteredData.length
  };

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Time Range Selector */}
      <View style={styles.timeRangeContainer}>
        <TouchableOpacity 
          style={[styles.timeRangeButton, timeRange === 'hour' && styles.timeRangeActive]}
          onPress={() => setTimeRange('hour')}
        >
          <Text style={[styles.timeRangeText, timeRange === 'hour' && styles.timeRangeActiveText]}>
            1 Hour
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.timeRangeButton, timeRange === 'day' && styles.timeRangeActive]}
          onPress={() => setTimeRange('day')}
        >
          <Text style={[styles.timeRangeText, timeRange === 'day' && styles.timeRangeActiveText]}>
            24 Hours
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.timeRangeButton, timeRange === 'all' && styles.timeRangeActive]}
          onPress={() => setTimeRange('all')}
        >
          <Text style={[styles.timeRangeText, timeRange === 'all' && styles.timeRangeActiveText]}>
            All Data
          </Text>
        </TouchableOpacity>
      </View>

      {/* Stats Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Velocity {index} Statistics</Text>
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.min.toFixed(3)}</Text>
            <Text style={styles.statLabel}>Min (m/s)</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.max.toFixed(3)}</Text>
            <Text style={styles.statLabel}>Max (m/s)</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.avg.toFixed(3)}</Text>
            <Text style={styles.statLabel}>Avg (m/s)</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.count}</Text>
            <Text style={styles.statLabel}>Data Points</Text>
          </View>
        </View>
      </View>

      {/* Chart Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Velocity {index} History</Text>
        {displayData.length > 1 ? (
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
          <Text style={styles.noDataText}>
            Not enough data points for the selected time range
          </Text>
        )}
        <Text style={styles.chartNote}>Showing last {displayData.length} data points</Text>
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
  timeRangeContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    margin: 16,
    marginBottom: 0,
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  timeRangeButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  timeRangeActive: {
    backgroundColor: '#2196F3',
  },
  timeRangeText: {
    fontSize: 14,
    color: '#666',
    fontWeight: 'bold',
  },
  timeRangeActiveText: {
    color: 'white',
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
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  statItem: {
    width: '48%',
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2196F3',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
  },
  noDataText: {
    textAlign: 'center',
    color: '#666',
    fontSize: 14,
    marginVertical: 20,
  },
  chartNote: {
    textAlign: 'center',
    color: '#666',
    fontSize: 12,
    marginTop: 8,
  },
});

export default HistoryScreen;