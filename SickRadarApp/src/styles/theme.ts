// src/styles/theme.ts
// Este arquivo define as cores e outros estilos consistentes para a aplicação

export const colors = {
  primary: '#2196F3',     // Azul primário
  primaryDark: '#1976D2', // Azul mais escuro
  primaryLight: '#BBDEFB', // Azul mais claro
  
  secondary: '#4CAF50',   // Verde para elementos secundários
  
  success: '#4CAF50',     // Verde para sucesso
  warning: '#FFC107',     // Amarelo para alertas
  error: '#F44336',       // Vermelho para erros
  info: '#2196F3',        // Azul para informações
  
  background: '#F5F7FA',  // Cor de fundo geral
  surface: '#FFFFFF',     // Cor para superfícies como cards
  
  text: {
    primary: '#333333',   // Texto primário
    secondary: '#757575', // Texto secundário
    hint: '#9E9E9E',      // Dicas, placeholders
    disabled: '#BDBDBD',  // Texto desabilitado
    inverse: '#FFFFFF',   // Texto sobre cores escuras
  },
  
  divider: '#EEEEEE',     // Linhas divisórias
  
  transparent: 'transparent', // Transparente
  
  velocity: [             // Cores para cada velocidade
    '#3F51B5', // Vel 1 - Indigo
    '#2196F3', // Vel 2 - Azul
    '#00BCD4', // Vel 3 - Ciano
    '#009688', // Vel 4 - Teal
    '#4CAF50', // Vel 5 - Verde
    '#FFC107', // Vel 6 - Amarelo
    '#FF5722', // Vel 7 - Laranja deep
  ],
  
  position: [             // Cores para cada posição
    '#673AB7', // Pos 1 - Roxo
    '#3F51B5', // Pos 2 - Indigo
    '#2196F3', // Pos 3 - Azul
    '#03A9F4', // Pos 4 - Azul claro
    '#00BCD4', // Pos 5 - Ciano
    '#009688', // Pos 6 - Teal
    '#4CAF50', // Pos 7 - Verde
  ]
};

export const spacing = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
  xxl: 48,
};

export const fontSizes = {
  xs: 10,
  s: 12,
  m: 14,
  l: 16,
  xl: 18,
  xxl: 20,
  xxxl: 24,
  display: 34,
};

export const fontWeights = {
  light: '300',
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  black: '900',
};

export const elevation = {
  none: {
    shadowColor: colors.transparent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  xs: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  s: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  m: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  l: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 5,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 7,
    elevation: 8,
  },
};

export const borderRadius = {
  none: 0,
  xs: 2,
  s: 4,
  m: 8,
  l: 12,
  xl: 16,
  xxl: 24,
  round: 9999,
};

export const animations = {
  durations: {
    short: 150,
    medium: 300,
    long: 500,
  },
  easings: {
    // Referências para uso com o Animated do React Native
    // ex: Animated.timing(value, { easing: Easing.easeInOut, ... })
    easeInOut: 'ease-in-out',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    linear: 'linear',
  },
};

// Exportando o tema completo
export default {
  colors,
  spacing,
  fontSizes,
  fontWeights,
  elevation,
  borderRadius,
  animations,
};