import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { LineChartData } from 'react-native-chart-kit/dist/line-chart/LineChart';

interface RealTimeChartProps {
  data: number[];
  labels?: string[];
  title: string;
  color?: string;
  height?: number;
  width?: number;
  xAxisLabel?: string;
  yAxisLabel?: string;
  xAxisSuffix?: string;
  yAxisSuffix?: string;
  strokeWidth?: number;
  showDots?: boolean;
  bezier?: boolean;
  formatYLabel?: (value: string) => string;
  formatXLabel?: (value: string) => string;
  loading?: boolean;
  emptyMessage?: string;
}

const RealTimeChart: React.FC<RealTimeChartProps> = ({
  data,
  labels,
  title,
  color = '#2196F3',
  height = 220,
  width,
  xAxisLabel = '',
  yAxisLabel = '',
  xAxisSuffix = '',
  yAxisSuffix = '',
  strokeWidth = 3,
  showDots = false,
  bezier = true,
  formatYLabel,
  formatXLabel,
  loading = false,
  emptyMessage = 'Não há dados suficientes'
}) => {
  const deviceWidth = Dimensions.get('window').width;
  const chartWidth = width || deviceWidth - 32;
  
  const [fadeAnim] = useState(1);
  const chartRef = useRef<any>(null);
  
  // Assegurar que temos pelo menos dois pontos para o gráfico
  const hasEnoughData = data && data.length >= 2;
  
  // Gerar labels padrão se não forem fornecidos
  const chartLabels = labels || data.map((_, i) => `${i + 1}`);
  
  // Preparar dados do gráfico
  const chartData: LineChartData = {
    labels: chartLabels,
    datasets: [
      {
        data: hasEnoughData ? data : [0, 0],
        color: (opacity = 1) => `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`,
        strokeWidth
      }
    ],
    legend: [title]
  };
  
  // Configuração do gráfico
  const chartConfig = {
    backgroundColor: 'white',
    backgroundGradientFrom: 'white',
    backgroundGradientTo: 'white',
    decimalPlaces: 2,
    color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    style: {
      borderRadius: 16
    },
    propsForDots: {
      r: '4',
      strokeWidth: '2',
      stroke: color
    },
    propsForBackgroundLines: {
      strokeDasharray: '5',
      strokeWidth: 0.5,
    },
    formatYLabel: formatYLabel,
    formatXLabel: formatXLabel
  };
  
  // Se não há dados suficientes ou está carregando
  if (loading) {
    return (
      <View style={[styles.container, { height, width: chartWidth }]}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={color} />
        </View>
      </View>
    );
  }
  
  if (!hasEnoughData) {
    return (
      <View style={[styles.container, { height, width: chartWidth }]}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      </View>
    );
  }
  
  return (
    <View style={[styles.container, { height: height + 20, width: chartWidth }]}>
      <Text style={styles.title}>{title}</Text>
      <LineChart
        data={chartData}
        width={chartWidth}
        height={height}
        chartConfig={chartConfig}
        bezier={bezier}
        style={styles.chart}
        withDots={showDots}
        withShadow={false}
        withInnerLines={true}
        withOuterLines={true}
        withVerticalLines={true}
        withHorizontalLines={true}
        yAxisLabel={yAxisLabel}
        yAxisSuffix={yAxisSuffix}
        xAxisLabel={xAxisLabel}
        xAxisSuffix={xAxisSuffix}
        fromZero={false}
        // @ts-ignore - Props extras que não estão no tipo
        formatYLabel={formatYLabel}
        // @ts-ignore
        formatXLabel={formatXLabel}
        hidePointsAtIndex={showDots ? [] : Array.from({ length: data.length }, (_, i) => i)}
        segments={4}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 12,
    margin: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  }
});

export default RealTimeChart;