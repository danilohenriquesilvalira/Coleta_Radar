import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';

// Import screens
import DashboardScreen from './src/screens/DashboardScreen';
import VelocityDetailsScreen from './src/screens/VelocityDetailsScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ConnectionScreen from './src/screens/ConnectionScreen';

// Import services
import ApiService from './src/services/api';

// Define the stack navigator params
export type RootStackParamList = {
  Connection: undefined;
  Dashboard: undefined;
  VelocityDetails: { index: number };
  History: { index: number };
};

const Stack = createStackNavigator<RootStackParamList>();

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [connected, setConnected] = useState(false);

  // Inicializar o serviço API quando o app inicia
  useEffect(() => {
    const initialize = async () => {
      try {
        // Tentar conectar automaticamente
        const result = await ApiService.initialize();
        setConnected(result);
      } catch (error) {
        console.error('Erro ao inicializar serviços:', error);
      } finally {
        // Mesmo que falhe, mostrar a tela de conexão
        setInitializing(false);
      }
    };

    initialize();
  }, []);

  // Tela de carregamento
  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Inicializando...</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <NavigationContainer>
        <Stack.Navigator 
          initialRouteName={connected ? "Dashboard" : "Connection"}
          screenOptions={{
            headerStyle: {
              backgroundColor: '#2196F3',
            },
            headerTintColor: '#fff',
            headerTitleStyle: {
              fontWeight: 'bold',
            },
          }}
        >
          <Stack.Screen 
            name="Connection" 
            component={ConnectionScreen} 
            options={{ 
              title: 'Conexão',
              headerShown: false // Esconder cabeçalho na tela de conexão
            }} 
          />
          
          <Stack.Screen 
            name="Dashboard" 
            component={DashboardScreen} 
            options={{ title: 'SICK Radar Monitor' }} 
          />
          
          <Stack.Screen 
            name="VelocityDetails" 
            component={VelocityDetailsScreen} 
            options={({ route }) => ({ title: `Velocidade ${route.params.index} - Detalhes` })}
          />
          
          <Stack.Screen 
            name="History" 
            component={HistoryScreen} 
            options={({ route }) => ({ title: `Velocidade ${route.params.index} - Histórico` })}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}

const styles = StyleSheet.create({
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
});