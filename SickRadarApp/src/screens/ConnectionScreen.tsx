import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ActivityIndicator,
  FlatList,
  TextInput,
  Alert,
  ScrollView,
  RefreshControl
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../App';
import ApiService from '../services/api';
import discoveryService, { ServerInfo } from '../services/discovery';

type ConnectionScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Connection'>;

const ConnectionScreen: React.FC = () => {
  const navigation = useNavigation<ConnectionScreenNavigationProp>();
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [manualIP, setManualIP] = useState('');
  const [manualPort, setManualPort] = useState('8080');
  const [currentServer, setCurrentServer] = useState<ServerInfo | null>(null);
  const [connected, setConnected] = useState(false);

  // Carregar servidores ao montar
  useEffect(() => {
    loadServers();
    
    // Verificar servidor atual
    const server = ApiService.getCurrentServer();
    if (server) {
      setCurrentServer(server);
      setConnected(ApiService.isWebSocketConnected());
    }
    
    // Verificar a cada 2 segundos se ainda está conectado
    const interval = setInterval(() => {
      setConnected(ApiService.isWebSocketConnected());
    }, 2000);
    
    return () => {
      clearInterval(interval);
      // Parar descoberta ao desmontar
      discoveryService.stopDiscovery();
    };
  }, []);

  // Carregar servidores
  const loadServers = () => {
    const discovered = discoveryService.getDiscoveredServers();
    const manual = discoveryService.getManualServers();
    
    // Combinar servidores e remover duplicatas
    const allServers = [...discovered, ...manual].filter((server, index, self) => 
      index === self.findIndex(s => (s.ip === server.ip && s.port === server.port))
    );
    
    setServers(allServers);
  };

  // Iniciar descoberta
  const startDiscovery = async () => {
    setIsDiscovering(true);
    discoveryService.startDiscovery();
    
    // Atualizar lista a cada segundo durante a descoberta
    const interval = setInterval(loadServers, 1000);
    
    // Parar após 10 segundos
    setTimeout(() => {
      clearInterval(interval);
      discoveryService.stopDiscovery();
      setIsDiscovering(false);
      loadServers(); // Atualizar lista final
    }, 10000);
  };

  // Conectar a um servidor
  const connectToServer = async (server: ServerInfo) => {
    try {
      const success = await ApiService.connectToServer(server);
      
      if (success) {
        setCurrentServer(server);
        setConnected(true);
        Alert.alert('Sucesso', `Conectado ao servidor ${server.name}`);
      } else {
        Alert.alert('Erro', `Falha ao conectar ao servidor ${server.ip}:${server.port}`);
      }
    } catch (error) {
      console.error('Erro ao conectar:', error);
      Alert.alert('Erro', 'Falha ao conectar ao servidor');
    }
  };

  // Adicionar servidor manualmente
  const addManualServer = async () => {
    if (!manualIP.trim()) {
      Alert.alert('Erro', 'Digite um endereço IP válido');
      return;
    }
    
    const port = parseInt(manualPort.trim() || '8080', 10);
    
    try {
      const server = await discoveryService.addManualServer(manualIP, port);
      
      if (server) {
        loadServers();
        setManualIP('');
        setManualPort('8080');
        Alert.alert('Sucesso', `Servidor ${manualIP}:${port} adicionado`);
      } else {
        Alert.alert('Erro', `Não foi possível conectar ao servidor ${manualIP}:${port}`);
      }
    } catch (error) {
      console.error('Erro ao adicionar servidor:', error);
      Alert.alert('Erro', 'Falha ao adicionar servidor');
    }
  };

  // Navegar para o dashboard
  const goToDashboard = () => {
    if (connected) {
      navigation.navigate('Dashboard');
    } else {
      Alert.alert('Erro', 'Conecte-se a um servidor primeiro');
    }
  };

  // Tratar refresh
  const onRefresh = async () => {
    setRefreshing(true);
    loadServers();
    
    // Verificar servidor atual
    const server = ApiService.getCurrentServer();
    if (server) {
      setCurrentServer(server);
      setConnected(ApiService.isWebSocketConnected());
    }
    
    setRefreshing(false);
  };

  // Renderizar item da lista
  const renderServerItem = ({ item }: { item: ServerInfo }) => {
    const isActive = currentServer?.ip === item.ip && currentServer?.port === item.port;
    
    return (
      <TouchableOpacity 
        style={[styles.serverItem, isActive && styles.activeServer]} 
        onPress={() => connectToServer(item)}
      >
        <View style={styles.serverInfo}>
          <Text style={styles.serverName}>{item.name}</Text>
          <Text style={styles.serverAddress}>{item.ip}:{item.port}</Text>
          <Text style={styles.serverVersion}>v{item.version}</Text>
        </View>
        
        <View style={styles.serverActions}>
          {isActive ? (
            <View style={[styles.statusIndicator, { backgroundColor: connected ? '#4CAF50' : '#F44336' }]} />
          ) : (
            <TouchableOpacity 
              style={styles.connectButton}
              onPress={() => connectToServer(item)}
            >
              <Text style={styles.connectButtonText}>Conectar</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl 
          refreshing={refreshing} 
          onRefresh={onRefresh} 
        />
      }
    >
      {/* Cabeçalho */}
      <View style={styles.header}>
        <Text style={styles.title}>Radar Monitor</Text>
        <Text style={styles.subtitle}>Conexão de Servidor</Text>
      </View>
      
      {/* Status da conexão */}
      <View style={styles.statusContainer}>
        <Text style={styles.statusLabel}>Status:</Text>
        <View style={styles.statusWrapper}>
          <View 
            style={[
              styles.statusDot, 
              { backgroundColor: connected ? '#4CAF50' : '#F44336' }
            ]} 
          />
          <Text style={styles.statusText}>
            {connected ? 'Conectado' : 'Desconectado'}
          </Text>
        </View>
        
        {currentServer && (
          <Text style={styles.currentServer}>
            {currentServer.name} ({currentServer.ip}:{currentServer.port})
          </Text>
        )}
      </View>
      
      {/* Ações */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity 
          style={[styles.actionButton, connected && styles.activeButton]}
          onPress={goToDashboard}
          disabled={!connected}
        >
          <Text style={styles.actionButtonText}>
            Abrir Dashboard
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.actionButton, isDiscovering && styles.activeButton]}
          onPress={startDiscovery}
          disabled={isDiscovering}
        >
          <Text style={styles.actionButtonText}>
            {isDiscovering ? 'Procurando...' : 'Procurar Servidores'}
          </Text>
          {isDiscovering && <ActivityIndicator size="small" color="#fff" style={styles.loader} />}
        </TouchableOpacity>
      </View>
      
      {/* Lista de servidores */}
      <View style={styles.serversContainer}>
        <Text style={styles.sectionTitle}>Servidores Disponíveis</Text>
        
        {servers.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              Nenhum servidor encontrado.
            </Text>
            <Text style={styles.emptyStateSubtext}>
              Toque em "Procurar Servidores" para descobrir servidores na rede.
            </Text>
          </View>
        ) : (
          <FlatList
            data={servers}
            renderItem={renderServerItem}
            keyExtractor={(item) => `${item.ip}:${item.port}`}
            style={styles.serverList}
            contentContainerStyle={styles.serverListContent}
          />
        )}
      </View>
      
      {/* Adicionar servidor manualmente */}
      <View style={styles.manualContainer}>
        <Text style={styles.sectionTitle}>Adicionar Servidor</Text>
        
        <View style={styles.inputRow}>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Endereço IP</Text>
            <TextInput
              style={styles.input}
              value={manualIP}
              onChangeText={setManualIP}
              placeholder="192.168.1.100"
              keyboardType="numeric"
              autoCapitalize="none"
            />
          </View>
          
          <View style={[styles.inputContainer, styles.portInput]}>
            <Text style={styles.inputLabel}>Porta</Text>
            <TextInput
              style={styles.input}
              value={manualPort}
              onChangeText={setManualPort}
              placeholder="8080"
              keyboardType="numeric"
            />
          </View>
        </View>
        
        <TouchableOpacity 
          style={styles.addButton}
          onPress={addManualServer}
        >
          <Text style={styles.addButtonText}>Adicionar Servidor</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    backgroundColor: '#2196F3',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 16,
    color: '#e0e0e0',
    marginTop: 5,
  },
  statusContainer: {
    margin: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  statusWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  currentServer: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  actionsContainer: {
    flexDirection: 'row',
    margin: 16,
    marginTop: 0,
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  activeButton: {
    backgroundColor: '#1976D2',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  loader: {
    marginLeft: 8,
  },
  serversContainer: {
    margin: 16,
    marginTop: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    marginTop: 16,
  },
  emptyState: {
    padding: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#555',
    textAlign: 'center',
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
    marginTop: 8,
  },
  serverList: {
    maxHeight: 300,
  },
  serverListContent: {
    paddingBottom: 8,
  },
  serverItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  activeServer: {
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  serverInfo: {
    flex: 1,
  },
  serverName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  serverAddress: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  serverVersion: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  serverActions: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  connectButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  connectButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  statusIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  manualContainer: {
    margin: 16,
    marginTop: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inputRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  inputContainer: {
    flex: 3,
  },
  portInput: {
    flex: 1,
    marginLeft: 8,
  },
  inputLabel: {
    fontSize: 14,
    marginBottom: 4,
    color: '#555',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    fontSize: 14,
  },
  addButton: {
    backgroundColor: '#4CAF50',
    padding: 12,
    borderRadius: 4,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default ConnectionScreen;