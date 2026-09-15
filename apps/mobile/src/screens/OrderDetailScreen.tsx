import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { formatMoney, type PickupCredential } from '@autoparts/api-client';
import { ORDER_STATUS_I18N, type OrderStatus } from '@autoparts/core';
import type { RootStackParamList } from '../App';
import { useSession } from '../lib/session';
import { styles, colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'OrderDetail'>;

/**
 * Order detail, and the pickup credential when there is one.
 *
 * The six-digit code is shown as text rather than only as a QR. PRD §49 allows
 * either, and a service centre with no camera or no signal still has to be able
 * to hand the part over — so the fallback is the primary here, and a scannable
 * code is a refinement on top.
 */
export function OrderDetailScreen({ route }: Props) {
  const { api, t } = useSession();
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [pickup, setPickup] = useState<PickupCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await api.order(route.params.orderId);
      setOrder(detail);
      if (['READY_FOR_PICKUP', 'PICKED_UP'].includes(String(detail['status']))) {
        setPickup(await api.pickupCode(route.params.orderId).catch(() => null));
      }
    } finally {
      setLoading(false);
    }
  }, [api, route.params.orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !order) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const status = String(order['status']) as OrderStatus;
  const items = (order['items'] as Record<string, unknown>[]) ?? [];
  const deadline = order['pickup_deadline'] as string | null;
  const hoursLeft = deadline
    ? Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 3600000))
    : null;

  async function confirmReceipt() {
    setBusy(true);
    try {
      await api.confirmReceipt(route.params.orderId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={{ color: colors.accent, fontSize: 15 }}>
        {t(ORDER_STATUS_I18N[status] ?? 'order.status.draft')}
      </Text>

      {pickup && status === 'READY_FOR_PICKUP' && (
        <View style={styles.card}>
          <Text style={styles.h2}>მზადაა ასაღებად</Text>
          <View
            style={{
              borderWidth: 2,
              borderStyle: 'dashed',
              borderColor: colors.border,
              borderRadius: 10,
              padding: spacing.xl,
              backgroundColor: colors.surface2,
            }}
          >
            <Text style={styles.code}>{pickup.code.split('').join(' ')}</Text>
          </View>
          <Text style={styles.small}>აჩვენეთ ეს კოდი გამყიდველს</Text>

          <View style={styles.row}>
            <Text style={styles.muted}>გამყიდველი</Text>
            <Text style={styles.body}>{pickup.partnerName}</Text>
          </View>
          <Text style={styles.small}>{pickup.location.address}</Text>

          {hoursLeft !== null && (
            <View style={[styles.banner, hoursLeft < 4 ? styles.bannerWarn : null]}>
              <Text style={styles.small}>
                ⏱ დარჩა {hoursLeft} საათი. ვადის გასვლისას შეკვეთა ავტომატურად გაუქმდება
                და თანხა სრულად დაგიბრუნდებათ.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={confirmReceipt}
            disabled={busy}
          >
            <Text style={styles.buttonText}>მივიღე შეკვეთა</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'PICKED_UP' && (
        <View style={styles.card}>
          <Text style={styles.body}>გამყიდველმა გასცა ნაწილი.</Text>
          <Text style={styles.small}>
            შეკვეთა დასრულებულად ჩაითვლება მას შემდეგ, რაც თქვენ დაადასტურებთ მიღებას.
          </Text>
          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={confirmReceipt}
            disabled={busy}
          >
            <Text style={styles.buttonText}>მივიღე შეკვეთა</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.card}>
        {items.map((item, index) => {
          const snapshot = (item['product_snapshot'] ?? {}) as Record<string, string>;
          return (
            <View style={styles.row} key={index}>
              <View style={{ flex: 1 }}>
                <Text style={styles.body}>{snapshot['name']}</Text>
                <Text style={styles.small}>
                  {snapshot['brand']} · {String(item['quantity'])} ცალი
                </Text>
              </View>
              <Text style={styles.body}>
                {formatMoney(String(item['line_total_minor']), String(item['currency']))}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.muted}>ჯამი</Text>
          <Text style={styles.price}>
            {formatMoney(String(order['total_minor']), String(order['currency']))}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
