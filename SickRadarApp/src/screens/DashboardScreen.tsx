import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  RefreshControl,
  Alert,
  ActivityIndicator 
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../App';
import ApiService, { CurrentData, RadarStatus } from '../services/api';

type DashboardScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Dashboard'>;

const DashboardScreen: React.FC = () => {
  const navigation = useNavigation<DashboardScreenNavigationProp>();
  const [radarData, setRadarData] = useState<CurrentData | null>(null);
  const [radarStatus, setRadarStatus] = useState<RadarStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Function to load data
  const loadData = async () => {
    try {
      setError(null);
      
      // Get radar status
      const status = await ApiService.getStatus();
      setRadarStatus(status);
      
      // Get current data
      const currentData = await ApiService.getCurrentData();
      setRadarData(currentData);
    } catch (err) {
      setError('Failed to load radar data. Check your connection.');
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Load data on component mount
  useEffect(() => {
    loadData();
    
    // Set up polling for real-time updates (every 2 seconds)
    const interval = setInterval(() => {
      loadData();
    }, 2000);
    
    // Clean up interval on unmount
    return () => clearInterval(interval);
  }, []);

  // Handle manual refresh
  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string | undefined) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(parseInt(timestamp));
    return date.toLocaleString();
  };

  // Get status color
  const getStatusColor = (status: string | undefined) => {
    if (!status) return '#999';
    switch (status.toLowerCase()) {
      case 'ok':
        return '#4CAF50';
      case 'obstruido':
        return '#FFC107';
      case 'falha_comunicacao':
        return '#F44336';
      default:
        return '#999';
    }
  };

  // Navigate to velocity details
  const navigateToVelocityDetails = (index: number) => {
    navigation.navigate('VelocityDetails', { index });
  };

  // If loading
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Loading radar data...</Text>
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

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Status Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Radar Status</Text>
        <View style={styles.statusContainer}>
          <View 
            style={[
              styles.statusIndicator, 
              { backgroundColor: getStatusColor(radarStatus?.status) }
            ]} 
          />
          <Text style={styles.statusText}>
            {radarStatus?.status || 'Unknown'}
          </Text>
        </View>
        <Text style={styles.timestamp}>
          Last Updated: {formatTimestamp(radarStatus?.timestamp)}
        </Text>
      </View>

      {/* Velocities Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Velocities (m/s)</Text>
        <View style={styles.gridContainer}>
          {radarData?.velocities.map((velocity, index) => (
            <TouchableOpacity
              key={`vel-${index}`}
              style={styles.gridItem}
              onPress={() => navigateToVelocityDetails(index + 1)}
            >
              <Text style={styles.gridItemTitle}>Vel {index + 1}</Text>
              <Text style={styles.gridItemValue}>{velocity.toFixed(3)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Positions Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Positions (m)</Text>
        <View style={styles.gridContainer}>
          {radarData?.positions.map((position, index) => (
            <View key={`pos-${index}`} style={styles.gridItem}>
              <Text style={styles.gridItemTitle}>Pos {index + 1}</Text>
              <Text style={styles.gridItemValue}>{position.toFixed(3)}</Text>
            </View>
          ))}
        </View>
      </View>
      
      {/* Help Text */}
      <Text style={styles.helpText}>
        Tap on any velocity value to see details and history.
      </Text>

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
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold',
    textTransform: 'capitalize',
  },
  timestamp: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
  },
  gridItem: {
    width: '33.33%',
    padding: 8,
  },
  gridItemTitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  gridItemValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  helpText: {
    textAlign: 'center',
    color: '#666',
    fontSize: 14,
    margin: 16,
  },
});

export default DashboardScreen;