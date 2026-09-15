import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { formatMoney, type Cart, type CheckoutQuote } from '@autoparts/api-client';
import type { RootStackParamList } from '../App';
import { useSession } from '../lib/session';
import { styles, colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Cart'>;

/**
 * Cart and checkout in one screen.
 *
 * The 15-minute hold is displayed as a live countdown: the customer is being
 * asked to hurry, so they are told that, rather than discovering it when the
 * payment fails (PRD §28).
 */
export function CartScreen({ navigation }: Props) {
  const { api, t } = useSession();
  const [cart, setCart] = useState<Cart | null>(null);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const idempotencyKey = useRef(`m-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCart(await api.cart());
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!quote) return;
    const tick = () =>
      setRemaining(Math.max(0, new Date(quote.expiresAt).getTime() - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [quote]);

  function report(error: unknown) {
    setErrorKey(
      typeof error === 'object' && error !== null && 'messageKey' in error
        ? String((error as { messageKey: string }).messageKey)
        : 'error.internal',
    );
  }

  async function reserve() {
    setBusy(true);
    setErrorKey(null);
    try {
      setQuote(await api.reserve());
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!quote) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const order = await api.confirm(quote.reservationIds, idempotencyKey.current);
      await api.capture(order.orderId);
      navigation.navigate('OrderDetail', {
        orderId: order.orderId,
        orderNumber: order.orderNumber,
      });
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {errorKey && (
        <View style={[styles.banner, styles.bannerError]}>
          <Text style={{ color: colors.accent }}>{t(errorKey)}</Text>
        </View>
      )}

      {!cart || cart.items.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.body}>კალათა ცარიელია.</Text>
        </View>
      ) : (
        <>
          {cart.blocker === 'MULTIPLE_PARTNERS' && (
            <View style={[styles.banner, styles.bannerError]}>
              <Text style={{ color: colors.accent }}>{t('error.cart.multiplePartners')}</Text>
            </View>
          )}

          {cart.items.map((item) => (
            <View style={styles.card} key={item.id}>
              <Text style={styles.body}>{item.productName}</Text>
              <Text style={styles.small}>
                {item.brandName} · {item.partner.displayName}
              </Text>
              <Text style={styles.small}>{item.vehicleLabel}-სთვის</Text>
              <View style={styles.row}>
                <Text style={styles.muted}>{item.quantity} ცალი</Text>
                <Text style={styles.price}>
                  {formatMoney(item.lineTotalMinor, item.currency)}
                </Text>
              </View>
            </View>
          ))}

          {quote ? (
            <View style={styles.card}>
              <View style={[styles.banner, remaining < 120000 ? styles.bannerWarn : null]}>
                <Text style={styles.body}>
                  ⏱ მარაგი დარეზერვებულია — {minutes}:{String(seconds).padStart(2, '0')}
                </Text>
              </View>

              <View style={styles.row}>
                <Text style={styles.muted}>პროდუქტი</Text>
                <Text style={styles.body}>
                  {formatMoney(quote.totals.subtotalMinor, quote.totals.currency)}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.muted}>მომსახურება</Text>
                <Text style={styles.body}>
                  {formatMoney(quote.totals.markupMinor, quote.totals.currency)}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.muted}>ჯამი</Text>
                <Text style={styles.price}>
                  {formatMoney(quote.totals.totalMinor, quote.totals.currency)}
                </Text>
              </View>

              <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
                <Text style={styles.small}>აღება: {quote.pickupLocation.name}</Text>
                <Text style={styles.small}>{quote.pickupLocation.address}</Text>
              </View>

              {remaining === 0 ? (
                <TouchableOpacity style={styles.button} onPress={reserve}>
                  <Text style={styles.buttonText}>დრო ამოიწურა — თავიდან</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.button, busy && styles.buttonDisabled]}
                  onPress={pay}
                  disabled={busy}
                >
                  <Text style={styles.buttonText}>{busy ? 'მუშავდება…' : 'გადახდა'}</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.button,
                (busy || cart.blocker === 'MULTIPLE_PARTNERS') && styles.buttonDisabled,
              ]}
              onPress={reserve}
              disabled={busy || cart.blocker === 'MULTIPLE_PARTNERS'}
            >
              <Text style={styles.buttonText}>გაგრძელება</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}
