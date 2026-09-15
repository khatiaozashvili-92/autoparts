import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './lib/session';
import { colors } from './theme';
import { SignInScreen } from './screens/SignInScreen';
import { HomeScreen } from './screens/HomeScreen';
import { GarageScreen } from './screens/GarageScreen';
import { SearchScreen } from './screens/SearchScreen';
import { ProductScreen } from './screens/ProductScreen';
import { CartScreen } from './screens/CartScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { OrderDetailScreen } from './screens/OrderDetailScreen';

export type RootStackParamList = {
  Home: undefined;
  Garage: { next?: string } | undefined;
  Search: { query: string };
  Product: { productId: string; name: string };
  Cart: undefined;
  Orders: undefined;
  OrderDetail: { orderId: string; orderNumber: string };
  SignIn: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function Navigation() {
  const { ready, me } = useSession();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: 16 },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {me ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'autoparts' }} />
          <Stack.Screen name="Garage" component={GarageScreen} options={{ title: 'ჩემი გარაჟი' }} />
          <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'ძებნა' }} />
          <Stack.Screen
            name="Product"
            component={ProductScreen}
            options={({ route }) => ({ title: route.params.name })}
          />
          <Stack.Screen name="Cart" component={CartScreen} options={{ title: 'კალათა' }} />
          <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'შეკვეთები' }} />
          <Stack.Screen
            name="OrderDetail"
            component={OrderDetailScreen}
            options={({ route }) => ({ title: route.params.orderNumber })}
          />
        </>
      ) : (
        <Stack.Screen name="SignIn" component={SignInScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <NavigationContainer>
          <StatusBar style="auto" />
          <Navigation />
        </NavigationContainer>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
