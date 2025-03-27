import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

// Import screens
import DashboardScreen from './src/screens/DashboardScreen';
import VelocityDetailsScreen from './src/screens/VelocityDetailsScreen';
import HistoryScreen from './src/screens/HistoryScreen';

// Define the stack navigator params
export type RootStackParamList = {
  Dashboard: undefined;
  VelocityDetails: { index: number };
  History: { index: number };
};

const Stack = createStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator 
        initialRouteName="Dashboard" 
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
          name="Dashboard" 
          component={DashboardScreen} 
          options={{ title: 'SICK Radar Monitor' }} 
        />
        <Stack.Screen 
          name="VelocityDetails" 
          component={VelocityDetailsScreen} 
          options={({ route }) => ({ title: `Velocity ${route.params.index} Details` })}
        />
        <Stack.Screen 
          name="History" 
          component={HistoryScreen} 
          options={({ route }) => ({ title: `Velocity ${route.params.index} History` })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}