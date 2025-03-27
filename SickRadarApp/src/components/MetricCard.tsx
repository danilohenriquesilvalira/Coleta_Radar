import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface MetricCardProps {
  title: string;
  value: number;
  unit: string;
  icon?: string;
  color?: string;
  trend?: 'up' | 'down' | 'stable' | null;
  trendValue?: number;
  precision?: number;
  onPress?: () => void;
}

const MetricCard: React.FC<MetricCardProps> = ({ 
  title, 
  value, 
  unit, 
  icon, 
  color = '#2196F3',
  trend = null, 
  trendValue = 0,
  precision = 2,
  onPress
}) => {
  // Animação para quando o valor mudar
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const prevValue = useRef(value);

  useEffect(() => {
    // Animar apenas se o valor mudar significativamente (mais de 0.01)
    if (Math.abs(value - prevValue.current) > 0.01) {
      // Pulsar brevemente para indicar mudança
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.05,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        })
      ]).start();
      
      prevValue.current = value;
    }
  }, [value, scaleAnim]);

  // Renderizar ícone de tendência
  const renderTrendIcon = () => {
    if (!trend) return null;
    
    let iconName = 'remove';
    let iconColor = '#9E9E9E';
    
    if (trend === 'up') {
      iconName = 'arrow-up';
      iconColor = '#4CAF50';
    } else if (trend === 'down') {
      iconName = 'arrow-down';
      iconColor = '#F44336';
    }
    
    return (
      <View style={styles.trendContainer}>
        <Ionicons name={iconName} size={14} color={iconColor} />
        {trendValue !== 0 && (
          <Text style={[styles.trendValue, { color: iconColor }]}>
            {trendValue > 0 ? '+' : ''}{trendValue.toFixed(precision)}
          </Text>
        )}
      </View>
    );
  };

  const cardContent = (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {icon && <Ionicons name={icon} size={20} color={color} />}
      </View>
      
      <View style={styles.valueContainer}>
        <Animated.Text 
          style={[
            styles.value, 
            { color, transform: [{ scale: scaleAnim }] }
          ]}
        >
          {value.toFixed(precision)}
        </Animated.Text>
        <Text style={styles.unit}>{unit}</Text>
      </View>
      
      {renderTrendIcon()}
    </>
  );

  return onPress ? (
    <TouchableOpacity 
      style={[styles.card, { borderLeftColor: color }]} 
      onPress={onPress}
      activeOpacity={0.7}
    >
      {cardContent}
    </TouchableOpacity>
  ) : (
    <View style={[styles.card, { borderLeftColor: color }]}>
      {cardContent}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    margin: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
    borderLeftWidth: 4,
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  unit: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  trendValue: {
    fontSize: 12,
    marginLeft: 2,
  }
});

export default MetricCard;