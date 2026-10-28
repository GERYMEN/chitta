import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabs } from './MainTabs';
import { TransactionDetailScreen } from '../../features/transactions/screens/TransactionDetailScreen';
import { AddRecordScreen } from '../../features/transactions/screens/AddRecordScreen';
import { EditTransactionScreen } from '../../features/transactions/screens/EditTransactionScreen';
import { AddAccountScreen } from '../../features/accounts/screens/AddAccountScreen';
import { SmsSuggestionsScreen } from '../../features/sms-sync/screens/SmsSuggestionsScreen';
import { OnboardingScreen } from '../../features/onboarding/screens/OnboardingScreen';
import { ProfileSetupScreen } from '../../features/onboarding/screens/ProfileSetupScreen';
import { PermissionsScreen } from '../../features/onboarding/screens/PermissionsScreen';
import { ActivityScreen } from '../../features/activity/screens/ActivityScreen';
import { RootStackParamList } from './routes';

const Stack = createNativeStackNavigator<RootStackParamList>();

type RootNavigatorProps = {
  initialRouteName: 'Tabs' | 'Onboarding';
};

export function RootNavigator({ initialRouteName }: RootNavigatorProps) {
  return (
    <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
      <Stack.Screen name="Permissions" component={PermissionsScreen} />
      <Stack.Screen name="Tabs" component={MainTabs} />
      <Stack.Screen
        name="TransactionDetail"
        component={TransactionDetailScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="AddRecord"
        component={AddRecordScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="EditTransaction"
        component={EditTransactionScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="AddAccount"
        component={AddAccountScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="SmsSuggestions"
        component={SmsSuggestionsScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="Activity"
        component={ActivityScreen}
        options={{ presentation: 'card' }}
      />
    </Stack.Navigator>
  );
}
