import React, { useState, useEffect, useCallback } from 'react';
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
  RefreshControl,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../App';
import { Ionicons } from '@expo/vector-icons';
import ApiService from '../services/api';
import discoveryService, { ServerInfo } from '../services/discovery';
import { colors, spacing, fontSizes } from '../styles/theme';

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
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  
  // Animações
  const scanAnim = React.useRef(new Animated.Value(0)).current;
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  
  // Carregar servidores ao montar
  useEffect(() => {
    loadServers();
    startPulseAnimation();
    
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
  
  // Recarregar servidores quando a tela estiver em foco
  useFocusEffect(
    useCallback(() => {
      loadServers();
      return () => {
        // Cleanup
      };
    }, [])
  );
  
  // Iniciar animação de pulso
  const startPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        })
      ])
    ).start();
  };
  
  // Iniciar animação de scan
  const startScanAnimation = () => {
    scanAnim.setValue(0);
    Animated.timing(scanAnim, {
      toValue: 1,
      duration: 2000,
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false
    }).start();
  };
  
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
    
    // Iniciar animação
    startScanAnimation();
    
    // Atualizar lista a cada segundo durante a descoberta
    const interval = setInterval(() => {
      loadServers();
      startScanAnimation();
    }, 2000);
    
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
      // Mostrar indicador de carregamento
      Alert.alert(
        'Conectando',
        `Estabelecendo conexão com ${server.name} (${server.ip}:${server.port})...`,
        [{ text: 'Cancelar', style: 'cancel' }],
        { cancelable: false }
      );
      
      const success = await ApiService.connectToServer(server);
      
      if (success) {
        setCurrentServer(server);
        setConnected(true);
        
        // Fechar o alerta anterior e mostrar sucesso
        setTimeout(() => {
          Alert.alert(
            'Sucesso',
            `Conectado ao servidor ${server.name}`,
            [
              { 
                text: 'Ir para Dashboard', 
                onPress: () => navigation.navigate('Dashboard') 
              }
            ]
          );
        }, 500);
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
      // Mostrar indicador de carregamento
      Alert.alert(
        'Adicionando Servidor',
        `Tentando conectar a ${manualIP}:${port}...`,
        [{ text: 'Cancelar', style: 'cancel' }],
        { cancelable: false }
      );
      
      const server = await discoveryService.addManualServer(manualIP, port);
      
      if (server) {
        loadServers();
        setManualIP('');
        setManualPort('8080');
        
        // Fechar o alerta anterior e mostrar sucesso
        setTimeout(() => {
          Alert.alert(
            'Sucesso',
            `Servidor ${manualIP}:${port} adicionado`,
            [
              { 
                text: 'Conectar', 
                onPress: () => connectToServer(server) 
              },
              {
                text: 'Ok',
                style: 'cancel'
              }
            ]
          );
        }, 500);
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
  
  // Alternar expansão do item
  const toggleItemExpansion = (serverId: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        newSet.add(serverId);
      }
      return newSet;
    });
  };
  
  // Renderizar item da lista
  const renderServerItem = ({ item }: { item: ServerInfo }) => {
    const isActive = currentServer?.ip === item.ip && currentServer?.port === item.port;
    const isExpanded = expandedItems.has(`${item.ip}:${item.port}`);
    
    return (
      <Animated.View 
        style={[
          styles.serverItem, 
          isActive && styles.activeServer
        ]}
      >
        <TouchableOpacity 
          style={styles.serverItemHeader}
          onPress={() => toggleItemExpansion(`${item.ip}:${item.port}`)}
        >
          <View style={styles.serverInfo}>
            <Text style={styles.serverName}>{item.name}</Text>
            <Text style={styles.serverAddress}>{item.ip}:{item.port}</Text>
          </View>
          
          <View style={styles.serverActions}>
            {isActive ? (
              <View style={[
                styles.statusIndicator, 
                { backgroundColor: connected ? colors.success : colors.error }
              ]} />
            ) : (
              <Ionicons 
                name={isExpanded ? "chevron-up" : "chevron-down"} 
                size={20} 
                color={colors.text.secondary} 
              />
            )}
          </View>
        </TouchableOpacity>
        
        {(isExpanded || isActive) && (
          <View style={styles.serverDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Versão:</Text>
              <Text style={styles.detailValue}>{item.version}</Text>
            </View>
            
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>WebSocket:</Text>
              <Text style={styles.detailValue}>{item.wsUrl}</Text>
            </View>
            
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>API:</Text>
              <Text style={styles.detailValue}>{item.apiUrl}</Text>
            </View>
            
            {item.lastConnected && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Última conexão:</Text>
                <Text style={styles.detailValue}>
                  {new Date(item.lastConnected).toLocaleString()}
                </Text>
              </View>
            )}
            
            <View style={styles.serverButtonsRow}>
              <TouchableOpacity 
                style={[
                  styles.serverButton,
                  isActive && connected ? styles.disconnectButton : styles.connectButton
                ]}
                onPress={() => connectToServer(item)}
              >
                <Text style={styles.serverButtonText}>
                  {isActive && connected ? 'Reconectar' : 'Conectar'}
                </Text>
              </TouchableOpacity>
              
              {item.manual && (
                <TouchableOpacity 
                  style={[styles.serverButton, styles.removeButton]}
                  onPress={() => {
                    Alert.alert(
                      'Remover Servidor',
                      `Tem certeza que deseja remover o servidor ${item.name}?`,
                      [
                        {
                          text: 'Cancelar',
                          style: 'cancel'
                        },
                        {
                          text: 'Remover',
                          style: 'destructive',
                          onPress: async () => {
                            await discoveryService.removeManualServer(item.ip, item.port);
                            loadServers();
                          }
                        }
                      ]
                    );
                  }}
                >
                  <Text style={styles.serverButtonText}>Remover</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </Animated.View>
    );
  };
  
  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh} 
            colors={[colors.primary]}
          />
        }
      >
        {/* Cabeçalho */}
        <View style={styles.header}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <Ionicons name="radio-outline" size={48} color={colors.primary} />
          </Animated.View>
          <Text style={styles.title}>SICK Radar Monitor</Text>
          <Text style={styles.subtitle}>Conexão de Servidor</Text>
        </View>
        
        {/* Status da conexão */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusLabel}>Status:</Text>
            <View style={styles.statusWrapper}>
              <View 
                style={[
                  styles.statusDot, 
                  { backgroundColor: connected ? colors.success : colors.error }
                ]} 
              />
              <Text style={[
                styles.statusText,
                { color: connected ? colors.success : colors.error }
              ]}>
                {connected ? 'Conectado' : 'Desconectado'}
              </Text>
            </View>
          </View>
          
          {currentServer && (
            <Text style={styles.currentServer}>
              {currentServer.name} ({currentServer.ip}:{currentServer.port})
            </Text>
          )}
          
          {connected && (
            <TouchableOpacity 
              style={styles.dashboardButton}
              onPress={goToDashboard}
            >
              <Text style={styles.dashboardButtonText}>Abrir Dashboard</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.text.inverse} />
            </TouchableOpacity>
          )}
        </View>
        
        {/* Ações de busca */}
        <View style={styles.actionsCard}>
          <View style={styles.actionsHeader}>
            <Text style={styles.actionsTitle}>Buscar Servidor</Text>
            <TouchableOpacity 
              style={[styles.scanButton, isDiscovering && styles.scanningButton]}
              onPress={startDiscovery}
              disabled={isDiscovering}
            >
              {isDiscovering ? (
                <>
                  <ActivityIndicator size="small" color={colors.text.inverse} />
                  <Text style={styles.scanButtonText}>Buscando...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="search" size={16} color={colors.text.inverse} />
                  <Text style={styles.scanButtonText}>Buscar na Rede</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          
          {isDiscovering && (
            <View style={styles.scanningInfo}>
              <Animated.View 
                style={[
                  styles.scanLine,
                  {
                    transform: [
                      {
                        translateY: scanAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 100]
                        })
                      }
                    ],
                    opacity: scanAnim.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0.8, 0.3, 0.8]
                    })
                  }
                ]}
              />
              <Text style={styles.scanningText}>
                Buscando dispositivos na rede local...
              </Text>
            </View>
          )}
        </View>
        
        {/* Lista de servidores */}
        {servers.length > 0 ? (
          <View style={styles.serversCard}>
            <Text style={styles.serversTitle}>
              Servidores Disponíveis ({servers.length})
            </Text>
            <FlatList
              data={servers}
              renderItem={renderServerItem}
              keyExtractor={(item) => `${item.ip}:${item.port}`}
              style={styles.serverList}
              scrollEnabled={false}
            />
          </View>
        ) : (
          <View style={styles.emptyServersCard}>
            <Ionicons name="cloud-offline-outline" size={48} color={colors.text.secondary} />
            <Text style={styles.emptyServersTitle}>Nenhum servidor encontrado</Text>
            <Text style={styles.emptyServersText}>
              Toque em "Buscar na Rede" para descobrir servidores ou adicione um manualmente.
            </Text>
          </View>
        )}
        
        {/* Adicionar servidor manualmente */}
        <View style={styles.manualCard}>
          <Text style={styles.manualTitle}>Adicionar Servidor Manualmente</Text>
          
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
            <Ionicons name="add-circle-outline" size={16} color={colors.text.inverse} />
            <Text style={styles.addButtonText}>Adicionar Servidor</Text>
          </TouchableOpacity>
        </View>
        
        {/* Informações de ajuda */}
        <TouchableOpacity 
          style={styles.helpCard}
          onPress={() => {
            Alert.alert(
              'Ajuda de Conexão',
              'Para conectar ao servidor do radar:\n\n' +
              '1. Verifique se o servidor está em execução\n' +
              '2. Certifique-se de que você está na mesma rede\n' +
              '3. Toque em "Buscar na Rede" para descobrir servidores\n' +
              '4. Se o servidor não for encontrado, adicione manualmente\n\n' +
              'Se tiver problemas, verifique o endereço IP e porta.'
            );
          }}
        >
          <Ionicons name="help-circle-outline" size={24} color={colors.text.secondary} />
          <Text style={styles.helpText}>
            Precisa de ajuda para conectar?
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
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
    paddingBottom: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginTop: spacing.l,
    marginBottom: spacing.m,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginTop: spacing.s,
  },
  subtitle: {
    fontSize: 16,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.m,
    marginBottom: spacing.m,
    ...styles.elevation,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 16,
    color: colors.text.secondary,
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
    fontSize: 16,
    fontWeight: 'bold',
  },
  currentServer: {
    fontSize: 14,
    color: colors.text.secondary,
    marginTop: spacing.s,
    marginBottom: spacing.s,
  },
  dashboardButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s,
    borderRadius: 8,
    marginTop: spacing.s,
  },
  dashboardButtonText: {
    color: colors.text.inverse,
    fontWeight: 'bold',
    marginRight: spacing.xs,
  },
  actionsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.m,
    marginBottom: spacing.m,
    ...styles.elevation,
  },
  actionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
  },
  scanButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xs,
    borderRadius: 16,
  },
  scanningButton: {
    backgroundColor: colors.primaryDark,
  },
  scanButtonText: {
    color: colors.text.inverse,
    fontWeight: 'bold',
    fontSize: 14,
    marginLeft: 4,
  },
  scanningInfo: {
    height: 100,
    marginTop: spacing.m,
    backgroundColor: `${colors.primary}10`,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.primary,
  },
  scanningText: {
    fontSize: 14,
    color: colors.text.secondary,
  },
  serversCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.m,
    marginBottom: spacing.m,
    ...styles.elevation,
  },
  serversTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: spacing.m,
  },
  serverList: {
    
  },
  serverItem: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: spacing.s,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  activeServer: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  serverItemHeader: {
    flexDirection: 'row',
    padding: spacing.m,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serverInfo: {
    flex: 1,
  },
  serverName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
  },
  serverAddress: {
    fontSize: 14,
    color: colors.text.secondary,
    marginTop: 2,
  },
  serverActions: {
    marginLeft: spacing.s,
  },
  statusIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  serverDetails: {
    padding: spacing.m,
    backgroundColor: `${colors.primary}05`,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  detailLabel: {
    width: 100,
    fontSize: 14,
    color: colors.text.secondary,
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    color: colors.text.primary,
  },
  serverButtonsRow: {
    flexDirection: 'row',
    marginTop: spacing.s,
    justifyContent: 'flex-end',
  },
  serverButton: {
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xs,
    borderRadius: 16,
    marginLeft: spacing.s,
  },
  connectButton: {
    backgroundColor: colors.primary,
  },
  disconnectButton: {
    backgroundColor: colors.primary,
  },
  removeButton: {
    backgroundColor: colors.error,
  },
  serverButtonText: {
    color: colors.text.inverse,
    fontWeight: 'bold',
    fontSize: 12,
  },
  emptyServersCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.xl,
    marginBottom: spacing.m,
    alignItems: 'center',
    ...styles.elevation,
  },
  emptyServersTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginTop: spacing.m,
    marginBottom: spacing.s,
  },
  emptyServersText: {
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  manualCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.m,
    marginBottom: spacing.m,
    ...styles.elevation,
  },
  manualTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: spacing.m,
  },
  inputRow: {
    flexDirection: 'row',
    marginBottom: spacing.m,
  },
  inputContainer: {
    flex: 3,
  },
  portInput: {
    flex: 1,
    marginLeft: spacing.m,
  },
  inputLabel: {
    fontSize: 14,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: spacing.m,
    fontSize: 14,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  addButton: {
    backgroundColor: colors.success,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.m,
    borderRadius: 8,
  },
  addButtonText: {
    color: colors.text.inverse,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  helpCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.m,
    flexDirection: 'row',
    alignItems: 'center',
    ...styles.elevation,
  },
  helpText: {
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

export default ConnectionScreen;