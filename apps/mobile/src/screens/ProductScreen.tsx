import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { formatMoney, type OfferCard, type ProductDetail } from '@autoparts/api-client';
import type { RootStackParamList } from '../App';
import { useSession } from '../lib/session';
import { styles, colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Product'>;

const SORTS: [string, string][] = [
  ['recommended', 'რეკომენდებული'],
  ['cheapest', 'უიაფესი'],
  ['nearest', 'უახლოესი'],
  ['fastest', 'სწრაფი'],
];

const AVAILABILITY_KEY: Record<string, string> = {
  IN_STOCK: 'availability.inStock',
  AVAILABLE_TO_ORDER: 'availability.availableToOrder',
  UNAVAILABLE: 'availability.unavailable',
};

export function ProductScreen({ route, navigation }: Props) {
  const { api, t, selectedVehicle } = useSession();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [offers, setOffers] = useState<OfferCard[]>([]);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [sort, setSort] = useState('recommended');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedVehicle) return;
    setLoading(true);
    try {
      const [detail, result] = await Promise.all([
        api.product(route.params.productId, selectedVehicle.id),
        api.offers(route.params.productId, selectedVehicle.id, { sort }),
      ]);
      setProduct(detail);
      setOffers(result.data);
      setEmptyReason(result.emptyReason ?? null);
    } finally {
      setLoading(false);
    }
  }, [api, route.params.productId, selectedVehicle, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addToCart(offer: OfferCard) {
    if (!selectedVehicle) return;
    setAdding(offer.offerId);
    setErrorKey(null);
    try {
      await api.addToCart({
        offerId: offer.offerId,
        vehicleId: selectedVehicle.id,
        quantity: 1,
      });
      navigation.navigate('Cart');
    } catch (error) {
      setErrorKey(
        typeof error === 'object' && error !== null && 'messageKey' in error
          ? String((error as { messageKey: string }).messageKey)
          : 'error.internal',
      );
    } finally {
      setAdding(null);
    }
  }

  if (loading && !product) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* The most important line on the screen (PRD §55). */}
      {product?.fitment && (
        <View
          style={[
            styles.banner,
            product.fitment.verdict === 'CONDITIONAL' ? styles.bannerWarn : styles.bannerOk,
          ]}
        >
          <Text
            style={{
              color: product.fitment.verdict === 'CONDITIONAL' ? colors.pending : colors.ok,
            }}
          >
            {product.fitment.verdict === 'CONDITIONAL' ? '⚠️' : '✅'} {t(product.fitment.labelKey)}
            {selectedVehicle ? ` — ${selectedVehicle.label}` : ''}
          </Text>
        </View>
      )}

      {product && (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.muted}>ბრენდი</Text>
            <Text style={styles.body}>{product.brand.name}</Text>
          </View>
          {product.identifiers.map((identifier) => (
            <View style={styles.row} key={`${identifier.kind}-${identifier.value}`}>
              <Text style={styles.muted}>{identifier.kind}</Text>
              <Text style={[styles.body, styles.mono]}>{identifier.value}</Text>
            </View>
          ))}
        </View>
      )}

      {emptyReason === 'NOT_COMPATIBLE' ? (
        <View style={styles.card}>
          <Text style={styles.body}>ეს ნაწილი არ ერგება {selectedVehicle?.label}-ს.</Text>
          <Text style={styles.small}>
            შეთავაზებებს განზრახ არ ვაჩვენებთ — არასწორი ნაწილის შეძენა უარესია, ვიდრე
            ცარიელი გვერდი.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.pillRow}>
            {SORTS.map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.pill, sort === key && styles.pillActive]}
                onPress={() => setSort(key)}
              >
                <Text style={{ color: colors.text }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {errorKey && (
            <View style={[styles.banner, styles.bannerError]}>
              <Text style={{ color: colors.accent }}>{t(errorKey)}</Text>
            </View>
          )}

          {offers.map((offer) => (
            <View style={styles.card} key={offer.offerId}>
              <View style={styles.row}>
                <Text style={styles.body}>{offer.partner.displayName}</Text>
                <Text style={styles.price}>
                  {formatMoney(offer.price.amountMinor, offer.price.currency)}
                </Text>
              </View>
              <Text style={styles.muted}>
                {t(AVAILABILITY_KEY[offer.availability] ?? '')}
                {offer.availability === 'IN_STOCK' ? ` (${offer.availableQuantity})` : ''}
                {offer.location.city ? ` · 📍 ${offer.location.city}` : ''}
                {offer.location.distanceKm !== null ? ` · ${offer.location.distanceKm} კმ` : ''}
              </Text>
              {/* Always shown, never buried (R2). */}
              <Text style={[styles.small, offer.stock.isStale ? { color: colors.pending } : null]}>
                🕐 მარაგი განახლდა {offer.stock.ageMinutes} წუთის წინ
                {offer.stock.isStale ? ' — შესაძლოა შეიცვალოს' : ''}
              </Text>
              <TouchableOpacity
                style={[
                  styles.button,
                  (adding !== null || offer.availability !== 'IN_STOCK') && styles.buttonDisabled,
                ]}
                onPress={() => addToCart(offer)}
                disabled={adding !== null || offer.availability !== 'IN_STOCK'}
              >
                <Text style={styles.buttonText}>
                  {adding === offer.offerId ? '…' : 'კალათაში'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
