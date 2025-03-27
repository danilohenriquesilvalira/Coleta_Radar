import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface StatusBadgeProps {
  status: string;
  label?: string;
  large?: boolean;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, large = false }) => {
  // Determinar cor baseada no status
  const getStatusColor = (status: string): string => {
    const normalizedStatus = status.toLowerCase();
    switch (normalizedStatus) {
      case 'ok':
      case 'connected':
      case 'online':
        return '#4CAF50'; // Verde
      case 'warning':
      case 'obstruido':
      case 'degraded':
        return '#FFC107'; // Amarelo
      case 'error':
      case 'falha_comunicacao':
      case 'offline':
      case 'disconnected':
        return '#F44336'; // Vermelho
      default:
        return '#9E9E9E'; // Cinza para status desconhecido
    }
  };

  const getStatusText = (status: string): string => {
    const normalizedStatus = status.toLowerCase();
    switch (normalizedStatus) {
      case 'ok':
      case 'connected':
      case 'online':
        return 'Online';
      case 'warning':
      case 'degraded':
        return 'Alerta';
      case 'obstruido':
        return 'Obstruído';
      case 'error':
      case 'falha_comunicacao':
      case 'offline':
      case 'disconnected':
        return 'Offline';
      default:
        return status || 'Desconhecido';
    }
  };

  const displayText = label || getStatusText(status);
  const color = getStatusColor(status);
  
  return (
    <View style={[
      styles.badge, 
      { backgroundColor: `${color}20` }, // Cor com 20% de opacidade para o fundo
      large && styles.badgeLarge
    ]}>
      <View style={[styles.dot, { backgroundColor: color }, large && styles.dotLarge]} />
      <Text style={[styles.text, large && styles.textLarge, { color }]}>
        {displayText}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
  badgeLarge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dotLarge: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  textLarge: {
    fontSize: 14,
    fontWeight: 'bold',
  }
});

export default StatusBadge;