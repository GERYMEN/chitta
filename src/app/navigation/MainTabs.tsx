import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../../features/home/screens/HomeScreen';
import { TransactionsScreen } from '../../features/transactions/screens/TransactionsScreen';
import { PendingScreen } from '../../features/pending/screens/PendingScreen';
import { AccountsScreen } from '../../features/accounts/screens/AccountsScreen';
import { Icon } from '../../shared/icons';
import { colors } from '../../theme';
import { useShallow } from 'zustand/react/shallow';
import { useTransactionsStore, selectPending } from '../../features/transactions/state/transactionsStore';
import { MainTabParamList } from './routes';

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICON: Record<keyof MainTabParamList, string> = {
  Home: 'home-variant',
  Transactions: 'file-document-outline',
  Pending: 'clock-outline',
  Accounts: 'wallet-outline',
};

export function MainTabs() {
  const pendingCount = useTransactionsStore(useShallow(selectPending)).length;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.outline,
        tabBarIcon: ({ color, size }) => (
          <Icon name={TAB_ICON[route.name as keyof MainTabParamList]} size={size} color={color} />
        ),
      })}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Transactions" component={TransactionsScreen} />
      <Tab.Screen
        name="Pending"
        component={PendingScreen}
        options={{ tabBarBadge: pendingCount > 0 ? pendingCount : undefined }}
      />
      <Tab.Screen name="Accounts" component={AccountsScreen} />
    </Tab.Navigator>
  );
}
