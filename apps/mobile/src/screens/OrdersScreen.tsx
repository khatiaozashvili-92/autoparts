import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { formatMoney, type OrderSummary } from '@autoparts/api-client';
import { ORDER_STATUS_I18N, type OrderStatus } from '@autoparts/core';
import type { RootStackParamList } from '../App';
import { useSession } from '../lib/session';
import { styles, colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Orders'>;

export function OrdersScreen({ navigation }: Props) {
  const { api, t } = useSession();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await api.orders());
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => void load());
    return unsubscribe;
  }, [navigation, load]);

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {orders.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.body}>ჯერ არცერთი შეკვეთა არ გაქვთ.</Text>
        </View>
      )}

      {orders.map((order) => (
        <TouchableOpacity
          key={order.id}
          style={styles.card}
          onPress={() =>
            navigation.navigate('OrderDetail', {
              orderId: order.id,
              orderNumber: order.order_number,
            })
          }
        >
          <View style={styles.row}>
            <Text style={styles.body}>{order.order_number}</Text>
            <Text style={styles.price}>
              {formatMoney(order.total_minor, order.currency)}
            </Text>
          </View>
          <Text style={styles.small}>
            {order.partner_name} · {order.item_count} ერთეული
          </Text>
          {/* Backend enums never reach the screen (PRD §46). */}
          <Text style={{ color: colors.accent, fontSize: 13 }}>
            {t(ORDER_STATUS_I18N[order.status as OrderStatus] ?? 'order.status.draft')}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
