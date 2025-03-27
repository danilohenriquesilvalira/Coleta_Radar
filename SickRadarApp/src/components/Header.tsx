import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import StatusBadge from './StatusBadge';

interface HeaderProps {
  title: string;
  showBack?: boolean;
  showStatus?: boolean;
  status?: string;
  rightComponent?: React.ReactNode;
  onRightPress?: () => void;
  rightIcon?: string;
  backgroundColor?: string;
  textColor?: string;
}

const Header: React.FC<HeaderProps> = ({
  title,
  showBack = false,
  showStatus = false,
  status = 'ok',
  rightComponent,
  onRightPress,
  rightIcon,
  backgroundColor = '#2196F3',
  textColor = '#ffffff'
}) => {
  const navigation = useNavigation();
  
  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };
  
  return (
    <>
      <StatusBar
        barStyle="light-content"
        backgroundColor={backgroundColor}
        translucent={false}
      />
      <View style={[styles.container, { backgroundColor }]}>
        <View style={styles.leftContainer}>
          {showBack && (
            <TouchableOpacity style={styles.backButton} onPress={goBack}>
              <Ionicons name="arrow-back" size={24} color={textColor} />
            </TouchableOpacity>
          )}
        </View>
        
        <View style={styles.centerContainer}>
          <Text style={[styles.title, { color: textColor }]}>{title}</Text>
          {showStatus && (
            <StatusBadge status={status} />
          )}
        </View>
        
        <View style={styles.rightContainer}>
          {rightComponent || (rightIcon && onRightPress && (
            <TouchableOpacity style={styles.rightButton} onPress={onRightPress}>
              <Ionicons name={rightIcon as any} size={24} color={textColor} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    height: Platform.OS === 'ios' ? 88 : 64,
    paddingTop: Platform.OS === 'ios' ? 44 : 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    zIndex: 10,
  },
  leftContainer: {
    width: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  centerContainer: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rightContainer: {
    width: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  backButton: {
    padding: 4,
  },
  rightButton: {
    padding: 4,
  }
});

export default Header;